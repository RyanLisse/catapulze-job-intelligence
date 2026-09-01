import type { ResultCache, ResultCacheEntry } from "../types";

// ponytail: unbounded and TTL-blind — every index generation's entries sit
// here forever in a long-lived non-Redis process (no eviction, no cap).
// Fine for tests/dev where the process is short-lived; Redis is the backend
// that actually bounds this (TTL-enforced via setEx). Add an LRU cap here
// if the memory backend ever runs unattended in production.
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
