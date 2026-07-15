import type { AgentAnswer, AgentIntent, ContributionTrail, FileFindResponse, RepoMap } from "@wayfinder/contracts";
import { createFileFind } from "./find";
import { createInstallGuide } from "./install";
import { generateTour } from "./tour";
import { synthesizeAgentAnswer, type ModelOptions } from "./model";
import { fetchRepoFile, isBlockingGitHubError } from "./github";

const fileQuestion = /\b(where|which|locate|find|file|directory|folder|implementation|implemented|defined|definition|source)\b/i;
const testLocationQuestion = /\bwhere\b.*\b(tests?|specs?|fixtures?)\b|\b(tests?|specs?|fixtures?)\b.*\b(where|located|live)\b/i;
const installationQuestion = /\b(install|installation|setup|set up|prerequisite|dependencies|dependency|package manager|environment|env file|build|compile|start|serve|run locally|develop locally)\b/i;
const commandQuestion = /\bhow\b.*\b(run|start|build|compile|test|develop|install)\b/i;
const orientationQuestion = /\b(overview|orientation|tour|architecture|stack|purpose|explore|entry point|entrypoint)\b|\b(what does|what is|tell me about)\s+(this|the)?\s*(repo|repository|project)\b/i;
const entryFileQuestion = /\b(which|where|find|locate)\b.*\b(entry|entrypoint|entry point)\b.*\b(file|implementation|source)\b|\bmain\s+(implementation\s+)?entry\s+(file|point)\b/i;
const startingQuestion = /\b(where|how)\b.*\b(start|begin)\b/i;
const contributionQuestion = /\b(first contribution|contribution plan|contribute|pull request|work on|make a change)\b|\b(i want to|help me|plan to|trying to)\b.*\b(add|change|fix|implement|refactor|improve)\b/i;
const contributionNoise = new Set([
  "add", "change", "contribution", "core", "file", "first", "fix", "help", "implement", "improve", "lib", "make",
  "plan", "primary", "pull", "refactor", "related", "request", "source", "spec", "specs", "src", "support", "test", "tests",
  "type", "types", "want", "work",
]);
const consumerInstallationQuestion = /\b(use|consume|consumer|published package|add to my project|install the library|install the package)\b/i;
const currentFileQuestion = /\b(this file|current file|imports?|depends?|dependencies|paired tests?|change impact|public surface)\b/i;

export function classifyAgentIntent(query: string, currentPath: string | null = null): AgentIntent {
  const normalized = query.trim();
  if (contributionQuestion.test(normalized)) return "contribution";
  if (currentPath && currentFileQuestion.test(normalized)) return "file-context";
  if (testLocationQuestion.test(normalized)) return "file-find";
  if (entryFileQuestion.test(normalized)) return "file-find";
  if (startingQuestion.test(normalized)) return "orientation";
  if (commandQuestion.test(normalized) || installationQuestion.test(normalized)) return "installation";
  if (orientationQuestion.test(normalized)) return "orientation";
  if (fileQuestion.test(normalized)) return "file-find";
  return "file-find";
}

export function importedSpecifiers(content: string): string[] {
  const matches = content.matchAll(/(?:from\s+|import\s*\(\s*|require\s*\(\s*|^\s*import\s+)["']([^"']+)["']/gm);
  return [...new Set([...matches].map((match) => match[1]).filter(Boolean))].slice(0, 20);
}

function resolveLocalImports(map: RepoMap, currentPath: string, imports: string[]): string[] {
  const directory = currentPath.split("/").slice(0, -1).join("/");
  const files = new Set(map.tree.filter((entry) => entry.type === "blob").map((entry) => entry.path));
  const extensions = ["", ".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs", "/index.ts", "/index.tsx", "/index.js"];
  const resolved: string[] = [];
  for (const specifier of imports.filter((item) => item.startsWith("."))) {
    const segments = (directory + "/" + specifier).split("/");
    const normalized: string[] = [];
    for (const segment of segments) {
      if (!segment || segment === ".") continue;
      if (segment === "..") normalized.pop();
      else normalized.push(segment);
    }
    const base = normalized.join("/");
    const match = extensions.map((suffix) => base + suffix).find((candidate) => files.has(candidate));
    if (match && !resolved.includes(match)) resolved.push(match);
  }
  return resolved.slice(0, 10);
}

export function keepLikelyCallers(finder: FileFindResponse, currentPath: string): FileFindResponse {
  return {
    ...finder,
    results: finder.results.filter((result) =>
      result.path !== currentPath && !/(^|\/)(test|tests|__tests__|fixtures?|examples?|evals?|bench|benchmarks?|ecosystem-tests?)(\/|$)|\.(test|spec)\./i.test(result.path),
    ),
  };
}

function contributionConcepts(goal: string): string[] {
  return [...new Set(goal.toLowerCase().split(/[^a-z0-9]+/).filter((term) => term.length > 2 && !contributionNoise.has(term)))];
}

export function keepGoalLinkedVerification(finder: FileFindResponse, goal: string): FileFindResponse {
  const concepts = contributionConcepts(goal);
  if (concepts.length === 0) return finder;
  const results = finder.results.filter((result) => {
    const evidence = (result.path + " " + (result.snippet ?? "")).toLowerCase();
    return concepts.some((concept) => evidence.includes(concept) || evidence.includes(concept.slice(0, 4)));
  });

  return {
    ...finder,
    results,
    warnings: results.length > 0 ? finder.warnings : [
      ...finder.warnings,
      "No test path or inspected test snippet matched the contribution goal, so no verification coordinate was claimed.",
    ],
  };
}

async function createContributionTrail(
  map: RepoMap,
  goal: string,
  currentPath: string | null,
  token?: string,
): Promise<ContributionTrail> {
  const concepts = contributionConcepts(goal).join(" ") || goal;
  const [guide, implementation] = await Promise.all([
    createInstallGuide(map, token),
    createFileFind(map, concepts + " primary implementation source", currentPath, token),
  ]);
  const verificationCandidate = await createFileFind(map, concepts + " tests specs", currentPath, token);
  const verification = keepGoalLinkedVerification(verificationCandidate, goal);

  return {
    repo: map.repo,
    sha: map.sha,
    goal,
    tour: generateTour(map),
    guide,
    implementation,
    verification,
    generatedAt: new Date().toISOString(),
  };
}

function contributionSummary(trail: ContributionTrail): string {
  const implementation = trail.implementation.results[0]?.path;
  const verification = trail.verification.results[0]?.path;
  if (!implementation) return "I mapped the repository, but I could not verify a credible implementation coordinate for this contribution yet.";
  return "Your trail starts at " + implementation + (verification ? " and leads to verification in " + verification + "." : ". I marked setup evidence and the best implementation coordinate.");
}

function installationSummary(stepCount: number, warningCount: number): string {
  if (stepCount === 0) return "I could not find a trustworthy setup sequence, so I marked the available repository evidence and warnings instead.";
  const warningNote = warningCount > 0 ? " I also found " + warningCount + " setup note" + (warningCount === 1 ? "." : "s.") : "";
  return "I found " + stepCount + " sourced setup step" + (stepCount === 1 ? "." : "s.") + warningNote;
}

function finderSummary(resultCount: number, topPath?: string): string {
  if (resultCount === 0) return "I could not mark a reliable coordinate for that question. Try naming a feature, symbol, test, or configuration concept.";
  return "I found " + resultCount + " likely location" + (resultCount === 1 ? "" : "s") + ". The strongest coordinate is " + topPath + ".";
}

export async function createAgentAnswer(
  map: RepoMap,
  query: string,
  currentPath: string | null,
  token?: string,
  modelOptions?: ModelOptions,
): Promise<AgentAnswer> {
  const intent = classifyAgentIntent(query, currentPath);
  const generatedAt = new Date().toISOString();

  if (intent === "contribution") {
    const trail = await createContributionTrail(map, query, currentPath, token);
    const answer: AgentAnswer = {
      repo: map.repo,
      sha: map.sha,
      query,
      intent,
      mode: "free",
      summary: contributionSummary(trail),
      suggestions: ["Explain the strongest implementation coordinate", "Where is the project configuration?"],
      generatedAt,
      trail,
    };
    return modelOptions ? synthesizeAgentAnswer(answer, modelOptions) : answer;
  }

  if (intent === "orientation") {
    const tour = generateTour(map);
    const guide = await createInstallGuide(map, token, "develop");
    const answer: AgentAnswer = {
      repo: map.repo,
      sha: map.sha,
      query,
      intent,
      mode: "free",
      summary: tour.summary,
      suggestions: ["How do I install and run this?", "Where is the main entry point?"],
      generatedAt,
      tour,
      guide,
    };
    return answer;
  }

  if (intent === "installation") {
    const audience = consumerInstallationQuestion.test(query) ? "use" : "develop";
    const guide = await createInstallGuide(map, token, audience);
    const answer: AgentAnswer = {
      repo: map.repo,
      sha: map.sha,
      query,
      intent,
      mode: "free",
      summary: installationSummary(guide.steps.length, guide.warnings.length),
      suggestions: ["Where is the configuration?", "Where are the tests?"],
      generatedAt,
      guide,
    };
    return answer;
  }

  if (intent === "file-context") {
    if (!currentPath) throw new Error("Current-file context requires a repository path.");
    const content = await fetchRepoFile(map.repo, currentPath, map.sha, token).catch((error) => {
      if (isBlockingGitHubError(error)) throw error;
      return "";
    });
    const imports = importedSpecifiers(content);
    const relatedPaths = resolveLocalImports(map, currentPath, imports);
    const fileName = currentPath.split("/").at(-1)!;
    const stem = fileName.replace(/\.[^.]+$/, "");
    const [tests, callerCandidates] = await Promise.all([
      createFileFind(map, fileName + " paired tests specs", currentPath, token),
      createFileFind(map, stem + " import usage caller", currentPath, token),
    ]);
    const callers = keepLikelyCallers(callerCandidates, currentPath);
    const testPaths = tests.results.slice(0, 3).map((result) => result.path);
    const callerPath = callers.results[0]?.path;
    return {
      repo: map.repo,
      sha: map.sha,
      query,
      intent,
      mode: "free",
      summary: `${currentPath} directly references ${imports.length} import${imports.length === 1 ? "" : "s"}${callerPath ? `, is likely used by ${callerPath}` : ""}${testPaths.length ? `, and has likely verification in ${testPaths[0]}.` : "."}`,
      explanation: relatedPaths.length
        ? "The local dependency paths below were resolved from imports in the current file. Test matches are ranked separately."
        : "No local imports were resolved from the current file. Test matches are still ranked from repository evidence.",
      suggestions: ["Map a change starting from this file", "Show me the repository architecture"],
      generatedAt,
      currentPath,
      imports,
      relatedPaths,
      callers,
      tests,
    };
  }

  const finder = await createFileFind(map, query, currentPath, token);
  const answer: AgentAnswer = {
    repo: map.repo,
    sha: map.sha,
    query,
    intent: "file-find",
    mode: "free",
    summary: finderSummary(finder.results.length, finder.results[0]?.path),
    suggestions: ["What does this repository do?", "How do I install and run this?"],
    generatedAt,
    finder,
  };
  return answer;
}
