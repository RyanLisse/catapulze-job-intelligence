import type { BooleanNode } from "@ji/domain";

import { evaluateBooleanAst } from "./adapter";
import type {
  EngineSearchParams,
  SearchDocument,
  SearchEngine,
  SearchEngineResult,
} from "./types";
import { emptySearchFacets } from "./types";

export interface PostgresFtsRow {
  beschrijving: string;
  bron_id: string;
  contracttype: string | null;
  id: string;
  laatst_gezien_op: Date;
  locatie_land: string;
  rank: number;
  status: SearchDocument["status"];
  tarief_max: number | null;
  tarief_min: number | null;
  titel: string;
}

export interface PostgresFtsExecutor {
  search: (params: {
    filters: EngineSearchParams["filters"];
    limit: number;
    matchAst: BooleanNode | null;
    offset: number;
  }) => Promise<PostgresFtsRow[]>;
}

/**
 * Rebuild/fallback adapter behind the same SearchEngine interface.
 * Not the P0 query path — use ManticoreSearchEngine in production.
 */
export class PostgresFtsFallbackEngine implements SearchEngine {
  private readonly documents = new Map<string, SearchDocument>();
  private readonly executor: PostgresFtsExecutor | undefined;
  private indexVersion = 0;

  constructor(
    executor?: PostgresFtsExecutor,
    seedDocuments: SearchDocument[] = []
  ) {
    this.executor = executor;
    for (const document of seedDocuments) {
      this.documents.set(document.id, structuredClone(document));
    }
  }

  deleteDocument(id: string): Promise<void> {
    this.documents.delete(id);
    return Promise.resolve();
  }

  getIndexVersion(): Promise<number> {
    return Promise.resolve(this.indexVersion);
  }

  setIndexVersion(version: number): Promise<void> {
    this.indexVersion = version;
    return Promise.resolve();
  }

  async search(params: EngineSearchParams): Promise<SearchEngineResult> {
    if (this.executor) {
      const rows = await this.executor.search({
        filters: params.filters,
        limit: params.limit,
        matchAst: params.ast,
        offset: params.offset,
      });

      return {
        facets: emptySearchFacets(),
        hits: rows.map((row) => ({ id: row.id, weight: row.rank })),
        indexVersion: this.indexVersion,
        total: rows.length,
      };
    }

    const matched = [...this.documents.values()].filter((document) => {
      if (params.ast === null) {
        return true;
      }

      return evaluateBooleanAst(
        params.ast,
        document.titel,
        document.beschrijving
      );
    });

    const sorted = matched.toSorted((left, right) =>
      left.id.localeCompare(right.id)
    );
    const page = sorted.slice(params.offset, params.offset + params.limit);

    return {
      emptyReason: this.documents.size === 0 ? "empty_index" : undefined,
      facets: emptySearchFacets(),
      hits: page.map((document) => ({ id: document.id, weight: 1 })),
      indexVersion: this.indexVersion,
      total: matched.length,
    };
  }

  upsertDocument(document: SearchDocument): Promise<void> {
    this.documents.set(document.id, structuredClone(document));
    return Promise.resolve();
  }
}
