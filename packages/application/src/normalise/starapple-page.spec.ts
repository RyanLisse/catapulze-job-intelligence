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
