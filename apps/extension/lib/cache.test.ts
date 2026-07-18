import { describe, expect, it } from 'vitest';
import {
  agentResponseCacheKey,
  clearRepositoryCache,
  getCached,
  repositoryCacheKey,
  setCached,
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
    expect(agentResponseCacheKey('openai/openai-node', 'abc1234', ' Where is Auth? ', 'src/client.ts'))
      .toBe(agentResponseCacheKey('OPENAI/openai-node', 'abc1234', 'where is auth?', 'src/client.ts'));
    expect(agentResponseCacheKey('openai/openai-node', 'abc1234', 'where is auth?', 'src/client.ts'))
      .toContain('wayfinder:agent:v2:');
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
});
