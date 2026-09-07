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

  it("classifies hybride and remote werkvormen", () => {
    expect(
      classifyContractAndWork("Rol", "Hybride: Ja met een vaste dag.").werkvorm
    ).toBe("Hybride");
    expect(
      classifyContractAndWork("Rol", "Remote werken is ook mogelijk.").werkvorm
    ).toBe("Remote");
  });
});
