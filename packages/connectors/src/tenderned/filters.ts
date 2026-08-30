import type { TenderNedFilters } from "./types";

const POLL_TIME_ZONE = "Europe/Amsterdam";

const formatDateInTimeZone = (date: Date, timeZone: string): string => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone,
    year: "numeric",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  if (!year || !month || !day) {
    throw new Error("Unable to format poll date");
  }
  return `${year}-${month}-${day}`;
};

/** Poll window from docs/sources/tenderned.md: yesterday through today, CPV + diensten filters. */
export const buildTenderNedPollFilters = (
  now = new Date(),
  timeZone = POLL_TIME_ZONE
): TenderNedFilters => {
  const yesterday = new Date(now.getTime() - 86_400_000);
  return {
    cpvCodes: ["72000000-5", "79620000-6"],
    publicatieDatumVanaf: formatDateInTimeZone(yesterday, timeZone),
    typeOpdracht: "D",
  };
};
