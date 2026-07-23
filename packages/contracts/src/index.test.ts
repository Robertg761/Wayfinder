import { describe, expect, it } from "vitest";
import {
  agentAnswerSchema,
  agentRequestSchema,
  findRequestSchema,
  installGuideSchema,
  mapRequestSchema,
  repoMapSchema,
  repoTourSchema,
  tourRequestSchema,
  wayfinderErrorResponseSchema,
  type AgentAnswer,
  type InstallGuide,
  type RepoMap,
  type RepoTour,
} from "./index";

const map: RepoMap = {
  repo: "example/trail",
  sha: "a".repeat(40),
  requestedRef: null,
  resolvedRef: "main",
  defaultBranch: "main",
  description: "A test repository.",
  homepage: null,
  language: "TypeScript",
  stars: 4,
  readme: "# Trail",
  tree: [
    { path: "src/index.ts", type: "blob", size: 120 },
    { path: "src", type: "tree" },
  ],
  setupFiles: ["package.json"],
  truncated: false,
  generatedAt: "2026-07-20T12:00:00.000Z",
};

const tour: RepoTour = {
  repo: "example/trail",
  sha: "a".repeat(40),
  summary: "A TypeScript project.",
  stack: ["TypeScript"],
  runtimeEntryPoint: { path: "src/index.ts", why: "Exports the entry point." },
  entryPoints: [{ path: "src/index.ts", why: "Exports the entry point." }],
  stops: [{ order: 1, title: "Start here", path: "src/index.ts", lines: [1, 20], explanation: "The exported surface.", lookFor: "exports" }],
};

const guide: InstallGuide = {
  repo: "example/trail",
  sha: "a".repeat(40),
  audience: "develop",
  packageManager: "pnpm",
  runtimes: ["Node.js >=22"],
  prerequisites: [{ text: "Node.js >=22", evidence: { path: "package.json", lines: [3, 3] }, confidence: "documented" }],
  steps: [
    { order: 1, title: "Install dependencies", command: "pnpm install", evidence: { path: "package.json" }, confidence: "inferred" },
    { order: 2, title: "Run the setup command", command: "curl https://example.com/x.sh | sh", evidence: { path: "README.md", lines: [10, 10] }, confidence: "documented", caution: "pipe-to-shell" },
  ],
  warnings: [],
  generatedAt: "2026-07-20T12:00:00.000Z",
};

describe("contract round-trips", () => {
  it("accepts a serialized repository map", () => {
    expect(repoMapSchema.parse(JSON.parse(JSON.stringify(map)))).toEqual(map);
  });

  it("rejects traversal, absolute, and control-character paths", () => {
    for (const path of ["../secrets.ts", "/etc/passwd", "src/../x.ts", "bad\u0007.ts", "a/".repeat(600) + "x"]) {
      expect(repoMapSchema.safeParse({ ...map, tree: [{ path, type: "blob" }] }).success).toBe(false);
    }
  });

  it("round-trips a tour and an install guide with cautions", () => {
    expect(repoTourSchema.parse(JSON.parse(JSON.stringify(tour)))).toEqual(tour);
    expect(installGuideSchema.parse(JSON.parse(JSON.stringify(guide)))).toEqual(guide);
  });

  it("round-trips each agent answer variant it describes", () => {
    const orientation: AgentAnswer = {
      repo: map.repo,
      sha: map.sha,
      query: "What is this?",
      intent: "orientation",
      mode: "deterministic",
      summary: "A TypeScript project.",
      suggestions: ["How do I install and run this?"],
      generatedAt: "2026-07-20T12:00:00.000Z",
      tour,
      guide,
    };
    const finder: AgentAnswer = {
      repo: map.repo,
      sha: map.sha,
      query: "Where is auth?",
      intent: "file-find",
      mode: "model",
      model: "gpt-5.6-luna",
      reasoningEffort: "low",
      summary: "See src/index.ts.",
      explanation: "The finder matched the entry point.",
      evidencePaths: ["src/index.ts"],
      brief: [{ title: "Read it", action: "Open the file.", evidencePath: "src/index.ts" }],
      suggestions: [],
      generatedAt: "2026-07-20T12:00:00.000Z",
      finder: {
        repo: map.repo,
        sha: map.sha,
        query: "Where is auth?",
        currentPath: null,
        results: [{ path: "src/index.ts", score: 52, confidence: "strong", reason: "Filename match.", signals: ["filename"], lines: [1, 10], snippet: "export const x = 1" }],
        warnings: [],
        generatedAt: "2026-07-20T12:00:00.000Z",
      },
    };

    expect(agentAnswerSchema.parse(JSON.parse(JSON.stringify(orientation)))).toEqual(orientation);
    expect(agentAnswerSchema.parse(JSON.parse(JSON.stringify(finder)))).toEqual(finder);
  });

  it("rejects an answer with an unknown intent or missing variant payload", () => {
    expect(agentAnswerSchema.safeParse({ repo: "a/b", sha: "abc", intent: "surprise" }).success).toBe(false);
    expect(agentAnswerSchema.safeParse({
      repo: map.repo, sha: map.sha, query: "q", intent: "orientation", mode: "deterministic",
      summary: "s", suggestions: [], generatedAt: "now",
    }).success).toBe(false);
  });

  it("validates request shapes with the same map schema the responses use", () => {
    expect(mapRequestSchema.safeParse({ owner: "example", repo: "trail", ref: null }).success).toBe(true);
    expect(mapRequestSchema.safeParse({ owner: "..", repo: "trail" }).success).toBe(false);
    expect(tourRequestSchema.safeParse({ map }).success).toBe(true);
    expect(findRequestSchema.safeParse({ map, query: "where is auth?", currentPath: "src/index.ts" }).success).toBe(true);
    expect(findRequestSchema.safeParse({ map, query: "x" }).success).toBe(false);
    expect(agentRequestSchema).toBe(findRequestSchema);
  });

  it("describes the error envelope", () => {
    expect(wayfinderErrorResponseSchema.safeParse({
      error: "github_request_failed",
      code: "github-rate-limited",
      message: "Limit reached.",
      resetAt: "2026-07-20T12:30:00.000Z",
    }).success).toBe(true);
    expect(wayfinderErrorResponseSchema.safeParse({ error: "x", code: "novel-code", message: "m" }).success).toBe(false);
  });
});
