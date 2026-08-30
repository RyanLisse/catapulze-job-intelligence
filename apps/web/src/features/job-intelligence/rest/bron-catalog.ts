import type { JobSource } from "../types";

export interface BronCatalogEntry {
  readonly bronId: string;
  readonly naam: string;
}

export const bronNameToSource = (naam: string): JobSource | null => {
  const normalized = naam.toLowerCase().replaceAll(/\s+/gu, "");
  if (normalized.includes("tenderned")) {
    return "tenderned";
  }
  if (normalized.includes("inhuurdesk")) {
    return "inhuurdesk";
  }
  if (normalized.includes("werken")) {
    return "werkenvoor";
  }
  if (normalized.includes("indeed")) {
    return "indeed";
  }
  return null;
};

export const buildBronCatalog = (
  bronnen: readonly BronCatalogEntry[]
): ReadonlyMap<string, BronCatalogEntry> =>
  new Map(bronnen.map((bron) => [bron.bronId, bron]));
