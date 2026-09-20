import { describe, expect, it } from "bun:test";

import { loadConnectorFixture } from "@ji/connectors";
import { UNKNOWN } from "@ji/domain";

import { extractStarapplePageFacts } from "./starapple-page";

/**
 * The recorded live page the CTP-514 audit compared against
 * (fixtures/connectors/starapple/detail-devops-platform-engineer.json —
 * mechanically trimmed: scripts/styles/nav/footer/contact links stripped,
 * no markup retyped, no PII kept).
 */
const loadDevopsPage = async (): Promise<string> => {
  const fixture = await loadConnectorFixture<string>(
    "starapple/detail-devops-platform-engineer.json"
  );
  return fixture.payload;
};

describe("extractStarapplePageFacts on the recorded DevOps Platform Engineer page", () => {
  it("maps F03 locatie from the page's own location block", async () => {
    const facts = extractStarapplePageFacts(await loadDevopsPage());
    expect(facts.locatieTekst).toBe("Utrecht");
  });

  it("maps F08 uren from the page's own meta block", async () => {
    const facts = extractStarapplePageFacts(await loadDevopsPage());
    expect(facts.urenPerWeek).toBe("40");
  });

  it("maps the published salary band with its stated eenheid", async () => {
    const facts = extractStarapplePageFacts(await loadDevopsPage());
    expect(facts.tarief).toEqual({
      eenheid: "maand",
      max: "5767",
      min: "3661",
      valuta: "EUR",
    });
  });

  it("does not mine F02 eindklant out of vacancy prose", async () => {
    // The page names the end client only in prose ("Digitaal Politie
    // Contact (DPC)", "binnen de politie"). That is GAP_ENRICH territory,
    // not a deterministic map — the extractor stays honest-null.
    const facts = extractStarapplePageFacts(await loadDevopsPage());
    expect(facts.eindklant).toBeNull();
  });

  it("reports F18 contact presence as a boolean without exposing PII", async () => {
    const facts = extractStarapplePageFacts(await loadDevopsPage());
    expect(facts.contactPublished).toBe(true);
    // POLICY_DROP: the boolean is all that leaves the extractor — no name,
    // mailto or tel value is part of the facts shape.
    expect(JSON.stringify(facts)).not.toMatch(/mailto:|tel:|@/u);
  });

  it("keeps the committed fixture free of recruiter PII", async () => {
    const html = await loadDevopsPage();
    expect(html).not.toMatch(/mailto:/iu);
    expect(html).not.toMatch(/tel:/iu);
  });
});

describe("extractStarapplePageFacts edge cases", () => {
  it("reads a labeled eindklant when a page publishes one", () => {
    const facts = extractStarapplePageFacts(
      "<h1>Rol</h1><div>Stad</div><p>Eindklant: Gemeente Voorbeeld</p>"
    );
    expect(facts.eindklant).toBe("Gemeente Voorbeeld");
  });

  it("rejects labeled eindklant non-values", () => {
    for (const label of ["n.v.t.", "vertrouwelijk", "anoniem", "in overleg"]) {
      expect(
        extractStarapplePageFacts(`<p>Eindklant: ${label}</p>`).eindklant
      ).toBeNull();
    }
  });

  it("marks tarief eenheid UNKNOWN when the page never names one", async () => {
    const html = await loadDevopsPage();
    // Strip every "salaris" mention (the meta band survives), leaving no
    // published eenheid to read — the extractor must not guess "maand".
    const facts = extractStarapplePageFacts(
      html.replaceAll(/salaris/giu, "bedrag")
    );
    expect(facts.tarief?.eenheid).toBe(UNKNOWN);
  });

  it("reads eenheid uur from the €-band clause even with salaris prose elsewhere", () => {
    // The hourly case the previous full-text scan got wrong: "per uur"
    // describes the € band while "salaris" sits in a €-less benefits clause
    // — the cue must come from the clause carrying the amount.
    const facts = extractStarapplePageFacts(
      '<h1>Rol</h1><div>Stad</div><div class="vacancy-meta"><span>40 uur</span><span>&euro; 75 - 95 per uur</span></div><p>Het salaris en de secundaire voorwaarden stem je af met de opdrachtgever.</p>'
    );
    expect(facts.tarief).toEqual({
      eenheid: "uur",
      max: "95",
      min: "75",
      valuta: "EUR",
    });
  });

  it("keeps eenheid UNKNOWN when €-clauses carry conflicting cues", () => {
    // An hourly band quoted next to a monthly equivalent cannot be told
    // apart — UNKNOWN is honest, picking one order of keywords is not.
    const facts = extractStarapplePageFacts(
      '<div class="vacancy-meta"><span>&euro; 75 - 95 per uur</span></div><p>Omgerekend een bruto maandsalaris van &euro; 13.000.</p>'
    );
    expect(facts.tarief?.eenheid).toBe(UNKNOWN);
  });

  it("does not let a bare unit word in €-less prose claim the band", () => {
    // The mirror of the audited page: the meta band carries no cue and the
    // only "salaris" sits in a clause without any amount — UNKNOWN, not
    // "maand".
    const facts = extractStarapplePageFacts(
      '<div class="vacancy-meta"><span>&euro; 3.000 - 4.000</span></div><p>Een aantrekkelijk aanbod. Het salaris is marktconform.</p>'
    );
    expect(facts.tarief?.eenheid).toBe(UNKNOWN);
  });

  it("decays out-of-range numeric entities instead of throwing", () => {
    // Sloppy live markup can name code points outside Unicode; the decoder
    // must not let `String.fromCodePoint`'s RangeError kill extraction.
    const facts = extractStarapplePageFacts(
      '<div class="vacancy-meta"><span>40 uur</span></div><p>Salaris &#99999999; en &#x110000; marktconform.</p>'
    );
    expect(facts.urenPerWeek).toBe("40");
    expect(facts.tarief).toBeNull();
  });

  it("returns nulls on markup without the vacancy blocks", () => {
    const facts = extractStarapplePageFacts("<html><body>leeg</body></html>");
    expect(facts).toEqual({
      contactPublished: false,
      eindklant: null,
      locatieTekst: null,
      tarief: null,
      urenPerWeek: null,
    });
  });
});
