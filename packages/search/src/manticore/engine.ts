import type { BooleanNode } from "@ji/domain";
import { recordCriticalPathPhaseSync } from "@ji/performance";

import type {
  EngineSearchParams,
  SearchDocument,
  SearchEngine,
  SearchEngineResult,
  SearchIndexBatch,
} from "../types";
import {
  documentLocatie,
  SEARCH_INDEX_NAME,
  SEARCH_WINDOW_LIMIT,
} from "../types";
import { ZERO_SEQUENCE } from "../version";
import type { SearchVersion, SearchVersionStore } from "../version";
import {
  buildManticoreSearchRequest,
  deleteManticoreDocument,
  FetchManticoreClient,
  replaceManticoreDocument,
  searchManticore,
} from "./client";
import type { ManticoreHttpClient } from "./client";
import { buildBoolJson, buildQueryString } from "./emitter";
import type { ManticoreBoolQuery } from "./emitter";
import type { ManticoreIndexedDocument, ManticoreQueryBody } from "./json";

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

  async applyBatch(batch: SearchIndexBatch): Promise<SearchVersion> {
    const indexVersion = Number(batch.appliedSequence);
    /* oxlint-disable no-await-in-loop -- mutations apply in outbox sequence order */
    for (const mutation of batch.mutations) {
      await (mutation.kind === "delete"
        ? deleteManticoreDocument(this.client, this.indexName, mutation.id)
        : replaceManticoreDocument(
            this.client,
            this.indexName,
            documentToManticore(mutation.document, indexVersion)
          ));
    }
    /* oxlint-enable no-await-in-loop */
    // Manticore writes land first, the checkpoint advances second: a crash
    // in between re-applies the batch, which the replace/delete-by-id
    // semantics make idempotent.
    return this.versionStore.advance(batch.appliedSequence);
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
