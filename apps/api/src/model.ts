import type { AgentAnswer, AgentModelUsage } from "@wayfinder/contracts";
import { z } from "zod";

export const WAYFINDER_MODEL = "gpt-5.6-luna";
export type ReasoningEffort = "low" | "medium" | "high";

export interface ModelOptions {
  apiKey: string;
  reasoningEffort?: ReasoningEffort;
  fetcher?: typeof fetch;
}

const synthesisSchema = z.object({
  summary: z.string().trim().min(1).max(420),
  explanation: z.string().trim().min(1).max(1_200),
  evidencePaths: z.array(z.string().min(1)).max(5),
  brief: z.array(z.object({
    title: z.string().trim().min(1).max(80),
    action: z.string().trim().min(1).max(280),
    evidencePath: z.string().min(1).nullable(),
  })).max(4),
});

const responseSchema = z.object({
  output_text: z.string().optional(),
  output: z.array(z.object({
    type: z.string(),
    content: z.array(z.object({
      type: z.string(),
      text: z.string().optional(),
    }).passthrough()).optional(),
  }).passthrough()).optional(),
  usage: z.object({
    input_tokens: z.number().int().nonnegative(),
    output_tokens: z.number().int().nonnegative(),
    total_tokens: z.number().int().nonnegative(),
    input_tokens_details: z.object({
      cached_tokens: z.number().int().nonnegative().optional(),
    }).passthrough().optional(),
    output_tokens_details: z.object({
      reasoning_tokens: z.number().int().nonnegative().optional(),
    }).passthrough().optional(),
  }).passthrough().optional(),
}).passthrough();

const outputJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: {
      type: "string",
      description: "A direct one or two sentence answer to the repository question.",
    },
    explanation: {
      type: "string",
      description: "A concise explanation of what the evidence means and what the user should do next.",
    },
    evidencePaths: {
      type: "array",
      description: "Zero to five exact repository paths copied from the supplied evidence.",
      items: { type: "string" },
    },
    brief: {
      type: "array",
      description: "Zero to four ordered, evidence-grounded actions. Use this to create a practical contribution plan when requested.",
      maxItems: 4,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          action: { type: "string" },
          evidencePath: {
            anyOf: [{ type: "string" }, { type: "null" }],
            description: "An exact supplied evidence path, or null when the action has no file coordinate.",
          },
        },
        required: ["title", "action", "evidencePath"],
      },
    },
  },
  required: ["summary", "explanation", "evidencePaths", "brief"],
} as const;

function answerEvidencePaths(answer: AgentAnswer): Set<string> {
  const crediblePaths = (results: Array<{ path: string; confidence: string }>) =>
    results.filter((result) => result.confidence !== "possible").map((result) => result.path);

  if (answer.intent === "orientation") {
    return new Set([
      ...answer.tour.entryPoints.map((entry) => entry.path),
      ...answer.tour.stops.map((stop) => stop.path),
    ]);
  }

  if (answer.intent === "installation") {
    return new Set([
      ...answer.guide.prerequisites.map((item) => item.evidence.path),
      ...answer.guide.steps.map((step) => step.evidence.path),
    ]);
  }

  if (answer.intent === "contribution") {
    return new Set([
      ...answer.trail.tour.entryPoints.map((entry) => entry.path),
      ...answer.trail.tour.stops.map((stop) => stop.path),
      ...answer.trail.guide.prerequisites.map((item) => item.evidence.path),
      ...answer.trail.guide.steps.map((step) => step.evidence.path),
      ...crediblePaths(answer.trail.implementation.results),
      ...crediblePaths(answer.trail.verification.results),
    ]);
  }

  if (answer.intent === "file-context") {
    return new Set([
      answer.currentPath,
      ...answer.relatedPaths,
      ...crediblePaths(answer.callers.results),
      ...crediblePaths(answer.tests.results),
    ]);
  }

  return new Set(crediblePaths(answer.finder.results));
}

function answerEvidenceCommands(answer: AgentAnswer): Set<string> {
  if (answer.intent === "installation" || answer.intent === "orientation") {
    return new Set(answer.guide.steps.map((step) => step.command));
  }
  if (answer.intent === "contribution") {
    return new Set(answer.trail.guide.steps.map((step) => step.command));
  }
  return new Set();
}

function containsUnsupportedEvidence(
  synthesis: z.infer<typeof synthesisSchema>,
  allowedPaths: Set<string>,
  allowedCommands: Set<string>,
): boolean {
  const text = [
    synthesis.summary,
    synthesis.explanation,
    ...synthesis.brief.flatMap((step) => [step.title, step.action]),
  ].join("\n");
  const pathLike = text.match(/\b(?:[a-zA-Z0-9_.@-]+\/)+[a-zA-Z0-9_.@-]+(?:\.[a-zA-Z0-9]+)?\b/g) ?? [];
  if (pathLike.some((path) => !allowedPaths.has(path))) return true;

  const codeSpans = [...text.matchAll(/`([^`]+)`/g)].map((match) => match[1].trim());
  if (codeSpans.some((value) => !allowedPaths.has(value) && !allowedCommands.has(value))) return true;

  let proseWithoutSupportedCommands = text;
  for (const command of [...allowedCommands].sort((left, right) => right.length - left.length)) {
    proseWithoutSupportedCommands = proseWithoutSupportedCommands.replaceAll(command, "");
  }
  const unsupportedCommand = /(?:^|[\n.!?]\s+)(?:run|execute|type|use)?\s*(?:sudo\s+)?(?:rm|rmdir|del|format|mkfs|dd|git\s+(?:reset|clean)|curl|wget|npm|npx|pnpm|yarn|bun|deno|pip|pip3|pipx|poetry|uv|cargo|go|brew|apt|apt-get|docker|make|just|python|python3|node)\b/i;
  return unsupportedCommand.test(proseWithoutSupportedCommands) || /(?:&&|\|\||\$\(|\s\|\s|\s>[>]?)\s*\S/.test(proseWithoutSupportedCommands);
}

function outputText(body: unknown): string | null {
  const parsed = responseSchema.safeParse(body);
  if (!parsed.success) return null;
  if (parsed.data.output_text) return parsed.data.output_text;

  for (const item of parsed.data.output ?? []) {
    if (item.type !== "message") continue;
    for (const content of item.content ?? []) {
      if (content.type === "output_text" && content.text) return content.text;
    }
  }

  return null;
}

function cleanModelText(value: string): string {
  return value.replaceAll("\u2014", ", ").replaceAll(/\s{2,}/g, " ").trim();
}

function modelUsage(body: unknown, latencyMs: number): AgentModelUsage | undefined {
  const parsed = responseSchema.safeParse(body);
  const usage = parsed.success ? parsed.data.usage : undefined;
  if (!usage) return undefined;

  const cachedInputTokens = Math.min(usage.input_tokens_details?.cached_tokens ?? 0, usage.input_tokens);
  const billableInputTokens = usage.input_tokens - cachedInputTokens;
  const estimatedCostUsd = (
    billableInputTokens * 1 +
    cachedInputTokens * 0.1 +
    usage.output_tokens * 6
  ) / 1_000_000;

  return {
    inputTokens: usage.input_tokens,
    cachedInputTokens,
    outputTokens: usage.output_tokens,
    reasoningTokens: usage.output_tokens_details?.reasoning_tokens ?? 0,
    totalTokens: usage.total_tokens,
    latencyMs,
    estimatedCostUsd,
  };
}

export async function synthesizeAgentAnswer(
  answer: AgentAnswer,
  options: ModelOptions,
): Promise<AgentAnswer> {
  if (!options.apiKey.trim()) return answer;

  const reasoningEffort = options.reasoningEffort ?? "low";
  const fetcher = options.fetcher ?? fetch;

  try {
    const startedAt = Date.now();
    const response = await fetcher("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: WAYFINDER_MODEL,
        store: false,
        max_output_tokens: 800,
        reasoning: { effort: reasoningEffort },
        instructions: [
          "You are Wayfinder, an evidence-first guide for unfamiliar GitHub repositories.",
          "Answer the user's question using only the deterministic repository evidence supplied in the input.",
          "Never invent a path, command, dependency, symbol, capability, or fact.",
          "A pinned repository map proves that a path exists at the commit; it does not prove that two files are related.",
          "Treat possible matches and warnings as uncertainty, never as confirmed implementation, caller, or test evidence.",
          "Use only exact paths present in the evidence when filling evidencePaths.",
          "Do not introduce or suggest a shell command unless that exact command appears in the supplied deterministic evidence.",
          "If the evidence is incomplete, say what is missing and suggest a supported next question.",
          "For a contribution request, use brief to turn the evidence into an ordered first-contribution plan that separates setup, implementation, and verification.",
          "Be concise, practical, and welcoming to a developer who is new to the repository.",
        ].join(" "),
        input: JSON.stringify({
          question: answer.query,
          repository: answer.repo,
          commit: answer.sha,
          deterministicEvidence: answer,
        }),
        text: {
          format: {
            type: "json_schema",
            name: "wayfinder_answer",
            strict: true,
            schema: outputJsonSchema,
          },
        },
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) return answer;
    const body: unknown = await response.json();
    const text = outputText(body);
    if (!text) return answer;

    const synthesis = synthesisSchema.safeParse(JSON.parse(text));
    if (!synthesis.success) return answer;

    const allowedPaths = answerEvidencePaths(answer);
    const allowedCommands = answerEvidenceCommands(answer);
    if (synthesis.data.evidencePaths.some((path) => !allowedPaths.has(path))) return answer;
    if (synthesis.data.brief.some((step) => step.evidencePath !== null && !allowedPaths.has(step.evidencePath))) return answer;
    if (containsUnsupportedEvidence(synthesis.data, allowedPaths, allowedCommands)) return answer;

    return {
      ...answer,
      mode: "gpt-5.6",
      model: WAYFINDER_MODEL,
      reasoningEffort,
      usage: modelUsage(body, Date.now() - startedAt),
      summary: cleanModelText(synthesis.data.summary),
      explanation: cleanModelText(synthesis.data.explanation),
      evidencePaths: synthesis.data.evidencePaths,
      brief: synthesis.data.brief.map((step) => ({
        title: cleanModelText(step.title),
        action: cleanModelText(step.action),
        evidencePath: step.evidencePath,
      })),
    };
  } catch {
    return answer;
  }
}
