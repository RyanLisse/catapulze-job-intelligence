import { describe, expect, it } from "bun:test";

import { listMissingEnrichmentFields } from "./incomplete";

const parts = {
  externalId: "abc-123",
  platform: "flextender",
  title: "Senior Java Developer",
} as const;

describe("incomplete enrichment beschrijving", () => {
  it("marks only the exact title fallback as incomplete", () => {
    expect(
      listMissingEnrichmentFields({
        beschrijving: "Senior Java Developer (flextender/abc-123)",
        bronSpecifiek: {},
        locatieTekst: "Utrecht",
        tariefEenheid: "uur",
        tariefMax: "100",
        tariefMin: "90",
        titleFallbackParts: parts,
      })
    ).toContain("beschrijving");
    expect(
      listMissingEnrichmentFields({
        beschrijving: "A short but real description.",
        bronSpecifiek: {},
        locatieTekst: "Utrecht",
        tariefEenheid: "uur",
        tariefMax: "100",
        tariefMin: "90",
        titleFallbackParts: parts,
      })
    ).not.toContain("beschrijving");
  });
});
