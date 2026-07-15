import { describe, expect, it, vi } from "vitest";
import worker from "../src/index";

function validMap(overrides: Record<string, unknown> = {}) {
  return {
    repo: "openai/openai-node",
    sha: "a".repeat(40),
    requestedRef: null,
    resolvedRef: "main",
    defaultBranch: "main",
    description: null,
    homepage: null,
    language: "TypeScript",
    stars: 1,
    readme: "# OpenAI Node",
    tree: [{ path: "src/index.ts", type: "blob", size: 100 }],
    setupFiles: [],
    truncated: false,
    generatedAt: "2026-07-14T12:00:00.000Z",
    ...overrides,
  };
}

async function post(path: string, body: unknown): Promise<Response> {
  return worker.fetch(new Request("https://wayfinder.test" + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }), {});
}

function rateLimiter(success: boolean): RateLimit {
  return {
    limit: vi.fn().mockResolvedValue({ success }),
  } as unknown as RateLimit;
}

function budgetNamespace(): DurableObjectNamespace {
  const stub = {
    fetch: vi.fn(async () => Response.json({
      spentMicroUsd: 17_336,
      reservedMicroUsd: 0,
      limitMicroUsd: 100_000_000,
      remainingMicroUsd: 99_982_664,
    })),
  };
  return {
    idFromName: vi.fn(() => ({ toString: () => "budget-id" })),
    get: vi.fn(() => stub),
  } as unknown as DurableObjectNamespace;
}

describe("public API request boundaries", () => {
  it("accepts a normalized repository map", async () => {
    const response = await post("/tour", { map: validMap() });

    expect(response.status).toBe(200);
  });

  it("rejects traversal and absolute repository paths", async () => {
    const traversal = await post("/tour", {
      map: validMap({ tree: [{ path: "src/../secrets.ts", type: "blob" }] }),
    });
    const absolute = await post("/tour", {
      map: validMap({ setupFiles: ["/README.md"] }),
    });

    expect(traversal.status).toBe(400);
    expect(absolute.status).toBe(400);
  });

  it("rejects oversized text and malformed repository identities", async () => {
    const oversized = await post("/tour", { map: validMap({ readme: "x".repeat(16_001) }) });
    const malformedSha = await post("/tour", { map: validMap({ sha: "not-a-sha" }) });
    const traversalOwner = await post("/map", { owner: "..", repo: "example" });

    expect(oversized.status).toBe(400);
    expect(malformedSha.status).toBe(400);
    expect(traversalOwner.status).toBe(400);
  });

  it("returns a client error for malformed JSON", async () => {
    const response = await worker.fetch(new Request("https://wayfinder.test/tour", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not-json",
    }), {});

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "invalid_json" });
  });

  it("reports model protection separately from secret configuration", async () => {
    const configuredOnly = await worker.fetch(new Request("https://wayfinder.test/health"), {
      OPENAI_API_KEY: "secret",
    });
    const protectedModel = await worker.fetch(new Request("https://wayfinder.test/health"), {
      OPENAI_API_KEY: "secret",
      MODEL_RATE_LIMITER: rateLimiter(true),
    });
    const fullyProtected = await worker.fetch(new Request("https://wayfinder.test/health"), {
      OPENAI_API_KEY: "secret",
      MODEL_RATE_LIMITER: rateLimiter(true),
      MODEL_BUDGET: budgetNamespace(),
      MODEL_BUDGET_USD: "100",
    });

    await expect(configuredOnly.json()).resolves.toMatchObject({
      modelConfigured: true,
      modelProtected: false,
      modelEnabled: false,
      model: "gpt-5.6-luna",
      reasoningEffort: "low",
    });
    await expect(protectedModel.json()).resolves.toMatchObject({
      modelConfigured: true,
      modelProtected: true,
      modelBudgetProtected: false,
      modelEnabled: false,
      model: "gpt-5.6-luna",
      reasoningEffort: "low",
    });
    await expect(fullyProtected.json()).resolves.toMatchObject({
      modelConfigured: true,
      modelProtected: true,
      modelBudgetProtected: true,
      modelEnabled: true,
      modelBudget: {
        spentUsd: 0.017336,
        limitUsd: 100,
        remainingUsd: 99.982664,
      },
    });
  });

  it("does not spend a model allowance on a focused deterministic question", async () => {
    const limiter = rateLimiter(false);
    const response = await worker.fetch(new Request("https://wayfinder.test/agent", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "cf-connecting-ip": "203.0.113.10",
      },
      body: JSON.stringify({ map: validMap(), query: "What does this project do?", currentPath: null }),
    }), {
      OPENAI_API_KEY: "secret",
      MODEL_RATE_LIMITER: limiter,
      MODEL_BUDGET: budgetNamespace(),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ mode: "free", intent: "orientation" });
    expect(limiter.limit).not.toHaveBeenCalled();
  });

  it("checks the model allowance for contribution planning", async () => {
    const limiter = rateLimiter(false);
    const response = await worker.fetch(new Request("https://wayfinder.test/agent", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "cf-connecting-ip": "203.0.113.10",
      },
      body: JSON.stringify({ map: validMap(), query: "Help me make my first contribution", currentPath: null }),
    }), {
      OPENAI_API_KEY: "secret",
      MODEL_RATE_LIMITER: limiter,
      MODEL_BUDGET: budgetNamespace(),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ mode: "free", intent: "contribution" });
    expect(limiter.limit).toHaveBeenCalledWith({ key: "agent:203.0.113.10" });
  });

  it("uses the configured Luna reasoning level only when it is supported", async () => {
    const medium = await worker.fetch(new Request("https://wayfinder.test/health"), {
      OPENAI_REASONING_EFFORT: "medium",
    });
    const unsupported = await worker.fetch(new Request("https://wayfinder.test/health"), {
      OPENAI_REASONING_EFFORT: "max",
    });

    await expect(medium.json()).resolves.toMatchObject({ reasoningEffort: "medium" });
    await expect(unsupported.json()).resolves.toMatchObject({ reasoningEffort: "low" });
  });
});
