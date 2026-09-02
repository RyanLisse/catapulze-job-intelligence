import { describe, expect, it, mock } from "bun:test";

import {
  assertCleanManticoreTables,
  cleanupAndAssertManticoreTables,
  cleanupManticoreDocuments,
  MANTICORE_BENCH_TABLES,
  requireManticoreUrl,
} from "./manticore-hygiene";

const countResponse = (count: number): Response =>
  Response.json([{ data: [{ "count(*)": count }] }]);

describe("Manticore benchmark hygiene", () => {
  it("counts both dedicated tables with SELECT COUNT(*) and accepts zero rows", async () => {
    const request = mock((_url: string | URL | Request, init?: RequestInit) => {
      expect(String(init?.body)).toContain(
        "SELECT%20COUNT(*)%20FROM%20aanvragen_bench_"
      );
      return Promise.resolve(countResponse(0));
    });

    await assertCleanManticoreTables(
      "benchmark",
      "http://manticore.test",
      "before",
      request
    );

    expect(request).toHaveBeenCalledTimes(MANTICORE_BENCH_TABLES.length);
  });

  it("rejects a dirty table", async () => {
    let calls = 0;
    const request = mock(() => {
      calls += 1;
      return Promise.resolve(countResponse(calls === 1 ? 2 : 0));
    });

    await expect(
      assertCleanManticoreTables(
        "benchmark",
        "http://manticore.test",
        "after",
        request
      )
    ).rejects.toThrow("aanvragen_bench_active=2");
  });

  it("sends every run-owned id through bounded bulk cleanup", async () => {
    const deleted: string[] = [];
    const engine = {
      applyBatch: (batch: { mutations: { id: string }[] }) => {
        deleted.push(...batch.mutations.map((mutation) => mutation.id));
        return Promise.resolve({ failures: [], unapplied: [] });
      },
    };

    await cleanupManticoreDocuments(engine, ["run-a", "run-b", "run-c"]);
    expect(deleted.toSorted()).toEqual(["run-a", "run-b", "run-c"]);
  });

  it("still performs the post-run count proof when cleanup reports an error", async () => {
    const request = mock(() => Promise.resolve(countResponse(1)));
    const engine = {
      applyBatch: () =>
        Promise.resolve({
          failures: [{ error: "delete failed", id: "run-a" }],
          unapplied: [],
        }),
    };

    await expect(
      cleanupAndAssertManticoreTables(
        "benchmark",
        "http://manticore.test",
        engine,
        ["run-a"],
        request
      )
    ).rejects.toThrow("cleanup proof failed");
    expect(request).toHaveBeenCalledTimes(MANTICORE_BENCH_TABLES.length);
  });

  it("fails closed when CI requires Manticore but no URL is configured", () => {
    expect(() => requireManticoreUrl(undefined, true)).toThrow(
      "requires a non-empty MANTICORE_URL"
    );
    expect(requireManticoreUrl(" http://manticore.test ", true)).toBe(
      "http://manticore.test"
    );
  });
});
