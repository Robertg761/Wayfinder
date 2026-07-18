import type {
  InstallConfidence,
  InstallEvidence,
  InstallGuide,
  InstallPrerequisite,
  InstallStep,
  RepoMap,
} from "@wayfinder/contracts";
import { fetchRepoFile, isBlockingGitHubError } from "./github";

interface PackageJson {
  name?: string;
  private?: boolean;
  packageManager?: string;
  engines?: Record<string, string>;
  scripts?: Record<string, string>;
}

const commandPrefixes = [
  "npm ",
  "npx ",
  "pnpm ",
  "yarn ",
  "bun ",
  "deno ",
  "pip ",
  "pip3 ",
  "pipx ",
  "poetry ",
  "uv ",
  "python ",
  "python3 ",
  "cargo ",
  "rustup ",
  "go ",
  "make",
  "just ",
  "docker ",
  "docker-compose ",
  "git ",
  "corepack ",
  "cd ",
  "cp ",
  "mv ",
  "export ",
  "source ",
  "brew ",
  "winget ",
  "choco ",
  "scoop ",
  "apt ",
  "apt-get ",
  "curl ",
  "./",
];

function lineFor(content: string, search: string): [number, number] | undefined {
  const index = content.split(/\r?\n/).findIndex((line) => line.toLowerCase().includes(search.toLowerCase()));
  return index === -1 ? undefined : [index + 1, index + 1];
}

function evidence(path: string, lines?: [number, number]): InstallEvidence {
  return { path, ...(lines ? { lines } : {}) };
}

function cleanCommand(line: string): string {
  return line
    .trim()
    .replace(/^[$>]\s*/, "")
    .replace(/\s+#.*$/, "")
    .trim();
}

function isLikelyCommand(line: string): boolean {
  const command = cleanCommand(line);
  if (!command || command.startsWith("#") || command.length > 220) return false;
  const lower = command.toLowerCase();
  return commandPrefixes.some((prefix) => lower === prefix.trim() || lower.startsWith(prefix));
}

function pythonPackageInstall(command: string): boolean {
  const lower = command.toLowerCase().trim();
  if (!/^(?:(?:python|python3)\s+-m\s+)?pip(?:3)?\s+install\b/.test(lower) && !/^uv\s+pip\s+install\b/.test(lower)) return false;
  return !/(?:^|\s)(?:-e|--editable|-r|--requirement|\.\.?\/|\.|requirements[^\s]*\.txt)(?:\s|$)/.test(lower);
}

export function isConsumerInstallCommand(command: string): boolean {
  const lower = command.toLowerCase().replace(/\s+/g, " ").trim();
  if (!lower || /<[^>]+>/.test(lower)) return false;
  if (/^(?:npm|pnpm|yarn|bun) (?:install|add) (?:-g |--global )?[^-\s][^\s]*/.test(lower)) return true;
  if (/^(?:npx|deno) .*\badd\b/.test(lower)) return true;
  if (pythonPackageInstall(lower) || /^(?:pipx install|uv tool install) [^-\s][^\s]*/.test(lower)) return true;
  if (/^cargo install (?!.*(?:--path|\s\.\.?\/))[^-\s][^\s]*/.test(lower)) return true;
  if (/^go install [^\s]+@[^\s]+/.test(lower)) return true;
  if (/^(?:brew|winget|choco|scoop) install [^-\s][^\s]*/.test(lower)) return true;
  if (/^(?:apt|apt-get) install (?:-y )?[^-\s][^\s]*/.test(lower)) return true;
  return false;
}

function titleForCommand(command: string): string {
  const lower = command.toLowerCase();
  if (lower.includes("git clone")) return "Clone the repository";
  if (isConsumerInstallCommand(command)) return "Install the published package";
  if (/\b(install|sync)\b/.test(lower)) return "Install dependencies";
  if (/\b(test|check)\b/.test(lower)) return "Run the tests";
  if (/\b(build|compile)\b/.test(lower)) return "Build the project";
  if (/\b(dev|start|serve|run)\b/.test(lower)) return "Start the project";
  if (/^(cp|mv)\s/.test(lower) && lower.includes("env")) return "Prepare environment settings";
  if (/^(cd)\s/.test(lower)) return "Enter the project directory";
  return "Run the setup command";
}

export function extractMarkdownCommands(markdown: string, path: string): InstallStep[] {
  const lines = markdown.split(/\r?\n/);
  const steps: InstallStep[] = [];
  const seen = new Set<string>();
  let relevantSection = false;
  let inFence = false;
  let relevantFence = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const heading = line.match(/^#{1,6}\s+(.+)$/);
    if (heading && !inFence) {
      relevantSection = /(install|setup|getting started|get started|quickstart|quick start|development|developing|local|build|test|running|run locally|usage)/i.test(heading[1]);
      continue;
    }

    if (/^\s*```/.test(line)) {
      if (!inFence) relevantFence = relevantSection;
      inFence = !inFence;
      continue;
    }

    const explicitlyPrompted = /^\s*[$>]\s+\S/.test(line);
    if ((!relevantSection || (!inFence && !explicitlyPrompted)) || !isLikelyCommand(line)) continue;

    const command = cleanCommand(line);
    if (seen.has(command)) continue;
    if (inFence && !relevantFence) continue;
    seen.add(command);
    steps.push({
      order: steps.length + 1,
      title: titleForCommand(command),
      command,
      evidence: evidence(path, [index + 1, index + 1]),
      confidence: "documented",
    });
    if (steps.length >= 10) break;
  }

  return steps;
}

function managerFromLock(path: string): string | null {
  const fileName = path.toLowerCase().split("/").at(-1);
  if (fileName === "pnpm-lock.yaml") return "pnpm";
  if (fileName === "yarn.lock") return "yarn";
  if (fileName === "package-lock.json") return "npm";
  if (fileName === "bun.lock" || fileName === "bun.lockb") return "bun";
  if (fileName === "uv.lock") return "uv";
  if (fileName === "poetry.lock") return "poetry";
  return null;
}

function packageCommand(manager: string, script: string): string {
  if (manager === "npm") {
    if (script === "start" || script === "test") return "npm " + script;
    return "npm run " + script;
  }
  if (manager === "bun") return "bun run " + script;
  return manager + " " + script;
}

function commandKind(command: string): string {
  return titleForCommand(command);
}

function addUniqueStep(
  steps: InstallStep[],
  seen: Set<string>,
  title: string,
  command: string,
  source: InstallEvidence,
  confidence: InstallConfidence,
): void {
  const normalized = command.toLowerCase().replace(/\s+/g, " ").trim();
  if (seen.has(normalized)) return;
  seen.add(normalized);
  steps.push({ order: steps.length + 1, title, command, evidence: source, confidence });
}

function orderDevelopmentSteps(steps: InstallStep[]): InstallStep[] {
  const prerequisite = (step: InstallStep): boolean =>
    /^(Clone the repository|Enter the project directory|Prepare environment settings|Install dependencies|Install the project for development)$/.test(step.title);
  const ordered = [
    ...steps.filter(prerequisite),
    ...steps.filter((step) => !prerequisite(step)),
  ];
  return ordered.map((step, index) => ({ ...step, order: index + 1 }));
}

function shallowestPath(paths: string[], fileName: string): string | null {
  return paths
    .filter((path) => path.toLowerCase().split("/").at(-1) === fileName)
    .sort((left, right) => left.split("/").length - right.split("/").length || left.localeCompare(right))[0] ?? null;
}

export function generateInstallGuide(
  map: RepoMap,
  files: Record<string, string>,
  audience: "use" | "develop" = "develop",
): InstallGuide {
  const paths = Object.keys(files);
  const readmePath = paths
    .filter((path) => /(^|\/)readme([^/]*)?\.md$/i.test(path))
    .sort((left, right) => left.split("/").length - right.split("/").length || left.localeCompare(right))[0] ?? "README.md";
  const readme = files[readmePath] ?? map.readme;
  const documentationPaths = paths
    .filter((path) => /\.(md|mdx)$/i.test(path))
    .sort((left, right) => {
      const leftReadme = /(^|\/)readme/i.test(left) ? 0 : 1;
      const rightReadme = /(^|\/)readme/i.test(right) ? 0 : 1;
      return leftReadme - rightReadme || left.split("/").length - right.split("/").length || left.localeCompare(right);
    });
  if (readme && !documentationPaths.includes(readmePath)) documentationPaths.unshift(readmePath);
  const documentedSteps = documentationPaths
    .flatMap((path) => extractMarkdownCommands(files[path] ?? (path === readmePath ? readme ?? "" : ""), path))
    .filter((step, index, all) => all.findIndex((candidate) => candidate.command === step.command) === index)
    .map((step, index) => ({ ...step, order: index + 1 }));
  const consumerSteps = documentedSteps.filter((step) => isConsumerInstallCommand(step.command));
  const placeholderSteps = documentedSteps.filter((step) => /<[^>]+>/.test(step.command));
  const steps = audience === "use"
    ? [...consumerSteps]
    : documentedSteps.filter((step) => !consumerSteps.includes(step) && !placeholderSteps.includes(step));
  const seenCommands = new Set(steps.map((step) => step.command.toLowerCase().replace(/\s+/g, " ").trim()));
  const prerequisites: InstallPrerequisite[] = [];
  const runtimes = new Set<string>();
  const warnings: string[] = [];
  if (audience === "develop" && consumerSteps.length > 0) {
    warnings.push("Published-package and placeholder commands were omitted because this guide prepares the repository for local contribution.");
  }

  const packagePath = shallowestPath(paths, "package.json");
  let packageJson: PackageJson | null = null;
  if (packagePath) {
    try {
      packageJson = JSON.parse(files[packagePath]) as PackageJson;
    } catch {
      warnings.push("The primary package.json could not be parsed, so script inference was skipped.");
    }
  }

  const lockManagers = map.setupFiles
    .filter((path) => !path.includes("/"))
    .map(managerFromLock)
    .filter((manager): manager is string => manager !== null);
  const declaredManager = packageJson?.packageManager?.split("@")[0] || null;
  const packageManager = declaredManager ?? lockManagers[0] ?? (packagePath ? "npm" : null);
  const managerSet = new Set([...(declaredManager ? [declaredManager] : []), ...lockManagers]);
  if (managerSet.size > 1) {
    warnings.push("Multiple root package-manager signals were found: " + [...managerSet].join(", ") + ". Follow the README when they conflict.");
  }

  if (audience === "use") {
    if (packageJson?.private) warnings.push("The root package is marked private and may not be available as a published package.");
    if (steps.length === 0) warnings.push("No documented consumer install command was found. Check GitHub Releases for a packaged download; if none exists, use the repository's source setup instructions.");
    steps.forEach((step, index) => { step.order = index + 1; });
    return {
      repo: map.repo,
      sha: map.sha,
      audience,
      packageManager,
      runtimes: [],
      prerequisites: [],
      steps: steps.slice(0, 8),
      warnings,
      generatedAt: new Date().toISOString(),
    };
  }

  if (packagePath && packageJson?.engines?.node) {
    const text = "Node.js " + packageJson.engines.node;
    runtimes.add(text);
    prerequisites.push({
      text,
      evidence: evidence(packagePath, lineFor(files[packagePath], '"node"')),
      confidence: "documented",
    });
  }

  for (const fileName of [".nvmrc", ".node-version", ".python-version", "rust-toolchain", "rust-toolchain.toml"]) {
    const path = shallowestPath(paths, fileName);
    if (!path) continue;
    const raw = files[path].trim().split(/\r?\n/)[0]?.trim();
    if (!raw) continue;
    const label = fileName.includes("python") ? "Python" : fileName.includes("rust") ? "Rust" : "Node.js";
    const text = label + " " + raw;
    if (runtimes.has(text)) continue;
    runtimes.add(text);
    prerequisites.push({ text, evidence: evidence(path, [1, 1]), confidence: "documented" });
  }

  const envPath = paths
    .filter((path) => /(^|\/)\.env\.(example|sample)$/i.test(path))
    .sort((left, right) => left.split("/").length - right.split("/").length)[0];
  if (envPath) {
    prerequisites.push({
      text: "Configure the environment values described in " + envPath,
      evidence: evidence(envPath, [1, 1]),
      confidence: "inferred",
    });
  }

  const hasKind = (title: string) => steps.some((step) => commandKind(step.command) === title);

  if (packagePath && packageManager) {
    const normalizedInstalls = new Set([
      packageManager + " install",
      packageManager + " i",
      ...(packageManager === "npm" ? ["npm ci"] : []),
      ...(packageManager === "yarn" ? ["yarn"] : []),
    ]);
    const hasWorkspaceInstall = steps.some((step) => normalizedInstalls.has(step.command.toLowerCase().trim()));
    if (!hasWorkspaceInstall) {
      addUniqueStep(
        steps,
        seenCommands,
        "Install dependencies",
        packageManager + " install",
        evidence(packagePath, lineFor(files[packagePath], '"packageManager"')),
        "inferred",
      );
    }

    const scripts = packageJson?.scripts ?? {};
    for (const [title, names] of [
      ["Start the project", ["dev", "start", "serve"]],
      ["Run the tests", ["test", "check"]],
      ["Build the project", ["build"]],
    ] as const) {
      if (hasKind(title)) continue;
      const script = names.find((name) => scripts[name]);
      if (!script) continue;
      addUniqueStep(
        steps,
        seenCommands,
        title,
        packageCommand(packageManager, script),
        evidence(packagePath, lineFor(files[packagePath], '"' + script + '"')),
        "inferred",
      );
    }
  }

  const pyprojectPath = shallowestPath(paths, "pyproject.toml");
  if (pyprojectPath && !hasKind("Install dependencies")) {
    runtimes.add("Python");
    addUniqueStep(
      steps,
      seenCommands,
      "Install the project for development",
      packageManager === "uv" ? "uv sync" : packageManager === "poetry" ? "poetry install" : "python -m pip install -e .",
      evidence(pyprojectPath, [1, 1]),
      "inferred",
    );
  }

  const cargoPath = shallowestPath(paths, "cargo.toml");
  if (cargoPath) {
    runtimes.add("Rust");
    if (!hasKind("Build the project")) {
      addUniqueStep(steps, seenCommands, "Build the project", "cargo build", evidence(cargoPath, [1, 1]), "inferred");
    }
    if (!hasKind("Run the tests")) {
      addUniqueStep(steps, seenCommands, "Run the tests", "cargo test", evidence(cargoPath, [1, 1]), "inferred");
    }
  }

  const goModPath = shallowestPath(paths, "go.mod");
  if (goModPath) {
    runtimes.add("Go");
    if (!hasKind("Build the project")) {
      addUniqueStep(steps, seenCommands, "Build the project", "go build ./...", evidence(goModPath, [1, 1]), "inferred");
    }
    if (!hasKind("Run the tests")) {
      addUniqueStep(steps, seenCommands, "Run the tests", "go test ./...", evidence(goModPath, [1, 1]), "inferred");
    }
  }

  const orderedSteps = orderDevelopmentSteps(steps);

  if (orderedSteps.length === 0) warnings.push("No trustworthy installation or development commands were found.");
  if (orderedSteps.length > 0 && orderedSteps.every((step) => step.confidence !== "documented")) {
    warnings.push("The repository does not provide explicit setup commands in the inspected documentation. The steps below are structural inferences.");
  }

  return {
    repo: map.repo,
    sha: map.sha,
    audience,
    packageManager,
    runtimes: [...runtimes],
    prerequisites,
    steps: orderedSteps.slice(0, 12),
    warnings,
    generatedAt: new Date().toISOString(),
  };
}

function setupPathScore(path: string): number {
  const lower = path.toLowerCase();
  const depth = path.split("/").length;
  const fileName = lower.split("/").at(-1) ?? "";
  const priority = /readme|install|setup|getting-started/.test(fileName) ? 0 :
    /package\.json|pyproject\.toml|cargo\.toml|go\.mod/.test(fileName) ? 1 :
    /version|toolchain|\.env\.(example|sample)/.test(fileName) ? 2 : 3;
  return depth * 1_000 + priority * 100 + path.length;
}

export async function createInstallGuide(
  map: RepoMap,
  token?: string,
  audience: "use" | "develop" = "develop",
): Promise<InstallGuide> {
  const setupPaths = [...new Set([
    ...map.setupFiles,
    ...map.tree.filter((entry) => entry.type === "blob").map((entry) => entry.path),
  ])]
    .filter((path) => !/(^|\/)(examples?|fixtures?|ecosystem-tests?|test|tests|__tests__)(\/|$)/i.test(path))
    .filter((path) => /(^|\/)(readme([^/]*)?\.md|contributing([^/]*)?\.md|package\.json|pyproject\.toml|cargo\.toml|go\.mod|requirements[^/]*\.txt|\.nvmrc|\.node-version|\.python-version|rust-toolchain(\.toml)?|\.tool-versions|\.env\.(example|sample)|makefile|justfile|dockerfile)$/i.test(path))
    .sort((left, right) => setupPathScore(left) - setupPathScore(right))
    .slice(0, 16);

  const loaded = await Promise.all(setupPaths.map(async (path) => {
    const content = await fetchRepoFile(map.repo, path, map.sha, token).catch((error) => {
      if (isBlockingGitHubError(error)) throw error;
      return null;
    });
    return content === null ? null : [path, content] as const;
  }));

  return generateInstallGuide(
    map,
    Object.fromEntries(loaded.filter((item): item is readonly [string, string] => item !== null)),
    audience,
  );
}
