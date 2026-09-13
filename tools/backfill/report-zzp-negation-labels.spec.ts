import { describe, expect, it } from "bun:test";

import { buildReport, parseArguments } from "./report-zzp-negation-labels";
import type { CandidateRow } from "./report-zzp-negation-labels";

const row = (overrides: Partial<CandidateRow> = {}): CandidateRow => ({
  beschrijving: "Geen ZZP mogelijk.",
  bronNaam: "inhuurdesk",
  id: "11111111-1111-1111-1111-111111111111",
  titel: "Adviseur A",
  versie: 3,
  ...overrides,
});

describe("parseArguments", () => {
  it("leaves bron unset by default", () => {
    expect(parseArguments([])).toEqual({ bron: undefined });
  });

  it("reads an explicit bron", () => {
    expect(parseArguments(["--bron=striive"])).toEqual({ bron: "striive" });
  });

  it("rejects unknown flags", () => {
    expect(() => parseArguments(["--apply"])).toThrow();
    expect(() => parseArguments(["--limit=25"])).toThrow();
  });
});

describe("buildReport", () => {
  it("reports the matched phrase for an excluded row", () => {
    const report = buildReport([row()]);
    expect(report.mislabelled).toBe(1);
    expect(report.scanned).toBe(1);
    expect(report.candidates[0]).toEqual({
      bron: "inhuurdesk",
      id: "11111111-1111-1111-1111-111111111111",
      matchedPhrase: "Geen ZZP mogelijk",
      titel: "Adviseur A",
      versie: 3,
    });
  });

  it("keeps a genuinely freelance row out of the report", () => {
    const report = buildReport([
      row({ beschrijving: "ZZP mogelijk, tarief in overleg." }),
    ]);
    expect(report.mislabelled).toBe(0);
    expect(report.scanned).toBe(1);
    expect(report.candidates).toEqual([]);
  });

  it("counts per bron", () => {
    const report = buildReport([
      row({ id: "a" }),
      row({ bronNaam: "striive", id: "b" }),
      row({ bronNaam: "striive", id: "c" }),
      row({ beschrijving: "ZZP mogelijk.", bronNaam: "striive", id: "d" }),
    ]);
    expect(report.byBron).toEqual({ inhuurdesk: 1, striive: 2 });
    expect(report.mislabelled).toBe(3);
    expect(report.scanned).toBe(4);
  });

  it("reports an empty scan without candidates", () => {
    expect(buildReport([])).toEqual({
      byBron: {},
      candidates: [],
      mislabelled: 0,
      scanned: 0,
    });
  });
});
