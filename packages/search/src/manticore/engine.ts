import type { BooleanNode } from "@ji/domain";

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
  type ManticoreHttpClient,
} from "./client";
import { buildBoolJson, buildQueryString } from "./emitter";

const documentToManticore = (
  document: SearchDocument,
  indexVersion: number
): Record<string, string | number> => ({
  beschrijving: document.beschrijving,
  bron_id: document.bronId,
  contracttype: document.contracttype ?? "",
  id: document.id,
  laatst_gezien_op: Math.floor(document.laatstGezienOp.getTime() / 1000),
  locatie_land: document.locatieLand,
  status: document.status,
  tarief_max: document.tariefMax ?? 0,
  tarief_min: document.tariefMin ?? 0,
  titel: document.titel,
  index_version: indexVersion,
});

export class ManticoreSearchEngine implements SearchEngine {
  private indexVersion = 0;

  constructor(
    private readonly client: ManticoreHttpClient,
    private readonly indexName: string = SEARCH_INDEX_NAME
  ) {}

  static fromUrl(baseUrl: string, indexName = SEARCH_INDEX_NAME): ManticoreSearchEngine {
    return new ManticoreSearchEngine(new FetchManticoreClient(baseUrl), indexName);
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
    const queryString = buildQueryString(params.ast);
    const query =
      queryString === null
        ? null
        : ({ query_string: queryString } satisfies Record<string, string>);

    const request = buildManticoreSearchRequest(
      this.indexName,
      query,
      params.filters,
      params.limit,
      params.offset
    );

    const response = await searchManticore(this.client, request);
    const emptyReason =
      response.total === 0 && this.indexVersion === 0
        ? "empty_index"
        : response.emptyReason;

    return {
      emptyReason,
      facets: response.facets,
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
};

export const buildRecordedQuery = (
  ast: BooleanNode | null
): Record<string, unknown> | null => {
  if (ast === null) {
    return null;
  }

  const queryString = buildQueryString(ast);
  if (queryString !== null) {
    return { query_string: queryString };
  }

  const boolQuery = buildBoolJson(ast);
  return boolQuery as unknown as Record<string, unknown>;
};
