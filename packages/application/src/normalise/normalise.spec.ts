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
import { hashContent, loadConnectorFixture } from "@ji/connectors";
import type { InhuurdeskFetchedPayload } from "@ji/connectors/inhuurdesk";
import type { NeedstaffingFetchedPayload } from "@ji/connectors/needstaffing";
import type {
  OpdrachtoverheidFetchedPayload,
  OpdrachtoverheidListingResponse,
} from "@ji/connectors/opdrachtoverheid";
import type { TenderNedFetchedPayload } from "@ji/connectors/tenderned";
import { UNKNOWN } from "@ji/domain";

import { parseNeedstaffingPayload } from "./needstaffing";
import { parseOpdrachtoverheidPayload } from "./opdrachtoverheid";

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

const buildOpdrachtoverheidPayload = (
  overrides: Partial<OpdrachtoverheidFetchedPayload["tender"]> = {}
): OpdrachtoverheidFetchedPayload => ({
  jobPosting: null,
  tender: {
    contract_type: "detachering",
    opdracht_overheid_url:
      "https://www.opdrachtoverheid.nl/inhuuropdracht/Enexis/Senior-Coordinator/36A6A824",
    tender_buying_organization: "Enexis",
    tender_id: "harveynash_298847",
    tender_job_location: null,
    tender_max_hours: 40,
    tender_maximum_tariff: 119,
    tender_min_hours: 32,
    tender_name: "Senior Project- en Programmacoordinator Grootzakelijk",
    tender_no_max_tariff: false,
    tender_source: "harveynash",
    tender_start_date: "2026-08-29",
    tender_url:
      "https://www.harveynash.nl/vacatures/298847-Senior-Project--en-Programmacoordinator-Grootzakelijk",
    web_key: "36A6A824-B5F2-4D3E-A749-425BA6B99EDD",
    ...overrides,
  },
});

describe("normalise opdrachtoverheid", () => {
  it("uses tender_id as the stable bron_referentie", () => {
    const draft = parseOpdrachtoverheidPayload(
      buildOpdrachtoverheidPayload(),
      "hash-oo-1"
    );

    expect(draft.bronReferentie.value).toBe("harveynash_298847");
    expect(validateNormalisedDraft(draft)).toEqual([]);
  });

  it("parses tender_maximum_tariff as a numeric hourly max tarief", () => {
    const draft = parseOpdrachtoverheidPayload(
      buildOpdrachtoverheidPayload(),
      "hash-oo-2"
    );

    expect(draft.tarief.max).toBe("119");
    expect(draft.tarief.min).toBe(UNKNOWN);
    expect(draft.tarief.eenheid).toBe("uur");
    expect(draft.tarief.valuta).toBe("EUR");
  });

  it("keeps tender_source and tender_url in bron_specifiek for cross-source dedup", () => {
    const draft = parseOpdrachtoverheidPayload(
      buildOpdrachtoverheidPayload(),
      "hash-oo-3"
    );

    // SAFETY: parseOpdrachtoverheidPayload always emits these bron_specifiek fields.
    const specifiek = draft.bronSpecifiek.value as {
      tender_source: unknown;
      tender_url: unknown;
    };
    expect(specifiek.tender_source).toBe("harveynash");
    expect(specifiek.tender_url).toBe(
      "https://www.harveynash.nl/vacatures/298847-Senior-Project--en-Programmacoordinator-Grootzakelijk"
    );
  });

  it("falls back to unknown tarief when tender_maximum_tariff is absent", () => {
    const draft = parseOpdrachtoverheidPayload(
      buildOpdrachtoverheidPayload({ tender_maximum_tariff: undefined }),
      "hash-oo-4"
    );

    expect(draft.tarief.max).toBe(UNKNOWN);
    expect(draft.tarief.min).toBe(UNKNOWN);
    expect(draft.tarief.eenheid).toBe(UNKNOWN);
  });

  it("falls back to tender_hours_week when min/max hours are both absent", () => {
    const draft = parseOpdrachtoverheidPayload(
      buildOpdrachtoverheidPayload({
        tender_hours_week: "36",
        tender_max_hours: undefined,
        tender_min_hours: undefined,
      }),
      "hash-oo-5"
    );

    // SAFETY: parseOpdrachtoverheidPayload always emits these bron_specifiek fields.
    const specifiek = draft.bronSpecifiek.value as {
      uren_max: unknown;
      uren_min: unknown;
    };
    expect(specifiek.uren_min).toBe("36");
    expect(specifiek.uren_max).toBe("36");
  });

  it("falls back to vacancies_location when tender_job_location is absent", () => {
    const draft = parseOpdrachtoverheidPayload(
      buildOpdrachtoverheidPayload({
        tender_job_location: null,
        vacancies_location: { province: "Noord-Holland" },
      }),
      "hash-oo-6"
    );

    expect(draft.locatieTekst.value).toBe("Noord-Holland");
  });

  it("reports an unknown location when no location field is populated", () => {
    const draft = parseOpdrachtoverheidPayload(
      buildOpdrachtoverheidPayload({ tender_job_location: null }),
      "hash-oo-7"
    );

    expect(draft.locatieTekst.value).toBe(UNKNOWN);
  });

  it("prefers the JobPosting JSON-LD description and marks jsonld extractieMethode", () => {
    const draft = parseOpdrachtoverheidPayload(
      {
        jobPosting: {
          "@type": "JobPosting",
          description: "Verrijkte beschrijving uit JSON-LD detailpagina.",
        },
        tender: buildOpdrachtoverheidPayload().tender,
      },
      "hash-oo-8"
    );

    expect(draft.beschrijving.value).toBe(
      "Verrijkte beschrijving uit JSON-LD detailpagina."
    );
    expect(draft.extractieMethode).toBe("jsonld");
  });

  it("uses the api extractieMethode when no JobPosting enrichment is present", () => {
    const draft = parseOpdrachtoverheidPayload(
      buildOpdrachtoverheidPayload(),
      "hash-oo-9"
    );

    expect(draft.extractieMethode).toBe("api");
  });

  it("parses tender_tariff free text into a numeric max when tender_maximum_tariff is absent (fixture)", async () => {
    const fixture = await loadConnectorFixture<OpdrachtoverheidListingResponse>(
      "opdrachtoverheid/listing-page-0.json"
    );
    const [record] = fixture.payload.negometrix_tenders;
    if (!record) {
      throw new Error("Expected an Opdrachtoverheid fixture record");
    }
    // Confirmed live 2026-08-31: all 5 fixture records have
    // tender_maximum_tariff: null and a numeric tender_tariff string.
    expect(record.tender_maximum_tariff).toBeNull();
    expect(record.tender_tariff).toBe("70");

    const draft = parseOpdrachtoverheidPayload(
      { jobPosting: null, tender: record },
      "hash-oo-fixture-tarief"
    );

    expect(draft.tarief.max).toBe("70");
    expect(draft.tarief.min).toBe(UNKNOWN);
    expect(draft.tarief.eenheid).toBe("uur");
  });

  it("derives a closed lifecycle from the bron's own tender_status/tender_active (fixture, future offline_date)", async () => {
    const fixture = await loadConnectorFixture<OpdrachtoverheidListingResponse>(
      "opdrachtoverheid/listing-page-0.json"
    );
    const [record] = fixture.payload.negometrix_tenders;
    if (!record) {
      throw new Error("Expected an Opdrachtoverheid fixture record");
    }
    // Confirmed live 2026-08-31: every fixture record is already closed.
    expect(record.tender_status).toBe("closed");
    expect(record.tender_active).toBe(false);

    // Push tender_offline_date into the future so `sluitingsdatumPassed`
    // cannot be what forces the lifecycle to "closed" — without deriving
    // bronSaysClosed from tender_status/tender_active, this would
    // (incorrectly) resolve to "active".
    const draft = parseOpdrachtoverheidPayload(
      {
        jobPosting: null,
        tender: { ...record, tender_offline_date: "2099-01-01 00:00:00" },
      },
      "hash-oo-fixture-closed"
    );

    expect(draft.lifecycle).toBe("closed");
    expect(draft.status).toBe("closed");
  });

  it("closes lifecycle once tender_offline_date has passed", () => {
    const draft = parseOpdrachtoverheidPayload(
      buildOpdrachtoverheidPayload({
        tender_offline_date: "2000-01-01 00:00:00",
      }),
      "hash-oo-closed-past"
    );

    expect(draft.lifecycle).toBe("closed");
    expect(draft.status).toBe("closed");
  });

  it("stays active while tender_offline_date is still in the future", () => {
    const draft = parseOpdrachtoverheidPayload(
      buildOpdrachtoverheidPayload({
        tender_offline_date: "2099-01-01 00:00:00",
      }),
      "hash-oo-active-future"
    );

    expect(draft.lifecycle).toBe("active");
    expect(draft.status).toBe("active");
  });

  it("stays active when tender_offline_date closes later today (RJC-376 regression)", () => {
    // Reproduces the bug: truncating "later today" to a bare date and
    // comparing at midnight used to flip this to "closed" hours before the
    // real deadline. tender_offline_date carries a real time component at
    // the source (space-separated, e.g. "2026-09-01 16:00:00"), so a naive
    // Europe/Amsterdam wall-clock string a few minutes in the future must
    // not close it.
    const parts = new Intl.DateTimeFormat("en-US", {
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
      minute: "2-digit",
      month: "2-digit",
      second: "2-digit",
      timeZone: "Europe/Amsterdam",
      year: "numeric",
    }).formatToParts(new Date(Date.now() + 5 * 60 * 1000));
    const get = (type: string) =>
      parts.find((part) => part.type === type)?.value;
    const laterToday = `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}:${get("second")}`;

    const draft = parseOpdrachtoverheidPayload(
      buildOpdrachtoverheidPayload({ tender_offline_date: laterToday }),
      "hash-oo-later-today"
    );

    expect(draft.lifecycle).toBe("active");
    expect(draft.status).toBe("active");
  });

  it("stays unknown/open rather than auto-closing when tender_offline_date is absent", () => {
    const draft = parseOpdrachtoverheidPayload(
      buildOpdrachtoverheidPayload({ tender_offline_date: undefined }),
      "hash-oo-no-offline-date"
    );

    // No closing information at all -- must not read as "already closed".
    expect(draft.lifecycle).not.toBe("closed");
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
