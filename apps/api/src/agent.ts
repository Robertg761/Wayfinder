import type { AgentAnswer, AgentIntent, ContributionTrail, RepoMap } from "@wayfinder/contracts";
import { createFileFind } from "./find";
import { createInstallGuide } from "./install";
import { generateTour } from "./tour";
import { synthesizeAgentAnswer, type ModelOptions } from "./model";

const fileQuestion = /\b(where|which|locate|find|file|directory|folder|implementation|implemented|defined|definition|source)\b/i;
const testLocationQuestion = /\bwhere\b.*\b(tests?|specs?|fixtures?)\b|\b(tests?|specs?|fixtures?)\b.*\b(where|located|live)\b/i;
const installationQuestion = /\b(install|installation|setup|set up|prerequisite|dependencies|dependency|package manager|environment|env file|build|compile|start|serve|run locally|develop locally)\b/i;
const commandQuestion = /\bhow\b.*\b(run|start|build|compile|test|develop|install)\b/i;
const orientationQuestion = /\b(overview|orientation|tour|architecture|stack|purpose|explore|entry point|entrypoint)\b|\b(what does|what is|tell me about)\s+(this|the)?\s*(repo|repository|project)\b/i;
const startingQuestion = /\b(where|how)\b.*\b(start|begin)\b/i;
const contributionQuestion = /\b(first contribution|contribution plan|contribute|pull request|work on|make a change)\b|\b(i want to|help me|plan to|trying to)\b.*\b(add|change|fix|implement|refactor|improve)\b/i;

export function classifyAgentIntent(query: string): AgentIntent {
  const normalized = query.trim();
  if (contributionQuestion.test(normalized)) return "contribution";
  if (testLocationQuestion.test(normalized)) return "file-find";
  if (startingQuestion.test(normalized)) return "orientation";
  if (commandQuestion.test(normalized) || installationQuestion.test(normalized)) return "installation";
  if (orientationQuestion.test(normalized)) return "orientation";
  if (fileQuestion.test(normalized)) return "file-find";
  return "file-find";
}

async function createContributionTrail(
  map: RepoMap,
  goal: string,
  currentPath: string | null,
  token?: string,
): Promise<ContributionTrail> {
  const [guide, implementation, verification] = await Promise.all([
    createInstallGuide(map, token),
    createFileFind(map, "Find the primary implementation source for this change: " + goal, currentPath, token),
    createFileFind(map, "Find the tests or specs that verify this change: " + goal, currentPath, token),
  ]);

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
  const intent = classifyAgentIntent(query);
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
    };
    return modelOptions ? synthesizeAgentAnswer(answer, modelOptions) : answer;
  }

  if (intent === "installation") {
    const guide = await createInstallGuide(map, token);
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
    return modelOptions ? synthesizeAgentAnswer(answer, modelOptions) : answer;
  }

  const finder = await createFileFind(map, query, currentPath, token);
  const answer: AgentAnswer = {
    repo: map.repo,
    sha: map.sha,
    query,
    intent,
    mode: "free",
    summary: finderSummary(finder.results.length, finder.results[0]?.path),
    suggestions: ["What does this repository do?", "How do I install and run this?"],
    generatedAt,
    finder,
  };
  return modelOptions ? synthesizeAgentAnswer(answer, modelOptions) : answer;
}
