import { describe, expect, it } from "bun:test";

import {
  InMemoryObservationRecorder,
  InMemoryObjectStore,
  InMemoryRunLifecycleStore,
} from "@ji/connectors";

import { executeBronRun as execute } from "./execute";
import * as bronnenApi from "./index";
import {
  activateBron,
  createBron,
  isPollableBron,
  listPublicBronnen,
  validateSecretRef,
} from "./register";
import type { BronPersistence, BronRegisterRecord } from "./register";

const tendernedBron = () => ({
  categorie: "overheidsportaal",
  crawlDelayMs: 1000,
  interval: "*/15 * * * *",
  loginVereist: false,
  mappingRef: "fixtures/connectors/tenderned/mapping.json",
  method: "json-api" as const,
  naam: "TenderNed",
  rateLimitPerMinute: 30,
  retentionDays: 90,
  secretRef: null,
  status: "deferred" as const,
  voorwaardenStatus: "toegestaan" as const,
});

const persistenceFor = (
  record: BronRegisterRecord | null
): BronPersistence => ({
  activate: () => Promise.reject(new Error("activation is not used")),
  create: (createdRecord) => Promise.resolve(createdRecord),
  findById: () => Promise.resolve(record),
  list: () => Promise.resolve(record ? [record] : []),
});

describe("bron register", () => {
  it("creates a deferred bron without scheduling polls", () => {
    const created = createBron(tendernedBron());
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }

    expect(isPollableBron(created.record)).toBe(false);
  });

  it("always creates an inactive bron, even when runtime input requests activation", () => {
    const runtimeInput = {
      ...tendernedBron(),
      actief: true,
    };
    const created = createBron(runtimeInput);
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }

    expect(created.record.actief).toBe(false);
  });

  it("lists bronnen without exposing secret values", () => {
    const record: BronRegisterRecord = {
      ...tendernedBron(),
      actief: false,
      bronId: "bron-1",
      lastRun: null,
      secretRef: "trigger://tenderned/api-key",
      status: "deferred",
    };

    const [view] = listPublicBronnen([record]);
    expect(view?.hasSecretRef).toBe(true);
    expect(JSON.stringify(view)).not.toContain("trigger://");
  });

  it("does not expose boolean-only activation", () => {
    expect("activateBronInRegister" in bronnenApi).toBe(false);
  });

  it("delegates activation using an opaque test-import run id", async () => {
    const created = createBron(tendernedBron());
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }
    let activationInput: unknown;
    const persistence: BronPersistence = {
      ...persistenceFor(created.record),
      activate: (input) => {
        activationInput = input;
        return Promise.resolve({
          ...created.record,
          actief: true,
          status: "ready" as const,
        });
      },
    };
    const result = await activateBron(persistence, {
      bronId: created.record.bronId,
      testImportRunId: "test-run-1",
    });
    expect(result.ok).toBe(true);
    expect(activationInput).toEqual({
      bronId: created.record.bronId,
      testImportRunId: "test-run-1",
    });
  });

  it("accepts only opaque secret references", () => {
    expect(validateSecretRef("op://catapulze/prod/api-key")).toEqual([]);
    expect(validateSecretRef("vault://prod/api-key")).toEqual([]);
    expect(validateSecretRef("trigger://tenderned/api-key")).toEqual([]);
    expect(validateSecretRef("plaintext-secret")).toEqual([
      "secretRef must be an opaque op://, vault://, or trigger:// reference",
    ]);
  });

  it("rejects missing and non-pollable bronnen before connector calls", async () => {
    let calls = 0;
    const connector = {
      bronId: "bron-1",
      discover: () => {
        calls += 1;
        return Promise.resolve({ checkpoint: {}, hasMore: false, items: [] });
      },
      fetch: () => Promise.resolve(null),
    };
    const persistence = persistenceFor(null);
    await expect(
      execute(persistence, {
        bronId: "bron-1",
        connector,
        objectStore: new InMemoryObjectStore(),
        observationRecorder: new InMemoryObservationRecorder(),
        runLifecycleStore: new InMemoryRunLifecycleStore(),
        scrapeRunId: "run-1",
      })
    ).rejects.toThrow("bron not found");
    expect(calls).toBe(0);
  });

  it("composes persisted retention and limiter policy", async () => {
    const record = {
      ...tendernedBron(),
      actief: true,
      bronId: "bron-1",
      lastRun: null,
      status: "ready" as const,
    };
    const objectStore = new InMemoryObjectStore();
    const recorder = new InMemoryObservationRecorder();
    const persistence = persistenceFor(record);
    const connector = {
      bronId: "bron-1",
      discover: () =>
        Promise.resolve({
          checkpoint: {},
          hasMore: false,
          items: [{ bronReferentie: "r1", contentHash: "" }],
        }),
      fetch: () =>
        Promise.resolve({
          body: new Uint8Array([1]),
          bronReferentie: "r1",
          contentHash: "h",
          contentType: "html" as const,
          status: "fetched" as const,
        }),
    };
    let now = 0;
    const waits: number[] = [];
    await execute(persistence, {
      bronId: "bron-1",
      connector,
      now: () => now,
      objectStore,
      observationRecorder: recorder,
      runLifecycleStore: new InMemoryRunLifecycleStore(),
      scrapeRunId: "run-1",
      startedAt: new Date("2026-08-29T00:00:00Z"),
      wait: (ms) => {
        waits.push(ms);
        now += ms;
        return Promise.resolve();
      },
      writeNow: () => new Date("2026-08-29T00:00:00Z"),
    });
    const object = await objectStore.get(
      "raw/bron-1/2026/08/29/run-1/r1-h.html"
    );
    expect(object?.expiresAt.getTime()).toBe(
      new Date("2026-11-27T00:00:00Z").getTime()
    );
    expect(waits).toEqual([2000]);
  });

  it("shares limiter windows across concurrent runs for the same bron", async () => {
    const record = {
      ...tendernedBron(),
      actief: true,
      bronId: "bron-1",
      lastRun: null,
      status: "ready" as const,
    };
    let now = 0;
    const waits: number[] = [];
    const executeOnce = (scrapeRunId: string) =>
      execute(persistenceFor(record), {
        bronId: "bron-1",
        connector: {
          bronId: "bron-1",
          discover: () =>
            Promise.resolve({ checkpoint: {}, hasMore: false, items: [] }),
          fetch: () => Promise.resolve(null),
        },
        now: () => now,
        objectStore: new InMemoryObjectStore(),
        observationRecorder: new InMemoryObservationRecorder(),
        runLifecycleStore: new InMemoryRunLifecycleStore(),
        scrapeRunId,
        wait: (milliseconds) => {
          waits.push(milliseconds);
          now += milliseconds;
          return Promise.resolve();
        },
      });

    await Promise.all([executeOnce("run-1"), executeOnce("run-2")]);

    expect(waits).toEqual([2000]);
  });

  it("isolates limiter windows across concurrent runs for distinct bronnen", async () => {
    const waits: number[] = [];
    const executeOnce = (bronId: string, scrapeRunId: string) =>
      execute(
        persistenceFor({
          ...tendernedBron(),
          actief: true,
          bronId,
          lastRun: null,
          status: "ready" as const,
        }),
        {
          bronId,
          connector: {
            bronId,
            discover: () =>
              Promise.resolve({ checkpoint: {}, hasMore: false, items: [] }),
            fetch: () => Promise.resolve(null),
          },
          now: () => 0,
          objectStore: new InMemoryObjectStore(),
          observationRecorder: new InMemoryObservationRecorder(),
          runLifecycleStore: new InMemoryRunLifecycleStore(),
          scrapeRunId,
          wait: (milliseconds) => {
            waits.push(milliseconds);
            return Promise.resolve();
          },
        }
      );

    await Promise.all([
      executeOnce("bron-1", "run-1"),
      executeOnce("bron-2", "run-2"),
    ]);

    expect(waits).toEqual([]);
  });
});
