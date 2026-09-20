import { describe, expect, it } from "bun:test";

import { parseArgs } from "./field-coverage";
import type { SourceReport } from "./field-coverage";
import {
  formatReport,
  keyCategory,
  missingDisplayFields,
} from "./source-to-ui-gap";

const reportOf = (
  slug: string,
  {
    records = 1,
    fields = {},
    keys = {},
    errors = [],
  }: {
    records?: number;
    fields?: Partial<Record<string, number>>;
    keys?: Record<string, number>;
    errors?: string[];
  } = {}
): SourceReport => ({
  bronId: `id-${slug}`,
  errors,
  fields: {
    contract: 0,
    duur: 0,
    einddatum: 0,
    gepubliceerd: 0,
    locatie: 0,
    opleiding: 0,
    organisatie: 0,
    provincie: 0,
    skills: 0,
    sluit: 0,
    startdatum: 0,
    tarief: 0,
    uren: 0,
    werkvorm: 0,
    ...fields,
  },
  keys,
  records,
  rejected: 0,
  slug,
});

describe("parseArgs", () => {
  it("parses a source filter and JSON output", () => {
    expect(parseArgs(["--bron", "werkzoeken", "--json"])).toEqual({
      asJson: true,
      bron: "werkzoeken",
    });
  });

  it("rejects a source flag without a value", () => {
    expect(() => parseArgs(["--bron"])).toThrow(
      "--bron requires a source slug"
    );
    expect(() => parseArgs(["--bron", "--json"])).toThrow(
      "--bron requires a source slug"
    );
  });

  it("rejects duplicate source filters and unknown arguments", () => {
    expect(() => parseArgs(["--bron", "a", "--bron", "b"])).toThrow(
      "--bron may only be provided once"
    );
    expect(() => parseArgs(["--wat"])).toThrow("unknown argument: --wat");
  });
});

describe("keyCategory", () => {
  it("classifies keys consumed by either UI display seam as displayed", () => {
    for (const key of [
      "contracttype",
      "opleidingsniveau",
      "publicatiedatum",
      "skills",
      "provincie",
      "start_datum",
      "looptijd_tekst",
      "uren_per_week",
      "uren_per_week_raw",
      "eind_datum",
      "eindDatum",
      "employment_type",
      "werkvorm",
    ]) {
      expect(keyCategory(key)).toBe("displayed");
    }
  });

  it("classifies identity and reference keys as identity", () => {
    expect(keyCategory("url")).toBe("identity");
    expect(keyCategory("referentienummer")).toBe("identity");
    expect(keyCategory("slug")).toBe("identity");
  });

  it("classifies status and source metadata as status", () => {
    expect(keyCategory("source")).toBe("status");
    expect(keyCategory("framework")).toBe("status");
  });

  it("classifies procedure and contract metadata as procedure", () => {
    expect(keyCategory("procedure_type")).toBe("procedure");
    expect(keyCategory("estimated_value_type")).toBe("procedure");
  });

  it("classifies unknown keys as unused", () => {
    expect(keyCategory("unknown_custom_key")).toBe("unused");
  });
});

describe("missingDisplayFields", () => {
  it("returns top-level fields with zero coverage and bronSpecifiek-driven fields whose source data did not land", () => {
    const report = reportOf("bron-a", {
      fields: { tarief: 2, werkvorm: 1 },
      records: 2,
    });

    expect(missingDisplayFields(report)).toEqual(["locatie", "sluit"]);
  });

  it("returns no missing fields when no records were replayed", () => {
    const report = reportOf("bron-a", { records: 0 });

    expect(missingDisplayFields(report)).toEqual([]);
  });

  it("does not flag bronSpecifiek-driven fields when the source published no data for them", () => {
    const report = reportOf("bron-a", {
      fields: {
        contract: 2,
        duur: 2,
        einddatum: 2,
        gepubliceerd: 2,
        locatie: 1,
        opleiding: 0,
        organisatie: 2,
        provincie: 0,
        skills: 0,
        sluit: 1,
        startdatum: 2,
        tarief: 1,
        uren: 2,
        werkvorm: 2,
      },
      keys: {},
      records: 2,
    });

    expect(missingDisplayFields(report)).toEqual([]);
  });

  it("flags bronSpecifiek-driven fields with source data but zero coverage", () => {
    const report = reportOf("bron-a", {
      fields: {
        contract: 2,
        duur: 2,
        einddatum: 2,
        gepubliceerd: 2,
        locatie: 1,
        opleiding: 0,
        organisatie: 2,
        provincie: 0,
        skills: 0,
        sluit: 1,
        startdatum: 2,
        tarief: 1,
        uren: 2,
        werkvorm: 2,
      },
      keys: {
        education_level: 2,
        provincie: 1,
        skills: 2,
      },
      records: 2,
    });

    expect(missingDisplayFields(report)).toEqual([
      "opleiding",
      "provincie",
      "skills",
    ]);
  });
});

describe("formatReport", () => {
  it("includes a compact summary row per source", () => {
    const report = reportOf("bron-a", {
      errors: ["fetch failed"],
      fields: { gepubliceerd: 3, organisatie: 3, tarief: 1 },
      keys: {
        contracttype: 3,
        identifier: 3,
        unknown_custom_key: 2,
      },
      records: 3,
    });

    const output = formatReport([report]);

    expect(output).toContain("bron-a");
    expect(output).toContain("3");
    expect(output).toContain("miss");
    expect(output).toContain("disp");
    expect(output).toContain("gap");
    expect(output).toContain("unclass");
    expect(output).toContain("errs");
  });

  it("omits sources with no gaps or errors from the detail section", () => {
    const report = reportOf("bron-a", {
      fields: {
        contract: 1,
        duur: 1,
        einddatum: 1,
        gepubliceerd: 1,
        locatie: 1,
        opleiding: 1,
        organisatie: 1,
        provincie: 1,
        skills: 1,
        sluit: 1,
        startdatum: 1,
        tarief: 1,
        uren: 1,
        werkvorm: 1,
      },
      keys: { contracttype: 1 },
      records: 1,
    });

    const output = formatReport([report]);

    expect(output).toContain("bron-a");
    expect(output).not.toContain("detail per source");
  });

  it("lists missing fields, categories and unused keys in detail", () => {
    const report = reportOf("bron-a", {
      fields: { organisatie: 2 },
      keys: {
        contracttype: 2,
        identifier: 2,
        unknown_custom_key: 2,
      },
      records: 2,
    });

    const output = formatReport([report]);

    expect(output).toContain("missing display fields:");
    expect(output).toContain("displayed derived keys:");
    expect(output).toContain("identity/metadata keys:");
    expect(output).toContain("unclassified keys (inspect UI mapping):");
    expect(output).toContain("unknown_custom_key");
  });
});
