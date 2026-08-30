import path from "node:path";

import { activateBron } from "@ji/application/bronnen";
import { config as loadEnv } from "dotenv";

import {
  createPollBronRuntime,
  requireDatabaseUrl,
  requireManticoreUrl,
  runBronIngestPipeline,
} from "../src/poll-bron-run";
import { SLICE_A_BRONNEN } from "../src/slice-a-bronnen";
import type { SliceABronSlug } from "../src/slice-a-bronnen";

const workerRoot = import.meta.dirname;
const repoRoot = path.resolve(workerRoot, "../..");

loadEnv({ path: path.join(repoRoot, "apps/server/.env") });
loadEnv({ override: true, path: path.join(repoRoot, "apps/worker/.env") });

const usage = (): never => {
  console.error(
    "Usage: bun apps/worker/scripts/poll-bron-smoke.ts [--bron tenderned|inhuurdesk|all] [--test-import] [--activate]"
  );
  process.exit(1);
};

interface SmokeArgs {
  activate: boolean;
  targets: SliceABronSlug[];
  testImport: boolean;
}

const parseArgs = (): SmokeArgs => {
  const args = process.argv.slice(2);
  let targets: SliceABronSlug[] = SLICE_A_BRONNEN.map((bron) => bron.bronSlug);
  let testImport = false;
  let activate = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--bron") {
      const value = args[index + 1];
      if (!value) {
        return usage();
      }
      if (value === "all") {
        targets = SLICE_A_BRONNEN.map((bron) => bron.bronSlug);
      } else if (value === "tenderned" || value === "inhuurdesk") {
        targets = [value];
      } else {
        return usage();
      }
      index += 1;
      continue;
    }
    if (arg === "--test-import") {
      testImport = true;
      continue;
    }
    if (arg === "--activate") {
      activate = true;
      continue;
    }
    return usage();
  }

  if (activate && !testImport) {
    testImport = true;
  }

  return { activate, targets, testImport } satisfies SmokeArgs;
};

const ensureSliceABronnen = async (
  runtime: ReturnType<typeof createPollBronRuntime>
): Promise<void> => {
  const { bron } = await import("@ji/db/schema/index");
  /* oxlint-disable no-await-in-loop -- bron seed rows are upserted one at a time */
  for (const definition of SLICE_A_BRONNEN) {
    await runtime.database
      .insert(bron)
      .values({
        actief: false,
        categorie: "overheidsportaal",
        crawlDelayMs: 500,
        id: definition.bronId,
        ingestieType: "json-api",
        interval: "*/15 * * * *",
        loginVereist: false,
        mappingRef: `fixtures/connectors/${definition.bronSlug}/mapping.json`,
        naam: definition.naam,
        rateLimitPerMinute: 30,
        retentionDays: 90,
        secretRef: null,
        status: "ready",
        voorwaardenStatus: "toegestaan",
      })
      .onConflictDoUpdate({
        set: {
          crawlDelayMs: 500,
          interval: "*/15 * * * *",
          rateLimitPerMinute: 30,
          status: "ready",
          updatedAt: new Date(),
          voorwaardenStatus: "toegestaan",
        },
        target: bron.id,
      });
  }
  /* oxlint-enable no-await-in-loop */
};

const main = async (): Promise<void> => {
  const { activate, targets, testImport } = parseArgs();
  requireManticoreUrl();
  const runtime = createPollBronRuntime(requireDatabaseUrl());
  try {
    await ensureSliceABronnen(runtime);
    const results = [];
    /* oxlint-disable no-await-in-loop -- smoke runs bronnen sequentially for readable logs */
    for (const bronSlug of targets) {
      const definition = SLICE_A_BRONNEN.find(
        (bron) => bron.bronSlug === bronSlug
      );
      if (!definition) {
        throw new Error(`Unknown bron slug ${bronSlug}`);
      }
      const scrapeRunId = crypto.randomUUID();
      const runKind = testImport ? "test" : "poll";
      const result = await runBronIngestPipeline(
        {
          bronId: definition.bronId,
          bronSlug: definition.bronSlug,
          scrapeRunId,
        },
        runtime,
        runKind
      );
      results.push(result);
      console.log(JSON.stringify(result, null, 2));

      if (activate) {
        const activation = await activateBron(runtime.bronPersistence, {
          bronId: definition.bronId,
          testImportRunId: scrapeRunId,
        });
        console.log(
          JSON.stringify(
            {
              actief: activation.record.actief,
              activated: true,
              bronId: activation.record.bronId,
            },
            null,
            2
          )
        );
      }
    }
    /* oxlint-enable no-await-in-loop */
    const failed = results.filter((result) => result.status !== "succeeded");
    if (failed.length > 0) {
      process.exitCode = 1;
    }
  } finally {
    await runtime.close();
  }
};

await main();
