import { processObservation } from "@ji/application/identity";
import type { SupportedBronSlug } from "@ji/application/identity";
import { SOURCES } from "@ji/application/sources";
import { CONNECTOR_OBSERVATION_CONTRACT_VERSION } from "@ji/connectors";
import type {
  ConnectorObservation,
  ObjectStore,
  StoredObject,
} from "@ji/connectors";
import type { BronId, ScrapeRunId } from "@ji/domain";
import { and, asc, count, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { compareSourcePointerOrder } from "./bron-runtime";
import type { BronRuntimeDatabase } from "./bron-runtime";
import {
  causeChain,
  describeCauseChain,
  errorNameOf,
} from "./error-cause-chain";
import type { ThrownValue } from "./error-cause-chain";
import { PostgresCurateStore } from "./postgres-curate-store";
import type { PostgresCurateTransaction } from "./postgres-curate-store";
import { redactConnectionUrls } from "./redact-connection-urls";
import { aanvraag, aanvraagVersie, scrapeRun } from "./schema/curated";
import { aanvraagObservation, sourceRecord } from "./schema/staging";

const DEFAULT_ATTEMPT_LIMIT = 100;
const SCAN_MULTIPLIER = 10;
const ACTIVE_STATUSES = ["awaiting_curation", "pending"] as const;
const MISSING_RAW_STATUSES = [
  "deferred_missing_raw",
  "deferred_missing_raw_legacy",
] as const;
const BLOCKED_STATUSES = [
  "blocked_ordering",
  "blocked_ordering_legacy",
] as const;
const RECOVERABLE_STATUSES = [
  ...ACTIVE_STATUSES,
  ...MISSING_RAW_STATUSES,
  ...BLOCKED_STATUSES,
] as const;
const APPLIED_STATUSES = new Set(["already_committed", "curated", "unchanged"]);

/**
 * Terminal review status for an observation whose processing threw something
 * `processCandidate` does not classify.
 *
 * Deliberately absent from `RECOVERABLE_STATUSES`, so `loadCandidates` never
 * selects the row again and `markObservation` never writes over it: that is
 * what stops one poison observation from re-aborting every later pass.
 * CTP-499: observation 7100e5cb-... blocked 7,126 Harvey Nash observations
 * from 9 September because the rethrow below aborted the whole pass and the
 * row stayed `awaiting_curation`, so the next pass picked the same oldest
 * candidate and failed identically.
 *
 * `staging.aanvraag_observation.status` is a plain `text` column with a
 * `'pending'` default and no enum, `CHECK`, or foreign key (see
 * `packages/db/src/schema/staging.ts` and migration 0001), so this value needs
 * no migration. The only constrained column on that table is `outcome`
 * (`aanvraag_observation_outcome_check`, `IN ('new','changed','unchanged')`).
 *
 * Clearing it is a deliberate human act: fix the defect, then
 * `UPDATE ... SET status = 'awaiting_curation'` to re-queue. See
 * `docs/runbooks/onbox-poller.md`.
 */
const CURATION_FAILED_STATUS = "curation_failed";

/** Enough of the chain to name the failing statement without flooding stderr. */
const MAX_LOGGED_CAUSE_LENGTH = 500;

/**
 * How many observations one pass may park before it gives up and throws.
 *
 * Parking is for a row that is individually bad. A systemic in-loop failure --
 * a revoked grant, a half-applied deploy, a constraint added ahead of the code
 * that satisfies it -- looks identical one row at a time, and without a cap it
 * would quietly park an entire backlog inside a single poll budget. Five is
 * enough that a handful of genuinely bad rows still clear in one pass, and
 * small enough that a systemic fault stops the pass while nearly all of the
 * backlog is still recoverable. Rows already parked stay parked and the
 * progress of the pass is kept; the next poll continues from there.
 */
const MAX_PARKED_PER_PASS = 5;

/**
 * Postgres SQLSTATE classes that say "try again", not "this row is bad".
 *
 * - `08` connection exception: a pooled connection reset mid-transaction.
 * - `40` transaction rollback: `40001` serialization failure and `40P01`
 *   deadlock. `processCandidate` takes `FOR UPDATE` on the source record and
 *   `FOR KEY SHARE` on the run while lifecycle reconciliation touches the same
 *   rows, so a deadlock is an ordinary outcome, not a defect in the row.
 * - `53` insufficient resources: out of memory, connection slots, disk.
 * - `57` operator intervention: `57P01` admin shutdown, `57P02` crash shutdown,
 *   `57P03` cannot connect now.
 *
 * Everything else is a property of the row and parks: `54000` (the CTP-499
 * oversized index tuple), `22*` data exceptions, `23*` integrity violations.
 */
const TRANSIENT_SQLSTATE_CLASSES = ["08", "40", "53", "57"] as const;

/**
 * postgres.js reports a client-side connection drop with its own literal codes
 * instead of a SQLSTATE (`node_modules/postgres/src/errors.js`), and a raw
 * socket failure surfaces as a Node system code. All of them are about the
 * connection, never about the row, so they abort the pass like `08*` does.
 */
const TRANSIENT_LITERAL_CODES = new Set([
  "CONNECTION_CLOSED",
  "CONNECTION_DESTROYED",
  "CONNECTION_ENDED",
  "CONNECT_TIMEOUT",
  "ECONNREFUSED",
  "ECONNRESET",
  "EPIPE",
  "ETIMEDOUT",
]);

/**
 * Name carried by the error raised when the object store refuses to answer, as
 * distinct from answering "no such object".
 *
 * These are not interchangeable. An absent object defers to
 * `deferred_missing_raw`, which is a review status an operator requeues by hand
 * (`docs/runbooks/curation-recovery.md`). A store that is merely unreachable
 * would strand every row it touched behind that manual step, so it aborts the
 * pass instead and the next poll retries the whole backlog untouched.
 *
 * Tagged by `name` rather than by class, so the check survives the error
 * crossing a module boundary and needs no shared constructor identity.
 */
export const RAW_READ_ERROR_NAME = "RawReadError";

/** Name carried by the error raised when a pass hits {@link MAX_PARKED_PER_PASS}. */
export const TOO_MANY_PARKED_ERROR_NAME = "TooManyParkedObservationsError";

const namedError = (
  name: string,
  message: string,
  options?: { cause: unknown }
): Error => {
  const error = new Error(message, options);
  error.name = name;
  return error;
};

const rawReadError = (rawPayloadRef: string, cause: unknown): Error =>
  namedError(
    RAW_READ_ERROR_NAME,
    `Raw object read failed for ${rawPayloadRef}`,
    { cause }
  );

const isRawReadError = (input: ThrownValue): boolean =>
  input.error instanceof Error && input.error.name === RAW_READ_ERROR_NAME;

/** postgres.js hangs the SQLSTATE off `code`; nothing else on the error matters here. */
const SQLSTATE_SCHEMA = z.object({ code: z.string() });

/**
 * True when any link of the cause chain carries a transient SQLSTATE or one of
 * the client-side connection codes in {@link TRANSIENT_LITERAL_CODES}.
 *
 * The chain is walked rather than the outermost error inspected, because
 * Drizzle wraps the postgres.js error that actually carries `code`.
 */
export const isTransientPostgresError = (input: ThrownValue): boolean =>
  causeChain(input).some((link) => {
    const parsed = SQLSTATE_SCHEMA.safeParse(link);
    return (
      parsed.success &&
      (TRANSIENT_LITERAL_CODES.has(parsed.data.code) ||
        TRANSIENT_SQLSTATE_CLASSES.some((klass) =>
          parsed.data.code.startsWith(klass)
        ))
    );
  });

const OBSERVATION_SCHEMA = z.object({
  bronId: z.string(),
  bronReferentie: z.string().trim().min(1),
  contentHash: z.string().trim().min(1),
  contentType: z.enum(["html", "json", "pdf"]),
  contractVersion: z.literal(CONNECTOR_OBSERVATION_CONTRACT_VERSION),
  observedAt: z.iso.datetime({ offset: true }),
  rawPayloadRef: z.string().trim().min(1),
  scrapeRunId: z.string(),
  sourceRecordId: z.string(),
});

type RecoveryDisposition =
  | "already_committed"
  | "blocked_ordering"
  | "process"
  | "superseded"
  | "unchanged";

type CandidateDisposition =
  | Exclude<RecoveryDisposition, "process">
  | "curated"
  | "curation_failed"
  | "pending"
  | "quarantined";

interface PersistedPointer {
  contentHash: string;
  observedAt: string;
  phase: "ambiguous" | "lifecycle" | "observation";
  rawPayloadRef: string;
  scrapeRunId: string;
  startedAt: Date;
}

interface RecoveryCandidate {
  bronId: string;
  contentHash: string;
  createdAt: Date;
  id: string;
  payload: ConnectorObservation;
  runBronId: string;
  runStartedAt: Date;
  scrapeRunId: string;
  sourceRecordId: string;
  sourceRecordBronId: string;
  status: string;
}

type RecoveryDatabase = BronRuntimeDatabase | PostgresCurateTransaction;

export interface CurateScrapeRunInput {
  attemptLimit?: number;
  bronId: BronId;
  bronSlug: SupportedBronSlug;
  database: BronRuntimeDatabase;
  objectStore: ObjectStore;
  scrapeRunId: ScrapeRunId;
}

export interface CurateScrapeRunResult {
  alreadyCommitted: number;
  attemptedObservationIds: string[];
  blockedOrdering: number;
  curated: number;
  /** Candidates that threw and were parked on `curation_failed`. */
  failed: number;
  pending: number;
  quarantined: number;
  superseded: number;
  unchanged: number;
  remaining: number;
}

export const classifyRecoveryCandidate = (input: {
  candidate: PersistedPointer;
  current: PersistedPointer | null;
  legacyPending: boolean;
}): RecoveryDisposition => {
  if (!input.current) {
    return "process";
  }
  const { candidate, current } = input;
  if (current.phase === "ambiguous") {
    return "blocked_ordering";
  }
  // Lifecycle reconciliation runs before curation and can write a version in
  // this same run with a later timestamp. That is a phase boundary, not proof
  // that this run's observation was already curated.
  if (
    candidate.scrapeRunId === current.scrapeRunId &&
    current.phase === "lifecycle"
  ) {
    return "process";
  }
  if (
    input.legacyPending &&
    current.phase === "observation" &&
    candidate.scrapeRunId === current.scrapeRunId &&
    candidate.contentHash === current.contentHash &&
    candidate.rawPayloadRef === current.rawPayloadRef
  ) {
    return "already_committed";
  }
  const order = compareSourcePointerOrder(candidate, current);
  if (!input.legacyPending && order === 0) {
    return "process";
  }
  if (
    input.legacyPending &&
    candidate.contentHash === current.contentHash &&
    order <= 0
  ) {
    return "unchanged";
  }
  if (order < 0) {
    return "superseded";
  }
  if (order === 0) {
    return "blocked_ordering";
  }
  return "process";
};

const queryCandidates = (
  input: CurateScrapeRunInput,
  statuses: readonly string[],
  limit: number,
  scrapeRunId?: string
) => {
  const filters = [
    eq(aanvraagObservation.bronId, input.bronId),
    eq(scrapeRun.status, "succeeded"),
    inArray(aanvraagObservation.status, [...statuses]),
  ];
  if (scrapeRunId) {
    filters.push(eq(aanvraagObservation.scrapeRunId, scrapeRunId));
  }
  return input.database
    .select({
      bronId: aanvraagObservation.bronId,
      bronReferentie: sourceRecord.bronReferentie,
      contentHash: aanvraagObservation.contentHash,
      createdAt: aanvraagObservation.createdAt,
      id: aanvraagObservation.id,
      payload: aanvraagObservation.payload,
      runBronId: scrapeRun.bronId,
      runStartedAt: scrapeRun.gestart,
      scrapeRunId: aanvraagObservation.scrapeRunId,
      sourceRecordBronId: sourceRecord.bronId,
      sourceRecordId: aanvraagObservation.sourceRecordId,
      status: aanvraagObservation.status,
    })
    .from(aanvraagObservation)
    .innerJoin(scrapeRun, eq(scrapeRun.id, aanvraagObservation.scrapeRunId))
    .innerJoin(
      sourceRecord,
      eq(sourceRecord.id, aanvraagObservation.sourceRecordId)
    )
    .where(and(...filters))
    .orderBy(asc(aanvraagObservation.createdAt), asc(aanvraagObservation.id))
    .limit(limit);
};

const loadCandidates = async (
  input: CurateScrapeRunInput,
  attemptLimit: number
): Promise<{
  candidates: RecoveryCandidate[];
  invalidRows: { id: string; status: string }[];
}> => {
  const scanLimit = attemptLimit * SCAN_MULTIPLIER;
  const [currentRows, activeRows, blockedRows] = await Promise.all([
    queryCandidates(input, ACTIVE_STATUSES, scanLimit, input.scrapeRunId),
    queryCandidates(input, ACTIVE_STATUSES, scanLimit),
    queryCandidates(input, BLOCKED_STATUSES, attemptLimit),
  ]);
  const rows = [...currentRows, ...activeRows, ...blockedRows];

  const candidates: RecoveryCandidate[] = [];
  const invalidRows: { id: string; status: string }[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.id)) {
      continue;
    }
    seen.add(row.id);
    const parsed = OBSERVATION_SCHEMA.safeParse(row.payload);
    if (
      !parsed.success ||
      parsed.data.bronId !== row.bronId ||
      parsed.data.bronReferentie !== row.bronReferentie ||
      parsed.data.contentHash !== row.contentHash ||
      parsed.data.scrapeRunId !== row.scrapeRunId ||
      parsed.data.sourceRecordId !== row.sourceRecordId ||
      row.runBronId !== input.bronId ||
      row.sourceRecordBronId !== input.bronId
    ) {
      invalidRows.push({ id: row.id, status: row.status });
      continue;
    }
    // SAFETY: the schema validates every field consumed below; remaining
    // connector contract fields stay opaque to recovery classification.
    const payload = row.payload as ConnectorObservation;
    candidates.push({ ...row, payload });
  }
  return { candidates, invalidRows };
};

const isRecoverableStatus = (status: string): boolean =>
  RECOVERABLE_STATUSES.some((candidate) => candidate === status);

const isLegacyStatus = (status: string): boolean =>
  status === "pending" || status.endsWith("_legacy");

const blockedStatus = (status: string): string =>
  isLegacyStatus(status) ? "blocked_ordering_legacy" : "blocked_ordering";

const missingRawStatus = (status: string): string =>
  isLegacyStatus(status)
    ? "deferred_missing_raw_legacy"
    : "deferred_missing_raw";

const fairOldestFirst = (
  candidates: readonly RecoveryCandidate[],
  limit: number
): RecoveryCandidate[] => {
  const byIdentity = new Map<string, RecoveryCandidate[]>();
  for (const candidate of candidates) {
    const queue = byIdentity.get(candidate.sourceRecordId) ?? [];
    queue.push(candidate);
    byIdentity.set(candidate.sourceRecordId, queue);
  }
  for (const queue of byIdentity.values()) {
    queue.sort((left, right) =>
      compareSourcePointerOrder(
        { ...left.payload, startedAt: left.runStartedAt },
        { ...right.payload, startedAt: right.runStartedAt }
      )
    );
  }

  const ordered: RecoveryCandidate[] = [];
  while (ordered.length < limit) {
    let added = false;
    for (const queue of byIdentity.values()) {
      const candidate = queue.shift();
      if (candidate) {
        ordered.push(candidate);
        added = true;
        if (ordered.length === limit) {
          break;
        }
      }
    }
    if (!added) {
      break;
    }
  }
  return ordered;
};

const currentPointer = async (
  database: RecoveryDatabase,
  payload: ConnectorObservation
): Promise<PersistedPointer | null> => {
  const [row] = await database
    .select({
      contentHash: aanvraag.contentHash,
      observedAt: aanvraag.laatstGezienOp,
      rawPayloadRef: aanvraag.rawPayloadRef,
      scrapeRunId: aanvraag.scrapeRunId,
      startedAt: scrapeRun.gestart,
    })
    .from(aanvraag)
    .innerJoin(scrapeRun, eq(scrapeRun.id, aanvraag.scrapeRunId))
    .where(
      and(
        eq(aanvraag.bronId, payload.bronId),
        eq(aanvraag.bronReferentie, payload.bronReferentie)
      )
    )
    .limit(1);
  return row
    ? {
        ...row,
        observedAt: row.observedAt.toISOString(),
        phase: "observation",
      }
    : null;
};

const classifyVersionPhase = async (
  database: RecoveryDatabase,
  aanvraagId: string,
  versie: number
): Promise<"ambiguous" | "lifecycle" | "observation"> => {
  if (versie === 1) {
    return "observation";
  }
  const [currentRow] = await database
    .select({
      contentHash: aanvraagVersie.contentHash,
      rawPayloadRef: aanvraagVersie.rawPayloadRef,
    })
    .from(aanvraagVersie)
    .where(
      and(
        eq(aanvraagVersie.aanvraagId, aanvraagId),
        eq(aanvraagVersie.versie, versie)
      )
    )
    .limit(1);
  const [previousRow] = await database
    .select({
      contentHash: aanvraagVersie.contentHash,
      rawPayloadRef: aanvraagVersie.rawPayloadRef,
    })
    .from(aanvraagVersie)
    .where(
      and(
        eq(aanvraagVersie.aanvraagId, aanvraagId),
        eq(aanvraagVersie.versie, versie - 1)
      )
    )
    .limit(1);
  if (!currentRow || !previousRow) {
    return "ambiguous";
  }
  return currentRow.contentHash !== previousRow.contentHash ||
    currentRow.rawPayloadRef !== previousRow.rawPayloadRef
    ? "observation"
    : "lifecycle";
};

const latestVersionPointer = async (
  database: RecoveryDatabase,
  payload: ConnectorObservation
): Promise<PersistedPointer | null> => {
  const [row] = await database
    .select({
      aanvraagId: aanvraagVersie.aanvraagId,
      contentHash: aanvraagVersie.contentHash,
      observedAt: aanvraagVersie.geldigVan,
      rawPayloadRef: aanvraagVersie.rawPayloadRef,
      scrapeRunId: aanvraagVersie.scrapeRunId,
      startedAt: scrapeRun.gestart,
      versie: aanvraagVersie.versie,
    })
    .from(aanvraagVersie)
    .innerJoin(aanvraag, eq(aanvraag.id, aanvraagVersie.aanvraagId))
    .innerJoin(scrapeRun, eq(scrapeRun.id, aanvraagVersie.scrapeRunId))
    .where(
      and(
        eq(aanvraag.bronId, payload.bronId),
        eq(aanvraag.bronReferentie, payload.bronReferentie)
      )
    )
    .orderBy(desc(aanvraagVersie.geldigVan), desc(aanvraagVersie.versie))
    .limit(1);
  if (!row) {
    return null;
  }
  const phase = await classifyVersionPhase(
    database,
    row.aanvraagId,
    row.versie
  );
  return {
    contentHash: row.contentHash,
    observedAt: row.observedAt.toISOString(),
    phase,
    rawPayloadRef: row.rawPayloadRef,
    scrapeRunId: row.scrapeRunId,
    startedAt: row.startedAt,
  };
};

const committedFallback = async (
  database: RecoveryDatabase,
  payload: ConnectorObservation
): Promise<PersistedPointer | null> => {
  const current = await currentPointer(database, payload);
  const version = await latestVersionPointer(database, payload);
  if (!current) {
    return version;
  }
  if (!version) {
    return current;
  }
  return compareSourcePointerOrder(version, current) > 0 ? version : current;
};

const effectiveObservedAt = async (
  database: RecoveryDatabase,
  payload: ConnectorObservation
): Promise<Date> => {
  const observedAt = new Date(payload.observedAt);
  const [latest] = await database
    .select({ geldigVan: aanvraagVersie.geldigVan })
    .from(aanvraagVersie)
    .innerJoin(aanvraag, eq(aanvraag.id, aanvraagVersie.aanvraagId))
    .where(
      and(
        eq(aanvraag.bronId, payload.bronId),
        eq(aanvraag.bronReferentie, payload.bronReferentie)
      )
    )
    .orderBy(desc(aanvraagVersie.geldigVan))
    .limit(1);
  return latest && latest.geldigVan > observedAt
    ? latest.geldigVan
    : observedAt;
};

const isObservationCommittedVersion = async (
  database: RecoveryDatabase,
  payload: ConnectorObservation
): Promise<boolean> => {
  const [row] = await database
    .select({
      aanvraagId: aanvraagVersie.aanvraagId,
      versie: aanvraagVersie.versie,
    })
    .from(aanvraagVersie)
    .innerJoin(aanvraag, eq(aanvraag.id, aanvraagVersie.aanvraagId))
    .where(
      and(
        eq(aanvraag.bronId, payload.bronId),
        eq(aanvraag.bronReferentie, payload.bronReferentie),
        eq(aanvraagVersie.scrapeRunId, payload.scrapeRunId),
        eq(aanvraagVersie.contentHash, payload.contentHash),
        eq(aanvraagVersie.rawPayloadRef, payload.rawPayloadRef)
      )
    )
    .limit(1);
  if (!row) {
    return false;
  }
  const phase = await classifyVersionPhase(
    database,
    row.aanvraagId,
    row.versie
  );
  return phase === "observation";
};

const toCandidatePointer = (
  candidate: RecoveryCandidate
): PersistedPointer => ({
  ...candidate.payload,
  phase: "observation",
  startedAt: candidate.runStartedAt,
});

const appliedHighWater = async (
  database: RecoveryDatabase,
  candidate: RecoveryCandidate,
  fallback: PersistedPointer | null
): Promise<PersistedPointer | null> => {
  const rows = await database
    .select({
      payload: aanvraagObservation.payload,
      startedAt: scrapeRun.gestart,
      status: aanvraagObservation.status,
    })
    .from(aanvraagObservation)
    .innerJoin(scrapeRun, eq(scrapeRun.id, aanvraagObservation.scrapeRunId))
    .where(eq(aanvraagObservation.sourceRecordId, candidate.sourceRecordId));
  let maximum = fallback;
  for (const row of rows) {
    const parsed = OBSERVATION_SCHEMA.safeParse(row.payload);
    if (!parsed.success) {
      continue;
    }
    const pointer: PersistedPointer = {
      contentHash: parsed.data.contentHash,
      observedAt: parsed.data.observedAt,
      phase: "observation",
      rawPayloadRef: parsed.data.rawPayloadRef,
      scrapeRunId: parsed.data.scrapeRunId,
      startedAt: row.startedAt,
    };
    if (APPLIED_STATUSES.has(row.status)) {
      if (
        maximum &&
        pointer.scrapeRunId === maximum.scrapeRunId &&
        pointer.contentHash === maximum.contentHash &&
        pointer.rawPayloadRef === maximum.rawPayloadRef
      ) {
        // Source ordering comes from the immutable observation timestamp. The
        // later SCD2 validity floor is applied only when committing below.
        maximum = pointer;
      } else if (!maximum || compareSourcePointerOrder(pointer, maximum) >= 0) {
        maximum = pointer;
      }
    }
  }
  return maximum;
};

const hasEarlierRecoverable = async (
  database: RecoveryDatabase,
  candidate: RecoveryCandidate
): Promise<boolean> => {
  const rows = await database
    .select({
      id: aanvraagObservation.id,
      payload: aanvraagObservation.payload,
      startedAt: scrapeRun.gestart,
    })
    .from(aanvraagObservation)
    .innerJoin(scrapeRun, eq(scrapeRun.id, aanvraagObservation.scrapeRunId))
    .where(
      and(
        eq(aanvraagObservation.sourceRecordId, candidate.sourceRecordId),
        eq(scrapeRun.status, "succeeded"),
        inArray(aanvraagObservation.status, [...RECOVERABLE_STATUSES])
      )
    );
  const candidatePointer = toCandidatePointer(candidate);
  return rows.some((row) => {
    if (row.id === candidate.id) {
      return false;
    }
    const parsed = OBSERVATION_SCHEMA.safeParse(row.payload);
    if (!parsed.success) {
      return row.startedAt.getTime() <= candidate.runStartedAt.getTime();
    }
    return (
      compareSourcePointerOrder(
        {
          contentHash: parsed.data.contentHash,
          observedAt: parsed.data.observedAt,
          rawPayloadRef: parsed.data.rawPayloadRef,
          scrapeRunId: parsed.data.scrapeRunId,
          startedAt: row.startedAt,
        },
        candidatePointer
      ) < 0
    );
  });
};

const markObservation = async (
  database: RecoveryDatabase,
  id: string,
  status: string
): Promise<boolean> => {
  const rows = await database
    .update(aanvraagObservation)
    .set({ status })
    .where(
      and(
        eq(aanvraagObservation.id, id),
        inArray(aanvraagObservation.status, [...RECOVERABLE_STATUSES])
      )
    )
    .returning({ id: aanvraagObservation.id });
  return rows.length > 0;
};

/** Redacted and length-capped, ready to go on a log line. */
const loggableCauseChain = (input: ThrownValue): string =>
  redactConnectionUrls(describeCauseChain(input)).slice(
    0,
    MAX_LOGGED_CAUSE_LENGTH
  );

/**
 * Reads the raw object, keeping "no such object" and "the store would not
 * answer" apart.
 *
 * `null` means absent, which the caller defers to `deferred_missing_raw`. A
 * throw means the store is unreachable, which says nothing about this row and
 * must not consume a review status, so it is retagged as `RawReadError`
 * and aborts the pass: the next poll then retries the whole backlog with every
 * row still in an active status.
 */
const readStoredRaw = async (
  objectStore: ObjectStore,
  rawPayloadRef: string
): Promise<StoredObject | null> => {
  try {
    return await objectStore.get(rawPayloadRef);
  } catch (error) {
    process.stderr.write(
      `${JSON.stringify({
        causeChain: loggableCauseChain({ error }),
        errorName: errorNameOf({ error }),
        event: "curation_raw_read_failed",
        rawPayloadRef,
      })}\n`
    );
    throw rawReadError(rawPayloadRef, error);
  }
};

const processCandidate = async (
  input: CurateScrapeRunInput,
  candidate: RecoveryCandidate
): Promise<CandidateDisposition> => {
  const preliminaryCommitted =
    isLegacyStatus(candidate.status) &&
    (await isObservationCommittedVersion(input.database, candidate.payload));
  const preliminaryCurrent = await committedFallback(
    input.database,
    candidate.payload
  );
  const preliminaryHighWater = await appliedHighWater(
    input.database,
    candidate,
    preliminaryCurrent
  );
  const preliminaryDisposition = preliminaryCommitted
    ? "already_committed"
    : classifyRecoveryCandidate({
        candidate: toCandidatePointer(candidate),
        current: preliminaryHighWater,
        legacyPending: isLegacyStatus(candidate.status),
      });
  // An unreachable object store is a storage problem, never a property of this
  // row, so it must reach neither the terminal `curation_failed` path nor the
  // `deferred_missing_raw` one: the first needs an operator to fix a defect
  // that does not exist, and the second is equally manual to requeue, so an
  // outage would strand up to `attemptLimit` rows per source per cycle. It
  // aborts the pass instead. Only a genuinely absent object defers.
  const stored =
    preliminaryDisposition === "process"
      ? await readStoredRaw(input.objectStore, candidate.payload.rawPayloadRef)
      : null;
  if (preliminaryDisposition === "process" && !stored) {
    await markObservation(
      input.database,
      candidate.id,
      missingRawStatus(candidate.status)
    );
    return "pending";
  }

  return input.database.transaction(async (tx) => {
    const [lockedRun] = await tx
      .select({
        bronId: scrapeRun.bronId,
        status: scrapeRun.status,
      })
      .from(scrapeRun)
      .where(eq(scrapeRun.id, candidate.scrapeRunId))
      .limit(1)
      .for("key share");
    if (
      !lockedRun ||
      lockedRun.bronId !== input.bronId ||
      lockedRun.status !== "succeeded"
    ) {
      return "blocked_ordering" as const;
    }
    const [lockedIdentity] = await tx
      .select({
        bronId: sourceRecord.bronId,
        bronReferentie: sourceRecord.bronReferentie,
        id: sourceRecord.id,
      })
      .from(sourceRecord)
      .where(eq(sourceRecord.id, candidate.sourceRecordId))
      .limit(1)
      .for("update");
    if (
      !lockedIdentity ||
      lockedIdentity.bronId !== candidate.payload.bronId ||
      lockedIdentity.bronReferentie !== candidate.payload.bronReferentie
    ) {
      return "blocked_ordering" as const;
    }
    const [locked] = await tx
      .select({
        bronId: aanvraagObservation.bronId,
        contentHash: aanvraagObservation.contentHash,
        payload: aanvraagObservation.payload,
        scrapeRunId: aanvraagObservation.scrapeRunId,
        sourceRecordId: aanvraagObservation.sourceRecordId,
        status: aanvraagObservation.status,
      })
      .from(aanvraagObservation)
      .where(eq(aanvraagObservation.id, candidate.id))
      .limit(1)
      .for("update");
    if (!locked || !isRecoverableStatus(locked.status)) {
      return "already_committed" as const;
    }
    if (
      locked.bronId !== candidate.bronId ||
      locked.contentHash !== candidate.contentHash ||
      locked.scrapeRunId !== candidate.scrapeRunId ||
      locked.sourceRecordId !== candidate.sourceRecordId ||
      !OBSERVATION_SCHEMA.safeParse(locked.payload).success
    ) {
      await markObservation(tx, candidate.id, blockedStatus(locked.status));
      return "blocked_ordering" as const;
    }
    if (await hasEarlierRecoverable(tx, candidate)) {
      await markObservation(tx, candidate.id, blockedStatus(locked.status));
      return "blocked_ordering" as const;
    }

    const committed =
      isLegacyStatus(locked.status) &&
      (await isObservationCommittedVersion(tx, candidate.payload));
    const current = await appliedHighWater(
      tx,
      candidate,
      await committedFallback(tx, candidate.payload)
    );
    const disposition = committed
      ? "already_committed"
      : classifyRecoveryCandidate({
          candidate: toCandidatePointer(candidate),
          current,
          legacyPending: isLegacyStatus(locked.status),
        });
    if (disposition !== "process") {
      await markObservation(
        tx,
        candidate.id,
        disposition === "blocked_ordering"
          ? blockedStatus(locked.status)
          : disposition
      );
      return disposition;
    }

    if (!stored) {
      await markObservation(tx, candidate.id, blockedStatus(locked.status));
      return "blocked_ordering" as const;
    }
    const processed = await processObservation(new PostgresCurateStore(tx), {
      body: stored.body,
      bronId: candidate.payload.bronId,
      bronSlug: input.bronSlug,
      contentHash: candidate.payload.contentHash,
      observedAt: await effectiveObservedAt(tx, candidate.payload),
      rawPayloadRef: candidate.payload.rawPayloadRef,
      scrapeRunId: candidate.payload.scrapeRunId,
    });
    await tx
      .update(aanvraagObservation)
      .set({ status: processed.status })
      .where(eq(aanvraagObservation.id, candidate.id));
    return processed.status;
  });
};

const recordDisposition = (
  result: CurateScrapeRunResult,
  blockedIdentities: Set<string>,
  candidate: RecoveryCandidate,
  disposition: CandidateDisposition
): void => {
  if (disposition === "pending") {
    blockedIdentities.add(candidate.sourceRecordId);
  } else if (disposition === "curated") {
    result.curated += 1;
  } else if (disposition === "quarantined") {
    result.quarantined += 1;
    blockedIdentities.add(candidate.sourceRecordId);
  } else if (disposition === "curation_failed") {
    result.failed += 1;
    // Block the identity for the rest of this pass, so a newer observation of
    // the same source record cannot be curated immediately behind the one that
    // just failed. This is a within-pass guard only: a later pass will curate
    // the newer observation, and a re-queued row then classifies as superseded
    // rather than rewinding the aanvraag.
    blockedIdentities.add(candidate.sourceRecordId);
  } else if (disposition === "already_committed") {
    result.alreadyCommitted += 1;
  } else if (disposition === "blocked_ordering") {
    result.blockedOrdering += 1;
    blockedIdentities.add(candidate.sourceRecordId);
  } else if (disposition === "superseded") {
    result.superseded += 1;
  } else {
    result.unchanged += 1;
  }
};

/**
 * Parks one candidate that threw and leaves a line on stderr naming it.
 *
 * `processCandidate` does all its writing inside a transaction, so an
 * unexpected throw has already rolled back: the row is still in a recoverable
 * status here, which is exactly what `markObservation` requires. When it is
 * not -- another writer moved it first -- the candidate still counts as failed
 * and its identity is still blocked, because this pass did not curate it.
 */
const parkFailedCandidate = async (input: {
  database: BronRuntimeDatabase;
  error: unknown;
  observationId: string;
}): Promise<void> => {
  const { database, error, observationId } = input;
  process.stderr.write(
    `${JSON.stringify({
      causeChain: loggableCauseChain({ error }),
      errorName: errorNameOf({ error }),
      event: "curation_candidate_failed",
      observationId,
      status: CURATION_FAILED_STATUS,
    })}\n`
  );
  await markObservation(database, observationId, CURATION_FAILED_STATUS);
};

export const curateScrapeRun = async (
  input: CurateScrapeRunInput
): Promise<CurateScrapeRunResult> => {
  const source = SOURCES[input.bronSlug];
  if (!source || source.bronId !== input.bronId) {
    throw new Error("Curation source slug does not match bronId");
  }
  const attemptLimit = input.attemptLimit ?? DEFAULT_ATTEMPT_LIMIT;
  if (
    !Number.isSafeInteger(attemptLimit) ||
    attemptLimit < 1 ||
    attemptLimit > 500
  ) {
    throw new RangeError("attemptLimit must be an integer between 1 and 500");
  }
  const loaded = await loadCandidates(input, attemptLimit);
  const candidates = fairOldestFirst(loaded.candidates, attemptLimit);
  // Malformed review rows use only capacity left after valid work, so a large
  // historical review queue cannot starve current curation.
  const invalidRows = loaded.invalidRows.slice(
    0,
    attemptLimit - candidates.length
  );
  const result: CurateScrapeRunResult = {
    alreadyCommitted: 0,
    attemptedObservationIds: [],
    blockedOrdering: 0,
    curated: 0,
    failed: 0,
    pending: 0,
    quarantined: 0,
    remaining: 0,
    superseded: 0,
    unchanged: 0,
  };
  for (const invalidRow of invalidRows) {
    // oxlint-disable-next-line no-await-in-loop -- each invalid row receives a durable review marker
    const marked = await markObservation(
      input.database,
      invalidRow.id,
      blockedStatus(invalidRow.status)
    );
    if (marked) {
      result.attemptedObservationIds.push(invalidRow.id);
      result.blockedOrdering += 1;
    }
  }
  const blockedIdentities = new Set<string>();
  for (const candidate of candidates) {
    if (blockedIdentities.has(candidate.sourceRecordId)) {
      continue;
    }
    result.attemptedObservationIds.push(candidate.id);
    try {
      // oxlint-disable-next-line no-await-in-loop -- recovery is ordered per identity
      const disposition = await processCandidate(input, candidate);
      recordDisposition(result, blockedIdentities, candidate, disposition);
    } catch (error) {
      // CTP-499: rethrowing every error here aborted the whole pass, so one
      // candidate that Postgres refused blocked every other identity of the
      // source indefinitely. Only errors that are genuinely about this row park
      // it and let the pass continue.
      //
      // An unreachable object store and a transient Postgres failure are about
      // the infrastructure, not the row. Parking either would burn a review
      // status that only an operator can clear, on a condition a retry would
      // have cleared by itself, so both abort the pass and leave every row in
      // an active status for the next poll.
      if (isRawReadError({ error }) || isTransientPostgresError({ error })) {
        throw error;
      }
      // oxlint-disable-next-line no-await-in-loop -- the marker must land before the next candidate
      await parkFailedCandidate({
        database: input.database,
        error,
        observationId: candidate.id,
      });
      recordDisposition(
        result,
        blockedIdentities,
        candidate,
        "curation_failed"
      );
      if (result.failed >= MAX_PARKED_PER_PASS) {
        throw namedError(
          TOO_MANY_PARKED_ERROR_NAME,
          `Parked ${result.failed} observations in one pass; stopping in case the failure is systemic`
        );
      }
    }
  }
  const [backlogRows, missingRawRows] = await Promise.all([
    input.database
      .select({ value: count() })
      .from(aanvraagObservation)
      .innerJoin(scrapeRun, eq(scrapeRun.id, aanvraagObservation.scrapeRunId))
      .where(
        and(
          eq(aanvraagObservation.bronId, input.bronId),
          eq(scrapeRun.status, "succeeded"),
          inArray(aanvraagObservation.status, [...RECOVERABLE_STATUSES])
        )
      ),
    input.database
      .select({ value: count() })
      .from(aanvraagObservation)
      .innerJoin(scrapeRun, eq(scrapeRun.id, aanvraagObservation.scrapeRunId))
      .where(
        and(
          eq(aanvraagObservation.bronId, input.bronId),
          eq(scrapeRun.status, "succeeded"),
          inArray(aanvraagObservation.status, [...MISSING_RAW_STATUSES])
        )
      ),
  ]);
  const [backlog] = backlogRows;
  const [missingRaw] = missingRawRows;
  result.pending = missingRaw?.value ?? 0;
  result.remaining = backlog?.value ?? 0;
  return result;
};
