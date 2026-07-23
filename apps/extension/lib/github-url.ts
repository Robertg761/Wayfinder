import type { GitHubView, RepoLocation } from '@wayfinder/contracts';

const reservedRoots = new Set([
  'about',
  'collections',
  'customer-stories',
  'enterprise',
  'events',
  'explore',
  'features',
  'login',
  'marketplace',
  'new',
  'notifications',
  'organizations',
  'orgs',
  'pricing',
  'search',
  'security',
  'settings',
  'signup',
  'sponsors',
  'team',
  'topics',
  'users',
]);

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function matchingRefLength(routeTail: string[], candidateRef: string | null | undefined): number {
  const normalized = candidateRef?.trim().replace(/^refs\/(?:heads|tags)\//, '') || null;
  const refSegments = normalized?.split('/').filter(Boolean) ?? [];
  const matches = refSegments.length > 0 &&
    refSegments.length <= routeTail.length &&
    refSegments.every((segment, index) => routeTail[index] === segment);
  return matches ? refSegments.length : 0;
}

export function parseGitHubUrl(
  input: string,
  visibleRef?: string | null,
  knownRefs: Array<string | null | undefined> = [],
): RepoLocation | null {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }

  if (url.hostname !== 'github.com' && url.hostname !== 'www.github.com') return null;

  const segments = url.pathname.split('/').filter(Boolean).map(safeDecode);
  if (segments.length < 2 || reservedRoots.has(segments[0].toLowerCase())) return null;

  const owner = segments[0];
  const repo = segments[1].replace(/\.git$/, '');
  if (!owner || !repo) return null;

  const route = segments[2];
  let view: GitHubView = 'repo';
  let ref: string | null = null;
  let path: string | null = null;

  if (route === 'tree' || route === 'blob') {
    view = route;
    const routeTail = segments.slice(3);
    // A slash-containing branch (feature/navigation) is ambiguous in the URL.
    // Prefer the ref GitHub renders on the page, then any ref Wayfinder
    // already knows for this repository (longest match first), before
    // falling back to the single-segment guess.
    const refLength = matchingRefLength(routeTail, visibleRef) ||
      Math.max(0, ...knownRefs.map((candidate) => matchingRefLength(routeTail, candidate))) ||
      1;
    ref = routeTail.slice(0, refLength).join('/') || null;
    path = routeTail.slice(refLength).join('/') || null;
  } else if (route) {
    view = 'other';
  }

  return {
    owner,
    repo,
    ref,
    path,
    view,
    url: url.href,
  };
}
