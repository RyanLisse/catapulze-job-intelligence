import type { ResultCache, ResultCacheEntry } from "../types";

export class MemoryResultCache implements ResultCache {
  private readonly entries = new Map<string, ResultCacheEntry>();

  get(key: string): Promise<ResultCacheEntry | null> {
    return Promise.resolve(this.entries.get(key) ?? null);
  }

  set(
    key: string,
    entry: ResultCacheEntry,
    _ttlSeconds: number
  ): Promise<void> {
    this.entries.set(key, structuredClone(entry));
    return Promise.resolve();
  }
}

type RedisClient = {
  connect: () => Promise<unknown>;
  get: (key: string) => Promise<string | null>;
  setEx: (key: string, ttl: number, value: string) => Promise<unknown>;
  quit: () => Promise<unknown>;
};

const loadRedisClient = async (): Promise<{
  createClient: (options: { url: string }) => RedisClient;
} | null> => {
  try {
    const module = await import("redis");
    return { createClient: module.createClient as (options: { url: string }) => RedisClient };
  } catch {
    return null;
  }
};

export class RedisResultCache implements ResultCache {
  private readonly client: RedisClient;

  private constructor(client: RedisClient) {
    this.client = client;
  }

  static async connect(redisUrl: string): Promise<RedisResultCache | null> {
    const redisModule = await loadRedisClient();
    if (!redisModule) {
      return null;
    }

    const client = redisModule.createClient({ url: redisUrl });
    await client.connect();
    return new RedisResultCache(client);
  }

  async get(key: string): Promise<ResultCacheEntry | null> {
    const payload = await this.client.get(key);
    if (payload === null) {
      return null;
    }

    return JSON.parse(payload) as ResultCacheEntry;
  }

  async set(
    key: string,
    entry: ResultCacheEntry,
    ttlSeconds: number
  ): Promise<void> {
    await this.client.setEx(key, ttlSeconds, JSON.stringify(entry));
  }

  async close(): Promise<void> {
    await this.client.quit();
  }
}

export const createResultCache = async (
  redisUrl: string | undefined
): Promise<ResultCache> => {
  if (!redisUrl) {
    return new MemoryResultCache();
  }

  const redisCache = await RedisResultCache.connect(redisUrl);
  return redisCache ?? new MemoryResultCache();
};
