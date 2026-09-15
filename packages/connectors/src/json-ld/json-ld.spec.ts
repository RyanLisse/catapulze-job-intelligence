import { describe, expect, it } from "bun:test";

import {
  CrawlDelayLimiter,
  InMemoryObjectStore,
  InMemoryObservationRecorder,
  InMemoryRunLifecycleStore,
  runConnector,
} from "@ji/connectors";

import {
  createJsonLdClient,
  extractListingLinks,
  extractSitemapUrls,
} from "./client";
import { bluetrailConfig } from "./configs/bluetrail";
import { heroConfig } from "./configs/hero";
import { proActConfig } from "./configs/pro-act";
import { createJsonLdConnector, urlSlugBronReferentie } from "./connector";
import {
  extractJobPosting,
  extractJsonLdNodes,
  extractLabelBlock,
  pickJobPosting,
} from "./extract";
import type { JsonLdConnectorConfig } from "./types";

const retryPolicy = {
  initialDelayMs: 0,
  jitter: (delayMs: number) => delayMs,
  maxAttempts: 1,
  maxDelayMs: 0,
  multiplier: 1,
};

describe("extractJsonLdNodes / pickJobPosting", () => {
  it("expands @graph wrappers and finds the JobPosting among sibling nodes", () => {
    const html = `<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"WebPage","name":"x"},{"@type":"Organization","name":"y"}]}</script><script type="application/ld+json">{"@type":"JobPosting","title":"Tester"}</script>`;
    const nodes = extractJsonLdNodes(html);
    expect(nodes).toHaveLength(3);
    expect(pickJobPosting(nodes)).toMatchObject({ title: "Tester" });
  });

  it("recognises a JobPosting inside an @type array", () => {
    const nodes = extractJsonLdNodes(
      '<script type="application/ld+json">{"@type":["JobPosting","Thing"],"title":"Multi"}</script>'
    );
    expect(pickJobPosting(nodes)?.title).toBe("Multi");
  });

  it("tolerates malformed JSON-LD blocks instead of throwing", () => {
    const html =
      '<script type="application/ld+json">{not valid json</script><script type="application/ld+json">{"@type":"JobPosting","title":"Ok"}</script>';
    expect(extractJobPosting(html)).toMatchObject({ title: "Ok" });
  });

  it("returns null when no JobPosting node is present", () => {
    const html =
      '<script type="application/ld+json">{"@type":"Organization","name":"x"}</script>';
    expect(extractJobPosting(html)).toBeNull();
  });
});

describe("extractLabelBlock", () => {
  it("extracts fields from surrounding HTML by default", () => {
    const html =
      "<span><b>Startdatum</b>1 september 2026</span><span><b>Einddatum</b>31 december 2026</span>";
    const result = extractLabelBlock(html, null, {
      eindDatum: { pattern: /<b>Einddatum<\/b>(?<value>[^<]+)/u },
      startDatum: { pattern: /<b>Startdatum<\/b>(?<value>[^<]+)/u },
    });
    expect(result).toEqual({
      eindDatum: "31 december 2026",
      startDatum: "1 september 2026",
    });
  });

  it("extracts fields from the JobPosting description when source is 'description'", () => {
    const jobPosting = {
      "@type": "JobPosting",
      description: "Start: 1 oktober 2026\tEind: 30 juni 2027",
    };
    const result = extractLabelBlock("<html></html>", jobPosting, {
      eindDatum: {
        pattern: /Eind:\s*(?<value>[^<\t]+)/u,
        source: "description",
      },
      startDatum: {
        pattern: /Start:\s*(?<value>[^<\t]+)/u,
        source: "description",
      },
    });
    expect(result).toEqual({
      eindDatum: "30 juni 2027",
      startDatum: "1 oktober 2026",
    });
  });

  it("omits fields whose pattern does not match", () => {
    expect(extractLabelBlock("<html></html>", null)).toEqual({});
    expect(
      extractLabelBlock("<html></html>", null, {
        startDatum: { pattern: /<b>Startdatum<\/b>(?<value>[^<]+)/u },
      })
    ).toEqual({});
  });
});

describe("Pro-Act eindklant label pattern (guards against promoting prose, codex review)", () => {
  const eindklantField = proActConfig.labelBlock?.eindklant;
  if (!eindklantField) {
    throw new Error("expected proActConfig.labelBlock.eindklant to exist");
  }

  const extractEindklant = (description: string): string | undefined =>
    extractLabelBlock(
      "<html></html>",
      { "@type": "JobPosting", description },
      { eindklant: eindklantField }
    ).eindklant;

  it("reads 'eindklant, <Naam>,' phrasing (detail-1 fixture text)", () => {
    expect(
      extractEindklant(
        "Voor onze directe eindklant, Tweede Kamer der Staten-Generaal, zoeken wij"
      )
    ).toBe("Tweede Kamer der Staten-Generaal");
  });

  it("reads 'eindklant de <Naam>,' phrasing (detail-2 fixture text)", () => {
    expect(
      extractEindklant("eindklant de Algemene Rekenkamer, gevestigd")
    ).toBe("Algemene Rekenkamer");
  });

  it("does not promote a lowercase sentence continuation with no real name", () => {
    expect(
      extractEindklant(
        "Voor onze eindklant zoeken wij een senior developer, die"
      )
    ).toBeUndefined();
  });

  it("does not promote a lowercase common-noun phrase ('een grote gemeente')", () => {
    expect(
      extractEindklant("eindklant, een grote gemeente, zoeken")
    ).toBeUndefined();
  });

  it("does not promote a digit-led phrase ('1 van de grootste banken van Nederland', advisor review)", () => {
    expect(
      extractEindklant(
        "eindklant, 1 van de grootste banken van Nederland, zoekt"
      )
    ).toBeUndefined();
  });
});

describe("extractSitemapUrls", () => {
  it("parses <url> entries with and without lastmod, decoding XML entities", () => {
    const xml =
      "<urlset><url><loc>https://example.test/a/?x=1&amp;y=2</loc><lastmod>2026-08-01</lastmod></url><url><loc>https://example.test/b/</loc></url></urlset>";
    expect(extractSitemapUrls(xml)).toEqual([
      { lastmod: "2026-08-01", url: "https://example.test/a/?x=1&y=2" },
      { url: "https://example.test/b/" },
    ]);
  });
});

describe("extractListingLinks", () => {
  it("resolves relative hrefs against baseUrl, matches linkPattern, and dedupes", () => {
    const html =
      '<a href="/interim-opdrachten/a">A</a><a href="/interim-opdrachten/a">A again</a><a href="/interim-opdrachten">listing</a><a href="/api/x">skip</a>';
    const urls = extractListingLinks(
      html,
      /^\/interim-opdrachten\/[a-z0-9-]+$/u,
      "https://hero.eu"
    );
    expect(urls).toEqual([{ url: "https://hero.eu/interim-opdrachten/a" }]);
  });

  it("also discovers absolute hrefs, matching the pattern against the resolved pathname", () => {
    const html =
      '<a href="https://hero.eu/interim-opdrachten/b">B absolute</a><a href="/interim-opdrachten/b">B relative</a>';
    const urls = extractListingLinks(
      html,
      /^\/interim-opdrachten\/[a-z0-9-]+$/u,
      "https://hero.eu"
    );
    expect(urls).toEqual([{ url: "https://hero.eu/interim-opdrachten/b" }]);
  });
});

describe("urlSlugBronReferentie", () => {
  it("strips leading/trailing slashes and decodes the path", () => {
    expect(
      urlSlugBronReferentie(
        "https://www.bluetrail.nl/opdrachten/Interim/ciam-tester/"
      )
    ).toBe("opdrachten/Interim/ciam-tester");
    expect(
      urlSlugBronReferentie(
        "https://hero.eu/interim-opdrachten/devops-engineer-1f2fde9f"
      )
    ).toBe("interim-opdrachten/devops-engineer-1f2fde9f");
  });
});

const runFixtureIngest = (config: JsonLdConnectorConfig, bronId: string) =>
  runConnector({
    bronId,
    bronSlug: config.slug,
    checkpoint: null,
    connector: createJsonLdConnector({
      bronId,
      client: createJsonLdClient({ config, liveEnabled: false }),
      config,
    }),
    limiter: new CrawlDelayLimiter({ crawlDelayMs: 0 }),
    objectStore: new InMemoryObjectStore(),
    observationRecorder: new InMemoryObservationRecorder(),
    rawRetentionDays: 90,
    retryPolicy,
    runKind: "test",
    runLifecycleStore: new InMemoryRunLifecycleStore(),
    scrapeRunId: `run-${config.slug}-1`,
    startedAt: new Date("2026-08-31T10:30:00.000Z"),
  });

describe.each([
  ["bluetrail", bluetrailConfig],
  ["hero", heroConfig],
  ["pro-act", proActConfig],
])("%s JSON-LD connector", (slug, config) => {
  // BlueTrail's listing fixture carries a 3rd sitemap entry
  // (adviseur-privacy-ibd, added 2026-09-15 to make the live-captured F15
  // skills fixture reachable from the fixture-mode ingest pipeline).
  const expectedItemCount = slug === "bluetrail" ? 3 : 2;

  it("ingests listing + detail fixtures with found/new/changed/rejected/error metrics", async () => {
    const result = await runFixtureIngest(config, `bron-${slug}-fixture`);
    expect(result.metrics).toMatchObject({
      changed: 0,
      error: 0,
      found: expectedItemCount,
      new: expectedItemCount,
      rejected: 0,
    });
  });

  it("replays fixture ingest without duplicate source records", async () => {
    const bronId = `bron-${slug}-replay`;
    const recorder = new InMemoryObservationRecorder();
    const objectStore = new InMemoryObjectStore();
    const connector = createJsonLdConnector({
      bronId,
      client: createJsonLdClient({ config, liveEnabled: false }),
      config,
    });
    const sharedInput = {
      bronId,
      bronSlug: config.slug,
      checkpoint: null,
      connector,
      limiter: new CrawlDelayLimiter({ crawlDelayMs: 0 }),
      objectStore,
      observationRecorder: recorder,
      rawRetentionDays: 90,
      retryPolicy,
      runKind: "test" as const,
      runLifecycleStore: new InMemoryRunLifecycleStore(),
    };

    await runConnector({ ...sharedInput, scrapeRunId: `run-${slug}-replay-1` });
    await runConnector({ ...sharedInput, scrapeRunId: `run-${slug}-replay-2` });

    expect(recorder.records).toHaveLength(expectedItemCount);
    expect(
      new Set(recorder.records.map((record) => record.bronReferentie)).size
    ).toBe(expectedItemCount);
  });

  it("reports a single, non-paginated discovery pass (hasMore: false)", async () => {
    const bronId = `bron-${slug}-window`;
    const connector = createJsonLdConnector({
      bronId,
      client: createJsonLdClient({ config, liveEnabled: false }),
      config,
    });
    const result = await connector.discover(null);
    expect(result.hasMore).toBe(false);
    expect(result.items).toHaveLength(expectedItemCount);
  });
});

describe("BlueTrail excludePatterns", () => {
  it("does not exclude a real vacancy slug that happens to start with 'or-'", async () => {
    const sitemapXml =
      "<urlset>" +
      "<url><loc>https://www.bluetrail.nl/opdrachten/</loc></url>" +
      "<url><loc>https://www.bluetrail.nl/opdrachten/?order=asc</loc></url>" +
      "<url><loc>https://www.bluetrail.nl/opdrachten/?_sft_categorie=interim</loc></url>" +
      "<url><loc>https://www.bluetrail.nl/opdrachten/Interim/or-adviseur/</loc></url>" +
      "</urlset>";
    const mockFetch: typeof fetch = Object.assign(
      () => Promise.resolve(new Response(sitemapXml, { status: 200 })),
      { preconnect: () => {} }
    );
    const client = createJsonLdClient({
      config: bluetrailConfig,
      fetchImpl: mockFetch,
      liveEnabled: true,
    });

    const urls = await client.fetchListing();

    expect(urls).toEqual([
      { url: "https://www.bluetrail.nl/opdrachten/Interim/or-adviseur/" },
    ]);
  });
});

describe("BlueTrail label-block extraction", () => {
  it("reads Startdatum/Einddatum/Uren per week/Sluitingsdatum from the sidebar table", async () => {
    const bronId = "bron-bluetrail-labels";
    const connector = createJsonLdConnector({
      bronId,
      client: createJsonLdClient({
        config: bluetrailConfig,
        liveEnabled: false,
      }),
      config: bluetrailConfig,
    });
    const discovered = await connector.discover(null);
    const item = discovered.items.find((entry) =>
      entry.bronReferentie.includes("ciam-tester")
    );
    if (!item) {
      throw new Error("expected a ciam-tester discover item");
    }
    const fetched = await connector.fetch(item);
    if (!fetched || fetched.status !== "fetched") {
      throw new Error("expected a fetched result");
    }
    // SAFETY: connector.fetch() serialises a JsonLdFetchedPayload as JSON body above.
    const payload = JSON.parse(new TextDecoder().decode(fetched.body)) as {
      labelBlock: Record<string, string>;
    };
    expect(payload.labelBlock).toMatchObject({
      eindDatum: "31 december 2026",
      locatie: "Apeldoorn",
      referentienummer: "2026-08243",
      sluitingsDatum: "2 september 2026",
      startDatum: "1 september 2026",
      urenPerWeek: "32u p/w",
    });
  });

  it("reads the 'Competenties:' list from a live 2026-09-15 capture (F15)", async () => {
    const client = createJsonLdClient({
      config: bluetrailConfig,
      liveEnabled: false,
    });
    const detail = await client.fetchDetail(
      "https://www.bluetrail.nl/opdrachten/Interim/adviseur-privacy-ibd/"
    );
    expect(detail.labelBlock.competenties).toContain(
      "Analytisch &amp; conceptueel sterk"
    );
    expect(detail.labelBlock.competenties).toContain(
      "Sterke schrijfvaardigheid"
    );
    // The raw captured block must NOT swallow the following "Eisen"/"Wensen"
    // sentences -- only the Competenties <ul> itself.
    expect(detail.labelBlock.competenties).not.toContain("afgeronde hbo");
  });
});

describe("Pro-Act label-block extraction from JobPosting description", () => {
  it("reads Start/Eind/Inzet/Tarief/Locatie out of the description text", async () => {
    const bronId = "bron-proact-labels";
    const connector = createJsonLdConnector({
      bronId,
      client: createJsonLdClient({ config: proActConfig, liveEnabled: false }),
      config: proActConfig,
    });
    const discovered = await connector.discover(null);
    const item = discovered.items.find((entry) =>
      entry.bronReferentie.includes("senior-azure-operations-engineer")
    );
    if (!item) {
      throw new Error("expected a senior-azure-operations-engineer item");
    }
    const fetched = await connector.fetch(item);
    if (!fetched || fetched.status !== "fetched") {
      throw new Error("expected a fetched result");
    }
    // SAFETY: connector.fetch() serialises a JsonLdFetchedPayload as JSON body above.
    const payload = JSON.parse(new TextDecoder().decode(fetched.body)) as {
      labelBlock: Record<string, string>;
    };
    expect(payload.labelBlock).toMatchObject({
      eindDatum: "30 juni 2027",
      eindklant: "Tweede Kamer der Staten-Generaal",
      locatie: "hybride",
      startDatum: "1 oktober 2026",
      tarief: "marktconform",
      urenPerWeek: "36 uur per week",
    });
  });

  it("reads the eindklant label from the 'eindklant de <naam>,' phrasing too (detail-2 fixture)", async () => {
    const bronId = "bron-proact-eindklant-2";
    const connector = createJsonLdConnector({
      bronId,
      client: createJsonLdClient({ config: proActConfig, liveEnabled: false }),
      config: proActConfig,
    });
    const discovered = await connector.discover(null);
    const item = discovered.items.find((entry) =>
      entry.bronReferentie.includes("iso-8783")
    );
    if (!item) {
      throw new Error("expected an iso-8783 item");
    }
    const fetched = await connector.fetch(item);
    if (!fetched || fetched.status !== "fetched") {
      throw new Error("expected a fetched result");
    }
    // SAFETY: connector.fetch() serialises a JsonLdFetchedPayload as JSON body above.
    const payload = JSON.parse(new TextDecoder().decode(fetched.body)) as {
      labelBlock: Record<string, string>;
    };
    expect(payload.labelBlock).toMatchObject({
      eindklant: "Algemene Rekenkamer",
    });
  });
});

describe("rejected fetch paths", () => {
  it("rejects when listing payload is missing a url", async () => {
    const bronId = "bron-bluetrail-missing-url";
    const connector = createJsonLdConnector({
      bronId,
      client: createJsonLdClient({
        config: bluetrailConfig,
        liveEnabled: false,
      }),
      config: bluetrailConfig,
    });
    const fetched = await connector.fetch({
      bronReferentie: "x",
      contentHash: "hash",
      listingPayload: {},
    });
    expect(fetched).toMatchObject({ status: "rejected" });
  });

  it("rejects when the detail page has no JobPosting JSON-LD", async () => {
    const bronId = "bron-no-jobposting";
    const noJobPostingClient = {
      fetchDetail: () =>
        Promise.resolve({
          jobPosting: null,
          labelBlock: {},
          url: "https://x.test/a",
        }),
      fetchListing: () => Promise.resolve([]),
    };
    const connectorWithNoJobPosting = createJsonLdConnector({
      bronId,
      client: noJobPostingClient,
      config: bluetrailConfig,
    });
    const fetched = await connectorWithNoJobPosting.fetch({
      bronReferentie: "a",
      contentHash: "hash",
      listingPayload: { url: "https://x.test/a" },
    });
    expect(fetched).toMatchObject({ status: "rejected" });
  });
});
