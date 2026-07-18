import type { RepoMap, RepoTreeEntry, WayfinderErrorCode } from "@wayfinder/contracts";

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

interface GitHubRepoResponse {
  default_branch: string;
  description: string | null;
  homepage: string | null;
  language: string | null;
  stargazers_count: number;
}

interface GitHubTreeResponse {
  sha: string;
  truncated: boolean;
  tree: Array<{
    path: string;
    type: "blob" | "tree" | "commit";
    size?: number;
  }>;
}

interface GitHubCommitResponse {
  sha: string;
}

interface GitHubReadmeResponse {
  content: string;
  encoding: string;
}

interface GitHubContentResponse {
  content: string;
  encoding: string;
  size: number;
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
              cacheEverything: true,
              cacheTtlByStatus: {
                "200-299": githubCacheTtl(path),
                "300-399": 0,
                "400-499": 0,
                "500-599": 0,
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
): Promise<string> {
  const [owner, name] = repo.split("/");
  if (!owner || !name) throw new Error("Repository name must use owner/repo format.");

  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  const prefix = "/repos/" + encodeURIComponent(owner) + "/" + encodeURIComponent(name);
  const response = await githubFetch<GitHubContentResponse>(
    prefix + "/contents/" + encodedPath + "?ref=" + encodeURIComponent(ref),
    token,
  );

  if (response.encoding !== "base64") throw new Error("GitHub returned an unsupported file encoding.");
  if (response.size > 1_000_000) throw new Error("Setup file is too large to inspect safely.");
  return decodeBase64(response.content).slice(0, 80_000);
}

export async function createRepoMap(owner: string, repo: string, requestedRef?: string | null, token?: string): Promise<RepoMap> {
  const prefix = "/repos/" + encodeURIComponent(owner) + "/" + encodeURIComponent(repo);
  const metadata = await githubFetch<GitHubRepoResponse>(prefix, token);
  const resolvedRef = requestedRef?.trim() || metadata.default_branch;
  const commit = await githubFetch<GitHubCommitResponse>(prefix + "/commits/" + encodeURIComponent(resolvedRef), token);
  const pinnedRef = commit.sha;

  const [tree, readme] = await Promise.all([
    githubFetch<GitHubTreeResponse>(prefix + "/git/trees/" + encodeURIComponent(pinnedRef) + "?recursive=1", token),
    githubFetch<GitHubReadmeResponse>(prefix + "/readme?ref=" + encodeURIComponent(pinnedRef), token).catch((error) => {
      if (error instanceof GitHubApiError && error.code === "repository-unavailable") return null;
      throw error;
    }),
  ]);

  const rootTree = tree.truncated || tree.tree.length > 4_000
    ? await githubFetch<GitHubTreeResponse>(prefix + "/git/trees/" + encodeURIComponent(pinnedRef), token)
    : null;
  const filteredTree = compactTree(dedupeTree(filterTree([...(rootTree?.tree ?? []), ...tree.tree])));
  const setupFiles = collectSetupFiles([...(rootTree?.tree ?? []), ...tree.tree]);

  return {
    repo: owner + "/" + repo,
    sha: commit.sha,
    requestedRef: requestedRef?.trim() || null,
    resolvedRef,
    defaultBranch: metadata.default_branch,
    description: metadata.description,
    homepage: metadata.homepage,
    language: metadata.language,
    stars: metadata.stargazers_count,
    readme: readme?.encoding === "base64" ? decodeBase64(readme.content).slice(0, 16_000) : null,
    tree: filteredTree,
    setupFiles,
    truncated: tree.truncated || tree.tree.length > 4_000,
    generatedAt: new Date().toISOString(),
  };
}
