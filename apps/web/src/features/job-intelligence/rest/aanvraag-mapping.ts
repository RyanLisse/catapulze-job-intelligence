import type { AanvraagVersieView, MarkeringReadback } from "../contracts";
import { isSafeHref, stripHtmlToText } from "../sanitize-job-html";
import type {
  JobContractType,
  JobLifecycleStatus,
  JobListing,
  JobMarkering,
  JobRatePeriod,
  JobSource,
} from "../types";
import { bronNameToSource } from "./bron-catalog";
import type { BronCatalogEntry } from "./bron-catalog";

/**
 * Preview shape returned inside get/batch aanvraag envelopes.
 * Wire envelope SoT: getAanvraagOutputSchema / batchGetAanvragenOutputSchema
 * (`aanvraag` is UnknownRecord on the wire; this is the curated preview the
 * handlers put there).
 */
export interface AanvraagPreview {
  readonly beschrijving: string;
  readonly bronId: string;
  readonly bronReferentie: string;
  readonly bronUrl?: string | null;
  readonly contracttype?: string | null;
  readonly enrichedFields?: readonly {
    readonly confidence: number;
    readonly field: "contract" | "locatie" | "remote" | "tarief";
    readonly source: "deterministic" | "llm";
  }[];
  readonly eindDatum?: string | null;
  readonly id: string;
  readonly locatie?: string | null;
  readonly opdrachtgeverNaam?: string | null;
  readonly publicatiedatum?: string | null;
  readonly rawPayloadRef: string;
  readonly scrapeRunId: string;
  readonly sluitingsdatum?: string | null;
  readonly startDatum?: string | null;
  readonly status: string;
  readonly tariefEenheid?: string | null;
  readonly tariefMax?: number | null;
  readonly tariefMin?: number | null;
  readonly tariefValuta?: string | null;
  readonly titel: string;
  readonly urenPerWeek?: string | null;
  readonly werkvorm?: string | null;
}

/** Wire markering readback — SoT markeringReadbackSchema (CTP-475). */
export type AanvraagMarkeringView = MarkeringReadback;

const mapApiStatus = (status: string): JobLifecycleStatus => {
  switch (status) {
    case "stale": {
      return "closing-soon";
    }
    case "closed": {
      return "closed";
    }
    default: {
      return "open";
    }
  }
};

// RJC-368: previously fell back to the literal "tenderned" whenever the bron
// naam didn't match one of 4 hardcoded brand names — silently mislabeling
// every other registered source. bronNameToSource is now a total slugifier,
// so the only remaining fallback is an unknown bronId itself (never a
// specific other bron's name).
const resolveSource = (
  bronId: string,
  bronCatalog: ReadonlyMap<string, BronCatalogEntry>
): { readonly displayName: string; readonly name: JobSource } => {
  const bron = bronCatalog.get(bronId);
  return bron
    ? { displayName: bron.naam, name: bronNameToSource(bron.naam) }
    : { displayName: bronId, name: bronId };
};

const latestVersie = (
  versies: readonly AanvraagVersieView[]
): AanvraagVersieView | null =>
  versies.length === 0
    ? null
    : ([...versies].toSorted(
        (left, right) =>
          Date.parse(right.geldigVan) - Date.parse(left.geldigVan)
      )[0] ?? null);

const previewSummary = (value: string): string => {
  const plain = stripHtmlToText(value) || value.trim();
  return plain.length <= 220 ? plain : `${plain.slice(0, 217)}…`;
};

const optionalText = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim() ?? "";
  return trimmed || null;
};

const mapContractType = (value: string | null): JobContractType | null => {
  switch (value) {
    case "detachering":
    case "freelance":
    case "interim":
    case "vast": {
      return value;
    }
    default: {
      return null;
    }
  }
};

const mapRatePeriod = (value: string | null | undefined): JobRatePeriod => {
  switch (value?.trim().toLocaleLowerCase("nl-NL")) {
    case "uur": {
      return "hour";
    }
    case "dag": {
      return "day";
    }
    case "maand": {
      return "month";
    }
    case "jaar": {
      return "year";
    }
    default: {
      return "unknown";
    }
  }
};

const normalizeRateBound = (
  value: number | null | undefined
): number | null | undefined => {
  if (value === null || value === undefined) {
    return undefined;
  }
  return Number.isFinite(value) && value >= 0 ? value : null;
};

const mapRate = (aanvraag: AanvraagPreview): JobListing["rate"] => {
  const { tariefEenheid, tariefMax, tariefMin, tariefValuta } = aanvraag;
  if (tariefValuta !== "EUR") {
    return null;
  }

  const min = normalizeRateBound(tariefMin);
  const max = normalizeRateBound(tariefMax);
  if (
    min === null ||
    max === null ||
    (min === undefined && max === undefined) ||
    (min !== undefined && max !== undefined && min > max)
  ) {
    return null;
  }

  const period = mapRatePeriod(tariefEenheid);
  if (min !== undefined && max !== undefined) {
    return { currency: "EUR", max, min, period };
  }
  if (min !== undefined) {
    return { currency: "EUR", max: null, min, period };
  }
  if (max !== undefined) {
    return { currency: "EUR", max, min: null, period };
  }
  return null;
};

const REMOTE_WERKVORM = /\b(?<kind>remote|thuis|hybride|hybrid|telecommute)\b/u;
const ONSITE_WERKVORM = /\b(?<kind>op locatie|kantoor|onsite)\b/u;

const mapRemote = (werkvorm: string | null | undefined): boolean | null => {
  if (!werkvorm || werkvorm.trim() === "") {
    return null;
  }
  const lower = werkvorm.toLowerCase();
  if (REMOTE_WERKVORM.test(lower)) {
    return true;
  }
  if (ONSITE_WERKVORM.test(lower)) {
    return false;
  }
  return null;
};

export const mapAanvraagToJobListing = (input: {
  readonly aanvraag: AanvraagPreview;
  readonly bronCatalog: ReadonlyMap<string, BronCatalogEntry>;
  readonly markering?: JobMarkering | null;
  readonly rawPreview?: string;
  readonly versies: readonly AanvraagVersieView[];
}): JobListing => {
  const source = resolveSource(input.aanvraag.bronId, input.bronCatalog);
  const versie = latestVersie(input.versies);

  return {
    closingAt: input.aanvraag.sluitingsdatum ?? null,
    contractType: mapContractType(input.aanvraag.contracttype ?? null),
    country: null,
    description: input.aanvraag.beschrijving,
    endDate: optionalText(input.aanvraag.eindDatum),
    enrichedFields: input.aanvraag.enrichedFields ?? [],
    hoursPerWeek: optionalText(input.aanvraag.urenPerWeek),
    id: input.aanvraag.id,
    location: input.aanvraag.locatie ?? null,
    markering: input.markering ?? null,
    organization: input.aanvraag.opdrachtgeverNaam ?? null,
    publishedAt: input.aanvraag.publicatiedatum ?? null,
    rate: mapRate(input.aanvraag),
    rawPreview: input.rawPreview,
    remote: mapRemote(input.aanvraag.werkvorm),
    skills: [],
    sourceRecords: [
      {
        displayName: source.displayName,
        firstSeenAt: null,
        id: `${source.name}-${input.aanvraag.bronReferentie}`,
        lastSeenAt: null,
        name: source.name,
        normalizationVersion: versie?.normalisatieversie ?? "onbekend",
        reference: input.aanvraag.bronReferentie,
        scrapeRunId: input.aanvraag.scrapeRunId,
        url: (() => {
          const candidate = input.aanvraag.bronUrl?.trim() ?? "";
          if (candidate.length > 0 && isSafeHref(candidate)) {
            return candidate;
          }
          return `#bron/${input.aanvraag.bronId}`;
        })(),
        validFrom: versie?.geldigVan ?? null,
        validTo: versie?.geldigTot ?? null,
      },
    ],
    startDate: optionalText(input.aanvraag.startDatum),
    status: mapApiStatus(input.aanvraag.status),
    summary: previewSummary(input.aanvraag.beschrijving),
    title: input.aanvraag.titel,
    workArrangement: input.aanvraag.werkvorm?.trim() || null,
  };
};
