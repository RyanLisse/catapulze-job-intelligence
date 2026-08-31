import { timeCriticalPathPhase } from "@ji/performance";

import { readOutboxStatus } from "./outbox-payload";
import type {
  OutboxEventRecord,
  SearchDocumentLoader,
  SearchEngine,
  SearchIndexMutation,
} from "./types";
import { ZERO_SEQUENCE } from "./version";
import type { SearchVersion } from "./version";

const CLOSE_EVENT_TYPES = new Set([
  "aanvraag.gesloten",
  "aanvraag.closed",
  "aanvraag.verwijderd",
]);

interface ResolveOutboxMutationInput {
  event: OutboxEventRecord;
  loader: SearchDocumentLoader;
}

/**
 * Resolves an outbox event into an idempotent index mutation, or null when
 * the event does not touch the search index (wrong aggregate type, or the
 * source document no longer loads).
 */
export const resolveOutboxMutation = async (
  input: ResolveOutboxMutationInput
): Promise<SearchIndexMutation | null> => {
  const { event, loader } = input;

  if (event.aggregateType !== "aanvraag") {
    return null;
  }

  if (event.eventType === "aanvraag.verwijderd") {
    return { id: event.aggregateId, kind: "delete" };
  }

  const loaded = await loader.loadByAggregateId(event.aggregateId);
  if (!loaded) {
    return null;
  }

  let document = loaded;
  const payloadStatus = readOutboxStatus(event.payload);
  if (payloadStatus !== null) {
    document = { ...document, status: payloadStatus };
  } else if (CLOSE_EVENT_TYPES.has(event.eventType)) {
    document = { ...document, status: "closed" };
  }

  return { document, kind: "upsert" };
};

export interface DrainOutboxInput {
  engine: SearchEngine;
  events: OutboxEventRecord[];
  loader: SearchDocumentLoader;
}

/**
 * Applies outbox events in sequence order and returns the durable version.
 * The applied sequence is derived from the events' actual DB-generated
 * sequence numbers — a skipped event (wrong aggregate, missing document)
 * still counts as consumed. Index writes land before the checkpoint advance
 * (inside engine.applyBatch), so a crash in between re-applies the batch;
 * upserts and deletes by document id make that safe.
 */
export const drainOutboxEvents = (
  input: DrainOutboxInput
): Promise<SearchVersion> =>
  timeCriticalPathPhase("ingest-index-projection", async () => {
    if (input.events.length === 0) {
      return input.engine.getAppliedVersion();
    }

    const mutations: SearchIndexMutation[] = [];
    let appliedSequence = ZERO_SEQUENCE;
    /* oxlint-disable no-await-in-loop -- outbox projector resolves events in commit order */
    for (const event of input.events) {
      if (event.sequenceNumber > appliedSequence) {
        appliedSequence = event.sequenceNumber;
      }
      const mutation = await resolveOutboxMutation({
        event,
        loader: input.loader,
      });
      if (mutation) {
        mutations.push(mutation);
      }
    }
    /* oxlint-enable no-await-in-loop */

    return input.engine.applyBatch({ appliedSequence, mutations });
  });
