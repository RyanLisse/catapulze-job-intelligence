import { parseBooleanQuery } from "@ji/domain";

import type {
  FreshnessFilter,
  JobContractType,
  JobEnrichedField,
  JobListing,
  JobSort,
  JobSource,
} from "./types";
import { AANGEVULD_MIN_CONFIDENCE } from "./types";

// RJC-368: fallback labels for the fixture demo sources only. Real bronnen
// get their label from the live /v1/bronnen catalog (see JobSourceOption);
// sourceLabel() falls back to the raw slug for anything not listed here.
const fixtureSourceLabels: ReadonlyMap<string, string> = new Map([
  ["indeed", "Indeed"],
  ["inhuurdesk", "Inhuurdesk"],
  ["tenderned", "TenderNed"],
  ["werkenvoor", "Werken voor Nederland"],
]);

export const sourceLabel = (source: JobSource): string =>
  fixtureSourceLabels.get(source) ?? source;

export const contractLabels = {
  detachering: "Detachering",
  freelance: "Freelance",
  interim: "Interim",
  vast: "Vast",
} satisfies Record<JobContractType, string>;

export const freshnessLabels = {
  "24h": "Afgelopen 24 uur",
  "30d": "Afgelopen 30 dagen",
  "7d": "Afgelopen 7 dagen",
  all: "Alle publicatiedata",
} satisfies Record<FreshnessFilter, string>;

export const sortLabels = {
  "closing-soon": "Sluitingsdatum",
  newest: "Nieuwste eerst",
  "rate-high": "Hoogste tarief per periode",
  relevance: "Relevantie",
} satisfies Record<JobSort, string>;

const dateFormatter = new Intl.DateTimeFormat("nl-NL", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

const currencyFormatter = new Intl.NumberFormat("nl-NL", {
  currency: "EUR",
  maximumFractionDigits: 0,
  style: "currency",
});

export const formatDate = (value: string | null): string =>
  value ? dateFormatter.format(new Date(value)) : "Onbekend";

export const formatContract = (job: JobListing): string =>
  job.contractType ? contractLabels[job.contractType] : "Onbekend";

export const formatRemote = (job: JobListing): string => {
  if (job.workArrangement) {
    return job.workArrangement;
  }
  if (job.remote === null) {
    return "Onbekend";
  }
  return job.remote ? "Hybride" : "Op locatie";
};

export const formatRate = (job: JobListing): string => {
  if (!job.rate) {
    return "Tarief onbekend";
  }

  const suffix = job.rate.period === "hour" ? "/ uur" : "/ jaar";
  if (job.rate.min === null) {
    return `tot ${currencyFormatter.format(job.rate.max)} ${suffix}`;
  }
  if (job.rate.min === job.rate.max) {
    return `${currencyFormatter.format(job.rate.max)} ${suffix}`;
  }
  return `${currencyFormatter.format(job.rate.min)}–${currencyFormatter.format(job.rate.max)} ${suffix}`;
};

export const primarySource = (job: JobListing): string => {
  const [source] = job.sourceRecords;
  return source ? sourceLabel(source.name) : "Bron onbekend";
};

const describeBooleanError = (message: string, offset: number): string => {
  if (message === "Unclosed phrase") {
    return "Een aangehaalde zoekterm mist een afsluitend aanhalingsteken.";
  }
  if (message === "Unclosed parenthesis") {
    return "Een zoekgroep mist een afsluitende haak.";
  }
  if (message === "Unexpected closing parenthesis") {
    return `Onverwachte sluithaak op positie ${offset + 1}.`;
  }
  return `Boolean-query klopt niet op positie ${offset + 1}. Controleer de operators en zoektermen.`;
};

export const validateBooleanPreview = (query: string): string | null => {
  if (!query.trim()) {
    return null;
  }
  const result = parseBooleanQuery(query);
  return result.ok
    ? null
    : describeBooleanError(result.error.message, result.error.offset);
};

export const describeApiSyntaxError = (
  message: string,
  offset?: number
): string => {
  if (offset === undefined) {
    return message;
  }
  return describeBooleanError(message, offset);
};

export const isFieldAangevuld = (
  job: JobListing,
  field: JobEnrichedField["field"]
): boolean => {
  const enriched = job.enrichedFields?.find((entry) => entry.field === field);
  return (
    enriched !== undefined && enriched.confidence >= AANGEVULD_MIN_CONFIDENCE
  );
};

export const aangevuldLabel = (field: JobEnrichedField["field"]): string =>
  `aangevuld (${field})`;
