import { readFileSync } from "node:fs";
import path from "node:path";

import type { SearchDocument, SearchEngine } from "@ji/search";
import {
  InMemorySearchEngine,
  ManticoreSearchEngine,
  SearchAdapter,
} from "@ji/search";
import { z } from "zod";

interface BenchmarkProfile {
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

const benchmarkProfileSchema = z.object({
  concurrency: z.number(),
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

const upsertAll = async (
  engine: SearchEngine,
  documents: SearchDocument[]
): Promise<void> => {
  await Promise.all(
    documents.map((document) => engine.upsertDocument(document))
  );
};

const createEngine = async (): Promise<SearchEngine> => {
  const manticoreUrl = process.env.MANTICORE_URL;
  const docs = seedDocuments(Number(process.env.BENCH_CORPUS_SIZE ?? 1000));
  if (manticoreUrl) {
    const engine = ManticoreSearchEngine.fromUrl(manticoreUrl);
    await upsertAll(engine, docs);
    await engine.setIndexVersion(1);
    return engine;
  }

  const engine = new InMemorySearchEngine();
  await upsertAll(engine, docs);
  await engine.setIndexVersion(1);
  return engine;
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

const runWarmup = async (
  adapter: SearchAdapter,
  profile: BenchmarkProfile
): Promise<void> => {
  const tasks: Promise<unknown>[] = [];
  for (let index = 0; index < profile.warmupIterations; index += 1) {
    for (const query of profile.queries) {
      tasks.push(adapter.search({ query: query.query }));
    }
  }
  await Promise.all(tasks);
};

const runMeasured = async (
  adapter: SearchAdapter,
  profile: BenchmarkProfile
): Promise<number[]> => {
  const durationsMs: number[] = [];
  for (let index = 0; index < profile.measuredIterations; index += 1) {
    /* oxlint-disable no-await-in-loop -- benchmark records sequential adapter latency samples */
    for (const query of profile.queries) {
      const started = performance.now();
      const result = await adapter.search({ query: query.query });
      durationsMs.push(performance.now() - started);
      if (!result.ok) {
        throw new Error(`Benchmark query failed: ${query.id}`);
      }
    }
    /* oxlint-enable no-await-in-loop */
  }

  return durationsMs;
};

const main = async (): Promise<void> => {
  const { profilePath } = parseArgs();
  const profile = loadProfile(profilePath);
  const engine = await createEngine();
  const adapter = new SearchAdapter({ engine });

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

  if (!passed && process.env.BENCH_ALLOW_FAIL !== "1") {
    process.exitCode = 1;
  }
};

await main();
