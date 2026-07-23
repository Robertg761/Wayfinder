import { describe, expect, it } from 'vitest';
import { parseGitHubUrl } from './github-url';

describe('parseGitHubUrl', () => {
  it('reads a repository root', () => {
    expect(parseGitHubUrl('https://github.com/openai/openai-node')).toMatchObject({
      owner: 'openai',
      repo: 'openai-node',
      view: 'repo',
      ref: null,
      path: null,
    });
  });

  it('reads a blob path and line fragment', () => {
    expect(
      parseGitHubUrl('https://github.com/openai/openai-node/blob/master/src/index.ts#L12-L30'),
    ).toMatchObject({
      owner: 'openai',
      repo: 'openai-node',
      view: 'blob',
      ref: 'master',
      path: 'src/index.ts',
    });
  });

  it('reads a tree path', () => {
    expect(parseGitHubUrl('https://github.com/vercel/next.js/tree/canary/packages/next')).toMatchObject({
      owner: 'vercel',
      repo: 'next.js',
      view: 'tree',
      ref: 'canary',
      path: 'packages/next',
    });
  });

  it('uses the visible branch label to preserve refs containing slashes', () => {
    expect(parseGitHubUrl(
      'https://github.com/example/project/blob/feature/navigation/src/index.ts',
      'feature/navigation',
    )).toMatchObject({
      ref: 'feature/navigation',
      path: 'src/index.ts',
    });
  });

  it('falls back to known repository refs when the visible label is unavailable', () => {
    expect(parseGitHubUrl(
      'https://github.com/example/project/blob/feature/navigation/src/index.ts',
      null,
      ['main', 'feature/navigation'],
    )).toMatchObject({
      ref: 'feature/navigation',
      path: 'src/index.ts',
    });
  });

  it('prefers the longest known ref match for nested branch names', () => {
    expect(parseGitHubUrl(
      'https://github.com/example/project/tree/release/2026/07/docs',
      undefined,
      ['release/2026/07', 'release/2026'],
    )).toMatchObject({
      ref: 'release/2026/07',
      path: 'docs',
    });
  });

  it('still commits to the first segment when no ref evidence matches', () => {
    expect(parseGitHubUrl(
      'https://github.com/example/project/blob/main/src/index.ts',
      null,
      ['feature/navigation'],
    )).toMatchObject({
      ref: 'main',
      path: 'src/index.ts',
    });
  });

  it('does not treat issue and pull request routes as repository paths', () => {
    expect(parseGitHubUrl('https://github.com/example/project/issues/42')).toMatchObject({
      view: 'other',
      path: null,
    });
  });

  it('rejects non-repository GitHub routes and other hosts', () => {
    expect(parseGitHubUrl('https://github.com/settings/profile')).toBeNull();
    expect(parseGitHubUrl('https://example.com/openai/openai-node')).toBeNull();
  });

  it('rejects platform routes that look like owner/repo pairs', () => {
    expect(parseGitHubUrl('https://github.com/trending/typescript')).toBeNull();
    expect(parseGitHubUrl('https://github.com/apps/dependabot')).toBeNull();
    expect(parseGitHubUrl('https://github.com/stars/someone/lists')).toBeNull();
    expect(parseGitHubUrl('https://github.com/codespaces/new')).toBeNull();
    expect(parseGitHubUrl('https://github.com/dashboard/index')).toBeNull();
    expect(parseGitHubUrl('https://github.com/readme/topics')).toBeNull();
    expect(parseGitHubUrl('https://github.com/account/settings')).toBeNull();
  });
});
