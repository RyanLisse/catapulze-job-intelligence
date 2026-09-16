import { describe, expect, it } from "bun:test";

import { normaliseJsonLdObservation } from "../../../application/src/normalise/json-ld";
import { createJsonLdClient } from "./client";
import { rijkswaterstaatConfig } from "./configs/rijkswaterstaat";

const client = createJsonLdClient({
  config: rijkswaterstaatConfig,
  liveEnabled: false,
});

describe("Rijkswaterstaat JSON-LD connector", () => {
  it("keeps only the three recorded vacancy detail URLs", async () => {
    expect(await client.fetchListing()).toEqual([
      {
        lastmod: "2026-09-09",
        url: "https://werkenbij.rijkswaterstaat.nl/vacatures/adviseur-assetmanagement-rivierbodem/1330716",
      },
      {
        lastmod: "2026-07-27",
        url: "https://werkenbij.rijkswaterstaat.nl/vacatures/adviseur-waterveiligheid/1310882",
      },
      {
        lastmod: "2026-09-07",
        url: "https://werkenbij.rijkswaterstaat.nl/vacatures/jurist-handhaving/1318820",
      },
    ]);
  });

  it("normalises the recorded direct-employer detail without inventing a deadline", async () => {
    const url =
      "https://werkenbij.rijkswaterstaat.nl/vacatures/adviseur-assetmanagement-rivierbodem/1330716";
    const detail = await client.fetchDetail(url);
    const draft = normaliseJsonLdObservation(
      new TextEncoder().encode(
        JSON.stringify({
          ...detail,
          parserVersion: "rijkswaterstaat/v1",
          slug: "rijkswaterstaat",
        })
      ),
      "sha256-test"
    );
    expect(draft.titel.value).toBe("Adviseur assetmanagement rivierbodem");
    expect(draft.opdrachtgeverNaam.value).toBe("DG Rijkswaterstaat");
    expect(draft.locatieTekst.value).toBe("Roermond");
    expect(draft.bronSpecifiek.value).toMatchObject({
      identifier: { name: "Rijkswaterstaat", value: "1330716-NL-1160" },
      publicatiedatum: "2026-09-10T11:45:23Z",
    });
    expect(draft.sluitingsdatum).toBeUndefined();
    expect(draft.tarief).toEqual({
      eenheid: "maand",
      max: "6275",
      min: "4132",
      valuta: "EUR",
    });
  });
});
