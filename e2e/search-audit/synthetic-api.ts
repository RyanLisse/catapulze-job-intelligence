import {
  createSliceARegistry,
  createTestSliceADeps,
  permissionsForRole,
} from "@ji/application/registry";
import { SearchAdapter } from "@ji/search";
import type {
  SearchDocument,
  SearchEngine,
  SearchIndexBatch,
  SearchIndexBatchResult,
  SearchVersion,
} from "@ji/search";
import { Hono } from "hono";
import { cors } from "hono/cors";

import {
  createRestCapabilityHandler,
  restRoutesFromRegistry,
} from "../../apps/server/src/capabilities/rest";
import type {
  EngineSearchParams,
  SearchEngineResult,
} from "../../packages/search/src/types";

const API_PORT = 3100;
const WEB_ORIGIN = "http://localhost:3001";
const BRON_ID = "00000000-0000-4000-8000-000000000001";
const SCRAPE_RUN_ID = "00000000-0000-4000-8000-000000000020";

const commaJob: SearchDocument = {
  beschrijving:
    "Platformopdracht in Amsterdam, Noord-Holland met brongetrouwe onbekende velden.",
  bronId: BRON_ID,
  contracttype: null,
  id: "00000000-0000-4000-8000-000000000101",
  laatstGezienOp: new Date("2026-09-04T09:00:00.000Z"),
  locatie: "Amsterdam, Noord-Holland",
  locatieLand: "NL",
  status: "active",
  tariefMax: 110,
  tariefMin: 90,
  titel: "Amsterdam, Noord-Holland platformopdracht",
};

const timeoutJob: SearchDocument = {
  beschrijving: "Timeout bewijsrecord met een gedeeltelijk zoekresultaat.",
  bronId: BRON_ID,
  contracttype: null,
  id: "00000000-0000-4000-8000-000000000102",
  laatstGezienOp: new Date("2026-09-04T10:00:00.000Z"),
  locatie: "Utrecht",
  locatieLand: "NL",
  status: "active",
  tariefMax: null,
  tariefMin: null,
  titel: "Timeout platformopdracht",
};

const unknownFieldsJob: SearchDocument = {
  beschrijving: "Record zonder gepubliceerde commerciële brongegevens.",
  bronId: BRON_ID,
  contracttype: null,
  id: "00000000-0000-4000-8000-000000000103",
  laatstGezienOp: new Date("2026-09-04T11:00:00.000Z"),
  locatieLand: "NL",
  status: "active",
  tariefMax: null,
  tariefMin: null,
  titel: "Brongetrouwe onbekende velden",
};

class IncompleteOnceEngine implements SearchEngine {
  private readonly delegate: SearchEngine;
  private readonly timeoutSearches = new Set<string>();

  constructor(delegate: SearchEngine) {
    this.delegate = delegate;
  }

  applyBatch(batch: SearchIndexBatch): Promise<SearchIndexBatchResult> {
    return this.delegate.applyBatch(batch);
  }

  deleteDocument(id: string): Promise<void> {
    return this.delegate.deleteDocument(id);
  }

  getAppliedVersion(): Promise<SearchVersion> {
    return this.delegate.getAppliedVersion();
  }

  async search(params: EngineSearchParams): Promise<SearchEngineResult> {
    const result = await this.delegate.search(params);
    const astKey = JSON.stringify(params.ast);
    const isTimeoutScenario = astKey.includes("timeout");
    if (!isTimeoutScenario || this.timeoutSearches.has(astKey)) {
      return result;
    }
    this.timeoutSearches.add(astKey);
    return {
      ...result,
      emptyReason: "query_timeout",
      incomplete: true,
    };
  }

  upsertDocument(document: SearchDocument): Promise<void> {
    return this.delegate.upsertDocument(document);
  }
}

const createSyntheticRegistry = async () => {
  const baseDeps = createTestSliceADeps("search-audit-e2e");
  await Promise.all([
    baseDeps.engine.upsertDocument(commaJob),
    baseDeps.engine.upsertDocument(timeoutJob),
    baseDeps.engine.upsertDocument(unknownFieldsJob),
  ]);

  for (const document of [commaJob, timeoutJob, unknownFieldsJob]) {
    const hasPublishedFacts = document.id === commaJob.id;
    baseDeps.stores.aanvragen.seed({
      beschrijving: document.beschrijving,
      bronId: document.bronId,
      bronReferentie: `SYNTH-${document.id.slice(-3)}`,
      contracttype: hasPublishedFacts ? "detachering" : null,
      id: document.id,
      locatie: document.locatie ?? null,
      // Organization is absent from the currently persisted source facts.
      opdrachtgeverNaam: null,
      publicatiedatum: hasPublishedFacts ? "2026-09-01T09:00:00.000Z" : null,
      rawPayloadRef: `synthetic/${document.id}.json`,
      scrapeRunId: SCRAPE_RUN_ID,
      sluitingsdatum: hasPublishedFacts
        ? new Date("2099-09-30T17:00:00.000Z")
        : null,
      status: document.status,
      tariefEenheid: hasPublishedFacts ? "uur" : null,
      tariefMax: hasPublishedFacts ? 110 : null,
      tariefMin: hasPublishedFacts ? 90 : null,
      tariefValuta: hasPublishedFacts ? "EUR" : null,
      titel: document.titel,
      versies: [],
      werkvorm: hasPublishedFacts ? "remote" : null,
    });
  }

  const deps = {
    ...baseDeps,
    searchAdapter: new SearchAdapter({
      engine: new IncompleteOnceEngine(baseDeps.engine),
    }),
  };
  return createSliceARegistry(deps).registry;
};

const registry = await createSyntheticRegistry();
const restHandler = createRestCapabilityHandler(
  registry,
  restRoutesFromRegistry(registry),
  () =>
    Promise.resolve({
      ok: true as const,
      principal: {
        kind: "user" as const,
        permissions: permissionsForRole("recruiter"),
        subjectId: "search-audit-user",
      },
    }),
  { allowedCookieOrigin: WEB_ORIGIN }
);

if (process.env.SEARCH_AUDIT_E2E !== "1") {
  throw new Error("Synthetic API requires SEARCH_AUDIT_E2E=1.");
}

const sessionResponse = () => ({
  session: {
    createdAt: "2026-09-04T08:00:00.000Z",
    expiresAt: "2099-09-05T08:00:00.000Z",
    id: "search-audit-session",
    token: "synthetic-session-token",
    updatedAt: "2026-09-04T08:00:00.000Z",
    userId: "search-audit-user",
  },
  user: {
    createdAt: "2026-09-04T08:00:00.000Z",
    email: "search-audit@example.invalid",
    emailVerified: true,
    id: "search-audit-user",
    name: "Search Audit",
    updatedAt: "2026-09-04T08:00:00.000Z",
  },
});

const app = new Hono();
app.use(
  "*",
  cors({
    allowHeaders: ["Accept", "Content-Type"],
    allowMethods: ["GET", "POST", "OPTIONS"],
    credentials: true,
    origin: WEB_ORIGIN,
  })
);
app.get("/health", (context) => context.json({ ok: true }));
app.get("/api/auth/get-session", (context) => context.json(sessionResponse()));
app.all("/v1/*", (context) => restHandler(context));

Bun.serve({
  fetch: app.fetch,
  hostname: "127.0.0.1",
  port: API_PORT,
});

console.info(
  `Synthetic search-audit API listening on http://localhost:${API_PORT}`
);
