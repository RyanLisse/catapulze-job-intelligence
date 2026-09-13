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
  it("defaults the limit and leaves bron unset", () => {
    expect(parseArguments([])).toEqual({ bron: undefined, limit: 500 });
  });

  it("reads an explicit limit and bron", () => {
    expect(parseArguments(["--limit=25", "--bron=striive"])).toEqual({
      bron: "striive",
      limit: 25,
    });
  });

  it("rejects an out-of-range limit and unknown flags", () => {
    expect(() => parseArguments(["--limit=0"])).toThrow();
    expect(() => parseArguments(["--limit=5001"])).toThrow();
    expect(() => parseArguments(["--apply"])).toThrow();
  });
});

describe("buildReport", () => {
  it("reports the matched phrase for an excluded row", () => {
    const report = buildReport([row()], 500);
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
    const report = buildReport(
      [row({ beschrijving: "ZZP mogelijk, tarief in overleg." })],
      500
    );
    expect(report.mislabelled).toBe(0);
    expect(report.scanned).toBe(1);
    expect(report.candidates).toEqual([]);
  });

  it("counts per bron", () => {
    const report = buildReport(
      [
        row({ id: "a" }),
        row({ bronNaam: "striive", id: "b" }),
        row({ bronNaam: "striive", id: "c" }),
        row({ beschrijving: "ZZP mogelijk.", bronNaam: "striive", id: "d" }),
      ],
      500
    );
    expect(report.byBron).toEqual({ inhuurdesk: 1, striive: 2 });
    expect(report.mislabelled).toBe(3);
    expect(report.scanned).toBe(4);
  });

  it("flags a truncated scan when the limit is reached", () => {
    expect(buildReport([row()], 1).truncated).toBe(true);
    expect(buildReport([row()], 500).truncated).toBe(false);
  });
});
