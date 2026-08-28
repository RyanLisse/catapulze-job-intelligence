import { UNKNOWN } from "./unknown";

export const AANVRAAG_LIFECYCLE = [
  "active",
  "stale",
  "closed",
  "unknown",
] as const;

export type AanvraagLifecycle = (typeof AANVRAAG_LIFECYCLE)[number];

export const BRON_CATEGORIEEN = [
  "msp_broker",
  "global_msp",
  "das_tender",
  "overheidsportaal",
  "jobboard",
  "werkenbij",
] as const;

export type BronCategorie = (typeof BRON_CATEGORIEEN)[number];

export const EXTRACTIE_METHODEN = [
  "api",
  "jsonld",
  "html_parser",
  "llm",
] as const;

export type ExtractieMethode = (typeof EXTRACTIE_METHODEN)[number];

export const TARIEF_EENHEDEN = ["uur", "dag", "maand"] as const;
export type TariefEenheid = (typeof TARIEF_EENHEDEN)[number];

export interface MoneyFields {
  amount: string | null;
  currency: string;
}

export const defaultMoneyCurrency = "EUR";

export const isUnknownLifecycle = (value: string): value is typeof UNKNOWN =>
  value === UNKNOWN;
