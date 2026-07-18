import type { AgentAnswer, AgentIntent, ContributionTrail, FileFindResponse, RepoMap } from "@wayfinder/contracts";
import { createFileFind } from "./find";
import { createFileContextAnswer } from "./file-context";
import { createInstallGuide } from "./install";
import { generateTour } from "./tour";
import { synthesizeAgentAnswer, type ModelOptions } from "./model";

export { importedSpecifiers, keepCredibleCallers as keepLikelyCallers } from "./file-context";

const fileQuestion = /\b(where|which|locate|find|file|directory|folder|implementation|implemented|defined|definition|source)\b/i;
const testLocationQuestion = /\bwhere\b.*\b(tests?|specs?|fixtures?)\b|\b(tests?|specs?|fixtures?)\b.*\b(where|located|live)\b/i;
const installationQuestion = /\b(install|installation|setup|set up|prerequisite|dependencies|dependency|package manager|environment|env file|build|compile|start|serve|run locally|develop locally)\b/i;
const commandQuestion = /\bhow\b.*\b(run|start|build|compile|test|develop|install)\b/i;
const orientationQuestion = /\b(overview|orientation|tour|architecture|stack|purpose|explore|entry point|entrypoint)\b|\b(what does|what is|tell me about)\s+(this|the)?\s*(repo|repository|project)\b/i;
const entryFileQuestion = /\b(which|where|find|locate)\b.*\b(entry|entrypoint|entry point)\b.*\b(file|implementation|source)\b|\bmain\s+(implementation\s+)?entry\s+(file|point)\b/i;
const startingQuestion = /\b(where|how)\b.*\b(start|begin)\b/i;
const contributionQuestion = /\b(first contribution|contribution plan|contribute|pull request|work on|make a change)\b|\b(i want to|help me|plan to|trying to)\b.*\b(add|change|fix|implement|refactor|improve)\b/i;
const contributionNoise = new Set([
  "add", "behavior", "bug", "change", "contribution", "core", "feature", "file", "first", "fix", "help", "implement", "improve", "issue", "lib", "make",
  "plan", "primary", "pull", "refactor", "related", "request", "something", "source", "spec", "specs", "src", "support", "test", "tests",
  "type", "types", "want", "work",
]);
const consumerInstallationQuestion = /\b(use|consume|consumer|published package|add to my project|install the library|install the package)\b/i;
const contributorInstallationQuestion = /\b(develop|development|contribut(?:e|or|ors|ing|ion)?|from source|repository locally|repo locally|run locally|build locally)\b/i;
const developmentTaskQuestion = /\b(tests?|test suite|build|compile|dependencies|dependency|package manager|prerequisites?|developer setup|development setup|development server|run locally|start locally|serve locally)\b/i;
const currentFileQuestion = /\b(this file|current file|summari[sz]e|file role|imports?|depends?|dependencies|callers?|used by|paired tests?|tests? paired|tests? for|change impact|public surface|read next|what breaks)\b/i;
const namedFileAction = /\b(summari[sz]e|role|imports?|depends?|dependencies|callers?|used by|tests?|specs?|verification|impact|read next|what breaks)\b/i;

export function classifyAgentIntent(query: string, currentPath: string | null = null): AgentIntent {
  const normalized = query.trim();
  if (contributionQuestion.test(normalized)) return "contribution";
  if (currentPath && (
    currentFileQuestion.test(normalized) ||
    (normalized.toLowerCase().includes(currentPath.toLowerCase()) && namedFileAction.test(normalized))
  )) return "file-context";
  if (testLocationQuestion.test(normalized)) return "file-find";
  if (entryFileQuestion.test(normalized)) return "file-find";
  if (startingQuestion.test(normalized)) return "orientation";
  if (fileQuestion.test(normalized)) return "file-find";
  if (
    commandQuestion.test(normalized)
    || installationQuestion.test(normalized)
    || consumerInstallationQuestion.test(normalized)
    || contributorInstallationQuestion.test(normalized)
  ) return "installation";
  if (orientationQuestion.test(normalized)) return "orientation";
  return "file-find";
}

export function contributionConcepts(goal: string): string[] {
  return [...new Set(goal.toLowerCase().split(/[^a-z0-9]+/).filter((term) => term.length > 2 && !contributionNoise.has(term)))];
}

export function hasSpecificContributionGoal(goal: string): boolean {
  return contributionConcepts(goal).length > 0;
}

function emptyContributionFind(map: RepoMap, query: string, currentPath: string | null, warning: string): FileFindResponse {
  return {
    repo: map.repo,
    sha: map.sha,
    query,
    currentPath,
    results: [],
    warnings: [warning],
    generatedAt: new Date().toISOString(),
  };
}

export function keepGoalLinkedVerification(finder: FileFindResponse, goal: string): FileFindResponse {
  const concepts = contributionConcepts(goal);
  if (concepts.length === 0) return finder;
  const results = finder.results.filter((result) => {
    if (result.confidence === "possible") return false;
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
  const concepts = contributionConcepts(goal).join(" ");
  const [guide, implementation, verification] = concepts
    ? await Promise.all([
        createInstallGuide(map, token),
        createFileFind(map, concepts + " primary implementation source", currentPath, token),
        createFileFind(map, concepts + " tests specs", currentPath, token)
          .then((candidate) => keepGoalLinkedVerification(candidate, goal)),
      ])
    : [
        await createInstallGuide(map, token),
        emptyContributionFind(
          map,
          goal,
          currentPath,
          "Name the feature, behavior, or bug you want to change before Wayfinder claims an implementation coordinate.",
        ),
        emptyContributionFind(
          map,
          goal,
          currentPath,
          "No verification coordinate was searched because the contribution goal is still unspecified.",
        ),
      ];

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
  if (!hasSpecificContributionGoal(trail.goal)) {
    return "I mapped the repository setup, but I need a feature, behavior, or bug name before I can claim implementation or verification coordinates.";
  }
  const implementation = trail.implementation.results[0]?.path;
  const verification = trail.verification.results[0]?.path;
  if (!implementation) return "I mapped the repository, but I could not verify a credible implementation coordinate for this contribution yet.";
  return "Your trail starts at " + implementation + (verification ? " and leads to verification in " + verification + "." : ". I marked setup evidence and the best implementation coordinate.");
}

function installationSummary(stepCount: number, warningCount: number, audience: "use" | "develop"): string {
  if (audience === "use" && stepCount === 0) {
    return "No documented consumer install command was found. Check GitHub Releases for a packaged download; if none exists, the repository may require source setup.";
  }
  if (stepCount === 0) return "I could not find a trustworthy setup sequence, so I marked the available repository evidence and warnings instead.";
  const warningNote = warningCount > 0 ? " I also found " + warningCount + " setup note" + (warningCount === 1 ? "." : "s.") : "";
  return "I found " + stepCount + " sourced setup step" + (stepCount === 1 ? "." : "s.") + warningNote;
}

export function installationAudience(query: string): "use" | "develop" {
  if (contributorInstallationQuestion.test(query)) return "develop";
  if (consumerInstallationQuestion.test(query)) return "use";
  if (developmentTaskQuestion.test(query)) return "develop";
  return "use";
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
    const specificGoal = hasSpecificContributionGoal(query);
    const answer: AgentAnswer = {
      repo: map.repo,
      sha: map.sha,
      query,
      intent,
      mode: "free",
      summary: contributionSummary(trail),
      suggestions: specificGoal
        ? ["Explain the strongest implementation coordinate", "Where is the project configuration?"]
        : ["I want to change [feature]. Plan my first contribution.", "What does this repository do?"],
      generatedAt,
      trail,
    };
    return modelOptions && specificGoal && trail.implementation.results.length > 0
      ? synthesizeAgentAnswer(answer, modelOptions)
      : answer;
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
    const audience = installationAudience(query);
    const guide = await createInstallGuide(map, token, audience);
    const answer: AgentAnswer = {
      repo: map.repo,
      sha: map.sha,
      query,
      intent,
      mode: "free",
      summary: installationSummary(guide.steps.length, guide.warnings.length, audience),
      suggestions: ["Where is the configuration?", "Where are the tests?"],
      generatedAt,
      guide,
    };
    return answer;
  }

  if (intent === "file-context") {
    if (!currentPath) throw new Error("Current-file context requires a repository path.");
    return createFileContextAnswer(map, query, currentPath, token);
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
