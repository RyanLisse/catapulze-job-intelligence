import { describe, expect, it } from "bun:test";

import { JOB_FIXTURES } from "./fixtures";
import {
  formatRate,
  validateBooleanPreview,
  describeApiSyntaxError,
} from "./presentation";

describe("Boolean query preview validation", () => {
  it("accepts balanced Boolean expressions", () => {
    expect(
      validateBooleanPreview('(Azure OR "Power BI") NOT junior')
    ).toBeNull();
  });

  it("explains unbalanced groups and quotes", () => {
    expect(validateBooleanPreview("(Azure OR data")).toContain(
      "afsluitende haak"
    );
    expect(validateBooleanPreview('"data engineer')).toContain(
      "aanhalingsteken"
    );
    expect(validateBooleanPreview("Azure) AND data")).toContain("positie 6");
    expect(validateBooleanPreview("(Azure OR)")).toContain("positie 10");
  });

  it("describes parser offsets for API syntax failures", () => {
    expect(
      describeApiSyntaxError("Unexpected closing parenthesis", 4)
    ).toContain("positie 5");
  });
});

describe("job presentation", () => {
  it("keeps unknown rates explicit", () => {
    const unknownRateJob = JOB_FIXTURES.find(({ rate }) => rate === null);
    if (!unknownRateJob) {
      throw new Error("Expected a fixture with an unknown rate");
    }
    expect(formatRate(unknownRateJob)).toBe("Tarief onbekend");
  });
});
