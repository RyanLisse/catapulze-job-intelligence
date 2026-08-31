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
  limit: z.number().int().positive().max(5000).optional(),
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
        database: runtime.database,
        engine,
        limit: payload.limit,
        loader: new PostgresSearchDocumentLoader(runtime.database),
        versionStore,
      });
      // Task output must be JSON-serializable: drop the bigint-bearing
      // version object and return the scalar mirror.
      return {
        drained: result.drained,
        indexVersion: result.indexVersion,
        processedIds: result.processedIds,
      };
    } finally {
      await runtime.close();
    }
  },
  schema: drainOutboxPayload,
});
