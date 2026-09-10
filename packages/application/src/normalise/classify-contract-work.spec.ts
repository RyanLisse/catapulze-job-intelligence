import { describe, expect, it } from "bun:test";

import onefellowFixture from "../../../../fixtures/connectors/onefellow/listing-page-0.json";
import { classifyContractAndWork } from "./classify-contract-work";
import { parseOnefellowPayload } from "./onefellow";

describe("classifyContractAndWork", () => {
  it("uses an explicit detachering alternative after ZZP negation", () => {
    expect(
      classifyContractAndWork(
        "Senior developer",
        "ZZP is NIET toegestaan. Alleen detachering."
      ).contracttype
    ).toBe("detachering");
  });

  it("leaves an excluded ZZP contract unknown without an alternative", () => {
    expect(
      classifyContractAndWork("Adviseur A", "Geen ZZP mogelijk.").contracttype
    ).toBeNull();
    expect(
      classifyContractAndWork("Opdracht", "ZZP is niet mogelijk.").contracttype
    ).toBeNull();
  });

  it("recognizes labelled ZZP exclusions", () => {
    expect(
      classifyContractAndWork("Opdracht", "ZZP mogelijkheid: Nee.").contracttype
    ).toBeNull();
    expect(
      classifyContractAndWork("Opdracht", "ZZP: Nee.").contracttype
    ).toBeNull();
    expect(
      classifyContractAndWork(
        "Opdracht",
        "ZZP mogelijkheid: Nee, alleen op basis van detachering."
      ).contracttype
    ).toBe("detachering");
  });

  it("replays excluded contracts from the recorded Onefellow listing", () => {
    for (const id of [944, 1006]) {
      const job = onefellowFixture.payload.jobs.find(
        (item) => item.joborder_id === id
      );
      if (!job) {
        throw new Error(`Missing recorded Onefellow job ${id}`);
      }
      const draft = parseOnefellowPayload({ job }, "fixture-hash");
      expect(
        classifyContractAndWork(job.title, draft.beschrijving.value)
          .contracttype
      ).toBeNull();
    }
  });

  it("recognizes exclusions recorded in Onefellow source prose", () => {
    for (const description of [
      "Deze functie is niet geschikt voor een zzp'er",
      "Inzet als zzp’er: niet toegestaan",
      "ZZP toegestaan: Nee",
    ]) {
      expect(
        classifyContractAndWork("Opdracht", description).contracttype
      ).toBeNull();
    }
  });

  it("does not let an excluded ZZP mention become freelance", () => {
    expect(
      classifyContractAndWork(
        "Adviseur A",
        "Geen ZZP mogelijk. Freelance inzet is niet toegestaan."
      ).contracttype
    ).toBeNull();
  });

  it("does not use a negated alternative as positive evidence", () => {
    expect(
      classifyContractAndWork(
        "Opdracht",
        "ZZP: Nee. Vast dienstverband niet mogelijk."
      ).contracttype
    ).toBeNull();
    expect(
      classifyContractAndWork("Opdracht", "ZZP: Nee. Interim niet toegestaan.")
        .contracttype
    ).toBeNull();
    expect(
      classifyContractAndWork("Opdracht", "ZZP: Nee. Detachering uitgesloten.")
        .contracttype
    ).toBeNull();
  });

  it("keeps positive ZZP evidence when another term is negated", () => {
    expect(
      classifyContractAndWork(
        "Opdracht",
        "Niet geschikt voor interim, maar ZZP mogelijk."
      ).contracttype
    ).toBe("freelance");
  });

  it("does not mistake another labelled answer for ZZP exclusion", () => {
    expect(
      classifyContractAndWork(
        "Opdracht",
        "ZZP ervaring: Nee. Freelance mogelijk."
      ).contracttype
    ).toBe("freelance");
    expect(
      classifyContractAndWork("Opdracht", "ZZP : Nee.").contracttype
    ).toBeNull();
  });

  it("does not treat unrelated ZZP context as an exclusion", () => {
    expect(
      classifyContractAndWork(
        "Freelance adviseur",
        "Geen ervaring met ZZP vereist; freelance inzet is mogelijk."
      ).contracttype
    ).toBe("freelance");
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
