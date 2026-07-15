import { describe, expect, it } from "vitest";
import type { FileFindResponse } from "@wayfinder/contracts";
import { classifyAgentIntent, importedSpecifiers, keepGoalLinkedVerification, keepLikelyCallers } from "../src/agent";

describe("classifyAgentIntent", () => {
  it.each([
    ["How do I install and run this?", "installation"],
    ["How do I run the tests?", "installation"],
    ["What dependencies do I need?", "installation"],
    ["What does this repository do?", "orientation"],
    ["Tell me about this project", "orientation"],
    ["Where should I start?", "orientation"],
    ["Give me an architecture tour", "orientation"],
    ["Which file is the main implementation entry point?", "file-find"],
    ["Where are the tests?", "file-find"],
    ["Find the authentication implementation", "file-find"],
    ["What does pagination do?", "file-find"],
    ["configuration", "file-find"],
    ["Help me make my first contribution", "contribution"],
    ["I want to add pagination support", "contribution"],
    ["Help me fix the authentication bug", "contribution"],
  ] as const)("routes %s to %s", (query, intent) => {
    expect(classifyAgentIntent(query)).toBe(intent);
  });

  it("uses current-file context for dependency and paired-test questions", () => {
    expect(classifyAgentIntent("What does this file depend on?", "src/client.ts")).toBe("file-context");
    expect(classifyAgentIntent("Find the paired tests for this file", "src/client.ts")).toBe("file-context");
  });
});

describe("importedSpecifiers", () => {
  it("extracts static, side-effect, dynamic, and CommonJS imports", () => {
    const content = [
      "import { client } from './client';",
      "import './register';",
      "const lazy = import('../lazy');",
      "const config = require('./config');",
    ].join("\n");

    expect(importedSpecifiers(content)).toEqual(['./client', './register', '../lazy', './config']);
  });
});

describe("keepLikelyCallers", () => {
  it("keeps production candidates and drops the current file and non-production surfaces", () => {
    const finder: FileFindResponse = {
      repo: "example/trail",
      sha: "abc1234",
      query: "pagination import usage caller",
      currentPath: "src/pagination.ts",
      results: [
        { path: "src/pagination.ts", score: 1, confidence: "strong", reason: "Current file.", signals: ["filename"] },
        { path: "src/client.ts", score: 0.9, confidence: "strong", reason: "Production import.", signals: ["content"] },
        { path: "tests/pagination.test.ts", score: 0.8, confidence: "strong", reason: "Test.", signals: ["content"] },
        { path: "ecosystem-tests/example/index.ts", score: 0.7, confidence: "likely", reason: "Fixture.", signals: ["content"] },
      ],
      warnings: [],
      generatedAt: "2026-07-15T00:00:00.000Z",
    };

    expect(keepLikelyCallers(finder, "src/pagination.ts").results.map((result) => result.path)).toEqual(["src/client.ts"]);
  });
});

describe("keepGoalLinkedVerification", () => {
  const finder: FileFindResponse = {
    repo: "example/trail",
    sha: "abc1234",
    query: "pagination tests specs",
    currentPath: null,
    results: [
      { path: "ecosystem/browser/src/test.ts", score: 0.99, confidence: "strong", reason: "Generic test file.", signals: ["test-pair"] },
      { path: "tests/pagination.test.ts", score: 0.8, confidence: "strong", reason: "Goal-linked test file.", signals: ["filename", "test-pair"] },
    ],
    warnings: [],
    generatedAt: "2026-07-14T00:00:00.000Z",
  };

  it("removes unrelated generic tests from a contribution trail", () => {
    expect(keepGoalLinkedVerification(finder, "I want to add pagination support").results.map((result) => result.path))
      .toEqual(["tests/pagination.test.ts"]);
  });

  it("claims no verification coordinate when none matches the goal", () => {
    const filtered = keepGoalLinkedVerification({ ...finder, results: finder.results.slice(0, 1) }, "Fix pagination");
    expect(filtered.results).toEqual([]);
    expect(filtered.warnings.at(-1)).toContain("no verification coordinate was claimed");
  });

  it("matches a routing goal to route evidence without accepting generic app fixtures", () => {
    const routingFinder: FileFindResponse = {
      ...finder,
      results: [
        { path: "tests/test_apps/cliapp/app.py", score: 0.9, confidence: "strong", reason: "Generic app fixture.", signals: ["test-pair"], snippet: "testapp = Flask('testapp')" },
        { path: "tests/test_basic.py", score: 0.8, confidence: "strong", reason: "Runtime route test.", signals: ["test-pair", "content"], snippet: "@app.route('/users')" },
      ],
    };

    expect(keepGoalLinkedVerification(routingFinder, "Improve request routing").results.map((result) => result.path))
      .toEqual(["tests/test_basic.py"]);
  });
});
