import type { SearchFacets } from "../types";

/**
 * Page-independent facets layer (RJC-388), keyed by buildFacetCacheKey
 * (astHash + version + filters, no sort/offset/limit). In-process only —
 * unlike the results cache, nothing in the ticket asks this to survive a
 * process restart or be shared across server instances.
 */
export interface FacetCache {
  get: (key: string) => Promise<SearchFacets | null>;
  set: (key: string, facets: SearchFacets, ttlSeconds: number) => Promise<void>;
}

// ponytail: unbounded and TTL-blind, same ceiling as MemoryResultCache, now
// doubled by this second layer — every index generation's facets sit here
// forever in a long-lived non-Redis process. Redis is the bounded backend
// (TTL-enforced); add an LRU cap here if this ever runs unattended without
// it.
export class MemoryFacetCache implements FacetCache {
  private readonly entries = new Map<string, SearchFacets>();

  get(key: string): Promise<SearchFacets | null> {
    return Promise.resolve(this.entries.get(key) ?? null);
  }

  // ponytail: matches MemoryResultCache's convention of ignoring ttlSeconds
  // — the memory backend has no eviction clock, Redis is where TTL is real.
  set(key: string, facets: SearchFacets, _ttlSeconds: number): Promise<void> {
    this.entries.set(key, structuredClone(facets));
    return Promise.resolve();
  }
}
