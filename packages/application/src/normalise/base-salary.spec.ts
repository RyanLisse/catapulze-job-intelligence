import { describe, expect, it } from "bun:test";

import { tariefFromBaseSalary } from "./base-salary";

describe("tariefFromBaseSalary", () => {
  it("parses a nested monthly QuantitativeValue range", () => {
    expect(
      tariefFromBaseSalary({
        currency: "EUR",
        value: {
          maxValue: 6500,
          minValue: 3150,
          unitText: "MONTH",
        },
      })
    ).toEqual({
      eenheid: "maand",
      max: "6500",
      min: "3150",
      valuta: "EUR",
    });
  });

  it("parses a flat node and normalises decimal comma and lowercase units", () => {
    expect(
      tariefFromBaseSalary({
        unitText: "uur",
        value: "85,5",
      })
    ).toEqual({
      eenheid: "uur",
      max: "85.5",
      min: "85.5",
      valuta: "EUR",
    });
  });

  it("defaults missing currency to EUR", () => {
    expect(
      tariefFromBaseSalary({
        unitText: "DAY",
        value: 500,
      })
    ).toMatchObject({ valuta: "EUR" });
  });

  it("returns null when unitText is missing", () => {
    expect(tariefFromBaseSalary({ value: 500 })).toBeNull();
  });

  it("rejects a zero placeholder", () => {
    expect(tariefFromBaseSalary({ unitText: "HOUR", value: 0 })).toBeNull();
  });

  it("rejects a non-positive minimum", () => {
    expect(
      tariefFromBaseSalary({
        maxValue: 100,
        minValue: -1,
        unitText: "HOUR",
      })
    ).toBeNull();
  });

  it.each([
    { baseSalary: "salary" },
    { baseSalary: [] },
    { baseSalary: undefined },
  ])("returns null for non-object baseSalary", ({ baseSalary }) => {
    expect(tariefFromBaseSalary(baseSalary)).toBeNull();
  });
});
