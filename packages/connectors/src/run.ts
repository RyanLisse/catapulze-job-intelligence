import type { BronId, ScrapeRunId } from "@ji/domain";

import type {
  Connector,
  ConnectorCheckpoint,
  ConnectorDiscoverResult,
} from "./contract";
import { buildRawObjectPath, hashContent } from "./object-store";
import type { ObjectStore, SourceRecordWriter } from "./object-store";

export interface ConnectorRunInput {
  bronId: BronId;
  bronSlug: string;
  checkpoint: ConnectorCheckpoint | null;
  connector: Connector;
  objectStore: ObjectStore;
  scrapeRunId: ScrapeRunId;
  sourceRecordWriter: SourceRecordWriter;
  startedAt?: Date;
}

export interface ConnectorRunResult {
  checkpoint: ConnectorCheckpoint;
  metrics: ReturnType<Connector["runMetrics"]>;
  writtenRecords: number;
}

const persistFetchedItem = async ({
  bronId,
  bronSlug,
  connector,
  item,
  objectStore,
  scrapeRunId,
  sourceRecordWriter,
  startedAt,
}: {
  bronId: BronId;
  bronSlug: string;
  connector: Connector;
  item: ConnectorDiscoverResult["items"][number];
  objectStore: ObjectStore;
  scrapeRunId: ScrapeRunId;
  sourceRecordWriter: SourceRecordWriter;
  startedAt: Date;
}): Promise<boolean> => {
  const fetched = await connector.fetch(item);
  if (!fetched) {
    return false;
  }

  const contentHash =
    fetched.contentHash.length > 0
      ? fetched.contentHash
      : await hashContent(fetched.body);

  const rawPayloadRef = buildRawObjectPath({
    bronSlug,
    contentType: fetched.contentType,
    recordId: fetched.bronReferentie,
    runId: scrapeRunId,
    startedAt,
  });

  await objectStore.put({
    body: fetched.body,
    contentType: fetched.contentType,
    path: rawPayloadRef,
  });

  await sourceRecordWriter.write({
    bronId,
    bronReferentie: fetched.bronReferentie,
    contentHash,
    rawPayloadRef,
    scrapeRunId,
  });

  return true;
};

const processDiscoveryItems = async ({
  bronId,
  bronSlug,
  connector,
  items,
  index,
  objectStore,
  scrapeRunId,
  sourceRecordWriter,
  startedAt,
  writtenRecords,
}: {
  bronId: BronId;
  bronSlug: string;
  connector: Connector;
  items: ConnectorDiscoverResult["items"];
  index: number;
  objectStore: ObjectStore;
  scrapeRunId: ScrapeRunId;
  sourceRecordWriter: SourceRecordWriter;
  startedAt: Date;
  writtenRecords: number;
}): Promise<number> => {
  const item = items[index];
  if (!item) {
    return writtenRecords;
  }

  const persisted = await persistFetchedItem({
    bronId,
    bronSlug,
    connector,
    item,
    objectStore,
    scrapeRunId,
    sourceRecordWriter,
    startedAt,
  });

  return processDiscoveryItems({
    bronId,
    bronSlug,
    connector,
    index: index + 1,
    items,
    objectStore,
    scrapeRunId,
    sourceRecordWriter,
    startedAt,
    writtenRecords: persisted ? writtenRecords + 1 : writtenRecords,
  });
};

export const runConnector = async ({
  bronId,
  bronSlug,
  checkpoint,
  connector,
  objectStore,
  scrapeRunId,
  sourceRecordWriter,
  startedAt = new Date(),
}: ConnectorRunInput): Promise<ConnectorRunResult> => {
  if (connector.bronId !== bronId) {
    throw new Error("connector bronId does not match run bronId");
  }

  const discovery = await connector.discover(checkpoint);
  const writtenRecords = await processDiscoveryItems({
    bronId,
    bronSlug,
    connector,
    index: 0,
    items: discovery.items,
    objectStore,
    scrapeRunId,
    sourceRecordWriter,
    startedAt,
    writtenRecords: 0,
  });

  return {
    checkpoint: connector.checkpoint(discovery.checkpoint),
    metrics: connector.runMetrics(),
    writtenRecords,
  };
};
