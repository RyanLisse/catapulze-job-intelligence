import { describe, expect, it } from "bun:test";

import type { JsonValue } from "@ji/application/normalise";

import { evaluateContractCoverage } from "./field-coverage";

const bron = (value: Record<string, JsonValue>): Record<string, JsonValue> =>
  value;

describe("evaluateContractCoverage", () => {
  it("counts canonical contracttype values", () => {
    expect(evaluateContractCoverage(bron({ contracttype: "vast" }))).toBe(true);
    expect(evaluateContractCoverage(bron({ contracttype: "interim" }))).toBe(
      true
    );
  });

  it("counts canonical contract_type values", () => {
    expect(evaluateContractCoverage(bron({ contract_type: "freelance" }))).toBe(
      true
    );
    expect(
      evaluateContractCoverage(bron({ contract_type: "detachering" }))
    ).toBe(true);
  });

  it("counts employment_type when at least one token maps to a contract form", () => {
    expect(
      evaluateContractCoverage(bron({ employment_type: "TEMPORARY" }))
    ).toBe(true);
    expect(
      evaluateContractCoverage(
        bron({ employment_type: "TEMPORARY, FULL_TIME" })
      )
    ).toBe(true);
    expect(
      evaluateContractCoverage(
        bron({ employment_type: "CONTRACTOR, PART_TIME" })
      )
    ).toBe(true);
  });

  it("rejects employment_type tokens that do not describe contract form", () => {
    expect(
      evaluateContractCoverage(bron({ employment_type: "FULL_TIME" }))
    ).toBe(false);
    expect(
      evaluateContractCoverage(
        bron({ employment_type: "PART_TIME, FULL_TIME" })
      )
    ).toBe(false);
    expect(evaluateContractCoverage(bron({ employment_type: "OTHER" }))).toBe(
      false
    );
  });

  it("rejects conflicting contract forms in employment_type", () => {
    expect(
      evaluateContractCoverage(
        bron({ employment_type: "TEMPORARY, CONTRACTOR" })
      )
    ).toBe(false);
  });

  it("ignores sentinel and blank values", () => {
    expect(evaluateContractCoverage(bron({ contracttype: "unknown" }))).toBe(
      false
    );
    expect(evaluateContractCoverage(bron({ contracttype: "" }))).toBe(false);
    expect(evaluateContractCoverage(bron({ contracttype: "   " }))).toBe(false);
    expect(
      evaluateContractCoverage(
        bron({ contract_type: "vast", contracttype: "cleared" })
      )
    ).toBe(true);
  });

  it("returns false when no contract keys are present", () => {
    expect(evaluateContractCoverage(bron({}))).toBe(false);
    expect(evaluateContractCoverage(bron({ tarief: "40" }))).toBe(false);
  });
});
