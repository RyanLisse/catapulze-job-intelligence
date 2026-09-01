import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { AANVRAAG_LIFECYCLE, parseBooleanQuery } from "@ji/domain";
import type { SearchEngine, SearchFilters } from "@ji/search";
import {
  InMemorySearchEngine,
  InMemorySearchVersionStore,
  ManticoreSearchEngine,
} from "@ji/search";
import { z } from "zod";

import { loadRelevanceCorpus } from "./corpus";
import type { RelevanceCorpusSummary } from "./corpus";

/**
 * Golden relevance runner (RJC-320, `.isa/search-quality.md`).
 *
 * Scores any `SearchEngine` implementation on the versioned query set in
 * `queries.jsonl` against the real fixture corpus from `corpus.ts`:
 * Recall@20 primary, nDCG@10 secondary, per query / per category / macro.
 * Always runs in-memory; adds Manticore when MANTICORE_URL is set. No
 * app-layer code changes are needed to add an engine — anything satisfying
 * the `SearchEngine` seam plugs into `buildEngineRuns`.
 */

const RECALL_DEPTH = 20;
const NDCG_DEPTH = 10;
const MIN_QUERY_COUNT = 35;
const METRIC_PRECISION = 6;
const REPORT_PATH = path.join(".artifacts", "relevance", "report.json");

const QUERY_CATEGORIES = [
  "exact-skill",
  "nl-morphology",
  "compound",
  "semantic-synonym",
  "phrase-filter",
  "nl-en-mix",
] as const;

const filtersSchema = z
  .object({
    bronIds: z.array(z.string()).optional(),
    contracttype: z.array(z.string()).optional(),
    locatieLand: z.array(z.string()).optional(),
    status: z.array(z.enum(AANVRAAG_LIFECYCLE)).optional(),
    tariefMax: z.number().optional(),
    tariefMin: z.number().optional(),
  })
  .strict();

const querySchema = z
  .object({
    category: z.enum(QUERY_CATEGORIES),
    filters: filtersSchema.optional(),
    hardNegatives: z.array(z.string()).min(1),
    id: z.string().min(1),
    note: z.string().optional(),
    query: z.string().min(1),
    relevant: z.array(z.string()).min(1),
  })
  .strict();

type RelevanceQuery = z.infer<typeof querySchema>;

const loadQueries = async (queriesPath: string): Promise<RelevanceQuery[]> => {
  const raw = await readFile(queriesPath, "utf-8");
  return raw
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line, index) => {
      const parsed: unknown = JSON.parse(line);
      const result = querySchema.safeParse(parsed);
      if (!result.success) {
        throw new Error(
          `queries.jsonl line ${index + 1}: ${result.error.message}`
        );
      }
      return result.data;
    });
};

/** ISC-1/ISC-2 gate: fail loudly before measuring anything on a broken set. */
const validateQuerySet = (
  queries: RelevanceQuery[],
  corpusIds: Set<string>
): void => {
  if (queries.length < MIN_QUERY_COUNT) {
    throw new Error(
      `query set has ${queries.length} queries; ISC-1 requires >= ${MIN_QUERY_COUNT}`
    );
  }
  const seenIds = new Set<string>();
  const seenCategories = new Set<string>();
  for (const query of queries) {
    if (seenIds.has(query.id)) {
      throw new Error(`duplicate query id: ${query.id}`);
    }
    seenIds.add(query.id);
    seenCategories.add(query.category);
    for (const docId of [...query.relevant, ...query.hardNegatives]) {
      if (!corpusIds.has(docId)) {
        throw new Error(`query ${query.id} judges unknown document: ${docId}`);
      }
    }
    const overlap = query.relevant.filter((docId) =>
      query.hardNegatives.includes(docId)
    );
    if (overlap.length > 0) {
      throw new Error(
        `query ${query.id} lists ${overlap.join(", ")} as both relevant and hard negative`
      );
    }
  }
  if (seenCategories.size !== QUERY_CATEGORIES.length) {
    throw new Error(
      `query set covers ${seenCategories.size} categories; ISC-1 requires all ${QUERY_CATEGORIES.length}`
    );
  }
};

const round = (value: number): number =>
  Number(value.toFixed(METRIC_PRECISION));

const recallAtK = (
  rankedIds: readonly string[],
  relevant: ReadonlySet<string>,
  depth: number
): number => {
  const top = rankedIds.slice(0, depth);
  const found = top.filter((id) => relevant.has(id)).length;
  return found / relevant.size;
};

const ndcgAtK = (
  rankedIds: readonly string[],
  relevant: ReadonlySet<string>,
  depth: number
): number => {
  const top = rankedIds.slice(0, depth);
  let dcg = 0;
  for (const [index, id] of top.entries()) {
    if (relevant.has(id)) {
      dcg += 1 / Math.log2(index + 2);
    }
  }
  const idealHits = Math.min(relevant.size, depth);
  let idcg = 0;
  for (let index = 0; index < idealHits; index += 1) {
    idcg += 1 / Math.log2(index + 2);
  }
  return idcg === 0 ? 0 : dcg / idcg;
};

interface QueryScore {
  category: RelevanceQuery["category"];
  id: string;
  ndcg10: number;
  recall20: number;
  returned: number;
}

interface MetricPair {
  ndcg10: number;
  recall20: number;
}

interface EngineReport {
  engine: string;
  overall: MetricPair;
  perCategory: Record<string, MetricPair>;
  perQuery: QueryScore[];
}

const macroAverage = (scores: readonly QueryScore[]): MetricPair => {
  if (scores.length === 0) {
    return { ndcg10: 0, recall20: 0 };
  }
  const recallSum = scores.reduce((sum, score) => sum + score.recall20, 0);
  const ndcgSum = scores.reduce((sum, score) => sum + score.ndcg10, 0);
  return {
    ndcg10: round(ndcgSum / scores.length),
    recall20: round(recallSum / scores.length),
  };
};

const scoreEngine = async (
  name: string,
  engine: SearchEngine,
  corpus: RelevanceCorpusSummary,
  queries: readonly RelevanceQuery[]
): Promise<EngineReport> => {
  for (const item of corpus.documents) {
    // oxlint-disable-next-line no-await-in-loop -- upserts are ordered so both engines index identically
    await engine.upsertDocument(item.document);
  }
  await engine.applyBatch({ appliedSequence: 1n, mutations: [] });

  const perQuery: QueryScore[] = [];
  for (const query of queries) {
    const parsed = parseBooleanQuery(query.query);
    if (!parsed.ok) {
      throw new Error(
        `query ${query.id} failed to parse: ${parsed.error.message}`
      );
    }
    // SAFETY: filtersSchema mirrors SearchFilters field-for-field; zod has
    // already validated shape and lifecycle values.
    const filters: SearchFilters = query.filters ?? {};
    // oxlint-disable-next-line no-await-in-loop -- queries run sequentially for stable, comparable output
    const result = await engine.search({
      ast: parsed.ast,
      filters,
      limit: RECALL_DEPTH,
      offset: 0,
    });
    const rankedIds = result.hits.map((hit) => hit.id);
    const relevant = new Set(query.relevant);
    perQuery.push({
      category: query.category,
      id: query.id,
      ndcg10: round(ndcgAtK(rankedIds, relevant, NDCG_DEPTH)),
      recall20: round(recallAtK(rankedIds, relevant, RECALL_DEPTH)),
      returned: result.hits.length,
    });
  }

  const perCategory: Record<string, MetricPair> = {};
  for (const category of QUERY_CATEGORIES) {
    perCategory[category] = macroAverage(
      perQuery.filter((score) => score.category === category)
    );
  }

  return {
    engine: name,
    overall: macroAverage(perQuery),
    perCategory,
    perQuery,
  };
};

interface EngineRun {
  cleanup: (() => Promise<void>) | null;
  engine: SearchEngine;
  name: string;
}

/** Builds one Manticore EngineRun. Shared by both the default MANTICORE_URL
 * engine and the optional RJC-382 comparison engine below. */
const buildManticoreRun = (
  name: string,
  url: string,
  corpus: RelevanceCorpusSummary
): EngineRun => {
  const manticore = ManticoreSearchEngine.fromUrl(
    url,
    new InMemorySearchVersionStore()
  );
  return {
    // The local Manticore table is shared with the app; benchmark ids are
    // `slug:referentie` strings that cannot collide with the app's UUID
    // ids, and every inserted document is removed again after scoring.
    cleanup: async () => {
      for (const item of corpus.documents) {
        // oxlint-disable-next-line no-await-in-loop -- sequential deletes keep cleanup simple and bounded (tens of docs)
        await manticore.deleteDocument(item.id);
      }
    },
    engine: manticore,
    name,
  };
};

/** In-memory always; Manticore when MANTICORE_URL is set (ISC-4: adding an
 * engine here is the only change needed — never in the application layer).
 *
 * RJC-382: an optional second Manticore target for the 6.3.8-vs-29.0.2
 * golden-set comparison. Set MANTICORE_29_URL to score a second engine in
 * the same run (e.g. the manticore29 shadow instance); MANTICORE_29_LABEL
 * optionally names it in the report (e.g. "manticore29-infix"), defaulting
 * to "manticore-29". Both are no-ops when unset, so `bun run relevance`
 * with only MANTICORE_URL set is unaffected. */
const buildEngineRuns = (corpus: RelevanceCorpusSummary): EngineRun[] => {
  const runs: EngineRun[] = [
    { cleanup: null, engine: new InMemorySearchEngine(), name: "in-memory" },
  ];
  const manticoreUrl = process.env.MANTICORE_URL?.trim();
  if (manticoreUrl) {
    runs.push(buildManticoreRun("manticore", manticoreUrl, corpus));
  }
  const manticore29Url = process.env.MANTICORE_29_URL?.trim();
  if (manticore29Url) {
    const label = process.env.MANTICORE_29_LABEL?.trim() || "manticore-29";
    runs.push(buildManticoreRun(label, manticore29Url, corpus));
  }
  return runs;
};

const COLUMN_WIDTH = 18;
const pad = (value: string): string => value.padEnd(COLUMN_WIDTH);

const printReport = (reports: readonly EngineReport[]): void => {
  const header = [pad("category"), ...reports.map((r) => pad(r.engine))].join(
    ""
  );
  console.log(
    `\n${pad("")}${reports.map(() => pad("recall@20 ndcg@10")).join("")}`
  );
  console.log(header);
  for (const category of QUERY_CATEGORIES) {
    const cells = reports.map((report) => {
      const pair = report.perCategory[category] ?? { ndcg10: 0, recall20: 0 };
      return pad(`${pair.recall20.toFixed(3)}     ${pair.ndcg10.toFixed(3)}`);
    });
    console.log([pad(category), ...cells].join(""));
  }
  const overallCells = reports.map((report) =>
    pad(
      `${report.overall.recall20.toFixed(3)}     ${report.overall.ndcg10.toFixed(3)}`
    )
  );
  console.log([pad("OVERALL (macro)"), ...overallCells].join(""));
};

const main = async (): Promise<void> => {
  const corpus = await loadRelevanceCorpus();
  const queries = await loadQueries(
    path.join(import.meta.dirname, "queries.jsonl")
  );
  validateQuerySet(queries, new Set(corpus.documents.map((item) => item.id)));

  console.log(
    `corpus: ${corpus.documents.length} documents from fixtures (${corpus.skipped.length} skipped), queries: ${queries.length}`
  );

  const reports: EngineReport[] = [];
  for (const run of buildEngineRuns(corpus)) {
    try {
      // oxlint-disable-next-line no-await-in-loop -- engines are scored one at a time so a shared Manticore index is never measured concurrently
      reports.push(await scoreEngine(run.name, run.engine, corpus, queries));
    } finally {
      if (run.cleanup) {
        // oxlint-disable-next-line no-await-in-loop -- cleanup must finish before the next engine runs
        await run.cleanup();
      }
    }
  }

  printReport(reports);

  // Deterministic report (no timestamps): two runs on the same corpus and
  // query set produce byte-identical JSON (ISC-5).
  const report = {
    corpus: {
      documents: corpus.documents.length,
      skipped: corpus.skipped,
    },
    engines: reports,
    metrics: { ndcgDepth: NDCG_DEPTH, recallDepth: RECALL_DEPTH },
    queryCount: queries.length,
  };
  await mkdir(path.dirname(REPORT_PATH), { recursive: true });
  await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`\nreport written to ${REPORT_PATH}`);
};

if (import.meta.main) {
  await main();
}
