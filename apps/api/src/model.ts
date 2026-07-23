import type { AgentAnswer, AgentModelUsage } from "@wayfinder/contracts";
import { z } from "zod";

export const WAYFINDER_MODEL = "gpt-5.6-luna";
export type ReasoningEffort = "low" | "medium" | "high";

export interface ModelOptions {
  apiKey: string;
  reasoningEffort?: ReasoningEffort;
  fetcher?: typeof fetch;
  // Charged immediately before the upstream model call so deterministic
  // answers never consume the caller's model allowance.
  authorize?: () => Promise<boolean>;
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

function outputJsonSchema(allowedPaths: string[]) {
  const evidencePath = allowedPaths.length > 0
    ? { anyOf: [{ type: "string", enum: allowedPaths }, { type: "null" }] }
    : { type: "null" };

  return {
    type: "object",
    additionalProperties: false,
    properties: {
      summary: {
        type: "string",
        minLength: 1,
        maxLength: 420,
        description: "A direct one or two sentence answer to the repository question.",
      },
      explanation: {
        type: "string",
        minLength: 1,
        maxLength: 1_200,
        description: "A concise explanation of what the evidence means and what the user should do next.",
      },
      evidencePaths: {
        type: "array",
        description: "Zero to five exact repository paths copied from the supplied evidence.",
        maxItems: 5,
        items: allowedPaths.length > 0
          ? { type: "string", enum: allowedPaths }
          : { type: "string", enum: [] },
      },
      brief: {
        type: "array",
        description: "Zero to four ordered, evidence-grounded actions. Use this to create a practical contribution plan when requested.",
        maxItems: 4,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            title: { type: "string", minLength: 1, maxLength: 80 },
            action: { type: "string", minLength: 1, maxLength: 280 },
            evidencePath: {
              ...evidencePath,
              description: "An exact supplied evidence path, or null when the action has no file coordinate.",
            },
          },
          required: ["title", "action", "evidencePath"],
        },
      },
    },
    required: ["summary", "explanation", "evidencePaths", "brief"],
  } as const;
}

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

function unsupportedEvidenceReason(
  synthesis: z.infer<typeof synthesisSchema>,
  allowedPaths: Set<string>,
  allowedCommands: Set<string>,
  deterministicText: string,
): string | null {
  const text = [
    synthesis.summary,
    synthesis.explanation,
    ...synthesis.brief.flatMap((step) => [step.title, step.action]),
  ].join("\n");
  let proseWithoutSupportedCommands = text;
  for (const command of [...allowedCommands].sort((left, right) => right.length - left.length)) {
    proseWithoutSupportedCommands = proseWithoutSupportedCommands.replaceAll(command, "");
  }

  const pathLike = proseWithoutSupportedCommands.match(/\b(?:[a-zA-Z0-9_.@-]+\/)+[a-zA-Z0-9_.@-]+(?:\.[a-zA-Z0-9]+)?\b/g) ?? [];
  const unsupportedPath = pathLike.find((path) => !allowedPaths.has(path));
  if (unsupportedPath) return "unsupported-prose-path:" + unsupportedPath;

  const codeSpans = [...text.matchAll(/`([^`]+)`/g)].map((match) => match[1].trim());
  const normalizedEvidence = deterministicText.toLowerCase();
  const unsupportedCodeSpan = codeSpans.find((value) => !allowedPaths.has(value)
    && !allowedCommands.has(value)
    && !normalizedEvidence.includes(value.toLowerCase()));
  if (unsupportedCodeSpan) return "unsupported-code-span";

  // Tokens that only ever read as command binaries match anywhere in prose:
  // no sentence-boundary anchor, so mid-sentence suggestions such as
  // "then npm install foo" are caught. Privilege escalation always matches.
  const unambiguousCommand = /(?:^|\s|[`'"(])(?:(?:sudo|doas)\s+\S|(?:rm|rmdir|mkfs|git\s+(?:reset|clean)|curl|wget|npm|npx|pnpm|yarn|deno|pip|pip3|pipx|poetry|cargo|rustup|brew|apt-get|dpkg|bash|zsh|powershell|pwsh|iex|irm|chmod|chown|ssh|scp)\s+\S)/i;
  if (unambiguousCommand.test(proseWithoutSupportedCommands)) return "unsupported-command";
  // Tokens that are also common English or prose words ("go", "make", "just",
  // "node", "python", "docker", "apt", ...) need either the original
  // sentence-command anchor or a command-shaped argument (flag, subcommand,
  // path, script, or URL) before they count as an instruction.
  const ambiguousBinary = "(?:apt|docker|python|python3|node|del|format|dd|sh|uv|bun|go|make|just)";
  const commandShapedArgument = "(?:-{1,2}[a-z0-9][\\w=-]*|\\+[a-z]+|(?:install|uninstall|add|remove|run|build|compile|test|start|dev|serve|sync|clone|pull|push|fetch|update|upgrade|exec|create|init|i|ci)(?:\\s|$)|\\.{0,2}/\\S+|\\S+\\.(?:sh|bash|zsh|py|js|cjs|mjs|ts|rb|ps1)(?:\\s|$|[.,!?])|https?://\\S+)";
  const anchoredCommand = new RegExp("(?:^|[\\n.!?]\\s+)(?:run|execute|type|use)?\\s*(?:sudo\\s+|doas\\s+)?" + ambiguousBinary + "\\s+\\S", "i");
  const argumentShapedCommand = new RegExp("(?:^|\\s|[`'\"(])" + ambiguousBinary + "\\s+" + commandShapedArgument, "i");
  if (anchoredCommand.test(proseWithoutSupportedCommands)) return "unsupported-command";
  if (argumentShapedCommand.test(proseWithoutSupportedCommands)) return "unsupported-command";
  if (/\|\s*(?:ba|z|da)?sh\b|\|\s*(?:iex|pwsh|powershell|python3?|node)\b/i.test(proseWithoutSupportedCommands)) return "unsupported-command";
  if (/(?:&&|\|\||\$\(|\s\|\s|\s>[>]?)\s*\S/.test(proseWithoutSupportedCommands)) return "unsupported-shell-operator";
  return null;
}

function deterministicFallback(answer: AgentAnswer, reason: string): AgentAnswer {
  console.warn(JSON.stringify({ event: "model-synthesis-fallback", reason }));
  return {
    ...answer,
    modelFallbackReason: reason.startsWith("unsupported-prose-path:")
      ? reason
      : reason.split(":", 1)[0],
  };
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
  const allowedPaths = answerEvidencePaths(answer);
  const allowedCommands = answerEvidenceCommands(answer);
  const sortedAllowedPaths = [...allowedPaths].sort();
  const sortedAllowedCommands = [...allowedCommands].sort();
  let stage = "model-request";

  try {
    if (options.authorize && !(await options.authorize())) {
      return deterministicFallback(answer, "model-allowance-exhausted");
    }
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
          "The allowedEvidencePaths list is authoritative for every evidencePaths and brief evidencePath value.",
          "Do not introduce or suggest a shell command unless that exact command appears in the supplied deterministic evidence.",
          "The allowedCommands list is authoritative for shell commands.",
          "Never combine supplied commands with shell operators; mention each exact command separately.",
          "Only use Markdown backticks around an exact supplied path, exact supplied command, or term that already appears in deterministic evidence.",
          "If the evidence is incomplete, say what is missing and suggest a supported next question.",
          "For a contribution request, use brief to turn the evidence into an ordered first-contribution plan that separates setup, implementation, and verification.",
          "Be concise, practical, and welcoming to a developer who is new to the repository.",
        ].join(" "),
        input: JSON.stringify({
          question: answer.query,
          repository: answer.repo,
          commit: answer.sha,
          allowedEvidencePaths: sortedAllowedPaths,
          allowedCommands: sortedAllowedCommands,
          deterministicEvidence: answer,
        }),
        text: {
          format: {
            type: "json_schema",
            name: "wayfinder_answer",
            strict: true,
            schema: outputJsonSchema(sortedAllowedPaths),
          },
        },
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) return deterministicFallback(answer, "model-http-" + response.status);
    stage = "response-body";
    const body: unknown = await response.json();
    stage = "output-extraction";
    const text = outputText(body);
    if (!text) return deterministicFallback(answer, "missing-output-text");

    stage = "synthesis-parse";
    let parsedText: unknown;
    try {
      parsedText = JSON.parse(text);
    } catch {
      return deterministicFallback(answer, "invalid-output-json");
    }
    stage = "synthesis-schema";
    const synthesis = synthesisSchema.safeParse(parsedText);
    if (!synthesis.success) {
      const issues = synthesis.error.issues.map((issue) => issue.path.join(".") + ":" + issue.code).join(",");
      return deterministicFallback(answer, "invalid-output-schema:" + issues);
    }

    stage = "evidence-validation";
    if (synthesis.data.evidencePaths.some((path) => !allowedPaths.has(path))) {
      return deterministicFallback(answer, "unsupported-evidence-path");
    }
    if (synthesis.data.brief.some((step) => step.evidencePath !== null && !allowedPaths.has(step.evidencePath))) {
      return deterministicFallback(answer, "unsupported-brief-path");
    }
    const unsupportedReason = unsupportedEvidenceReason(
      synthesis.data,
      new Set([...allowedPaths, answer.repo]),
      allowedCommands,
      JSON.stringify(answer),
    );
    if (unsupportedReason) return deterministicFallback(answer, unsupportedReason);

    stage = "result-cleanup";
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
  } catch (error) {
    const errorName = error instanceof Error ? error.name : "UnknownError";
    return deterministicFallback(answer, `exception-${stage}-${errorName}`);
  }
}
