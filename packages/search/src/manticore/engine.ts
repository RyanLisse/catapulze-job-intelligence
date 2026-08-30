import type { BooleanNode } from "@ji/domain";
import { recordCriticalPathPhaseSync } from "@ji/performance";

import type {
  EngineSearchParams,
  SearchDocument,
  SearchEngine,
  SearchEngineResult,
} from "../types";
import { SEARCH_INDEX_NAME } from "../types";
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

const documentToManticore = (
  document: SearchDocument,
  indexVersion: number
): ManticoreIndexedDocument => ({
  beschrijving: document.beschrijving,
  bron_id: document.bronId,
  contracttype: document.contracttype ?? "",
  document_id: document.id,
  index_version: indexVersion,
  laatst_gezien_op: Math.floor(document.laatstGezienOp.getTime() / 1000),
  locatie_land: document.locatieLand,
  status: document.status,
  tarief_max: document.tariefMax ?? 0,
  tarief_min: document.tariefMin ?? 0,
  titel: document.titel,
});

export class ManticoreSearchEngine implements SearchEngine {
  private indexVersion = 0;
  private readonly client: ManticoreHttpClient;
  private readonly indexName: string;

  constructor(client: ManticoreHttpClient, indexName = SEARCH_INDEX_NAME) {
    this.client = client;
    this.indexName = indexName;
  }

  static fromUrl(
    baseUrl: string,
    indexName = SEARCH_INDEX_NAME
  ): ManticoreSearchEngine {
    return new ManticoreSearchEngine(
      new FetchManticoreClient(baseUrl),
      indexName
    );
  }

  async deleteDocument(id: string): Promise<void> {
    await deleteManticoreDocument(this.client, this.indexName, id);
  }

  getIndexVersion(): Promise<number> {
    return Promise.resolve(this.indexVersion);
  }

  setIndexVersion(version: number): Promise<void> {
    this.indexVersion = version;
    return Promise.resolve();
  }

  async search(params: EngineSearchParams): Promise<SearchEngineResult> {
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
            params.offset
          ),
        };
      }
    );

    const response = await searchManticore(this.client, request);
    const emptyReason =
      response.total === 0 && this.indexVersion === 0
        ? "empty_index"
        : response.emptyReason;

    const facets = recordCriticalPathPhaseSync(
      "search-facets",
      () => response.facets
    );

    return {
      emptyReason,
      facets,
      hits: response.hits,
      indexVersion: this.indexVersion,
      total: response.total,
    };
  }

  async upsertDocument(document: SearchDocument): Promise<void> {
    await replaceManticoreDocument(
      this.client,
      this.indexName,
      documentToManticore(document, this.indexVersion)
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
