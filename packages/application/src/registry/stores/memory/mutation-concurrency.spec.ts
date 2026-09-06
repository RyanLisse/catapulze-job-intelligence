import { describe, expect, it } from "bun:test";

import type { AuditEventRecord, AuditStore } from "../types";
import { MemoryAuditStore } from "./audit-store";
import { MemoryMarkeringStore } from "./markering-store";
import { MemorySavedSearchStore } from "./saved-search-store";

interface AuditGate {
  readonly fail: () => void;
  readonly pass: () => void;
}

interface GatedAuditHarness {
  readonly audit: AuditStore;
  readonly gates: AuditGate[];
}

const createGatedAudit = (): GatedAuditHarness => {
  const gates: AuditGate[] = [];
  const audit: AuditStore = {
    append(event) {
      const pending = Promise.withResolvers<AuditEventRecord>();
      gates.push({
        fail: () => {
          pending.reject(new Error("injected audit failure"));
        },
        pass: () => {
          void new MemoryAuditStore()
            .append(event)
            .then(pending.resolve, pending.reject);
        },
      });
      return pending.promise;
    },
    listByActorId() {
      return Promise.resolve([]);
    },
    listRecentByActorId() {
      return Promise.resolve([]);
    },
  };
  return { audit, gates };
};

const requireGate = (gates: readonly AuditGate[], index: number): AuditGate => {
  const gate = gates[index];
  if (!gate) {
    throw new Error(`expected audit gate at index ${index}`);
  }
  return gate;
};

describe("memory store reverse-order failed mutations (RJC-444)", () => {
  it("marker clear→set both audits fail reverse order restores committed markering", async () => {
    const { audit, gates } = createGatedAudit();
    const store = new MemoryMarkeringStore(audit);

    const seedPromise = store.setWithAudit(
      {
        aanvraagId: "aanvraag-1",
        reden: "seed",
        scopeId: "scope-1",
        status: "relevant",
        userId: "user-1",
      },
      "user"
    );
    expect(gates.length).toBe(1);
    requireGate(gates, 0).pass();
    await seedPromise;
    expect(await store.get("aanvraag-1", "user-1", "scope-1")).toMatchObject({
      reden: "seed",
      status: "relevant",
    });

    const clearPromise = store.clearWithAudit(
      "aanvraag-1",
      "user-1",
      "scope-1",
      "user"
    );
    expect(gates.length).toBe(2);
    const setPromise = store.setWithAudit(
      {
        aanvraagId: "aanvraag-1",
        reden: "replacement",
        scopeId: "scope-1",
        status: "gevolgd",
        userId: "user-1",
      },
      "user"
    );
    expect(gates.length).toBe(3);

    // Reverse completion: earlier clear fails first, later set fails second.
    requireGate(gates, 1).fail();
    await expect(clearPromise).rejects.toThrow("injected audit failure");
    requireGate(gates, 2).fail();
    await expect(setPromise).rejects.toThrow("injected audit failure");

    expect(await store.get("aanvraag-1", "user-1", "scope-1")).toMatchObject({
      reden: "seed",
      status: "relevant",
    });
  });

  it("saved-search update→update both fail reverse order restores committed record", async () => {
    const { audit, gates } = createGatedAudit();
    const store = new MemorySavedSearchStore(audit);
    const createPromise = store.createWithAudit(
      {
        deletedAt: null,
        filters: {},
        naam: "seed",
        parserVersion: "1",
        queryText: "Azure",
        schemaVersion: "1",
        scopeId: "scope-1",
        userId: "user-1",
      },
      "user"
    );
    requireGate(gates, 0).pass();
    const { savedSearch } = await createPromise;
    const { id } = savedSearch;

    const firstUpdate = store.updateWithAudit(
      id,
      "user-1",
      "scope-1",
      {
        filters: {},
        naam: "first",
        parserVersion: "1",
        queryText: "Azure AND first",
        schemaVersion: "1",
      },
      "user"
    );
    const secondUpdate = store.updateWithAudit(
      id,
      "user-1",
      "scope-1",
      {
        filters: {},
        naam: "second",
        parserVersion: "1",
        queryText: "Azure AND second",
        schemaVersion: "1",
      },
      "user"
    );
    expect(gates.length).toBe(3);

    requireGate(gates, 1).fail();
    await expect(firstUpdate).rejects.toThrow("injected audit failure");
    requireGate(gates, 2).fail();
    await expect(secondUpdate).rejects.toThrow("injected audit failure");

    expect(await store.getById(id, "user-1", "scope-1")).toMatchObject({
      naam: "seed",
      queryText: "Azure",
    });
  });

  it("saved-search update→remove both fail reverse order restores committed record", async () => {
    const { audit, gates } = createGatedAudit();
    const store = new MemorySavedSearchStore(audit);
    const createPromise = store.createWithAudit(
      {
        deletedAt: null,
        filters: {},
        naam: "seed",
        parserVersion: "1",
        queryText: "Azure",
        schemaVersion: "1",
        scopeId: "scope-1",
        userId: "user-1",
      },
      "user"
    );
    requireGate(gates, 0).pass();
    const { savedSearch } = await createPromise;
    const { id } = savedSearch;

    const updatePromise = store.updateWithAudit(
      id,
      "user-1",
      "scope-1",
      {
        filters: {},
        naam: "updated",
        parserVersion: "1",
        queryText: "Azure AND updated",
        schemaVersion: "1",
      },
      "user"
    );
    const removePromise = store.removeWithAudit(
      id,
      "user-1",
      "scope-1",
      "user"
    );
    expect(gates.length).toBe(3);

    requireGate(gates, 1).fail();
    await expect(updatePromise).rejects.toThrow("injected audit failure");
    requireGate(gates, 2).fail();
    await expect(removePromise).rejects.toThrow("injected audit failure");

    expect(await store.getById(id, "user-1", "scope-1")).toMatchObject({
      naam: "seed",
      queryText: "Azure",
    });
  });
});
