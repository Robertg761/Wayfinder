import type { RepoMap, WayfinderErrorCode } from "@wayfinder/contracts";
import { z } from "zod";
import { classifyAgentIntent, createAgentAnswer, hasSpecificContributionGoal } from "./agent";
import { createRepoMap, GitHubApiError } from "./github";
import { createFileFind } from "./find";
import { createInstallGuide } from "./install";
import { generateTour } from "./tour";
import { WAYFINDER_MODEL, type ReasoningEffort } from "./model";
import {
  actualCostMicroUsd,
  budgetLimitMicroUsd,
  ModelBudget,
  reserveCostMicroUsd,
} from "./budget";

export { ModelBudget };

interface Env {
  GITHUB_TOKEN?: string;
  OPENAI_API_KEY?: string;
  OPENAI_REASONING_EFFORT?: string;
  MODEL_BUDGET_USD?: string;
  MODEL_RATE_LIMITER?: RateLimit;
  API_RATE_LIMITER?: RateLimit;
  MODEL_BUDGET?: DurableObjectNamespace;
  CF_VERSION_METADATA?: {
    id: string;
    tag: string;
    timestamp: string;
  };
}

const mapRequestSchema = z.object({
  owner: z.string().min(1).max(100).regex(/^(?!\.{1,2}$)[a-zA-Z0-9_.-]+$/),
  repo: z.string().min(1).max(100).regex(/^(?!\.{1,2}$)[a-zA-Z0-9_.-]+$/),
  ref: z.string().trim().min(1).max(255).regex(/^(?!\.|\/)(?!.*(?:^|\/)\.\.?\/?$)[^\u0000-\u001f\u007f~^:?*[\\]+$/).nullable().optional(),
});

const repositoryPathSchema = z.string()
  .min(1)
  .max(1_000)
  .refine((path) =>
    !path.startsWith("/") &&
    !/[\u0000-\u001f\u007f]/.test(path) &&
    path.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== ".."),
  { message: "Repository paths must be normalized relative paths." });

const repoMapSchema = z.object({
  repo: z.string().min(3).max(201).regex(/^(?!\.{1,2}\/)(?!.*\/\.{1,2}$)[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/),
  sha: z.string().regex(/^[a-f0-9]{7,64}$/i),
  requestedRef: z.string().min(1).max(255).nullable(),
  resolvedRef: z.string().min(1).max(255),
  defaultBranch: z.string().min(1).max(255),
  description: z.string().max(500).nullable(),
  homepage: z.string().max(2_048).nullable(),
  language: z.string().max(100).nullable(),
  stars: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  readme: z.string().max(16_000).nullable(),
  tree: z.array(z.object({
    path: repositoryPathSchema,
    type: z.enum(["blob", "tree"]),
    size: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
  })).max(4_000),
  setupFiles: z.array(repositoryPathSchema).max(200),
  truncated: z.boolean(),
  generatedAt: z.string().datetime(),
});

const tourRequestSchema = z.object({ map: repoMapSchema });
const installRequestSchema = z.object({
  map: repoMapSchema,
  audience: z.enum(["use", "develop"]).optional(),
});
const findRequestSchema = z.object({
  map: repoMapSchema,
  query: z.string().trim().min(2).max(240),
  currentPath: repositoryPathSchema.nullable().optional(),
});
const agentRequestSchema = findRequestSchema;
const MODEL_BUDGET_LEDGER_NAME = "luna-lifetime-v3";

const corsHeaders = {
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Origin": "*",
};

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: corsHeaders });
}

function requestFailure(error: unknown, fallbackError: string, fallbackStatus = 500): Response {
  if (error instanceof z.ZodError) return json({ error: "invalid_request", issues: error.issues }, 400);
  if (error instanceof SyntaxError) {
    return json({
      error: "invalid_json",
      code: "request-failed",
      message: "Request body must be valid JSON.",
    }, 400);
  }
  if (error instanceof GitHubApiError) {
    const status = error.code === "github-rate-limited" ? 429 : error.status;
    return json({
      error: "github_request_failed",
      code: error.code,
      message: error.message,
      ...(error.resetAt ? { resetAt: error.resetAt } : {}),
    }, status);
  }
  const message = error instanceof Error ? error.message : "Unknown error";
  const code: WayfinderErrorCode = "request-failed";
  return json({ error: fallbackError, code, message }, fallbackStatus);
}

async function publicApiGate(request: Request, env: Env, path: string): Promise<Response | null> {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > 1_500_000) {
    return json({
      error: "request_too_large",
      code: "request-failed",
      message: "The repository request is too large to process safely.",
    }, 413);
  }
  if (!env.API_RATE_LIMITER) return null;

  const clientKey = request.headers.get("cf-connecting-ip")?.trim() || "unknown-client";
  try {
    const { success } = await env.API_RATE_LIMITER.limit({ key: path + ":" + clientKey });
    if (success) return null;
    return json({
      error: "service_rate_limited",
      code: "service-rate-limited",
      message: "Wayfinder is receiving too many requests from this connection. Wait a minute, then try again.",
    }, 429);
  } catch {
    return json({
      error: "request_guard_unavailable",
      code: "upstream-unavailable",
      message: "Wayfinder's request guard is temporarily unavailable. Try again shortly.",
    }, 503);
  }
}

interface ModelBudgetStub {
  fetch(input: string, init?: RequestInit): Promise<Response>;
}

export function createBudgetedModelFetcher(
  budget: ModelBudgetStub,
  limitMicroUsd: number,
  upstreamFetcher: typeof fetch = fetch,
  reservationIdFactory: () => string = () => crypto.randomUUID(),
): typeof fetch {
  return async (input, init) => {
    const requestBody = typeof init?.body === "string" ? init.body : "";
    const reservationId = reservationIdFactory();
    const amountMicroUsd = reserveCostMicroUsd(requestBody);
    const settleReservation = async (actualMicroUsd: number) => {
      try {
        await budget.fetch("https://budget.internal/settle", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reservationId, actualMicroUsd }),
        });
      } catch {
        // A failed settlement intentionally remains conservatively reserved.
      }
    };

    let reservation: Response;
    try {
      reservation = await budget.fetch("https://budget.internal/reserve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reservationId, amountMicroUsd, limitMicroUsd }),
      });
    } catch {
      return new Response("Model budget unavailable", { status: 503 });
    }
    const reservationResult = await reservation.json().catch(() => null) as { success?: boolean } | null;
    if (!reservation.ok || !reservationResult?.success) {
      return new Response("Model budget unavailable", { status: 429 });
    }

    let response: Response;
    try {
      response = await upstreamFetcher(input, init);
    } catch {
      // The upstream may have accepted the request before the connection failed,
      // so charge the full conservative reservation rather than leaking it.
      await settleReservation(amountMicroUsd);
      return new Response("Model upstream unavailable", { status: 503 });
    }
    if (response.ok) {
      const responseBody: unknown = await response.clone().json().catch(() => null);
      const actualMicroUsd = actualCostMicroUsd(responseBody);
      await settleReservation(actualMicroUsd ?? amountMicroUsd);
    } else {
      // Non-success API responses contain no model usage.
      await settleReservation(0);
    }
    return response;
  };
}

async function modelOptions(request: Request, env: Env): Promise<{
  apiKey: string;
  reasoningEffort: ReasoningEffort;
  fetcher: typeof fetch;
} | undefined> {
  const apiKey = env.OPENAI_API_KEY?.trim();
  if (!apiKey || !env.MODEL_RATE_LIMITER || !env.MODEL_BUDGET) return undefined;

  const clientKey = request.headers.get("cf-connecting-ip")?.trim() || "unknown-client";
  try {
    const { success } = await env.MODEL_RATE_LIMITER.limit({ key: "agent:" + clientKey });
    const configuredEffort = env.OPENAI_REASONING_EFFORT?.trim();
    const reasoningEffort: ReasoningEffort = configuredEffort === "medium" || configuredEffort === "high"
      ? configuredEffort
      : "low";
    if (!success) return undefined;

    const budgetId = env.MODEL_BUDGET.idFromName(MODEL_BUDGET_LEDGER_NAME);
    const budget = env.MODEL_BUDGET.get(budgetId);
    const fetcher = createBudgetedModelFetcher(budget, budgetLimitMicroUsd(env.MODEL_BUDGET_USD));

    return { apiKey, reasoningEffort, fetcher };
  } catch {
    return undefined;
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });

    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      const modelConfigured = Boolean(env.OPENAI_API_KEY?.trim());
      const modelProtected = Boolean(env.MODEL_RATE_LIMITER);
      const apiProtected = Boolean(env.API_RATE_LIMITER);
      let modelBudgetProtected = false;
      let modelBudget: Record<string, number> | undefined;
      if (env.MODEL_BUDGET) {
        try {
          const budget = env.MODEL_BUDGET.get(env.MODEL_BUDGET.idFromName(MODEL_BUDGET_LEDGER_NAME));
          const limitUsd = budgetLimitMicroUsd(env.MODEL_BUDGET_USD) / 1_000_000;
          const status = await budget.fetch("https://budget.internal/status?limitUsd=" + limitUsd);
          const body = await status.json() as {
            spentMicroUsd: number;
            reservedMicroUsd: number;
            limitMicroUsd: number;
            remainingMicroUsd: number;
          };
          modelBudget = {
            spentUsd: body.spentMicroUsd / 1_000_000,
            reservedUsd: body.reservedMicroUsd / 1_000_000,
            limitUsd: body.limitMicroUsd / 1_000_000,
            remainingUsd: body.remainingMicroUsd / 1_000_000,
          };
          modelBudgetProtected = true;
        } catch {
          modelBudget = undefined;
        }
      }
      return json({
        ok: true,
        service: "wayfinder-api",
        apiProtected,
        modelConfigured,
        modelProtected,
        modelBudgetProtected,
        modelEnabled: modelConfigured && modelProtected && modelBudgetProtected,
        model: WAYFINDER_MODEL,
        reasoningEffort: env.OPENAI_REASONING_EFFORT === "medium" || env.OPENAI_REASONING_EFFORT === "high"
          ? env.OPENAI_REASONING_EFFORT
          : "low",
        ...(env.CF_VERSION_METADATA ? { deployment: env.CF_VERSION_METADATA } : {}),
        ...(modelBudget ? { modelBudget } : {}),
      });
    }

    if (request.method === "POST" && ["/map", "/tour", "/guide/install", "/find", "/agent"].includes(url.pathname)) {
      const gated = await publicApiGate(request, env, url.pathname);
      if (gated) return gated;
    }

    if (request.method === "POST" && url.pathname === "/map") {
      try {
        const input = mapRequestSchema.parse(await request.json());
        return json(await createRepoMap(input.owner, input.repo, input.ref ?? null, env.GITHUB_TOKEN));
      } catch (error) {
        return requestFailure(error, "map_failed", 502);
      }
    }

    if (request.method === "POST" && url.pathname === "/tour") {
      try {
        const input = tourRequestSchema.parse(await request.json());
        return json(generateTour(input.map as RepoMap));
      } catch (error) {
        return requestFailure(error, "tour_failed");
      }
    }

    if (request.method === "POST" && url.pathname === "/guide/install") {
      try {
        const input = installRequestSchema.parse(await request.json());
        return json(await createInstallGuide(input.map as RepoMap, env.GITHUB_TOKEN, input.audience ?? "develop"));
      } catch (error) {
        return requestFailure(error, "install_guide_failed");
      }
    }

    if (request.method === "POST" && url.pathname === "/find") {
      try {
        const input = findRequestSchema.parse(await request.json());
        return json(await createFileFind(input.map as RepoMap, input.query, input.currentPath ?? null, env.GITHUB_TOKEN));
      } catch (error) {
        return requestFailure(error, "file_find_failed");
      }
    }

    if (request.method === "POST" && url.pathname === "/agent") {
      try {
        const input = agentRequestSchema.parse(await request.json());
        const allowedModel = classifyAgentIntent(input.query) === "contribution" && hasSpecificContributionGoal(input.query)
          ? await modelOptions(request, env)
          : undefined;
        return json(await createAgentAnswer(
          input.map as RepoMap,
          input.query,
          input.currentPath ?? null,
          env.GITHUB_TOKEN,
          allowedModel,
        ));
      } catch (error) {
        return requestFailure(error, "agent_answer_failed");
      }
    }

    return json({ error: "not_found" }, 404);
  },
} satisfies ExportedHandler<Env>;
