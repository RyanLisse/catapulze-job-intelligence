/**
 * Shared contracttype / werkvorm classifier for Dutch inhuur prose.
 * Negation-aware: an explicit ZZP or freelance exclusion wins over a bare
 * zzp/freelance match. If no other contract form is stated, an exclusion
 * remains unknown.
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

/**
 * Every wording the source prose uses for the freelance contract form.
 * Shared by the exclusion table so a phrasing added here is recognised in
 * every negation shape at once.
 */
const FREELANCE_TERM = String.raw`(?:zzp(?:['’]ers?)?|freelance(?:rs?)?)`;
const DENIAL = String.raw`(?:niet toegestaan|niet mogelijk|uitgesloten|niet geschikt)`;
/** Words that confirm "geen <freelance term>" is an exclusion of the form. */
const EXCLUSION_TAIL = String.raw`(?:mogelijk|toegestaan|beschikbaar|gezocht|gewenst|welkom|geaccepteerd)`;

/**
 * Explicit exclusions of the freelance contract form, one row per sentence
 * shape. Order does not matter: a hit in any row means the text excludes
 * freelance work, so a positive freelance match must never win.
 */
const FREELANCE_EXCLUSIONS: readonly RegExp[] = [
  // "zzp niet mogelijk", "zzp is niet toegestaan", "zzp: uitgesloten"
  new RegExp(
    String.raw`\b${FREELANCE_TERM}\b\s*(?::\s*)?(?:(?:is|zijn|wordt|worden)\s+)?${DENIAL}\b`,
    "iu"
  ),
  // "niet toegestaan voor zzp", "uitgesloten: freelance"
  new RegExp(
    String.raw`\b${DENIAL}\b(?:\s*:)?\s*(?:(?:voor|als)\s+)?(?:een\s+)?\b${FREELANCE_TERM}\b`,
    "iu"
  ),
  // "geen zzp", "geen zzp mogelijk", "geen zzp'ers gezocht", "geen freelancers."
  // The trailing word is constrained so "geen zzp ervaring vereist" -- a
  // requirement, not an exclusion -- stays out of the table.
  new RegExp(
    String.raw`\bgeen\s+${FREELANCE_TERM}\b(?:\s+${EXCLUSION_TAIL}|(?=\s*[.,;:!?]|$))`,
    "iu"
  ),
  // "zzp mogelijkheid: nee", "freelance: nee"
  new RegExp(
    String.raw`\b${FREELANCE_TERM}\b\s*(?:(?:mogelijk(?:heid)?|toegestaan)\s*)?:\s*nee(?:n)?\b`,
    "iu"
  ),
  // "niet voor zzp", "niet bedoeld voor freelancers"
  new RegExp(
    String.raw`\bniet\s+(?:bedoeld\s+|bestemd\s+|beschikbaar\s+|open\s+)?(?:voor|als)\s+(?:een\s+)?${FREELANCE_TERM}\b`,
    "iu"
  ),
];

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

/**
 * The phrase that excludes freelance work, or null when the text states no
 * such exclusion. Matching runs per clause so a denial cannot reach across a
 * sentence boundary. The report-only backfill tool reuses this to name the
 * phrase behind every mislabelled row.
 */
export const matchFreelanceExclusion = (text: string): string | null => {
  for (const clause of splitContractClauses(text)) {
    for (const pattern of FREELANCE_EXCLUSIONS) {
      const match = pattern.exec(clause);
      if (match) {
        return match[0].trim();
      }
    }
  }
  return null;
};

const classifyContracttype = (text: string): ClassifiedContractType | null => {
  const clauses = splitContractClauses(text);
  const zzpIsNegated = matchFreelanceExclusion(text) !== null;
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
