import { z } from "zod";

export const requireDatabaseUrl = (): string => {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for poll-bron");
  }
  return databaseUrl;
};

export const requireManticoreUrl = (): string => {
  const manticoreUrl = process.env.MANTICORE_URL?.trim();
  if (!manticoreUrl) {
    throw new Error("MANTICORE_URL is required for outbox drain");
  }
  return manticoreUrl;
};

export type SearchProjectorMode = "worker" | "onbox";

const searchProjectorMode = z.enum(["worker", "onbox"]);

/**
 * Selects who drains the outbox into Manticore after a bron run (RJC-387).
 * Defaults to "worker" — the pre-existing behaviour, where this same
 * process constructs a `ManticoreSearchEngine` and drains inline right
 * after the outbox commit. "onbox" defers that entirely to the standalone
 * projector process (`apps/server/src/projector`) running next to
 * Manticore, so a cloud worker with no path to a private Manticore never
 * needs `MANTICORE_URL`. See docs/runbooks/search-projector.md.
 */
export const readSearchProjectorMode = (): SearchProjectorMode => {
  const raw = process.env.SEARCH_PROJECTOR?.trim() || "worker";
  const result = searchProjectorMode.safeParse(raw);
  if (!result.success) {
    throw new Error(
      `SEARCH_PROJECTOR must be "worker" or "onbox", received "${raw}"`
    );
  }
  return result.data;
};
