import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import {
  PostgresBronPersistence,
  PostgresObservationRecorder,
  PostgresRunStore,
} from "./bron-runtime";
import { PostgresKnownHashStore } from "./known-hash-store";
import * as schema from "./schema";

export const createBronRuntimeClient = (databaseUrl: string) => {
  const sqlClient = postgres(databaseUrl, {
    connect_timeout: 5,
    idle_timeout: 20,
    max: 10,
    max_lifetime: 30 * 60,
  });
  const database = drizzle(sqlClient, { schema });

  return {
    bronPersistence: new PostgresBronPersistence(database),
    close: (): Promise<void> => sqlClient.end({ timeout: 5 }),
    database,
    knownHashStore: new PostgresKnownHashStore(database),
    observationRecorder: new PostgresObservationRecorder(database),
    runLifecycleStore: new PostgresRunStore(database),
  };
};

export type BronRuntimeClient = ReturnType<typeof createBronRuntimeClient>;
