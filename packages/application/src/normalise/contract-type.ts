/**
 * Canonical mapping from a source's raw `contract_type` / `employmentType`
 * token to the web `JobContractType` vocabulary (CTP-514, F06).
 *
 * Sources publish tokens the web layer does not understand: Dutch prose
 * ("tijdelijk"), English enums ("CONTRACTOR"), and JSON-LD `employmentType`
 * values that describe hours or employment rather than contract form
 * ("FULL_TIME", "PART_TIME"). Only an explicit, unambiguous token maps to a
 * {@link ClassifiedContractType}; everything else -- including tokens that
 * describe something other than contract form -- yields null so the caller
 * may fall back to the prose classifier or leave the column empty.
 */

import type { ClassifiedContractType } from "./classify-contract-work";

const CONTRACT_TYPE_TOKENS = new Map<string, ClassifiedContractType>(
  Object.entries({
    contractor: "freelance",
    detachering: "detachering",
    freelance: "freelance",
    interim: "interim",
    permanent: "vast",
    temporary: "interim",
    tijdelijk: "interim",
    vast: "vast",
    "vast dienstverband": "vast",
    zzp: "freelance",
  })
);

/**
 * Maps a source's raw contract-type token to the canonical vocabulary,
 * case/whitespace-insensitive. Returns null for absent input and for any
 * token not in the explicit map (e.g. `FULL_TIME`, `PART_TIME`, `OTHER`).
 */
export const toCanonicalContractType = (
  token?: string | null
): ClassifiedContractType | null => {
  if (token === null || token === undefined) {
    return null;
  }
  const key = token.trim().toLowerCase();
  return CONTRACT_TYPE_TOKENS.get(key) ?? null;
};
