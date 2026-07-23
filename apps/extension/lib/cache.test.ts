import { describe, expect, it } from 'vitest';
import {
  agentResponseCacheKey,
  clearRepositoryCache,
  getCached,
  reconcileCacheIndex,
  repositoryCacheKey,
  setCached,
  trailCacheKey,
  trailCacheTtl,
  type CacheStorage,
} from './cache';

function memoryStorage(): CacheStorage & { values: Record<string, unknown> } {
  const values: Record<string, unknown> = {};
  return {
    values,
    async get(keys) {
      if (keys === null) return { ...values };
      const requested = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(requested.filter((key) => key in values).map((key) => [key, values[key]]));
    },
    async set(items) {
      Object.assign(values, items);
    },
    async remove(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete values[key];
    },
  };
}

describe('Wayfinder extension cache', () => {
  it('builds stable keys from normalized repository context', () => {
    expect(repositoryCacheKey('OpenAI', 'OpenAI-Node')).toBe(repositoryCacheKey('openai', 'openai-node'));
    expect(repositoryCacheKey('openai', 'openai-node', 'feature/navigation')).not.toBe(
      repositoryCacheKey('openai', 'openai-node', 'main'),
    );
    expect(repositoryCacheKey('openai', 'openai-node')).toContain('wayfinder:repository:v2:');
    expect(agentResponseCacheKey('openai/openai-node', 'abc1234', ' Where is Auth? ', 'src/client.ts'))
      .toBe(agentResponseCacheKey('OPENAI/openai-node', 'abc1234', 'where is auth?', 'src/client.ts'));
    expect(agentResponseCacheKey('openai/openai-node', 'abc1234', 'where is auth?', 'src/client.ts'))
      .toContain('wayfinder:agent:v3:');
  });

  it('returns valid entries and rejects expired entries', async () => {
    const storage = memoryStorage();
    await setCached(storage, 'answer', 'openai/openai-node', 'agent', { ok: true }, 1_000, 10_000);
    await expect(getCached<{ ok: boolean }>(storage, 'answer', 10_500)).resolves.toMatchObject({ value: { ok: true } });
    await expect(getCached(storage, 'answer', 11_001)).resolves.toBeNull();
    await expect(getCached(storage, 'answer', 11_001, true)).resolves.toMatchObject({ value: { ok: true } });
  });

  it('clears only entries belonging to the selected repository', async () => {
    const storage = memoryStorage();
    await setCached(storage, 'one', 'openai/openai-node', 'repository', 1, 5_000, 10_000);
    await setCached(storage, 'two', 'pallets/flask', 'repository', 2, 5_000, 10_000);
    await clearRepositoryCache(storage, 'openai/openai-node');
    await expect(getCached(storage, 'one', 10_100)).resolves.toBeNull();
    await expect(getCached(storage, 'two', 10_100)).resolves.toMatchObject({ value: 2 });
  });

  it('uses a two-part hash so near-collisions stay distinguishable', () => {
    const base = agentResponseCacheKey('openai/openai-node', 'abc1234', 'where is auth?', null);
    expect(base.split(':').at(-1)).toMatch(/^[0-9a-z]+-[0-9a-z]+$/);
    expect(base).not.toBe(agentResponseCacheKey('openai/openai-node', 'abc1234', 'where is auth', null));
  });

  it('evicts the oldest entries when trails join the shared index', async () => {
    const storage = memoryStorage();
    for (let index = 0; index < 18; index += 1) {
      await setCached(storage, 'entry-' + index, 'repo/' + index, 'agent', index, 60_000, 10_000 + index);
    }
    await setCached(storage, trailCacheKey('example/trail'), 'example/trail', 'trail', { saved: true }, trailCacheTtl, 20_000);

    await expect(getCached(storage, trailCacheKey('example/trail'), 20_100)).resolves.toMatchObject({ value: { saved: true } });
    // The oldest agent entry fell out of the bounded index and off disk.
    expect(storage.values['entry-0']).toBeUndefined();
    await expect(getCached(storage, 'entry-1', 20_100)).resolves.toMatchObject({ value: 1 });
  });

  it('sweeps orphaned wayfinder keys that are not in the index', async () => {
    const storage = memoryStorage();
    await setCached(storage, repositoryCacheKey('openai', 'openai-node'), 'openai/openai-node', 'repository', 1, 60_000, 10_000);
    storage.values['wayfinder:trail:legacy/repo'] = { question: 'old', answer: {}, savedAt: '2026-01-01' };
    storage.values['wayfinder:agent:v2:stale:hash'] = { version: 1, value: 1 };
    storage.values['wayfinder:preferences:v1'] = { mode: 'guided' };

    await reconcileCacheIndex(storage, 10_100);

    expect(storage.values['wayfinder:trail:legacy/repo']).toBeUndefined();
    expect(storage.values['wayfinder:agent:v2:stale:hash']).toBeUndefined();
    // Preferences are not index-managed and must survive the sweep.
    expect(storage.values['wayfinder:preferences:v1']).toEqual({ mode: 'guided' });
    await expect(getCached(storage, repositoryCacheKey('openai', 'openai-node'), 10_200)).resolves.toMatchObject({ value: 1 });
  });

  it('drops expired index entries and their stored values during reconciliation', async () => {
    const storage = memoryStorage();
    await setCached(storage, repositoryCacheKey('openai', 'openai-node'), 'openai/openai-node', 'repository', 1, 1_000, 10_000);

    await reconcileCacheIndex(storage, 12_000);

    expect(storage.values[repositoryCacheKey('openai', 'openai-node')]).toBeUndefined();
  });
});
