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

export const resolveTenderNedTestImportDays = (): number => {
  const configuredDays =
    process.env.TENDER_NED_TEST_IMPORT_DAYS?.trim() || "14";
  const days = Number(configuredDays);
  if (!Number.isInteger(days) || days < 1 || days > 90) {
    throw new Error(
      `TENDER_NED_TEST_IMPORT_DAYS must be an integer in the range 1-90; received "${configuredDays}"`
    );
  }
  return days;
};
