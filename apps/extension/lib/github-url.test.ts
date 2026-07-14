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

  it('rejects non-repository GitHub routes and other hosts', () => {
    expect(parseGitHubUrl('https://github.com/settings/profile')).toBeNull();
    expect(parseGitHubUrl('https://example.com/openai/openai-node')).toBeNull();
  });
});
