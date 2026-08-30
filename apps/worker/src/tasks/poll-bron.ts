import { schemaTask } from "@trigger.dev/sdk";

import {
  createPollBronRuntime,
  requireDatabaseUrl,
  runBronIngestPipeline,
} from "../poll-bron-run";
import { pollBronPayload } from "./poll-bron-schema";

/** Scheduled poller entry point for Slice A bron runs (KTD6). */
export const pollBronTask = schemaTask({
  id: "poll-bron",
  queue: {
    concurrencyLimit: 1,
  },
  retry: {
    maxAttempts: 2,
  },
  run: async (payload) => {
    const runtime = createPollBronRuntime(requireDatabaseUrl());
    try {
      return await runBronIngestPipeline(payload, runtime, "poll");
    } finally {
      await runtime.close();
    }
  },
  schema: pollBronPayload,
});

export type { PollBronPayload } from "./poll-bron-schema";
