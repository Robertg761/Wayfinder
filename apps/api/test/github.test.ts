import { afterEach, describe, expect, it, vi } from "vitest";
import {
  collectSetupFiles,
  compactTree,
  createRepoMap,
  dedupeTree,
  describeGitHubFailure,
  filterTree,
  githubCacheTtl,
  githubFetch,
  GitHubApiError,
  isBlockingGitHubError,
  publicReadOnlyToken,
  resetTokenScopeCheckForTests,
  shouldIncludePath,
  UpstreamFetchBudget,
} from "../src/github";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("repository tree filtering", () => {
  it("keeps source files and useful project metadata", () => {
    expect(shouldIncludePath("src/index.ts", "blob")).toBe(true);
    expect(shouldIncludePath("package.json", "blob")).toBe(true);
    expect(shouldIncludePath("docs", "tree")).toBe(true);
  });

  it("drops generated, dependency, lock, and binary entries", () => {
    expect(shouldIncludePath("node_modules/react/index.js", "blob")).toBe(false);
    expect(shouldIncludePath("dist/index.js", "blob")).toBe(false);
    expect(shouldIncludePath("pnpm-lock.yaml", "blob")).toBe(false);
    expect(shouldIncludePath("assets/hero.png", "blob")).toBe(false);
  });

  it("preserves a compact serializable tree", () => {
    expect(
      filterTree([
        { path: "src", type: "tree" },
        { path: "src/index.ts", type: "blob", size: 42 },
        { path: "node_modules/x.js", type: "blob", size: 90 },
        { path: "submodule", type: "commit" },
      ]),
    ).toEqual([
      { path: "src", type: "tree" },
      { path: "src/index.ts", type: "blob", size: 42 },
    ]);
  });

  it("keeps one copy when the root tree overlaps a truncated recursive tree", () => {
    expect(dedupeTree([
      { path: "README.md", type: "blob", size: 100 },
      { path: "src", type: "tree" },
      { path: "README.md", type: "blob", size: 100 },
      { path: "src/index.ts", type: "blob", size: 200 },
    ])).toEqual([
      { path: "README.md", type: "blob", size: 100 },
      { path: "src", type: "tree" },
      { path: "src/index.ts", type: "blob", size: 200 },
    ]);
  });

  it("preserves root files and late architectural landmarks when compacting", () => {
    const filler = Array.from({ length: 10 }, (_, index) => ({
      path: "examples/fixture-" + index + ".txt",
      type: "blob" as const,
    }));

    expect(compactTree([
      ...filler,
      { path: "package.json", type: "blob" },
      { path: "packages/core/src/index.ts", type: "blob" },
    ], 3).map((entry) => entry.path)).toEqual([
      "package.json",
      "packages/core/src/index.ts",
      "examples/fixture-0.txt",
    ]);
  });

  it("keeps setup evidence even when general mapping drops lockfiles", () => {
    expect(collectSetupFiles([
      { path: "pnpm-lock.yaml", type: "blob" },
      { path: ".node-version", type: "blob" },
      { path: "docs/setup.md", type: "blob" },
      { path: "src/index.ts", type: "blob" },
    ])).toEqual([".node-version", "pnpm-lock.yaml", "docs/setup.md"]);
  });

  it("distinguishes rate limits from private or missing repositories", () => {
    expect(describeGitHubFailure(403, "0", "1783987200")).toMatchObject({
      code: "github-rate-limited",
      resetAt: "2026-07-14T00:00:00.000Z",
    });
    expect(describeGitHubFailure(404, null, null)).toMatchObject({
      code: "repository-unavailable",
    });
    expect(describeGitHubFailure(403, "45", null)).toMatchObject({
      code: "repository-unavailable",
    });
    expect(describeGitHubFailure(403, "45", null, "You have exceeded a secondary rate limit.")).toMatchObject({
      code: "github-rate-limited",
    });
    expect(describeGitHubFailure(403, "45", null, "Resource not accessible", true)).toMatchObject({
      code: "github-auth-failed",
    });
    expect(isBlockingGitHubError(new GitHubApiError("repository-unavailable", "missing", 404))).toBe(false);
    expect(isBlockingGitHubError(new GitHubApiError("repository-unavailable", "forbidden", 403))).toBe(true);
  });
});

describe("GitHub response caching", () => {
  it("uses a short TTL for mutable routes and a long TTL for commit-addressed files", () => {
    expect(githubCacheTtl("/repos/openai/openai-node")).toBe(300);
    expect(githubCacheTtl("/repos/openai/openai-node/contents/src/index.ts?ref=main")).toBe(300);
    expect(githubCacheTtl("/repos/openai/openai-node/contents/src/index.ts?ref=" + "a".repeat(40))).toBe(86_400);
    expect(githubCacheTtl("/repos/openai/openai-node/git/trees/" + "a".repeat(40) + "?recursive=1")).toBe(86_400);
  });

  it("configures unauthenticated GitHub requests for edge caching", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ default_branch: "main" }));

    await expect(githubFetch("/repos/openai/openai-node", undefined, { fetcher }))
      .resolves.toEqual({ default_branch: "main" });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      cf: {
        cacheEverything: true,
        cacheTtlByStatus: {
          "200-299": 300,
          "400-499": 0,
          "500-599": 0,
        },
      },
    });
  });

  it("bypasses shared caching whenever a GitHub token is configured", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ ok: true }));

    await githubFetch("/repos/openai/openai-node", "secret-token", { fetcher });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      cache: "no-store",
      headers: { Authorization: "Bearer secret-token" },
    });
    expect(fetcher.mock.calls[0]?.[1]).not.toHaveProperty("cf");
  });

  it("bounds stalled upstream requests and returns a typed availability error", async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new DOMException("timed out", "TimeoutError"));

    await expect(githubFetch("/repos/openai/openai-node", undefined, { fetcher, timeoutMs: 25 }))
      .rejects.toMatchObject({ code: "upstream-unavailable", status: 504 });
    expect(fetcher.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });
});

describe("repository map partial failures", () => {
  it("maps the requested branch instead of silently using the default branch", async () => {
    const requestedUrls: string[] = [];
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = String(input);
      requestedUrls.push(url);
      if (url.endsWith("/repos/openai/openai-node")) {
        return Response.json({
          default_branch: "main",
          description: "SDK",
          homepage: null,
          language: "TypeScript",
          stargazers_count: 1,
        });
      }
      if (url.includes("/git/trees/" + "c".repeat(40))) {
        return Response.json({ sha: "b".repeat(40), truncated: false, tree: [{ path: "src/feature.ts", type: "blob" }] });
      }
      if (url.endsWith("/commits/feature%2Fnavigation")) {
        return Response.json({ sha: "c".repeat(40) });
      }
      if (url.endsWith("/readme?ref=" + "c".repeat(40))) {
        return Response.json({ content: btoa("# Feature"), encoding: "base64" });
      }
      return Response.json({ message: "not found" }, { status: 404 });
    });
    vi.stubGlobal("fetch", fetcher);

    await expect(createRepoMap("openai", "openai-node", "feature/navigation")).resolves.toMatchObject({
      requestedRef: "feature/navigation",
      resolvedRef: "feature/navigation",
      defaultBranch: "main",
      sha: "c".repeat(40),
    });
    expect(requestedUrls.some((url) => url.includes("/git/trees/feature%2Fnavigation"))).toBe(false);
    expect(requestedUrls.some((url) => url.endsWith("/readme?ref=feature%2Fnavigation"))).toBe(false);
  });

  it("propagates a README rate limit instead of returning a degraded map", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/repos/openai/openai-node")) {
        return Response.json({
          default_branch: "main",
          description: null,
          homepage: null,
          language: "TypeScript",
          stargazers_count: 1,
        });
      }
      if (url.includes("/git/trees/")) {
        return Response.json({ sha: "a".repeat(40), truncated: false, tree: [] });
      }
      if (url.endsWith("/commits/main")) return Response.json({ sha: "a".repeat(40) });
      return Response.json({ message: "rate limited" }, {
        status: 429,
        headers: { "x-ratelimit-reset": "1784030400" },
      });
    });
    vi.stubGlobal("fetch", fetcher);

    await expect(createRepoMap("openai", "openai-node"))
      .rejects.toMatchObject({ code: "github-rate-limited", status: 429 });
  });
});

describe("upstream fetch budget", () => {
  it("caps the number of GitHub lookups a single request may trigger", async () => {
    const budget = new UpstreamFetchBudget(2);
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetcher);

    await githubFetch("/repos/a/b", undefined, { budget });
    await githubFetch("/repos/a/b", undefined, { budget });
    await expect(githubFetch("/repos/a/b", undefined, { budget }))
      .rejects.toMatchObject({ code: "service-rate-limited", status: 429 });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("does not limit requests that carry no budget", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetcher);

    for (let index = 0; index < 45; index += 1) {
      await githubFetch("/repos/a/b");
    }
    expect(fetcher).toHaveBeenCalledTimes(45);
  });
});

describe("public read-only token guard", () => {
  afterEach(() => {
    resetTokenScopeCheckForTests();
  });

  function userEndpoint(scopes: string | null): typeof fetch {
    return vi.fn<typeof fetch>().mockImplementation(async (input) => {
      expect(String(input)).toBe("https://api.github.com/user");
      return new Response("{}", {
        status: 200,
        headers: scopes === null ? {} : { "x-oauth-scopes": scopes },
      });
    }) as unknown as typeof fetch;
  }

  it("refuses a classic token that can read private repositories", async () => {
    await expect(publicReadOnlyToken("classic-token", userEndpoint("repo, read:user"))).resolves.toBeUndefined();
  });

  it("allows a classic token without the private-repo scope", async () => {
    await expect(publicReadOnlyToken("classic-token", userEndpoint("public_repo"))).resolves.toBe("classic-token");
  });

  it("allows a fine-grained token, whose scopes are not introspectable", async () => {
    await expect(publicReadOnlyToken("github_pat_x", userEndpoint(null))).resolves.toBe("github_pat_x");
  });

  it("passes through an absent token without calling GitHub", async () => {
    const fetcher = vi.fn() as unknown as typeof fetch;
    await expect(publicReadOnlyToken(undefined, fetcher)).resolves.toBeUndefined();
    await expect(publicReadOnlyToken("   ", fetcher)).resolves.toBeUndefined();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("checks a given token only once per isolate", async () => {
    const fetcher = userEndpoint("");
    await publicReadOnlyToken("classic-token", fetcher);
    await publicReadOnlyToken("classic-token", fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("fails open when the scope check itself is unavailable", async () => {
    const failing = vi.fn<typeof fetch>().mockRejectedValue(new Error("network down")) as unknown as typeof fetch;
    await expect(publicReadOnlyToken("classic-token", failing)).resolves.toBe("classic-token");
    // The failed check is not cached; the next request re-verifies.
    const succeeding = userEndpoint("repo");
    await expect(publicReadOnlyToken("classic-token", succeeding)).resolves.toBeUndefined();
  });
});
