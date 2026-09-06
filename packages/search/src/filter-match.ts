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

  if (
    filters.locatieLand &&
    !filters.locatieLand.includes(document.locatieLand)
  ) {
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
