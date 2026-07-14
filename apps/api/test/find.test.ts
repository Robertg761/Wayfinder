import type { RepoMap } from "@wayfinder/contracts";
import { describe, expect, it } from "vitest";
import { findFiles, rankFileCandidates } from "../src/find";

const map: RepoMap = {
  repo: "example/trail",
  sha: "abc1234567890",
  defaultBranch: "main",
  description: "A test repository.",
  homepage: null,
  language: "TypeScript",
  stars: 1,
  readme: null,
  setupFiles: ["package.json"],
  truncated: false,
  generatedAt: "2026-07-13T00:00:00.000Z",
  tree: [
    { path: "README.md", type: "blob", size: 400 },
    { path: "src", type: "tree" },
    { path: "src/auth", type: "tree" },
    { path: "src/auth/session.ts", type: "blob", size: 2_000 },
    { path: "src/router.ts", type: "blob", size: 3_000 },
    { path: "src/config.ts", type: "blob", size: 1_000 },
    { path: "src/pagination.ts", type: "blob", size: 100 },
    { path: "src/core/pagination.ts", type: "blob", size: 8_000 },
    { path: "src/features/payments/handler.ts", type: "blob", size: 2_000 },
    { path: "tests", type: "tree" },
    { path: "tests/auth.test.ts", type: "blob", size: 2_000 },
  ],
};

describe("rankFileCandidates", () => {
  it("expands common aliases when ranking repository paths", () => {
    const results = rankFileCandidates(map, "where is authentication handled");
    expect(results[0].entry.path).toBe("src/auth/session.ts");
    expect(results[0].signals).toContain("alias");
  });

  it("prioritizes test files when the user asks for tests", () => {
    const results = rankFileCandidates(map, "where are the authentication tests");
    expect(results[0].entry.path).toBe("tests/auth.test.ts");
    expect(results[0].signals).toContain("test-pair");
  });

  it("uses the current directory as a contextual signal", () => {
    const results = rankFileCandidates(map, "find the handler", "src/features/payments/checkout.ts");
    expect(results[0].entry.path).toBe("src/features/payments/handler.ts");
    expect(results[0].signals).toContain("current-directory");
  });
});

describe("findFiles", () => {
  it("adds source-content and symbol evidence", () => {
    const response = findFiles(map, "where is routing handled", {
      "src/router.ts": "export class Router {\n  route(request: Request) {}\n}",
    });

    expect(response.results[0]).toEqual(expect.objectContaining({
      path: "src/router.ts",
      confidence: "strong",
      signals: expect.arrayContaining(["alias", "content", "symbol"]),
      lines: expect.any(Array),
    }));
  });

  it("warns when a vague query has only structural suggestions", () => {
    const response = findFiles(map, "where is this handled");
    expect(response.warnings).toContain("The query did not contain a specific repository concept, so results rely on architectural landmarks.");
  });

  it("ranks the implementation above a deprecated re-export wrapper", () => {
    const response = findFiles(map, "where is pagination implemented", {
      "src/pagination.ts": "/** @deprecated Import from ./core/pagination instead */\nexport * from './core/pagination';",
      "src/core/pagination.ts": "export abstract class AbstractPage<Item> {\n  abstract getPaginatedItems(): Item[];\n}",
    });

    expect(response.results[0].path).toBe("src/core/pagination.ts");
    expect(response.results.find((result) => result.path === "src/pagination.ts")).toBeUndefined();
  });
});
