import path from "node:path";

import { config as loadEnv } from "dotenv";

import {
  buildPollPayload,
  formatOneshotList,
  oneshotUsage,
  parseOneshotArgs,
  selectOneshotTargets,
} from "../src/oneshot-slice-a-polls";
import type { OneshotResult } from "../src/oneshot-slice-a-polls";
import {
  createPollBronRuntime,
  requireDatabaseUrl,
  runBronIngestPipeline,
} from "../src/poll-bron-run";
import type { BronIngestPipelineResult } from "../src/poll-bron-run";
import { listPollableSliceABronnen } from "../src/slice-a-pollable";
import type { PollBronPayload } from "../src/tasks/poll-bron-schema";

/**
 * Offline-capable wrapper matching Trigger `poll-bron` → `runPollBron`
 * without importing `@trigger.dev/sdk`.
 */
const runPollBronOnce = async (
  payload: PollBronPayload
): Promise<BronIngestPipelineResult> => {
  const runtime = createPollBronRuntime(requireDatabaseUrl());
  try {
    return await runBronIngestPipeline(payload, runtime, "poll");
  } finally {
    await runtime.close();
  }
};

// scriptDir is apps/worker/scripts; the repo root is three levels up.
const scriptDir = import.meta.dirname;
const repoRoot = path.resolve(scriptDir, "../../..");

loadEnv({ path: path.join(repoRoot, "apps/server/.env") });
loadEnv({ override: true, path: path.join(repoRoot, "apps/worker/.env") });

const main = async (): Promise<OneshotResult> => {
  let args;
  try {
    args = parseOneshotArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : oneshotUsage);
    process.exit(1);
  }

  const listRuntime = createPollBronRuntime(requireDatabaseUrl());
  let pollable;
  try {
    pollable = await listPollableSliceABronnen(listRuntime);
  } finally {
    await listRuntime.close();
  }

  const targets = selectOneshotTargets(pollable, args);

  if (args.mode === "list") {
    const listed = formatOneshotList(pollable, targets);
    console.log(JSON.stringify(listed, null, 2));
    return listed;
  }

  const results: Extract<OneshotResult, { mode: "run" }> = {
    failed: 0,
    mode: "run",
    results: [],
    succeeded: 0,
  };

  /* oxlint-disable no-await-in-loop -- sequential fan-out keeps Coolify load bounded */
  for (const bron of targets) {
    const payload = buildPollPayload(bron);
    try {
      // Same body as Trigger task `poll-bron` → runPollBron (no Trigger SDK import).
      const result = await runPollBronOnce(payload);
      results.succeeded += 1;
      results.results.push({
        bronSlug: result.bronSlug,
        metrics: result.metrics,
        nieuw: result.metrics.new,
        scrapeRunId: result.scrapeRunId,
        status: "succeeded",
        writtenRecords: result.writtenRecords,
      });
      console.log(
        JSON.stringify(
          {
            bronSlug: result.bronSlug,
            metrics: result.metrics,
            scrapeRunId: result.scrapeRunId,
            status: "succeeded",
            writtenRecords: result.writtenRecords,
          },
          null,
          2
        )
      );
    } catch (error) {
      results.failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      results.results.push({
        bronSlug: bron.bronSlug,
        error: message,
        scrapeRunId: payload.scrapeRunId,
        status: "failed",
      });
      console.error(
        JSON.stringify(
          {
            bronSlug: bron.bronSlug,
            error: message,
            scrapeRunId: payload.scrapeRunId,
            status: "failed",
          },
          null,
          2
        )
      );
      // Stop on non-hash hard fail so ops can investigate before fan-out continues.
      if (!/hash/iu.test(message)) {
        break;
      }
    }
  }
  /* oxlint-enable no-await-in-loop */

  console.log(
    JSON.stringify(
      {
        failed: results.failed,
        mode: "run",
        succeeded: results.succeeded,
        targets: targets.length,
      },
      null,
      2
    )
  );

  if (results.failed > 0) {
    process.exitCode = 1;
  }
  return results;
};

await main();
