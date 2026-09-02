import { z } from "zod";

export const MANTICORE_BENCH_INDEX_NAME = "aanvragen_bench";

export const MANTICORE_BENCH_TABLES = [
  `${MANTICORE_BENCH_INDEX_NAME}_active`,
  `${MANTICORE_BENCH_INDEX_NAME}_archive`,
] as const;

type BenchmarkPhase = "after" | "before";

interface CleanupEngine {
  applyBatch: (batch: {
    appliedSequence: bigint;
    mutations: {
      id: string;
      kind: "delete";
      sequenceNumber: bigint;
    }[];
  }) => Promise<{
    failures: { error: string; id: string }[];
    unapplied: string[];
  }>;
}

type CountRequest = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>;

const countResponseSchema = z.array(
  z.object({ data: z.array(z.record(z.string(), z.unknown())) })
);

export const countManticoreRows = async (
  url: string,
  request: CountRequest = fetch
): Promise<Record<string, number>> => {
  const countTable = async (table: string): Promise<[string, number]> => {
    const response = await request(`${url}/sql?mode=raw`, {
      body: `query=${encodeURIComponent(`SELECT COUNT(*) FROM ${table}`)}`,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      method: "POST",
    });
    if (!response.ok) {
      throw new Error(
        `SELECT COUNT(*) FROM ${table} failed (${response.status}) on ${url}`
      );
    }
    const parsed = countResponseSchema.parse(await response.json());
    const count = Number(parsed[0]?.data[0]?.["count(*)"] ?? Number.NaN);
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new Error(`Invalid row count for ${table} on ${url}`);
    }
    return [table, count];
  };

  return Object.fromEntries(
    await Promise.all(MANTICORE_BENCH_TABLES.map((table) => countTable(table)))
  );
};

export const assertCleanManticoreTables = async (
  name: string,
  url: string,
  phase: BenchmarkPhase,
  request: CountRequest = fetch
): Promise<void> => {
  const counts = await countManticoreRows(url, request);
  console.log(`${name}: rows ${phase} run ${JSON.stringify(counts)}`);
  const dirty = Object.entries(counts).filter(([, count]) => count !== 0);
  if (dirty.length === 0) {
    return;
  }
  throw new Error(
    `${name}: ${phase}-run benchmark tables are not empty: ${dirty
      .map(([table, count]) => `${table}=${count}`)
      .join(", ")} on ${url}`
  );
};

export const cleanupManticoreDocuments = async (
  engine: CleanupEngine,
  documentIds: readonly string[]
): Promise<void> => {
  const cleanup = await engine.applyBatch({
    appliedSequence: BigInt(documentIds.length),
    mutations: documentIds.map((id, index) => ({
      id,
      kind: "delete",
      sequenceNumber: BigInt(index + 1),
    })),
  });
  if (cleanup.failures.length > 0 || cleanup.unapplied.length > 0) {
    throw new Error(
      `Manticore benchmark cleanup failed: failures=${cleanup.failures.length}, unapplied=${cleanup.unapplied.length}`
    );
  }
};

export const cleanupAndAssertManticoreTables = async (
  name: string,
  url: string,
  engine: CleanupEngine,
  documentIds: readonly string[],
  request: CountRequest = fetch
): Promise<void> => {
  const failures: unknown[] = [];
  try {
    await cleanupManticoreDocuments(engine, documentIds);
  } catch (error) {
    failures.push(error);
  }
  try {
    await assertCleanManticoreTables(name, url, "after", request);
  } catch (error) {
    failures.push(error);
  }
  if (failures.length > 0) {
    throw new AggregateError(failures, `${name} cleanup proof failed`);
  }
};

export const requireManticoreUrl = (
  url: string | undefined,
  required: boolean
): string | undefined => {
  const configured = url?.trim();
  if (!configured && required) {
    throw new Error(
      "BENCH_REQUIRE_MANTICORE=1 requires a non-empty MANTICORE_URL"
    );
  }
  return configured || undefined;
};
