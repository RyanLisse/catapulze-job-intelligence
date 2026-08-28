import type { BronId, ScrapeRunId } from "@ji/domain";

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
}

export interface ObjectStore {
  put: (object: StoredObject) => Promise<void>;
  get: (path: string) => Promise<StoredObject | null>;
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

export interface SourceRecordWriter {
  write: (record: SourceRecordPointer) => Promise<void>;
}
