import { hashContent } from "../object-store";
import type { StriiveJob } from "./types";

/** Canonical JSON of the already-whitelisted job fields (see the DEC-008
 * projection in connector.ts) -- every field kept past the connector
 * boundary is change-relevant, so the whole projected job is hashed. */
export const hashStriiveListingItem = (job: StriiveJob): Promise<string> => {
  const canonical = JSON.stringify({
    broker: job.broker ?? null,
    brokerUrl: job.brokerUrl ?? null,
    clientName: job.clientName ?? null,
    closingDateClient: job.closingDateClient ?? null,
    closingDateInvoice: job.closingDateInvoice ?? null,
    content: job.content ?? null,
    endDate: job.endDate ?? null,
    hoursPerWeekMax: job.hoursPerWeekMax ?? null,
    hoursPerWeekMin: job.hoursPerWeekMin ?? null,
    id: job.id,
    location: job.location ?? null,
    referenceCode: job.referenceCode ?? null,
    referenceCodeClient: job.referenceCodeClient ?? null,
    regionLocation: job.regionLocation ?? null,
    source: job.source ?? null,
    startDate: job.startDate ?? null,
    title: job.title,
  });
  return hashContent(new TextEncoder().encode(canonical));
};

export const hashStriivePayload = (body: Uint8Array): Promise<string> =>
  hashContent(body);
