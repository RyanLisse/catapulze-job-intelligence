import type { BooleanNode } from "@ji/domain";
import { recordCriticalPathPhaseSync } from "@ji/performance";

import type {
  EngineSearchParams,
  SearchDocument,
  SearchEngine,
  SearchEngineResult,
  SearchIndexBatch,
  SearchIndexBatchResult,
  SearchIndexMutation,
  SearchMutationFailure,
} from "../types";
import {
  documentLocatie,
  mutationId,
  SEARCH_INDEX_NAME,
  SEARCH_WINDOW_LIMIT,
} from "../types";
import { ZERO_SEQUENCE } from "../version";
import type { SearchVersion, SearchVersionStore } from "../version";
import {
  buildManticoreSearchRequest,
  bulkManticore,
  deleteManticoreDocument,
  FetchManticoreClient,
  replaceManticoreDocument,
  searchManticore,
} from "./client";
import type { ManticoreHttpClient } from "./client";
import { buildBoolJson, buildQueryString } from "./emitter";
import type { ManticoreBoolQuery } from "./emitter";
import { hashDocumentId } from "./id-hash";
import type {
  ManticoreBulkLine,
  ManticoreIndexedDocument,
  ManticoreQueryBody,
} from "./json";

/**
 * Upper bound on one POST /bulk body (RJC-389). Manticore's default
 * max_packet_size is 128MB; 8MB keeps a single request well inside that and
 * bounds the blast radius of an all-or-nothing bulk (see
 * manticoreBulkPayloadSchema). A batch above the cap is split into
 * independent requests; each request is atomic on its own.
 */
export const MANTICORE_BULK_MAX_BYTES = 8 * 1024 * 1024;
/**
 * Isolation re-sends per chunk per drain: how many failing lines one chunk
 * may single out (re-send alone, then re-send the rest) before the remainder
 * is released unblamed to the next drain.
 */
export const MANTICORE_BULK_ISOLATION_RESENDS_PER_CHUNK = 1;

/**
 * 2100-01-01T00:00:00Z. Indexed under `sluitingsdatum` when a document has no
 * deadline so `ORDER BY sluitingsdatum ASC` (the closing-soon sort) lists
 * real deadlines first and missing ones last without a per-match expression.
 * Fits Manticore's 32-bit timestamp attribute (max 2106) and is far past
 * any deadline a bron will publish. Do not filter on it as a real date.
 */
export const SLUITINGSDATUM_MISSING_SENTINEL = 4_102_444_800;

const epochSeconds = (value: Date): number =>
  Math.floor(value.getTime() / 1000);

const documentToManticore = (
  document: SearchDocument,
  indexVersion: number
): ManticoreIndexedDocument => ({
  beschrijving: document.beschrijving,
  bron_id: document.bronId,
  contracttype: document.contracttype ?? "",
  document_id: document.id,
  index_version: indexVersion,
  laatst_gezien_op: epochSeconds(document.laatstGezienOp),
  locatie: documentLocatie(document),
  locatie_land: document.locatieLand,
  sluitingsdatum: document.sluitingsdatum
    ? epochSeconds(document.sluitingsdatum)
    : SLUITINGSDATUM_MISSING_SENTINEL,
  status: document.status,
  // 0 doubles as "no rate": rate-high sorts tarief_max desc, so it lands last.
  tarief_max: document.tariefMax ?? 0,
  tarief_min: document.tariefMin ?? 0,
  titel: document.titel,
});

/**
 * Hash of the search-relevant projection of a document (RJC-389): exactly
 * the attributes documentToManticore indexes, minus index_version (a
 * per-batch watermark, not document content). Two documents with equal
 * hashes produce byte-identical Manticore rows, so the projector can skip
 * the write. Pure cyrb53 under two seeds (~106 bits) — no node:crypto, as
 * apps/web type-checks this package; a collision only costs a skipped
 * reindex.
 */
export const projectionHash = (document: SearchDocument): string => {
  const indexed = documentToManticore(document, 0);
  const fields = Object.fromEntries(
    Object.entries(indexed).filter(([key]) => key !== "index_version")
  );
  const json = JSON.stringify(fields);
  return `${hashDocumentId(json, 0).toString(36)}.${hashDocumentId(json, 1).toString(36)}`;
};

interface BulkChunk {
  ids: string[];
  lines: string[];
  sequences: bigint[];
}

interface ChunkOutcome {
  appliedSequences: bigint[];
  failures: SearchMutationFailure[];
  /** True when a failure could not be isolated: later chunks are not sent. */
  stop: boolean;
  unapplied: string[];
}

const encoder = new TextEncoder();

/** Splits serialized bulk lines into requests under MANTICORE_BULK_MAX_BYTES. */
const chunkBulkLines = (
  entries: readonly { id: string; line: string; sequence: bigint }[],
  maxBytes: number
): BulkChunk[] => {
  const chunks: BulkChunk[] = [];
  let current: BulkChunk = { ids: [], lines: [], sequences: [] };
  let currentBytes = 0;
  for (const entry of entries) {
    const bytes = encoder.encode(entry.line).byteLength + 1;
    if (current.lines.length > 0 && currentBytes + bytes > maxBytes) {
      chunks.push(current);
      current = { ids: [], lines: [], sequences: [] };
      currentBytes = 0;
    }
    current.ids.push(entry.id);
    current.lines.push(entry.line);
    current.sequences.push(entry.sequence);
    currentBytes += bytes;
  }
  if (current.lines.length > 0) {
    chunks.push(current);
  }
  return chunks;
};

export class ManticoreSearchEngine implements SearchEngine {
  private readonly client: ManticoreHttpClient;
  private readonly indexName: string;
  private readonly versionStore: SearchVersionStore;

  constructor(
    client: ManticoreHttpClient,
    versionStore: SearchVersionStore,
    indexName = SEARCH_INDEX_NAME
  ) {
    this.client = client;
    this.versionStore = versionStore;
    this.indexName = indexName;
  }

  static fromUrl(
    baseUrl: string,
    versionStore: SearchVersionStore,
    indexName = SEARCH_INDEX_NAME
  ): ManticoreSearchEngine {
    return new ManticoreSearchEngine(
      new FetchManticoreClient(baseUrl),
      versionStore,
      indexName
    );
  }

  /**
   * One POST /bulk per chunk (RJC-389). Under 6.3.8 a bulk is all-or-nothing
   * per request (see manticoreBulkPayloadSchema). When a chunk fails at line
   * L the line is re-sent ALONE before anyone is blamed: alone-succeeds means
   * the failure was positional or batch-wide (no blame, line applied);
   * alone-fails is the only path that yields a `failure`. The rest of the
   * chunk is then re-sent without L. Isolation is capped per chunk
   * (MANTICORE_BULK_ISOLATION_RESENDS_PER_CHUNK) so a poison-heavy backlog
   * still drains ≥1 row per chunk per drain; whatever cannot be isolated is
   * `unapplied` (released unblamed), as are all later chunks. Manticore
   * writes land first, the checkpoint advances second (to the batch sequence
   * when all applied, else to the highest applied sequence): a crash in
   * between re-applies the batch, which replace/delete-by-id make idempotent.
   */
  async applyBatch(batch: SearchIndexBatch): Promise<SearchIndexBatchResult> {
    const indexVersion = Number(batch.appliedSequence);
    const chunks = chunkBulkLines(
      batch.mutations.map((mutation) => ({
        id: mutationId(mutation),
        line: JSON.stringify(this.toBulkLine(mutation, indexVersion)),
        sequence: mutation.sequenceNumber,
      })),
      MANTICORE_BULK_MAX_BYTES
    );

    const failures: SearchMutationFailure[] = [];
    const unapplied: string[] = [];
    let appliedSequence: bigint | null = null;

    /* oxlint-disable no-await-in-loop -- chunks are sent in sequence order; an unresolved failure stops the batch */
    for (const [chunkIndex, chunk] of chunks.entries()) {
      const outcome = await this.applyChunk(chunk);
      failures.push(...outcome.failures);
      unapplied.push(...outcome.unapplied);
      for (const sequence of outcome.appliedSequences) {
        if (appliedSequence === null || sequence > appliedSequence) {
          appliedSequence = sequence;
        }
      }
      if (outcome.stop) {
        for (const later of chunks.slice(chunkIndex + 1)) {
          unapplied.push(...later.ids);
        }
        break;
      }
    }
    /* oxlint-enable no-await-in-loop */

    if (failures.length === 0 && unapplied.length === 0) {
      const version = await this.versionStore.advance(batch.appliedSequence);
      return { ...version, failures, unapplied };
    }
    const version =
      appliedSequence === null
        ? await this.getAppliedVersion()
        : await this.versionStore.advance(appliedSequence);
    return { ...version, failures, unapplied };
  }

  /** One chunk with the isolation re-send policy described on applyBatch. */
  private async applyChunk(chunk: BulkChunk): Promise<ChunkOutcome> {
    const outcome: ChunkOutcome = {
      appliedSequences: [],
      failures: [],
      stop: false,
      unapplied: [],
    };
    let pending = chunk;
    let isolationsLeft = MANTICORE_BULK_ISOLATION_RESENDS_PER_CHUNK;
    /* oxlint-disable no-await-in-loop -- each round depends on the previous response */
    while (pending.lines.length > 0) {
      const result = await bulkManticore(this.client, pending.lines);
      if (result.ok) {
        outcome.appliedSequences.push(...pending.sequences);
        return outcome;
      }
      if (result.failingLine === null) {
        throw new Error(
          `Manticore bulk failed without naming a line: ${result.error}`
        );
      }
      if (isolationsLeft === 0) {
        outcome.unapplied.push(...pending.ids);
        outcome.stop = true;
        return outcome;
      }
      isolationsLeft -= 1;
      const at = result.failingLine;
      const alone = await bulkManticore(this.client, [pending.lines[at] ?? ""]);
      const id = pending.ids[at] ?? "";
      if (alone.ok) {
        outcome.appliedSequences.push(pending.sequences[at] ?? ZERO_SEQUENCE);
      } else {
        outcome.failures.push({ error: alone.error, id });
      }
      pending = {
        ids: pending.ids.filter((_, index) => index !== at),
        lines: pending.lines.filter((_, index) => index !== at),
        sequences: pending.sequences.filter((_, index) => index !== at),
      };
    }
    /* oxlint-enable no-await-in-loop */
    return outcome;
  }

  private toBulkLine(
    mutation: SearchIndexMutation,
    indexVersion: number
  ): ManticoreBulkLine {
    if (mutation.kind === "delete") {
      return {
        delete: { id: hashDocumentId(mutation.id), index: this.indexName },
      };
    }
    return {
      replace: {
        doc: documentToManticore(mutation.document, indexVersion),
        id: hashDocumentId(mutation.document.id),
        index: this.indexName,
      },
    };
  }

  async deleteDocument(id: string): Promise<void> {
    await deleteManticoreDocument(this.client, this.indexName, id);
  }

  async getAppliedVersion(): Promise<SearchVersion> {
    const checkpoint = await this.versionStore.read();
    return {
      appliedSequence: checkpoint.appliedSequence,
      generation: checkpoint.generation,
    };
  }

  async search(params: EngineSearchParams): Promise<SearchEngineResult> {
    const version = await this.getAppliedVersion();
    const { request } = recordCriticalPathPhaseSync(
      "search-serialization",
      () => {
        const queryString = buildQueryString(params.ast);
        const queryBody: ManticoreQueryBody | null =
          queryString === null ? null : { query_string: queryString };

        return {
          request: buildManticoreSearchRequest(
            this.indexName,
            queryBody,
            params.filters,
            params.limit,
            params.offset,
            params.sort
          ),
        };
      }
    );

    const response = await searchManticore(this.client, request);
    // A reason Manticore itself reported (e.g. "query_timeout", RJC-380)
    // takes priority over the empty_index fallback below — an index that
    // timed out at zero hits is not the same thing as a genuinely empty
    // index, and must not be reported as one.
    const emptyReason =
      response.emptyReason ??
      (response.total === 0 && version.appliedSequence === ZERO_SEQUENCE
        ? "empty_index"
        : undefined);

    const facets = recordCriticalPathPhaseSync(
      "search-facets",
      () => response.facets
    );

    return {
      emptyReason,
      facets,
      hits: response.hits,
      indexVersion: Number(version.appliedSequence),
      total: response.total,
      windowLimit: SEARCH_WINDOW_LIMIT,
    };
  }

  async upsertDocument(document: SearchDocument): Promise<void> {
    const version = await this.getAppliedVersion();
    await replaceManticoreDocument(
      this.client,
      this.indexName,
      documentToManticore(document, Number(version.appliedSequence))
    );
  }
}

export const buildRecordedQuery = (
  ast: BooleanNode | null
): ManticoreBoolQuery | ManticoreQueryBody | null => {
  if (ast === null) {
    return null;
  }

  const queryString = buildQueryString(ast);
  if (queryString !== null) {
    return { query_string: queryString };
  }

  return buildBoolJson(ast);
};
