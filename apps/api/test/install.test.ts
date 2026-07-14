import type { RepoMap } from "@wayfinder/contracts";
import { describe, expect, it } from "vitest";
import { extractMarkdownCommands, generateInstallGuide } from "../src/install";

function makeMap(overrides: Partial<RepoMap> = {}): RepoMap {
  return {
    repo: "example/trail",
    sha: "abc1234567890",
    defaultBranch: "main",
    description: "A test repository.",
    homepage: null,
    language: "TypeScript",
    stars: 1,
    readme: null,
    tree: [],
    setupFiles: [],
    truncated: false,
    generatedAt: "2026-07-13T00:00:00.000Z",
    ...overrides,
  };
}

describe("extractMarkdownCommands", () => {
  it("extracts commands only from setup-related sections", () => {
    const markdown = [
      "# Trail",
      "",
      "```ts",
      "const install = true",
      "```",
      "",
      "## Installation",
      "",
      "```bash",
      "pnpm install",
      "pnpm dev",
      "```",
    ].join("\n");

    expect(extractMarkdownCommands(markdown, "README.md")).toEqual([
      expect.objectContaining({ command: "pnpm install", confidence: "documented", evidence: { path: "README.md", lines: [10, 10] } }),
      expect.objectContaining({ command: "pnpm dev", confidence: "documented", evidence: { path: "README.md", lines: [11, 11] } }),
    ]);
  });
});

describe("generateInstallGuide", () => {
  it("combines documented commands with manifest-backed fallbacks", () => {
    const readme = [
      "# Trail",
      "",
      "## Setup",
      "",
      "```bash",
      "pnpm install",
      "pnpm dev",
      "```",
    ].join("\n");
    const packageJson = JSON.stringify({
      packageManager: "pnpm@10.0.0",
      engines: { node: ">=20" },
      scripts: { dev: "vite", test: "vitest", build: "vite build" },
    }, null, 2);
    const map = makeMap({
      readme,
      setupFiles: ["README.md", "package.json", "pnpm-lock.yaml", ".env.example"],
    });

    const guide = generateInstallGuide(map, {
      "README.md": readme,
      "package.json": packageJson,
      ".env.example": "API_URL=",
    });

    expect(guide.packageManager).toBe("pnpm");
    expect(guide.runtimes).toContain("Node.js >=20");
    expect(guide.prerequisites).toEqual(expect.arrayContaining([
      expect.objectContaining({ text: "Node.js >=20", confidence: "documented" }),
      expect.objectContaining({ text: expect.stringContaining(".env.example"), confidence: "inferred" }),
    ]));
    expect(guide.steps.map((step) => [step.command, step.confidence])).toEqual([
      ["pnpm install", "documented"],
      ["pnpm dev", "documented"],
      ["pnpm test", "inferred"],
      ["pnpm build", "inferred"],
    ]);
  });

  it("warns when every Rust command is inferred", () => {
    const map = makeMap({ language: "Rust", setupFiles: ["Cargo.toml"] });
    const guide = generateInstallGuide(map, { "Cargo.toml": "[package]\nname = \"trail\"" });

    expect(guide.steps.map((step) => step.command)).toEqual(["cargo build", "cargo test"]);
    expect(guide.steps.every((step) => step.confidence === "inferred")).toBe(true);
    expect(guide.warnings).toContain("The repository does not provide explicit setup commands in the inspected documentation. The steps below are structural inferences.");
  });

  it("reports conflicting root package-manager signals", () => {
    const map = makeMap({ setupFiles: ["package.json", "pnpm-lock.yaml", "yarn.lock"] });
    const guide = generateInstallGuide(map, {
      "package.json": JSON.stringify({ packageManager: "yarn@4.0.0", scripts: {} }),
    });

    expect(guide.packageManager).toBe("yarn");
    expect(guide.warnings[0]).toContain("Multiple root package-manager signals");
  });
});
