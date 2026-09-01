import type { ResultCache } from "../types";
import { MemoryResultCache } from "./memory-result-cache";
import { RedisResultCache } from "./redis-result-cache";

export type ResultCacheBackend = "memory" | "redis";

export interface ResultCacheResolution {
  readonly backend: ResultCacheBackend;
  readonly cache: ResultCache;
}

interface BackendDecisionLogEntry {
  backend: ResultCacheBackend;
  event: string;
  redisUrl: string | null;
  reason?: string;
}

/**
 * A Redis URL can carry credentials (redis://:password@host:port). Never
 * log or throw the raw value — redact user/password, keep host/port/db for
 * diagnosability. Falls back to a fixed placeholder if the value isn't a
 * parseable URL at all, so a malformed REDIS_URL still can't leak.
 *
 * Caveat: this covers the standard userinfo form. A URL that instead puts
 * the credential in a query string (e.g. `?password=...`, seen on some
 * non-standard Redis connection strings) also gets its password/user
 * search params blanked below, but any OTHER unrecognized query-param name
 * a future connection string invents would still pass through untouched.
 */
const REDACTED_QUERY_PARAM_NAMES = ["password", "user", "username"];

const redactRedisUrl = (redisUrl: string): string => {
  try {
    const parsed = new URL(redisUrl);
    parsed.username = "";
    parsed.password = "";
    for (const paramName of REDACTED_QUERY_PARAM_NAMES) {
      if (parsed.searchParams.has(paramName)) {
        parsed.searchParams.set(paramName, "");
      }
    }
    return parsed.toString();
  } catch {
    return "[unparseable redis url]";
  }
};

const logBackendDecision = (
  backend: ResultCacheBackend,
  redisUrl: string | undefined,
  reason?: string
): void => {
  const entry: BackendDecisionLogEntry = {
    backend,
    event: "search_cache_backend",
    redisUrl: redisUrl ? redactRedisUrl(redisUrl) : null,
  };
  if (reason) {
    entry.reason = reason;
  }
  process.stderr.write(`${JSON.stringify(entry)}\n`);
};

/** Swappable only for tests — production always uses RedisResultCache.connect. */
export type RedisConnector = (redisUrl: string) => Promise<ResultCache | null>;

/**
 * Resolves which result-cache backend actually goes live (RJC-388), instead
 * of the previous silent per-request fallback: the decision is made once,
 * here, at construction, and logged either way so readiness output is
 * honest about which backend is active. In production, an unreachable
 * REDIS_URL fails startup loudly — same philosophy as
 * assertProductionPersistence — rather than quietly downgrading to a cache
 * that a running fleet of servers won't share.
 */
export const createResultCache = async (
  redisUrl: string | undefined,
  nodeEnv: string,
  connect: RedisConnector = (url) => RedisResultCache.connect(url)
): Promise<ResultCacheResolution> => {
  if (!redisUrl) {
    logBackendDecision("memory", redisUrl);
    return { backend: "memory", cache: new MemoryResultCache() };
  }

  const redisCache = await connect(redisUrl);
  if (redisCache) {
    logBackendDecision("redis", redisUrl);
    return { backend: "redis", cache: redisCache };
  }

  if (nodeEnv === "production") {
    throw new Error(
      `Production startup refused: REDIS_URL is set (${redactRedisUrl(redisUrl)}) but Redis ` +
        "is unreachable. Fix connectivity, or unset REDIS_URL to run " +
        "without the shared search-result cache."
    );
  }

  logBackendDecision("memory", redisUrl, "redis_unreachable");
  return { backend: "memory", cache: new MemoryResultCache() };
};

export { MemoryResultCache } from "./memory-result-cache";
export { RedisResultCache } from "./redis-result-cache";
