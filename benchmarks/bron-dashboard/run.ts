/* oxlint-disable no-await-in-loop -- latency samples must be measured one
   at a time, and the seed inserts are chunked deliberately to bound memory
   against a single pooled connection. */
/**
 * RJC-407 acceptance: every brondashboard query stays under 300 ms on a
 * fixture of 50k `curated.scrape_run` rows.
 *
 * Seeds an isolated database, measures each query cold and then repeatedly,
 * and writes the run to `.artifacts/performance/`. The seeded data is dropped
 * afterwards, so this never touches the dev database.
 *
 * Usage: bun benchmarks/bron-dashboard/run.ts
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { PostgresBronRunStatsReader } from "../../packages/db/src/marts/bron-run-stats";
import * as schema from "../../packages/db/src/schema";
import { bron } from "../../packages/db/src/schema";

const DATABASE_URL =
  process.env.DATABASE_TEST_URL ??
  "postgresql://ji_migrator:ji_migrator_local@127.0.0.1:5432/ji_test";

const RUN_COUNT = Number(process.env.BENCH_RUNS ?? 50_000);
const BRON_COUNT = Number(process.env.BENCH_BRONNEN ?? 12);
const OBSERVATIONS_PER_RUN = Number(process.env.BENCH_OBSERVATIONS ?? 4);
const ITERATIONS = Number(process.env.BENCH_ITERATIONS ?? 10);
const BUDGET_MS = 300;

const NOW = new Date();

const percentile = (sorted: number[], p: number): number => {
  if (sorted.length === 0) {
    return Number.NaN;
  }
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)
  );
  return sorted[index] ?? Number.NaN;
};

interface Measurement {
  cold: number;
  label: string;
  max: number;
  median: number;
  p95: number;
}

const measure = async (
  label: string,
  fn: () => Promise<void>
): Promise<Measurement> => {
  const coldStart = performance.now();
  await fn();
  const cold = performance.now() - coldStart;

  const samples: number[] = [];
  for (let i = 0; i < ITERATIONS; i += 1) {
    const start = performance.now();
    await fn();
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);

  return {
    cold,
    label,
    max: samples.at(-1) ?? Number.NaN,
    median: percentile(samples, 50),
    p95: percentile(samples, 95),
  };
};

const seed = async (sql: postgres.Sql, bronIds: string[]): Promise<void> => {
  const database = drizzle(sql, { schema });

  await database.insert(bron).values(
    bronIds.map((id, index) => ({
      categorie: "overheidsportaal",
      id,
      naam: `Bench Bron ${index}`,
      status: "ready" as const,
      voorwaardenStatus: "toegestaan" as const,
    }))
  );

  // Runs spread over 30 days so every window has to filter rather than scan all.
  const statuses = [
    "succeeded",
    "succeeded",
    "succeeded",
    "failed",
    "cancelled",
  ];
  const CHUNK = 2000;
  for (let offset = 0; offset < RUN_COUNT; offset += CHUNK) {
    const size = Math.min(CHUNK, RUN_COUNT - offset);
    const values = Array.from({ length: size }, (_, i) => {
      const n = offset + i;
      const status = statuses[n % statuses.length] ?? "succeeded";
      const gestart = new Date(NOW.getTime() - (n % (30 * 24)) * 3_600_000);
      const geindigd = new Date(gestart.getTime() + 500 + (n % 5000));
      const failed = status === "failed";
      return {
        aantal_gevonden: 40,
        bron_id: bronIds[n % bronIds.length],
        failure_class: failed ? "connector" : null,
        failure_code: failed ? "FETCH_FAILED" : null,
        failure_message: failed ? "Connector fetch failed" : null,
        failure_phase: failed ? "fetch" : null,
        fouten: failed ? 1 : 0,
        geindigd: geindigd.toISOString(),
        gestart: gestart.toISOString(),
        gewijzigd: 3,
        nieuw: 5,
        rejected: 1,
        run_kind: n % 20 === 0 ? "backfill" : "poll",
        status,
      };
    });

    await sql`
      INSERT INTO curated.scrape_run ${sql(
        values,
        "bron_id",
        "status",
        "run_kind",
        "gestart",
        "geindigd",
        "aantal_gevonden",
        "nieuw",
        "gewijzigd",
        "rejected",
        "fouten",
        "failure_phase",
        "failure_class",
        "failure_code",
        "failure_message"
      )}
    `;
  }

  // Observations for a slice of runs, so the `unchanged` join has real work.
  const runIds = await sql<{ id: string }[]>`
    SELECT id FROM curated.scrape_run
    WHERE bron_id = ANY(${bronIds})
    ORDER BY gestart DESC
    LIMIT ${Math.floor(RUN_COUNT / 4)}
  `;

  for (let offset = 0; offset < runIds.length; offset += 500) {
    const slice = runIds.slice(offset, offset + 500);
    const records = slice.map((row, i) => ({
      bron_id: bronIds[i % bronIds.length],
      bron_referentie: `bench-${row.id}`,
      content_hash: `sha256:bench-${row.id}`,
      raw_payload_ref: `bench/${row.id}.json`,
      scrape_run_id: row.id,
    }));
    const inserted = await sql<{ id: string; scrape_run_id: string }[]>`
      INSERT INTO staging.source_record ${sql(
        records,
        "bron_id",
        "bron_referentie",
        "content_hash",
        "raw_payload_ref",
        "scrape_run_id"
      )}
      RETURNING id, scrape_run_id
    `;

    const observations = inserted.flatMap((record) =>
      Array.from({ length: OBSERVATIONS_PER_RUN }, (_, k) => ({
        bron_id: bronIds[0],
        content_hash: `sha256:obs-${record.id}-${k}`,
        outcome: k === 0 ? "new" : "unchanged",
        payload: JSON.stringify({ bench: true }),
        scrape_run_id: record.scrape_run_id,
        source_record_id: record.id,
      }))
    );

    await sql`
      INSERT INTO staging.aanvraag_observation ${sql(
        observations,
        "bron_id",
        "content_hash",
        "outcome",
        "payload",
        "scrape_run_id",
        "source_record_id"
      )}
    `;
  }
};

const main = async (): Promise<void> => {
  const sql = postgres(DATABASE_URL, { max: 2 });
  const database = drizzle(sql, { schema });
  const reader = new PostgresBronRunStatsReader(database);
  const bronIds = Array.from({ length: BRON_COUNT }, () => crypto.randomUUID());

  try {
    const seedStart = performance.now();
    await seed(sql, bronIds);
    const seedMs = performance.now() - seedStart;

    const runRowRows = await sql<{ count: number }[]>`
      SELECT CAST(count(*) AS integer) AS count
      FROM curated.scrape_run WHERE bron_id = ANY(${bronIds})
    `;
    const runRowsValue = runRowRows[0]?.count ?? 0;
    const observationRowRows = await sql<{ count: number }[]>`
      SELECT CAST(count(*) AS integer) AS count
      FROM staging.aanvraag_observation WHERE scrape_run_id IN (
        SELECT id FROM curated.scrape_run WHERE bron_id = ANY(${bronIds})
      )
    `;
    const observationRowsValue = observationRowRows[0]?.count ?? 0;

    const results = [];
    for (const window of ["24u", "7d", "30d"] as const) {
      results.push(
        await measure(`bronRunStats(${window})`, async () => {
          await reader.bronRunStats({ bronIds, now: NOW, window });
        }),
        await measure(`bronRunTimeseries(${window}, day)`, async () => {
          await reader.bronRunTimeseries({ bronIds, now: NOW, window });
        })
      );
    }
    results.push(
      await measure("bronRunStats(30d, runKind=all)", async () => {
        await reader.bronRunStats({
          bronIds,
          now: NOW,
          runKind: "all",
          window: "30d",
        });
      })
    );

    const report = {
      budgetMs: BUDGET_MS,
      fixture: {
        bronnen: BRON_COUNT,
        observationRows: observationRowsValue,
        runRows: runRowsValue,
        seedMs: Math.round(seedMs),
      },
      generatedAt: new Date().toISOString(),
      iterations: ITERATIONS,
      measurements: results.map((r) => ({
        ...r,
        cold: Number(r.cold.toFixed(1)),
        max: Number(r.max.toFixed(1)),
        median: Number(r.median.toFixed(1)),
        p95: Number(r.p95.toFixed(1)),
        withinBudget: r.p95 < BUDGET_MS,
      })),
      unit: "RJC-407",
    };

    const outPath = path.join(
      process.cwd(),
      ".artifacts/performance/rjc-407-bron-run-stats.json"
    );
    await mkdir(path.dirname(outPath), { recursive: true });
    await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`);

    // biome-ignore lint: benchmark output is the point of this script
    console.log(
      `fixture: ${runRowsValue} runs, ${observationRowsValue} observations, seeded in ${Math.round(seedMs)}ms\n`
    );
    for (const r of report.measurements) {
      // biome-ignore lint: benchmark output is the point of this script
      console.log(
        `${r.withinBudget ? "PASS" : "FAIL"}  ${r.label.padEnd(34)} cold ${String(r.cold).padStart(7)}ms  median ${String(r.median).padStart(7)}ms  p95 ${String(r.p95).padStart(7)}ms`
      );
    }
    // biome-ignore lint: benchmark output is the point of this script
    console.log(`\nwrote ${outPath}`);

    if (report.measurements.some((r) => !r.withinBudget)) {
      process.exitCode = 1;
    }
  } finally {
    await sql`DELETE FROM curated.bron WHERE id = ANY(${bronIds})`;
    await sql.end({ timeout: 5 });
  }
};

await main();
