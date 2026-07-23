import { afterEach, describe, expect, it, vi } from "vitest";
import worker, { createBudgetedModelFetcher } from "../src/index";
import { reserveCostMicroUsd } from "../src/budget";
import { CONTRACT_VERSION } from "@wayfinder/contracts";

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

  it("labels unknown routes with the shared error shape and contract version", async () => {
    const response = await worker.fetch(new Request("https://wayfinder.test/nope"), {});

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ error: "not_found", code: "request-failed" });
    expect(response.headers.get("X-Wayfinder-Contract-Version")).toBe(String(CONTRACT_VERSION));
  });

  it("gives contract violations a code and message alongside the issues", async () => {
    const response = await post("/tour", { map: { nope: true } });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "invalid_request",
      code: "request-failed",
      message: expect.stringContaining("contract"),
    });
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
      API_RATE_LIMITER: rateLimiter(true),
      MODEL_RATE_LIMITER: rateLimiter(true),
      MODEL_BUDGET: budgetNamespace(),
      MODEL_BUDGET_USD: "100",
    });

    await expect(configuredOnly.json()).resolves.toMatchObject({
      modelConfigured: true,
      apiProtected: false,
      modelProtected: false,
      modelEnabled: false,
      model: "gpt-5.6-luna",
      reasoningEffort: "low",
    });
    await expect(protectedModel.json()).resolves.toMatchObject({
      modelConfigured: true,
      apiProtected: false,
      modelProtected: true,
      modelBudgetProtected: false,
      modelEnabled: false,
      model: "gpt-5.6-luna",
      reasoningEffort: "low",
    });
    const fullBody = await fullyProtected.json() as Record<string, unknown>;
    expect(fullBody).toMatchObject({
      modelConfigured: true,
      apiProtected: true,
      modelProtected: true,
      modelBudgetProtected: true,
      modelEnabled: true,
    });
    expect(fullBody.modelBudget).toBeUndefined();
    expect(fullBody.deployment).toBeUndefined();
  });

  it("reveals budget and deployment details only to the diagnostics key holder", async () => {
    const env = {
      OPENAI_API_KEY: "secret",
      API_RATE_LIMITER: rateLimiter(true),
      MODEL_RATE_LIMITER: rateLimiter(true),
      MODEL_BUDGET: budgetNamespace(),
      MODEL_BUDGET_USD: "100",
      HEALTH_DIAGNOSTICS_KEY: "operator-key",
      CF_VERSION_METADATA: { id: "v-1", tag: "", timestamp: "2026-07-14T12:00:00.000Z" },
    };
    const withKey = await worker.fetch(new Request("https://wayfinder.test/health?diagnostics=operator-key"), env);
    const wrongKey = await worker.fetch(new Request("https://wayfinder.test/health?diagnostics=guess"), env);
    const noKeyConfigured = await worker.fetch(new Request("https://wayfinder.test/health?diagnostics="), {
      ...env,
      HEALTH_DIAGNOSTICS_KEY: undefined,
    });

    await expect(withKey.json()).resolves.toMatchObject({
      modelBudget: { spentUsd: 0.017336, limitUsd: 100, remainingUsd: 99.982664 },
      deployment: { id: "v-1" },
    });
    const wrongBody = await wrongKey.json() as Record<string, unknown>;
    expect(wrongBody.modelBudget).toBeUndefined();
    expect(wrongBody.deployment).toBeUndefined();
    const unconfiguredBody = await noKeyConfigured.json() as Record<string, unknown>;
    expect(unconfiguredBody.modelBudget).toBeUndefined();
    expect(unconfiguredBody.deployment).toBeUndefined();
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
    await expect(response.json()).resolves.toMatchObject({ mode: "deterministic", intent: "orientation" });
    expect(limiter.limit).not.toHaveBeenCalled();
  });

  it("does not spend a model allowance when no implementation coordinate exists", async () => {
    // The allowance is now charged immediately before the model call, so a
    // specific contribution goal that ends deterministically (no credible
    // implementation coordinate) never consumes it.
    const limiter = rateLimiter(false);
    const response = await worker.fetch(new Request("https://wayfinder.test/agent", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "cf-connecting-ip": "203.0.113.10",
      },
      body: JSON.stringify({ map: validMap({ tree: [] }), query: "I want to add pagination support", currentPath: null }),
    }), {
      OPENAI_API_KEY: "secret",
      MODEL_RATE_LIMITER: limiter,
      MODEL_BUDGET: budgetNamespace(),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ mode: "deterministic", intent: "contribution" });
    expect(limiter.limit).not.toHaveBeenCalled();
  });

  it("does not spend a model allowance on an underspecified contribution", async () => {
    const limiter = rateLimiter(true);
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
    await expect(response.json()).resolves.toMatchObject({ mode: "deterministic", intent: "contribution" });
    expect(limiter.limit).not.toHaveBeenCalled();
  });

  it("rate-limits deterministic public routes independently of model usage", async () => {
    const limiter = rateLimiter(false);
    const response = await worker.fetch(new Request("https://wayfinder.test/tour", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "cf-connecting-ip": "203.0.113.20",
      },
      body: JSON.stringify({ map: validMap() }),
    }), { API_RATE_LIMITER: limiter });

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toMatchObject({ code: "service-rate-limited" });
    expect(limiter.limit).toHaveBeenCalledWith({ key: "/tour:203.0.113.20" });
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

describe("request body and failure boundaries", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects an oversized request body with 413", async () => {
    const response = await worker.fetch(new Request("https://wayfinder.test/tour", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: '{"map":"' + "x".repeat(1_500_001) + '"}',
    }), {});

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({ error: "request_too_large", code: "request-failed" });
  });

  it("caps the streamed body even when no Content-Length header is present", async () => {
    const oversized = new TextEncoder().encode('{"map":"' + "x".repeat(1_500_001) + '"}');
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let offset = 0; offset < oversized.byteLength; offset += 65_536) {
          controller.enqueue(oversized.slice(offset, offset + 65_536));
        }
        controller.close();
      },
    });
    const request = new Request("https://wayfinder.test/tour", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      // @ts-expect-error duplex is required for stream bodies but absent from the lib types
      duplex: "half",
    });
    expect(request.headers.get("content-length")).toBeNull();

    const response = await worker.fetch(request, {});
    expect(response.status).toBe(413);
  });

  it("returns 503 when the request guard is unavailable", async () => {
    const limiter = {
      limit: vi.fn().mockRejectedValue(new Error("guard down")),
    } as unknown as RateLimit;
    const response = await worker.fetch(new Request("https://wayfinder.test/tour", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ map: validMap() }),
    }), { API_RATE_LIMITER: limiter });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ code: "upstream-unavailable" });
  });

  it("round-trips a freshly built map through downstream endpoint validation", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/repos/acme/widget")) {
        return Response.json({
          default_branch: "main",
          description: "d".repeat(600),
          homepage: null,
          language: "TypeScript",
          stargazers_count: 3,
        });
      }
      if (url.includes("/commits/")) return Response.json({ sha: "a".repeat(40) });
      if (url.includes("/git/trees/")) {
        return Response.json({
          sha: "a".repeat(40),
          truncated: false,
          tree: [
            { path: "src/index.ts", type: "blob", size: 10 },
            { path: "docs/" + "p".repeat(1_100) + ".md", type: "blob", size: 10 },
          ],
        });
      }
      if (url.includes("/readme")) return Response.json({ content: btoa("# Widget"), encoding: "base64" });
      return Response.json({ message: "not found" }, { status: 404 });
    }));

    const mapResponse = await post("/map", { owner: "acme", repo: "widget" });
    expect(mapResponse.status).toBe(200);
    const map = await mapResponse.json();

    vi.unstubAllGlobals();
    const tourResponse = await post("/tour", { map });
    expect(tourResponse.status).toBe(200);
  });

  it("does not echo internal error detail for uncaught failures", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/repos/acme/widget")) {
        return Response.json({ default_branch: "main", description: null, homepage: null, language: null, stargazers_count: 1 });
      }
      if (url.includes("/commits/")) return Response.json({ sha: "a".repeat(40) });
      if (url.includes("/git/trees/")) return Response.json({ sha: "a".repeat(40), truncated: false, tree: [] });
      if (url.includes("/readme")) return Response.json({ content: "%%%not-base64%%%", encoding: "base64" });
      return Response.json({ message: "not found" }, { status: 404 });
    }));

    const response = await post("/map", { owner: "acme", repo: "widget" });
    expect(response.status).toBe(502);
    const body = await response.json() as { error: string; message: string };
    expect(body.error).toBe("map_failed");
    expect(body.message).toBe("Wayfinder could not complete this request. Try again shortly.");
    expect(body.message).not.toMatch(/invalid|character|atob/i);
  });
});

describe("budgeted model fetcher", () => {
  function recordingBudget() {
    return {
      fetch: vi.fn(async (_input: string, _init?: RequestInit) => Response.json({ success: true })),
    };
  }

  function requestBody(call: [string, RequestInit?]): Record<string, unknown> {
    return JSON.parse(String(call[1]?.body)) as Record<string, unknown>;
  }

  it("reconciles a successful model response to reported usage", async () => {
    const budget = recordingBudget();
    const upstream = vi.fn(async () => Response.json({
      usage: {
        input_tokens: 2_000,
        output_tokens: 300,
        input_tokens_details: { cached_tokens: 1_000 },
      },
    })) as unknown as typeof fetch;
    const fetcher = createBudgetedModelFetcher(budget, 100_000_000, upstream, () => "request-1");

    const response = await fetcher("https://api.openai.com/v1/responses", { method: "POST", body: "{}" });

    expect(response.ok).toBe(true);
    expect(budget.fetch).toHaveBeenCalledTimes(2);
    expect(requestBody(budget.fetch.mock.calls[1])).toEqual({ reservationId: "request-1", actualMicroUsd: 2_900 });
  });

  it("releases a reservation after a non-success model response", async () => {
    const budget = recordingBudget();
    const upstream = vi.fn(async () => new Response("invalid", { status: 400 })) as unknown as typeof fetch;
    const fetcher = createBudgetedModelFetcher(budget, 100_000_000, upstream, () => "request-2");

    const response = await fetcher("https://api.openai.com/v1/responses", { method: "POST", body: "{}" });

    expect(response.status).toBe(400);
    expect(requestBody(budget.fetch.mock.calls[1])).toEqual({ reservationId: "request-2", actualMicroUsd: 0 });
  });

  it("registers settlements with waitUntil so they survive client disconnects", async () => {
    const budget = recordingBudget();
    const registered: Promise<unknown>[] = [];
    const upstream = vi.fn(async () => Response.json({
      usage: { input_tokens: 100, output_tokens: 10 },
    })) as unknown as typeof fetch;
    const fetcher = createBudgetedModelFetcher(budget, 100_000_000, upstream, () => "request-w", (promise) => {
      registered.push(promise);
    });

    await fetcher("https://api.openai.com/v1/responses", { method: "POST", body: "{}" });

    expect(registered).toHaveLength(1);
    await registered[0];
    expect(budget.fetch).toHaveBeenCalledTimes(2);
  });

  it("charges the conservative reservation after an ambiguous upstream failure", async () => {
    const budget = recordingBudget();
    const upstream = vi.fn(async () => {
      throw new Error("network interrupted");
    }) as unknown as typeof fetch;
    const body = JSON.stringify({ model: "gpt-5.6-luna" });
    const fetcher = createBudgetedModelFetcher(budget, 100_000_000, upstream, () => "request-3");

    const response = await fetcher("https://api.openai.com/v1/responses", { method: "POST", body });

    expect(response.status).toBe(503);
    expect(requestBody(budget.fetch.mock.calls[1])).toEqual({
      reservationId: "request-3",
      actualMicroUsd: reserveCostMicroUsd(body),
    });
  });
});
