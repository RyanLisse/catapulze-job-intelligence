import { processObservation } from "@ji/application/identity";
import type { CurateStore, SupportedBronSlug } from "@ji/application/identity";
import type { ConnectorObservation, ObjectStore } from "@ji/connectors";
import type { BronId, ScrapeRunId } from "@ji/domain";
import { eq } from "drizzle-orm";

import type { BronRuntimeDatabase } from "./bron-runtime";
import { aanvraagObservation } from "./schema/staging";

export interface CurateScrapeRunInput {
  bronId: BronId;
  bronSlug: SupportedBronSlug;
  curateStore: CurateStore;
  database: BronRuntimeDatabase;
  objectStore: ObjectStore;
  scrapeRunId: ScrapeRunId;
}

export interface CurateScrapeRunResult {
  curated: number;
  quarantined: number;
  unchanged: number;
}

export const curateScrapeRun = async (
  input: CurateScrapeRunInput
): Promise<CurateScrapeRunResult> => {
  const observations = await input.database
    .select({ payload: aanvraagObservation.payload })
    .from(aanvraagObservation)
    .where(eq(aanvraagObservation.scrapeRunId, input.scrapeRunId));

  const result: CurateScrapeRunResult = {
    curated: 0,
    quarantined: 0,
    unchanged: 0,
  };

  for (const observation of observations) {
    // SAFETY: observation.payload is written by PostgresObservationRecorder as ConnectorObservation.
    const payload = observation.payload as ConnectorObservation;
    // oxlint-disable-next-line no-await-in-loop -- curate pipeline is order-dependent per observation
    const stored = await input.objectStore.get(payload.rawPayloadRef);
    if (!stored) {
      result.quarantined += 1;
      continue;
    }
    // oxlint-disable-next-line no-await-in-loop -- curate pipeline is order-dependent per observation
    const processed = await processObservation(input.curateStore, {
      body: stored.body,
      bronId: input.bronId,
      bronSlug: input.bronSlug,
      contentHash: payload.contentHash,
      observedAt: new Date(payload.observedAt),
      rawPayloadRef: payload.rawPayloadRef,
      scrapeRunId: input.scrapeRunId,
    });
    if (processed.status === "curated") {
      result.curated += 1;
    } else if (processed.status === "unchanged") {
      result.unchanged += 1;
    } else {
      result.quarantined += 1;
    }
  }

  return result;
};
