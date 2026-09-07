import { schemaTask } from "@trigger.dev/sdk";

import { isEffectWorkerEnabled } from "../effect/flag";
import type { BronIngestPipelineResult } from "../poll-bron-run";
import {
  createPollBronRuntime,
  requireDatabaseUrl,
  runBronIngestPipeline,
} from "../poll-bron-run";
import { pollBronPayload } from "./poll-bron-schema";
import type { PollBronPayload } from "./poll-bron-schema";

/**
 * Native poll-bron task body (Promise). Shared by the Trigger schemaTask entry
 * and the opt-in Effect wrapper (CTP-476). Trigger keeps durability/maxAttempts.
 */
export const runPollBron = async (
  payload: PollBronPayload
): Promise<BronIngestPipelineResult> => {
  const runtime = createPollBronRuntime(requireDatabaseUrl());
  try {
    return await runBronIngestPipeline(payload, runtime, "poll");
  } finally {
    await runtime.close();
  }
};

/** Scheduled poller entry point for Slice A bron runs (KTD6). */
export const pollBronTask = schemaTask({
  id: "poll-bron",
  queue: {
    concurrencyLimit: 1,
  },
  retry: {
    maxAttempts: 2,
  },
  // CTP-479 canary: JI_EFFECT_WORKER=1 → Effect task-body boundary; default native.
  // Dynamic import avoids a static cycle with effect/task-bodies → this module.
  run: async (payload) => {
    if (!isEffectWorkerEnabled()) {
      return runPollBron(payload);
    }
    const { runPollBronEffect } = await import("../effect/task-bodies");
    return runPollBronEffect(payload);
  },
  schema: pollBronPayload,
});

export type { PollBronPayload } from "./poll-bron-schema";
