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
  normalizeDedupText,
  parseTariefFromText,
  parseTenderNedPayload,
  validateNormalisedDraft,
} from "@ji/application/normalise";
import { hashContent } from "@ji/connectors";
import type { InhuurdeskFetchedPayload } from "@ji/connectors/inhuurdesk";
import type { NeedstaffingFetchedPayload } from "@ji/connectors/needstaffing";
import type { TenderNedFetchedPayload } from "@ji/connectors/tenderned";
import { UNKNOWN } from "@ji/domain";

import { parseNeedstaffingPayload } from "./needstaffing";

const TENDER_NED_HASH = "sha256-test";

const buildTenderNedPayload = (ids: {
  kenmerk: number | string | null;
  publicatieId: number | string;
}): TenderNedFetchedPayload => {
  const rawDetail = [
    '{"aanbestedingNaam":"Platform engineer Azure DAS"',
    '"aankondigingCode":{"code":"AAO"}',
    `"kenmerk":${JSON.stringify(ids.kenmerk)}`,
    '"numberOfDaysBeforeAanmeldenInschrijven":14',
    '"opdrachtBeschrijving":"Volledige detailbeschrijving."',
    '"opdrachtgeverNaam":"Gemeente Amsterdam"',
    '"publicatieDatum":"2026-08-28T12:15:00+02:00"',
    `"publicatieId":${JSON.stringify(ids.publicatieId)}}`,
  ].join(",");
  // SAFETY: parsing raw JSON reproduces live TenderNed responses, where ids
  // arrive as numbers despite the declared string types.
  const detail = JSON.parse(rawDetail) as TenderNedFetchedPayload["detail"];
  return {
    detail,
    listing: detail,
    publicatieId: String(ids.publicatieId),
  };
};

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
  it("builds an unambiguous Postgres-safe dedup key", () => {
    const dedupKey = buildDedupKey({
      opdrachtgeverNaam: "Gemeente\u001F Amsterdam",
      startDatum: "2026-09-01",
      titel: "Senior\u001F Developer",
    });

    expect(dedupKey).toBe(
      "senior developer\u001Fgemeente amsterdam\u001F2026-09-01"
    );
    expect(dedupKey).not.toContain("\u0000");
  });

  it("keeps a unit separator distinct from no separator", () => {
    expect(normalizeDedupText("foo\u001Fbar")).not.toBe(
      normalizeDedupText("foobar")
    );
  });

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

describe("normalise tenderned", () => {
  it("coerces a numeric kenmerk to a string bronReferentie that validates", () => {
    const draft = parseTenderNedPayload(
      buildTenderNedPayload({ kenmerk: 563_214, publicatieId: 608_998 }),
      TENDER_NED_HASH
    );

    expect(draft.bronReferentie.value).toBe("563214");
    expect(draft.bronReferentie.value).toBeTypeOf("string");
    expect(() => validateNormalisedDraft(draft)).not.toThrow();
    expect(
      validateNormalisedDraft(draft).filter(
        (issue) => issue.field === "bron_referentie"
      )
    ).toEqual([]);
  });

  it("coerces a numeric publicatieId into the bronUrl and bronSpecifiek", () => {
    const draft = parseTenderNedPayload(
      buildTenderNedPayload({ kenmerk: 563_214, publicatieId: 608_998 }),
      TENDER_NED_HASH
    );

    expect(draft.bronUrl.value).toBe(
      "https://www.tenderned.nl/aankondigingen/overzicht/608998"
    );
    // SAFETY: parseTenderNedPayload always emits an object with publicatie_id.
    const specifiek = draft.bronSpecifiek.value as { publicatie_id: unknown };
    expect(specifiek.publicatie_id).toBe("608998");
    expect(specifiek.publicatie_id).toBeTypeOf("string");
  });

  it("keeps string ids from fixtures unchanged", () => {
    const draft = parseTenderNedPayload(
      buildTenderNedPayload({
        kenmerk: "TN563214",
        publicatieId: "fixture-pub-001",
      }),
      TENDER_NED_HASH
    );

    expect(draft.bronReferentie.value).toBe("TN563214");
    expect(draft.bronUrl.value).toBe(
      "https://www.tenderned.nl/aankondigingen/overzicht/fixture-pub-001"
    );
    expect(validateNormalisedDraft(draft)).toEqual([]);
  });

  it("still reports an empty bron_referentie as an issue", () => {
    const draft = parseTenderNedPayload(
      buildTenderNedPayload({ kenmerk: null, publicatieId: 608_998 }),
      TENDER_NED_HASH
    );

    expect(validateNormalisedDraft(draft)).toEqual([
      { field: "bron_referentie", message: "bron_referentie is required" },
    ]);
  });
});

const buildNeedstaffingPayload = (
  overrides: Partial<NeedstaffingFetchedPayload["detail"]> = {}
): NeedstaffingFetchedPayload => ({
  detail: {
    deadline: "1788778800000",
    id: "15520",
    locatie: "Den Haag",
    periode: "4 maanden",
    referentie: "2026-BZB-0457",
    start: "1790380800000",
    tariefMax: "102",
    tariefMin: "98",
    titel: "Operationeel Database Ontwikkelaar 2026-BZB-0457",
    uren: "36",
    ...overrides,
  },
  listing: {
    id: "15520",
    opdrachtgeverNaam: "Belastingdienst",
    titel: "Operationeel Database Ontwikkelaar 2026-BZB-0457",
  },
  raw: { html: "<p>Rolomschrijving voor database ontwikkelaar.</p>" },
});

describe("normalise needstaffing", () => {
  it("derives typed tarief.min/max and an ISO startDatum from epoch fields", () => {
    const draft = parseNeedstaffingPayload(
      buildNeedstaffingPayload(),
      "hash-needstaffing"
    );

    expect(draft.tarief.min).toBe("98");
    expect(draft.tarief.max).toBe("102");
    expect(draft.tarief.eenheid).toBe("uur");
    expect(draft.startDatum.value).toBe("2026-09-26");
    expect(draft.bronReferentie.value).toBe("15520");
    expect(draft.bronUrl.value).toBe(
      "https://www.needstaffing.nl/Opdrachten/15520"
    );
    expect(draft.opdrachtgeverNaam.value).toBe("Belastingdienst");
    expect(draft.beschrijving.value).toContain(
      "Rolomschrijving voor database ontwikkelaar"
    );
    expect(validateNormalisedDraft(draft)).toEqual([]);
  });

  it("falls back to UNKNOWN when tarief or start data is missing", () => {
    const draft = parseNeedstaffingPayload(
      buildNeedstaffingPayload({
        deadline: undefined,
        start: undefined,
        tariefMax: undefined,
        tariefMin: undefined,
      }),
      "hash-needstaffing-unknown"
    );

    expect(draft.tarief.min).toBe(UNKNOWN);
    expect(draft.tarief.max).toBe(UNKNOWN);
    expect(draft.startDatum.value).toBe(UNKNOWN);
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
