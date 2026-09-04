import { describe, expect, it } from "bun:test";

import { buildKnnQueryText, emitMatch, buildQueryString } from "./emitter";

describe("manticore emitter", () => {
  it("covers AE1 MATCH for phrase + OR + NOT", () => {
    const queryString = buildQueryString({
      kind: "and",
      operands: [
        {
          kind: "or",
          operands: [
            { kind: "term", value: "Azure" },
            { kind: "phrase", value: "platform engineer" },
          ],
        },
        {
          kind: "not",
          operand: { kind: "term", value: "intern" },
        },
      ],
    });

    expect(queryString).toBe(
      '@(titel,beschrijving) (Azure | "platform engineer") -intern'
    );
    expect(emitMatch({ kind: "term", value: "Azure" })).toBe("Azure");
  });

  it("escapes special characters in terms", () => {
    expect(emitMatch({ kind: "term", value: "foo/bar" })).toBe('"foo/bar"');
  });

  it("builds auto-embedding text from positive terms and phrases only", () => {
    expect(
      buildKnnQueryText({
        kind: "and",
        operands: [
          { kind: "term", value: "Azure" },
          { kind: "phrase", value: "platform engineer" },
          {
            kind: "not",
            operand: {
              kind: "or",
              operands: [
                { kind: "term", value: "intern" },
                { kind: "term", value: "junior" },
              ],
            },
          },
        ],
      })
    ).toBe("Azure platform engineer");
  });

  it("returns null for NOT-only ASTs", () => {
    expect(
      buildKnnQueryText({
        kind: "not",
        operand: { kind: "term", value: "intern" },
      })
    ).toBeNull();
  });
});
