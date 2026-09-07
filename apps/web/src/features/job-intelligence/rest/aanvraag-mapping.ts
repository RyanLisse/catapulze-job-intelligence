import type { AanvraagVersieView, MarkeringReadback } from "../contracts";
import { stripHtmlToText } from "../sanitize-job-html";
import type {
  JobContractType,
  JobLifecycleStatus,
  JobListing,
  JobMarkering,
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
  readonly contracttype?: string | null;
  readonly id: string;
  readonly locatie?: string | null;
  readonly opdrachtgeverNaam?: string | null;
  readonly publicatiedatum?: string | null;
  readonly rawPayloadRef: string;
  readonly scrapeRunId: string;
  readonly sluitingsdatum?: string | null;
  readonly status: string;
  readonly tariefEenheid?: string | null;
  readonly tariefMax?: number | null;
  readonly tariefMin?: number | null;
  readonly tariefValuta?: string | null;
  readonly titel: string;
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
const resolveSourceName = (
  bronId: string,
  bronCatalog: ReadonlyMap<string, BronCatalogEntry>
): JobSource => {
  const bron = bronCatalog.get(bronId);
  return bron ? bronNameToSource(bron.naam) : bronId;
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

const mapRate = (aanvraag: AanvraagPreview): JobListing["rate"] => {
  const { tariefEenheid, tariefMax, tariefMin, tariefValuta } = aanvraag;
  if (
    tariefEenheid !== "uur" ||
    tariefValuta !== "EUR" ||
    tariefMin === null ||
    tariefMin === undefined ||
    tariefMax === null ||
    tariefMax === undefined ||
    !Number.isFinite(tariefMin) ||
    !Number.isFinite(tariefMax) ||
    tariefMin < 0 ||
    tariefMax < tariefMin
  ) {
    return null;
  }
  return {
    currency: "EUR",
    max: tariefMax,
    min: tariefMin,
    period: "hour",
  };
};

export const mapAanvraagToJobListing = (input: {
  readonly aanvraag: AanvraagPreview;
  readonly bronCatalog: ReadonlyMap<string, BronCatalogEntry>;
  readonly markering?: JobMarkering | null;
  readonly rawPreview?: string;
  readonly versies: readonly AanvraagVersieView[];
}): JobListing => {
  const sourceName = resolveSourceName(
    input.aanvraag.bronId,
    input.bronCatalog
  );
  const versie = latestVersie(input.versies);

  return {
    closingAt: input.aanvraag.sluitingsdatum ?? null,
    contractType: mapContractType(input.aanvraag.contracttype ?? null),
    country: null,
    description: input.aanvraag.beschrijving,
    id: input.aanvraag.id,
    location: input.aanvraag.locatie ?? null,
    markering: input.markering ?? null,
    organization: input.aanvraag.opdrachtgeverNaam ?? null,
    publishedAt: input.aanvraag.publicatiedatum ?? null,
    rate: mapRate(input.aanvraag),
    rawPreview: input.rawPreview,
    remote: null,
    skills: [],
    sourceRecords: [
      {
        firstSeenAt: null,
        id: `${sourceName}-${input.aanvraag.bronReferentie}`,
        lastSeenAt: null,
        name: sourceName,
        normalizationVersion: versie?.normalisatieversie ?? "onbekend",
        reference: input.aanvraag.bronReferentie,
        scrapeRunId: input.aanvraag.scrapeRunId,
        url: `#bron/${input.aanvraag.bronId}`,
        validFrom: versie?.geldigVan ?? null,
        validTo: versie?.geldigTot ?? null,
      },
    ],
    status: mapApiStatus(input.aanvraag.status),
    summary: previewSummary(input.aanvraag.beschrijving),
    title: input.aanvraag.titel,
    workArrangement: input.aanvraag.werkvorm?.trim() || null,
  };
};
