import type { RepoMap, WayfinderErrorCode } from "@wayfinder/contracts";
import { z } from "zod";
import { createAgentAnswer } from "./agent";
import { createRepoMap, GitHubApiError } from "./github";
import { createFileFind } from "./find";
import { createInstallGuide } from "./install";
import { generateTour } from "./tour";

interface Env {
  GITHUB_TOKEN?: string;
}

const mapRequestSchema = z.object({
  owner: z.string().min(1).max(100).regex(/^[a-zA-Z0-9_.-]+$/),
  repo: z.string().min(1).max(100).regex(/^[a-zA-Z0-9_.-]+$/),
});

const repoMapSchema = z.object({
  repo: z.string().min(3),
  sha: z.string().min(7),
  defaultBranch: z.string().min(1),
  description: z.string().nullable(),
  homepage: z.string().nullable(),
  language: z.string().nullable(),
  stars: z.number().nonnegative(),
  readme: z.string().nullable(),
  tree: z.array(z.object({
    path: z.string().min(1),
    type: z.enum(["blob", "tree"]),
    size: z.number().nonnegative().optional(),
  })).max(4_000),
  setupFiles: z.array(z.string().min(1)).max(200),
  truncated: z.boolean(),
  generatedAt: z.string().min(1),
});

const tourRequestSchema = z.object({ map: repoMapSchema });
const installRequestSchema = z.object({ map: repoMapSchema });
const findRequestSchema = z.object({
  map: repoMapSchema,
  query: z.string().trim().min(2).max(240),
  currentPath: z.string().max(1_000).nullable().optional(),
});
const agentRequestSchema = findRequestSchema;

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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });

    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return json({ ok: true, service: "wayfinder-api" });
    }

    if (request.method === "POST" && url.pathname === "/map") {
      try {
        const input = mapRequestSchema.parse(await request.json());
        return json(await createRepoMap(input.owner, input.repo, env.GITHUB_TOKEN));
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
        return json(await createInstallGuide(input.map as RepoMap, env.GITHUB_TOKEN));
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
        return json(await createAgentAnswer(input.map as RepoMap, input.query, input.currentPath ?? null, env.GITHUB_TOKEN));
      } catch (error) {
        return requestFailure(error, "agent_answer_failed");
      }
    }

    return json({ error: "not_found" }, 404);
  },
} satisfies ExportedHandler<Env>;
