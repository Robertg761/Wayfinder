import type { RepoMap } from "@wayfinder/contracts";
import { describe, expect, it } from "vitest";
import { commandCaution, extractMarkdownCommands, generateInstallGuide, isConsumerInstallCommand, selectSetupPaths } from "../src/install";

function makeMap(overrides: Partial<RepoMap> = {}): RepoMap {
  return {
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

describe("isConsumerInstallCommand", () => {
  it.each([
    "npm install trail-sdk",
    "pip install trail-sdk",
    "pipx install trail-cli",
    "cargo install ripgrep",
    "cargo binstall ripgrep",
    "go install example.com/trail/cmd/trail@latest",
    "brew install trail",
    "sudo apt-get install trail",
    "doas pkg_add trail",
  ])("recognizes documented consumer installs across ecosystems: %s", (command) => {
    expect(isConsumerInstallCommand(command)).toBe(true);
  });

  it.each([
    "npm install",
    "python -m pip install -e .",
    "pip install -r requirements.txt",
    "uv sync",
    "poetry install",
    "cargo build",
    "go test ./...",
  ])("keeps repository setup out of consumer guidance: %s", (command) => {
    expect(isConsumerInstallCommand(command)).toBe(false);
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

  it("omits published-package and placeholder commands from contributor setup", () => {
    const readme = [
      "# Trail",
      "## Installation",
      "```bash",
      "npm install trail-sdk",
      "npm run example -- examples/<your-example>.ts",
      "```",
    ].join("\n");
    const map = makeMap({ readme, setupFiles: ["README.md", "package.json", "pnpm-lock.yaml"] });
    const guide = generateInstallGuide(map, {
      "README.md": readme,
      "package.json": JSON.stringify({ packageManager: "pnpm@10.0.0", scripts: { test: "vitest", build: "vite build" } }),
    });

    expect(guide.steps.map((step) => step.command)).toEqual(["pnpm install", "pnpm test", "pnpm build"]);
    expect(guide.warnings[0]).toContain("omitted");
  });

  it("keeps consumer installation separate from repository development", () => {
    const readme = ["# Trail", "## Installation", "```bash", "npm install trail-sdk", "```"].join("\n");
    const map = makeMap({ readme, setupFiles: ["README.md", "package.json"] });
    const files = {
      "README.md": readme,
      "package.json": JSON.stringify({ name: "trail-sdk", packageManager: "npm@11", scripts: { test: "vitest" } }),
    };

    const consumer = generateInstallGuide(map, files, "use");
    const contributor = generateInstallGuide(map, files, "develop");

    expect(consumer.audience).toBe("use");
    expect(consumer.steps.map((step) => step.command)).toEqual(["npm install trail-sdk"]);
    expect(contributor.audience).toBe("develop");
    expect(contributor.steps.map((step) => step.command)).toEqual(["npm install", "npm test"]);
  });

  it("recognizes short repository names without matching an unrelated package", () => {
    const readme = [
      "# jq",
      "## Installation",
      "```bash",
      "brew install jq",
      "cargo install cargo-fuzz",
      "```",
    ].join("\n");
    const map = makeMap({ repo: "jqlang/jq", readme, setupFiles: ["README.md"] });

    expect(generateInstallGuide(map, { "README.md": readme }, "use").steps.map((step) => step.command)).toEqual([
      "brew install jq",
    ]);
  });

  it("keeps non-JavaScript consumer commands and omits them from contributor setup", () => {
    const readme = [
      "# Trail",
      "## Installation",
      "```bash",
      "pip install trail-sdk",
      "pipx install trail-cli",
      "cargo install trail-cli",
      "go install example.com/trail/cmd/trail@latest",
      "brew install trail",
      "```",
    ].join("\n");
    const map = makeMap({ readme, setupFiles: ["README.md"] });

    expect(generateInstallGuide(map, { "README.md": readme }, "use").steps.map((step) => step.command)).toEqual([
      "pip install trail-sdk",
      "pipx install trail-cli",
      "cargo install trail-cli",
      "go install example.com/trail/cmd/trail@latest",
      "brew install trail",
    ]);
    expect(generateInstallGuide(map, { "README.md": readme }, "develop").steps).toEqual([]);
  });

  it("keeps product installs separate from similarly shaped development tooling", () => {
    const readme = [
      "# ripgrep",
      "## Installation",
      "```bash",
      "curl -LO https://github.com/BurntSushi/ripgrep/releases/download/14.1.1/ripgrep_14.1.1-1_amd64.deb",
      "cargo install ripgrep",
      "cargo binstall ripgrep",
      "sudo dnf config-manager --set-enabled crb",
      "sudo dnf install https://example.com/epel-release-latest.noarch.rpm",
      "sudo dnf install ripgrep",
      "```",
      "## Building",
      "```bash",
      "git clone https://github.com/BurntSushi/ripgrep",
      "cd ripgrep",
      "cargo build --release",
      "```",
      "## Running tests",
      "```bash",
      "cargo test --all",
      "```",
    ].join("\n");
    const contributing = [
      "# Contributing",
      "## Development setup",
      "```bash",
      "cargo install cargo-fuzz",
      "```",
    ].join("\n");
    const map = makeMap({ repo: "BurntSushi/ripgrep", language: "Rust", readme, setupFiles: ["README.md", "CONTRIBUTING.md", "Cargo.toml"] });
    const files = { "README.md": readme, "CONTRIBUTING.md": contributing, "Cargo.toml": "[package]\nname = \"ripgrep\"" };

    const consumer = generateInstallGuide(map, files, "use");
    const contributor = generateInstallGuide(map, files, "develop");

    expect(consumer.steps.map((step) => step.command)).toEqual([
      "curl -LO https://github.com/BurntSushi/ripgrep/releases/download/14.1.1/ripgrep_14.1.1-1_amd64.deb",
      "cargo install ripgrep",
      "cargo binstall ripgrep",
      "sudo dnf install ripgrep",
    ]);
    expect(consumer.steps.some((step) => step.command.includes("cargo-fuzz"))).toBe(false);
    expect(contributor.steps.map((step) => step.command)).toEqual([
      "git clone https://github.com/BurntSushi/ripgrep",
      "cd ripgrep",
      "cargo build --release",
      "cargo test --all",
      "cargo install cargo-fuzz",
    ]);
    expect(contributor.steps.at(-1)?.title).toBe("Install development tooling");
  });

  it("moves inferred dependency installation before documented start commands", () => {
    const readme = ["# Trail", "## Development", "```bash", "pnpm dev", "```"].join("\n");
    const map = makeMap({ readme, setupFiles: ["README.md", "package.json", "pnpm-lock.yaml"] });
    const guide = generateInstallGuide(map, {
      "README.md": readme,
      "package.json": JSON.stringify({ packageManager: "pnpm@10", scripts: { dev: "vite" } }),
    });

    expect(guide.steps.map((step) => step.command)).toEqual(["pnpm install", "pnpm dev"]);
    expect(guide.steps.map((step) => step.order)).toEqual([1, 2]);
  });

  it("preserves documented setup order while inserting inferred dependencies", () => {
    const readme = [
      "# Trail",
      "## Development",
      "```bash",
      "git worktree add ../trail-feature -b feature",
      "cd ../trail-feature",
      "pnpm dev",
      "```",
    ].join("\n");
    const map = makeMap({ readme, setupFiles: ["README.md", "package.json", "pnpm-lock.yaml"] });
    const guide = generateInstallGuide(map, {
      "README.md": readme,
      "package.json": JSON.stringify({ packageManager: "pnpm@10", scripts: { dev: "vite" } }),
    });

    expect(guide.steps.map((step) => step.command)).toEqual([
      "git worktree add ../trail-feature -b feature",
      "cd ../trail-feature",
      "pnpm install",
      "pnpm dev",
    ]);
  });

  it("does not invent a registry command from a public application manifest", () => {
    const map = makeMap({ setupFiles: ["package.json", "package-lock.json"] });
    const guide = generateInstallGuide(map, {
      "package.json": JSON.stringify({ name: "desktop-widget", scripts: { start: "electron ." } }),
    }, "use");

    expect(guide.steps).toEqual([]);
    expect(guide.warnings).toContain("No documented consumer install command was found. Check GitHub Releases for a packaged download; if none exists, use the repository's source setup instructions.");
  });
});

describe("selectSetupPaths", () => {
  it("uses repository-level setup evidence without leaking subsystem README commands", () => {
    const map = makeMap({
      setupFiles: [
        "README.md",
        "CONTRIBUTING.md",
        "package.json",
        ".conductor/README.md",
        ".agents/skills/README.md",
        "packages/widget/README.md",
        "docs/setup.md",
        ".github/CONTRIBUTING.md",
      ],
      tree: [
        { path: "Cargo.toml", type: "blob" },
        { path: "crates/core/Cargo.toml", type: "blob" },
      ],
    });

    expect(selectSetupPaths(map)).toEqual(expect.arrayContaining([
      "README.md",
      "CONTRIBUTING.md",
      "package.json",
      "Cargo.toml",
      "docs/setup.md",
      ".github/CONTRIBUTING.md",
    ]));
    expect(selectSetupPaths(map)).not.toEqual(expect.arrayContaining([
      ".conductor/README.md",
      ".agents/skills/README.md",
      "packages/widget/README.md",
      "crates/core/Cargo.toml",
    ]));
  });
});

describe("commandCaution", () => {
  it("flags privilege escalation, pipe-to-shell, and non-GitHub downloads", () => {
    expect(commandCaution("sudo make install")).toBe("elevated-privileges");
    expect(commandCaution("curl -fsSL https://get.example.com/install.sh | sh")).toBe("pipe-to-shell");
    expect(commandCaution("curl -fsSL https://get.example.com/trail.deb -o trail.deb")).toBe("external-download");
    expect(commandCaution("wget https://mirror.example.org/trail.tar.gz")).toBe("external-download");
  });

  it("does not flag routine repository commands or GitHub-hosted downloads", () => {
    expect(commandCaution("pnpm install")).toBeUndefined();
    expect(commandCaution("git clone https://github.com/example/trail.git")).toBeUndefined();
    expect(commandCaution("curl -LO https://github.com/example/trail/releases/download/v1/trail.deb")).toBeUndefined();
    expect(commandCaution("wget https://raw.githubusercontent.com/example/trail/main/setup.md")).toBeUndefined();
  });

  it("attaches the caution to documented steps and keeps clean installs ranked first", () => {
    const markdown = [
      "## Installation",
      "",
      "```bash",
      "curl -fsSL https://get.example.com/trail.sh | sh",
      "```",
      "",
      "```bash",
      "curl -LO https://get.example.com/trail.deb",
      "```",
      "",
      "```bash",
      "brew install trail",
      "```",
    ].join("\n");
    const steps = extractMarkdownCommands(markdown, "README.md");
    expect(steps[0]).toMatchObject({ command: "curl -fsSL https://get.example.com/trail.sh | sh", caution: "pipe-to-shell" });
    expect(steps[1]).toMatchObject({ caution: "external-download" });
    expect(steps[2].caution).toBeUndefined();

    // Pipe-to-shell is not a packaged-download shape, so the consumer guide
    // drops it; the cautioned direct download ranks after the clean install.
    const guide = generateInstallGuide(makeMap(), { "README.md": markdown }, "use");
    expect(guide.steps.map((step) => step.command)).toEqual([
      "brew install trail",
      "curl -LO https://get.example.com/trail.deb",
    ]);
    expect(guide.steps[0].caution).toBeUndefined();
    expect(guide.steps[1].caution).toBe("external-download");
  });
});
