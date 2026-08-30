import { parseBooleanQuery } from "@ji/domain";

import type {
  FreshnessFilter,
  JobContractType,
  JobListing,
  JobSort,
  JobSource,
} from "./types";

export const sourceLabels = {
  indeed: "Indeed",
  inhuurdesk: "Inhuurdesk",
  tenderned: "TenderNed",
  werkenvoor: "Werken voor Nederland",
} satisfies Record<JobSource, string>;

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

export const formatDate = (value: string): string =>
  dateFormatter.format(new Date(value));

export const formatRate = (job: JobListing): string => {
  if (!job.rate) {
    return "Tarief onbekend";
  }

  const suffix = job.rate.period === "hour" ? "/ uur" : "/ jaar";
  return `${currencyFormatter.format(job.rate.min)}–${currencyFormatter.format(job.rate.max)} ${suffix}`;
};

export const primarySource = (job: JobListing): string => {
  const [source] = job.sourceRecords;
  return source ? sourceLabels[source.name] : "Bron onbekend";
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
