import { describe, expect, it } from "bun:test";

import type { BronId, ScrapeRunId } from "@ji/domain";
import { UNKNOWN } from "@ji/domain";

import type { NormalisedAanvraagDraft } from "../normalise";
import type { CurateStore } from "./curate";
import { curateObservation } from "./curate";
import { InMemoryCurateStore } from "./store";

const BRON: BronId = "bron-hero";
const RUN: ScrapeRunId = "run-1";
const OBSERVED_AT = new Date("2026-09-01T06:00:00.000Z");
const provenance = { parserVersion: "spec", sourcePath: "n/a" };

const draft = (
  bronReferentie: string,
  contentHash: string
): NormalisedAanvraagDraft => ({
  beschrijving: { provenance, value: `beschrijving ${bronReferentie}` },
  bronReferentie: { provenance, value: bronReferentie },
  bronSpecifiek: { provenance, value: {} },
  bronUrl: { provenance, value: UNKNOWN },
  contentHash,
  extractieMethode: "html_parser",
  lifecycle: "active",
  locatieLand: { provenance, value: "NL" },
  locatieTekst: { provenance, value: UNKNOWN },
  opdrachtgeverNaam: { provenance, value: UNKNOWN },
  parserVersion: "spec",
  startDatum: { provenance, value: UNKNOWN },
  status: "active",
  tarief: { eenheid: UNKNOWN, max: UNKNOWN, min: UNKNOWN, valuta: "EUR" },
  titel: { provenance, value: `titel ${bronReferentie}` },
});

const observation = (bronReferentie: string, contentHash: string) => ({
  bronId: BRON,
  draft: draft(bronReferentie, contentHash),
  observedAt: OBSERVED_AT,
  rawPayloadRef: `raw/hero/${bronReferentie}.html`,
  scrapeRunId: RUN,
});

/**
 * Injects the failure through the port: every method delegates to the real
 * store except insertOutboxEvent, and the transactional store handed to the
 * callback is wrapped the same way — the shape a flaky outbox insert has in
 * production.
 */
const withFailingOutbox = (base: CurateStore): CurateStore => ({
  closeOpenVersie: (aanvraagId, closedAt) =>
    base.closeOpenVersie(aanvraagId, closedAt),
  ensureDedupGroep: (input) => base.ensureDedupGroep(input),
  findAanvraagByIdentity: (bronId, bronReferentie) =>
    base.findAanvraagByIdentity(bronId, bronReferentie),
  findDedupGroepByKey: (dedupKey) => base.findDedupGroepByKey(dedupKey),
  insertAanvraag: (input) => base.insertAanvraag(input),
  insertOutboxEvent: () =>
    Promise.reject(new Error("forced outbox insert failure")),
  insertVersie: (input) => base.insertVersie(input),
  linkAanvraagToDedupGroep: (aanvraagId, dedupGroepId) =>
    base.linkAanvraagToDedupGroep(aanvraagId, dedupGroepId),
  splitDedupGroep: (dedupGroepId) => base.splitDedupGroep(dedupGroepId),
  updateAanvraag: (aanvraagId, patch) => base.updateAanvraag(aanvraagId, patch),
  withTransaction: (fn) =>
    base.withTransaction((tx) => fn(withFailingOutbox(tx))),
});

describe("curateObservation transaction semantics (RJC-399)", () => {
  it("writes aanvraag, versie and outbox event together on success", async () => {
    const store = new InMemoryCurateStore();
    const result = await curateObservation(store, observation("A", "hash-1"));
    expect(result.status).toBe("curated");
    expect(store.aanvragen).toHaveLength(1);
    expect(store.versies).toHaveLength(1);
    expect(store.outboxEvents).toHaveLength(1);
  });

  it("rolls back the create path entirely when the outbox insert fails", async () => {
    const store = new InMemoryCurateStore();
    await expect(
      curateObservation(withFailingOutbox(store), observation("A", "hash-1"))
    ).rejects.toThrow("forced outbox insert failure");
    expect(store.aanvragen).toHaveLength(0);
    expect(store.dedupGroepen).toHaveLength(0);
    expect(store.versies).toHaveLength(0);
    expect(store.outboxEvents).toHaveLength(0);
  });

  it("rolls back the update path entirely when the outbox insert fails", async () => {
    const store = new InMemoryCurateStore();
    await curateObservation(store, observation("A", "hash-1"));

    await expect(
      curateObservation(withFailingOutbox(store), observation("A", "hash-2"))
    ).rejects.toThrow("forced outbox insert failure");

    const [aanvraag] = store.aanvragen;
    expect(aanvraag).toMatchObject({ contentHash: "hash-1", versie: 1 });
    // The versie write before the failure is gone with the rest.
    expect(store.versies).toHaveLength(1);
    expect(store.versies[0]).toMatchObject({ geldigTot: null, versie: 1 });
    expect(store.outboxEvents).toHaveLength(1);
  });
});

describe("curateObservation dedup grouping", () => {
  const sharedTitle = (bronReferentie: string, contentHash: string) => {
    const base = observation(bronReferentie, contentHash);
    return {
      ...base,
      draft: {
        ...base.draft,
        opdrachtgeverNaam: { provenance, value: "Gemeente Amsterdam" },
        startDatum: { provenance, value: "2026-10-01" },
        titel: { provenance, value: "Senior Java Developer" },
      },
    };
  };

  it("links two listings with the same dedup key to one group", async () => {
    const store = new InMemoryCurateStore();
    const first = await curateObservation(store, sharedTitle("A", "hash-a"));
    const second = await curateObservation(store, sharedTitle("B", "hash-b"));

    const groepId = first.dedupGroepId ?? null;
    expect(groepId).not.toBeNull();
    expect(second.dedupGroepId).toBe(groepId ?? undefined);
    expect(store.dedupGroepen).toHaveLength(1);
    expect(store.aanvragen.map((row) => row.dedupGroepId)).toEqual([
      groepId,
      groepId,
    ]);
  });

  it("gives listings with different keys their own groups", async () => {
    const store = new InMemoryCurateStore();
    const first = await curateObservation(store, observation("A", "hash-a"));
    const second = await curateObservation(store, observation("B", "hash-b"));

    expect(second.dedupGroepId).not.toBe(first.dedupGroepId);
    expect(store.dedupGroepen).toHaveLength(2);
  });
});
