import type { ResultCache } from "../types";
import { MemoryResultCache } from "./memory-result-cache";
import { RedisResultCache } from "./redis-result-cache";

export const createResultCache = async (
  redisUrl: string | undefined
): Promise<ResultCache> => {
  if (!redisUrl) {
    return new MemoryResultCache();
  }

  const redisCache = await RedisResultCache.connect(redisUrl);
  return redisCache ?? new MemoryResultCache();
};

export { MemoryResultCache } from "./memory-result-cache";
export { RedisResultCache } from "./redis-result-cache";
