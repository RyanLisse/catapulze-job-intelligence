import { describe, expect, it } from "bun:test";

import type { BronId, ScrapeRunId } from "@ji/domain";
import { CLEARED, CLEARED_BRON_MARKER_KEY, UNKNOWN } from "@ji/domain";

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

describe("curateObservation commercial columns and coalesce tombstones", () => {
  it("writes first-class commercial columns on create", async () => {
    const store = new InMemoryCurateStore();
    const base = observation("COL-1", "hash-col-1");
    await curateObservation(store, {
      ...base,
      draft: {
        ...base.draft,
        opdrachtgeverNaam: { provenance, value: "Gemeente Utrecht" },
        startDatum: { provenance, value: "2026-11-01" },
        titel: { provenance, value: "Detachering Java developer op locatie" },
      },
    });
    const [aanvraag] = store.aanvragen;
    expect(aanvraag?.opdrachtgeverNaam).toBe("Gemeente Utrecht");
    expect(aanvraag?.startDatum).toBe("2026-11-01");
    expect(aanvraag?.contracttype).toBeTruthy();
  });

  it("preserves commercial fields when a sparse re-scrape sends UNKNOWN", async () => {
    const store = new InMemoryCurateStore();
    const rich = observation("COL-2", "hash-rich");
    await curateObservation(store, {
      ...rich,
      draft: {
        ...rich.draft,
        bronUrl: { provenance, value: "https://example.com/rich" },
        locatieTekst: { provenance, value: "Utrecht" },
        opdrachtgeverNaam: { provenance, value: "Provincie Utrecht" },
        startDatum: { provenance, value: "2026-12-01" },
        tarief: { eenheid: "uur", max: "110", min: "90", valuta: "EUR" },
      },
    });
    const sparse = observation("COL-2", "hash-sparse");
    await curateObservation(store, sparse);
    const [aanvraag] = store.aanvragen;
    expect(aanvraag).toMatchObject({
      bronUrl: "https://example.com/rich",
      contentHash: "hash-sparse",
      locatieTekst: "Utrecht",
      opdrachtgeverNaam: "Provincie Utrecht",
      startDatum: "2026-12-01",
      tariefMax: "110",
      tariefMin: "90",
      versie: 2,
    });
  });

  it("clears commercial fields when the draft sends CLEARED", async () => {
    const store = new InMemoryCurateStore();
    const rich = observation("COL-3", "hash-rich-clear");
    await curateObservation(store, {
      ...rich,
      draft: {
        ...rich.draft,
        bronUrl: { provenance, value: "https://example.com/clear-me" },
        opdrachtgeverNaam: { provenance, value: "Gemeente Tilburg" },
        startDatum: { provenance, value: "2027-01-15" },
        tarief: { eenheid: "uur", max: "120", min: "100", valuta: "EUR" },
      },
    });
    const cleared = observation("COL-3", "hash-cleared");
    await curateObservation(store, {
      ...cleared,
      draft: {
        ...cleared.draft,
        bronUrl: { provenance, value: CLEARED },
        opdrachtgeverNaam: { provenance, value: CLEARED },
        startDatum: { provenance, value: CLEARED },
        tarief: {
          eenheid: CLEARED,
          max: CLEARED,
          min: CLEARED,
          valuta: "EUR",
        },
      },
    });
    const [aanvraag] = store.aanvragen;
    expect(aanvraag).toMatchObject({
      bronUrl: null,
      contentHash: "hash-cleared",
      opdrachtgeverNaam: null,
      startDatum: null,
      tariefEenheid: null,
      tariefMax: null,
      tariefMin: null,
      versie: 2,
    });
    // CLEARED must drop prior commercial keys from bron_specifiek so the
    // column ?? JSON read path cannot resurrect them. Marker key *names*
    // may still appear under `_cleared` — assert top-level absence.
    expect(aanvraag?.bronSpecifiek).not.toHaveProperty("opdrachtgever_naam");
    expect(aanvraag?.bronSpecifiek).not.toHaveProperty("opdrachtgeverNaam");
    expect(aanvraag?.bronSpecifiek).not.toHaveProperty("start_datum");
    expect(aanvraag?.bronSpecifiek).not.toHaveProperty("startDatum");
    expect(aanvraag?.bronSpecifiek).not.toHaveProperty("tarief_min");
    // Sentinel string itself must never persist as a commercial value.
    expect(JSON.stringify(aanvraag?.bronSpecifiek ?? {})).not.toContain(
      `"${CLEARED}"`
    );
    // Durable markers survive strip so enrichment cannot resurrect gaps.
    expect(aanvraag?.bronSpecifiek).toMatchObject({
      [CLEARED_BRON_MARKER_KEY]: {
        opdrachtgeverNaam: true,
        opdrachtgever_naam: true,
        startDatum: true,
        start_datum: true,
        tarief: true,
        tariefEenheid: true,
        tariefMax: true,
        tariefMin: true,
        tarief_eenheid: true,
        tarief_max: true,
        tarief_min: true,
      },
    });
  });

  it("records durable CLEARED markers for locatie after strip", async () => {
    const store = new InMemoryCurateStore();
    const rich = observation("COL-4", "hash-rich-loc");
    await curateObservation(store, {
      ...rich,
      draft: {
        ...rich.draft,
        locatieTekst: { provenance, value: "Utrecht" },
      },
    });
    const cleared = observation("COL-4", "hash-cleared-loc");
    await curateObservation(store, {
      ...cleared,
      draft: {
        ...cleared.draft,
        locatieTekst: { provenance, value: CLEARED },
      },
    });
    const [aanvraag] = store.aanvragen;
    expect(aanvraag).toMatchObject({
      locatieTekst: null,
      versie: 2,
    });
    expect(aanvraag?.bronSpecifiek).not.toHaveProperty("locatie_tekst");
    expect(JSON.stringify(aanvraag?.bronSpecifiek ?? {})).not.toContain(
      `"${CLEARED}"`
    );
    expect(aanvraag?.bronSpecifiek).toMatchObject({
      [CLEARED_BRON_MARKER_KEY]: {
        locatie: true,
        locatieTekst: true,
        locatie_tekst: true,
      },
    });
  });

  it("lifts durable CLEARED markers when a later draft sets a real value", async () => {
    const store = new InMemoryCurateStore();
    const cleared = observation("COL-5", "hash-clear-then-set");
    await curateObservation(store, {
      ...cleared,
      draft: {
        ...cleared.draft,
        locatieTekst: { provenance, value: CLEARED },
      },
    });
    const restored = observation("COL-5", "hash-restored-loc");
    await curateObservation(store, {
      ...restored,
      draft: {
        ...restored.draft,
        locatieTekst: { provenance, value: "Rotterdam" },
      },
    });
    const [aanvraag] = store.aanvragen;
    expect(aanvraag).toMatchObject({
      locatieTekst: "Rotterdam",
      versie: 2,
    });
    expect(aanvraag?.bronSpecifiek).not.toMatchObject({
      [CLEARED_BRON_MARKER_KEY]: {
        locatie: true,
      },
    });
    expect(aanvraag?.bronSpecifiek).not.toMatchObject({
      [CLEARED_BRON_MARKER_KEY]: {
        locatie_tekst: true,
      },
    });
    expect(aanvraag?.bronSpecifiek).not.toMatchObject({
      [CLEARED_BRON_MARKER_KEY]: {
        locatieTekst: true,
      },
    });
  });
});

/**
 * CTP-498: every write on the unchanged-content path moves a field the search
 * document (and so the projection hash) contains, and the projector skips a
 * later same-content event. Each such write therefore has to carry its own
 * outbox event, or the index keeps a closed aanvraag active and a stale
 * last-seen date until the content changes.
 */
describe("curateObservation unchanged content enqueues its own events (CTP-498)", () => {
  const later = new Date("2026-09-02T06:00:00.000Z");

  const seedActive = async (store: InMemoryCurateStore) => {
    await curateObservation(store, observation("SEEN-1", "hash-stable"));
    expect(store.outboxEvents).toHaveLength(1);
    return store;
  };

  it("enqueues a status event and a new versie when the status flips", async () => {
    const store = await seedActive(new InMemoryCurateStore());
    const base = observation("SEEN-1", "hash-stable");

    const result = await curateObservation(store, {
      ...base,
      draft: { ...base.draft, status: "closed" },
      observedAt: later,
    });

    expect(result.status).toBe("unchanged");
    expect(result.outboxEventId).toBeTruthy();
    expect(result.versie).toBe(2);
    expect(store.outboxEvents).toHaveLength(2);
    expect(store.outboxEvents[1]).toMatchObject({
      aggregateType: "aanvraag",
      eventType: "aanvraag.status_gewijzigd",
    });
    // The projector pins the status from the payload, so a row that moved on
    // between the write and the drain is still indexed as closed.
    expect(store.outboxEvents[1]?.payload).toMatchObject({ status: "closed" });
    // status is the one field here that buildSnapshot records, so SCD2 needs
    // a new version whose snapshot agrees with the row.
    expect(store.aanvragen[0]).toMatchObject({ status: "closed", versie: 2 });
    expect(store.versies).toHaveLength(2);
    expect(store.versies[0]?.geldigTot).not.toBeNull();
    expect(store.versies[1]).toMatchObject({ geldigTot: null, versie: 2 });
    expect(store.versies[1]?.snapshot).toMatchObject({ status: "closed" });
  });

  it("enqueues an upsert event and no new versie when only laatstGezienOp moves", async () => {
    const store = await seedActive(new InMemoryCurateStore());

    const result = await curateObservation(store, {
      ...observation("SEEN-1", "hash-stable"),
      observedAt: later,
    });

    expect(result.status).toBe("unchanged");
    expect(result.outboxEventId).toBeTruthy();
    expect(result.versie).toBeUndefined();
    expect(store.outboxEvents).toHaveLength(2);
    expect(store.outboxEvents[1]).toMatchObject({
      eventType: "aanvraag.gewijzigd",
    });
    expect(store.aanvragen[0]).toMatchObject({
      laatstGezienOp: later,
      versie: 1,
    });
    // laatst_gezien_op is absent from buildSnapshot, so a version row here
    // would duplicate the open one without carrying new information.
    expect(store.versies).toHaveLength(1);
  });

  it("enqueues nothing when the same observation is seen again", async () => {
    const store = await seedActive(new InMemoryCurateStore());

    const result = await curateObservation(
      store,
      observation("SEEN-1", "hash-stable")
    );

    expect(result.status).toBe("unchanged");
    expect(result.outboxEventId).toBeUndefined();
    expect(store.outboxEvents).toHaveLength(1);
    expect(store.versies).toHaveLength(1);
    expect(store.aanvragen[0]).toMatchObject({
      laatstGezienOp: OBSERVED_AT,
      versie: 1,
    });
  });

  it("enqueues nothing and keeps laatstGezienOp when an older observation replays", async () => {
    const store = await seedActive(new InMemoryCurateStore());

    const result = await curateObservation(store, {
      ...observation("SEEN-1", "hash-stable"),
      observedAt: new Date(OBSERVED_AT.getTime() - 60_000),
    });

    expect(result.status).toBe("unchanged");
    expect(result.outboxEventId).toBeUndefined();
    expect(store.outboxEvents).toHaveLength(1);
    expect(store.aanvragen[0]).toMatchObject({
      laatstGezienOp: OBSERVED_AT,
      versie: 1,
    });
  });

  it("rolls the seen write back entirely when the outbox insert fails", async () => {
    const store = await seedActive(new InMemoryCurateStore());

    await expect(
      curateObservation(withFailingOutbox(store), {
        ...observation("SEEN-1", "hash-stable"),
        observedAt: later,
      })
    ).rejects.toThrow("forced outbox insert failure");

    // Without the join, the row would carry a last-seen date the index can
    // never learn about: the next same-content event is skipped by the hash.
    expect(store.aanvragen[0]).toMatchObject({ laatstGezienOp: OBSERVED_AT });
    expect(store.outboxEvents).toHaveLength(1);
  });
});
