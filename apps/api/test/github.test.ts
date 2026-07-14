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
  shouldIncludePath,
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
      code: "github-rate-limited",
    });
  });
});

describe("GitHub response caching", () => {
  it("uses a short TTL for mutable routes and a long TTL for commit-addressed files", () => {
    expect(githubCacheTtl("/repos/openai/openai-node")).toBe(300);
    expect(githubCacheTtl("/repos/openai/openai-node/contents/src/index.ts?ref=main")).toBe(300);
    expect(githubCacheTtl("/repos/openai/openai-node/contents/src/index.ts?ref=" + "a".repeat(40))).toBe(86_400);
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
});

describe("repository map partial failures", () => {
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
