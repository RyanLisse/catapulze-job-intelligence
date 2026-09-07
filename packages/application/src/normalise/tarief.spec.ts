import { describe, expect, it } from "bun:test";

import { UNKNOWN } from "@ji/domain";

import { parseTariefFromText } from "./tarief";

describe("parseTariefFromText", () => {
  it("parses a single euro amount as max-only hourly", () => {
    expect(parseTariefFromText("Tarief: € 77,50 inclusief MSP fee")).toEqual({
      eenheid: "uur",
      max: "77.50",
      min: UNKNOWN,
      valuta: "EUR",
    });
  });

  it("parses tot/max without a min", () => {
    expect(parseTariefFromText("Tarief: max. €110")).toMatchObject({
      eenheid: "uur",
      max: "110",
      min: UNKNOWN,
    });
    expect(parseTariefFromText("tot €106,50 per uur")).toMatchObject({
      max: "106.50",
      min: UNKNOWN,
    });
  });

  it("parses tussen ranges and strips thousand points", () => {
    expect(
      parseTariefFromText("Tarief: tussen € 95,00 en € 109,00")
    ).toMatchObject({
      max: "109.00",
      min: "95.00",
    });
    expect(parseTariefFromText("max € 1.250 per dag")).toMatchObject({
      eenheid: "dag",
      max: "1250",
      min: UNKNOWN,
    });
  });

  it("parses bare euro ranges used by needstaffing-style listings", () => {
    expect(parseTariefFromText("tarief 85-95 euro")).toMatchObject({
      max: "95",
      min: "85",
    });
  });

  it("keeps qualitative vocabulary as unknown", () => {
    expect(parseTariefFromText("Tarief: marktconform")).toEqual({
      eenheid: UNKNOWN,
      max: UNKNOWN,
      min: UNKNOWN,
      valuta: "EUR",
    });
  });
});
