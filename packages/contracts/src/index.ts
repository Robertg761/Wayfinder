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
  | "architecture";

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

export type WayfinderMessage =
  | { type: "wayfinder:context"; context: RepoLocation | null }
  | { type: "wayfinder:get-context" };
