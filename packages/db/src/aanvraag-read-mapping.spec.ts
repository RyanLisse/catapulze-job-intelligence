import { describe, expect, it } from "bun:test";

import { readAanvraagBronFacts } from "./aanvraag-read-mapping";

describe("readAanvraagBronFacts", () => {
  it("preserves the publication formats and workform emitted by known normalisers", () => {
    expect(
      readAanvraagBronFacts({
        publicatiedatum: "2026-08-26T04:34:00+02:00",
      }).publicatiedatum
    ).toBe("2026-08-26T04:34:00+02:00");
    expect(
      readAanvraagBronFacts({
        gepubliceerd_op: "2026-09-03T11:46:00",
      }).publicatiedatum
    ).toBe("2026-09-03T11:46:00");
    expect(readAanvraagBronFacts({ werkvorm: "remote" }).werkvorm).toBe(
      "remote"
    );
    expect(
      readAanvraagBronFacts({ opdrachtgeverNaam: "Gemeente Amsterdam" })
        .opdrachtgeverNaam
    ).toBe("Gemeente Amsterdam");
  });

  it("reads the contract_type shape emitted by Opdrachtoverheid", () => {
    expect(
      readAanvraagBronFacts({ contract_type: "detachering" })
    ).toMatchObject({
      contracttype: "detachering",
    });
  });

  it("keeps valid facts when sibling optional fields are malformed", () => {
    expect(
      readAanvraagBronFacts({
        contract_type: "detachering",
        opdrachtgeverNaam: 42,
        publicatiedatum: "bad",
        werkvorm: " ",
      })
    ).toEqual({
      contracttype: "detachering",
      opdrachtgeverNaam: null,
      publicatiedatum: null,
      werkvorm: null,
    });
  });

  it("returns null for absent, blank, malformed, or unrelated source fields", () => {
    for (const bronSpecifiek of [
      null,
      {},
      { gepubliceerd_op: "" },
      { publicatiedatum: "not-a-date" },
      { publicatiedatum: "2026-02-31T10:00:00Z" },
      { time_published: 1_785_448_800 },
      { werkvorm: " " },
    ]) {
      const facts = readAanvraagBronFacts(bronSpecifiek);
      expect(facts.publicatiedatum).toBeNull();
      expect(facts.werkvorm).toBeNull();
    }
  });
});
