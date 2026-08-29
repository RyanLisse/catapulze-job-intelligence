import type {
  OutboxEventRecord,
  ProjectorResult,
  SearchDocument,
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

const readStatus = (
  payload: Record<string, unknown>
): SearchDocument["status"] | null => {
  const status = payload.status;
  if (
    status === "active" ||
    status === "stale" ||
    status === "closed" ||
    status === "unknown"
  ) {
    return status;
  }

  return null;
};

export interface ProjectOutboxEventInput {
  event: OutboxEventRecord;
  indexVersion: number;
  loader: SearchDocumentLoader;
  engine: SearchEngine;
}

export const projectOutboxEvent = async (
  input: ProjectOutboxEventInput
): Promise<ProjectorResult> => {
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
  const payloadStatus = readStatus(event.payload);
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
};

export interface DrainOutboxInput {
  events: OutboxEventRecord[];
  loader: SearchDocumentLoader;
  engine: SearchEngine;
  startingIndexVersion?: number;
}

export const drainOutboxEvents = async (
  input: DrainOutboxInput
): Promise<number> => {
  let version = input.startingIndexVersion ?? 0;
  for (const event of input.events) {
    version += 1;
    await projectOutboxEvent({
      engine: input.engine,
      event: { ...event, indexVersion: version },
      indexVersion: version,
      loader: input.loader,
    });
  }

  return version;
};
