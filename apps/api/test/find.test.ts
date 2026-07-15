import type { RepoMap } from "@wayfinder/contracts";
import { describe, expect, it } from "vitest";
import { findFiles, rankFileCandidates } from "../src/find";

const map: RepoMap = {
  repo: "example/trail",
  sha: "abc1234567890",
  requestedRef: null,
  resolvedRef: "main",
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
    { path: "src/auth/login.go", type: "blob", size: 2_000 },
    { path: "src/auth/login_test.go", type: "blob", size: 2_000 },
    { path: "src/router.ts", type: "blob", size: 3_000 },
    { path: "src/framework/scaffold.ts", type: "blob", size: 3_000 },
    { path: "examples/router/index.ts", type: "blob", size: 3_000 },
    { path: "bench/router/index.ts", type: "blob", size: 3_000 },
    { path: "src/main.ts", type: "blob", size: 3_000 },
    { path: "src/cli/decompress.ts", type: "blob", size: 3_000 },
    { path: "src/config.ts", type: "blob", size: 1_000 },
    { path: ".github/ISSUE_TEMPLATE/authentication.md", type: "blob", size: 1_000 },
    { path: "src/pagination.ts", type: "blob", size: 100 },
    { path: "src/core/pagination.ts", type: "blob", size: 8_000 },
    { path: "src/features/payments/handler.ts", type: "blob", size: 2_000 },
    { path: "tests", type: "tree" },
    { path: "tests/auth.test.ts", type: "blob", size: 2_000 },
    { path: "tests/api-resources/audio/speech.test.ts", type: "blob", size: 2_000 },
    { path: "tests/test_basic.py", type: "blob", size: 20_000 },
    { path: "tests/conftest.py", type: "blob", size: 2_000 },
    { path: "tests/test_apps/cliapp/app.py", type: "blob", size: 2_000 },
    { path: "tests/type_check/typing_route.py", type: "blob", size: 2_000 },
    { path: "ecosystem-tests/browser/src/test.ts", type: "blob", size: 2_000 },
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
    expect(results[0].entry.path).toMatch(/auth|login/);
    expect(results[0].entry.path).toMatch(/test/);
    expect(results[0].signals).toContain("test-pair");
  });

  it("uses the feature term to rank a specific test above generic test filenames", () => {
    const results = rankFileCandidates(map, "speech tests specs");
    expect(results[0].entry.path).toBe("tests/api-resources/audio/speech.test.ts");
    expect(results.findIndex((result) => result.entry.path === "ecosystem-tests/browser/src/test.ts"))
      .toBeGreaterThan(0);
  });

  it("prefers behavioral tests over support fixtures for a routing goal", () => {
    const response = findFiles(map, "routing tests specs", {
      "tests/test_basic.py": "def test_route_matching():\n    @app.route('/users')\n    assert client.get('/users').status_code == 200",
      "tests/conftest.py": "from flask.globals import app_ctx as _app_ctx",
      "tests/test_apps/cliapp/app.py": "testapp = Flask('testapp')",
      "tests/type_check/typing_route.py": "@app.route('/str')\ndef hello() -> str: ...",
    });

    expect(response.results[0].path).toBe("tests/test_basic.py");
    expect(response.results.findIndex((result) => result.path === "tests/type_check/typing_route.py"))
      .not.toBe(0);
  });

  it("uses the current directory as a contextual signal", () => {
    const results = rankFileCandidates(map, "find the handler", "src/features/payments/checkout.ts");
    expect(results[0].entry.path).toBe("src/features/payments/handler.ts");
    expect(results[0].signals).toContain("current-directory");
  });

  it("expands framework routing vocabulary", () => {
    const results = rankFileCandidates(map, "where is routing implemented");
    expect(results.find((result) => result.entry.path === "src/framework/scaffold.ts")?.signals)
      .toContain("alias");
  });

  it("connects executable questions to main files", () => {
    const results = rankFileCandidates(map, "which file defines the command line executable");
    expect(results[0].entry.path).toBe("src/main.ts");
  });

  it("prefers source over tests for explicit implementation questions", () => {
    const results = rankFileCandidates(map, "where is authentication implemented");
    expect(results[0].entry.path).toBe("src/auth/session.ts");
    expect(results.findIndex((result) => result.entry.path === "tests/auth.test.ts"))
      .toBeGreaterThan(results.findIndex((result) => result.entry.path === "src/auth/session.ts"));
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

  it("excludes tests from implementation answers when source candidates exist", () => {
    const response = findFiles(map, "where is authentication handled", {
      "src/auth/session.ts": "export class Session { authenticate() {} }",
      "tests/auth.test.ts": "describe('authentication', () => { test('session', () => {}) })",
      ".github/ISSUE_TEMPLATE/authentication.md": "Describe where authentication should be implemented in a future change.",
      "examples/router/index.ts": "export function authenticationRouter() {}",
      "bench/router/index.ts": "export function benchmarkAuthenticationRouter() {}",
    });

    expect(response.results[0].path).toBe("src/auth/session.ts");
    expect(response.results.some((result) => result.path === "tests/auth.test.ts")).toBe(false);
    expect(response.results.some((result) => result.path.endsWith(".md"))).toBe(false);
    expect(response.results.some((result) => result.path.startsWith("examples/"))).toBe(false);
    expect(response.results.some((result) => result.path.startsWith("bench/"))).toBe(false);
  });

  it("recognizes language-specific test filename conventions", () => {
    const response = findFiles(map, "where is login handled", {
      "src/auth/login.go": "func Login() {}",
      "src/auth/login_test.go": "func TestLogin() {}",
    });

    expect(response.results[0].path).toBe("src/auth/login.go");
    expect(response.results.some((result) => result.path === "src/auth/login_test.go")).toBe(false);
  });

  it("returns only test-shaped paths for an explicit test query", () => {
    const response = findFiles(map, "speech tests specs", {
      "src/auth/session.ts": "export class Speech {}",
      "tests/api-resources/audio/speech.test.ts": "describe('resource speech', () => {})",
    });

    expect(response.results[0].path).toBe("tests/api-resources/audio/speech.test.ts");
    expect(response.results.every((result) => /test|spec|fixture/i.test(result.path))).toBe(true);
  });
});
