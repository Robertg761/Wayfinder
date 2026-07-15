import type {
  FileFindResponse,
  FileMatch,
  FileMatchConfidence,
  FileMatchSignal,
  RepoMap,
  RepoTreeEntry,
} from "@wayfinder/contracts";
import { fetchRepoFile, isBlockingGitHubError } from "./github";

interface RankedCandidate {
  entry: RepoTreeEntry;
  rawScore: number;
  signals: FileMatchSignal[];
  matchedTerms: string[];
}

const stopWords = new Set([
  "a",
  "an",
  "and",
  "are",
  "can",
  "code",
  "does",
  "file",
  "files",
  "find",
  "for",
  "handled",
  "handles",
  "how",
  "i",
  "implementation",
  "in",
  "is",
  "it",
  "located",
  "me",
  "of",
  "project",
  "repository",
  "show",
  "the",
  "this",
  "to",
  "where",
  "which",
]);

const aliasGroups = [
  ["auth", "authentication", "authorize", "authorization", "login", "oauth", "permission", "session", "token"],
  ["route", "router", "routing", "navigation", "app", "application", "dispatch", "endpoint", "scaffold", "url", "view"],
  ["config", "configuration", "environment", "env", "settings"],
  ["test", "tests", "testing", "spec", "specs", "fixture", "fixtures"],
  ["entry", "entrypoint", "index", "main", "bootstrap", "startup"],
  ["database", "db", "migration", "migrations", "model", "models", "prisma", "schema"],
  ["api", "controller", "endpoint", "handler", "request", "response"],
  ["cache", "caching", "memo", "redis"],
  ["log", "logger", "logging", "telemetry"],
  ["cli", "command", "commands", "terminal", "executable", "binary", "bin", "main"],
  ["websocket", "websockets", "socket", "ws"],
  ["payment", "payments", "billing", "checkout", "stripe"],
  ["user", "users", "account", "accounts", "profile"],
];

const languageExtensions: Record<string, string[]> = {
  C: ["c", "h"],
  "C#": ["cs"],
  "C++": ["cc", "cpp", "cxx", "h", "hpp"],
  Go: ["go"],
  Java: ["java", "kt"],
  JavaScript: ["js", "jsx", "mjs", "cjs", "ts", "tsx"],
  PHP: ["php"],
  Python: ["py"],
  Ruby: ["rb"],
  Rust: ["rs"],
  Swift: ["swift"],
  TypeScript: ["ts", "tsx", "js", "jsx"],
};

const inspectableExtensions = new Set([
  "c", "cc", "cpp", "cs", "go", "h", "hpp", "html", "java", "js", "jsx", "json", "kt",
  "md", "mjs", "php", "py", "rb", "rs", "sh", "swift", "toml", "ts", "tsx", "vue", "yaml", "yml",
]);

const sourceExtensions = new Set([
  "c", "cc", "cpp", "cs", "go", "h", "hpp", "java", "js", "jsx", "kt", "mjs", "php", "py",
  "rb", "rs", "sh", "swift", "ts", "tsx", "vue",
]);

const implementationQuestion = /\b(implementation|implemented|source|defined|definition|handled|handles)\b/i;
const testVocabulary = new Set(["fixture", "fixtures", "spec", "specs", "test", "tests", "testing"]);

function isTestPath(path: string): boolean {
  return /(^|\/)(__tests__|test|tests|spec|specs|fixtures?)(\/|$)|\.(test|spec)\.|(^|\/)test_[^/]+\.[^.]+$|_test\.[^.]+$/i.test(path);
}

function isAuxiliaryPath(path: string): boolean {
  return /(^|\/)(examples?|demos?|evals?|bench(?:es)?|benchmarks?|fixtures?|templates?|playgrounds?)(\/|$)/i.test(path);
}

function isTestSupportPath(path: string): boolean {
  return /(^|\/)(conftest\.[^/]+|test_apps|type_check|fixtures?|helpers?|support)(\/|$)/i.test(path);
}

function words(value: string): string[] {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function directTerms(query: string): string[] {
  return [...new Set(words(query)
    .map((word) => word.length > 4 && word.endsWith("s") ? word.slice(0, -1) : word)
    .filter((word) => word.length > 1 && !stopWords.has(word)))];
}

function expandedTerms(terms: string[]): string[] {
  const expanded = new Set(terms);
  for (const term of terms) {
    const group = aliasGroups.find((aliases) => aliases.includes(term));
    group?.forEach((alias) => expanded.add(alias));
  }
  return [...expanded];
}

function extension(path: string): string {
  const fileName = path.split("/").at(-1) ?? "";
  return fileName.includes(".") ? fileName.split(".").at(-1)?.toLowerCase() ?? "" : "";
}

function currentDirectory(path: string | null): string | null {
  if (!path) return null;
  const parts = path.split("/");
  if (parts.at(-1)?.includes(".")) parts.pop();
  return parts.join("/") || null;
}

function addSignal(signals: FileMatchSignal[], signal: FileMatchSignal): void {
  if (!signals.includes(signal)) signals.push(signal);
}

export function rankFileCandidates(map: RepoMap, query: string, currentPath: string | null = null): RankedCandidate[] {
  const direct = directTerms(query);
  const expanded = expandedTerms(direct);
  const currentDir = currentDirectory(currentPath);
  const askingForTests = expanded.some((term) => testVocabulary.has(term));
  const scoringDirect = askingForTests ? direct.filter((term) => !testVocabulary.has(term)) : direct;
  const scoringExpanded = askingForTests ? expanded.filter((term) => !testVocabulary.has(term)) : expanded;
  const directSet = new Set(scoringDirect);
  const askingForImplementation = implementationQuestion.test(query);
  const askingForDocumentation = /\b(readme|documentation|docs?|guide|template|issue)\b/i.test(query);
  const askingForExecutable = /\b(executable|binary|command line|cli)\b/i.test(query);
  const preferredExtensions = new Set(languageExtensions[map.language ?? ""] ?? []);

  return map.tree
    .filter((entry) => entry.type === "blob")
    .map((entry): RankedCandidate => {
      const path = entry.path.toLowerCase();
      const fileName = path.split("/").at(-1) ?? "";
      const baseName = fileName.replace(/\.[^.]+$/, "");
      const pathWords = new Set(words(path));
      const fileWords = new Set(words(baseName));
      const signals: FileMatchSignal[] = [];
      const matchedTerms = new Set<string>();
      let score = 0;

      for (const term of scoringDirect) {
        if (fileWords.has(term) || baseName === term) {
          score += 52;
          matchedTerms.add(term);
          addSignal(signals, "filename");
        } else if (baseName.includes(term)) {
          score += 38;
          matchedTerms.add(term);
          addSignal(signals, "filename");
        } else if (pathWords.has(term)) {
          score += 28;
          matchedTerms.add(term);
          addSignal(signals, "path");
        }
      }

      for (const term of scoringExpanded) {
        if (directSet.has(term)) continue;
        if (fileWords.has(term) || pathWords.has(term)) {
          score += 15;
          matchedTerms.add(term);
          addSignal(signals, "alias");
        }
      }

      const isTest = isTestPath(path);
      if (askingForTests && isTest) {
        score += 34;
        addSignal(signals, "test-pair");
      } else if (askingForTests) {
        score -= 45;
      } else if (!askingForTests && isTest) {
        score -= askingForImplementation ? 52 : 18;
      }

      if (askingForTests && isTestSupportPath(path) && !/\b(type|typing|typecheck|fixture|helper|support|config)\b/i.test(query)) {
        score -= 45;
      }

      if (currentDir && (path.startsWith(currentDir.toLowerCase() + "/") || currentDir.toLowerCase().startsWith(path.split("/").slice(0, -1).join("/")))) {
        score += 13;
        addSignal(signals, "current-directory");
      }

      if (preferredExtensions.has(extension(path))) {
        score += 5;
        addSignal(signals, "primary-language");
      }

      if (!askingForDocumentation && (extension(path) === "md" || path.startsWith(".github/"))) {
        score -= 45;
      }

      if (askingForImplementation && isAuxiliaryPath(path)) {
        score -= 55;
      }

      if (/^(index|main|app|server|client|router|routes|config|cli)$/.test(baseName)) {
        score += 6;
        addSignal(signals, "architecture");
      }

      if (askingForExecutable && baseName === "main") {
        score += 55;
        addSignal(signals, "architecture");
      } else if (askingForExecutable && /(^|\/)bin(\/|$)/.test(path)) {
        score += 35;
        addSignal(signals, "architecture");
      }

      score -= Math.min(8, entry.path.split("/").length - 1);
      return { entry, rawScore: score, signals, matchedTerms: [...matchedTerms] };
    })
    .sort((left, right) =>
      right.rawScore - left.rawScore ||
      left.entry.path.split("/").length - right.entry.path.split("/").length ||
      left.entry.path.localeCompare(right.entry.path),
    );
}

function contentEvidence(content: string, direct: string[], expanded: string[]): {
  score: number;
  signals: FileMatchSignal[];
  lines?: [number, number];
  snippet?: string;
  matched: string[];
} {
  const lower = content.toLowerCase();
  const signals: FileMatchSignal[] = [];
  const matched = new Set<string>();
  let score = 0;
  let firstLine: number | null = null;
  let snippet: string | undefined;
  const lines = content.split(/\r?\n/);

  if (/\bdeprecated\b/i.test(content)) {
    score -= 50;
    addSignal(signals, "deprecated");
  }

  if (content.length < 1_000 && /^\s*export\s+(\*|\{[\s\S]*?\})\s+from\s+['"]/m.test(content)) {
    score -= 25;
    addSignal(signals, "re-export");
  }

  for (const term of expanded) {
    const index = lower.indexOf(term.toLowerCase());
    if (index === -1) continue;
    matched.add(term);
    score += direct.includes(term) ? 11 : 5;
    addSignal(signals, "content");

    if (firstLine === null) {
      let offset = 0;
      for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
        const nextOffset = offset + lines[lineIndex].length + 1;
        if (index < nextOffset) {
          firstLine = lineIndex + 1;
          snippet = lines[lineIndex].trim().replace(/\s+/g, " ").slice(0, 180);
          break;
        }
        offset = nextOffset;
      }
    }

    const symbolPattern = new RegExp("\\b(class|def|function|interface|type|const|let|var|fn|struct|enum)\\s+" + term + "\\b", "i");
    if (symbolPattern.test(content)) {
      score += 20;
      addSignal(signals, "symbol");
    }
  }

  return {
    score: Math.min(score, 55),
    signals,
    ...(firstLine === null ? {} : { lines: [Math.max(1, firstLine - 2), firstLine + 2] as [number, number] }),
    ...(snippet ? { snippet } : {}),
    matched: [...matched],
  };
}

function confidence(score: number): FileMatchConfidence {
  if (score >= 60) return "strong";
  if (score >= 35) return "likely";
  return "possible";
}

function reasonFor(signals: FileMatchSignal[], terms: string[]): string {
  const topic = terms.slice(0, 3).join(", ") || "the query";
  if (signals.includes("deprecated") && signals.includes("re-export")) return "This path matches, but it is a deprecated forwarding file rather than the primary implementation.";
  if (signals.includes("deprecated")) return "This path matches, but its source marks it as deprecated.";
  if (signals.includes("re-export")) return "This path matches, but it mainly forwards exports from another module.";
  if (signals.includes("filename") && signals.includes("content")) return "The filename and source content both match " + topic + ".";
  if (signals.includes("symbol")) return "A named symbol in this file matches " + topic + ".";
  if (signals.includes("filename")) return "The filename directly matches " + topic + ".";
  if (signals.includes("path") && signals.includes("content")) return "The repository path and source content both match " + topic + ".";
  if (signals.includes("path")) return "The directory path directly matches " + topic + ".";
  if (signals.includes("alias") && signals.includes("content")) return "Related terminology appears in both the path and source content.";
  if (signals.includes("content")) return "The inspected source contains terminology related to " + topic + ".";
  if (signals.includes("current-directory")) return "This is an architectural file near the current GitHub location.";
  return "This is a likely architectural landmark based on its name, depth, and language.";
}

export function findFiles(
  map: RepoMap,
  query: string,
  files: Record<string, string> = {},
  currentPath: string | null = null,
): FileFindResponse {
  const direct = directTerms(query);
  const expanded = expandedTerms(direct);
  const askingForTests = expanded.some((term) => testVocabulary.has(term));
  const evidenceDirect = askingForTests ? direct.filter((term) => !testVocabulary.has(term)) : direct;
  const evidenceExpanded = askingForTests ? expanded.filter((term) => !testVocabulary.has(term)) : expanded;
  const candidates = rankFileCandidates(map, query, currentPath);

  const results: FileMatch[] = candidates.map((candidate) => {
    const inspected = files[candidate.entry.path]
      ? contentEvidence(files[candidate.entry.path], evidenceDirect, evidenceExpanded)
      : { score: 0, signals: [] as FileMatchSignal[], matched: [] as string[] };
    const rawScore = candidate.rawScore + inspected.score;
    const signals = [...candidate.signals];
    inspected.signals.forEach((signal) => addSignal(signals, signal));
    const matched = [...new Set([...candidate.matchedTerms, ...inspected.matched])];

    return {
      path: candidate.entry.path,
      score: Number(Math.min(0.99, Math.max(0.05, 0.18 + rawScore / 120)).toFixed(2)),
      confidence: signals.includes("symbol") && signals.includes("content") ? "strong" : confidence(rawScore),
      reason: reasonFor(signals, matched.length ? matched : evidenceDirect),
      signals,
      ...(inspected.lines ? { lines: inspected.lines } : {}),
      ...(inspected.snippet ? { snippet: inspected.snippet } : {}),
    };
  });

  results.sort((left, right) => right.score - left.score || left.path.localeCompare(right.path));
  const scopedResults = askingForTests ? results.filter((result) => isTestPath(result.path)) : results;
  const productionResults = implementationQuestion.test(query) && !/\b(tests?|specs?|fixtures?)\b/i.test(query)
    ? scopedResults.filter((result) =>
      !isTestPath(result.path) &&
      !isAuxiliaryPath(result.path) &&
      sourceExtensions.has(extension(result.path)),
    )
    : scopedResults;
  const eligibleResults = productionResults.length > 0 ? productionResults : scopedResults;
  const usefulResults = eligibleResults.filter((result, index) => result.confidence !== "possible" || index < 3).slice(0, 5);
  const warnings: string[] = [];
  if (direct.length === 0) warnings.push("The query did not contain a specific repository concept, so results rely on architectural landmarks.");
  if (askingForTests && usefulResults.length === 0) warnings.push("No test-shaped repository path matched this query.");
  if (usefulResults.every((result) => result.confidence === "possible")) {
    warnings.push("No direct filename, path, or content match was found. These are structural suggestions, not confirmed implementations.");
  }

  return {
    repo: map.repo,
    sha: map.sha,
    query,
    currentPath,
    results: usefulResults,
    warnings,
    generatedAt: new Date().toISOString(),
  };
}

export async function createFileFind(
  map: RepoMap,
  query: string,
  currentPath: string | null,
  token?: string,
): Promise<FileFindResponse> {
  const candidates = rankFileCandidates(map, query, currentPath)
    .filter((candidate) =>
      inspectableExtensions.has(extension(candidate.entry.path)) &&
      (candidate.entry.size === undefined || candidate.entry.size <= 200_000),
    )
    .slice(0, 5);

  const loaded = await Promise.all(candidates.map(async ({ entry }) => {
    const content = await fetchRepoFile(map.repo, entry.path, map.sha, token).catch((error) => {
      if (isBlockingGitHubError(error)) throw error;
      return null;
    });
    return content === null ? null : [entry.path, content] as const;
  }));
  const files = Object.fromEntries(loaded.filter((item): item is readonly [string, string] => item !== null));
  return findFiles(map, query, files, currentPath);
}
