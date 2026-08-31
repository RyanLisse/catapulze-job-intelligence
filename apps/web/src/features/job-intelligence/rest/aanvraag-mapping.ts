import type {
  JobContractType,
  JobLifecycleStatus,
  JobListing,
  JobMarkering,
  JobSource,
} from "../types";
import { bronNameToSource } from "./bron-catalog";
import type { BronCatalogEntry } from "./bron-catalog";

export interface AanvraagPreview {
  readonly beschrijving: string;
  readonly bronId: string;
  readonly bronReferentie: string;
  readonly id: string;
  readonly rawPayloadRef: string;
  readonly scrapeRunId: string;
  readonly status: string;
  readonly titel: string;
}

export interface AanvraagVersieView {
  readonly geldigTot: string | null;
  readonly geldigVan: string;
  readonly id: string;
  readonly normalisatieversie: string;
  readonly scrapeRunId: string;
}

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

const previewSummary = (value: string): string =>
  value.length <= 220 ? value : `${value.slice(0, 217)}…`;

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
  const seenAt = versie?.geldigVan ?? new Date().toISOString();
  const closingAt = versie?.geldigTot ?? seenAt;

  return {
    closingAt,
    contractType: "interim" satisfies JobContractType,
    country: "NL",
    description: input.aanvraag.beschrijving,
    id: input.aanvraag.id,
    location: "Nederland",
    markering: input.markering ?? null,
    organization: "—",
    publishedAt: seenAt,
    rate: null,
    rawPreview: input.rawPreview,
    remote: true,
    skills: [],
    sourceRecords: [
      {
        firstSeenAt: seenAt,
        id: `${sourceName}-${input.aanvraag.bronReferentie}`,
        lastSeenAt: seenAt,
        name: sourceName,
        normalizationVersion: versie?.normalisatieversie ?? "onbekend",
        reference: input.aanvraag.bronReferentie,
        scrapeRunId: input.aanvraag.scrapeRunId,
        url: `#bron/${input.aanvraag.bronId}`,
      },
    ],
    status: mapApiStatus(input.aanvraag.status),
    summary: previewSummary(input.aanvraag.beschrijving),
    title: input.aanvraag.titel,
  };
};
