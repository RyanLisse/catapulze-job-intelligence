import { describe, expect, it } from "bun:test";

import type {
  BackfillFailureEvidence,
  BackfillRunEvidence,
} from "@ji/application/backfill";

import {
  PostgresBackfillProvenanceStore,
  PostgresBackfillRunStore,
} from "./backfill-stores";
import type { BackfillDatabase } from "./backfill-stores";

const metrics = {
  duplicates: 0,
  errors: 1,
  extra: 0,
  found: 0,
  imported: 0,
  matched: 0,
  missing: 0,
  platforms: {},
  rejected: 0,
  selected: 0,
  skipped: 0,
};

interface PersistedRunUpdate {
  readonly aantalGevonden: number;
  readonly checkpoint: { readonly backfill: BackfillRunEvidence };
  readonly failureClass: string;
  readonly failureCode: string;
  readonly failureMessage: string;
  readonly failurePhase: string;
  readonly fouten: number;
  readonly geindigd: Date;
  readonly nieuw: number;
  readonly rejected: number;
  readonly status: string;
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- isolated test seam for a fluent Drizzle adapter
const asBackfillDatabase = (value: unknown): BackfillDatabase =>
  // SAFETY: callers provide the exact database chain used by the test.
  value as BackfillDatabase;

const createRunStore = () => {
  let persisted: PersistedRunUpdate | undefined;
  const database = {
    update: () => ({
      set: (values: PersistedRunUpdate) => {
        persisted = structuredClone(values);
        return {
          where: () => ({
            returning: () => Promise.resolve([{ id: "run-1" }]),
          }),
        };
      },
    }),
  };
  return {
    persisted: () => persisted,
    store: new PostgresBackfillRunStore(asBackfillDatabase(database)),
  };
};

describe("Postgres backfill failure evidence", () => {
  it("persists versioned source and target digests in a successful checkpoint", async () => {
    const sourceDigest = "a".repeat(64);
    const evidence: BackfillRunEvidence = {
      execution: { mode: "production", scope: "full" },
      metrics: { ...metrics, errors: 0 },
      scopeManifest: {
        contractVersion: "motian-v1-scope-manifest/v1",
        digestAlgorithm: "sha256",
        itemEncoding: "json-array-line/v1",
        order: "source-id-ascending",
        orderedDigest: sourceDigest,
        platformCounts: { werkzoeken: 1 },
        selected: 1,
        snapshot: {
          completedAt: "2026-09-02T10:05:00.000Z",
          startedAt: "2026-09-02T10:00:00.000Z",
        },
      },
      targetReconciliation: {
        contractVersion: "motian-v1-target-reconciliation/v1",
        digestAlgorithm: "sha256",
        distinctV1Ids: 1,
        itemEncoding: "json-array-line/v1",
        matchesScope: true,
        order: "source-id-ascending",
        orderedDigest: sourceDigest,
        platformCounts: { werkzoeken: 1 },
        records: 1,
        snapshot: {
          completedAt: "2026-09-02T10:06:00.000Z",
          startedAt: "2026-09-02T10:05:30.000Z",
        },
      },
    };
    const { persisted, store } = createRunStore();

    await store.completeRun("run-1", evidence);

    expect(persisted()).toMatchObject({
      checkpoint: { backfill: evidence },
      status: "succeeded",
    });
  });

  it("persists the safe typed failure in the checkpoint and terminal state", async () => {
    const failure: BackfillFailureEvidence = {
      code: "RAW_READBACK_FAILED",
      phase: "raw-write",
    };
    const evidence: BackfillRunEvidence = {
      execution: { mode: "production", scope: "full" },
      failure,
      metrics,
    };
    const { persisted, store } = createRunStore();

    await store.failRun("run-1", failure, evidence);

    expect(persisted()).toMatchObject({
      checkpoint: { backfill: evidence },
      failureClass: "internal",
      failureCode: "UNEXPECTED_FAILURE",
      failureMessage: "Connector run failed",
      failurePhase: "unknown",
      status: "failed",
    });
    expect(JSON.stringify(persisted())).not.toContain("postgresql://");
  });

  it("refuses a terminal failure that disagrees with checkpoint evidence", async () => {
    const { store } = createRunStore();
    const failure: BackfillFailureEvidence = {
      code: "SOURCE_READ_FAILED",
      phase: "source-read",
    };

    await expect(
      store.failRun("run-1", failure, {
        execution: { mode: "production", scope: "full" },
        failure: { code: "PROVENANCE_MISMATCH", phase: "provenance" },
        metrics,
      })
    ).rejects.toThrow(
      "Backfill failure evidence does not match terminal state"
    );
  });
});

/* oxlint-disable node/callback-return, promise/prefer-await-to-callbacks -- Drizzle transaction test doubles intentionally mirror its callback API. */
describe("Postgres backfill launch fencing", () => {
  const createLaunchDatabase = (running: boolean) => {
    const events: string[] = [];
    const transaction = {
      execute: () => {
        events.push("lock");
        return Promise.resolve([]);
      },
      insert: () => ({
        values: () => ({
          returning: () => {
            events.push("insert");
            return Promise.resolve([{ id: "new-run" }]);
          },
        }),
      }),
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () => {
              events.push("running-check");
              return Promise.resolve(running ? [{ id: "running-run" }] : []);
            },
          }),
        }),
      }),
    };
    const database = {
      transaction: <Result>(
        callback: (value: typeof transaction) => Promise<Result>
      ): Promise<Result> => callback(transaction),
    };
    return { database: asBackfillDatabase(database), events };
  };

  it("serializes launch and refuses a second running backfill", async () => {
    const { database, events } = createLaunchDatabase(true);
    const store = new PostgresBackfillRunStore(database);

    await expect(store.startRun("bron-1")).rejects.toThrow(
      "A Motian v1 backfill is already running"
    );

    expect(events).toEqual(["lock", "running-check"]);
  });

  it("starts after the serialized running-row check is clear", async () => {
    const { database, events } = createLaunchDatabase(false);
    const store = new PostgresBackfillRunStore(database);

    await expect(store.startRun("bron-1")).resolves.toMatchObject({
      scrapeRunId: expect.any(String),
    });

    expect(events).toEqual(["lock", "running-check", "insert"]);
  });
});

describe("Postgres backfill target reconciliation snapshot", () => {
  it("streams ordered keyset pages from one repeatable-read read-only transaction", async () => {
    const pages = [
      [
        { aanvraagId: "aanvraag-1", bronId: "bron-1", v1Id: "v1-1" },
        { aanvraagId: "aanvraag-2", bronId: "bron-1", v1Id: "v1-2" },
      ],
      [{ aanvraagId: "aanvraag-3", bronId: "bron-2", v1Id: "v1-3" }],
    ];
    let page = 0;
    let clock = 0;
    let transactionConfig:
      | { accessMode: string; isolationLevel: string }
      | undefined;
    const transaction = {
      execute: () => {
        clock += 1;
        return Promise.resolve(
          clock === 1
            ? [{ snapshot_started_at: "2026-09-02T10:00:00.000Z" }]
            : [{ snapshot_completed_at: "2026-09-02T10:05:00.000Z" }]
        );
      },
      select: () => ({
        from: () => ({
          where: () => ({
            orderBy: () => ({
              limit: () => {
                const currentPage = pages[page] ?? [];
                page += 1;
                return Promise.resolve(currentPage);
              },
            }),
          }),
        }),
      }),
    };
    const database = {
      transaction: async <Result>(
        callback: (value: typeof transaction) => Promise<Result>,
        config: { accessMode: string; isolationLevel: string }
      ): Promise<Result> => {
        transactionConfig = config;
        return await callback(transaction);
      },
    };
    const store = new PostgresBackfillProvenanceStore(
      asBackfillDatabase(database)
    );
    const records: { bronId: string; v1Id: string }[] = [];

    const snapshot = await store.consumeReconciliationSnapshot(
      ["bron-1", "bron-2"],
      2,
      (batch) => {
        records.push(...batch);
        return Promise.resolve();
      }
    );

    expect(transactionConfig).toEqual({
      accessMode: "read only",
      isolationLevel: "repeatable read",
    });
    expect(records).toEqual([
      { bronId: "bron-1", v1Id: "v1-1" },
      { bronId: "bron-1", v1Id: "v1-2" },
      { bronId: "bron-2", v1Id: "v1-3" },
    ]);
    expect(snapshot).toEqual({
      completedAt: "2026-09-02T10:05:00.000Z",
      startedAt: "2026-09-02T10:00:00.000Z",
    });
  });

  it("rejects when the reconciliation snapshot commit is lost", async () => {
    let clock = 0;
    const transaction = {
      execute: () => {
        clock += 1;
        return Promise.resolve(
          clock === 1
            ? [{ snapshot_started_at: "2026-09-02T10:00:00.000Z" }]
            : [{ snapshot_completed_at: "2026-09-02T10:05:00.000Z" }]
        );
      },
      select: () => ({
        from: () => ({
          where: () => ({
            orderBy: () => ({ limit: () => Promise.resolve([]) }),
          }),
        }),
      }),
    };
    const database = {
      transaction: async <Result>(
        callback: (value: typeof transaction) => Promise<Result>
      ): Promise<Result> => {
        await callback(transaction);
        throw new Error("target snapshot commit lost");
      },
    };
    const store = new PostgresBackfillProvenanceStore(
      asBackfillDatabase(database)
    );

    await expect(
      store.consumeReconciliationSnapshot(["bron-1"], 1000, () =>
        Promise.resolve()
      )
    ).rejects.toThrow("target snapshot commit lost");
  });
});
/* oxlint-enable node/callback-return, promise/prefer-await-to-callbacks */
