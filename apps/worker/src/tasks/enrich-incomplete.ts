import {
  enqueueEnrichmentOutbox,
  runEnrichment,
} from "@ji/application/enrichment";
import { PostgresEnrichmentStore } from "@ji/db";
import { schemaTask } from "@trigger.dev/sdk";

import { createPollBronRuntime, requireDatabaseUrl } from "../poll-bron-run";
import {
  enrichIncompleteDefaults,
  enrichIncompletePayload,
} from "./enrich-incomplete-schema";
import type { EnrichIncompletePayload } from "./enrich-incomplete-schema";

export interface EnrichIncompleteResult {
  readonly dryRun: boolean;
  readonly enriched: number;
  readonly outboxEnqueued: number;
  readonly processed: number;
  readonly proposals: number;
  readonly skipped: number;
}

export const runEnrichIncomplete = async (
  payload: EnrichIncompletePayload
): Promise<EnrichIncompleteResult> => {
  const dryRun = payload.dryRun ?? enrichIncompleteDefaults.dryRun;
  const batchSize = payload.batchSize ?? enrichIncompleteDefaults.batchSize;
  const enableLlmResidual =
    payload.enableLlmResidual ?? enrichIncompleteDefaults.enableLlmResidual;

  const runtime = createPollBronRuntime(requireDatabaseUrl());
  try {
    const store = new PostgresEnrichmentStore(runtime.database);
    const candidates = await store.listIncomplete(batchSize);

    // Sequential reduce keeps enrichment rate-limited; parallel Promise.all would violate worker concurrency intent.
    // oxlint-disable-next-line unicorn/no-array-reduce -- intentional serial fold (see CTP-482)
    const summary = await candidates.reduce<Promise<EnrichIncompleteResult>>(
      async (accumulatorPromise, candidate) => {
        const accumulator = await accumulatorPromise;
        const result = await runEnrichment({
          aanvraagId: candidate.id,
          beschrijving: candidate.beschrijving,
          bronSpecifiek: candidate.bronSpecifiek,
          enableLlmResidual,
          locatieTekst: candidate.locatieTekst,
          tariefEenheid: candidate.tariefEenheid,
          tariefMax: candidate.tariefMax,
          tariefMin: candidate.tariefMin,
        });

        if (result.proposals.length === 0) {
          return {
            dryRun,
            enriched: accumulator.enriched,
            outboxEnqueued: accumulator.outboxEnqueued,
            processed: accumulator.processed + 1,
            proposals: accumulator.proposals,
            skipped: accumulator.skipped + 1,
          };
        }

        let outboxEnqueued = 0;
        if (!dryRun) {
          // oxlint-disable-next-line unicorn/no-array-reduce -- persist proposals serially for the same candidate
          await result.proposals.reduce<Promise<void>>(
            (chain, proposal) =>
              chain.then(async () => {
                await store.upsertProposal(candidate.id, proposal);
              }),
            Promise.resolve()
          );
          const outbox = await enqueueEnrichmentOutbox(store, {
            aanvraagId: candidate.id,
            dryRun,
            fields: result.proposals.map((proposal) => proposal.field),
          });
          outboxEnqueued = outbox.enqueued ? 1 : 0;
        }

        return {
          dryRun,
          enriched:
            accumulator.enriched + (dryRun ? 0 : result.proposals.length),
          outboxEnqueued: accumulator.outboxEnqueued + outboxEnqueued,
          processed: accumulator.processed + 1,
          proposals: accumulator.proposals + result.proposals.length,
          skipped: accumulator.skipped,
        };
      },
      Promise.resolve({
        dryRun,
        enriched: 0,
        outboxEnqueued: 0,
        processed: 0,
        proposals: 0,
        skipped: 0,
      })
    );

    return summary;
  } finally {
    await runtime.close();
  }
};

/** Dequeues incomplete curated aanvragen and applies deterministic enrichment. */
export const enrichIncompleteTask = schemaTask({
  id: "enrich-incomplete",
  queue: {
    concurrencyLimit: 1,
  },
  retry: {
    maxAttempts: 2,
  },
  run: (payload) => runEnrichIncomplete(payload),
  schema: enrichIncompletePayload,
});

export type { EnrichIncompletePayload } from "./enrich-incomplete-schema";
