/**
 * Shared contracttype / werkvorm classifier for Dutch inhuur prose.
 * Negation-aware: "ZZP is niet toegestaan" wins over a bare zzp match.
 * Emits only literals accepted by the web mapContractType allowlist.
 */

export type ClassifiedContractType =
  | "detachering"
  | "freelance"
  | "interim"
  | "vast";

export type ClassifiedWorkArrangement = "Hybride" | "Op locatie" | "Remote";

export interface ClassifiedContractWork {
  readonly contracttype: ClassifiedContractType | null;
  readonly werkvorm: ClassifiedWorkArrangement | null;
}

const ZZP_NEGATION =
  /\bzzp\b[^.\n]{0,60}\b(?<negation>niet toegestaan|niet mogelijk|uitgesloten|niet geschikt)\b/iu;
const ZZP_NEGATION_REVERSE =
  /\b(?<negation>niet toegestaan|niet mogelijk|uitgesloten|niet geschikt)\b[^.\n]{0,60}\bzzp\b/iu;
// "inhuur" is the domain umbrella for every commercial form — never map it
// alone to detachering. "interim" has its own branch below.
const DETACHERING = /\b(?<kind>detachering|detacheren|deta-?vast)\b/iu;
const FREELANCE = /\b(?<kind>freelance|zzp|marktplaats\s*\(freelance\))\b/iu;
const VAST = /\b(?<kind>vast dienstverband|vaste aanstelling|permanent)\b/iu;
const INTERIM = /\b(?<kind>interim)\b/iu;

const REMOTE = /\b(?<kind>remote|thuiswerk(?:en)?|telecommute|vanuit huis)\b/iu;
const HYBRID = /\b(?<kind>hybride|hybrid)\b/iu;
const ONSITE = /\b(?<kind>op locatie|op kantoor|fysiek op kantoor|onsite)\b/iu;

const classifyContracttype = (text: string): ClassifiedContractType | null => {
  if (ZZP_NEGATION.test(text) || ZZP_NEGATION_REVERSE.test(text)) {
    return "detachering";
  }
  if (VAST.test(text) && !DETACHERING.test(text) && !FREELANCE.test(text)) {
    return "vast";
  }
  if (FREELANCE.test(text) && !DETACHERING.test(text) && !INTERIM.test(text)) {
    return "freelance";
  }
  if (INTERIM.test(text) && !DETACHERING.test(text)) {
    return "interim";
  }
  if (DETACHERING.test(text)) {
    return "detachering";
  }
  return null;
};

const classifyWerkvorm = (text: string): ClassifiedWorkArrangement | null => {
  if (HYBRID.test(text)) {
    return "Hybride";
  }
  if (REMOTE.test(text)) {
    return "Remote";
  }
  if (ONSITE.test(text)) {
    return "Op locatie";
  }
  return null;
};

export const classifyContractAndWork = (
  title: string,
  description: string
): ClassifiedContractWork => {
  const text = `${title}\n${description}`;
  return {
    contracttype: classifyContracttype(text),
    werkvorm: classifyWerkvorm(text),
  };
};
