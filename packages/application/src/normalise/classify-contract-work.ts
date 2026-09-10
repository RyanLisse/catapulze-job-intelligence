/**
 * Shared contracttype / werkvorm classifier for Dutch inhuur prose.
 * Negation-aware: an explicit ZZP exclusion wins over a bare zzp match.
 * If no other contract form is stated, an exclusion remains unknown.
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
  /\bzzp(?:['’]ers?)?\b\s*(?::\s*)?(?:(?:is|zijn|wordt|worden)\s+)?(?:niet toegestaan|niet mogelijk|uitgesloten|niet geschikt)\b/iu;
const ZZP_NEGATION_REVERSE =
  /\b(?:niet toegestaan|niet mogelijk|uitgesloten|niet geschikt)\b(?:\s*:)?\s*(?:(?:voor|als)\s+)?(?:een\s+)?\bzzp(?:['’]ers?)?\b/iu;
const ZZP_NEGATION_GEEN =
  /\bgeen\s+zzp(?:['’]ers?)?\b(?:\s+(?:mogelijk|toegestaan|beschikbaar)|(?=\s*[.,;:!?]|$))/iu;
const ZZP_NEGATION_BOOLEAN =
  /\bzzp(?:['’]ers?)?\b\s*(?:(?:mogelijk(?:heid)?|toegestaan)\s*)?:\s*nee(?:n)?\b/iu;
// "inhuur" is the domain umbrella for every commercial form — never map it
// alone to detachering. "interim" has its own branch below.
const DETACHERING = /\b(?<kind>detachering|detacheren|deta-?vast)\b/iu;
const FREELANCE = /\b(?<kind>freelance|zzp|marktplaats\s*\(freelance\))\b/iu;
const VAST = /\b(?<kind>vast dienstverband|vaste aanstelling|permanent)\b/iu;
const INTERIM = /\b(?<kind>interim)\b/iu;

const REMOTE = /\b(?<kind>remote|thuiswerk(?:en)?|telecommute|vanuit huis)\b/iu;
const HYBRID = /\b(?<kind>hybride|hybrid)\b/iu;
const ONSITE = /\b(?<kind>op locatie|op kantoor|fysiek op kantoor|onsite)\b/iu;

const CONTRACT_CLAUSE_SEPARATOR = /[.!?;,\n]+/u;
const CONTRACT_NEGATION_BEFORE =
  /\b(?:geen|niet toegestaan|niet mogelijk|uitgesloten|niet geschikt)\b(?:\s+(?:voor|als))?\s*$/iu;
const CONTRACT_NEGATION_AFTER =
  /^\s*(?::\s*|(?:mogelijk(?:heid)?)\s*:\s*)?(?:(?:is|zijn|wordt|worden)\s+)?(?:nee(?:n)?|niet toegestaan|niet mogelijk|uitgesloten|niet geschikt)\b/iu;

const splitContractClauses = (text: string): string[] =>
  text.split(CONTRACT_CLAUSE_SEPARATOR);

const hasPositiveContractTerm = (
  clauses: string[],
  pattern: RegExp
): boolean => {
  const globalPattern = new RegExp(pattern.source, `${pattern.flags}g`);
  for (const clause of clauses) {
    for (const match of clause.matchAll(globalPattern)) {
      const index = match.index ?? 0;
      const before = clause.slice(Math.max(0, index - 40), index);
      const after = clause.slice(index + match[0].length);
      if (
        !CONTRACT_NEGATION_BEFORE.test(before) &&
        !CONTRACT_NEGATION_AFTER.test(after)
      ) {
        return true;
      }
    }
  }
  return false;
};

const classifyContracttype = (text: string): ClassifiedContractType | null => {
  const clauses = splitContractClauses(text);
  const zzpIsNegated = clauses.some(
    (clause) =>
      ZZP_NEGATION.test(clause) ||
      ZZP_NEGATION_REVERSE.test(clause) ||
      ZZP_NEGATION_GEEN.test(clause) ||
      ZZP_NEGATION_BOOLEAN.test(clause)
  );
  const hasPositiveDetachering = hasPositiveContractTerm(clauses, DETACHERING);
  const hasPositiveVast = hasPositiveContractTerm(clauses, VAST);
  const hasPositiveInterim = hasPositiveContractTerm(clauses, INTERIM);
  const hasPositiveFreelance = hasPositiveContractTerm(clauses, FREELANCE);
  if (zzpIsNegated) {
    if (hasPositiveDetachering) {
      return "detachering";
    }
    if (hasPositiveVast) {
      return "vast";
    }
    if (hasPositiveInterim) {
      return "interim";
    }
    return null;
  }
  if (hasPositiveVast && !hasPositiveDetachering && !hasPositiveFreelance) {
    return "vast";
  }
  if (hasPositiveFreelance && !hasPositiveDetachering && !hasPositiveInterim) {
    return "freelance";
  }
  if (hasPositiveInterim && !hasPositiveDetachering) {
    return "interim";
  }
  if (hasPositiveDetachering) {
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
