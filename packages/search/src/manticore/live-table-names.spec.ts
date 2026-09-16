import { describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";
import path from "node:path";

const tableNamePattern =
  /const LIVE_TEST_INDEX_NAME = ["'](?<name>[^"']+)["']/u;
const liveEngineCallPattern = /createLiveTestEngine\(/u;
const excludedLiveSpec = "manticore/live-test-hygiene.spec.ts";

const collectTableNames = async (): Promise<Map<string, string>> => {
  const sourceRoot = path.resolve(import.meta.dir, "..");
  const glob = new Bun.Glob("**/*.spec.ts");
  const liveSpecFiles: string[] = [];

  for await (const filePath of glob.scan({ absolute: true, cwd: sourceRoot })) {
    const source = await readFile(filePath, "utf-8");
    const fileName = path.relative(sourceRoot, filePath);
    if (fileName !== excludedLiveSpec && liveEngineCallPattern.test(source)) {
      liveSpecFiles.push(filePath);
    }
  }

  const sources = await Promise.all(
    liveSpecFiles.map(async (filePath) => ({
      fileName: path.relative(sourceRoot, filePath),
      source: await readFile(filePath, "utf-8"),
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
