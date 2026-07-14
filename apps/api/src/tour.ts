import type { RepoMap, RepoTour, TourStop } from "@wayfinder/contracts";

interface TourCandidate {
  path: string;
  title: string;
  explanation: string;
  lookFor: string;
  lines: [number, number];
  why: string;
}

const sourceExtensions = new Set([
  "c",
  "cpp",
  "cs",
  "go",
  "java",
  "js",
  "jsx",
  "kt",
  "php",
  "py",
  "rb",
  "rs",
  "swift",
  "ts",
  "tsx",
  "vue",
]);

function extension(path: string): string {
  const fileName = path.split("/").at(-1) ?? "";
  return fileName.includes(".") ? fileName.split(".").at(-1)?.toLowerCase() ?? "" : "";
}

function selectPath(
  paths: string[],
  patterns: RegExp[],
  selected: Set<string>,
  preferredExtensions?: Set<string>,
  preferredPathToken?: string,
): string | null {
  const matches = paths
    .filter((path) => !selected.has(path))
    .flatMap((path) => {
      const patternIndex = patterns.findIndex((pattern) => pattern.test(path));
      return patternIndex === -1
        ? []
        : [{
          path,
          score:
            path.split("/").length * 1_000 +
            patternIndex * 100 +
            (preferredExtensions && !preferredExtensions.has(extension(path)) ? 2_000 : 0) +
            (preferredPathToken && !path.toLowerCase().includes(preferredPathToken) ? 1_500 : 0) +
            path.length,
        }];
    })
    .sort((left, right) => left.score - right.score || left.path.localeCompare(right.path));

  return matches[0]?.path ?? null;
}

function cleanReadmeSummary(readme: string | null): string | null {
  if (!readme) return null;

  const paragraph = readme
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) =>
      line.length > 30 &&
      !line.startsWith("#") &&
      !line.startsWith("!") &&
      !line.startsWith("[") &&
      !line.startsWith("<") &&
      !line.includes("shields.io"),
    )[0];

  if (!paragraph) return null;
  return paragraph
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/[*_`]/g, "")
    .slice(0, 280);
}

function detectStack(map: RepoMap, paths: string[]): string[] {
  const lowerPaths = paths.map((path) => path.toLowerCase());
  const has = (pattern: RegExp) => lowerPaths.some((path) => pattern.test(path));
  const stack = new Set<string>();

  if (map.language) stack.add(map.language);
  if (has(/(^|\/)package\.json$/)) stack.add("Node.js");
  if (has(/(^|\/)tsconfig(\.[^/]*)?\.json$/) || has(/\.tsx?$/)) stack.add("TypeScript");
  if (has(/^next\.config\./)) stack.add("Next.js");
  if (has(/^vite\.config\./)) stack.add("Vite");
  if (has(/(^|\/)pyproject\.toml$/) || has(/(^|\/)requirements\.txt$/)) stack.add("Python");
  if (has(/(^|\/)go\.mod$/)) stack.add("Go");
  if (has(/(^|\/)cargo\.toml$/)) stack.add("Rust");
  if (has(/^dockerfile$/)) stack.add("Docker");
  if (has(/^wrangler\.(jsonc?|toml)$/)) stack.add("Cloudflare Workers");

  return [...stack].slice(0, 6);
}

function buildCandidates(map: RepoMap): TourCandidate[] {
  const files = map.tree.filter((entry) => entry.type === "blob");
  const paths = files.map((entry) => entry.path);
  const selected = new Set<string>();
  const candidates: TourCandidate[] = [];
  const preferredExtensions = new Set({
    JavaScript: ["js", "jsx", "ts", "tsx"],
    TypeScript: ["ts", "tsx", "js", "jsx"],
    Python: ["py"],
    Go: ["go"],
    Rust: ["rs"],
    Java: ["java", "kt"],
  }[map.language ?? ""] ?? []);
  const preferredPathToken = map.truncated
    ? map.repo.split("/").at(-1)?.toLowerCase().split(/[.-]/)[0]
    : undefined;

  const add = (path: string | null, details: Omit<TourCandidate, "path">) => {
    if (!path || selected.has(path)) return;
    selected.add(path);
    candidates.push({ path, ...details });
  };

  add(selectPath(paths, [/(^|\/)readme(\.[^/]*)?$/i, /(^|\/)docs\/(getting-started|introduction)/i], selected), {
    title: "Read the field notes",
    explanation: "Start with the project narrative before following implementation details. This file should explain the problem, the public surface, and the vocabulary used throughout the repository.",
    lookFor: "Find the shortest description of what the project does and who it serves.",
    lines: [1, 100],
    why: "It establishes the project's purpose and vocabulary.",
  });

  add(selectPath(paths, [
    /(^|\/)package\.json$/i,
    /(^|\/)pyproject\.toml$/i,
    /(^|\/)go\.mod$/i,
    /(^|\/)cargo\.toml$/i,
    /(^|\/)composer\.json$/i,
    /(^|\/)build\.gradle(\.kts)?$/i,
  ], selected), {
    title: "Survey the supplies",
    explanation: "The primary manifest reveals the runtime, important dependencies, and the commands maintainers use to build, test, and ship the project.",
    lookFor: "Notice the scripts or dependency groups that define the normal development loop.",
    lines: [1, 140],
    why: "It reveals the stack and the project's working commands.",
  });

  add(selectPath(paths, [
    /(^|\/)(src|app|lib)\/(index|main|app|mod)\.(tsx?|jsx?|py|go|rs|java|kt|rb|php)$/i,
    /(^|\/)(main|index|app)\.(tsx?|jsx?|py|go|rs|java|kt|rb|php)$/i,
    /(^|\/)(src|app)\/(cli|server|client)\.(tsx?|jsx?|py|go|rs)$/i,
    /(^|\/)cmd\/[^/]+\/main\.go$/i,
  ], selected, preferredExtensions, preferredPathToken), {
    title: "Find where execution begins",
    explanation: "This is a likely boundary between consumers and the rest of the codebase. Read it to see what the project exports, starts, registers, or wires together.",
    lookFor: "Trace the first handoff from this file into a deeper module.",
    lines: [1, 180],
    why: "Its name and location mark it as a likely public or runtime entry point.",
  });

  add(selectPath(paths, [
    /(^|\/)(src|app|lib)\/(client|server|core|router|runtime|api|command|cli)\.(tsx?|jsx?|py|go|rs|java|kt)$/i,
    /(^|\/)(src|app|lib)\/(client|server|core|router|runtime|api|command|cli)\/index\.(tsx?|jsx?|py|go|rs)$/i,
    /(^|\/)(src|app|lib)\/[^/]+\.(tsx?|jsx?|py|go|rs|java|kt)$/i,
  ], selected, preferredExtensions, preferredPathToken), {
    title: "Trace the main route",
    explanation: "This module appears to carry a central runtime responsibility. Follow its imports and exported types to understand how work moves through the project.",
    lookFor: "Identify the main input, the transformation it receives, and the value returned or emitted.",
    lines: [1, 200],
    why: "It is a shallow source module with a name associated with core runtime behavior.",
  });

  add(selectPath(paths, [
    /(^|\/)(test|tests|__tests__)\/.*\.(test|spec)?\.(tsx?|jsx?|py|go|rs|java|kt)$/i,
    /(^|\/).*\.(test|spec)\.(tsx?|jsx?)$/i,
    /(^|\/)test_[^/]+\.py$/i,
    /(^|\/)[^/]+_test\.go$/i,
    /(^|\/)(run-)?tests?\.(tsx?|jsx?|py|go|rs)$/i,
  ], selected), {
    title: "Read the proof",
    explanation: "Tests often explain intended behavior more directly than implementation code. They show the supported path, important edge cases, and the names maintainers use for each behavior.",
    lookFor: "Find the smallest test that demonstrates the project's central promise.",
    lines: [1, 180],
    why: "It records expected behavior and useful edge cases.",
  });

  add(selectPath(paths, [
    /(^|\/)wrangler\.(jsonc?|toml)$/i,
    /(^|\/)next\.config\.(js|mjs|ts)$/i,
    /(^|\/)vite\.config\.(js|mjs|ts)$/i,
    /(^|\/)tsconfig\.json$/i,
    /(^|\/)dockerfile$/i,
  ], selected), {
    title: "Inspect the boundary markers",
    explanation: "Configuration shows which assumptions live outside the application code. It also reveals deployment targets, build constraints, and conventions shared across the repository.",
    lookFor: "Separate local developer settings from settings that affect production behavior.",
    lines: [1, 160],
    why: "It captures the build, runtime, or deployment boundary.",
  });

  const fallbackSources = files
    .filter((entry) => !selected.has(entry.path) && sourceExtensions.has(extension(entry.path)))
    .sort((left, right) => {
      const depth = left.path.split("/").length - right.path.split("/").length;
      return depth || (right.size ?? 0) - (left.size ?? 0) || left.path.localeCompare(right.path);
    });

  for (const entry of fallbackSources) {
    if (candidates.length >= 6) break;
    add(entry.path, {
      title: "Follow a major landmark",
      explanation: "This is a prominent source file near the top of the repository. Use it to connect the entry point to a concrete implementation area.",
      lookFor: "Notice which local modules this file depends on and which parts of its surface are exported.",
      lines: [1, 180],
      why: "Its location and size make it a useful architectural landmark.",
    });
  }

  return candidates.slice(0, 6);
}

export function generateTour(map: RepoMap): RepoTour {
  const paths = map.tree.filter((entry) => entry.type === "blob").map((entry) => entry.path);
  const candidates = buildCandidates(map);
  const summary = map.description?.trim() || cleanReadmeSummary(map.readme) ||
    "A repository whose purpose is best understood by following its documentation, manifest, entry point, and tests in sequence.";

  const stops: TourStop[] = candidates.map(({ why: _why, ...candidate }, index) => ({
    ...candidate,
    order: index + 1,
  }));

  return {
    repo: map.repo,
    sha: map.sha,
    summary,
    stack: detectStack(map, paths),
    entryPoints: candidates.slice(0, 3).map((candidate) => ({
      path: candidate.path,
      why: candidate.why,
    })),
    stops,
  };
}
