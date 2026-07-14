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

function modelResponse(value: unknown): Response {
  return Response.json({
    output: [{
      type: "message",
      content: [{ type: "output_text", text: JSON.stringify(value) }],
    }],
  });
}

describe("synthesizeAgentAnswer", () => {
  it("uses the Responses API and returns a grounded GPT-5.6 synthesis", async () => {
    const fetcher = vi.fn(async () => modelResponse({
      summary: "Authentication is handled in src/auth/session.ts.",
      explanation: "Start with the exported session logic, then follow its callers.",
      evidencePaths: ["src/auth/session.ts"],
    })) as unknown as typeof fetch;

    const answer = await synthesizeAgentAnswer(freeAnswer, { apiKey: "test-key", fetcher });

    expect(answer).toMatchObject({
      mode: "gpt-5.6",
      model: "gpt-5.6",
      evidencePaths: ["src/auth/session.ts"],
    });
    expect(fetcher).toHaveBeenCalledOnce();

    const [url, init] = vi.mocked(fetcher).mock.calls[0];
    const body = JSON.parse(String(init?.body));
    expect(url).toBe("https://api.openai.com/v1/responses");
    expect(init?.headers).toMatchObject({ Authorization: "Bearer test-key" });
    expect(body).toMatchObject({
      model: "gpt-5.6",
      store: false,
      reasoning: { effort: "medium" },
      text: { format: { type: "json_schema", strict: true } },
    });
  });

  it("rejects a model path that was not supplied by a deterministic tool", async () => {
    const fetcher = vi.fn(async () => modelResponse({
      summary: "Use a path that does not exist.",
      explanation: "This answer should be discarded.",
      evidencePaths: ["src/invented.ts"],
    })) as unknown as typeof fetch;

    await expect(synthesizeAgentAnswer(freeAnswer, { apiKey: "test-key", fetcher })).resolves.toBe(freeAnswer);
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
    })) as unknown as typeof fetch;

    const answer = await synthesizeAgentAnswer(freeAnswer, { apiKey: "test-key", fetcher });
    expect(answer.summary).toBe("Authentication, start with the session file.");
    expect(answer.explanation).toBe("Open it, then follow its callers.");
  });
});
