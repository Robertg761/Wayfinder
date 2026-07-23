import type { RepoMap, RepoTreeEntry, WayfinderErrorCode } from "@wayfinder/contracts";
import { z } from "zod";

export class GitHubApiError extends Error {
  constructor(
    public readonly code: WayfinderErrorCode,
    message: string,
    public readonly status: number,
    public readonly resetAt?: string,
  ) {
    super(message);
    this.name = "GitHubApiError";
  }
}

// One request fans out to a bounded number of GitHub lookups (map metadata,
// tree, readme, plus inspected files). The cap stops a crafted map or query
// from amplifying a single public request into an unbounded upstream sweep.
const UPSTREAM_FETCH_LIMIT = 40;

export class UpstreamFetchBudget {
  private used = 0;

  constructor(private readonly limit = UPSTREAM_FETCH_LIMIT) {}

  consume(): void {
    this.used += 1;
    if (this.used > this.limit) {
      throw new GitHubApiError(
        "service-rate-limited",
        "This question needed more repository lookups than Wayfinder allows for a single request. Ask a narrower question.",
        429,
      );
    }
  }
}

// GITHUB_TOKEN must be a fine-grained token limited to public read access.
// Classic tokens expose their scopes on any API response; a token carrying
// the "repo" scope can read private repositories through this Worker, so it
// is never attached. Fine-grained tokens expose no scope header and cannot be
// introspected here, so their permissions are the operator's responsibility.
let tokenScopeCheck: { token: string; approved: Promise<boolean> } | null = null;

async function classicTokenGrantsPrivateAccess(token: string, fetcher: typeof fetch): Promise<boolean> {
  const response = await fetcher("https://api.github.com/user", {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "wayfinder-build-week",
      "X-GitHub-Api-Version": "2022-11-28",
      Authorization: "Bearer " + token,
    },
    signal: AbortSignal.timeout(5_000),
  });
  const scopes = response.headers.get("x-oauth-scopes");
  if (scopes === null) return false;
  return scopes.split(",").map((scope) => scope.trim()).includes("repo");
}

export function resetTokenScopeCheckForTests(): void {
  tokenScopeCheck = null;
}

export async function publicReadOnlyToken(
  token: string | undefined,
  fetcher: typeof fetch = fetch,
): Promise<string | undefined> {
  const trimmed = token?.trim();
  if (!trimmed) return undefined;
  if (tokenScopeCheck?.token !== trimmed) {
    const approved = classicTokenGrantsPrivateAccess(trimmed, fetcher).then((privateAccess) => {
      if (privateAccess) {
        console.error(JSON.stringify({
          event: "github-token-rejected",
          reason: "The configured GITHUB_TOKEN carries the classic \"repo\" scope, which can read private repositories. Replace it with a fine-grained public-read-only token.",
        }));
      }
      return !privateAccess;
    });
    tokenScopeCheck = { token: trimmed, approved };
  }
  const approved = await tokenScopeCheck.approved.catch(() => {
    // An unreachable scope check must not take the service down; retry on the
    // next request instead of caching the failure.
    tokenScopeCheck = null;
    return true;
  });
  return approved ? trimmed : undefined;
}

export function describeGitHubFailure(
  status: number,
  remaining: string | null,
  reset: string | null,
  responseMessage = "",
  authenticated = false,
): {
  code: WayfinderErrorCode;
  message: string;
  resetAt?: string;
} {
  const resetSeconds = reset ? Number(reset) : Number.NaN;
  const resetAt = Number.isFinite(resetSeconds) ? new Date(resetSeconds * 1_000).toISOString() : undefined;

  const rateLimited = status === 429 || (
    status === 403 && (remaining === "0" || /(?:rate limit|abuse detection)/i.test(responseMessage))
  );
  if (rateLimited) {
    return {
      code: "github-rate-limited",
      message: "GitHub's public API limit has been reached. Cached guides still work while the limit resets.",
      ...(resetAt ? { resetAt } : {}),
    };
  }
  if (status === 404) {
    return {
      code: "repository-unavailable",
      message: "This repository was not found or is private. Free mode currently reads public repositories only.",
    };
  }
  if (status === 409) {
    return {
      code: "repository-unavailable",
      message: "This repository is empty, so there is no commit to map yet.",
    };
  }
  if (status === 422) {
    return {
      code: "repository-unavailable",
      message: "The requested branch, tag, or commit was not found in this repository.",
    };
  }
  if (status === 401) {
    return {
      code: "github-auth-failed",
      message: "GitHub declined the configured token. Remove it or replace it with a valid token.",
    };
  }
  if (status === 403 && authenticated) {
    return {
      code: "github-auth-failed",
      message: "GitHub declined the configured token for this repository. Check its validity and repository permissions.",
    };
  }
  if (status === 403) {
    return {
      code: "repository-unavailable",
      message: "GitHub refused access to this repository. It may be private or unavailable to public API requests.",
    };
  }
  return {
    code: "upstream-unavailable",
    message: "GitHub could not complete the repository request. Try the survey again shortly.",
  };
}

export function isBlockingGitHubError(error: unknown): boolean {
  return error instanceof GitHubApiError && error.status !== 404;
}

// GitHub's response shapes are validated instead of trusted: a malformed or
// truncated upstream body becomes a typed upstream-unavailable failure rather
// than an uncaught exception surfacing as a raw 500.
const repoResponseSchema = z.object({
  default_branch: z.string().min(1),
  description: z.string().nullable().catch(null),
  homepage: z.string().nullable().catch(null),
  language: z.string().nullable().catch(null),
  stargazers_count: z.number().int().nonnegative().catch(0),
});

const treeResponseSchema = z.object({
  sha: z.string().min(1),
  truncated: z.boolean().catch(false),
  tree: z.array(z.object({
    path: z.string(),
    type: z.string(),
    size: z.number().int().nonnegative().optional().catch(undefined),
  })).catch([]),
});

const commitResponseSchema = z.object({
  sha: z.string().regex(/^[a-f0-9]{7,64}$/i),
});

const fileContentResponseSchema = z.object({
  content: z.string(),
  encoding: z.string(),
  size: z.number().int().nonnegative().catch(0),
});

const readmeResponseSchema = z.object({
  content: z.string(),
  encoding: z.string(),
});

type GitHubRepoResponse = z.infer<typeof repoResponseSchema>;
type GitHubTreeResponse = z.infer<typeof treeResponseSchema>;

function parseUpstream<Schema extends z.ZodTypeAny>(schema: Schema, body: unknown, resource: string): z.infer<Schema> {
  const result = schema.safeParse(body);
  if (result.success) return result.data;
  throw new GitHubApiError(
    "upstream-unavailable",
    "GitHub returned an unexpected " + resource + " response. Try the survey again shortly.",
    502,
  );
}

const ignoredSegments = new Set([
  ".git",
  ".next",
  ".output",
  ".turbo",
  ".wxt",
  "build",
  "coverage",
  "dist",
  "generated",
  "node_modules",
  "vendor",
]);

const ignoredFiles = new Set([
  "bun.lockb",
  "composer.lock",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
]);

const setupFileNames = new Set([
  ".env.example",
  ".env.sample",
  ".node-version",
  ".nvmrc",
  ".python-version",
  ".tool-versions",
  "bun.lock",
  "bun.lockb",
  "cargo.toml",
  "composer.json",
  "composer.lock",
  "deno.json",
  "deno.jsonc",
  "docker-compose.yml",
  "docker-compose.yaml",
  "dockerfile",
  "go.mod",
  "justfile",
  "makefile",
  "mise.toml",
  "package-lock.json",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "poetry.lock",
  "pyproject.toml",
  "requirements-dev.txt",
  "requirements.txt",
  "rust-toolchain",
  "rust-toolchain.toml",
  "uv.lock",
  "yarn.lock",
]);

const binaryExtensions = new Set([
  "7z",
  "aab",
  "apk",
  "avif",
  "bmp",
  "class",
  "dmg",
  "eot",
  "gif",
  "gz",
  "ico",
  "jar",
  "jpeg",
  "jpg",
  "mov",
  "mp3",
  "mp4",
  "otf",
  "pdf",
  "png",
  "so",
  "tar",
  "ttf",
  "webm",
  "webp",
  "woff",
  "woff2",
  "zip",
]);

export function shouldIncludePath(path: string, type: "blob" | "tree"): boolean {
  const segments = path.split("/");
  if (segments.some((segment) => ignoredSegments.has(segment))) return false;
  if (type === "tree") return true;

  const fileName = segments.at(-1) ?? "";
  if (ignoredFiles.has(fileName)) return false;

  const extension = fileName.includes(".") ? fileName.split(".").at(-1)?.toLowerCase() : null;
  return !extension || !binaryExtensions.has(extension);
}

export function filterTree(entries: GitHubTreeResponse["tree"]): RepoTreeEntry[] {
  return entries
    .filter((entry): entry is GitHubTreeResponse["tree"][number] & { type: "blob" | "tree" } =>
      (entry.type === "blob" || entry.type === "tree") && shouldIncludePath(entry.path, entry.type),
    )
    .map(({ path, type, size }) => ({ path, type, ...(size === undefined ? {} : { size }) }));
}

export function dedupeTree(entries: RepoTreeEntry[]): RepoTreeEntry[] {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    if (seen.has(entry.path)) return false;
    seen.add(entry.path);
    return true;
  });
}

export function compactTree(entries: RepoTreeEntry[], limit = 4_000): RepoTreeEntry[] {
  if (entries.length <= limit) return entries;

  const landmark = /(^|\/)(readme([^/]*)?|package\.json|pyproject\.toml|go\.mod|cargo\.toml|tsconfig\.json|(index|main|app|client|server|core)\.(tsx?|jsx?|py|go|rs))$/i;
  const ranked = entries
    .map((entry, index) => ({
      entry,
      index,
      priority: entry.path.includes("/") ? (landmark.test(entry.path) ? 1 : 2) : 0,
      depth: entry.path.split("/").length,
    }))
    .sort((left, right) =>
      left.priority - right.priority || left.depth - right.depth || left.index - right.index,
    );

  return ranked.slice(0, limit).map(({ entry }) => entry);
}

export function collectSetupFiles(entries: GitHubTreeResponse["tree"]): string[] {
  return entries
    .filter((entry) => entry.type === "blob")
    .map((entry) => entry.path)
    .filter((path) => {
      const lowerPath = path.toLowerCase();
      const fileName = lowerPath.split("/").at(-1) ?? "";
      return setupFileNames.has(fileName) ||
        /(^|\/)(readme|contributing|install|installation|setup|getting-started)(\.[^/]*)?\.md$/i.test(lowerPath) ||
        /(^|\/)docs\/(install|installation|setup|getting-started)(\.[^/]*)?\.md$/i.test(lowerPath);
    })
    .sort((left, right) =>
      left.split("/").length - right.split("/").length || left.localeCompare(right),
    )
    .slice(0, 200);
}

function decodeBase64(value: string): string {
  const compact = value.replace(/\s/g, "");
  const bytes = Uint8Array.from(atob(compact), (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

interface GitHubRequestRuntime {
  fetcher?: typeof fetch;
  timeoutMs?: number;
  budget?: UpstreamFetchBudget;
}

const mutableGitHubCacheSeconds = 5 * 60;
const immutableGitHubCacheSeconds = 24 * 60 * 60;

export function githubCacheTtl(path: string): number {
  const ref = new URL("https://api.github.com" + path).searchParams.get("ref");
  const commitAddressedPath = /\/(?:git\/trees|commits)\/[a-f0-9]{40}(?:\?|$)/i.test(path);
  return (ref && /^[a-f0-9]{40}$/i.test(ref)) || commitAddressedPath
    ? immutableGitHubCacheSeconds
    : mutableGitHubCacheSeconds;
}

export async function githubFetch<T>(
  path: string,
  token?: string,
  runtime: GitHubRequestRuntime = {},
): Promise<T> {
  runtime.budget?.consume();
  const url = "https://api.github.com" + path;
  let response: Response;
  try {
    response = await (runtime.fetcher ?? fetch)(url, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "wayfinder-build-week",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(token ? { Authorization: "Bearer " + token } : {}),
      },
      signal: AbortSignal.timeout(runtime.timeoutMs ?? 12_000),
      ...(token
        ? { cache: "no-store" as const }
        : {
            cf: {
              // cacheTtlByStatus is honored on the Enterprise plan and
              // ignored elsewhere, where requests simply pass through
              // uncached. Negative TTLs mark error responses as uncacheable
              // so a transient GitHub failure is never served from the edge.
              cacheEverything: true,
              cacheTtlByStatus: {
                "200-299": githubCacheTtl(path),
                "300-399": 0,
                "400-499": -1,
                "500-599": -1,
              },
            },
          }),
    });
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === "TimeoutError";
    throw new GitHubApiError(
      "upstream-unavailable",
      timedOut
        ? "GitHub did not respond before the repository request timed out. Try again shortly."
        : "GitHub could not be reached for the repository request. Try again shortly.",
      504,
    );
  }

  if (!response.ok) {
    const responseBody = await response.clone().json().catch(() => null) as { message?: unknown } | null;
    const failure = describeGitHubFailure(
      response.status,
      response.headers.get("x-ratelimit-remaining"),
      response.headers.get("x-ratelimit-reset"),
      typeof responseBody?.message === "string" ? responseBody.message : "",
      Boolean(token),
    );
    throw new GitHubApiError(failure.code, failure.message, response.status, failure.resetAt);
  }

  return (await response.json()) as T;
}

export async function fetchRepoFile(
  repo: string,
  path: string,
  ref: string,
  token?: string,
  budget?: UpstreamFetchBudget,
): Promise<string> {
  const [owner, name] = repo.split("/");
  if (!owner || !name) throw new Error("Repository name must use owner/repo format.");

  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  const prefix = "/repos/" + encodeURIComponent(owner) + "/" + encodeURIComponent(name);
  const response = parseUpstream(fileContentResponseSchema, await githubFetch(
    prefix + "/contents/" + encodedPath + "?ref=" + encodeURIComponent(ref),
    token,
    { budget },
  ), "file-content");

  if (response.encoding !== "base64") throw new Error("GitHub returned an unsupported file encoding.");
  if (response.size > 1_000_000) throw new Error("Setup file is too large to inspect safely.");
  return decodeBase64(response.content).slice(0, 80_000);
}

// Mirrors the public API's repositoryPathSchema so /map output always
// satisfies what downstream endpoints will accept back.
export function isNormalizedRepositoryPath(path: string): boolean {
  return path.length >= 1 &&
    path.length <= 1_000 &&
    !path.startsWith("/") &&
    !/[\u0000-\u001f\u007f]/.test(path) &&
    path.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

export async function createRepoMap(
  owner: string,
  repo: string,
  requestedRef?: string | null,
  token?: string,
  budget?: UpstreamFetchBudget,
): Promise<RepoMap> {
  const prefix = "/repos/" + encodeURIComponent(owner) + "/" + encodeURIComponent(repo);
  const metadata = parseUpstream(repoResponseSchema, await githubFetch(prefix, token, { budget }), "repository");
  const resolvedRef = requestedRef?.trim() || metadata.default_branch;
  const commit = parseUpstream(
    commitResponseSchema,
    await githubFetch(prefix + "/commits/" + encodeURIComponent(resolvedRef), token, { budget }),
    "commit",
  );
  const pinnedRef = commit.sha;

  const [tree, readme] = await Promise.all([
    githubFetch(prefix + "/git/trees/" + encodeURIComponent(pinnedRef) + "?recursive=1", token, { budget })
      .then((body) => parseUpstream(treeResponseSchema, body, "tree")),
    githubFetch(prefix + "/readme?ref=" + encodeURIComponent(pinnedRef), token, { budget })
      .then((body) => parseUpstream(readmeResponseSchema, body, "readme"))
      .catch((error) => {
        if (error instanceof GitHubApiError && error.code === "repository-unavailable") return null;
        throw error;
      }),
  ]);

  const rootTree = tree.truncated || tree.tree.length > 4_000
    ? parseUpstream(
        treeResponseSchema,
        await githubFetch(prefix + "/git/trees/" + encodeURIComponent(pinnedRef), token, { budget }),
        "tree",
      )
    : null;
  // Paths that would fail the public API's own request validation (control
  // characters, dot segments, over-long) never enter the map, so /map output
  // always round-trips through /tour, /find, and /agent.
  const conformingEntries = [...(rootTree?.tree ?? []), ...tree.tree]
    .filter((entry) => isNormalizedRepositoryPath(entry.path));
  const filteredTree = compactTree(dedupeTree(filterTree(conformingEntries)));
  const setupFiles = collectSetupFiles(conformingEntries);

  return {
    repo: owner + "/" + repo,
    sha: commit.sha,
    requestedRef: requestedRef?.trim() || null,
    resolvedRef,
    defaultBranch: metadata.default_branch.slice(0, 255),
    description: metadata.description?.slice(0, 500) ?? null,
    homepage: metadata.homepage?.slice(0, 2_048) ?? null,
    language: metadata.language?.slice(0, 100) ?? null,
    stars: metadata.stargazers_count,
    readme: readme?.encoding === "base64" ? decodeBase64(readme.content).slice(0, 16_000) : null,
    tree: filteredTree,
    setupFiles,
    truncated: tree.truncated || tree.tree.length > 4_000,
    generatedAt: new Date().toISOString(),
  };
}
