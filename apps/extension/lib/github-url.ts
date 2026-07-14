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

export function parseGitHubUrl(input: string): RepoLocation | null {
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
    ref = segments[3] ?? null;
    path = segments.slice(4).join('/') || null;
  } else if (route) {
    view = 'other';
    path = segments.slice(2).join('/') || null;
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
