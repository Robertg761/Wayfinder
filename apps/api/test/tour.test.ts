import type { RepoMap } from "@wayfinder/contracts";
import { describe, expect, it } from "vitest";
import { generateTour } from "../src/tour";

const map: RepoMap = {
  repo: "example/trail",
  sha: "abc1234567890",
  requestedRef: null,
  resolvedRef: "main",
  defaultBranch: "main",
  description: "A TypeScript client for exploring unfamiliar terrain.",
  homepage: null,
  language: "TypeScript",
  stars: 42,
  readme: "# Trail\n\nA TypeScript client for exploring unfamiliar terrain.",
  setupFiles: ["README.md", "package.json"],
  truncated: false,
  generatedAt: "2026-07-13T00:00:00.000Z",
  tree: [
    { path: "README.md", type: "blob", size: 400 },
    { path: "package.json", type: "blob", size: 800 },
    { path: "tsconfig.json", type: "blob", size: 300 },
    { path: "src", type: "tree" },
    { path: "src/index.ts", type: "blob", size: 200 },
    { path: "src/client.ts", type: "blob", size: 4_000 },
    { path: "test", type: "tree" },
    { path: "test/client.test.ts", type: "blob", size: 2_000 },
  ],
};

describe("generateTour", () => {
  it("builds an ordered route through real files", () => {
    const tour = generateTour(map);

    expect(tour.repo).toBe(map.repo);
    expect(tour.sha).toBe(map.sha);
    expect(tour.stops.map((stop) => stop.order)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(tour.stops.map((stop) => stop.path)).toEqual([
      "README.md",
      "package.json",
      "src/index.ts",
      "src/client.ts",
      "test/client.test.ts",
      "tsconfig.json",
    ]);
  });

  it("infers a concise stack without a model call", () => {
    expect(generateTour(map).stack).toEqual(["TypeScript", "Node.js"]);
  });

  it("separates the runtime entry point from documentation and manifests", () => {
    const tour = generateTour(map);
    expect(tour.runtimeEntryPoint).toEqual(expect.objectContaining({ path: "src/index.ts" }));
    expect(tour.entryPoints.map((entry) => entry.path)).toEqual(["src/index.ts", "src/client.ts"]);
    expect(tour.entryPoints.map((entry) => entry.path)).not.toContain("README.md");
    expect(tour.entryPoints.map((entry) => entry.path)).not.toContain("package.json");
  });

  it("is deterministic for the same repository map", () => {
    expect(generateTour(map)).toEqual(generateTour(map));
  });
});
