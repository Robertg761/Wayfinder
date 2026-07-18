import type { FileFindResponse, RepoMap } from "@wayfinder/contracts";
import { describe, expect, it, vi } from "vitest";
import {
  classifyFileContextFocus,
  classifyRepositoryFile,
  createFileContextAnswer,
  describeFileRole,
  fileHighlights,
  importedSpecifiers,
  resolveLocalImports,
  type FileContextRuntime,
} from "../src/file-context";

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
  setupFiles: ["package.json", "vite.config.ts"],
  truncated: false,
  generatedAt: "2026-07-16T00:00:00.000Z",
  tree: [
    { path: "README.md", type: "blob", size: 1_000 },
    { path: "package.json", type: "blob", size: 500 },
    { path: "vite.config.ts", type: "blob", size: 500 },
    { path: "src/client.ts", type: "blob", size: 2_000 },
    { path: "src/pagination.ts", type: "blob", size: 2_000 },
    { path: "src/consumer.ts", type: "blob", size: 2_000 },
    { path: "tests/pagination.test.ts", type: "blob", size: 2_000 },
    { path: "tests/unrelated.test.ts", type: "blob", size: 2_000 },
    { path: "data/catalog.json", type: "blob", size: 2_000 },
  ],
};

function finder(query: string, results: FileFindResponse["results"]): FileFindResponse {
  return {
    repo: map.repo,
    sha: map.sha,
    query,
    currentPath: "src/pagination.ts",
    results,
    warnings: [],
    generatedAt: "2026-07-16T00:00:00.000Z",
  };
}

describe("current-file action routing", () => {
  it.each([
    ["Summarize the role of README.md and its important public surface", "summary"],
    ["What does src/client.ts depend on and where should I read next?", "dependencies"],
    ["Which files likely import or call src/client.ts?", "callers"],
    ["Find the tests paired with src/client.ts", "tests"],
    ["If I change src/client.ts, what implementation and verification files should I inspect?", "impact"],
  ] as const)("routes %s to %s", (query, focus) => {
    expect(classifyFileContextFocus(query)).toBe(focus);
  });
});

describe("repository file kinds and roles", () => {
  it("distinguishes documentation, configuration, source, tests, and data", () => {
    expect(classifyRepositoryFile(map, "README.md")).toBe("documentation");
    expect(classifyRepositoryFile(map, "package.json")).toBe("configuration");
    expect(classifyRepositoryFile(map, "vite.config.ts")).toBe("configuration");
    expect(classifyRepositoryFile(map, "src/client.ts")).toBe("source");
    expect(classifyRepositoryFile(map, "tests/pagination.test.ts")).toBe("test");
    expect(classifyRepositoryFile(map, "data/catalog.json")).toBe("data");
  });

  it("describes known public documentation without pretending it is code", () => {
    expect(describeFileRole("README.md", "documentation")).toBe("Primary repository guide");
    expect(describeFileRole("SECURITY.md", "documentation")).toBe("Security policy");
  });
});

describe("language-aware explicit dependency extraction", () => {
  it("extracts JavaScript, Python, Go, Rust, and Ruby references", () => {
    expect(importedSpecifiers("import x from './client';\nrequire('../config')", "src/index.ts"))
      .toEqual(["./client", "../config"]);
    expect(importedSpecifiers("from .client import Client\nimport http.server", "src/api.py"))
      .toEqual([".client", "http.server"]);
    expect(importedSpecifiers('import (\n  "fmt"\n  "example/internal/api"\n)', "cmd/main.go"))
      .toEqual(["fmt", "example/internal/api"]);
    expect(importedSpecifiers("use crate::client::Client;\nmod config;", "src/lib.rs"))
      .toEqual(["crate::client::Client", "self::config"]);
    expect(importedSpecifiers("require_relative './client'", "lib/index.rb")).toEqual(["./client"]);
    expect(importedSpecifiers('{"description":"from ./not-an-import"}', "package.json")).toEqual([]);
  });

  it("resolves only explicit local paths present in the pinned tree", () => {
    expect(resolveLocalImports(map, "src/index.ts", ["./client", "external-package"]))
      .toEqual(["src/client.ts"]);
  });
});

describe("evidence-safe file answers", () => {
  it("summarizes README headings and never runs caller or test discovery", async () => {
    const findFiles = vi.fn();
    const answer = await createFileContextAnswer(
      map,
      "Summarize the role of README.md and its important public surface",
      "README.md",
      undefined,
      {
        fetchFile: async () => "# HA Desktop Widget\n\nA desktop controller.\n\n## Features\n\n## Installation\n",
        findFiles: findFiles as unknown as NonNullable<FileContextRuntime["findFiles"]>,
      },
    );

    expect(answer).toMatchObject({
      focus: "summary",
      fileKind: "documentation",
      fileRole: "Primary repository guide",
      highlights: ["HA Desktop Widget", "Features", "Installation"],
      callers: { results: [] },
      tests: { results: [] },
    });
    expect(answer.summary).toBe("README.md is the primary repository guide for “HA Desktop Widget”.");
    expect(answer.summary).not.toMatch(/import|caller|test/i);
    expect(findFiles).not.toHaveBeenCalled();
  });

  it("declines source-graph claims when callers are requested for documentation", async () => {
    const findFiles = vi.fn();
    const answer = await createFileContextAnswer(
      map,
      "Which files likely import or call README.md?",
      "README.md",
      undefined,
      {
        fetchFile: async () => "# HA Desktop Widget",
        findFiles: findFiles as unknown as NonNullable<FileContextRuntime["findFiles"]>,
      },
    );

    expect(answer.focus).toBe("callers");
    expect(answer.callers.results).toEqual([]);
    expect(answer.summary).toContain("not an executable source module");
    expect(answer.warnings).toContain("Non-source files are not forced through the source caller/test graph.");
    expect(findFiles).not.toHaveBeenCalled();
  });

  it("drops possible, current-file, test, and fixture caller guesses", async () => {
    const findFiles = vi.fn()
      .mockResolvedValueOnce(finder("pagination import usage caller", [
        { path: "src/pagination.ts", score: 0.99, confidence: "strong", reason: "Current file", signals: ["filename"] },
        { path: "src/client.ts", score: 0.4, confidence: "possible", reason: "Weak guess", signals: ["architecture"] },
        { path: "src/consumer.ts", score: 0.9, confidence: "strong", reason: "Imports pagination", signals: ["content"] },
        { path: "tests/pagination.test.ts", score: 0.9, confidence: "strong", reason: "Test", signals: ["content"] },
      ]))
      .mockResolvedValueOnce(finder("pagination paired tests specs", [
        { path: "tests/unrelated.test.ts", score: 0.4, confidence: "possible", reason: "Weak guess", signals: ["test-pair"] },
        { path: "tests/pagination.test.ts", score: 0.8, confidence: "likely", reason: "Paired path", signals: ["filename", "test-pair"] },
      ]));

    const answer = await createFileContextAnswer(
      map,
      "If I change src/pagination.ts, what implementation and verification files should I inspect?",
      "src/pagination.ts",
      undefined,
      {
        fetchFile: async () => "export class Pagination {}",
        findFiles: findFiles as unknown as NonNullable<FileContextRuntime["findFiles"]>,
      },
    );

    expect(answer.callers.results.map((result) => result.path)).toEqual(["src/consumer.ts"]);
    expect(answer.tests.results.map((result) => result.path)).toEqual(["tests/pagination.test.ts"]);
    expect(answer.summary).toContain("1 caller candidate");
    expect(answer.summary).toContain("1 paired test candidate");
  });

  it("fails closed when file contents cannot be inspected", async () => {
    const answer = await createFileContextAnswer(map, "Summarize this file", "README.md", undefined, {
      fetchFile: async () => { throw new Error("unavailable"); },
    });

    expect(answer.contentAvailable).toBe(false);
    expect(answer.summary).toContain("contents could not be inspected");
    expect(answer.warnings).toContain("The current file could not be inspected, so Wayfinder did not infer imports or relationships.");
  });

  it("extracts a bounded README outline instead of treating headings as imports", () => {
    expect(fileHighlights("README.md", "documentation", "# Project\n## Install\n## Usage"))
      .toEqual(["Project", "Install", "Usage"]);
  });

  it("does not promote a level-two README heading into a missing document title", async () => {
    const answer = await createFileContextAnswer(map, "Summarize this file", "README.md", undefined, {
      fetchFile: async () => "Introductory text.\n\n## Installation\n",
    });

    expect(answer.summary).toBe("README.md is the primary repository guide.");
    expect(answer.highlights).toEqual(["Installation"]);
  });

  it("uses a tokenized distinctive term for camel-case relationship searches", async () => {
    const camelMap: RepoMap = {
      ...map,
      tree: [...map.tree, { path: "src/profileSync.ts", type: "blob", size: 2_000 }],
    };
    const findFiles = vi.fn().mockResolvedValue(finder("profile import usage caller", []));

    await createFileContextAnswer(
      camelMap,
      "Which files likely import or call src/profileSync.ts?",
      "src/profileSync.ts",
      undefined,
      {
        fetchFile: async () => "export function syncProfile() {}",
        findFiles: findFiles as unknown as NonNullable<FileContextRuntime["findFiles"]>,
      },
    );

    expect(findFiles).toHaveBeenCalledWith(
      camelMap,
      "profile import usage caller",
      "src/profileSync.ts",
      undefined,
      {
        requiredEvidenceTerms: ["profile"],
        requireInspectedContentEvidence: true,
        minimumConfidence: "likely",
      },
    );
  });
});
