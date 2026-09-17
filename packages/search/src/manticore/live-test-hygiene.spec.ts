import { describe, expect, it } from "bun:test";

import { SEARCH_INDEX_NAME, SEARCH_TEST_INDEX_NAME } from "../types";
import { InMemorySearchVersionStore } from "../version";
import { ManticoreSearchEngine } from "./engine";
import {
  assertLiveTestTablesReady,
  cleanupLiveDocuments,
  createLiveTestEngine,
  requireLiveManticoreUrl,
} from "./live-test-hygiene";

describe("Manticore live fixture cleanup", () => {
  it("fails when a required live lane has no URL", () => {
    expect(() => requireLiveManticoreUrl(undefined, true)).toThrow(
      "requires a non-empty MANTICORE_URL"
    );
    expect(requireLiveManticoreUrl(" http://manticore.test ", true)).toBe(
      "http://manticore.test"
    );
  });

  it("refuses to preflight tables without a live URL", async () => {
    await expect(
      assertLiveTestTablesReady(undefined, "aanvragen_test_x")
    ).rejects.toThrow("requires a live MANTICORE_URL");
  });

  it("attempts every run-owned id when one deletion fails", async () => {
    const deleted: string[] = [];
    const engine = {
      deleteDocument: (id: string) => {
        deleted.push(id);
        if (id === "run-b") {
          return Promise.reject(new Error("delete failed"));
        }
        return Promise.resolve();
      },
    };

    const cleanup = cleanupLiveDocuments(engine, ["run-a", "run-b", "run-c"]);
    await expect(cleanup).rejects.toBeInstanceOf(AggregateError);
    await expect(cleanup).rejects.toThrow("fixture cleanup failed");
    expect(deleted.toSorted()).toEqual(["run-a", "run-b", "run-c"]);
  });

  it("treats 409 and Conflict deletions as already gone", async () => {
    const deleted: string[] = [];
    const engine = {
      deleteDocument: (id: string) => {
        deleted.push(id);
        if (id === "run-b") {
          return Promise.reject(
            new Error("Manticore request failed (409): Conflict")
          );
        }
        if (id === "run-c") {
          return Promise.reject(new Error("Conflict"));
        }
        return Promise.resolve();
      },
    };

    await expect(
      cleanupLiveDocuments(engine, ["run-a", "run-b", "run-c"])
    ).resolves.toBeUndefined();
    expect(deleted).toEqual(["run-a", "run-b", "run-c"]);
  });

  it("keeps the live-test index name distinct from production", () => {
    expect(SEARCH_TEST_INDEX_NAME).toBe("aanvragen_test");
    expect(SEARCH_TEST_INDEX_NAME).not.toBe(SEARCH_INDEX_NAME);
    const engine = createLiveTestEngine(
      "http://manticore.test",
      new InMemorySearchVersionStore(),
      SEARCH_TEST_INDEX_NAME
    );
    expect(engine).toBeInstanceOf(ManticoreSearchEngine);
  });

  it("rejects the production index and accepts a test index", () => {
    const store = new InMemorySearchVersionStore();

    expect(() => createLiveTestEngine("http://x", store, "aanvragen")).toThrow(
      'starting with "aanvragen_test"'
    );
    expect(() =>
      createLiveTestEngine("http://x", store, "aanvragen_test_x")
    ).not.toThrow();
  });
});
