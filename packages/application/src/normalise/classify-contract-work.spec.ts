import { describe, expect, it } from "bun:test";

import { classifyContractAndWork } from "./classify-contract-work";

describe("classifyContractAndWork", () => {
  it("treats ZZP negation as detachering", () => {
    expect(
      classifyContractAndWork(
        "Senior developer",
        "ZZP is NIET toegestaan. Alleen detachering."
      ).contracttype
    ).toBe("detachering");
  });

  it("classifies freelance when zzp is allowed", () => {
    expect(
      classifyContractAndWork("Opdracht", "Geschikt voor zzp'ers.").contracttype
    ).toBe("freelance");
  });

  it("classifies bare interim as interim, not detachering", () => {
    expect(
      classifyContractAndWork("Rol", "Interim professional gezocht.")
        .contracttype
    ).toBe("interim");
  });

  it("does not treat generic inhuur prose as detachering", () => {
    expect(
      classifyContractAndWork(
        "Analyst",
        "Wij zoeken versterking via inhuur voor dit project."
      ).contracttype
    ).toBeNull();
  });

  it("still classifies explicit detachering", () => {
    expect(
      classifyContractAndWork("Rol", "Via detachering beschikbaar.")
        .contracttype
    ).toBe("detachering");
  });

  it("classifies hybride and remote werkvormen", () => {
    expect(
      classifyContractAndWork("Rol", "Hybride: Ja met een vaste dag.").werkvorm
    ).toBe("Hybride");
    expect(
      classifyContractAndWork("Rol", "Remote werken is ook mogelijk.").werkvorm
    ).toBe("Remote");
  });
});
