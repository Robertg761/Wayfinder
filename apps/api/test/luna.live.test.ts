import type { AgentAnswer, RepoMap } from "@wayfinder/contracts";
import { describe, expect, it } from "vitest";
import { createAgentAnswer } from "../src/agent";
import { synthesizeAgentAnswer, type ReasoningEffort, WAYFINDER_MODEL } from "../src/model";
import { WAYFINDER_PROD_API_URL } from "@wayfinder/contracts";

const apiUrl = process.env.WAYFINDER_API_URL ?? WAYFINDER_PROD_API_URL;
const apiKey = process.env.OPENAI_API_KEY?.trim();
const allowedEfforts = new Set<ReasoningEffort>(["low", "medium", "high"]);
const requestedEfforts = (process.env.LUNA_EFFORTS ?? "low")
  .split(",")
  .map((value) => value.trim())
  .filter((value): value is ReasoningEffort => allowedEfforts.has(value as ReasoningEffort));

const cases = [
  {
    name: "typescript-speech",
    owner: "openai",
    repo: "openai-node",
    query: "I want to change speech generation. Plan my first contribution.",
  },
  {
    name: "python-routing",
    owner: "pallets",
    repo: "flask",
    query: "I want to improve request routing. Plan my first contribution.",
  },
  {
    name: "go-authentication",
    owner: "cli",
    repo: "cli",
    query: "I want to improve authentication. Plan my first contribution.",
  },
] as const;

async function repoMap(owner: string, repo: string): Promise<RepoMap> {
  const response = await fetch(apiUrl + "/map", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ owner, repo }),
  });
  if (!response.ok) throw new Error("Repository map failed with HTTP " + response.status);
  return response.json() as Promise<RepoMap>;
}

function validEvidencePaths(answer: AgentAnswer): Set<string> {
  if (answer.intent !== "contribution") return new Set();
  return new Set([
    ...answer.trail.tour.entryPoints.map((entry) => entry.path),
    ...answer.trail.tour.stops.map((stop) => stop.path),
    ...answer.trail.guide.prerequisites.map((item) => item.evidence.path),
    ...answer.trail.guide.steps.map((step) => step.evidence.path),
    ...answer.trail.implementation.results.map((result) => result.path),
    ...answer.trail.verification.results.map((result) => result.path),
  ]);
}

describe.skipIf(process.env.RUN_LUNA_EVAL !== "1" || !apiKey)("live Luna evaluation", () => {
  for (const repositoryCase of cases) {
    for (const reasoningEffort of requestedEfforts) {
      it(repositoryCase.name + " at " + reasoningEffort + " reasoning", async () => {
        const map = await repoMap(repositoryCase.owner, repositoryCase.repo);
        const deterministic = await createAgentAnswer(map, repositoryCase.query, null);
        const answer = await synthesizeAgentAnswer(deterministic, {
          apiKey: apiKey as string,
          reasoningEffort,
        });
        const allowedPaths = validEvidencePaths(deterministic);

        expect(answer.mode).toBe("model");
        expect(answer.model).toBe(WAYFINDER_MODEL);
        expect(answer.reasoningEffort).toBe(reasoningEffort);
        expect(answer.brief?.length).toBeGreaterThan(0);
        expect(answer.evidencePaths?.every((path) => allowedPaths.has(path))).toBe(true);
        expect(answer.usage?.totalTokens).toBeGreaterThan(0);

        console.log(JSON.stringify({
          case: repositoryCase.name,
          repo: map.repo,
          reasoningEffort,
          summary: answer.summary,
          evidencePaths: answer.evidencePaths,
          brief: answer.brief,
          usage: answer.usage,
        }, null, 2));
      }, 60_000);
    }
  }
});
