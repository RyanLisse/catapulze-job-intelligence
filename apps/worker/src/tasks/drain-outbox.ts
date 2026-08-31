import {
  drainPostgresOutbox,
  PostgresSearchDocumentLoader,
  PostgresSearchVersionStore,
} from "@ji/db";
import { ManticoreSearchEngine } from "@ji/search";
import { schemaTask } from "@trigger.dev/sdk";
import { z } from "zod";

import {
  createPollBronRuntime,
  requireDatabaseUrl,
  requireManticoreUrl,
} from "../poll-bron-run";

const drainOutboxPayload = z.object({
  /** Rows claimed per drain (RJC-389); `limit` is the legacy name. */
  batchSize: z.number().int().positive().max(5000).optional(),
  leaseSeconds: z.number().int().positive().max(3600).optional(),
  limit: z.number().int().positive().max(5000).optional(),
  maxAttempts: z.number().int().positive().max(100).optional(),
});

/** Drains unprocessed curated outbox rows into Manticore (search projector). */
export const drainOutboxTask = schemaTask({
  id: "drain-outbox",
  queue: {
    concurrencyLimit: 1,
  },
  retry: {
    maxAttempts: 2,
  },
  run: async (payload) => {
    const runtime = createPollBronRuntime(requireDatabaseUrl());
    try {
      const versionStore = new PostgresSearchVersionStore(runtime.database);
      const engine = ManticoreSearchEngine.fromUrl(
        requireManticoreUrl(),
        versionStore
      );
      const result = await drainPostgresOutbox({
        batchSize: payload.batchSize ?? payload.limit,
        database: runtime.database,
        engine,
        leaseSeconds: payload.leaseSeconds,
        loader: new PostgresSearchDocumentLoader(runtime.database),
        maxAttempts: payload.maxAttempts,
        versionStore,
      });
      // Task output must be JSON-serializable: drop the bigint-bearing
      // version object and return the scalar mirror.
      return {
        claimed: result.claimed,
        deadLettered: result.deadLettered,
        drained: result.drained,
        failed: result.failed,
        indexVersion: result.indexVersion,
        lag: result.lag,
        lostLease: result.lostLease,
        processedIds: result.processedIds,
        released: result.released,
        superseded: result.superseded,
        unchanged: result.unchanged,
      };
    } finally {
      await runtime.close();
    }
  },
  schema: drainOutboxPayload,
});
