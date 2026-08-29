import { describe, expect, it } from "bun:test";

import {
  curateObservation,
  InMemoryCurateStore,
  processObservation,
  splitDedupGroep,
} from "@ji/application/identity";
import {
  buildDedupKey,
  normaliseInhuurdeskObservation,
  parseTariefFromText,
} from "@ji/application/normalise";
import { hashContent } from "@ji/connectors";
import type { InhuurdeskFetchedPayload } from "@ji/connectors/inhuurdesk";
import { UNKNOWN } from "@ji/domain";

const buildInhuurdeskBody = (description: string): Uint8Array => {
  const payload: InhuurdeskFetchedPayload = {
    assignment: {
      aanvraagnummer: "IH-AE6-001",
      client: "Alliander",
      description,
      location: "Duiven",
      startDate: "2026-09-01",
      title: "Senior Java Developer",
    },
  };
  return new TextEncoder().encode(JSON.stringify(payload));
};

describe("normalise", () => {
  it("covers AE6: unstructured tarief stays in beschrijving with unknown structured fields", async () => {
    const body = buildInhuurdeskBody(
      "<p>Rolomschrijving zonder tariefstructuur.</p><p>Tarief wordt in overleg bepaald.</p>"
    );
    const contentHash = await hashContent(body);
    const draft = normaliseInhuurdeskObservation(body, contentHash);

    expect(draft.tarief.max).toBe(UNKNOWN);
    expect(draft.tarief.min).toBe(UNKNOWN);
    expect(draft.beschrijving.value).toContain(
      "Tarief wordt in overleg bepaald"
    );
  });

  it("parses a single clear max tarief from HTML text", () => {
    const parsed = parseTariefFromText(
      "Max tarief €110 incl msp fee per uur voor deze rol."
    );
    expect(parsed.max).toBe("110");
    expect(parsed.eenheid).toBe("uur");
  });

  it("quarantines schema-invalid observations", async () => {
    const store = new InMemoryCurateStore();
    const payload: InhuurdeskFetchedPayload = {
      assignment: {
        aanvraagnummer: "IH-INVALID",
        client: "Alliander",
        description: "Beschrijving",
        title: "   ",
      },
    };
    const body = new TextEncoder().encode(JSON.stringify(payload));
    const result = await processObservation(store, {
      body,
      bronId: "bron-invalid",
      bronSlug: "inhuurdesk",
      contentHash: "hash-invalid",
      observedAt: new Date("2026-08-28T10:00:00.000Z"),
      rawPayloadRef: "raw/invalid.json",
      scrapeRunId: "run-invalid",
    });

    expect(result.status).toBe("quarantined");
    expect(store.aanvragen).toHaveLength(0);
  });
});

describe("identity", () => {
  it("creates one reviewable dedup group for two bronnen with same title/org/start", async () => {
    const store = new InMemoryCurateStore();
    const observedAt = new Date("2026-08-28T10:00:00.000Z");
    const sharedKey = buildDedupKey({
      opdrachtgeverNaam: "Alliander",
      startDatum: "2026-09-01",
      titel: "Senior Java Developer",
    });

    const firstBody = buildInhuurdeskBody("Eerste bron beschrijving.");
    const secondBody = buildInhuurdeskBody("Tweede bron beschrijving.");
    const firstHash = await hashContent(firstBody);
    const secondHash = await hashContent(secondBody);
    const firstDraft = normaliseInhuurdeskObservation(firstBody, firstHash);
    firstDraft.bronReferentie.value = "IH-GROUP-1";
    const secondDraft = normaliseInhuurdeskObservation(secondBody, secondHash);
    secondDraft.bronReferentie.value = "IH-GROUP-2";

    await curateObservation(store, {
      bronId: "bron-a",
      draft: firstDraft,
      observedAt,
      rawPayloadRef: "raw/a.json",
      scrapeRunId: "run-a",
    });
    await curateObservation(store, {
      bronId: "bron-b",
      draft: secondDraft,
      observedAt,
      rawPayloadRef: "raw/b.json",
      scrapeRunId: "run-b",
    });

    expect(store.aanvragen).toHaveLength(2);
    expect(store.dedupGroepen).toHaveLength(1);
    expect(store.dedupGroepen[0]?.dedupKey).toBe(sharedKey);
    expect(store.aanvragen.every((row) => row.dedupGroepId)).toBe(true);
  });

  it("supports reversible dedup group splits", async () => {
    const store = new InMemoryCurateStore();
    const body = buildInhuurdeskBody("Beschrijving");
    const hash = await hashContent(body);
    const draft = normaliseInhuurdeskObservation(body, hash);
    const result = await curateObservation(store, {
      bronId: "bron-split",
      draft,
      observedAt: new Date("2026-08-28T10:00:00.000Z"),
      rawPayloadRef: "raw/split.json",
      scrapeRunId: "run-split",
    });
    const { dedupGroepId } = result;
    expect(dedupGroepId).toBeDefined();
    if (!dedupGroepId) {
      throw new Error("Expected dedupGroepId from curateObservation");
    }
    await splitDedupGroep(store, dedupGroepId);
    expect(store.aanvragen[0]?.dedupGroepId).toBeNull();
    expect(store.dedupGroepen).toHaveLength(0);
  });

  it("opens SCD2 version and outbox event when tarief changes", async () => {
    const store = new InMemoryCurateStore();
    const observedAt = new Date("2026-08-28T10:00:00.000Z");
    const firstBody = buildInhuurdeskBody("Max tarief €100 per uur.");
    const secondBody = buildInhuurdeskBody("Max tarief €130 per uur.");
    const firstHash = await hashContent(firstBody);
    const secondHash = await hashContent(secondBody);

    await processObservation(store, {
      body: firstBody,
      bronId: "bron-tarief",
      bronSlug: "inhuurdesk",
      contentHash: firstHash,
      observedAt,
      rawPayloadRef: "raw/v1.json",
      scrapeRunId: "run-v1",
    });
    const changed = await processObservation(store, {
      body: secondBody,
      bronId: "bron-tarief",
      bronSlug: "inhuurdesk",
      contentHash: secondHash,
      observedAt: new Date("2026-08-29T10:00:00.000Z"),
      rawPayloadRef: "raw/v2.json",
      scrapeRunId: "run-v2",
    });

    expect(changed.status).toBe("curated");
    expect(changed.versie).toBe(2);
    expect(store.versies).toHaveLength(2);
    expect(store.versies[0]?.geldigTot).not.toBeNull();
    expect(store.outboxEvents.at(-1)?.eventType).toBe("aanvraag.gewijzigd");
    expect(store.aanvragen[0]?.tariefMax).toBe("130");
  });
});
