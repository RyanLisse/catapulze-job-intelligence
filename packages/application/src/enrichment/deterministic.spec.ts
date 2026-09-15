import { describe, expect, it } from "bun:test";

import { extractDeterministicEnrichment } from "./deterministic";

describe("deterministic enrichment", () => {
  it("extracts labeled locatie from collapsed HTML text", () => {
    const proposals = extractDeterministicEnrichment({
      beschrijving:
        "<p>Locatie:</p> <strong>Utrecht</strong> <p>Tarief: onbekend</p>",
      fields: ["locatie"],
    });

    expect(proposals).toEqual([
      expect.objectContaining({
        confidence: 0.9,
        field: "locatie",
        source: "deterministic",
        value: { locatieTekst: "Utrecht" },
      }),
    ]);
  });

  it("extracts tarief from euro range text without inventing amounts", () => {
    const proposals = extractDeterministicEnrichment({
      beschrijving: "Max tarief €110 per uur voor deze opdracht.",
      fields: ["tarief"],
    });

    expect(proposals).toEqual([
      expect.objectContaining({
        field: "tarief",
        value: {
          eenheid: "uur",
          max: "110",
          min: "unknown",
          valuta: "EUR",
        },
      }),
    ]);
  });

  it("does not invent tarief when only the word tarief appears without amounts", () => {
    const proposals = extractDeterministicEnrichment({
      beschrijving: "Tarief in overleg.",
      fields: ["tarief"],
    });

    expect(proposals).toEqual([]);
  });

  it("extracts contract and remote labels from plain text", () => {
    const proposals = extractDeterministicEnrichment({
      beschrijving:
        "Contractvorm: detachering\nWerkvorm: Volledig remote\nLocatie: Amsterdam",
      fields: ["contract", "remote", "locatie"],
    });

    expect(proposals.map((proposal) => proposal.field).toSorted()).toEqual([
      "contract",
      "locatie",
      "remote",
    ]);
    expect(
      proposals.find((proposal) => proposal.field === "contract")?.value
    ).toEqual({ contracttype: "detachering" });
    expect(
      proposals.find((proposal) => proposal.field === "remote")?.value
    ).toEqual({ werkvorm: "Volledig remote" });
  });
});

const NVB_JOBPOSTING_HTML = `<html><head>
<script type="application/ld+json">
{"@context":"https://schema.org/","@type":"JobPosting","datePosted":"2026-08-10T22:00:00Z","title":"Adviseur"}
</script>
</head><body>35 dagen geleden</body></html>`;

describe("deterministic publicatiedatum enrich", () => {
  it("fills publicatiedatum from JobPosting datePosted in rawHtml", () => {
    const proposals = extractDeterministicEnrichment({
      beschrijving: "35 dagen geleden",
      fields: ["publicatiedatum"],
      rawHtml: NVB_JOBPOSTING_HTML,
    });

    expect(proposals).toEqual([
      expect.objectContaining({
        confidence: 0.95,
        field: "publicatiedatum",
        source: "deterministic",
        value: { publicatiedatum: "2026-08-10T22:00:00Z" },
      }),
    ]);
  });

  it("does not invent publicatiedatum from relative age text alone", () => {
    const proposals = extractDeterministicEnrichment({
      beschrijving: "Gepubliceerd: 35 dagen geleden",
      fields: ["publicatiedatum"],
      rawHtml: "<html><body>35 dagen geleden</body></html>",
    });

    expect(proposals).toEqual([]);
  });
});
