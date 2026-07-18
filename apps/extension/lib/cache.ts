export interface CacheStorage {
  get(keys: string | string[] | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

export interface CachedValue<T> {
  value: T;
  cachedAt: string;
  expiresAt: string;
}

interface CacheEnvelope<T> extends CachedValue<T> {
  version: 1;
  repo: string;
  kind: "repository" | "agent";
}

interface CacheIndexEntry {
  key: string;
  repo: string;
  cachedAt: string;
  expiresAt: string;
}

const indexKey = "wayfinder:cache:index:v1";
const maxEntries = 18;
const repositoryCacheVersion = "v2";
const agentAnswerCacheVersion = "v3";

export const repositoryCacheTtl = 15 * 60 * 1_000;
export const agentCacheTtl = 30 * 60 * 1_000;

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function hashText(value: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(36);
}

export function repositoryCacheKey(owner: string, repo: string, ref?: string | null): string {
  return "wayfinder:repository:" + repositoryCacheVersion + ":" + normalize(owner) + "/" + normalize(repo) + ":" + normalize(ref ?? "default");
}

export function agentResponseCacheKey(repo: string, sha: string, query: string, currentPath: string | null): string {
  const identity = [agentAnswerCacheVersion, normalize(repo), sha, normalize(query), normalize(currentPath ?? "root")].join("|");
  return "wayfinder:agent:" + agentAnswerCacheVersion + ":" + normalize(repo) + ":" + hashText(identity);
}

function isEnvelope(value: unknown): value is CacheEnvelope<unknown> {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<CacheEnvelope<unknown>>;
  return candidate.version === 1 && typeof candidate.cachedAt === "string" && typeof candidate.expiresAt === "string" && "value" in candidate;
}

function cacheIndex(value: unknown): CacheIndexEntry[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is CacheIndexEntry =>
    Boolean(item) &&
    typeof item.key === "string" &&
    typeof item.repo === "string" &&
    typeof item.cachedAt === "string" &&
    typeof item.expiresAt === "string",
  );
}

export async function getCached<T>(
  storage: CacheStorage | null,
  key: string,
  now = Date.now(),
  allowExpired = false,
): Promise<CachedValue<T> | null> {
  if (!storage) return null;
  const stored = (await storage.get(key))[key];
  if (!isEnvelope(stored)) return null;
  if (!allowExpired && Date.parse(stored.expiresAt) <= now) return null;
  return { value: stored.value as T, cachedAt: stored.cachedAt, expiresAt: stored.expiresAt };
}

export async function setCached<T>(
  storage: CacheStorage | null,
  key: string,
  repo: string,
  kind: "repository" | "agent",
  value: T,
  ttl: number,
  now = Date.now(),
): Promise<void> {
  if (!storage) return;
  const cachedAt = new Date(now).toISOString();
  const expiresAt = new Date(now + ttl).toISOString();
  const envelope: CacheEnvelope<T> = { version: 1, repo, kind, value, cachedAt, expiresAt };
  const storedIndex = cacheIndex((await storage.get(indexKey))[indexKey]);
  const nextIndex = [
    { key, repo, cachedAt, expiresAt },
    ...storedIndex.filter((entry) => entry.key !== key && Date.parse(entry.expiresAt) > now),
  ].slice(0, maxEntries);
  const kept = new Set(nextIndex.map((entry) => entry.key));
  const dropped = storedIndex.filter((entry) => !kept.has(entry.key)).map((entry) => entry.key);

  await storage.set({ [key]: envelope, [indexKey]: nextIndex });
  if (dropped.length > 0) await storage.remove(dropped);
}

export async function clearRepositoryCache(storage: CacheStorage | null, repo: string): Promise<void> {
  if (!storage) return;
  const storedIndex = cacheIndex((await storage.get(indexKey))[indexKey]);
  const remove = storedIndex.filter((entry) => entry.repo === repo).map((entry) => entry.key);
  const nextIndex = storedIndex.filter((entry) => entry.repo !== repo);
  await storage.set({ [indexKey]: nextIndex });
  if (remove.length > 0) await storage.remove(remove);
}
