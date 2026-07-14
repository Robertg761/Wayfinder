import { describe, expect, it } from "vitest";
import { collectSetupFiles, compactTree, dedupeTree, filterTree, shouldIncludePath } from "../src/github";

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
});
