import type {
  AgentAnswer,
  FileContextFocus,
  FileFindResponse,
  RepoMap,
  RepositoryFileKind,
} from "@wayfinder/contracts";
import { createFileFind, type FileFindOptions } from "./find";
import { fetchRepoFile, isBlockingGitHubError, type UpstreamFetchBudget } from "./github";

const sourceExtensions = new Set([
  "c", "cc", "cjs", "cpp", "cs", "cts", "cxx", "go", "h", "hpp", "java", "js", "jsx", "kt", "mjs", "mts",
  "php", "py", "rb", "rs", "sh", "swift", "ts", "tsx", "vue",
]);

const documentationExtensions = new Set(["adoc", "md", "mdx", "rst"]);
const dataExtensions = new Set(["csv", "graphql", "jsonl", "sql", "txt", "xml"]);
const javascriptExtensions = new Set(["cjs", "cts", "js", "jsx", "mjs", "mts", "ts", "tsx"]);
const genericPathTerms = new Set([
  "app", "base", "common", "config", "constants", "core", "helper", "helpers", "index", "lib", "main", "mod",
  "module", "package", "shared", "source", "src", "type", "types", "util", "utils",
]);

type FileFetcher = typeof fetchRepoFile;
type Finder = (
  map: RepoMap,
  query: string,
  currentPath: string | null,
  token?: string,
  options?: FileFindOptions,
) => Promise<FileFindResponse>;

export interface FileContextRuntime {
  fetchFile?: FileFetcher;
  findFiles?: Finder;
  budget?: UpstreamFetchBudget;
}

function extension(path: string): string {
  const fileName = path.split("/").at(-1) ?? "";
  return fileName.includes(".") ? fileName.split(".").at(-1)?.toLowerCase() ?? "" : "";
}

function fileName(path: string): string {
  return path.split("/").at(-1) ?? path;
}

function stem(path: string): string {
  return fileName(path)
    .replace(/\.(test|spec)\.[^.]+$/i, "")
    .replace(/\.[^.]+$/, "")
    .toLowerCase();
}

function humanize(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function unique(values: string[], limit = 20): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].slice(0, limit);
}

function isTestPath(path: string): boolean {
  return /(^|\/)(__tests__|test|tests|spec|specs|fixtures?)(\/|$)|\.(test|spec)\.|(^|\/)test_[^/]+\.[^.]+$|_test\.[^.]+$/i.test(path);
}

export function classifyRepositoryFile(map: RepoMap, path: string): RepositoryFileKind {
  const lower = path.toLowerCase();
  const base = fileName(lower);
  const ext = extension(lower);

  if (isTestPath(lower)) return "test";
  if (
    documentationExtensions.has(ext) ||
    /^(readme|contributing|changelog|security|license|notice|authors|code[-_]of[-_]conduct)(\..*)?$/.test(base)
  ) return "documentation";
  if (
    map.setupFiles.some((setupPath) => setupPath.toLowerCase() === lower) ||
    /(^|\/)(package\.json|tsconfig(?:\.[^.]+)?\.json|pyproject\.toml|cargo\.toml|go\.mod|dockerfile|makefile)$/i.test(lower) ||
    /(^|\/)([^/]+\.)?(config|rc)\.(c?js|mjs|json|toml|tsx?|ya?ml)$/i.test(lower) ||
    /(^|\/)\.[^/]+rc(?:\.[^/]+)?$/i.test(lower)
  ) return "configuration";
  if (sourceExtensions.has(ext)) return "source";
  if (dataExtensions.has(ext) || ext === "json" || ext === "toml" || ext === "yaml" || ext === "yml") return "data";
  return "other";
}

export function classifyFileContextFocus(query: string): FileContextFocus {
  const normalized = query.trim();
  if (/\b(change impact|impact of|if i change|implementation and verification|what breaks|affected files?)\b/i.test(normalized)) return "impact";
  if (/\b(paired tests?|tests? paired|find (?:its|the) tests?|specs?|verification files?)\b/i.test(normalized)) return "tests";
  if (/\b(callers?|used by|consumers?)\b/i.test(normalized) || /^\s*which files?.*\b(import|call|reference|use)\b/i.test(normalized)) return "callers";
  if (/\b(depends?|dependencies|read next|what does .*\bimport)\b/i.test(normalized)) return "dependencies";
  return "summary";
}

function javascriptSpecifiers(content: string): string[] {
  const matches = content.matchAll(/(?:from\s+|import\s*\(\s*|require\s*\(\s*|^\s*import\s+)["']([^"']+)["']/gm);
  return [...matches].map((match) => match[1]);
}

export function importedSpecifiers(content: string, path = "current.ts"): string[] {
  const ext = extension(path);
  if (ext === "py") {
    return unique([...content.matchAll(/^\s*(?:from\s+([.\w]+)\s+import|import\s+([a-zA-Z_]\w*(?:\.\w+)*))/gm)]
      .map((match) => match[1] ?? match[2]));
  }
  if (ext === "go") {
    const imports: string[] = [];
    for (const match of content.matchAll(/\bimport\s*(?:\(([\s\S]*?)\)|"([^"]+)")/g)) {
      if (match[2]) imports.push(match[2]);
      for (const quoted of match[1]?.matchAll(/"([^"]+)"/g) ?? []) imports.push(quoted[1]);
    }
    return unique(imports);
  }
  if (ext === "rs") {
    return unique([
      ...[...content.matchAll(/^\s*use\s+([^;]+);/gm)].map((match) => match[1].replace(/\s+/g, " ")),
      ...[...content.matchAll(/^\s*mod\s+([a-zA-Z_]\w*)\s*;/gm)].map((match) => "self::" + match[1]),
    ]);
  }
  if (ext === "rb") {
    return unique([...content.matchAll(/^\s*require(?:_relative)?\s*["']([^"']+)["']/gm)].map((match) => match[1]));
  }
  if (ext === "php") {
    return unique([...content.matchAll(/\b(?:include|include_once|require|require_once)\s*\(?\s*["']([^"']+)["']/g)].map((match) => match[1]));
  }
  return javascriptExtensions.has(ext) ? unique(javascriptSpecifiers(content)) : [];
}

function normalizedRelativeBase(currentPath: string, specifier: string): string | null {
  const directory = currentPath.split("/").slice(0, -1);
  const cleaned = specifier.split(/[?#]/, 1)[0];
  let segments: string[];

  if (cleaned.startsWith(".")) {
    if (extension(currentPath) === "py" && /^\.+[a-zA-Z_]/.test(cleaned)) {
      const leadingDots = cleaned.match(/^\.+/)?.[0].length ?? 1;
      segments = [...directory];
      for (let index = 1; index < leadingDots; index += 1) segments.pop();
      segments.push(...cleaned.slice(leadingDots).split(".").filter(Boolean));
    } else {
      segments = [...directory, ...cleaned.split("/")];
    }
  } else if (cleaned.startsWith("crate::")) {
    segments = ["src", ...cleaned.slice("crate::".length).split("::")];
  } else if (cleaned.startsWith("self::") || cleaned.startsWith("super::")) {
    segments = [...directory];
    let rest = cleaned;
    while (rest.startsWith("super::")) {
      segments.pop();
      rest = rest.slice("super::".length);
    }
    if (rest.startsWith("self::")) rest = rest.slice("self::".length);
    segments.push(...rest.split("::"));
  } else {
    return null;
  }

  const normalized: string[] = [];
  for (const segment of segments) {
    if (!segment || segment === ".") continue;
    if (segment === "..") normalized.pop();
    else normalized.push(segment);
  }
  return normalized.join("/");
}

export function resolveLocalImports(map: RepoMap, currentPath: string, imports: string[]): string[] {
  const files = new Set(map.tree.filter((entry) => entry.type === "blob").map((entry) => entry.path));
  const currentExtension = extension(currentPath);
  const suffixes = unique([
    "",
    currentExtension ? "." + currentExtension : "",
    ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".go", ".rs", ".json",
    "/index.ts", "/index.tsx", "/index.js", "/index.py", "/mod.rs",
  ]);
  const resolved: string[] = [];

  for (const specifier of imports) {
    const base = normalizedRelativeBase(currentPath, specifier);
    if (!base) continue;
    const match = suffixes.map((suffix) => base + suffix).find((candidate) => files.has(candidate));
    if (match && !resolved.includes(match)) resolved.push(match);
  }
  return resolved.slice(0, 10);
}

function markdownHighlights(content: string): string[] {
  return unique([...content.matchAll(/^#{1,4}\s+(.+?)\s*#*$/gm)]
    .map((match) => match[1].replace(/\[(.*?)\]\([^)]*\)/g, "$1").replace(/[*_`]/g, "")), 7);
}

function markdownTitle(content: string): string | undefined {
  return content.match(/^#\s+(.+?)\s*#*$/m)?.[1]
    .replace(/\[(.*?)\]\([^)]*\)/g, "$1")
    .replace(/[*_`]/g, "")
    .trim() || undefined;
}

function sourceHighlights(content: string, path: string): string[] {
  const ext = extension(path);
  const patterns = ext === "py"
    ? [/^\s*(?:async\s+)?def\s+([a-zA-Z_]\w*)/gm, /^\s*class\s+([a-zA-Z_]\w*)/gm]
    : ext === "go"
      ? [/^\s*func\s+(?:\([^)]*\)\s*)?([A-Z]\w*)/gm, /^\s*type\s+([A-Z]\w*)/gm]
      : ext === "rs"
        ? [/^\s*pub(?:\([^)]*\))?\s+(?:async\s+)?(?:fn|struct|enum|trait|type|const|static)\s+([a-zA-Z_]\w*)/gm]
        : [/^\s*export\s+(?:default\s+)?(?:async\s+)?(?:class|function|interface|type|enum|const|let|var)\s+([a-zA-Z_$][\w$]*)/gm];
  return unique(patterns.flatMap((pattern) => [...content.matchAll(pattern)].map((match) => match[1])), 8);
}

export function fileHighlights(path: string, kind: RepositoryFileKind, content: string): string[] {
  if (kind === "documentation") return markdownHighlights(content);
  if (kind === "source") return sourceHighlights(content, path);
  if (kind === "test") {
    return unique([...content.matchAll(/\b(?:describe|it|test)\s*\(\s*["'`]([^"'`]+)["'`]/g)].map((match) => match[1]), 8);
  }
  if ((kind === "configuration" || kind === "data") && extension(path) === "json") {
    try {
      const parsed = JSON.parse(content) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return Object.keys(parsed).slice(0, 8);
    } catch {
      return [];
    }
  }
  return [];
}

export function describeFileRole(path: string, kind: RepositoryFileKind): string {
  const lowerName = fileName(path).toLowerCase();
  const pathStem = humanize(stem(path));
  if (/^readme(?:\.|$)/.test(lowerName)) return path.includes("/") ? "Guide for this repository area" : "Primary repository guide";
  if (/^contributing(?:\.|$)/.test(lowerName)) return "Contributor workflow guide";
  if (/^changelog(?:\.|$)/.test(lowerName)) return "Release history";
  if (/^security(?:\.|$)/.test(lowerName)) return "Security policy";
  if (/^(license|notice)(?:\.|$)/.test(lowerName)) return "License and attribution document";
  if (kind === "documentation") return "Repository documentation";
  if (kind === "configuration") return "Project configuration for " + (pathStem || lowerName);
  if (kind === "test") return "Automated verification for " + (pathStem || lowerName);
  if (kind === "source") {
    if (stem(path) === "index") return "Source entry or export surface";
    if (stem(path) === "main") return "Runtime entry point";
    return "Source module for " + (pathStem || lowerName);
  }
  if (kind === "data") return "Repository data file";
  return "Repository file";
}

function evidenceTerms(path: string, highlights: string[]): string[] {
  const rawStem = fileName(path)
    .replace(/\.(test|spec)\.[^.]+$/i, "")
    .replace(/\.[^.]+$/, "");
  const distinctiveStemTerms = humanize(rawStem).toLowerCase().split(" ")
    .filter((term) => term.length > 2 && !genericPathTerms.has(term))
    .sort((left, right) => right.length - left.length || left.localeCompare(right));
  if (distinctiveStemTerms.length > 0) return distinctiveStemTerms.slice(0, 1);

  const parents = path.split("/").slice(0, -1).reverse();
  for (const parent of parents) {
    const normalized = parent.toLowerCase();
    if (normalized.length > 2 && !genericPathTerms.has(normalized)) return [normalized];
  }

  const terms: string[] = [];
  for (const highlight of highlights) {
    for (const word of humanize(highlight).toLowerCase().split(" ")) {
      if (word.length > 3 && !genericPathTerms.has(word)) terms.push(word);
    }
  }
  return unique(terms).sort((left, right) => right.length - left.length || left.localeCompare(right)).slice(0, 1);
}

function emptyFind(map: RepoMap, query: string, currentPath: string, warnings: string[] = []): FileFindResponse {
  return {
    repo: map.repo,
    sha: map.sha,
    query,
    currentPath,
    results: [],
    warnings,
    generatedAt: new Date().toISOString(),
  };
}

export function keepCredibleCallers(finder: FileFindResponse, currentPath: string): FileFindResponse {
  const results = finder.results.filter((result) =>
    result.path !== currentPath &&
    result.confidence !== "possible" &&
    result.signals.includes("content") &&
    !/(^|\/)(test|tests|__tests__|fixtures?|examples?|evals?|bench|benchmarks?|ecosystem-tests?)(\/|$)|\.(test|spec)\./i.test(result.path),
  );
  return {
    ...finder,
    results,
    warnings: results.length > 0 ? finder.warnings : unique([
      ...finder.warnings,
      "No caller had enough target-specific evidence to claim a relationship.",
    ]),
  };
}

function keepCredibleTests(finder: FileFindResponse): FileFindResponse {
  const results = finder.results.filter((result) => result.confidence !== "possible" && isTestPath(result.path));
  return {
    ...finder,
    results,
    warnings: results.length > 0 ? finder.warnings : unique([
      ...finder.warnings,
      "No test had enough target-specific evidence to claim a pairing.",
    ]),
  };
}

function fileKindLabel(kind: RepositoryFileKind): string {
  if (kind === "documentation") return "documentation";
  if (kind === "configuration") return "configuration";
  if (kind === "test") return "a test file";
  if (kind === "source") return "source code";
  if (kind === "data") return "a data file";
  return "a repository file";
}

function summaryFor(
  currentPath: string,
  focus: FileContextFocus,
  kind: RepositoryFileKind,
  role: string,
  highlights: string[],
  imports: string[],
  relatedPaths: string[],
  callers: FileFindResponse,
  tests: FileFindResponse,
  contentAvailable: boolean,
  documentTitle?: string,
): string {
  if (!contentAvailable) return `${currentPath} is the ${role.toLowerCase()}, but its contents could not be inspected, so no relationships were claimed.`;
  if (focus === "summary") {
    const title = kind === "documentation" ? documentTitle : undefined;
    const publicSurface = kind === "source" && highlights.length > 0
      ? ` Its visible declarations include ${highlights.slice(0, 4).join(", ")}.`
      : "";
    return `${currentPath} is the ${role.toLowerCase()}${title ? ` for “${title}”` : ""}.${publicSurface}`;
  }
  if (focus === "dependencies") {
    if (kind !== "source" && kind !== "test" && kind !== "configuration") {
      return `${currentPath} is ${fileKindLabel(kind)}, so source imports do not apply and none were inferred.`;
    }
    if (imports.length === 0) return `No supported import syntax was found in ${currentPath}; Wayfinder did not infer dependencies from filenames.`;
    return `${currentPath} references ${imports.length} import${imports.length === 1 ? "" : "s"}, with ${relatedPaths.length} resolved to exact repository paths.`;
  }
  if (focus === "callers") {
    if (kind !== "source") return `${currentPath} is ${fileKindLabel(kind)}, not an executable source module, so no source callers were claimed.`;
    const strongest = callers.results[0];
    return strongest
      ? `${currentPath} has ${callers.results.length} caller candidate${callers.results.length === 1 ? "" : "s"} with target-specific evidence; the strongest is ${strongest.path}.`
      : `No caller with target-specific evidence was found for ${currentPath} in the bounded repository search.`;
  }
  if (focus === "tests") {
    if (kind === "test") return `${currentPath} is already a test file, so Wayfinder did not search for another paired test.`;
    if (kind !== "source") return `${currentPath} is ${fileKindLabel(kind)}, so no source-test pairing was claimed.`;
    const strongest = tests.results[0];
    return strongest
      ? `${currentPath} has ${tests.results.length} test candidate${tests.results.length === 1 ? "" : "s"} with target-specific evidence; the strongest is ${strongest.path}.`
      : `No paired test with target-specific evidence was found for ${currentPath}.`;
  }
  if (kind !== "source") return `Changing ${currentPath} affects the ${role.toLowerCase()}; Wayfinder did not invent source callers or paired tests for ${fileKindLabel(kind)}.`;
  return `For ${currentPath}, Wayfinder verified ${relatedPaths.length} local dependenc${relatedPaths.length === 1 ? "y" : "ies"}, ${callers.results.length} caller candidate${callers.results.length === 1 ? "" : "s"}, and ${tests.results.length} paired test candidate${tests.results.length === 1 ? "" : "s"}.`;
}

function explanationFor(focus: FileContextFocus, kind: RepositoryFileKind, map: RepoMap): string {
  if (kind !== "source" && (focus === "callers" || focus === "tests" || focus === "impact")) {
    return "File type is part of the evidence boundary: documentation, configuration, tests, and data are not treated as ordinary source modules.";
  }
  if (focus === "summary") return "The role comes from the repository path and file type; visible headings or declarations come from the pinned file contents.";
  if (focus === "dependencies") return "Only explicit import syntax is reported. Local paths are shown only when they resolve to a file in the pinned repository map.";
  const bounded = map.truncated ? " The repository map is truncated, so absence is not proof that no relationship exists." : "";
  return "Relationship results require target-specific filename, path, or inspected-content evidence; structural guesses are discarded." + bounded;
}

export async function createFileContextAnswer(
  map: RepoMap,
  query: string,
  currentPath: string,
  token?: string,
  runtime: FileContextRuntime = {},
): Promise<Extract<AgentAnswer, { intent: "file-context" }>> {
  const focus = classifyFileContextFocus(query);
  const kind = classifyRepositoryFile(map, currentPath);
  const fetchFile = runtime.fetchFile ?? fetchRepoFile;
  const findFiles = runtime.findFiles ?? createFileFind;
  const warnings: string[] = [];
  let content: string | null = null;

  try {
    content = await fetchFile(map.repo, currentPath, map.sha, token, runtime.budget);
  } catch (error) {
    if (isBlockingGitHubError(error)) throw error;
    warnings.push("The current file could not be inspected, so Wayfinder did not infer imports or relationships.");
  }

  const role = describeFileRole(currentPath, kind);
  const highlights = content ? fileHighlights(currentPath, kind, content) : [];
  const documentTitle = content && kind === "documentation" ? markdownTitle(content) : undefined;
  const supportsImports = kind === "source" || kind === "test" || kind === "configuration";
  const imports = content && supportsImports ? importedSpecifiers(content, currentPath) : [];
  const relatedPaths = resolveLocalImports(map, currentPath, imports);
  const terms = evidenceTerms(currentPath, highlights);
  const callerQuery = `${terms.join(" ")} import usage caller`.trim();
  const testQuery = `${terms.join(" ")} paired tests specs`.trim();
  let callers = emptyFind(map, callerQuery, currentPath);
  let tests = emptyFind(map, testQuery, currentPath);

  if (kind === "source" && content && terms.length > 0 && (focus === "callers" || focus === "impact")) {
    callers = keepCredibleCallers(await findFiles(map, callerQuery, currentPath, token, {
      requiredEvidenceTerms: terms,
      requireInspectedContentEvidence: true,
      minimumConfidence: "likely",
      budget: runtime.budget,
    }), currentPath);
  }
  if (kind === "source" && content && terms.length > 0 && (focus === "tests" || focus === "impact")) {
    tests = keepCredibleTests(await findFiles(map, testQuery, currentPath, token, {
      requiredEvidenceTerms: terms,
      minimumConfidence: "likely",
      budget: runtime.budget,
    }));
  }

  if (kind === "source" && terms.length === 0 && (focus === "callers" || focus === "tests" || focus === "impact")) {
    warnings.push("This file has only generic path terms and no distinctive declaration, so Wayfinder could not run a safe relationship search.");
  }
  if (map.truncated && (focus === "callers" || focus === "tests" || focus === "impact")) {
    warnings.push("The repository map is truncated; missing relationships may exist outside the mapped tree.");
  }
  if (kind !== "source" && (focus === "callers" || focus === "tests" || focus === "impact")) {
    warnings.push("Non-source files are not forced through the source caller/test graph.");
  }

  const summary = summaryFor(
    currentPath,
    focus,
    kind,
    role,
    highlights,
    imports,
    relatedPaths,
    callers,
    tests,
    content !== null,
    documentTitle,
  );

  return {
    repo: map.repo,
    sha: map.sha,
    query,
    intent: "file-context",
    mode: "free",
    summary,
    explanation: explanationFor(focus, kind, map),
    suggestions: focus === "summary"
      ? ["Trace this file's dependencies", "Map the impact of changing this file"]
      : ["What does this file do?", "How is this project organized?"],
    generatedAt: new Date().toISOString(),
    currentPath,
    focus,
    fileKind: kind,
    fileRole: role,
    highlights,
    contentAvailable: content !== null,
    imports,
    relatedPaths,
    callers,
    tests,
    warnings: unique([...warnings, ...callers.warnings, ...tests.warnings]),
  };
}
