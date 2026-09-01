import { describe, expect, it } from "bun:test";

import { PostgresFtsFallbackEngine } from "./postgres-fts-fallback";
import type { SearchDocument } from "./types";

const makeDocument = (id: string): SearchDocument => ({
  beschrijving: "beschrijving",
  bronId: "bron-1",
  contracttype: null,
  id,
  laatstGezienOp: new Date("2026-01-01T00:00:00.000Z"),
  locatieLand: "NL",
  status: "active",
  tariefMax: null,
  tariefMin: null,
  titel: "titel",
});

describe("PostgresFtsFallbackEngine tie order (RJC-396)", () => {
  it("breaks ties in codepoint order, not locale-aware collation order", async () => {
    // "a" (0x61) sorts after "A" (0x41) by codepoint, the OPPOSITE of
    // case-insensitive locale collation order — see ast-hash.spec.ts for
    // the same divergence asserted directly on compareCodepoints.
    const engine = new PostgresFtsFallbackEngine(undefined, [
      makeDocument("a"),
      makeDocument("A"),
    ]);

    const result = await engine.search({
      ast: null,
      filters: {},
      limit: 10,
      offset: 0,
    });

    expect(result.hits.map((hit) => hit.id)).toEqual(["A", "a"]);
  });
});
