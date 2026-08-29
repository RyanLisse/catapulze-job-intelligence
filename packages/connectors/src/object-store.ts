/* oxlint-disable max-classes-per-file -- in-memory and durable adapters share one small contract */
import type { BronId, ScrapeRunId, SourceRecordId } from "@ji/domain";

export type RawContentType = "json" | "html" | "pdf";

export interface RawObjectPathInput {
  bronSlug: string;
  runId: ScrapeRunId;
  recordId: string;
  contentType: RawContentType;
  startedAt?: Date;
}

const pad = (value: number): string => value.toString().padStart(2, "0");

export const buildRawObjectPath = ({
  bronSlug,
  contentType,
  recordId,
  runId,
  startedAt = new Date(),
}: RawObjectPathInput): string => {
  const year = startedAt.getUTCFullYear();
  const month = pad(startedAt.getUTCMonth() + 1);
  const day = pad(startedAt.getUTCDate());

  return `raw/${bronSlug}/${year}/${month}/${day}/${runId}/${recordId}.${contentType}`;
};

export interface StoredObject {
  path: string;
  body: Uint8Array;
  contentType: RawContentType;
  /** Object-store lifecycle deadline; raw defaults are configured by the caller. */
  expiresAt: Date;
}

export interface ObjectStore {
  put: (object: StoredObject) => Promise<void>;
  get: (path: string) => Promise<StoredObject | null>;
  deleteExpired: (before: Date) => Promise<number>;
}

export class InMemoryObjectStore implements ObjectStore {
  private readonly objects = new Map<string, StoredObject>();

  put(object: StoredObject): Promise<void> {
    this.objects.set(object.path, object);
    return Promise.resolve();
  }

  get(path: string): Promise<StoredObject | null> {
    return Promise.resolve(this.objects.get(path) ?? null);
  }

  deleteExpired(before: Date): Promise<number> {
    let deleted = 0;
    for (const [path, object] of this.objects) {
      if (object.expiresAt <= before) {
        this.objects.delete(path);
        deleted += 1;
      }
    }
    return Promise.resolve(deleted);
  }

  has(path: string): boolean {
    return this.objects.has(path);
  }
}

export const hashContent = async (body: Uint8Array): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(body));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

export interface SourceRecordPointer {
  bronId: BronId;
  bronReferentie: string;
  contentHash: string;
  rawPayloadRef: string;
  scrapeRunId: ScrapeRunId;
}

export type SourceRecordWriteOutcome = "new" | "changed" | "unchanged";

export interface SourceRecordWriteResult {
  outcome: SourceRecordWriteOutcome;
  sourceRecordId: SourceRecordId;
}

/** Adapter for durable S3-compatible clients without coupling connectors to an SDK. */
export interface DurableObjectClient {
  put: (object: StoredObject) => Promise<void>;
  get: (path: string) => Promise<StoredObject | null>;
  deleteExpired: (before: Date) => Promise<number>;
}

export class DurableObjectStore implements ObjectStore {
  private readonly client: DurableObjectClient;

  constructor(client: DurableObjectClient) {
    this.client = client;
  }

  put(object: StoredObject): Promise<void> {
    return this.client.put(object);
  }

  get(path: string): Promise<StoredObject | null> {
    return this.client.get(path);
  }

  deleteExpired(before: Date): Promise<number> {
    return this.client.deleteExpired(before);
  }
}
