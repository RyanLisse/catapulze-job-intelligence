/* oxlint-disable max-classes-per-file -- distinct exported errors are operator-visible recovery contracts. */

import {
  documentPartition,
  projectionHash,
  SEARCH_SCHEMA_HASH,
} from "@ji/search";
import type {
  BulkSearchDocumentLoader,
  SearchPartition,
  SearchVersionStore,
} from "@ji/search";
import { and, asc, eq, gt, inArray, isNull, sql } from "drizzle-orm";

import type { BronRuntimeDatabase } from "./bron-runtime";
import { aanvraag, outboxEvent, searchProjectionState } from "./schema/curated";

/** Synthetic upsert emitted after a proven search-projection divergence. */
export const PROJECTION_REPAIR_EVENT_TYPE = "aanvraag.projection_repair";

/** State, curated-row, and Manticore inventory operations are bounded by this default. */
export const PROJECTION_REPAIR_DEFAULT_PAGE_SIZE = 200;

/** Operator output retains a useful sample without retaining an unbounded corpus. */
export const PROJECTION_REPAIR_DEFAULT_SAMPLE_LIMIT = 20;

const DELETE_EVENT_TYPE = "aanvraag.verwijderd";
const INVENTORY_PARTITIONS: readonly SearchPartition[] = ["active", "archive"];
// `aanvraag.id` is PostgreSQL's UUID type. Reconciliation must accept any
// canonical UUID that PostgreSQL can hold, including newer UUIDv7 values;
// limiting this to the versions the application emits today could strand a
// real orphan after an ID-generation migration.
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/**
 * A concrete Manticore reader belongs in the operator tool, not @ji/db. The
 * port deliberately exposes only bounded inventory queries, which keeps the
 * reconciliation algorithm testable and prevents a full index from being
 * materialised in process memory.
 */
export interface SearchProjectionInventoryPort {
  count: (partition: SearchPartition) => Promise<number>;
  findByDocumentIds: (
    partition: SearchPartition,
    documentIds: readonly string[]
  ) => Promise<readonly SearchProjectionInventoryRecord[]>;
  listPage: (
    partition: SearchPartition,
    afterManticoreId: number | null,
    limit: number
  ) => Promise<readonly SearchProjectionInventoryRecord[]>;
}

/** One physical Manticore row. `manticoreId` is the numeric RT id, not document_id. */
export interface SearchProjectionInventoryRecord {
  documentId: string;
  manticoreId: number;
}

export class ProjectionRepairSchemaMismatchError extends Error {
  constructor(checkpointHash: string, expectedHash: string) {
    super(
      `Projection checkpoint carries schema hash ${checkpointHash} but the running code expects ${expectedHash}. ` +
        "The drain is halted on a schema migration; follow docs/runbooks/search-schema-migration.md instead of running this repair."
    );
    this.name = "ProjectionRepairSchemaMismatchError";
  }
}

export class ProjectionRepairGenerationChangedError extends Error {
  constructor(expectedGeneration: number, actualGeneration: number) {
    super(
      `Projection generation changed from ${expectedGeneration} to ${actualGeneration} during reconciliation. ` +
        "No further repair page was applied; rerun against the current generation."
    );
    this.name = "ProjectionRepairGenerationChangedError";
  }
}

export type ProjectionDivergenceReason =
  | "duplicate_manticore_document"
  | "missing_manticore_document"
  | "missing_projection_state"
  | "projection_hash_mismatch"
  | "wrong_manticore_partition";

export interface ProjectionDivergence {
  aggregateId: string;
  /** Partitions in which Manticore currently reports the document. */
  actualPartitions: readonly SearchPartition[];
  /** Hash of the aanvraag row as the projector would index it at this run's fixed `now`. */
  currentHash: string;
  expectedPartition: SearchPartition;
  /** Null means no current-generation state exists. */
  projectedHash: string | null;
  reasons: readonly ProjectionDivergenceReason[];
}

export interface ReconcileProjectionInput {
  /** False reports; true emits bounded durable repair/delete events. */
  apply: boolean;
  database: BronRuntimeDatabase;
  /** Schema hash the running code was built for (default SEARCH_SCHEMA_HASH). */
  expectedSchemaHash?: string;
  /** Actual Manticore inventory. Omit only for the legacy DB-state diagnostic. */
  inventory?: SearchProjectionInventoryPort;
  loader: BulkSearchDocumentLoader;
  /** Partition boundaries in projectionHash depend on time; injectable for specs. */
  now?: Date;
  /** Bounded curated/Manticore page size. */
  pageSize?: number;
  /** Capped samples retained in the result. Exact totals are tracked separately. */
  sampleLimit?: number;
  versionStore: SearchVersionStore;
}

export interface ReconcileProjectionResult {
  /** Repair or orphan-delete events inserted (0 on a dry run). */
  applied: number;
  /** Current curated aanvragen (inventory mode) or current state rows (legacy mode) checked. */
  checked: number;
  /** Capped sample of distinct divergent current aanvragen. */
  divergent: ProjectionDivergence[];
  /** Exact number of divergent current aanvragen. */
  divergentCount: number;
  generation: number;
  /** Exact engine inventory counts when a Manticore port was supplied. */
  inventoryCounts: { active: number; archive: number } | null;
  /** Capped physical Manticore rows whose document_id is not a UUID; report-only. */
  invalidDocumentId: string[];
  invalidDocumentIdCount: number;
  /** Physical Manticore rows inspected through numeric-id keyset pages. */
  manticoreChecked: number;
  /** Capped state rows whose aanvraag no longer loads in legacy DB-only mode. */
  missingDocument: string[];
  missingDocumentCount: number;
  /** Exact current aanvragen with no current-generation projection state. */
  missingProjectionStateCount: number;
  /** Capped valid UUIDs present in Manticore but absent from curated.aanvraag. */
  orphanManticore: string[];
  orphanManticoreCount: number;
  /** Current aanvraag repair candidates already covered by an open outbox event. */
  skippedPending: number;
}

interface RepairCandidate {
  actualPartitions: SearchPartition[];
  aggregateId: string;
  currentHash: string;
  expectedPartition: SearchPartition;
  invalidateState: boolean;
  projectedHash: string | null;
  reasons: Set<ProjectionDivergenceReason>;
}

interface RepairApplyResult {
  applied: number;
  skippedPending: number;
}

const validatePositiveInteger = (
  value: number,
  name: string,
  maximum: number
): number => {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${name} must be an integer from 1 through ${maximum}`);
  }
  return value;
};

const addSample = <Value>(
  sample: Value[],
  value: Value,
  limit: number
): void => {
  if (sample.length < limit) {
    sample.push(value);
  }
};

const requireCurrentCheckpoint = async (
  versionStore: SearchVersionStore,
  expectedSchemaHash: string,
  generation?: number
): Promise<number> => {
  const checkpoint = await versionStore.read();
  if (checkpoint.schemaHash !== expectedSchemaHash) {
    throw new ProjectionRepairSchemaMismatchError(
      checkpoint.schemaHash,
      expectedSchemaHash
    );
  }
  if (generation !== undefined && checkpoint.generation !== generation) {
    throw new ProjectionRepairGenerationChangedError(
      generation,
      checkpoint.generation
    );
  }
  return checkpoint.generation;
};

const lockRepair = async (
  database: BronRuntimeDatabase,
  generation: number
): Promise<void> => {
  await database.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext(${`projection_repair:${generation}`}))`
  );
};

const pendingAggregateIds = async (
  database: BronRuntimeDatabase,
  aggregateIds: readonly string[],
  eventType?: string
): Promise<Set<string>> => {
  if (aggregateIds.length === 0) {
    return new Set();
  }
  const rows = await database
    .select({ aggregateId: outboxEvent.aggregateId })
    .from(outboxEvent)
    .where(
      and(
        inArray(outboxEvent.aggregateId, [...aggregateIds]),
        isNull(outboxEvent.processedAt),
        isNull(outboxEvent.deadLetteredAt),
        eventType === undefined
          ? undefined
          : eq(outboxEvent.eventType, eventType)
      )
    );
  return new Set(rows.map((row) => row.aggregateId));
};

const toDivergence = (candidate: RepairCandidate): ProjectionDivergence => ({
  actualPartitions: candidate.actualPartitions,
  aggregateId: candidate.aggregateId,
  currentHash: candidate.currentHash,
  expectedPartition: candidate.expectedPartition,
  projectedHash: candidate.projectedHash,
  reasons: [...candidate.reasons].toSorted(),
});

const addRepairReason = (
  candidates: Map<string, RepairCandidate>,
  input: {
    actualPartitions: readonly SearchPartition[];
    aggregateId: string;
    currentHash: string;
    expectedPartition: SearchPartition;
    invalidateState: boolean;
    projectedHash: string | null;
    reason: ProjectionDivergenceReason;
  }
): void => {
  const current = candidates.get(input.aggregateId);
  if (current) {
    current.invalidateState ||= input.invalidateState;
    current.reasons.add(input.reason);
    return;
  }
  candidates.set(input.aggregateId, {
    actualPartitions: [...input.actualPartitions],
    aggregateId: input.aggregateId,
    currentHash: input.currentHash,
    expectedPartition: input.expectedPartition,
    invalidateState: input.invalidateState,
    projectedHash: input.projectedHash,
    reasons: new Set([input.reason]),
  });
};

/**
 * Invalidating state is part of the same transaction as the repair event.
 * Without it, a matching DB hash makes the next drain consume the event as
 * unchanged even when the actual Manticore row is missing or in a bad table.
 */
const applyRepairPage = async (
  input: ReconcileProjectionInput,
  candidates: readonly RepairCandidate[],
  generation: number,
  expectedSchemaHash: string
): Promise<RepairApplyResult> => {
  if (candidates.length === 0) {
    return { applied: 0, skippedPending: 0 };
  }
  const aggregateIds = candidates.map((candidate) => candidate.aggregateId);
  if (!input.apply) {
    const pending = await pendingAggregateIds(input.database, aggregateIds);
    return { applied: 0, skippedPending: pending.size };
  }

  return input.database.transaction(async (transaction) => {
    await lockRepair(transaction, generation);
    await requireCurrentCheckpoint(
      input.versionStore,
      expectedSchemaHash,
      generation
    );
    const pending = await pendingAggregateIds(transaction, aggregateIds);
    const invalidateIds = candidates
      .filter((candidate) => candidate.invalidateState)
      .map((candidate) => candidate.aggregateId);
    if (invalidateIds.length > 0) {
      await transaction
        .delete(searchProjectionState)
        .where(
          and(
            eq(searchProjectionState.generation, generation),
            inArray(searchProjectionState.aggregateId, invalidateIds)
          )
        );
    }
    const repairable = candidates.filter(
      (candidate) => !pending.has(candidate.aggregateId)
    );
    if (repairable.length === 0) {
      return { applied: 0, skippedPending: pending.size };
    }
    const inserted = await transaction
      .insert(outboxEvent)
      .values(
        repairable.map((candidate) => ({
          aggregateId: candidate.aggregateId,
          aggregateType: "aanvraag",
          eventType: PROJECTION_REPAIR_EVENT_TYPE,
          payload: {
            actual_partitions: candidate.actualPartitions,
            current_hash: candidate.currentHash,
            expected_partition: candidate.expectedPartition,
            projected_hash: candidate.projectedHash,
            reasons: [...candidate.reasons].toSorted(),
            reden: "projection_repair",
          },
        }))
      )
      .returning({ id: outboxEvent.id });
    return {
      applied: inserted.length,
      skippedPending: pending.size,
    };
  });
};

/**
 * Valid engine UUIDs with no curated row need a delete event, not an upsert
 * repair. Deleting current-generation state forces the projector to delete
 * both partitions, which also cleans a duplicate orphan.
 */
const applyOrphanCleanupPage = async (
  input: ReconcileProjectionInput,
  orphanIds: readonly string[],
  generation: number,
  expectedSchemaHash: string
): Promise<RepairApplyResult> => {
  const uniqueIds = [...new Set(orphanIds)];
  if (uniqueIds.length === 0) {
    return { applied: 0, skippedPending: 0 };
  }
  if (!input.apply) {
    const pending = await pendingAggregateIds(
      input.database,
      uniqueIds,
      DELETE_EVENT_TYPE
    );
    return { applied: 0, skippedPending: pending.size };
  }

  return input.database.transaction(async (transaction) => {
    await lockRepair(transaction, generation);
    await requireCurrentCheckpoint(
      input.versionStore,
      expectedSchemaHash,
      generation
    );
    // A newly written curated row wins over a stale inventory read; never
    // enqueue a delete for it.
    const currentRows = await transaction
      .select({ id: aanvraag.id })
      .from(aanvraag)
      .where(inArray(aanvraag.id, uniqueIds));
    const currentIds = new Set(currentRows.map((row) => row.id));
    const stillOrphaned = uniqueIds.filter((id) => !currentIds.has(id));
    if (stillOrphaned.length === 0) {
      return { applied: 0, skippedPending: 0 };
    }
    const pending = await pendingAggregateIds(
      transaction,
      stillOrphaned,
      DELETE_EVENT_TYPE
    );
    await transaction
      .delete(searchProjectionState)
      .where(
        and(
          eq(searchProjectionState.generation, generation),
          inArray(searchProjectionState.aggregateId, stillOrphaned)
        )
      );
    const repairable = stillOrphaned.filter((id) => !pending.has(id));
    if (repairable.length === 0) {
      return { applied: 0, skippedPending: pending.size };
    }
    const inserted = await transaction
      .insert(outboxEvent)
      .values(
        repairable.map((aggregateId) => ({
          aggregateId,
          aggregateType: "aanvraag",
          eventType: DELETE_EVENT_TYPE,
          payload: { reden: "projection_repair_orphan_manticore_document" },
        }))
      )
      .returning({ id: outboxEvent.id });
    return { applied: inserted.length, skippedPending: pending.size };
  });
};

const selectCurrentStatePage = (
  database: BronRuntimeDatabase,
  generation: number,
  cursor: string | null,
  pageSize: number
) =>
  database
    .select({
      aggregateId: searchProjectionState.aggregateId,
      projectionHash: searchProjectionState.projectionHash,
    })
    .from(searchProjectionState)
    .where(
      cursor === null
        ? eq(searchProjectionState.generation, generation)
        : and(
            eq(searchProjectionState.generation, generation),
            gt(searchProjectionState.aggregateId, cursor)
          )
    )
    .orderBy(asc(searchProjectionState.aggregateId))
    .limit(pageSize);

const selectAanvraagPage = (
  database: BronRuntimeDatabase,
  cursor: string | null,
  pageSize: number
) =>
  database
    .select({ id: aanvraag.id })
    .from(aanvraag)
    .where(cursor === null ? undefined : gt(aanvraag.id, cursor))
    .orderBy(asc(aanvraag.id))
    .limit(pageSize);

const assertInventoryPage = (
  rows: readonly SearchProjectionInventoryRecord[],
  pageSize: number,
  partition: SearchPartition,
  cursor: number | null
): void => {
  if (rows.length > pageSize) {
    throw new Error(
      `Manticore ${partition} inventory returned ${rows.length} rows for a ${pageSize}-row page`
    );
  }
  let previousManticoreId = cursor;
  for (const row of rows) {
    if (!Number.isSafeInteger(row.manticoreId) || row.manticoreId < 0) {
      throw new Error(
        `Manticore ${partition} inventory returned invalid numeric id ${row.manticoreId}`
      );
    }
    if (
      previousManticoreId !== null &&
      row.manticoreId <= previousManticoreId
    ) {
      throw new Error(
        `Manticore ${partition} inventory did not return strictly ascending numeric ids`
      );
    }
    previousManticoreId = row.manticoreId;
  }
};

/**
 * Reconciles the durable projection state with the actual Manticore tables.
 *
 * With an inventory port it runs two bounded passes: Postgres-led comparison
 * for every current aanvraag, then Manticore-led numeric-id pages for engine
 * orphans and malformed IDs. Omitting the port keeps the legacy
 * Postgres-vs-Postgres diagnostic compatible for callers that cannot reach
 * Manticore; it cannot claim an engine-zero-drift verdict.
 */
/* oxlint-disable-next-line complexity -- Coordinates two intentionally ordered bounded reconciliation passes while keeping generation fences visible. */
export const reconcileProjection = async (
  input: ReconcileProjectionInput
): Promise<ReconcileProjectionResult> => {
  const expectedSchemaHash = input.expectedSchemaHash ?? SEARCH_SCHEMA_HASH;
  const generation = await requireCurrentCheckpoint(
    input.versionStore,
    expectedSchemaHash
  );
  const pageSize = validatePositiveInteger(
    input.pageSize ?? PROJECTION_REPAIR_DEFAULT_PAGE_SIZE,
    "projection repair pageSize",
    1000
  );
  const sampleLimit = validatePositiveInteger(
    input.sampleLimit ?? PROJECTION_REPAIR_DEFAULT_SAMPLE_LIMIT,
    "projection repair sampleLimit",
    1000
  );
  const now = input.now ?? new Date();

  const divergent: ProjectionDivergence[] = [];
  const missingDocument: string[] = [];
  const invalidDocumentId: string[] = [];
  const orphanManticore: string[] = [];
  let applied = 0;
  let checked = 0;
  let divergentCount = 0;
  let invalidDocumentIdCount = 0;
  let manticoreChecked = 0;
  let missingDocumentCount = 0;
  let missingProjectionStateCount = 0;
  let orphanManticoreCount = 0;
  let skippedPending = 0;

  if (!input.inventory) {
    let cursor: string | null = null;
    /* oxlint-disable no-await-in-loop -- bounded keyset pages are deliberately ordered */
    for (;;) {
      const rows = await selectCurrentStatePage(
        input.database,
        generation,
        cursor,
        pageSize
      );
      if (rows.length === 0) {
        break;
      }
      cursor = rows.at(-1)?.aggregateId ?? null;
      checked += rows.length;
      const documents = await input.loader.loadManyByAggregateIds(
        rows.map((row) => row.aggregateId)
      );
      const candidates = new Map<string, RepairCandidate>();
      for (const row of rows) {
        const document = documents.get(row.aggregateId);
        if (!document) {
          missingDocumentCount += 1;
          addSample(missingDocument, row.aggregateId, sampleLimit);
          continue;
        }
        const currentHash = projectionHash(document, now);
        if (currentHash === row.projectionHash) {
          continue;
        }
        addRepairReason(candidates, {
          actualPartitions: [],
          aggregateId: row.aggregateId,
          currentHash,
          expectedPartition: documentPartition(document, now),
          invalidateState: false,
          projectedHash: row.projectionHash,
          reason: "projection_hash_mismatch",
        });
      }
      const pageCandidates = [...candidates.values()];
      divergentCount += pageCandidates.length;
      for (const candidate of pageCandidates) {
        addSample(divergent, toDivergence(candidate), sampleLimit);
      }
      const result = await applyRepairPage(
        input,
        pageCandidates,
        generation,
        expectedSchemaHash
      );
      applied += result.applied;
      skippedPending += result.skippedPending;
      if (input.apply) {
        await requireCurrentCheckpoint(
          input.versionStore,
          expectedSchemaHash,
          generation
        );
      }
    }
    /* oxlint-enable no-await-in-loop */
    return {
      applied,
      checked,
      divergent,
      divergentCount,
      generation,
      invalidDocumentId,
      invalidDocumentIdCount,
      inventoryCounts: null,
      manticoreChecked,
      missingDocument,
      missingDocumentCount,
      missingProjectionStateCount,
      orphanManticore,
      orphanManticoreCount,
      skippedPending,
    };
  }

  const [activeCount, archiveCount] = await Promise.all([
    input.inventory.count("active"),
    input.inventory.count("archive"),
  ]);
  const inventoryCounts = { active: activeCount, archive: archiveCount };

  let aanvraagCursor: string | null = null;
  /* oxlint-disable no-await-in-loop -- each page bounds DB + both Manticore partition lookups */
  for (;;) {
    const rows = await selectAanvraagPage(
      input.database,
      aanvraagCursor,
      pageSize
    );
    if (rows.length === 0) {
      break;
    }
    aanvraagCursor = rows.at(-1)?.id ?? null;
    checked += rows.length;
    const aggregateIds = rows.map((row) => row.id);
    const [documents, stateRows, activeRows, archiveRows] = await Promise.all([
      input.loader.loadManyByAggregateIds(aggregateIds),
      input.database
        .select({
          aggregateId: searchProjectionState.aggregateId,
          projectionHash: searchProjectionState.projectionHash,
        })
        .from(searchProjectionState)
        .where(
          and(
            eq(searchProjectionState.generation, generation),
            inArray(searchProjectionState.aggregateId, aggregateIds)
          )
        ),
      input.inventory.findByDocumentIds("active", aggregateIds),
      input.inventory.findByDocumentIds("archive", aggregateIds),
    ]);
    const stateById = new Map(
      stateRows.map((row) => [row.aggregateId, row.projectionHash])
    );
    const activeIds = new Set(activeRows.map((row) => row.documentId));
    const archiveIds = new Set(archiveRows.map((row) => row.documentId));
    const candidates = new Map<string, RepairCandidate>();

    for (const aggregateId of aggregateIds) {
      const document = documents.get(aggregateId);
      if (!document) {
        missingDocumentCount += 1;
        addSample(missingDocument, aggregateId, sampleLimit);
        continue;
      }
      const currentHash = projectionHash(document, now);
      const expectedPartition = documentPartition(document, now);
      const projectedHash = stateById.get(aggregateId) ?? null;
      const actualPartitions: SearchPartition[] = [];
      if (activeIds.has(aggregateId)) {
        actualPartitions.push("active");
      }
      if (archiveIds.has(aggregateId)) {
        actualPartitions.push("archive");
      }
      if (projectedHash === null) {
        missingProjectionStateCount += 1;
        addRepairReason(candidates, {
          actualPartitions,
          aggregateId,
          currentHash,
          expectedPartition,
          invalidateState: false,
          projectedHash,
          reason: "missing_projection_state",
        });
      } else if (projectedHash !== currentHash) {
        addRepairReason(candidates, {
          actualPartitions,
          aggregateId,
          currentHash,
          expectedPartition,
          invalidateState: false,
          projectedHash,
          reason: "projection_hash_mismatch",
        });
      }
      if (actualPartitions.length === 0) {
        addRepairReason(candidates, {
          actualPartitions,
          aggregateId,
          currentHash,
          expectedPartition,
          invalidateState: true,
          projectedHash,
          reason: "missing_manticore_document",
        });
      } else if (actualPartitions.length > 1) {
        addRepairReason(candidates, {
          actualPartitions,
          aggregateId,
          currentHash,
          expectedPartition,
          invalidateState: true,
          projectedHash,
          reason: "duplicate_manticore_document",
        });
      } else if (actualPartitions[0] !== expectedPartition) {
        addRepairReason(candidates, {
          actualPartitions,
          aggregateId,
          currentHash,
          expectedPartition,
          invalidateState: true,
          projectedHash,
          reason: "wrong_manticore_partition",
        });
      }
    }

    const pageCandidates = [...candidates.values()];
    divergentCount += pageCandidates.length;
    for (const candidate of pageCandidates) {
      addSample(divergent, toDivergence(candidate), sampleLimit);
    }
    const result = await applyRepairPage(
      input,
      pageCandidates,
      generation,
      expectedSchemaHash
    );
    applied += result.applied;
    skippedPending += result.skippedPending;
    if (input.apply) {
      await requireCurrentCheckpoint(
        input.versionStore,
        expectedSchemaHash,
        generation
      );
    }
  }
  /* oxlint-enable no-await-in-loop */

  /* oxlint-disable no-await-in-loop -- Manticore numeric-id pages are intentionally sequential */
  for (const partition of INVENTORY_PARTITIONS) {
    let manticoreCursor: number | null = null;
    for (;;) {
      const rows = await input.inventory.listPage(
        partition,
        manticoreCursor,
        pageSize
      );
      if (rows.length === 0) {
        break;
      }
      assertInventoryPage(rows, pageSize, partition, manticoreCursor);
      manticoreCursor = rows.at(-1)?.manticoreId ?? null;
      manticoreChecked += rows.length;
      const validIds = new Set<string>();
      for (const row of rows) {
        if (!UUID_PATTERN.test(row.documentId)) {
          invalidDocumentIdCount += 1;
          addSample(invalidDocumentId, row.documentId, sampleLimit);
          continue;
        }
        validIds.add(row.documentId);
      }
      const ids = [...validIds];
      if (ids.length === 0) {
        continue;
      }
      const currentRows = await input.database
        .select({ id: aanvraag.id })
        .from(aanvraag)
        .where(inArray(aanvraag.id, ids));
      const currentIds = new Set(currentRows.map((row) => row.id));
      const orphanIds = ids.filter((id) => !currentIds.has(id));
      orphanManticoreCount += orphanIds.length;
      for (const id of orphanIds) {
        addSample(orphanManticore, id, sampleLimit);
      }
      const result = await applyOrphanCleanupPage(
        input,
        orphanIds,
        generation,
        expectedSchemaHash
      );
      applied += result.applied;
      skippedPending += result.skippedPending;
      if (input.apply) {
        await requireCurrentCheckpoint(
          input.versionStore,
          expectedSchemaHash,
          generation
        );
      }
    }
  }
  /* oxlint-enable no-await-in-loop */

  return {
    applied,
    checked,
    divergent,
    divergentCount,
    generation,
    invalidDocumentId,
    invalidDocumentIdCount,
    inventoryCounts,
    manticoreChecked,
    missingDocument,
    missingDocumentCount,
    missingProjectionStateCount,
    orphanManticore,
    orphanManticoreCount,
    skippedPending,
  };
};
