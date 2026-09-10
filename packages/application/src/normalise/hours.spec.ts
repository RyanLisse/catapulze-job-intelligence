import { describe, expect, it } from "bun:test";

import { formatHoursPerWeek } from "./hours";

describe("formatHoursPerWeek", () => {
  it("formats equal bounds as one weekly value", () => {
    expect(formatHoursPerWeek(36, 36)).toBe("36");
  });

  it("formats a range with an en dash", () => {
    expect(formatHoursPerWeek(24, 36)).toBe("24–36");
  });

  it("preserves a minimum-only bound", () => {
    expect(formatHoursPerWeek(24, null)).toBe("≥24");
  });

  it("preserves a maximum-only bound", () => {
    expect(formatHoursPerWeek(null, 36)).toBe("≤36");
  });

  it("returns null when neither bound is published", () => {
    expect(formatHoursPerWeek(null, null)).toBeNull();
  });

  it("rejects negative, non-numeric, and inverted bounds", () => {
    expect(formatHoursPerWeek(-1, 36)).toBeNull();
    expect(formatHoursPerWeek("unknown", 36)).toBeNull();
    expect(formatHoursPerWeek(40, 24)).toBeNull();
  });
});
