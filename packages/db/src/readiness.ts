export type DbReadinessResult =
  | { ready: true }
  | {
      ready: false;
      reason: "database_error" | "migration_mismatch";
    };

type ReadLatestMigration = () => Promise<string | null>;

export const evaluateDbReadiness = async (
  expectedMigrationTimestamp: string,
  readLatestMigration: ReadLatestMigration
): Promise<DbReadinessResult> => {
  try {
    const latestMigrationTimestamp = await readLatestMigration();

    if (latestMigrationTimestamp !== expectedMigrationTimestamp) {
      return { ready: false, reason: "migration_mismatch" };
    }

    return { ready: true };
  } catch {
    return { ready: false, reason: "database_error" };
  }
};
