import {
  agentAnswerSchema,
  repoMapSchema,
  repoTourSchema,
  WAYFINDER_DEV_API_URL,
  WAYFINDER_PROD_API_URL,
  type AgentAnswer,
  type RepoMap,
  type RepoTour,
  type WayfinderErrorResponse,
} from '@wayfinder/contracts';

export interface RepositoryBundle {
  map: RepoMap;
  tour: RepoTour;
}

export class WayfinderRequestError extends Error {
  constructor(
    message: string,
    readonly code: WayfinderErrorResponse['code'] = 'request-failed',
    readonly resetAt?: string,
  ) {
    super(message);
  }
}

export function requestErrorLabels(error: WayfinderRequestError): [string, string] {
  const labels: Record<WayfinderErrorResponse['code'], [string, string]> = {
    'github-rate-limited': ['GitHub rate limit reached', error.resetAt ? `Try again after ${new Date(error.resetAt).toLocaleString()}.` : 'Wait a few minutes, then try again.'],
    'service-rate-limited': ['Wayfinder is busy', 'Wait a minute, then try the request again.'],
    'repository-unavailable': ['Repository unavailable', 'The repository may be private, missing, or inaccessible without authentication.'],
    'github-auth-failed': ['GitHub authentication failed', 'The repository service could not authenticate with GitHub.'],
    'upstream-unavailable': ['Connection interrupted', 'Check your connection. A cached answer will be used automatically when one is available.'],
    'request-failed': ['Survey interrupted', 'Try the request again or ask a narrower question.'],
  };
  // A newer Worker may introduce codes this build does not know about.
  return labels[error.code] ?? labels['request-failed'];
}

export const apiUrl = import.meta.env.WXT_WAYFINDER_API_URL
  ?? (import.meta.env.PROD ? WAYFINDER_PROD_API_URL : WAYFINDER_DEV_API_URL);

const apiHeaders = () => ({
  'Content-Type': 'application/json',
  'X-Wayfinder-Extension-Version': browser.runtime.getManifest().version,
});

// Wire and cache payloads are validated against the shared contract schemas.
// A response or cached value that no longer matches (older extension, newer
// Worker, corrupted storage) is discarded instead of rendered blindly.
export function parseRepositoryBundle(value: unknown): RepositoryBundle | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as { map?: unknown; tour?: unknown };
  const map = repoMapSchema.safeParse(candidate.map);
  const tour = repoTourSchema.safeParse(candidate.tour);
  return map.success && tour.success ? { map: map.data, tour: tour.data } : null;
}

export function contractMismatchError(payload: string): WayfinderRequestError {
  return new WayfinderRequestError(
    `Wayfinder received a ${payload} that does not match this extension's contract. Update the extension if this keeps happening.`,
    'request-failed',
  );
}

async function failureFrom(response: Response, fallbackMessage: string, fallbackCode: WayfinderErrorResponse['code']): Promise<WayfinderRequestError> {
  const failure = await response.json().catch(() => null) as Partial<WayfinderErrorResponse> | null;
  return new WayfinderRequestError(
    failure?.message ?? fallbackMessage,
    failure?.code ?? fallbackCode,
    failure?.resetAt,
  );
}

export async function requestRepositoryMap(
  location: { owner: string; repo: string; ref: string | null },
  signal: AbortSignal,
): Promise<RepoMap> {
  const response = await fetch(`${apiUrl}/map`, {
    method: 'POST',
    headers: apiHeaders(),
    body: JSON.stringify({ owner: location.owner, repo: location.repo, ref: location.ref }),
    signal,
  });
  if (!response.ok) throw await failureFrom(response, 'Wayfinder could not map this repository.', 'request-failed');
  const parsed = repoMapSchema.safeParse(await response.json());
  if (!parsed.success) throw contractMismatchError('repository map');
  return parsed.data;
}

export async function requestRepositoryTour(map: RepoMap, signal: AbortSignal): Promise<RepoTour> {
  const response = await fetch(`${apiUrl}/tour`, {
    method: 'POST',
    headers: apiHeaders(),
    body: JSON.stringify({ map }),
    signal,
  });
  if (!response.ok) throw await failureFrom(response, 'Wayfinder could not assemble the repository route.', 'upstream-unavailable');
  const parsed = repoTourSchema.safeParse(await response.json());
  if (!parsed.success) throw contractMismatchError('repository route');
  return parsed.data;
}

export async function requestAgentAnswer(
  map: RepoMap,
  query: string,
  currentPath: string | null,
  signal: AbortSignal,
): Promise<AgentAnswer> {
  const response = await fetch(`${apiUrl}/agent`, {
    method: 'POST',
    headers: apiHeaders(),
    body: JSON.stringify({ map, query, currentPath }),
    signal,
  });
  if (!response.ok) throw await failureFrom(response, 'The guide could not complete that dispatch.', 'request-failed');
  const parsed = agentAnswerSchema.safeParse(await response.json());
  if (!parsed.success) throw contractMismatchError('guide answer');
  return parsed.data;
}
