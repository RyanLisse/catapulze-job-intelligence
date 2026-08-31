import path from "node:path";

import { listPublicBronnen, mapPublicBronnen } from "@ji/application/bronnen";
import type { BronPersistence } from "@ji/application/bronnen";
import {
  createMemorySliceAStores,
  createSliceARegistry,
} from "@ji/application/registry";
import type { SliceAHandlerDeps, SliceAStores } from "@ji/application/registry";
import { FilesystemObjectStore } from "@ji/connectors";
import {
  PostgresAanvraagStore,
  PostgresApprovalStore,
  PostgresExportAttemptStore,
  PostgresExternalIdCrosswalkStore,
  PostgresExternalReceiptStore,
  PostgresQuerySnapshotStore,
  PostgresRawPayloadStore,
  PostgresSearchVersionStore,
  createBronRuntimeClient,
} from "@ji/db";
import { PostgresCurateStore } from "@ji/db/postgres-curate-store";
import { ManticoreSearchEngine, SearchAdapter } from "@ji/search";

import { assertProductionPersistence } from "./assert-production-persistence";

export interface ProductionSliceADepsInput {
  databaseUrl: string;
  manticoreUrl: string;
  nodeEnv: string;
  rawObjectStorePath?: string;
}

export type ProductionSliceADeps = SliceAHandlerDeps & {
  readonly bronPersistence: BronPersistence;
  readonly curateStore: PostgresCurateStore;
  readonly close: () => Promise<void>;
  readonly database: ReturnType<typeof createBronRuntimeClient>["database"];
  readonly objectStore: FilesystemObjectStore;
};

export const createProductionSliceADeps = (
  input: ProductionSliceADepsInput
): ProductionSliceADeps => {
  const runtime = createBronRuntimeClient(input.databaseUrl);
  const objectStore = new FilesystemObjectStore(
    input.rawObjectStorePath?.trim() ||
      path.join(process.cwd(), ".data", "raw-objects")
  );
  const memoryStores: SliceAStores = createMemorySliceAStores();

  const stores: SliceAStores = {
    ...memoryStores,
    aanvragen: new PostgresAanvraagStore(runtime.database),
    approvals: new PostgresApprovalStore(runtime.database),
    exportAttempts: new PostgresExportAttemptStore(runtime.database),
    externalCrosswalk: new PostgresExternalIdCrosswalkStore(runtime.database),
    externalReceipts: new PostgresExternalReceiptStore(runtime.database),
    rawPayloads: new PostgresRawPayloadStore(objectStore),
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
  const searchAdapter = new SearchAdapter({ engine });
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
    close: runtime.close,
    curateStore,
    database: runtime.database,
    objectStore,
    searchAdapter,
    stores,
  };
};

export const createProductionSliceARegistry = (
  input: ProductionSliceADepsInput
) => {
  const deps = createProductionSliceADeps(input);
  return { deps, ...createSliceARegistry(deps) };
};
