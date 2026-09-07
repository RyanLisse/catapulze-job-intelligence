export interface EnrichmentOutboxStubInput {
  readonly aanvraagId: string;
  readonly dryRun: boolean;
  readonly fieldCount: number;
}

export interface EnrichmentOutboxStubResult {
  readonly enqueued: boolean;
  readonly eventType: "aanvraag.enriched";
}

/** Slice 1 stub: records intent to emit aanvraag.enriched without wiring the drain yet. */
export const enqueueEnrichmentOutboxStub = (
  input: EnrichmentOutboxStubInput
): EnrichmentOutboxStubResult => ({
  enqueued: !input.dryRun && input.fieldCount > 0,
  eventType: "aanvraag.enriched",
});
