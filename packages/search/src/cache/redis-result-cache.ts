import type { ResultCache, ResultCacheEntry } from "../types";
import { parseResultCacheEntry } from "./parse-cache-entry";

interface RedisReader {
  get: (key: string) => Promise<string | null>;
  quit: () => Promise<void>;
  setEx: (key: string, ttl: number, value: string) => Promise<void>;
}

export class RedisResultCache implements ResultCache {
  private readonly reader: RedisReader;

  private constructor(reader: RedisReader) {
    this.reader = reader;
  }

  static async connect(redisUrl: string): Promise<RedisResultCache | null> {
    try {
      const redisPackage = await import("redis");
      const rawClient = redisPackage.createClient({ url: redisUrl });
      await rawClient.connect();
      const reader: RedisReader = {
        get: (key) => rawClient.get(key),
        quit: async () => {
          await rawClient.quit();
        },
        setEx: async (key, ttl, value) => {
          await rawClient.setEx(key, ttl, value);
        },
      };
      return new RedisResultCache(reader);
    } catch {
      return null;
    }
  }

  async get(key: string): Promise<ResultCacheEntry | null> {
    const payload = await this.reader.get(key);
    if (payload === null) {
      return null;
    }

    return parseResultCacheEntry(payload);
  }

  async set(
    key: string,
    entry: ResultCacheEntry,
    ttlSeconds: number
  ): Promise<void> {
    await this.reader.setEx(key, ttlSeconds, JSON.stringify(entry));
  }

  async close(): Promise<void> {
    await this.reader.quit();
  }
}
