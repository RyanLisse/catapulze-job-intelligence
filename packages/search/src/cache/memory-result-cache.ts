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
