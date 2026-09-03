import { SearchAdapter, InMemorySearchEngine } from "@ji/search";

import type { PublicBronView } from "../bronnen";
import { createSliceARegistry } from "./catalog";
import type { SliceAHandlerDeps } from "./handlers/deps";
import { createMemorySliceAStores } from "./stores/memory";

const testBronnen: PublicBronView[] = [
  {
    actief: true,
    bronId: "00000000-0000-4000-8000-000000000001",
    crawlDelayMs: 0,
    hasSecretRef: false,
    interval: "0 * * * *",
    lastRun: null,
    loginVereist: false,
    mappingRef: null,
    method: "json-api",
    naam: "TenderNed",
    rateLimitPerMinute: 1,
    retentionDays: 90,
    status: "ready",
    voorwaardenStatus: "toegestaan",
  },
];

export const TEST_DEPLOYMENT_SCOPE_ID = "catapulze-test";

export const createTestSliceADeps = (
  scopeId = TEST_DEPLOYMENT_SCOPE_ID
): SliceAHandlerDeps & {
  readonly engine: InMemorySearchEngine;
  readonly stores: ReturnType<typeof createMemorySliceAStores>;
} => {
  const stores = createMemorySliceAStores();
  const engine = new InMemorySearchEngine();
  const searchAdapter = new SearchAdapter({ engine });
  const bronnen = {
    getById: (bronId: string) =>
      Promise.resolve(
        testBronnen.find((item) => item.bronId === bronId) ?? null
      ),
    list: () => Promise.resolve(testBronnen),
  };
  return {
    bronnen,
    engine,
    scopeId,
    searchAdapter,
    stores,
  };
};

export const createTestSliceARegistry = (
  scopeId = TEST_DEPLOYMENT_SCOPE_ID
) => {
  const deps = createTestSliceADeps(scopeId);
  return { deps, ...createSliceARegistry(deps) };
};

export type TestSliceARegistryBundle = ReturnType<
  typeof createTestSliceARegistry
>;
