import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import {
  buildSearchSummaryRecord,
  buildWorkloadMetadata,
  digestQueryset,
} from "@ji/performance";
import type { SearchDocument, SearchEngine } from "@ji/search";
import {
  InMemorySearchEngine,
  InMemorySearchVersionStore,
  ManticoreSearchEngine,
  SearchAdapter,
} from "@ji/search";
import { z } from "zod";

import { sha256Digest } from "./digest";

export interface BenchmarkProfile {
  concurrency: number;
  corpus: {
    expectedDocuments: number;
    pointer: string;
  };
  measuredIterations: number;
  queries: { id: string; query: string; weight: number }[];
  slo: {
    boundary: string;
    maxMs: number;
    metric: string;
  };
  warmupIterations: number;
}

export const benchmarkProfileSchema = z.object({
  concurrency: z.number().int().min(1),
  corpus: z.object({
    expectedDocuments: z.number(),
    pointer: z.string(),
  }),
  measuredIterations: z.number(),
  queries: z.array(
    z.object({
      id: z.string(),
      query: z.string(),
      weight: z.number(),
    })
  ),
  slo: z.object({
    boundary: z.string(),
    maxMs: z.number(),
    metric: z.string(),
  }),
  warmupIterations: z.number(),
});

interface BenchmarkArgs {
  profilePath: string;
}

// Runs `worker` over `items` with at most `concurrency` calls in flight —
// a small bounded pool: each of `concurrency` loops pulls the next item off
// a shared cursor until the list is exhausted. Item order in `items` is not
// preserved in execution order, but total call count is exact.
export const runWithConcurrency = async <T>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T) => Promise<void>
): Promise<void> => {
  let cursor = 0;
  const poolSize = Math.max(1, Math.min(concurrency, items.length || 1));
  const workers = Array.from({ length: poolSize }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      const item = items[index];
      if (item === undefined) {
        return;
      }
      // oxlint-disable-next-line no-await-in-loop -- each pool worker must process its items sequentially; concurrency comes from running poolSize workers in parallel
      await worker(item);
    }
  });
  await Promise.all(workers);
};

// Flattens (iterations * queries) into one task list — the shape
// runWithConcurrency's worker pool consumes.
const buildTaskList = (
  profile: BenchmarkProfile,
  iterations: number
): BenchmarkProfile["queries"] => {
  const tasks: BenchmarkProfile["queries"] = [];
  for (let index = 0; index < iterations; index += 1) {
    tasks.push(...profile.queries);
  }
  return tasks;
};

const percentile = (values: number[], pct: number): number => {
  if (values.length === 0) {
    return 0;
  }

  const sorted = values.toSorted((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((pct / 100) * sorted.length) - 1)
  );
  return sorted[index] ?? 0;
};

const loadProfile = (profilePath: string): BenchmarkProfile => {
  const raw = readFileSync(profilePath, "utf-8");
  const parsed: unknown = JSON.parse(raw);
  return benchmarkProfileSchema.parse(parsed);
};

const seedDocuments = (count: number): SearchDocument[] =>
  Array.from({ length: count }, (_, index) => ({
    beschrijving: `Document ${index} about Azure platform engineer work`,
    bronId: `bron-${index % 5}`,
    contracttype: index % 2 === 0 ? "detachering" : "interim",
    id: `doc-${index}`,
    laatstGezienOp: new Date(Date.now() - index * 3_600_000),
    locatieLand: index % 3 === 0 ? "NL" : "BE",
    status: "active",
    tariefMax: 100 + (index % 40),
    tariefMin: 60 + (index % 20),
    titel: `Platform engineer ${index}`,
  }));

// Unbounded Promise.all over the whole corpus opens one HTTP connection per
// document simultaneously, which resets Manticore's connection under load
// at realistic corpus sizes (confirmed: 20k docs ECONNRESET'd against local
// compose Manticore). Indexing in small concurrent batches keeps the same
// upsertDocument interface while staying within Manticore's connection
// capacity.
const UPSERT_BATCH_SIZE = 100;

const upsertAll = async (
  engine: SearchEngine,
  documents: SearchDocument[]
): Promise<void> => {
  for (let start = 0; start < documents.length; start += UPSERT_BATCH_SIZE) {
    const batch = documents.slice(start, start + UPSERT_BATCH_SIZE);
    /* oxlint-disable no-await-in-loop -- batches must index sequentially to bound concurrent connections */
    await Promise.all(batch.map((document) => engine.upsertDocument(document)));
    /* oxlint-enable no-await-in-loop */
  }
};

interface ResolvedCorpus {
  corpusDigest: string;
  documents: SearchDocument[];
}

// Reads corpus JSONL produced by benchmarks/search/generate-corpus.ts. Each
// line matches SearchDocument except laatstGezienOp is an ISO string (JSON
// has no Date type), so it is parsed back into a Date here.
const readCorpusFile = (filePath: string): ResolvedCorpus => {
  const raw = readFileSync(filePath, "utf-8");
  const corpusDigest = sha256Digest(raw);
  const documents = raw
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      // SAFETY: line is a JSONL record written by generate-corpus.ts, which
      // emits exactly the SearchDocument fields (laatstGezienOp as an ISO
      // string, reparsed into a Date on the next line).
      const parsed = JSON.parse(line) as SearchDocument;
      return { ...parsed, laatstGezienOp: new Date(parsed.laatstGezienOp) };
    });
  return { corpusDigest, documents };
};

// BENCH_CORPUS overrides the profile's corpus pointer; falls back to
// synthetic seedDocuments when neither path exists on disk (e.g. local
// dev runs that never generated a corpus).
const resolveCorpusDocuments = (profile: BenchmarkProfile): ResolvedCorpus => {
  const pointer = process.env.BENCH_CORPUS ?? profile.corpus.pointer;
  const resolved = path.resolve(process.cwd(), pointer);
  if (existsSync(resolved)) {
    return readCorpusFile(resolved);
  }

  const count = Number(process.env.BENCH_CORPUS_SIZE ?? 1000);
  return {
    corpusDigest: sha256Digest(`seedDocuments:${count}`),
    documents: seedDocuments(count),
  };
};

const createEngine = async (
  profile: BenchmarkProfile
): Promise<{
  corpusDigest: string;
  documentCount: number;
  engine: SearchEngine;
}> => {
  const manticoreUrl = process.env.MANTICORE_URL;
  const { corpusDigest, documents } = resolveCorpusDocuments(profile);
  const engine = manticoreUrl
    ? ManticoreSearchEngine.fromUrl(
        manticoreUrl,
        new InMemorySearchVersionStore()
      )
    : new InMemorySearchEngine();
  await upsertAll(engine, documents);
  await engine.applyBatch({ appliedSequence: 1n, mutations: [] });
  return { corpusDigest, documentCount: documents.length, engine };
};

const parseArgs = (): BenchmarkArgs => {
  const profileFlagIndex = process.argv.indexOf("--profile");
  const profilePath =
    profileFlagIndex === -1
      ? "benchmarks/search/profile.json"
      : process.argv[profileFlagIndex + 1];
  if (!profilePath) {
    throw new Error("Missing value for --profile");
  }

  return { profilePath: path.resolve(process.cwd(), profilePath) };
};

export const runWarmup = async (
  adapter: SearchAdapter,
  profile: BenchmarkProfile
): Promise<void> => {
  const tasks = buildTaskList(profile, profile.warmupIterations);
  await runWithConcurrency(tasks, profile.concurrency, async (query) => {
    await adapter.search({ query: query.query });
  });
};

export const runMeasured = async (
  adapter: SearchAdapter,
  profile: BenchmarkProfile
): Promise<number[]> => {
  const durationsMs: number[] = [];
  const tasks = buildTaskList(profile, profile.measuredIterations);
  await runWithConcurrency(tasks, profile.concurrency, async (query) => {
    const started = performance.now();
    const result = await adapter.search({ query: query.query });
    durationsMs.push(performance.now() - started);
    if (!result.ok) {
      throw new Error(`Benchmark query failed: ${query.id}`);
    }
  });

  return durationsMs;
};

const main = async (): Promise<void> => {
  const { profilePath } = parseArgs();
  const profile = loadProfile(profilePath);
  const { corpusDigest, documentCount, engine } = await createEngine(profile);
  const adapter = new SearchAdapter({ engine });

  // SearchAdapter.search() checks isCriticalPathEnabled() (true whenever
  // PERF_METRICS_DIR is set) and, if true, creates + flushes a session
  // (plus a second "instrumentation-overhead" session) on EVERY call. Left
  // set during warmup/measured, that both times the instrumentation itself
  // into the p50/p95/p99 and floods PERF_METRICS_DIR with hundreds of
  // incidental per-call records. Unset it for the timed loop; restore only
  // to write the single summary record below. Note isCriticalPathEnabled()
  // also trips on PERF_CRITICAL_PATH=1 alone — exporting that in the
  // environment before running this script re-enables per-call
  // instrumentation regardless of this delete.
  const metricsDir = process.env.PERF_METRICS_DIR;
  delete process.env.PERF_METRICS_DIR;

  await runWarmup(adapter, profile);
  const durationsMs = await runMeasured(adapter, profile);

  const p50 = percentile(durationsMs, 50);
  const p95 = percentile(durationsMs, 95);
  const p99 = percentile(durationsMs, 99);
  const passed = p95 <= profile.slo.maxMs;

  const report = {
    boundary: profile.slo.boundary,
    corpusExpectedDocuments: profile.corpus.expectedDocuments,
    corpusPointer: profile.corpus.pointer,
    engine: process.env.MANTICORE_URL ? "manticore" : "in-memory",
    measuredSamples: durationsMs.length,
    p50Ms: Number(p50.toFixed(2)),
    p95Ms: Number(p95.toFixed(2)),
    p99Ms: Number(p99.toFixed(2)),
    passed,
    profile: profilePath,
    sloMaxMs: profile.slo.maxMs,
  };

  console.log(JSON.stringify(report, null, 2));

  if (metricsDir) {
    process.env.PERF_METRICS_DIR = metricsDir;
    process.env.PERF_CRITICAL_PATH = "1";
    // Cohort-identity dimensions the performance schema already carries
    // (buildWorkloadMetadata / CriticalPathMetadata) — set here so two runs
    // with a different corpus, document count, or concurrency are never
    // folded into the same cohort fingerprint.
    process.env.PERF_ITEM_COUNT = String(documentCount);
    process.env.PERF_DATASET_DIGEST = corpusDigest;
    process.env.PERF_CONCURRENCY = String(profile.concurrency);
    await buildSearchSummaryRecord({
      durationsMs,
      errorCount: 0,
      metadata: {
        ...buildWorkloadMetadata(),
        profile: profilePath,
        "queryset-digest": digestQueryset({
          query: profile.queries.map((entry) => entry.id).join("|"),
        }),
      },
      timeoutCount: 0,
    });
  }

  if (!passed && process.env.BENCH_ALLOW_FAIL !== "1") {
    process.exitCode = 1;
  }
};

// Root-cause fix: without this guard, importing anything from this module
// (e.g. from a spec file) runs the entire benchmark as an import side
// effect — bitten once already when digest.ts had to be split out just to
// avoid it. Matches generate-corpus.ts's own convention.
if (import.meta.main) {
  await main();
}
