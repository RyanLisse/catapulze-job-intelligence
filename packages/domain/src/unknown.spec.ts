import { describe, expect, it } from "bun:test";

import { UNKNOWN, isUnknown } from "./unknown";

describe("unknown domain value", () => {
  it("treats the canonical unknown token as unknown", () => {
    expect(isUnknown(UNKNOWN)).toBe(true);
  });

  it("does not treat a real field value as unknown", () => {
    expect(isUnknown("Amsterdam")).toBe(false);
  });
});
