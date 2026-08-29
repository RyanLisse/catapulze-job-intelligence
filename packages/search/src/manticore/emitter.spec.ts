import { describe, expect, it } from "bun:test";

import { emitMatch, buildQueryString } from "./emitter";

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
});
