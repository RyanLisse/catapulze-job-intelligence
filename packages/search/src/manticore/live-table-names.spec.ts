import { describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";
import path from "node:path";

const LIVE_SPEC_FILES = [
  "../adapter.spec.ts",
  "../ast-hash.spec.ts",
  "./bulk-live.spec.ts",
  "./live.spec.ts",
  "./sort-live.spec.ts",
] as const;

const tableNamePattern =
  /const LIVE_TEST_INDEX_NAME = ["'](?<name>[^"']+)["']/u;

const collectTableNames = async (): Promise<Map<string, string>> => {
  const sources = await Promise.all(
    LIVE_SPEC_FILES.map(async (relativePath) => ({
      fileName: relativePath.replace(/^\.\//u, ""),
      source: await readFile(
        path.resolve(import.meta.dir, relativePath),
        "utf-8"
      ),
    }))
  );
  const names = new Map<string, string>();
  for (const { fileName, source } of sources) {
    const tableName = source.match(tableNamePattern)?.groups?.name;
    if (!tableName) {
      throw new Error(`Missing LIVE_TEST_INDEX_NAME in ${fileName}`);
    }
    names.set(fileName, tableName);
  }
  return names;
};

describe("live Manticore table names", () => {
  it("uses a unique table base per live spec file", async () => {
    const names = await collectTableNames();
    const owners = new Map<string, string>();
    const duplicates: string[] = [];

    for (const [fileName, tableName] of names) {
      const previousOwner = owners.get(tableName);
      if (previousOwner) {
        duplicates.push(
          `Duplicate live Manticore table base "${tableName}" used by ${previousOwner} and ${fileName}`
        );
      } else {
        owners.set(tableName, fileName);
      }
      expect(tableName.startsWith("aanvragen_test")).toBe(true);
    }

    expect(duplicates, duplicates.join("\n")).toEqual([]);
  });
});
