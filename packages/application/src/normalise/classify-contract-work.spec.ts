import { describe, expect, it } from "bun:test";

import onefellowFixture from "../../../../fixtures/connectors/onefellow/listing-page-0.json";
import {
  classifyContractAndWork,
  matchFreelanceExclusion,
} from "./classify-contract-work";
import type { ClassifiedContractType } from "./classify-contract-work";
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

describe("CTP-491 freelance exclusions", () => {
  const excluded = [
    "Geen ZZP mogelijk.",
    "Geen ZZP.",
    "Geen ZZP'ers.",
    "Geen zzp\u2019ers gezocht.",
    "ZZP niet mogelijk.",
    "ZZP is niet mogelijk.",
    "ZZP niet toegestaan.",
    "Geen freelance.",
    "Geen freelancers.",
    "Freelance niet mogelijk.",
    "Freelance is niet toegestaan.",
    "Niet voor ZZP.",
    "Niet voor zzp'ers.",
    "Niet bedoeld voor freelancers.",
  ];

  it("never labels an excluded vacancy freelance", () => {
    for (const description of excluded) {
      expect(
        classifyContractAndWork("Adviseur A", description).contracttype
      ).toBeNull();
    }
  });

  it("names the phrase behind every exclusion", () => {
    for (const description of excluded) {
      expect(matchFreelanceExclusion(description)).not.toBeNull();
    }
  });

  it("keeps the proven alternative after an exclusion", () => {
    expect(
      classifyContractAndWork(
        "Adviseur A",
        "Geen ZZP mogelijk. Uitsluitend detachering."
      ).contracttype
    ).toBe("detachering");
    expect(
      classifyContractAndWork("Adviseur A", "Niet voor ZZP, wel detachering.")
        .contracttype
    ).toBe("detachering");
  });

  it("invents no contract form for a bare exclusion", () => {
    expect(matchFreelanceExclusion("Uitsluitend detachering.")).toBeNull();
    expect(
      classifyContractAndWork("Adviseur A", "Uitsluitend detachering.")
        .contracttype
    ).toBe("detachering");
  });

  it("keeps the positive controls classifying as before", () => {
    expect(
      classifyContractAndWork("Adviseur A", "ZZP mogelijk.").contracttype
    ).toBe("freelance");
    expect(
      classifyContractAndWork("Adviseur A", "Freelance of detachering.")
        .contracttype
    ).toBe("detachering");
    expect(
      classifyContractAndWork("Adviseur A", "Geschikt voor zzp'ers.")
        .contracttype
    ).toBe("freelance");
    for (const description of ["ZZP mogelijk.", "Geschikt voor zzp'ers."]) {
      expect(matchFreelanceExclusion(description)).toBeNull();
    }
  });

  it("replays the exclusions recorded in the connector fixtures", () => {
    const recorded: readonly [string, ClassifiedContractType | null][] = [
      ["Inzet als zzp\u2019er: niet toegestaan", null],
      ["Deze functie is niet geschikt voor een zzp'er", null],
      ["ZZP mogelijk:  Nee alleen op basis van detachering", "detachering"],
      ["Uren: 36 per week ZZP: Nee  Locatie: Arnhem", null],
      ["ZZP mogelijkheid: Nee Tarief: tussen 95,00 en 109,00", null],
      ["FIN (Belastingdienst) / ZZP is NIET toegestaan", null],
    ];
    for (const [description, expected] of recorded) {
      expect(
        classifyContractAndWork("Opdracht", description).contracttype
      ).toBe(expected);
    }
  });

  it("does not read a requirement as an exclusion", () => {
    expect(
      matchFreelanceExclusion("Geen zzp ervaring vereist, freelance mogelijk.")
    ).toBeNull();
    expect(
      classifyContractAndWork(
        "Opdracht",
        "Geen zzp ervaring vereist, freelance mogelijk."
      ).contracttype
    ).toBe("freelance");
  });

  it("leaves a soft warning classified as freelance", () => {
    // Striive prose: a discouragement, not an exclusion, so it stays freelance.
    expect(
      matchFreelanceExclusion(
        "Opdracht is minder geschikt voor ZZP\u2019ers ivm wet DBA"
      )
    ).toBeNull();
    expect(
      classifyContractAndWork(
        "Opdracht",
        "Opdracht is minder geschikt voor ZZP\u2019ers ivm wet DBA"
      ).contracttype
    ).toBe("freelance");
  });
});
