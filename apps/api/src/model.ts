import type { AgentAnswer } from "@wayfinder/contracts";
import { z } from "zod";

export interface ModelOptions {
  apiKey: string;
  model?: string;
  fetcher?: typeof fetch;
}

const synthesisSchema = z.object({
  summary: z.string().trim().min(1).max(420),
  explanation: z.string().trim().min(1).max(1_200),
  evidencePaths: z.array(z.string().min(1)).max(5),
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
  },
  required: ["summary", "explanation", "evidencePaths"],
} as const;

function answerEvidencePaths(answer: AgentAnswer): Set<string> {
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

  return new Set(answer.finder.results.map((result) => result.path));
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

export async function synthesizeAgentAnswer(
  answer: AgentAnswer,
  options: ModelOptions,
): Promise<AgentAnswer> {
  if (!options.apiKey.trim()) return answer;

  const model = options.model?.trim() || "gpt-5.6";
  const fetcher = options.fetcher ?? fetch;

  try {
    const response = await fetcher("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        store: false,
        max_output_tokens: 800,
        reasoning: { effort: "medium" },
        instructions: [
          "You are Wayfinder, an evidence-first guide for unfamiliar GitHub repositories.",
          "Answer the user's question using only the deterministic repository evidence supplied in the input.",
          "Never invent a path, command, dependency, symbol, capability, or fact.",
          "Use only exact paths present in the evidence when filling evidencePaths.",
          "If the evidence is incomplete, say what is missing and suggest a supported next question.",
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
    });

    if (!response.ok) return answer;
    const text = outputText(await response.json());
    if (!text) return answer;

    const synthesis = synthesisSchema.safeParse(JSON.parse(text));
    if (!synthesis.success) return answer;

    const allowedPaths = answerEvidencePaths(answer);
    if (synthesis.data.evidencePaths.some((path) => !allowedPaths.has(path))) return answer;

    return {
      ...answer,
      mode: "gpt-5.6",
      model,
      summary: cleanModelText(synthesis.data.summary),
      explanation: cleanModelText(synthesis.data.explanation),
      evidencePaths: synthesis.data.evidencePaths,
    };
  } catch {
    return answer;
  }
}
