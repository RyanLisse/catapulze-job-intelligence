import path from "node:path";

import { activateBron } from "@ji/application/bronnen";
import {
  isSupportedBronSlug,
  SOURCES,
  SUPPORTED_BRON_SLUGS,
} from "@ji/application/sources";
import type { SupportedBronSlug } from "@ji/application/sources";
import { config as loadEnv } from "dotenv";

import {
  createPollBronRuntime,
  requireDatabaseUrl,
  requireManticoreUrl,
  runBronIngestPipeline,
} from "../src/poll-bron-run";

// scriptDir is apps/worker/scripts; the repo root is three levels up.
const scriptDir = import.meta.dirname;
const repoRoot = path.resolve(scriptDir, "../../..");

loadEnv({ path: path.join(repoRoot, "apps/server/.env") });
loadEnv({ override: true, path: path.join(repoRoot, "apps/worker/.env") });

const usage = (): never => {
  console.error(
    `Usage: bun apps/worker/scripts/poll-bron-smoke.ts [--bron ${SUPPORTED_BRON_SLUGS.join("|")}|all] [--test-import] [--activate]`
  );
  process.exit(1);
};

interface SmokeArgs {
  activate: boolean;
  targets: SupportedBronSlug[];
  testImport: boolean;
}

const parseArgs = (): SmokeArgs => {
  const args = process.argv.slice(2);
  let targets: SupportedBronSlug[] = [...SUPPORTED_BRON_SLUGS];
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
        targets = [...SUPPORTED_BRON_SLUGS];
      } else if (isSupportedBronSlug(value)) {
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
  for (const slug of SUPPORTED_BRON_SLUGS) {
    const definition = SOURCES[slug];
    await runtime.database
      .insert(bron)
      .values({
        actief: false,
        categorie: "overheidsportaal",
        crawlDelayMs: definition.seed.crawlDelayMs,
        id: definition.bronId,
        ingestieType: definition.seed.methode,
        interval: "*/15 * * * *",
        loginVereist: false,
        mappingRef: `fixtures/connectors/${definition.slug}/mapping.json`,
        naam: definition.naam,
        rateLimitPerMinute: 30,
        retentionDays: 90,
        secretRef: null,
        status: "ready",
        voorwaardenStatus: definition.seed.voorwaardenStatus,
      })
      .onConflictDoUpdate({
        set: {
          crawlDelayMs: definition.seed.crawlDelayMs,
          interval: "*/15 * * * *",
          rateLimitPerMinute: 30,
          status: "ready",
          updatedAt: new Date(),
          voorwaardenStatus: definition.seed.voorwaardenStatus,
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
      const definition = SOURCES[bronSlug];
      const scrapeRunId = crypto.randomUUID();
      const runKind = testImport ? "test" : "poll";
      const result = await runBronIngestPipeline(
        {
          bronId: definition.bronId,
          bronSlug,
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
