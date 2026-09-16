import { describe, expect, it } from "bun:test";

import type { NormalisedAanvraagDraft } from "@ji/application/normalise";
import type { CLEARED } from "@ji/domain";
import { UNKNOWN } from "@ji/domain";

import {
  applyPlanToBronSpecifiek,
  parseRenormaliseArguments,
  planRenormalisePatch,
} from "./renormalise-from-raw";
import type { StoredRenormaliseRow } from "./renormalise-from-raw";

const provenance = { parserVersion: "spec", sourcePath: "n/a" };

const draft = (input: {
  readonly bronSpecifiekValue?: {
    readonly contract_type?: string;
    readonly employment_type?: string;
    readonly provincie?: string;
    readonly skills?: readonly string[];
    readonly tender_hours_week?: string;
    readonly uren_per_week?: string;
  };
  readonly startDatumValue?: string | typeof UNKNOWN | typeof CLEARED;
}): NormalisedAanvraagDraft => ({
  beschrijving: { provenance, value: "Body" },
  bronReferentie: { provenance, value: "1" },
  bronSpecifiek: { provenance, value: input.bronSpecifiekValue ?? {} },
  bronUrl: { provenance, value: "https://example.test/1" },
  contentHash: "a".repeat(64),
  extractieMethode: "api",
  lifecycle: "active",
  locatieLand: { provenance, value: "NL" },
  locatieTekst: { provenance, value: UNKNOWN },
  opdrachtgeverNaam: { provenance, value: UNKNOWN },
  parserVersion: "spec",
  startDatum: { provenance, value: input.startDatumValue ?? UNKNOWN },
  status: "active",
  tarief: {
    eenheid: UNKNOWN,
    max: UNKNOWN,
    min: UNKNOWN,
    valuta: "EUR",
  },
  titel: { provenance, value: "Title" },
});

const stored = (
  overrides: Partial<StoredRenormaliseRow> = {}
): StoredRenormaliseRow => ({
  aanvraagId: "aanvraag-1",
  bronId: "00000000-0000-4000-8000-000000000009",
  bronReferentie: "1",
  bronSpecifiek: {},
  contentHash: "a".repeat(64),
  rawPayloadRef: "raw/a",
  startDatum: null,
  urenPerWeek: null,
  ...overrides,
});

describe("parseRenormaliseArguments", () => {
  it("defaults to report mode", () => {
    expect(parseRenormaliseArguments(["--bron", "onefellow"])).toEqual({
      bronSlugs: ["onefellow"],
      ingestQuiesced: false,
      limit: undefined,
      operation: "report",
    });
  });

  it("accepts apply only with ingest quiesced", () => {
    expect(
      parseRenormaliseArguments([
        "--bron",
        "onefellow",
        "--apply",
        "--ingest-quiesced",
      ])
    ).toMatchObject({ ingestQuiesced: true, operation: "apply" });
  });

  it("rejects apply without quiescence", () => {
    expect(() =>
      parseRenormaliseArguments(["--bron", "onefellow", "--apply"])
    ).toThrow("--apply requires --ingest-quiesced");
  });

  it("rejects quiescence in report mode", () => {
    expect(() =>
      parseRenormaliseArguments(["--bron", "onefellow", "--ingest-quiesced"])
    ).toThrow("--apply requires --ingest-quiesced");
  });

  it("parses comma and repeated --bron", () => {
    expect(
      parseRenormaliseArguments([
        "--bron",
        "onefellow,bluetrail",
        "--bron",
        "hero",
      ]).bronSlugs
    ).toEqual(["onefellow", "bluetrail", "hero"]);
  });

  it("rejects unknown bron", () => {
    expect(() => parseRenormaliseArguments(["--bron", "not-a-bron"])).toThrow(
      "Unknown --bron"
    );
  });
});

describe("planRenormalisePatch", () => {
  it("plans Onefellow startDatum mismatch (CTP-535 / CTP-598 class)", () => {
    const plan = planRenormalisePatch(
      draft({ startDatumValue: "2026-10-05" }),
      stored({ startDatum: "2026-10-04" })
    );
    expect(plan.status).toBe("would_patch");
    expect(plan.patches).toEqual([
      { field: "start_datum", from: "2026-10-04", to: "2026-10-05" },
    ]);
  });

  it("plans OO uren_per_week '0' overwrite from draft hours", () => {
    const plan = planRenormalisePatch(
      draft({
        bronSpecifiekValue: {
          tender_hours_week: "32",
          uren_per_week: "32",
        },
      }),
      stored({ urenPerWeek: "0" })
    );
    expect(plan.status).toBe("would_patch");
    expect(plan.patches).toContainEqual({
      field: "uren_per_week",
      from: "0",
      to: "32",
    });
  });

  it("does not invent provincie/skills when draft leaves them absent", () => {
    const plan = planRenormalisePatch(
      draft({ bronSpecifiekValue: {} }),
      stored({
        bronSpecifiek: { employment_type: "CONTRACTOR" },
      })
    );
    expect(plan.patches.map((patch) => patch.field)).toEqual([
      "employment_type",
    ]);
  });

  it("fills provincie/skills only when draft has concrete values", () => {
    const plan = planRenormalisePatch(
      draft({
        bronSpecifiekValue: {
          provincie: "Noord-Holland",
          skills: ["Privacy"],
        },
      }),
      stored({ bronSpecifiek: {} })
    );
    expect(plan.patches).toEqual([
      { field: "provincie", from: null, to: "Noord-Holland" },
      { field: "skills", from: null, to: ["Privacy"] },
    ]);
  });
});

describe("applyPlanToBronSpecifiek", () => {
  it("drops employment_type and overlays provincie", () => {
    expect(
      applyPlanToBronSpecifiek(
        { employment_type: "CONTRACTOR", other: "keep" },
        [
          { field: "employment_type", from: "CONTRACTOR", to: null },
          { field: "provincie", from: null, to: "Utrecht" },
        ]
      )
    ).toEqual({ other: "keep", provincie: "Utrecht" });
  });
});
