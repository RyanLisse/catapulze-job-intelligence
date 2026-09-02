import { describe, expect, it } from "bun:test";

import { cleanupLiveDocuments } from "./live-test-hygiene";

describe("Manticore live fixture cleanup", () => {
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

    await expect(
      cleanupLiveDocuments(engine, ["run-a", "run-b", "run-c"])
    ).rejects.toThrow("fixture cleanup failed");
    expect(deleted.toSorted()).toEqual(["run-a", "run-b", "run-c"]);
  });
});
