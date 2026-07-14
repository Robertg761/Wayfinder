import type { RepoMap } from "@wayfinder/contracts";
import { z } from "zod";
import { createRepoMap } from "./github";
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

const corsHeaders = {
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Origin": "*",
};

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: corsHeaders });
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
        if (error instanceof z.ZodError) return json({ error: "invalid_request", issues: error.issues }, 400);
        const message = error instanceof Error ? error.message : "Unknown error";
        return json({ error: "map_failed", message }, 502);
      }
    }

    if (request.method === "POST" && url.pathname === "/tour") {
      try {
        const input = tourRequestSchema.parse(await request.json());
        return json(generateTour(input.map as RepoMap));
      } catch (error) {
        if (error instanceof z.ZodError) return json({ error: "invalid_request", issues: error.issues }, 400);
        const message = error instanceof Error ? error.message : "Unknown error";
        return json({ error: "tour_failed", message }, 500);
      }
    }

    if (request.method === "POST" && url.pathname === "/guide/install") {
      try {
        const input = installRequestSchema.parse(await request.json());
        return json(await createInstallGuide(input.map as RepoMap, env.GITHUB_TOKEN));
      } catch (error) {
        if (error instanceof z.ZodError) return json({ error: "invalid_request", issues: error.issues }, 400);
        const message = error instanceof Error ? error.message : "Unknown error";
        return json({ error: "install_guide_failed", message }, 500);
      }
    }

    return json({ error: "not_found" }, 404);
  },
} satisfies ExportedHandler<Env>;
