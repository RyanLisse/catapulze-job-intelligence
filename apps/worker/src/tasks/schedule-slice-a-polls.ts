import { isPollableBron } from "@ji/application/bronnen";
import { schedules } from "@trigger.dev/sdk";

import { createPollBronRuntime, requireDatabaseUrl } from "../poll-bron-run";
import { resolveSliceABronSlug } from "../slice-a-bronnen";
import type { SliceABronDefinition } from "../slice-a-bronnen";
import { pollBronTask } from "./poll-bron";

const pollableSliceABronnen = async (): Promise<SliceABronDefinition[]> => {
  const runtime = createPollBronRuntime(requireDatabaseUrl());
  try {
    const records = await runtime.bronPersistence.list();
    return records.flatMap((record) => {
      if (!isPollableBron(record)) {
        return [];
      }
      const bronSlug = resolveSliceABronSlug(record.naam);
      if (!bronSlug) {
        return [];
      }
      return [{ bronId: record.bronId, bronSlug, naam: record.naam }];
    });
  } finally {
    await runtime.close();
  }
};

/** Fan-out Slice A polls every 15 minutes; each bron runs in its own poll-bron task (KTD6). */
export const scheduleSliceAPollsTask = schedules.task({
  cron: {
    pattern: "*/15 * * * *",
    timezone: "Europe/Amsterdam",
  },
  id: "schedule-slice-a-polls",
  run: async () => {
    const bronnen = await pollableSliceABronnen();
    if (bronnen.length === 0) {
      return { queued: 0 };
    }

    await pollBronTask.batchTrigger(
      bronnen.map((bron) => ({
        options: {
          concurrencyKey: bron.bronId,
          queue: "poll-bron",
        },
        payload: {
          bronId: bron.bronId,
          bronSlug: bron.bronSlug,
          scrapeRunId: crypto.randomUUID(),
        },
      }))
    );

    return {
      bronnen: bronnen.map((bron) => ({
        bronId: bron.bronId,
        bronSlug: bron.bronSlug,
      })),
      queued: bronnen.length,
    };
  },
});
