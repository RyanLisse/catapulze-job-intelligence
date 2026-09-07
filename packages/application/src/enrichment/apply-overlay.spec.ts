import { describe, expect, it } from "bun:test";

import {
  applyEnrichmentOverlayToAanvraagFacts,
  applyEnrichmentOverlayToSearchFacts,
  toEnrichedFieldMeta,
} from "./apply-overlay";
import type { EnrichmentOverlayRow } from "./apply-overlay";

const locatieRow: EnrichmentOverlayRow = {
  confidence: 0.9,
  field: "locatie",
  source: "deterministic",
  value: { locatieTekst: "Utrecht" },
};

const lowConfidence: EnrichmentOverlayRow = {
  confidence: 0.79,
  field: "locatie",
  source: "deterministic",
  value: { locatieTekst: "Den Haag" },
};

describe("enrichment overlay", () => {
  it("fills missing curated facts and exposes aangevuld metadata", () => {
    const overlaid = applyEnrichmentOverlayToAanvraagFacts(
      {
        contracttype: null,
        locatie: null,
        tariefEenheid: null,
        tariefMax: null,
        tariefMin: null,
        tariefValuta: null,
        werkvorm: null,
      },
      [
        locatieRow,
        {
          confidence: 0.92,
          field: "tarief",
          source: "deterministic",
          value: {
            eenheid: "uur",
            max: "110",
            min: "90",
            valuta: "EUR",
          },
        },
        {
          confidence: 0.91,
          field: "contract",
          source: "deterministic",
          value: { contracttype: "detachering" },
        },
        {
          confidence: 0.88,
          field: "remote",
          source: "deterministic",
          value: { werkvorm: "Hybride" },
        },
      ]
    );

    expect(overlaid.locatie).toBe("Utrecht");
    expect(overlaid.tariefMin).toBe(90);
    expect(overlaid.tariefMax).toBe(110);
    expect(overlaid.tariefEenheid).toBe("uur");
    expect(overlaid.tariefValuta).toBe("EUR");
    expect(overlaid.contracttype).toBe("detachering");
    expect(overlaid.werkvorm).toBe("Hybride");
    expect(
      overlaid.enrichedFields.map((entry) => entry.field).toSorted()
    ).toEqual(["contract", "locatie", "remote", "tarief"]);
  });

  it("does not overwrite curated values already published by the bron", () => {
    const overlaid = applyEnrichmentOverlayToAanvraagFacts(
      {
        contracttype: "interim",
        locatie: "Amsterdam",
        tariefEenheid: "uur",
        tariefMax: 100,
        tariefMin: 80,
        tariefValuta: "EUR",
        werkvorm: "Op locatie",
      },
      [locatieRow]
    );

    expect(overlaid.locatie).toBe("Amsterdam");
    expect(overlaid.enrichedFields).toEqual([
      { confidence: 0.9, field: "locatie", source: "deterministic" },
    ]);
  });

  it("keeps low-confidence rows out of aangevuld metadata", () => {
    expect(toEnrichedFieldMeta([lowConfidence])).toEqual([]);
  });

  it("overlays search documents for locatie/tarief/contract only", () => {
    const overlaid = applyEnrichmentOverlayToSearchFacts(
      {
        contracttype: null,
        locatie: null,
        tariefMax: null,
        tariefMin: null,
      },
      [
        locatieRow,
        {
          confidence: 0.9,
          field: "tarief",
          source: "deterministic",
          value: {
            eenheid: "uur",
            max: "120",
            min: "unknown",
            valuta: "EUR",
          },
        },
      ]
    );

    expect(overlaid.locatie).toBe("Utrecht");
    expect(overlaid.tariefMin).toBeNull();
    expect(overlaid.tariefMax).toBe(120);
  });
});
