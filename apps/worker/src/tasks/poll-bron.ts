import { executeBronRun } from "@ji/application/bronnen";
import {
  createInhuurdeskConnector,
  createTenderNedConnector,
} from "@ji/connectors";
import type { BronId, ScrapeRunId } from "@ji/domain";
import { schemaTask } from "@trigger.dev/sdk";
import { z } from "zod";

const pollBronPayload = z.object({
  bronId: z.string().uuid(),
  bronSlug: z.enum(["inhuurdesk", "tenderned"]),
  scrapeRunId: z.string().uuid(),
});

export type PollBronPayload = z.infer<typeof pollBronPayload>;

/** Minimal scheduled poller entry point for Slice A bron runs (KTD6). */
export const pollBronTask = schemaTask({
  id: "poll-bron",
  queue: {
    concurrencyLimit: 1,
  },
  retry: {
    maxAttempts: 2,
  },
  run: (payload) => {
    // SAFETY: schemaTask validates UUID strings before this handler runs.
    const bronId = payload.bronId as BronId;
    // SAFETY: schemaTask validates UUID strings before this handler runs.
    const scrapeRunId = payload.scrapeRunId as ScrapeRunId;
    const connector =
      payload.bronSlug === "tenderned"
        ? createTenderNedConnector({ bronId })
        : createInhuurdeskConnector({ bronId });

    // Runtime wiring (Postgres stores, object storage, env secrets) lands with U8 ops.
    void connector;
    void executeBronRun;

    return Promise.resolve({
      bronId: payload.bronId,
      queued: true,
      scrapeRunId,
      status: "stub",
    });
  },
  schema: pollBronPayload,
});
