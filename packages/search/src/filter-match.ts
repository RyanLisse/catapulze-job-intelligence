import type { SearchDocument, SearchFilters } from "./types";
import { documentLocatie } from "./types";

const matchesLocatieFilter = (
  document: SearchDocument,
  locations: SearchFilters["locatie"]
): boolean => {
  if (locations === undefined) {
    return true;
  }
  const location = documentLocatie(document);
  return location !== undefined && locations.includes(location);
};

const matchesLocatieLandFilter = (
  document: SearchDocument,
  lands: SearchFilters["locatieLand"]
): boolean => {
  if (lands === undefined) {
    return true;
  }
  // Explicit unknown location must not match any country filter, even when
  // legacy rows still carry a default locatieLand (RJC-449).
  if (document.locatie === null || document.locatieLand === null) {
    return false;
  }
  return lands.includes(document.locatieLand);
};

/** Shared in-process equivalent of Manticore's AND-ed attribute filters. */
export const matchesSearchFilters = (
  document: SearchDocument,
  filters: SearchFilters
): boolean => {
  if (filters.bronIds && !filters.bronIds.includes(document.bronId)) {
    return false;
  }

  if (filters.status && !filters.status.includes(document.status)) {
    return false;
  }

  if (!matchesLocatieLandFilter(document, filters.locatieLand)) {
    return false;
  }

  if (!matchesLocatieFilter(document, filters.locatie)) {
    return false;
  }

  if (
    filters.contracttype &&
    !filters.contracttype.includes(document.contracttype ?? "")
  ) {
    return false;
  }

  if (
    filters.tariefMin !== undefined &&
    (document.tariefMax === null || document.tariefMax < filters.tariefMin)
  ) {
    return false;
  }

  if (
    filters.tariefMax !== undefined &&
    (document.tariefMin === null || document.tariefMin > filters.tariefMax)
  ) {
    return false;
  }

  if (filters.freshnessDays !== undefined) {
    const cutoff = Date.now() - filters.freshnessDays * 86_400_000;
    if (document.laatstGezienOp.getTime() < cutoff) {
      return false;
    }
  }

  return true;
};
