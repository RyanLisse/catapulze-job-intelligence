import { listPublicBronnen, mapPublicBronnen } from "@ji/application/bronnen";
import type { BronPersistence } from "@ji/application/bronnen";
import {
  createMemorySliceAStores,
  createSliceARegistry,
} from "@ji/application/registry";
import type { SliceAHandlerDeps, SliceAStores } from "@ji/application/registry";
import type { ObjectStore } from "@ji/connectors";
// Bun-only: not re-exported from the "@ji/connectors" barrel because it
// needs bun-types, which apps/web's TS program (reached transitively via
// @ji/api's AppRouter type) does not have.
import { createRawObjectStore } from "@ji/connectors/s3-object-client";
import {
  PostgresAanvraagStore,
  PostgresApprovalStore,
  PostgresAuditStore,
  PostgresExportAttemptStore,
  PostgresExternalIdCrosswalkStore,
  PostgresExternalReceiptStore,
  PostgresMarkeringStore,
  PostgresQuerySnapshotStore,
  PostgresRawPayloadStore,
  PostgresSavedSearchStore,
  PostgresSearchVersionStore,
  createBronRuntimeClient,
} from "@ji/db";
import { PostgresCurateStore } from "@ji/db/postgres-curate-store";
import type { ResultCacheBackend } from "@ji/search";
import {
  createResultCache,
  ManticoreSearchEngine,
  SearchAdapter,
} from "@ji/search";

import { assertProductionPersistence } from "./assert-production-persistence";

export interface ProductionSliceADepsInput {
  databaseUrl: string;
  manticoreUrl: string;
  nodeEnv: string;
  rawObjectStorePath?: string;
  rawS3Bucket?: string;
  rawS3Endpoint?: string;
  rawS3Region?: string;
  rawS3AccessKeyId?: string;
  rawS3SecretAccessKey?: string;
  /** Search result cache backend (RJC-388); unset runs the memory cache. */
  redisUrl?: string;
}

export type ProductionSliceADeps = SliceAHandlerDeps & {
  readonly bronPersistence: BronPersistence;
  readonly curateStore: PostgresCurateStore;
  readonly close: () => Promise<void>;
  readonly database: ReturnType<typeof createBronRuntimeClient>["database"];
  readonly objectStore: ObjectStore;
  /** Which result-cache backend actually resolved (RJC-388), for readiness
   * reporting (RJC-391) — not itself the live reachability check. */
  readonly cacheBackend: ResultCacheBackend;
  readonly manticoreUrl: string;
  /** Which raw-object-store backend actually resolved (RJC-386), for
   * readiness reporting (RJC-391). */
  readonly rawObjectStoreKind: "s3" | "filesystem";
};

export const createProductionSliceADeps = async (
  input: ProductionSliceADepsInput
): Promise<ProductionSliceADeps> => {
  const runtime = createBronRuntimeClient(input.databaseUrl);
  const rawObjectStore = createRawObjectStore({
    RAW_OBJECT_STORE_PATH: input.rawObjectStorePath,
    RAW_S3_ACCESS_KEY_ID: input.rawS3AccessKeyId,
    RAW_S3_BUCKET: input.rawS3Bucket,
    RAW_S3_ENDPOINT: input.rawS3Endpoint,
    RAW_S3_REGION: input.rawS3Region,
    RAW_S3_SECRET_ACCESS_KEY: input.rawS3SecretAccessKey,
  });
  const objectStore = rawObjectStore.store;

  // RJC-386: the filesystem raw-object store is worker-local and shares no
  // filesystem with the server, so it silently loses payloads and breaks
  // replay in production — same spirit as assertProductionPersistence below,
  // but for the object store rather than a SliceAStores entry.
  if (input.nodeEnv === "production" && rawObjectStore.kind === "filesystem") {
    throw new Error(
      "Production startup refused: raw object store is the worker-local " +
        "filesystem backend, not S3. Set RAW_S3_BUCKET (and RAW_S3_ENDPOINT/" +
        "RAW_S3_REGION/credentials as needed) to select the durable S3 backend."
    );
  }

  const memoryStores: SliceAStores = createMemorySliceAStores();

  const stores: SliceAStores = {
    ...memoryStores,
    aanvragen: new PostgresAanvraagStore(runtime.database),
    approvals: new PostgresApprovalStore(runtime.database),
    audit: new PostgresAuditStore(runtime.database),
    exportAttempts: new PostgresExportAttemptStore(runtime.database),
    externalCrosswalk: new PostgresExternalIdCrosswalkStore(runtime.database),
    externalReceipts: new PostgresExternalReceiptStore(runtime.database),
    markeringen: new PostgresMarkeringStore(runtime.database),
    rawPayloads: new PostgresRawPayloadStore(objectStore),
    savedSearches: new PostgresSavedSearchStore(runtime.database),
    snapshots: new PostgresQuerySnapshotStore(runtime.database),
  };

  assertProductionPersistence({
    memoryStores,
    nodeEnv: input.nodeEnv,
    stores,
  });

  // CONTRACT (RJC-384): the engine and any drainPostgresOutbox call against
  // this database MUST share one PostgresSearchVersionStore-backed checkpoint
  // (same table; instances may differ) — the checkpoint advance happens
  // inside engine.applyBatch. If a branch rewires these stores (e.g.
  // fix/production-persistent-stores), keep engine + drain on the same store.
  const engine = ManticoreSearchEngine.fromUrl(
    input.manticoreUrl,
    new PostgresSearchVersionStore(runtime.database)
  );
  const { backend: cacheBackend, cache: searchResultCache } =
    await createResultCache(input.redisUrl, input.nodeEnv);
  const searchAdapter = new SearchAdapter({
    cache: searchResultCache,
    engine,
  });
  const curateStore = new PostgresCurateStore(runtime.database);

  return {
    bronPersistence: runtime.bronPersistence,
    bronnen: {
      getById: async (bronId) => {
        const record = await runtime.bronPersistence.findById(bronId);
        if (!record) {
          return null;
        }
        return mapPublicBronnen([record])[0] ?? null;
      },
      list: () => listPublicBronnen(runtime.bronPersistence),
    },
    cacheBackend,
    close: runtime.close,
    curateStore,
    database: runtime.database,
    manticoreUrl: input.manticoreUrl,
    objectStore,
    rawObjectStoreKind: rawObjectStore.kind,
    searchAdapter,
    stores,
  };
};

export const createProductionSliceARegistry = async (
  input: ProductionSliceADepsInput
) => {
  const deps = await createProductionSliceADeps(input);
  return { deps, ...createSliceARegistry(deps) };
};
