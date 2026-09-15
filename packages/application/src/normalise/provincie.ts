/**
 * Canonical Dutch provinces for `bronSpecifiek.provincie` (CTP-514, F04).
 *
 * A normaliser calls `toCanonicalProvincie` only on text the source itself
 * publishes as a province (a province field, a "Provincie:" label, a province
 * name in the title). Never feed it a city name: that would infer a province
 * the source did not state, which the read side deliberately refuses to do.
 */
export const NL_PROVINCIES = [
  "Drenthe",
  "Flevoland",
  "Friesland",
  "Gelderland",
  "Groningen",
  "Limburg",
  "Noord-Brabant",
  "Noord-Holland",
  "Overijssel",
  "Utrecht",
  "Zeeland",
  "Zuid-Holland",
] as const;

export type Provincie = (typeof NL_PROVINCIES)[number];

const ALIASES = new Map<string, Provincie>(
  Object.entries({
    drenthe: "Drenthe",
    flevoland: "Flevoland",
    friesland: "Friesland",
    fryslan: "Friesland",
    fryslân: "Friesland",
    gelderland: "Gelderland",
    groningen: "Groningen",
    limburg: "Limburg",
    "n-brabant": "Noord-Brabant",
    "n-holland": "Noord-Holland",
    nb: "Noord-Brabant",
    nh: "Noord-Holland",
    "noord brabant": "Noord-Brabant",
    "noord holland": "Noord-Holland",
    "noord-brabant": "Noord-Brabant",
    "noord-holland": "Noord-Holland",
    noordbrabant: "Noord-Brabant",
    noordholland: "Noord-Holland",
    overijssel: "Overijssel",
    utrecht: "Utrecht",
    "z-holland": "Zuid-Holland",
    zeeland: "Zeeland",
    zh: "Zuid-Holland",
    "zuid holland": "Zuid-Holland",
    "zuid-holland": "Zuid-Holland",
    zuidholland: "Zuid-Holland",
  } satisfies Record<string, Provincie>)
);

const PROVINCIE_PREFIX = /^provincie\s+/iu;

/**
 * Maps a source-published province spelling to its canonical name, or `null`
 * when the text is not a recognised Dutch province. Case, accents, hyphen and
 * space variants and a leading "Provincie " label are tolerated; nothing else
 * is guessed.
 */
export const toCanonicalProvincie = (
  text?: string | null
): Provincie | null => {
  if (text === null || text === undefined) {
    return null;
  }
  const key = text
    .trim()
    .replace(PROVINCIE_PREFIX, "")
    .toLowerCase()
    .normalize("NFC");
  return ALIASES.get(key) ?? null;
};

/**
 * Finds a province name embedded in a longer source string, such as a title
 * "Projectleider (Zuid-Holland)" or a location "Amsterdam, Noord-Holland".
 * Returns `null` when the string names no province; a city alone never counts.
 */
export const findProvincieInText = (
  text: string | null | undefined
): Provincie | null => {
  if (text === null || text === undefined) {
    return null;
  }
  const parts = text.split(/[\s,;|/()[\]]+/u).filter(Boolean);
  for (let index = 0; index < parts.length; index += 1) {
    const single = toCanonicalProvincie(parts[index]);
    if (single !== null) {
      return single;
    }
    const pair = toCanonicalProvincie(
      `${parts[index]} ${parts[index + 1] ?? ""}`
    );
    if (pair !== null) {
      return pair;
    }
  }
  return null;
};
