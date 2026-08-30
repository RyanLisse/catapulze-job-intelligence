import { timeCriticalPathPhase } from "@ji/performance";

import { readOutboxStatus } from "./outbox-payload";
import type {
  OutboxEventRecord,
  ProjectorResult,
  SearchDocumentLoader,
  SearchEngine,
} from "./types";

const CLOSE_EVENT_TYPES = new Set([
  "aanvraag.gesloten",
  "aanvraag.closed",
  "aanvraag.verwijderd",
]);

const STATUS_ONLY_EVENT_TYPES = new Set([
  "aanvraag.status_gewijzigd",
  "aanvraag.gesloten",
  "aanvraag.closed",
]);

export interface ProjectOutboxEventInput {
  engine: SearchEngine;
  event: OutboxEventRecord;
  indexVersion: number;
  loader: SearchDocumentLoader;
}

export const projectOutboxEvent = (
  input: ProjectOutboxEventInput
): Promise<ProjectorResult> =>
  timeCriticalPathPhase("ingest-index-projection", async () => {
    const { engine, event, indexVersion, loader } = input;

    if (event.aggregateType !== "aanvraag") {
      return { indexVersion, processed: false };
    }

    if (event.eventType === "aanvraag.verwijderd") {
      await engine.deleteDocument(event.aggregateId);
      await engine.setIndexVersion(indexVersion);
      return { indexVersion, processed: true };
    }

    const loaded = await loader.loadByAggregateId(event.aggregateId);
    if (!loaded) {
      return { indexVersion, processed: false };
    }

    let document = loaded;
    const payloadStatus = readOutboxStatus(event.payload);
    if (payloadStatus !== null) {
      document = { ...document, status: payloadStatus };
    } else if (CLOSE_EVENT_TYPES.has(event.eventType)) {
      document = { ...document, status: "closed" };
    } else if (STATUS_ONLY_EVENT_TYPES.has(event.eventType)) {
      document = { ...document, status: document.status };
    }

    await engine.upsertDocument(document);
    await engine.setIndexVersion(indexVersion);
    return { indexVersion, processed: true };
  });

export interface DrainOutboxInput {
  engine: SearchEngine;
  events: OutboxEventRecord[];
  loader: SearchDocumentLoader;
  startingIndexVersion?: number;
}

export const drainOutboxEvents = async (
  input: DrainOutboxInput
): Promise<number> => {
  let version = input.startingIndexVersion ?? 0;
  /* oxlint-disable no-await-in-loop -- outbox projector applies events in commit order */
  for (const event of input.events) {
    version += 1;
    await projectOutboxEvent({
      engine: input.engine,
      event: { ...event, indexVersion: version },
      indexVersion: version,
      loader: input.loader,
    });
  }
  /* oxlint-enable no-await-in-loop */

  return version;
};
