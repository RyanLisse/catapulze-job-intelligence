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
