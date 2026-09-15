import { describe, expect, test } from "bun:test";

import { toCanonicalContractType } from "./contract-type";

describe("toCanonicalContractType", () => {
  test("maps detachering-family tokens to detachering", () => {
    expect(toCanonicalContractType("detachering")).toBe("detachering");
    expect(toCanonicalContractType("  Detachering  ")).toBe("detachering");
  });

  test("maps interim-family tokens (temporary, tijdelijk, inhuur, interim) to interim", () => {
    expect(toCanonicalContractType("temporary")).toBe("interim");
    expect(toCanonicalContractType("tijdelijk")).toBe("interim");
    expect(toCanonicalContractType("inhuur")).toBe("interim");
    expect(toCanonicalContractType("interim")).toBe("interim");
  });

  test("maps freelance-family tokens (contractor, zzp) case-insensitively to freelance", () => {
    expect(toCanonicalContractType("CONTRACTOR")).toBe("freelance");
    expect(toCanonicalContractType("contractor")).toBe("freelance");
    expect(toCanonicalContractType("freelance")).toBe("freelance");
    expect(toCanonicalContractType("zzp")).toBe("freelance");
  });

  test("maps vast-family tokens to vast", () => {
    expect(toCanonicalContractType("permanent")).toBe("vast");
    expect(toCanonicalContractType("vast")).toBe("vast");
    expect(toCanonicalContractType("vast dienstverband")).toBe("vast");
  });

  test("returns null for hours/employment tokens that are not a contract form", () => {
    expect(toCanonicalContractType("FULL_TIME")).toBeNull();
    expect(toCanonicalContractType("PART_TIME")).toBeNull();
    expect(toCanonicalContractType("OTHER")).toBeNull();
  });

  test("returns null for empty, null and undefined input", () => {
    expect(toCanonicalContractType("")).toBeNull();
    expect(toCanonicalContractType(null)).toBeNull();
    expect(toCanonicalContractType()).toBeNull();
  });
});
