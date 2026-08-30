import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";

import { InMemorySearchEngine, SearchAdapter } from "@ji/search";
import type { SearchDocument } from "@ji/search";

import type { CorpusRecord } from "./generate-corpus";
import { generateCorpus } from "./generate-corpus";
import profile from "./profile.json";

const SAMPLE_SIZE = 5000;
const SAMPLE_SEED = 1337;
const BENCH_DOC_ID_PATTERN = /^bench-doc-\d+$/u;
const LOCATIE_LAND_PATTERN = /^(?<land>NL|BE)$/u;

const hashOf = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

const serialize = (records: CorpusRecord[]): string =>
  records.map((record) => JSON.stringify(record)).join("\n");

const toSearchDocuments = (records: CorpusRecord[]): SearchDocument[] =>
  records.map((record) => ({
    ...record,
    laatstGezienOp: new Date(record.laatstGezienOp),
  }));

describe("generateCorpus", () => {
  it("is deterministic for a fixed seed (identical output hashes)", () => {
    const first = serialize([...generateCorpus({ documents: 2000, seed: 42 })]);
    const second = serialize([
      ...generateCorpus({ documents: 2000, seed: 42 }),
    ]);

    expect(hashOf(first)).toBe(hashOf(second));
  });

  it("produces the requested number of records with synthetic ids", () => {
    const records = [...generateCorpus({ documents: 500, seed: 7 })];
    expect(records).toHaveLength(500);
    for (const record of records) {
      expect(record.id).toMatch(BENCH_DOC_ID_PATTERN);
      expect(record.locatieLand).toMatch(LOCATIE_LAND_PATTERN);
    }
  });

  it("matches each profile query for roughly 1-15% of a 5k sample", async () => {
    const records = [
      ...generateCorpus({ documents: SAMPLE_SIZE, seed: SAMPLE_SEED }),
    ];
    const documents = toSearchDocuments(records);

    const engine = new InMemorySearchEngine();
    await Promise.all(
      documents.map((document) => engine.upsertDocument(document))
    );
    await engine.setIndexVersion(1);
    const adapter = new SearchAdapter({ engine });

    const results = await Promise.all(
      profile.queries.map(async (query) => ({
        query,
        result: await adapter.search({ query: query.query }),
      }))
    );

    for (const { query, result } of results) {
      if (!result.ok) {
        throw new Error(
          `Query ${query.id} failed to parse: ${result.error.message}`
        );
      }

      const ratio = result.total / SAMPLE_SIZE;
      expect(ratio).toBeGreaterThanOrEqual(0.01);
      expect(ratio).toBeLessThanOrEqual(0.15);
    }
  });
});
