export type GitHubView = "repo" | "tree" | "blob" | "other";

export interface RepoLocation {
  owner: string;
  repo: string;
  ref: string | null;
  path: string | null;
  view: GitHubView;
  url: string;
}

export interface RepoTreeEntry {
  path: string;
  type: "blob" | "tree";
  size?: number;
}

export interface RepoMap {
  repo: string;
  sha: string;
  requestedRef: string | null;
  resolvedRef: string;
  defaultBranch: string;
  description: string | null;
  homepage: string | null;
  language: string | null;
  stars: number;
  readme: string | null;
  tree: RepoTreeEntry[];
  setupFiles: string[];
  truncated: boolean;
  generatedAt: string;
}

export interface TourEntryPoint {
  path: string;
  why: string;
}

export interface TourStop {
  order: number;
  title: string;
  path: string;
  lines: [number, number];
  explanation: string;
  lookFor: string;
}

export interface RepoTour {
  repo: string;
  sha: string;
  summary: string;
  stack: string[];
  runtimeEntryPoint: TourEntryPoint | null;
  entryPoints: TourEntryPoint[];
  stops: TourStop[];
}

export type InstallConfidence = "documented" | "inferred" | "conflicting";

export interface InstallEvidence {
  path: string;
  lines?: [number, number];
}

export interface InstallPrerequisite {
  text: string;
  evidence: InstallEvidence;
  confidence: InstallConfidence;
}

export interface InstallStep {
  order: number;
  title: string;
  command: string;
  evidence: InstallEvidence;
  confidence: InstallConfidence;
}

export interface InstallGuide {
  repo: string;
  sha: string;
  audience: "use" | "develop";
  packageManager: string | null;
  runtimes: string[];
  prerequisites: InstallPrerequisite[];
  steps: InstallStep[];
  warnings: string[];
  generatedAt: string;
}

export type FileMatchSignal =
  | "filename"
  | "path"
  | "alias"
  | "content"
  | "symbol"
  | "primary-language"
  | "current-directory"
  | "test-pair"
  | "architecture"
  | "deprecated"
  | "re-export";

export type FileMatchConfidence = "strong" | "likely" | "possible";

export interface FileMatch {
  path: string;
  score: number;
  confidence: FileMatchConfidence;
  reason: string;
  signals: FileMatchSignal[];
  lines?: [number, number];
  snippet?: string;
}

export interface FileFindResponse {
  repo: string;
  sha: string;
  query: string;
  currentPath: string | null;
  results: FileMatch[];
  warnings: string[];
  generatedAt: string;
}

export interface ContributionTrail {
  repo: string;
  sha: string;
  goal: string;
  tour: RepoTour;
  guide: InstallGuide;
  implementation: FileFindResponse;
  verification: FileFindResponse;
  generatedAt: string;
}

export interface AgentBriefStep {
  title: string;
  action: string;
  evidencePath: string | null;
}

export interface AgentModelUsage {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  latencyMs: number;
  estimatedCostUsd: number;
}

export type FileContextFocus = "summary" | "dependencies" | "callers" | "tests" | "impact";
export type RepositoryFileKind = "source" | "test" | "documentation" | "configuration" | "data" | "other";

export type AgentIntent = "orientation" | "installation" | "file-find" | "file-context" | "contribution";
export type AgentMode = "free" | "gpt-5.6";

interface AgentAnswerBase {
  repo: string;
  sha: string;
  query: string;
  intent: AgentIntent;
  mode: AgentMode;
  model?: string;
  reasoningEffort?: "low" | "medium" | "high";
  usage?: AgentModelUsage;
  summary: string;
  explanation?: string;
  evidencePaths?: string[];
  brief?: AgentBriefStep[];
  suggestions: string[];
  generatedAt: string;
}

export type AgentAnswer =
  | (AgentAnswerBase & { intent: "orientation"; tour: RepoTour; guide: InstallGuide })
  | (AgentAnswerBase & { intent: "installation"; guide: InstallGuide })
  | (AgentAnswerBase & { intent: "file-find"; finder: FileFindResponse })
  | (AgentAnswerBase & {
      intent: "file-context";
      currentPath: string;
      focus: FileContextFocus;
      fileKind: RepositoryFileKind;
      fileRole: string;
      highlights: string[];
      contentAvailable: boolean;
      imports: string[];
      relatedPaths: string[];
      callers: FileFindResponse;
      tests: FileFindResponse;
      warnings: string[];
    })
  | (AgentAnswerBase & { intent: "contribution"; trail: ContributionTrail });

export type WayfinderErrorCode =
  | "github-rate-limited"
  | "service-rate-limited"
  | "repository-unavailable"
  | "github-auth-failed"
  | "upstream-unavailable"
  | "request-failed";

export interface WayfinderErrorResponse {
  error: string;
  code: WayfinderErrorCode;
  message: string;
  resetAt?: string;
}
