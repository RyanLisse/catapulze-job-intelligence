import type { BooleanNode } from "@ji/domain";
import { recordCriticalPathPhaseSync } from "@ji/performance";

import {
  DEFAULT_SEARCH_SCOPE,
  documentPartition,
  otherPartition,
  partitionTable,
  SEARCH_PARTITIONS,
  scopeTables,
} from "../partition";
import type { SearchPartition, SearchScope } from "../partition";
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
  ARCHIVE_COUNT_TIMEOUT_MS,
  buildManticoreCountRequest,
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
  ManticoreSearchRequestBody,
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
 * per-batch watermark, not document content), prefixed with the partition
 * the document belongs in at `now` (RJC-383) — so a status transition that
 * moves a document between tables can never be skipped as "unchanged", and
 * the projection state row remembers which table holds the document (see
 * partitionFromProjectionHash). Two documents with equal hashes produce
 * byte-identical Manticore rows in the same table, so the projector can
 * skip the write. Pure cyrb53 under two seeds (~106 bits) — no node:crypto,
 * as apps/web type-checks this package; a collision only costs a skipped
 * reindex.
 */
export const projectionHash = (
  document: SearchDocument,
  now: Date = new Date()
): string => {
  const indexed = documentToManticore(document, 0);
  const fields = Object.fromEntries(
    Object.entries(indexed).filter(([key]) => key !== "index_version")
  );
  const json = JSON.stringify(fields);
  return `${documentPartition(document, now)}:${hashDocumentId(json, 0).toString(36)}.${hashDocumentId(json, 1).toString(36)}`;
};

/** Partition recorded in a projectionHash; undefined for a pre-RJC-383 hash. */
export const partitionFromProjectionHash = (
  hash: string
): SearchPartition | undefined => {
  const prefix = hash.slice(0, hash.indexOf(":"));
  return SEARCH_PARTITIONS.find((partition) => partition === prefix);
};

/** One mutation's /bulk lines: kept together so isolation blames or releases the whole mutation. */
interface BulkEntry {
  id: string;
  lines: string[];
  sequence: bigint;
}

interface BulkChunk {
  entries: BulkEntry[];
}

const chunkLines = (chunk: BulkChunk): string[] =>
  chunk.entries.flatMap((entry) => entry.lines);

/** Index of the entry that owns 0-based line `line` of the flattened chunk. */
const entryIndexOfLine = (chunk: BulkChunk, line: number): number => {
  let seen = 0;
  for (const [index, entry] of chunk.entries.entries()) {
    seen += entry.lines.length;
    if (line < seen) {
      return index;
    }
  }
  return chunk.entries.length - 1;
};

interface ChunkOutcome {
  appliedSequences: bigint[];
  failures: SearchMutationFailure[];
  /** True when a failure could not be isolated: later chunks are not sent. */
  stop: boolean;
  unapplied: string[];
}

const encoder = new TextEncoder();

/** Splits serialized bulk entries into requests under MANTICORE_BULK_MAX_BYTES; an entry is never split. */
const chunkBulkLines = (
  entries: readonly BulkEntry[],
  maxBytes: number
): BulkChunk[] => {
  const chunks: BulkChunk[] = [];
  let current: BulkChunk = { entries: [] };
  let currentBytes = 0;
  for (const entry of entries) {
    const bytes = entry.lines.reduce(
      (sum, line) => sum + encoder.encode(line).byteLength + 1,
      0
    );
    if (current.entries.length > 0 && currentBytes + bytes > maxBytes) {
      chunks.push(current);
      current = { entries: [] };
      currentBytes = 0;
    }
    current.entries.push(entry);
    currentBytes += bytes;
  }
  if (current.entries.length > 0) {
    chunks.push(current);
  }
  return chunks;
};

const withoutEntry = (chunk: BulkChunk, at: number): BulkChunk => ({
  entries: chunk.entries.filter((_, index) => index !== at),
});

export class ManticoreSearchEngine implements SearchEngine {
  private readonly client: ManticoreHttpClient;
  private readonly clock: () => Date;
  /** Logical index name; the RT tables are `<indexName>_active` / `<indexName>_archive`. */
  private readonly indexName: string;
  private readonly versionStore: SearchVersionStore;

  constructor(
    client: ManticoreHttpClient,
    versionStore: SearchVersionStore,
    indexName = SEARCH_INDEX_NAME,
    clock: () => Date = () => new Date()
  ) {
    this.client = client;
    this.versionStore = versionStore;
    this.indexName = indexName;
    this.clock = clock;
  }

  static fromUrl(
    baseUrl: string,
    versionStore: SearchVersionStore,
    indexName = SEARCH_INDEX_NAME,
    clock: () => Date = () => new Date()
  ): ManticoreSearchEngine {
    return new ManticoreSearchEngine(
      new FetchManticoreClient(baseUrl),
      versionStore,
      indexName,
      clock
    );
  }

  private table(partition: SearchPartition): string {
    return partitionTable(this.indexName, partition);
  }

  /**
   * One POST /bulk per chunk (RJC-389). Under 6.3.8 a bulk is all-or-nothing
   * per consecutive same-table run (see manticoreBulkPayloadSchema; with the
   * RJC-383 split a request can hold several runs, and runs before the
   * failing one DO land — verified live). When a chunk fails at line L the
   * mutation owning L is re-sent ALONE before anyone is blamed:
   * alone-succeeds means the failure was positional or batch-wide (no blame,
   * mutation applied); alone-fails is the only path that yields a `failure`.
   * The rest of the chunk is then re-sent without it. A mutation's lines
   * (a move is replace-then-delete across two tables) always travel
   * together, so a failing replace never lets its delete run and a document
   * can never vanish from both tables. Isolation is capped per chunk
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
        lines: this.toBulkLines(mutation, indexVersion).map((line) =>
          JSON.stringify(line)
        ),
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
          unapplied.push(...later.entries.map((entry) => entry.id));
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
    while (pending.entries.length > 0) {
      const result = await bulkManticore(this.client, chunkLines(pending));
      if (result.ok) {
        outcome.appliedSequences.push(
          ...pending.entries.map((entry) => entry.sequence)
        );
        return outcome;
      }
      if (result.failingLine === null) {
        throw new Error(
          `Manticore bulk failed without naming a line: ${result.error}`
        );
      }
      if (isolationsLeft === 0) {
        outcome.unapplied.push(...pending.entries.map((entry) => entry.id));
        outcome.stop = true;
        return outcome;
      }
      isolationsLeft -= 1;
      const at = entryIndexOfLine(pending, result.failingLine);
      const entry = pending.entries[at];
      const alone = await bulkManticore(this.client, entry?.lines ?? []);
      if (alone.ok) {
        outcome.appliedSequences.push(entry?.sequence ?? ZERO_SEQUENCE);
      } else {
        outcome.failures.push({ error: alone.error, id: entry?.id ?? "" });
      }
      pending = withoutEntry(pending, at);
    }
    /* oxlint-enable no-await-in-loop */
    return outcome;
  }

  /**
   * Lines for one mutation (RJC-383). An upsert is a replace into its
   * partition's table, followed — only when the previous partition is
   * different or unknown — by a delete from the other table. Replace comes
   * FIRST on purpose: 6.3.8 commits per same-table run, so if the replace
   * fails the request stops before the delete and the document is still
   * findable in its old table; if the delete fails after the replace landed
   * the document is briefly in both tables until the retry, never in
   * neither. A delete goes to the known partition, or to both.
   */
  private toBulkLines(
    mutation: SearchIndexMutation,
    indexVersion: number
  ): ManticoreBulkLine[] {
    const deleteFrom = (
      id: string,
      partition: SearchPartition
    ): ManticoreBulkLine => ({
      delete: { id: hashDocumentId(id), index: this.table(partition) },
    });
    if (mutation.kind === "delete") {
      const partitions =
        mutation.partition === undefined
          ? SEARCH_PARTITIONS
          : [mutation.partition];
      return partitions.map((partition) => deleteFrom(mutation.id, partition));
    }
    const partition =
      mutation.partition ?? documentPartition(mutation.document, this.clock());
    const lines: ManticoreBulkLine[] = [
      {
        replace: {
          doc: documentToManticore(mutation.document, indexVersion),
          id: hashDocumentId(mutation.document.id),
          index: this.table(partition),
        },
      },
    ];
    if (mutation.previousPartition !== partition) {
      lines.push(deleteFrom(mutation.document.id, otherPartition(partition)));
    }
    return lines;
  }

  async deleteDocument(id: string): Promise<void> {
    for (const partition of SEARCH_PARTITIONS) {
      // oxlint-disable-next-line no-await-in-loop -- two tables, sequential to keep the client simple
      await deleteManticoreDocument(this.client, this.table(partition), id);
    }
  }

  async getAppliedVersion(): Promise<SearchVersion> {
    const checkpoint = await this.versionStore.read();
    return {
      appliedSequence: checkpoint.appliedSequence,
      generation: checkpoint.generation,
    };
  }

  /**
   * Scope "active" reads `<index>_active`; "all" reads both tables in one
   * request (multi-table search, sound on 6.3.8 — see scopeTables). For
   * "active" a second, aggregation-free `limit: 0` request against the
   * archive runs in parallel so the UI can report "N in archief" honestly;
   * that is the one extra round trip the split costs the default search.
   * The count is decoration and the search is the product: it runs under
   * its own, smaller budget (ARCHIVE_COUNT_TIMEOUT_MS) and any failure or
   * timeout degrades `archiveTotal` to `null` — it never rejects the search
   * and never touches `emptyReason`.
   */
  async search(params: EngineSearchParams): Promise<SearchEngineResult> {
    const version = await this.getAppliedVersion();
    const scope: SearchScope = params.scope ?? DEFAULT_SEARCH_SCOPE;
    const { archiveCountRequest, request } = recordCriticalPathPhaseSync(
      "search-serialization",
      () => {
        const queryString = buildQueryString(params.ast);
        const queryBody: ManticoreQueryBody | null =
          queryString === null ? null : { query_string: queryString };
        const searchRequest = buildManticoreSearchRequest(
          scopeTables(this.indexName, scope),
          queryBody,
          params.filters,
          params.limit,
          params.offset,
          params.sort
        );
        return {
          archiveCountRequest:
            scope === "active"
              ? buildManticoreCountRequest(
                  this.table("archive"),
                  queryBody,
                  params.filters
                )
              : null,
          request: searchRequest,
        };
      }
    );

    const [response, archiveTotal] = await Promise.all([
      searchManticore(this.client, request),
      this.countArchive(archiveCountRequest),
    ]);
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
      archiveTotal,
      emptyReason,
      facets,
      hits: response.hits,
      indexVersion: Number(version.appliedSequence),
      scope,
      total: response.total,
      windowLimit: SEARCH_WINDOW_LIMIT,
    };
  }

  /** `undefined` for scope "all" (no request); `null` when the count failed or timed out — the search itself is unaffected. */
  private async countArchive(
    request: ManticoreSearchRequestBody | null
  ): Promise<number | null | undefined> {
    if (request === null) {
      return undefined;
    }
    try {
      const counted = await searchManticore(this.client, request, {
        timeoutMs: ARCHIVE_COUNT_TIMEOUT_MS,
      });
      return counted.total;
    } catch (error) {
      // oxlint-disable-next-line no-console -- degradation must leave a trace; @ji/search has no logger dependency
      console.warn(
        JSON.stringify({
          error: error instanceof Error ? error.message : String(error),
          event: "search.archive_count_failed",
          index: request.index,
          timeoutMs: ARCHIVE_COUNT_TIMEOUT_MS,
        })
      );
      return null;
    }
  }

  /** Replace into the document's partition, then evict it from the other table (previous partition unknown here). */
  async upsertDocument(document: SearchDocument): Promise<void> {
    const version = await this.getAppliedVersion();
    const partition = documentPartition(document, this.clock());
    await replaceManticoreDocument(
      this.client,
      this.table(partition),
      documentToManticore(document, Number(version.appliedSequence))
    );
    await deleteManticoreDocument(
      this.client,
      this.table(otherPartition(partition)),
      document.id
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
