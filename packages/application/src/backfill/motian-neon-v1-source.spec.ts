import { describe, expect, it } from "bun:test";

import type postgres from "postgres";

import { createMotianNeonV1Source } from "./motian-neon-v1-source";

interface MotianPrivileges {
  can_delete_jobs: boolean;
  can_insert_jobs: boolean;
  can_select_jobs: boolean;
  can_truncate_jobs: boolean;
  can_update_jobs: boolean;
}

interface FakeMotianSqlClient {
  readonly beginOptions: string[];
  readonly events: string[];
  readonly sql: postgres.Sql;
  endCalls: () => number;
  rootQueryCalls: () => number;
}

type FakeTransactionSql = (
  strings: TemplateStringsArray
) => Promise<readonly object[]>;

interface FakeSql {
  (): Promise<never>;
  begin: <T>(
    options: string,
    callback: (readOnlySql: postgres.TransactionSql) => Promise<T>
  ) => Promise<T>;
  end: () => Promise<void>;
}

const readOnlyPrivileges = (): MotianPrivileges => ({
  can_delete_jobs: false,
  can_insert_jobs: false,
  can_select_jobs: true,
  can_truncate_jobs: false,
  can_update_jobs: false,
});

const asTransactionSql = (value: FakeTransactionSql): postgres.TransactionSql =>
  // SAFETY: the fake only receives tagged queries from the Motian source test.
  value as postgres.TransactionSql;

const asSql = (value: FakeSql | postgres.Sql): postgres.Sql =>
  // SAFETY: the fake implements the begin/end methods used by the source.
  value as postgres.Sql;

const createFakeMotianSqlClient = (
  input: {
    readonly privileges?: Partial<MotianPrivileges>;
    readonly transactionReadOnly?: string;
  } = {}
): FakeMotianSqlClient => {
  const beginOptions: string[] = [];
  const events: string[] = [];
  let endCalls = 0;
  let rootQueryCalls = 0;
  const privileges = { ...readOnlyPrivileges(), ...input.privileges };
  const transactionReadOnly = input.transactionReadOnly ?? "on";

  const transactionQuery = (
    strings: TemplateStringsArray
  ): Promise<readonly object[]> => {
    const statement = strings.join("?").replaceAll(/\s+/gu, " ").trim();
    if (statement.startsWith("SHOW transaction_read_only")) {
      events.push("transaction-state");
      return Promise.resolve([{ transaction_read_only: transactionReadOnly }]);
    }
    if (statement.includes("has_table_privilege")) {
      events.push("privileges");
      return Promise.resolve([privileges]);
    }
    if (statement.includes("FROM jobs")) {
      events.push("jobs");
      return Promise.resolve([]);
    }
    return Promise.reject(new Error(`Unexpected Motian query: ${statement}`));
  };
  const transaction = asTransactionSql(transactionQuery);
  const rootQuery = (): Promise<never> => {
    rootQueryCalls += 1;
    return Promise.reject(
      new Error("Motian query escaped its read-only transaction")
    );
  };
  /* oxlint-disable promise/prefer-await-to-callbacks -- postgres.js reserves a transaction session through this callback API. */
  const fakeSql: FakeSql = Object.assign(rootQuery, {
    begin: async <T>(
      options: string,
      callback: (readOnlySql: postgres.TransactionSql) => Promise<T>
    ): Promise<T> => {
      beginOptions.push(options);
      return await callback(transaction);
    },
    end: (): Promise<void> => {
      endCalls += 1;
      return Promise.resolve();
    },
  });
  /* oxlint-enable promise/prefer-await-to-callbacks */
  const sql = asSql(fakeSql);

  return {
    beginOptions,
    endCalls: () => endCalls,
    events,
    rootQueryCalls: () => rootQueryCalls,
    sql,
  };
};

const sourceWithClient = (
  client: FakeMotianSqlClient,
  databaseUrl: string,
  factoryUrls: string[]
) =>
  createMotianNeonV1Source(
    { databaseUrl },
    {
      createSqlClient: (url) => {
        factoryUrls.push(url);
        return client.sql;
      },
    }
  );

describe("Motian Neon v1 source access", () => {
  it("uses the explicit URL and reads on the verified transaction session", async () => {
    const previousDatabaseUrl = process.env.MOTIAN_DATABASE_URL;
    process.env.MOTIAN_DATABASE_URL = "postgresql://ambient@motian.example/v1";
    const client = createFakeMotianSqlClient();
    const factoryUrls: string[] = [];
    const explicitUrl =
      "postgresql://admin-write-owner@explicit-motian.example/v1";

    try {
      const source = sourceWithClient(client, explicitUrl, factoryUrls);

      await expect(source.loadJobs()).resolves.toEqual([]);
    } finally {
      if (previousDatabaseUrl === undefined) {
        delete process.env.MOTIAN_DATABASE_URL;
      } else {
        process.env.MOTIAN_DATABASE_URL = previousDatabaseUrl;
      }
    }

    expect(factoryUrls).toEqual([explicitUrl]);
    expect(client.beginOptions).toEqual(["read only"]);
    expect(client.events).toEqual(["transaction-state", "privileges", "jobs"]);
    expect(client.rootQueryCalls()).toBe(0);
    expect(client.endCalls()).toBe(1);
  });

  it("fails closed when the transaction is not read-only", async () => {
    const client = createFakeMotianSqlClient({ transactionReadOnly: "off" });
    const source = sourceWithClient(
      client,
      "postgresql://readonly@motian.example/v1",
      []
    );

    await expect(source.loadJobs()).rejects.toThrow(
      "Motian source transaction must be read-only"
    );

    expect(client.events).toEqual(["transaction-state"]);
    expect(client.endCalls()).toBe(1);
  });

  it("fails closed when the role cannot select jobs", async () => {
    const client = createFakeMotianSqlClient({
      privileges: { can_select_jobs: false },
    });
    const source = sourceWithClient(
      client,
      "postgresql://readonly@motian.example/v1",
      []
    );

    await expect(source.loadJobs()).rejects.toThrow(
      "Motian source role must have SELECT privilege on jobs"
    );

    expect(client.events).toEqual(["transaction-state", "privileges"]);
    expect(client.endCalls()).toBe(1);
  });

  for (const [key, privilege] of [
    ["can_insert_jobs", "INSERT"],
    ["can_update_jobs", "UPDATE"],
    ["can_delete_jobs", "DELETE"],
    ["can_truncate_jobs", "TRUNCATE"],
  ] as const) {
    it(`fails closed when the source role has ${privilege} on jobs`, async () => {
      const client = createFakeMotianSqlClient({
        privileges: { [key]: true },
      });
      const source = sourceWithClient(
        client,
        "postgresql://readonly@motian.example/v1",
        []
      );

      await expect(source.loadJobs()).rejects.toThrow(
        `Motian source role must not have ${privilege} privilege on jobs`
      );

      expect(client.events).toEqual(["transaction-state", "privileges"]);
      expect(client.endCalls()).toBe(1);
    });
  }
});
