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

const installationAnswer: AgentAnswer = {
  repo: "example/trail",
  sha: "abc1234567890",
  query: "How do I develop this repository?",
  intent: "installation",
  mode: "free",
  summary: "Follow the documented local setup.",
  suggestions: [],
  generatedAt: "2026-07-13T00:00:00.000Z",
  guide: {
    repo: "example/trail",
    sha: "abc1234567890",
    audience: "develop",
    packageManager: "npm",
    runtimes: [],
    prerequisites: [],
    steps: [{
      order: 1,
      title: "Start the mock server",
      command: "node scripts/mock",
      evidence: { path: "package.json", lines: [1, 20] },
      confidence: "documented",
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
      text: {
        format: {
          type: "json_schema",
          strict: true,
          schema: {
            properties: {
              summary: { maxLength: 420 },
              explanation: { maxLength: 1_200 },
              evidencePaths: { maxItems: 5, items: { enum: ["src/auth/session.ts"] } },
              brief: {
                maxItems: 4,
                items: { properties: { evidencePath: { anyOf: [{ enum: ["src/auth/session.ts"] }, { type: "null" }] } } },
              },
            },
          },
        },
      },
    });
    expect(JSON.parse(body.input)).toMatchObject({
      allowedEvidencePaths: ["src/auth/session.ts"],
      allowedCommands: [],
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

    await expect(synthesizeAgentAnswer(freeAnswer, { apiKey: "test-key", fetcher })).resolves.toMatchObject({
      mode: "free",
      modelFallbackReason: "unsupported-evidence-path",
    });
  });

  it("rejects invented paths even when the model omits them from evidencePaths", async () => {
    const fetcher = vi.fn(async () => modelResponse({
      summary: "Authentication is also implemented in src/invented.ts.",
      explanation: "The invented path should invalidate the synthesis.",
      evidencePaths: ["src/auth/session.ts"],
      brief: [],
    })) as unknown as typeof fetch;

    await expect(synthesizeAgentAnswer(freeAnswer, { apiKey: "test-key", fetcher })).resolves.toMatchObject({
      mode: "free",
      modelFallbackReason: "unsupported-prose-path:src/invented.ts",
    });
  });

  it("allows the deterministic repository identity in model prose", async () => {
    const fetcher = vi.fn(async () => modelResponse({
      summary: "In example/trail, authentication is handled in src/auth/session.ts.",
      explanation: "Start with the supplied implementation coordinate.",
      evidencePaths: ["src/auth/session.ts"],
      brief: [],
    })) as unknown as typeof fetch;

    await expect(synthesizeAgentAnswer(freeAnswer, { apiKey: "test-key", fetcher })).resolves.toMatchObject({
      mode: "gpt-5.6",
      summary: "In example/trail, authentication is handled in src/auth/session.ts.",
    });
  });

  it("allows a code-formatted term that appears in deterministic evidence", async () => {
    const fetcher = vi.fn(async () => modelResponse({
      summary: "Start with the `session` implementation in src/auth/session.ts.",
      explanation: "The supplied finder reason identifies the exported session logic.",
      evidencePaths: ["src/auth/session.ts"],
      brief: [],
    })) as unknown as typeof fetch;

    await expect(synthesizeAgentAnswer(freeAnswer, { apiKey: "test-key", fetcher })).resolves.toMatchObject({
      mode: "gpt-5.6",
    });
  });

  it("rejects a code-formatted term absent from deterministic evidence", async () => {
    const fetcher = vi.fn(async () => modelResponse({
      summary: "Start with `inventedSessionFactory` in src/auth/session.ts.",
      explanation: "The symbol does not occur in deterministic evidence.",
      evidencePaths: ["src/auth/session.ts"],
      brief: [],
    })) as unknown as typeof fetch;

    await expect(synthesizeAgentAnswer(freeAnswer, { apiKey: "test-key", fetcher })).resolves.toMatchObject({
      mode: "free",
      modelFallbackReason: "unsupported-code-span",
    });
  });

  it("rejects commands that are absent from deterministic repository evidence", async () => {
    const fetcher = vi.fn(async () => modelResponse({
      summary: "Authentication is handled in src/auth/session.ts.",
      explanation: "Run rm -rf / before opening the file.",
      evidencePaths: ["src/auth/session.ts"],
      brief: [{ title: "Clean up", action: "Execute rm -rf /.", evidencePath: "src/auth/session.ts" }],
    })) as unknown as typeof fetch;

    await expect(synthesizeAgentAnswer(freeAnswer, { apiKey: "test-key", fetcher })).resolves.toMatchObject({
      mode: "free",
      modelFallbackReason: "unsupported-command",
    });
  });

  it("does not mistake a path argument inside an approved command for invented evidence", async () => {
    const fetcher = vi.fn(async () => modelResponse({
      summary: "Use the documented `node scripts/mock` command.",
      explanation: "The command is copied exactly from repository setup evidence.",
      evidencePaths: ["package.json"],
      brief: [{ title: "Start the mock", action: "Run `node scripts/mock`.", evidencePath: "package.json" }],
    })) as unknown as typeof fetch;

    await expect(synthesizeAgentAnswer(installationAnswer, { apiKey: "test-key", fetcher })).resolves.toMatchObject({
      mode: "gpt-5.6",
    });
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

    await expect(synthesizeAgentAnswer(possibleAnswer, { apiKey: "test-key", fetcher })).resolves.toMatchObject({
      mode: "free",
      modelFallbackReason: "unsupported-evidence-path",
    });
  });

  it("falls back to the free answer when OpenAI is unavailable", async () => {
    const fetcher = vi.fn(async () => new Response("unavailable", { status: 503 })) as unknown as typeof fetch;
    await expect(synthesizeAgentAnswer(freeAnswer, { apiKey: "test-key", fetcher })).resolves.toMatchObject({
      mode: "free",
      modelFallbackReason: "model-http-503",
    });
  });

  it("reports a safe processing stage when the model response cannot be read", async () => {
    const fetcher = vi.fn(async () => ({
      ok: true,
      json: async () => {
        throw new TypeError("sensitive upstream detail");
      },
    })) as unknown as typeof fetch;

    await expect(synthesizeAgentAnswer(freeAnswer, { apiKey: "test-key", fetcher })).resolves.toMatchObject({
      mode: "free",
      modelFallbackReason: "exception-response-body-TypeError",
    });
  });

  it("skips the model request when no API key is configured", async () => {
    const fetcher = vi.fn() as unknown as typeof fetch;
    await expect(synthesizeAgentAnswer(freeAnswer, { apiKey: "", fetcher })).resolves.toBe(freeAnswer);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("charges the model allowance immediately before the upstream call", async () => {
    const authorize = vi.fn(async () => true);
    const fetcher = vi.fn(async () => modelResponse({
      summary: "Authentication is handled in src/auth/session.ts.",
      explanation: "Start with the exported session logic.",
      evidencePaths: ["src/auth/session.ts"],
      brief: [],
    })) as unknown as typeof fetch;

    await expect(synthesizeAgentAnswer(freeAnswer, { apiKey: "test-key", fetcher, authorize })).resolves.toMatchObject({
      mode: "gpt-5.6",
    });
    expect(authorize).toHaveBeenCalledOnce();
    expect(authorize.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(fetcher).mock.invocationCallOrder[0]);
  });

  it("returns the deterministic answer without contacting the model when the allowance is exhausted", async () => {
    const fetcher = vi.fn() as unknown as typeof fetch;

    await expect(synthesizeAgentAnswer(freeAnswer, {
      apiKey: "test-key",
      fetcher,
      authorize: async () => false,
    })).resolves.toMatchObject({
      mode: "free",
      modelFallbackReason: "model-allowance-exhausted",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects unsupported commands suggested mid-sentence", async () => {
    const fetcher = vi.fn(async () => modelResponse({
      summary: "Authentication is handled in src/auth/session.ts.",
      explanation: "After reading it you can then npm install lodash to continue.",
      evidencePaths: ["src/auth/session.ts"],
      brief: [],
    })) as unknown as typeof fetch;

    await expect(synthesizeAgentAnswer(freeAnswer, { apiKey: "test-key", fetcher })).resolves.toMatchObject({
      mode: "free",
      modelFallbackReason: "unsupported-command",
    });
  });

  it("rejects shell-adjacent binaries missing from the original guard list", async () => {
    const cases = [
      "Prepare the environment, then bash setup.sh applies the settings.",
      "The maintainers suggest you first chmod +x it before use.",
      "Connect with ssh deploy@example.com to publish.",
    ];
    for (const explanation of cases) {
      const fetcher = vi.fn(async () => modelResponse({
        summary: "Authentication is handled in src/auth/session.ts.",
        explanation,
        evidencePaths: ["src/auth/session.ts"],
        brief: [],
      })) as unknown as typeof fetch;
      await expect(synthesizeAgentAnswer(freeAnswer, { apiKey: "test-key", fetcher })).resolves.toMatchObject({
        mode: "free",
        modelFallbackReason: "unsupported-command",
      });
    }
  });

  it("rejects ambiguous binaries only when they carry a command-shaped argument", async () => {
    const flagged = vi.fn(async () => modelResponse({
      summary: "Authentication is handled in src/auth/session.ts.",
      explanation: "The service starts once you go run it locally.",
      evidencePaths: ["src/auth/session.ts"],
      brief: [],
    })) as unknown as typeof fetch;
    await expect(synthesizeAgentAnswer(freeAnswer, { apiKey: "test-key", fetcher: flagged })).resolves.toMatchObject({
      mode: "free",
      modelFallbackReason: "unsupported-command",
    });

    const safe = vi.fn(async () => modelResponse({
      summary: "Authentication is handled in src/auth/session.ts.",
      explanation: "Each node in the session graph holds one credential, so it helps to just read the file first.",
      evidencePaths: ["src/auth/session.ts"],
      brief: [],
    })) as unknown as typeof fetch;
    await expect(synthesizeAgentAnswer(freeAnswer, { apiKey: "test-key", fetcher: safe })).resolves.toMatchObject({
      mode: "gpt-5.6",
    });
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
