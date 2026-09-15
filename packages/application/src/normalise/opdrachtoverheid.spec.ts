import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

import type { OpdrachtoverheidFetchedPayload } from "@ji/connectors/opdrachtoverheid";

import { opdrachtoverheid } from "../sources/opdrachtoverheid";
import type { OpdrachtoverheidBronSpecifiek } from "./opdrachtoverheid";
import {
  normaliseOpdrachtoverheidObservation,
  parseOpdrachtoverheidPayload,
} from "./opdrachtoverheid";

/**
 * Real `POST /search` records captured live on 2026-09-15 (CTP-526), together
 * with the JobPosting JSON-LD from each detail page. Three cases:
 *
 * - `zero`: `tender_min_hours`/`tender_max_hours` are `0` while
 *   `tender_hours_week` states "32" -- the CTP-526 uren defect.
 * - `range`: real `16`/`24` bounds, no education level, no hybrid flag.
 * - `bare`: nothing published beyond the basics (no closing date, no
 *   competences, no detail page) -- the honesty case.
 */
interface OpdrachtoverheidSampleFile {
  readonly samples: readonly ({
    readonly case: string;
  } & OpdrachtoverheidFetchedPayload)[];
}

// SAFETY: repo-owned fixture captured from the source and committed alongside
// this spec; the per-case lookup below throws when a case is missing.
const SAMPLES = JSON.parse(
  readFileSync(
    path.join(
      import.meta.dir,
      "../../../../fixtures/connectors/opdrachtoverheid/normalise-samples-2026-09-15.json"
    ),
    "utf-8"
  )
) as OpdrachtoverheidSampleFile;

const sample = (name: string): OpdrachtoverheidFetchedPayload => {
  const found = SAMPLES.samples.find((entry) => entry.case === name);
  if (!found) {
    throw new Error(`missing opdrachtoverheid sample case: ${name}`);
  }
  return { jobPosting: found.jobPosting, tender: found.tender };
};

const bronSpecifiekOf = (
  payload: OpdrachtoverheidFetchedPayload
): OpdrachtoverheidBronSpecifiek =>
  // SAFETY: `resolveBronSpecifiek` builds exactly this shape; the draft field
  // only widens it to `JsonValue` for storage.
  parseOpdrachtoverheidPayload(payload, "hash").bronSpecifiek
    .value as OpdrachtoverheidBronSpecifiek;

const bronSpecifiek = (name: string): OpdrachtoverheidBronSpecifiek =>
  // SAFETY: `resolveBronSpecifiek` builds exactly this shape; the draft field
  // only widens it to `JsonValue` for storage.
  parseOpdrachtoverheidPayload(sample(name), "hash").bronSpecifiek
    .value as OpdrachtoverheidBronSpecifiek;

describe("parseOpdrachtoverheidPayload (CTP-526 field gaps)", () => {
  it("keeps the published weekly hours when the numeric bounds are the API's zero marker", () => {
    expect(bronSpecifiek("zero")).toMatchObject({
      tender_hours_week: "32",
      uren_max: null,
      uren_min: null,
      uren_per_week: "32",
    });
  });

  it("emits the real numeric hour bounds as a range", () => {
    expect(bronSpecifiek("range")).toMatchObject({
      uren_max: "24",
      uren_min: "16",
      uren_per_week: "16–24",
    });
  });

  it("maps the source-published province", () => {
    expect(bronSpecifiek("zero").provincie).toBe("Noord-Holland");
    expect(bronSpecifiek("range").provincie).toBe("Noord-Holland");
  });

  it("maps the source's own education level label", () => {
    expect(bronSpecifiek("zero").opleidingsniveau).toBe("MBO");
  });

  it("leaves opleidingsniveau null for the source's Onbekend marker", () => {
    expect(bronSpecifiek("range").opleidingsniveau).toBeNull();
    expect(bronSpecifiek("bare").opleidingsniveau).toBeNull();
  });

  it("reads skills from the Competenties list only, never the Wensen prose", () => {
    expect(bronSpecifiek("zero").skills).toEqual([
      "Nauwkeurig",
      "Communicatief vaardig",
      "Bestuurlijk sensitief",
      "Plannen en organiseren",
      "Zelfstandig",
    ]);
    expect(bronSpecifiek("range").skills).toEqual([
      "Klantgerichtheid",
      "Resultaatgerichtheid",
      "Onderhandelen",
      "Analytisch vermogen",
      "Bestuurlijke sensitiviteit",
      "Organisatiegericht",
      "Besluitvaardigheid",
    ]);
  });

  it("leaves skills null when the source publishes no competences block", () => {
    expect(bronSpecifiek("bare").skills).toBeNull();
  });

  it("emits werkvorm Hybride when the source states hybrid work", () => {
    const base = sample("zero");
    expect(
      bronSpecifiekOf({
        jobPosting: base.jobPosting,
        tender: { ...base.tender, tender_hybrid_working: true },
      })
    ).toMatchObject({ tender_hybrid_working: true, werkvorm: "Hybride" });
  });

  it("falls back to the JobPosting addressRegion when the API location block is empty", () => {
    const base = sample("zero");
    expect(
      bronSpecifiekOf({
        jobPosting: base.jobPosting,
        tender: { ...base.tender, vacancies_location: {} },
      }).provincie
    ).toBe("Noord-Holland");
  });

  it("decodes HTML entities in competence items", () => {
    const base = sample("zero");
    expect(
      bronSpecifiekOf({
        jobPosting: base.jobPosting,
        tender: {
          ...base.tender,
          tender_competences:
            "<h3>Competenties</h3><ul><li>Plannen &amp; organiseren</li></ul>",
        },
      }).skills
    ).toEqual(["Plannen & organiseren"]);
  });

  it("emits werkvorm only when the source states hybrid work", () => {
    // tender_hybrid_working is false here ("Hybride werken: Nee"), which denies
    // hybrid work without publishing where the work happens.
    expect(bronSpecifiek("zero").werkvorm).toBeNull();
    expect(bronSpecifiek("zero").tender_hybrid_working).toBe(false);
    expect(bronSpecifiek("bare").werkvorm).toBeNull();
  });

  it("passes the published contract_type through verbatim", () => {
    expect(bronSpecifiek("zero").contract_type).toBe("detachering");
    expect(bronSpecifiek("range").contract_type).toBe("temporary");
    expect(bronSpecifiek("bare").contract_type).toBeNull();
  });

  it("resolves sluitingsdatum from tender_offline_date at its published wall-clock time", () => {
    // Detail page for this record shows "Sluitingsdatum 29 sept 2026";
    // tender_offline_date is "2026-09-29 16:00:00" Europe/Amsterdam.
    expect(
      parseOpdrachtoverheidPayload(sample("zero"), "hash").sluitingsdatum
    ).toEqual(new Date("2026-09-29T14:00:00.000Z"));
  });

  it("leaves sluitingsdatum absent when the source publishes no closing moment", () => {
    expect(
      parseOpdrachtoverheidPayload(sample("bare"), "hash").sluitingsdatum
    ).toBeUndefined();
  });

  it("maps the contract start date from tender_start_date", () => {
    expect(
      parseOpdrachtoverheidPayload(sample("zero"), "hash").startDatum.value
    ).toBe("2026-11-01");
  });
});

describe("opdrachtoverheid pipeline (fixture listing -> connector -> normalise)", () => {
  it("carries the published education level and competences through the connector projection", async () => {
    const connector = opdrachtoverheid.createConnector({
      bronId: opdrachtoverheid.bronId,
      listingFixturePath: "opdrachtoverheid/listing-page-0.json",
      live: false,
      runKind: "test",
    });
    const discovery = await connector.discover(null);
    const item = discovery.items.find(
      (candidate) => candidate.bronReferentie === "amstelveenhuurtin_2177"
    );
    if (!item) {
      throw new Error("expected amstelveenhuurtin_2177 in the fixture listing");
    }
    const fetched = await connector.fetch(item);
    if (fetched?.status !== "fetched") {
      throw new Error("expected a fetched observation");
    }
    const draft = normaliseOpdrachtoverheidObservation(
      fetched.body,
      item.contentHash
    );
    // SAFETY: same shape `resolveBronSpecifiek` builds, widened for storage.
    const facts = draft.bronSpecifiek.value as OpdrachtoverheidBronSpecifiek;
    expect(facts).toMatchObject({
      opleidingsniveau: "MBO",
      provincie: "Noord-Holland",
      uren_per_week: "32",
    });
    expect(facts.skills).toEqual([
      "Nauwkeurig",
      "Communicatief vaardig",
      "Bestuurlijk sensitief",
      "Plannen en organiseren",
      "Zelfstandig",
    ]);
  });
});
