import { z } from "zod";

// Bumped whenever a wire shape changes incompatibly. Served by the Worker as
// the X-Wayfinder-Contract-Version response header and a /health field; the
// extension sends its own version as X-Wayfinder-Extension-Version.
export const CONTRACT_VERSION = 2;

// Deployment endpoints shared by the extension build, tests, and scripts.
// (Plain .mjs scripts that cannot import TypeScript keep their own copy —
// update them together with these.)
export const WAYFINDER_PROD_API_URL = "https://wayfinder-api.hopit-robert.workers.dev";
export const WAYFINDER_DEV_API_URL = "http://localhost:8787";

// --- Extension-side navigation types (not wire shapes) ---------------------

export type GitHubView = "repo" | "tree" | "blob" | "other";

export interface RepoLocation {
  owner: string;
  repo: string;
  ref: string | null;
  path: string | null;
  view: GitHubView;
  url: string;
}

// --- Repository map --------------------------------------------------------

export const repositoryPathSchema = z.string()
  .min(1)
  .max(1_000)
  .refine((path) =>
    !path.startsWith("/") &&
    !/[\u0000-\u001f\u007f]/.test(path) &&
    path.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== ".."),
  { message: "Repository paths must be normalized relative paths." });

export const repoTreeEntrySchema = z.object({
  path: repositoryPathSchema,
  type: z.enum(["blob", "tree"]),
  size: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
});

export const repoMapSchema = z.object({
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
  tree: z.array(repoTreeEntrySchema).max(4_000),
  setupFiles: z.array(repositoryPathSchema).max(200),
  truncated: z.boolean(),
  generatedAt: z.string().datetime(),
});

export type RepoTreeEntry = z.infer<typeof repoTreeEntrySchema>;
export type RepoMap = z.infer<typeof repoMapSchema>;

// --- Tour ------------------------------------------------------------------

export const tourEntryPointSchema = z.object({
  path: z.string(),
  why: z.string(),
});

export const tourStopSchema = z.object({
  order: z.number().int(),
  title: z.string(),
  path: z.string(),
  lines: z.tuple([z.number(), z.number()]),
  explanation: z.string(),
  lookFor: z.string(),
});

export const repoTourSchema = z.object({
  repo: z.string(),
  sha: z.string(),
  summary: z.string(),
  stack: z.array(z.string()),
  runtimeEntryPoint: tourEntryPointSchema.nullable(),
  entryPoints: z.array(tourEntryPointSchema),
  stops: z.array(tourStopSchema),
});

export type TourEntryPoint = z.infer<typeof tourEntryPointSchema>;
export type TourStop = z.infer<typeof tourStopSchema>;
export type RepoTour = z.infer<typeof repoTourSchema>;

// --- Install guide ---------------------------------------------------------

export const installConfidenceSchema = z.enum(["documented", "inferred", "conflicting"]);
export const installCommandCautionSchema = z.enum(["elevated-privileges", "pipe-to-shell", "external-download"]);

export const installEvidenceSchema = z.object({
  path: z.string(),
  lines: z.tuple([z.number(), z.number()]).optional(),
});

export const installPrerequisiteSchema = z.object({
  text: z.string(),
  evidence: installEvidenceSchema,
  confidence: installConfidenceSchema,
});

export const installStepSchema = z.object({
  order: z.number().int(),
  title: z.string(),
  command: z.string(),
  evidence: installEvidenceSchema,
  confidence: installConfidenceSchema,
  caution: installCommandCautionSchema.optional(),
});

export const installGuideSchema = z.object({
  repo: z.string(),
  sha: z.string(),
  audience: z.enum(["use", "develop"]),
  packageManager: z.string().nullable(),
  runtimes: z.array(z.string()),
  prerequisites: z.array(installPrerequisiteSchema),
  steps: z.array(installStepSchema),
  warnings: z.array(z.string()),
  generatedAt: z.string(),
});

export type InstallConfidence = z.infer<typeof installConfidenceSchema>;
export type InstallCommandCaution = z.infer<typeof installCommandCautionSchema>;
export type InstallEvidence = z.infer<typeof installEvidenceSchema>;
export type InstallPrerequisite = z.infer<typeof installPrerequisiteSchema>;
export type InstallStep = z.infer<typeof installStepSchema>;
export type InstallGuide = z.infer<typeof installGuideSchema>;

// --- File find -------------------------------------------------------------

export const fileMatchSignalSchema = z.enum([
  "filename",
  "path",
  "alias",
  "content",
  "symbol",
  "primary-language",
  "current-directory",
  "test-pair",
  "architecture",
  "deprecated",
  "re-export",
]);

export const fileMatchConfidenceSchema = z.enum(["strong", "likely", "possible"]);

export const fileMatchSchema = z.object({
  path: z.string(),
  score: z.number(),
  confidence: fileMatchConfidenceSchema,
  reason: z.string(),
  signals: z.array(fileMatchSignalSchema),
  lines: z.tuple([z.number(), z.number()]).optional(),
  snippet: z.string().optional(),
});

export const fileFindResponseSchema = z.object({
  repo: z.string(),
  sha: z.string(),
  query: z.string(),
  currentPath: z.string().nullable(),
  results: z.array(fileMatchSchema),
  warnings: z.array(z.string()),
  generatedAt: z.string(),
});

export type FileMatchSignal = z.infer<typeof fileMatchSignalSchema>;
export type FileMatchConfidence = z.infer<typeof fileMatchConfidenceSchema>;
export type FileMatch = z.infer<typeof fileMatchSchema>;
export type FileFindResponse = z.infer<typeof fileFindResponseSchema>;

// --- Agent answers ---------------------------------------------------------

export const contributionTrailSchema = z.object({
  repo: z.string(),
  sha: z.string(),
  goal: z.string(),
  tour: repoTourSchema,
  guide: installGuideSchema,
  implementation: fileFindResponseSchema,
  verification: fileFindResponseSchema,
  generatedAt: z.string(),
});

export const agentBriefStepSchema = z.object({
  title: z.string(),
  action: z.string(),
  evidencePath: z.string().nullable(),
});

export const agentModelUsageSchema = z.object({
  inputTokens: z.number(),
  cachedInputTokens: z.number(),
  outputTokens: z.number(),
  reasoningTokens: z.number(),
  totalTokens: z.number(),
  latencyMs: z.number(),
  estimatedCostUsd: z.number(),
});

export const fileContextFocusSchema = z.enum(["summary", "dependencies", "callers", "tests", "impact"]);
export const repositoryFileKindSchema = z.enum(["source", "test", "documentation", "configuration", "data", "other"]);
export const agentIntentSchema = z.enum(["orientation", "installation", "file-find", "file-context", "contribution"]);
// "deterministic" answers use only the repository tools; "model" answers
// add a GPT synthesis. The specific model id travels in the `model` field so
// the wire contract does not bake in a model name.
export const agentModeSchema = z.enum(["deterministic", "model"]);

const agentAnswerBaseShape = {
  repo: z.string(),
  sha: z.string(),
  query: z.string(),
  mode: agentModeSchema,
  model: z.string().optional(),
  reasoningEffort: z.enum(["low", "medium", "high"]).optional(),
  modelFallbackReason: z.string().optional(),
  usage: agentModelUsageSchema.optional(),
  summary: z.string(),
  explanation: z.string().optional(),
  evidencePaths: z.array(z.string()).optional(),
  brief: z.array(agentBriefStepSchema).optional(),
  suggestions: z.array(z.string()),
  generatedAt: z.string(),
} as const;

export const agentAnswerSchema = z.discriminatedUnion("intent", [
  z.object({ ...agentAnswerBaseShape, intent: z.literal("orientation"), tour: repoTourSchema, guide: installGuideSchema }),
  z.object({ ...agentAnswerBaseShape, intent: z.literal("installation"), guide: installGuideSchema }),
  z.object({ ...agentAnswerBaseShape, intent: z.literal("file-find"), finder: fileFindResponseSchema }),
  z.object({
    ...agentAnswerBaseShape,
    intent: z.literal("file-context"),
    currentPath: z.string(),
    focus: fileContextFocusSchema,
    fileKind: repositoryFileKindSchema,
    fileRole: z.string(),
    highlights: z.array(z.string()),
    contentAvailable: z.boolean(),
    imports: z.array(z.string()),
    relatedPaths: z.array(z.string()),
    callers: fileFindResponseSchema,
    tests: fileFindResponseSchema,
    warnings: z.array(z.string()),
  }),
  z.object({ ...agentAnswerBaseShape, intent: z.literal("contribution"), trail: contributionTrailSchema }),
]);

export type ContributionTrail = z.infer<typeof contributionTrailSchema>;
export type AgentBriefStep = z.infer<typeof agentBriefStepSchema>;
export type AgentModelUsage = z.infer<typeof agentModelUsageSchema>;
export type FileContextFocus = z.infer<typeof fileContextFocusSchema>;
export type RepositoryFileKind = z.infer<typeof repositoryFileKindSchema>;
export type AgentIntent = z.infer<typeof agentIntentSchema>;
export type AgentMode = z.infer<typeof agentModeSchema>;
export type AgentAnswer = z.infer<typeof agentAnswerSchema>;

// --- Errors ----------------------------------------------------------------

export const wayfinderErrorCodeSchema = z.enum([
  "github-rate-limited",
  "service-rate-limited",
  "repository-unavailable",
  "github-auth-failed",
  "upstream-unavailable",
  "request-failed",
]);

export const wayfinderErrorResponseSchema = z.object({
  error: z.string(),
  code: wayfinderErrorCodeSchema,
  message: z.string(),
  resetAt: z.string().optional(),
});

export type WayfinderErrorCode = z.infer<typeof wayfinderErrorCodeSchema>;
export type WayfinderErrorResponse = z.infer<typeof wayfinderErrorResponseSchema>;

// --- Public API request shapes ---------------------------------------------

const repositoryNameSegment = z.string().min(1).max(100).regex(/^(?!\.{1,2}$)[a-zA-Z0-9_.-]+$/);

export const mapRequestSchema = z.object({
  owner: repositoryNameSegment,
  repo: repositoryNameSegment,
  ref: z.string().trim().min(1).max(255).regex(/^(?!\.|\/)(?!.*(?:^|\/)\.\.?\/?$)[^\u0000-\u001f\u007f~^:?*[\\]+$/).nullable().optional(),
});

export const tourRequestSchema = z.object({ map: repoMapSchema });

export const installRequestSchema = z.object({
  map: repoMapSchema,
  audience: z.enum(["use", "develop"]).optional(),
});

export const findRequestSchema = z.object({
  map: repoMapSchema,
  query: z.string().trim().min(2).max(240),
  currentPath: repositoryPathSchema.nullable().optional(),
});

export const agentRequestSchema = findRequestSchema;

export type MapRequest = z.infer<typeof mapRequestSchema>;
export type TourRequest = z.infer<typeof tourRequestSchema>;
export type InstallRequest = z.infer<typeof installRequestSchema>;
export type FindRequest = z.infer<typeof findRequestSchema>;
export type AgentRequest = z.infer<typeof agentRequestSchema>;
