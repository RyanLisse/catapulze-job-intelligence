import { describe, expect, it } from "bun:test";

import {
  CrawlDelayLimiter,
  InMemoryObjectStore,
  InMemoryObservationRecorder,
  InMemoryRunLifecycleStore,
  loadConnectorFixture,
  runConnector,
} from "@ji/connectors";

import {
  buildNeedstaffingRawHtml,
  createNeedstaffingClient,
  decodeNeedstaffingEntities,
  extractNeedstaffingId,
  extractNeedstaffingReferentie,
  parseNeedstaffingDetail,
  parseNeedstaffingListing,
  parseNeedstaffingTariefBand,
} from "./client";
import type { NeedstaffingClient } from "./client";
import { createNeedstaffingConnector } from "./connector";
import { hashNeedstaffingListingItem } from "./hash";
import type { NeedstaffingListingItem } from "./types";
import { NEEDSTAFFING_MAX_LISTING_PAGES } from "./types";

const retryPolicy = {
  initialDelayMs: 0,
  jitter: (delayMs: number) => delayMs,
  maxAttempts: 1,
  maxDelayMs: 0,
  multiplier: 1,
};

const LISTING_HTML = `
<div class="vacancies-overview-item">
  <a href="/Opdrachten/15521">
    <div class="vacancies-overview-item-card">
      <div class="vacancies-overview-item-logo">
        <img src="logo.png" alt="Belastingdienst">
      </div>
      <div class="vacancies-overview-item-summary">
        <div><h2>Senior Scrummaster 2026-IBS-0370B</h2></div>
      </div>
      <div class="vacancies-overview-item-information">
        <div class="vacancies-overview-item-information-item">
          <img src="location.svg" alt="Locatie"><p>Apeldoorn</p>
        </div>
        <div class="vacancies-overview-item-information-item">
          <p>Genegeerde tekst zonder icoon</p>
        </div>
        <div class="vacancies-overview-item-information-item">
          <img src="duration.svg" alt="Verwacht aantal uren per week"><p>36</p>
        </div>
        <div class="vacancies-overview-item-information-item">
          <img src="money.svg" alt="Verwachte compensatie"><p>&#x20AC;95,00 - &#x20AC;100,00</p>
        </div>
        <div class="vacancies-overview-item-information-item">
          <img src="start.svg" alt="Verwachte startdatum"><p><span data-date-utc="1790553600000">28-09-2026</span></p>
        </div>
        <div class="vacancies-overview-item-information-item">
          <img src="deadline.svg" alt="Deadline voor reageren"><p><span data-date-utc="1788876000000">08-09-2026</span> <span data-time-utc="1788876000000">14:00</span></p>
        </div>
      </div>
    </div>
  </a>
</div>
<div class="vacancies-overview-item">
  <a href="/Opdrachten/15520">
    <div class="vacancies-overview-item-card">
      <div class="vacancies-overview-item-logo">
        <img src="logo.png" alt="Belastingdienst">
      </div>
      <div class="vacancies-overview-item-summary">
        <div><h2>Operationeel Database Ontwikkelaar 2026-BZB-0457</h2></div>
      </div>
      <div class="vacancies-overview-item-information">
        <div class="vacancies-overview-item-information-item">
          <img src="location.svg" alt="Locatie"><p>Den Haag</p>
        </div>
      </div>
    </div>
  </a>
</div>
`;

const DETAIL_HTML = `
<div class="page-header page-header-vacancy">
  <div class="container">
    <h1>Operationeel Database Ontwikkelaar 2026-BZB-0457</h1>
    <div class="page-header-vacancy-details">
      <div class="page-header-vacancy-details-item">
        <img src="location.svg" alt="Locatie"><p>Den Haag</p>
      </div>
      <div class="page-header-vacancy-details-item">
        <img src="duration.svg" alt="Verwacht aantal uren per week"><p>36</p>
      </div>
      <div class="page-header-vacancy-details-item">
        <img src="money.svg" alt="Verwachte compensatie"><p>&#x20AC;98-102</p>
      </div>
      <div class="page-header-vacancy-details-item">
        <img src="start.svg" alt="Verwachte startdatum"><p><span data-date-utc="1790380800000">26-09-2026</span></p>
      </div>
      <div class="page-header-vacancy-details-item">
        <img src="deadline.svg" alt="Deadline voor reageren"><p><span data-date-utc="1788778800000">07-09-2026</span> <span data-time-utc="1788778800000">11:00</span></p>
      </div>
    </div>
  </div>
</div>
<div class="container">
  <div class="vacancy">
    <div class="vacancy-text">
      <p><b>Opdrachtomschrijving</b></p>Rolomschrijving voor database ontwikkelaar.
      <script>trackPageView();</script>
      <a href="https://needstaffing.esdnext.com/app/opdrachten/vacatures/15520/RESPOND" class="btn">Reageer nu</a>
    </div>
    <div class="vacancy-contact-info">
      <p>Test Recruiter</p>
      <a href="mailto:recruiter@example.invalid">recruiter@example.invalid</a>
    </div>
  </div>
</div>
`;

describe("Needstaffing HTML parsing", () => {
  it("extracts id from an opdracht href", () => {
    expect(extractNeedstaffingId("/Opdrachten/15520")).toBe("15520");
  });

  it("extracts the reference code from a listing title", () => {
    expect(
      extractNeedstaffingReferentie("Senior Scrummaster 2026-IBS-0370B")
    ).toBe("2026-IBS-0370B");
  });

  it("parses a euro-comma tarief band", () => {
    expect(parseNeedstaffingTariefBand("€95,00 - €100,00")).toEqual({
      max: "100.00",
      min: "95.00",
    });
  });

  it("parses a compact tarief band with one euro sign", () => {
    expect(parseNeedstaffingTariefBand("€98-102")).toEqual({
      max: "102",
      min: "98",
    });
  });

  it("parses listing cards into items with dates as epoch strings, and does not leak a field into an info-item with no recognised icon", async () => {
    const listing = await parseNeedstaffingListing(LISTING_HTML);
    expect(listing.items).toHaveLength(2);
    // `locatie` and `uren` below sandwich an info-item with no <img alt> at
    // all (see LISTING_HTML) — if pendingField went stale, `locatie` would
    // absorb "Genegeerde tekst zonder icoon" and/or `uren` would go missing.
    expect(listing.items[0]).toMatchObject({
      deadline: "1788876000000",
      id: "15521",
      locatie: "Apeldoorn",
      opdrachtgeverNaam: "Belastingdienst",
      start: "1790553600000",
      tarief: "€95,00 - €100,00",
      titel: "Senior Scrummaster 2026-IBS-0370B",
      uren: "36",
    });
    expect(listing.hasNextPage).toBe(false);
  });

  it("parses the detail page into typed fields and derives tarief min/max", async () => {
    const detail = await parseNeedstaffingDetail(DETAIL_HTML, "15520");
    expect(detail).toMatchObject({
      deadline: "1788778800000",
      id: "15520",
      locatie: "Den Haag",
      referentie: "2026-BZB-0457",
      start: "1790380800000",
      tariefMax: "102",
      tariefMin: "98",
      titel: "Operationeel Database Ontwikkelaar 2026-BZB-0457",
      uren: "36",
    });
  });

  it("decodes &amp; and &nbsp; entities in typed fields (opdrachtgeverNaam, locatie)", async () => {
    const html = `
<div class="vacancies-overview-item">
  <a href="/Opdrachten/99999">
    <div class="vacancies-overview-item-card">
      <div class="vacancies-overview-item-logo">
        <img src="logo.png" alt="Belastingdienst &amp; Douane">
      </div>
      <div class="vacancies-overview-item-summary">
        <div><h2>Test Rol 2026-XYZ-0001</h2></div>
      </div>
      <div class="vacancies-overview-item-information">
        <div class="vacancies-overview-item-information-item">
          <img src="location.svg" alt="Locatie"><p>Den&nbsp;Haag</p>
        </div>
      </div>
    </div>
  </a>
</div>`;
    const listing = await parseNeedstaffingListing(html);
    expect(listing.items[0]).toMatchObject({
      locatie: "Den Haag",
      opdrachtgeverNaam: "Belastingdienst & Douane",
    });
  });
});

describe("Needstaffing real fixtures", () => {
  it("parses the real recorded listing fixture, including periode and pagination", async () => {
    const fixture = await loadConnectorFixture<string>(
      "needstaffing/listing-page-0.json"
    );
    const listing = await parseNeedstaffingListing(fixture.payload);
    expect(listing.hasNextPage).toBe(true);
    expect(listing.items[0]).toMatchObject({
      id: "15520",
      periode: "4 maanden",
    });
  });

  it("DEC-008: raw.html from the real detail fixture keeps only the description text (no script, no RESPOND CTA, no contact info)", async () => {
    const fixture = await loadConnectorFixture<string>(
      "needstaffing/detail-15520.json"
    );
    const rawHtml = buildNeedstaffingRawHtml(fixture.payload);
    expect(rawHtml).toContain("Opdrachtomschrijving");
    expect(rawHtml).not.toContain("<script");
    expect(rawHtml).not.toContain("/RESPOND");
    expect(rawHtml).not.toContain("vacancy-contact-info");
  });
});

describe("decodeNeedstaffingEntities (RJC-374 guard, wired through this source)", () => {
  it("leaves an out-of-range numeric entity untouched instead of throwing", () => {
    expect(() => decodeNeedstaffingEntities("&#1114112;")).not.toThrow();
    expect(decodeNeedstaffingEntities("&#1114112;")).toBe("&#1114112;");
  });

  it("leaves a lone-surrogate numeric entity untouched instead of throwing", () => {
    expect(() => decodeNeedstaffingEntities("&#xD800;")).not.toThrow();
    expect(decodeNeedstaffingEntities("&#xD800;")).toBe("&#xD800;");
  });

  it("still decodes a real entity confirmed live in Needstaffing text nodes", () => {
    expect(decodeNeedstaffingEntities("&#x20AC;500 per dag")).toBe(
      "€500 per dag"
    );
  });
});

describe("Needstaffing connector", () => {
  it("ingests listing + detail fixtures with found/new/changed/rejected/error metrics", async () => {
    const bronId = "bron-needstaffing-fixture";
    const result = await runConnector({
      bronId,
      bronSlug: "needstaffing",
      checkpoint: null,
      connector: createNeedstaffingConnector({
        bronId,
        client: createNeedstaffingClient({ liveEnabled: false }),
      }),
      limiter: new CrawlDelayLimiter({ crawlDelayMs: 0 }),
      objectStore: new InMemoryObjectStore(),
      observationRecorder: new InMemoryObservationRecorder(),
      rawRetentionDays: 90,
      retryPolicy,
      runKind: "test",
      runLifecycleStore: new InMemoryRunLifecycleStore(),
      scrapeRunId: "run-ns-1",
      startedAt: new Date("2026-08-31T10:15:00.000Z"),
    });

    expect(result.metrics.found).toBeGreaterThan(0);
    expect(result.metrics.new).toBe(result.metrics.found);
    expect(result.metrics.error).toBe(0);
    expect(result.metrics.rejected).toBe(0);
  });

  it("replays fixture ingest without duplicate source records", async () => {
    const bronId = "bron-needstaffing-replay";
    const recorder = new InMemoryObservationRecorder();
    const objectStore = new InMemoryObjectStore();
    const connector = createNeedstaffingConnector({
      bronId,
      client: createNeedstaffingClient({ liveEnabled: false }),
    });
    const sharedInput = {
      bronId,
      bronSlug: "needstaffing" as const,
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

    await runConnector({ ...sharedInput, scrapeRunId: "run-ns-replay-1" });
    await runConnector({ ...sharedInput, scrapeRunId: "run-ns-replay-2" });

    expect(recorder.records.length).toBeGreaterThan(0);
    expect(
      new Set(recorder.records.map((record) => record.bronReferentie)).size
    ).toBe(recorder.records.length);
  });

  it("skips detail fetches for listing rows whose hash is already known", async () => {
    const bronId = "bron-needstaffing-known-hash";
    const items: NeedstaffingListingItem[] = [
      { id: "15520", titel: "Senior Java Developer" },
    ];
    const client: NeedstaffingClient = {
      fetchDetailHtml: () =>
        Promise.reject(new Error("fetchDetailHtml should not be called")),
      fetchListing: (page) =>
        Promise.resolve(
          page === 0
            ? { hasNextPage: false, items }
            : { hasNextPage: false, items: [] }
        ),
    };
    const [item] = items;
    if (!item) {
      throw new Error("Expected a fixture listing item");
    }
    const knownHash = await hashNeedstaffingListingItem(item);
    const knownHashes = {
      get: (_bronId: string, bronReferentie: string) =>
        Promise.resolve(bronReferentie === "15520" ? knownHash : null),
    };
    const connector = createNeedstaffingConnector({
      bronId,
      client,
      knownHashes,
    });
    const discovery = await connector.discover(null);
    expect(discovery.items).toHaveLength(1);
    const [discoveredItem] = discovery.items;
    if (!discoveredItem) {
      throw new Error("Expected a discovered item");
    }
    const fetched = await connector.fetch(discoveredItem);
    expect(fetched).toBeNull();
  });

  it("rejects a detail page with an empty/missing titel instead of ingesting it", async () => {
    const bronId = "bron-needstaffing-malformed";
    const items: NeedstaffingListingItem[] = [
      { id: "40000", titel: "Placeholder Titel" },
    ];
    const client: NeedstaffingClient = {
      fetchDetailHtml: () =>
        Promise.resolve(
          '<div class="page-header page-header-vacancy"><div class="container"><h1></h1></div></div>'
        ),
      fetchListing: (page) =>
        Promise.resolve(
          page === 0
            ? { hasNextPage: false, items }
            : { hasNextPage: false, items: [] }
        ),
    };
    const connector = createNeedstaffingConnector({ bronId, client });
    const discovery = await connector.discover(null);
    const [discoveredItem] = discovery.items;
    if (!discoveredItem) {
      throw new Error("Expected a discovered item");
    }
    const fetched = await connector.fetch(discoveredItem);
    expect(fetched).toMatchObject({
      reason: "detail page missing titel",
      status: "rejected",
    });
  });
});

describe("needstaffing page cap (RJC-397)", () => {
  const cappedClient: NeedstaffingClient = {
    fetchDetailHtml: () => Promise.reject(new Error("not used")),
    fetchListing: () =>
      Promise.resolve({
        hasNextPage: true,
        items: [{ id: "NS-CAP", titel: "Cap" }],
      }),
  };

  it("reports truncated when the page cap stops the walk while the site still has a next page", async () => {
    const connector = createNeedstaffingConnector({
      bronId: "bron-needstaffing-cap",
      client: cappedClient,
    });
    const beforeCap = await connector.discover({
      page: NEEDSTAFFING_MAX_LISTING_PAGES - 2,
    });
    expect(beforeCap.hasMore).toBe(true);
    expect(beforeCap.truncated).toBe(false);

    const atCap = await connector.discover({
      page: NEEDSTAFFING_MAX_LISTING_PAGES - 1,
    });
    expect(atCap.hasMore).toBe(false);
    expect(atCap.truncated).toBe(true);
  });

  it("reports an exhausted walk as not truncated", async () => {
    const connector = createNeedstaffingConnector({
      bronId: "bron-needstaffing-end",
      client: {
        ...cappedClient,
        fetchListing: () => Promise.resolve({ hasNextPage: false, items: [] }),
      },
    });
    const last = await connector.discover(null);
    expect(last.hasMore).toBe(false);
    expect(last.truncated).toBe(false);
  });
});
