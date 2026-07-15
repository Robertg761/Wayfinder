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

export function parseGitHubUrl(input: string, visibleRef?: string | null): RepoLocation | null {
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
    const normalizedVisibleRef = visibleRef?.trim().replace(/^refs\/heads\//, '') || null;
    const visibleRefSegments = normalizedVisibleRef?.split('/').filter(Boolean) ?? [];
    const matchesVisibleRef = visibleRefSegments.length > 0 &&
      visibleRefSegments.every((segment, index) => routeTail[index] === segment);
    const refLength = matchesVisibleRef ? visibleRefSegments.length : 1;
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
