import type { AgentAnswer } from "@wayfinder/contracts";
import { describe, expect, it, vi } from "vitest";
import { synthesizeAgentAnswer } from "../src/model";

const freeAnswer: AgentAnswer = {
  repo: "example/trail",
  sha: "abc1234567890",
  query: "Where is authentication handled?",
  intent: "file-find",
  mode: "free",
  summary: "The strongest coordinate is src/auth/session.ts.",
  suggestions: ["How do I install and run this?"],
  generatedAt: "2026-07-13T00:00:00.000Z",
  finder: {
    repo: "example/trail",
    sha: "abc1234567890",
    query: "Where is authentication handled?",
    currentPath: null,
    results: [{
      path: "src/auth/session.ts",
      score: 20,
      confidence: "strong",
      reason: "The path and exported symbol match authentication.",
      signals: ["path", "symbol"],
      lines: [1, 20],
    }],
    warnings: [],
    generatedAt: "2026-07-13T00:00:00.000Z",
  },
};

function modelResponse(value: unknown, usage = {
  input_tokens: 3_000,
  output_tokens: 500,
  total_tokens: 3_500,
  input_tokens_details: { cached_tokens: 1_000 },
  output_tokens_details: { reasoning_tokens: 120 },
}): Response {
  return Response.json({
    output: [{
      type: "message",
      content: [{ type: "output_text", text: JSON.stringify(value) }],
    }],
    usage,
  });
}

describe("synthesizeAgentAnswer", () => {
  it("uses Luna at low reasoning and returns a grounded GPT-5.6 synthesis", async () => {
    const fetcher = vi.fn(async () => modelResponse({
      summary: "Authentication is handled in src/auth/session.ts.",
      explanation: "Start with the exported session logic, then follow its callers.",
      evidencePaths: ["src/auth/session.ts"],
      brief: [{ title: "Read the session", action: "Start with the exported session logic.", evidencePath: "src/auth/session.ts" }],
    })) as unknown as typeof fetch;

    const answer = await synthesizeAgentAnswer(freeAnswer, { apiKey: "test-key", fetcher });

    expect(answer).toMatchObject({
      mode: "gpt-5.6",
      model: "gpt-5.6-luna",
      reasoningEffort: "low",
      evidencePaths: ["src/auth/session.ts"],
      usage: {
        inputTokens: 3_000,
        cachedInputTokens: 1_000,
        outputTokens: 500,
        reasoningTokens: 120,
        totalTokens: 3_500,
        estimatedCostUsd: 0.0051,
      },
    });
    expect(fetcher).toHaveBeenCalledOnce();

    const [url, init] = vi.mocked(fetcher).mock.calls[0];
    const body = JSON.parse(String(init?.body));
    expect(url).toBe("https://api.openai.com/v1/responses");
    expect(init?.headers).toMatchObject({ Authorization: "Bearer test-key" });
    expect(body).toMatchObject({
      model: "gpt-5.6-luna",
      store: false,
      reasoning: { effort: "low" },
      text: { format: { type: "json_schema", strict: true } },
    });
  });

  it("allows an explicit higher reasoning level without changing the Luna model", async () => {
    const fetcher = vi.fn(async () => modelResponse({
      summary: "Authentication is handled in src/auth/session.ts.",
      explanation: "Start with the exported session logic.",
      evidencePaths: ["src/auth/session.ts"],
      brief: [],
    })) as unknown as typeof fetch;

    const answer = await synthesizeAgentAnswer(freeAnswer, {
      apiKey: "test-key",
      reasoningEffort: "medium",
      fetcher,
    });
    const body = JSON.parse(String(vi.mocked(fetcher).mock.calls[0][1]?.body));

    expect(answer).toMatchObject({ model: "gpt-5.6-luna", reasoningEffort: "medium" });
    expect(body).toMatchObject({ model: "gpt-5.6-luna", reasoning: { effort: "medium" } });
  });

  it("rejects a model path that was not supplied by a deterministic tool", async () => {
    const fetcher = vi.fn(async () => modelResponse({
      summary: "Use a path that does not exist.",
      explanation: "This answer should be discarded.",
      evidencePaths: ["src/invented.ts"],
      brief: [],
    })) as unknown as typeof fetch;

    await expect(synthesizeAgentAnswer(freeAnswer, { apiKey: "test-key", fetcher })).resolves.toBe(freeAnswer);
  });

  it("rejects invented paths even when the model omits them from evidencePaths", async () => {
    const fetcher = vi.fn(async () => modelResponse({
      summary: "Authentication is also implemented in src/invented.ts.",
      explanation: "The invented path should invalidate the synthesis.",
      evidencePaths: ["src/auth/session.ts"],
      brief: [],
    })) as unknown as typeof fetch;

    await expect(synthesizeAgentAnswer(freeAnswer, { apiKey: "test-key", fetcher })).resolves.toBe(freeAnswer);
  });

  it("rejects commands that are absent from deterministic repository evidence", async () => {
    const fetcher = vi.fn(async () => modelResponse({
      summary: "Authentication is handled in src/auth/session.ts.",
      explanation: "Run rm -rf / before opening the file.",
      evidencePaths: ["src/auth/session.ts"],
      brief: [{ title: "Clean up", action: "Execute rm -rf /.", evidencePath: "src/auth/session.ts" }],
    })) as unknown as typeof fetch;

    await expect(synthesizeAgentAnswer(freeAnswer, { apiKey: "test-key", fetcher })).resolves.toBe(freeAnswer);
  });

  it("does not let the model promote a possible deterministic match into evidence", async () => {
    const possibleAnswer: AgentAnswer = {
      ...freeAnswer,
      finder: {
        ...freeAnswer.finder,
        results: [{
          ...freeAnswer.finder.results[0],
          path: "src/guess.ts",
          confidence: "possible",
          reason: "A structural guess only.",
        }],
      },
    };
    const fetcher = vi.fn(async () => modelResponse({
      summary: "Use src/guess.ts.",
      explanation: "This possible match should not become a claim.",
      evidencePaths: ["src/guess.ts"],
      brief: [],
    })) as unknown as typeof fetch;

    await expect(synthesizeAgentAnswer(possibleAnswer, { apiKey: "test-key", fetcher })).resolves.toBe(possibleAnswer);
  });

  it("falls back to the free answer when OpenAI is unavailable", async () => {
    const fetcher = vi.fn(async () => new Response("unavailable", { status: 503 })) as unknown as typeof fetch;
    await expect(synthesizeAgentAnswer(freeAnswer, { apiKey: "test-key", fetcher })).resolves.toBe(freeAnswer);
  });

  it("skips the model request when no API key is configured", async () => {
    const fetcher = vi.fn() as unknown as typeof fetch;
    await expect(synthesizeAgentAnswer(freeAnswer, { apiKey: "", fetcher })).resolves.toBe(freeAnswer);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("removes em dash characters from model prose", async () => {
    const fetcher = vi.fn(async () => modelResponse({
      summary: "Authentication\u2014start with the session file.",
      explanation: "Open it\u2014then follow its callers.",
      evidencePaths: ["src/auth/session.ts"],
      brief: [],
    })) as unknown as typeof fetch;

    const answer = await synthesizeAgentAnswer(freeAnswer, { apiKey: "test-key", fetcher });
    expect(answer.summary).toBe("Authentication, start with the session file.");
    expect(answer.explanation).toBe("Open it, then follow its callers.");
  });
});
