import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  InMemorySearchEngine,
  ManticoreSearchEngine,
  SearchAdapter,
  type SearchDocument,
  type SearchEngine,
} from "@ji/search";

interface BenchmarkProfile {
  concurrency: number;
  corpus: {
    expectedDocuments: number;
    pointer: string;
  };
  measuredIterations: number;
  queries: Array<{ id: string; query: string; weight: number }>;
  slo: {
    boundary: string;
    maxMs: number;
    metric: string;
  };
  warmupIterations: number;
}

const percentile = (values: number[], pct: number): number => {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((pct / 100) * sorted.length) - 1)
  );
  return sorted[index] ?? 0;
};

const loadProfile = (profilePath: string): BenchmarkProfile => {
  const raw = readFileSync(profilePath, "utf8");
  return JSON.parse(raw) as BenchmarkProfile;
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

const createEngine = async (): Promise<SearchEngine> => {
  const manticoreUrl = process.env.MANTICORE_URL;
  if (manticoreUrl) {
    const engine = ManticoreSearchEngine.fromUrl(manticoreUrl);
    const docs = seedDocuments(Number(process.env.BENCH_CORPUS_SIZE ?? 1000));
    for (const document of docs) {
      await engine.upsertDocument(document);
    }
    await engine.setIndexVersion(1);
    return engine;
  }

  const engine = new InMemorySearchEngine();
  const docs = seedDocuments(Number(process.env.BENCH_CORPUS_SIZE ?? 1000));
  for (const document of docs) {
    await engine.upsertDocument(document);
  }
  await engine.setIndexVersion(1);
  return engine;
};

const parseArgs = (): { profilePath: string } => {
  const profileFlagIndex = process.argv.indexOf("--profile");
  const profilePath =
    profileFlagIndex === -1
      ? "benchmarks/search/profile.json"
      : process.argv[profileFlagIndex + 1];
  if (!profilePath) {
    throw new Error("Missing value for --profile");
  }

  return { profilePath: resolve(process.cwd(), profilePath) };
};

const main = async (): Promise<void> => {
  const { profilePath } = parseArgs();
  const profile = loadProfile(profilePath);
  const engine = await createEngine();
  const adapter = new SearchAdapter({ engine });

  for (let index = 0; index < profile.warmupIterations; index += 1) {
    for (const query of profile.queries) {
      await adapter.search({ query: query.query });
    }
  }

  const durationsMs: number[] = [];
  for (let index = 0; index < profile.measuredIterations; index += 1) {
    for (const query of profile.queries) {
      const started = performance.now();
      const result = await adapter.search({ query: query.query });
      durationsMs.push(performance.now() - started);
      if (!result.ok) {
        throw new Error(`Benchmark query failed: ${query.id}`);
      }
    }
  }

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
