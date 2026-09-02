import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  buildContentAddressedRawObjectPath,
  hashContent,
  parseContentAddressedRawObjectPath,
} from "@ji/connectors";
import type { ObjectStore } from "@ji/connectors";
import { UNKNOWN } from "@ji/domain";

import { curateObservation } from "../identity/curate";
import type { CurateStore } from "../identity/curate";
import { field } from "../normalise";
import type { NormalisedAanvraagDraft } from "../normalise";
import { resolveMotianV1Binding } from "./motian-v1-bindings";
import type {
  BackfillBronBinding,
  BackfillExecution,
  BackfillFailureEvidence,
  BackfillPlatformMetrics,
  BackfillProvenanceRecord,
  BackfillRunEvidence,
  BackfillRunResult,
  BackfillScopeManifest,
  BackfillSnapshotWindow,
  BackfillTargetProvenanceRecord,
  BackfillTargetReconciliation,
  NeonV1Fixture,
  NeonV1JobRow,
  NeonV1Source,
  RunNeonV1BackfillInput,
} from "./neon-v1-types";
import {
  NEON_V1_BACKFILL_CONTRACT_VERSION,
  NEON_V1_PARSER_VERSION,
  BACKFILL_SCOPE_MANIFEST_VERSION,
  BACKFILL_TARGET_RECONCILIATION_VERSION,
  backfillFailureEvidenceSchema,
} from "./neon-v1-types";

export {
  NEON_V1_BACKFILL_CONTRACT_VERSION,
  NEON_V1_FORBIDDEN_TABLES,
  NEON_V1_PARSER_VERSION,
  type BackfillBronBinding,
  type BackfillExecution,
  type BackfillExecutionMode,
  type BackfillFailureEvidence,
  type BackfillPlatformMetrics,
  type BackfillProvenanceRecord,
  type BackfillProvenanceStore,
  type BackfillRunEvidence,
  type BackfillRunMetrics,
  type BackfillRunResult,
  type BackfillRunStore,
  type BackfillScopeManifest,
  type BackfillScope,
  type BackfillSnapshotWindow,
  type BackfillTargetProvenanceRecord,
  type BackfillTargetReconciliation,
  type NeonV1Fixture,
  type NeonV1ForbiddenTable,
  type NeonV1JobRow,
  type NeonV1Source,
  type RunNeonV1BackfillInput,
  BACKFILL_FAILURE_CODES,
  BACKFILL_FAILURE_PHASES,
  BACKFILL_SCOPE_MANIFEST_VERSION,
  BACKFILL_TARGET_RECONCILIATION_VERSION,
  backfillFailureEvidenceSchema,
} from "./neon-v1-types";
export { InMemoryBackfillProvenanceStore } from "./in-memory-backfill-provenance-store";
export { InMemoryBackfillRunStore } from "./in-memory-backfill-run-store";
export { UnreachableNeonV1Source } from "./unreachable-neon-v1-source";

const fixtureRoot = path.join(process.cwd(), "fixtures", "backfill");

export const fixturePath = (...segments: string[]): string =>
  path.join(fixtureRoot, ...segments);

export const loadNeonV1Fixture = async (
  relativePath: string
): Promise<NeonV1Fixture> => {
  const raw = await readFile(fixturePath(relativePath), "utf-8");
  // SAFETY: Fixture files are repo-owned envelopes validated against contractVersion.
  const parsed = JSON.parse(raw) as NeonV1Fixture;
  if (parsed.contractVersion !== NEON_V1_BACKFILL_CONTRACT_VERSION) {
    throw new Error(
      `Unsupported Neon v1 fixture at ${relativePath}: expected contract ${NEON_V1_BACKFILL_CONTRACT_VERSION}`
    );
  }
  return parsed;
};

export const createFixtureNeonV1Source = (
  fixture: NeonV1Fixture
): NeonV1Source => {
  const orderedJobs = fixture.jobs.toSorted((left, right) =>
    left.id.localeCompare(right.id)
  );
  return {
    consumeSnapshot: async (_batchSize, consume) => {
      await consume(orderedJobs);
      return {
        completedAt: fixture.capturedAt,
        startedAt: fixture.capturedAt,
      };
    },
    label: "fixture",
    loadJobs: () => Promise.resolve([...orderedJobs]),
  };
};

export const resolveMotianDatabaseUrl = (): string | undefined =>
  process.env.MOTIAN_DATABASE_URL?.trim() || undefined;

const serialiseRawSource = (job: NeonV1JobRow): string => {
  const serialised = JSON.stringify(job.sourceRow ?? job);
  if (serialised === undefined) {
    throw new Error("Motian v1 source row is not JSON serialisable");
  }
  return serialised;
};

const rawBodyForJob = (job: NeonV1JobRow): Uint8Array =>
  new TextEncoder().encode(serialiseRawSource(job));

const bytesEqual = (left: Uint8Array, right: Uint8Array): boolean => {
  if (left.byteLength !== right.byteLength) {
    return false;
  }
  return left.every((byte, index) => byte === right[index]);
};

const tariefValue = (
  value: number | null | undefined
): string | typeof UNKNOWN =>
  value === null || value === undefined ? UNKNOWN : String(value);

const sourceStatusForJob = (job: NeonV1JobRow): string | null =>
  job.status?.trim() || null;

const lifecycleForJob = (
  job: NeonV1JobRow,
  sourceStatus: string | null
): "active" | "closed" => {
  const sourceHasArchiveSignal =
    (job.archived_at !== null && job.archived_at !== undefined) ||
    (job.deleted_at !== null && job.deleted_at !== undefined);
  const sourceIsClosed =
    sourceHasArchiveSignal ||
    (sourceStatus !== null && sourceStatus.toLowerCase() !== "open");
  return sourceIsClosed ? "closed" : "active";
};

const descriptionForJob = (job: NeonV1JobRow): string =>
  job.description?.trim() ||
  `${job.title} (${job.platform}/${job.external_id})`;

const opdrachtgeverForJob = (job: NeonV1JobRow): string | typeof UNKNOWN =>
  job.end_client?.trim() || job.company?.trim() || UNKNOWN;

/** Motian publishes no creation timestamp. `posted_at` is the only honest
 * source for the publication/first-seen instant. When it is absent, first seen
 * remains unknown; `scraped_at` is retained separately as scrape provenance. */
const firstSeenAtForJob = (job: NeonV1JobRow): string | null =>
  job.posted_at ?? null;

const v1SpecificFieldsForJob = (
  job: NeonV1JobRow,
  sourceStatus: string | null
) => ({
  // Kept for compatibility with the original backfill preview fields;
  // the exact source spelling remains in the durable raw source row.
  platform: job.platform,
  v1_archived_at: job.archived_at ?? null,
  v1_contract_type: job.contract_type ?? null,
  v1_deleted_at: job.deleted_at ?? null,
  v1_first_seen_at: firstSeenAtForJob(job),
  v1_location: job.location ?? null,
  v1_platform: job.platform,
  v1_posted_at: job.posted_at ?? null,
  v1_province: job.province ?? null,
  v1_scraped_at: job.scraped_at ?? null,
  v1_status: sourceStatus,
});

export const mapV1JobToDraft = (job: NeonV1JobRow): NormalisedAanvraagDraft => {
  const parserVersion = NEON_V1_PARSER_VERSION;
  const sourceStatus = sourceStatusForJob(job);
  const lifecycle = lifecycleForJob(job, sourceStatus);

  return {
    beschrijving: field(descriptionForJob(job), parserVersion, "description"),
    bronReferentie: field(job.external_id, parserVersion, "external_id"),
    bronSpecifiek: field(
      v1SpecificFieldsForJob(job, sourceStatus),
      parserVersion,
      "bron_specifiek"
    ),
    bronUrl: field(
      job.external_url?.trim() || UNKNOWN,
      parserVersion,
      "external_url"
    ),
    contentHash: "",
    extractieMethode: "api",
    lifecycle,
    locatieLand: field("NL", parserVersion, "location"),
    locatieTekst: field(
      job.location?.trim() || UNKNOWN,
      parserVersion,
      "location"
    ),
    opdrachtgeverNaam: field(
      opdrachtgeverForJob(job),
      parserVersion,
      "company"
    ),
    parserVersion,
    sluitingsdatum: job.application_deadline
      ? new Date(job.application_deadline)
      : undefined,
    startDatum: field(
      job.start_date?.slice(0, 10) || UNKNOWN,
      parserVersion,
      "start_date"
    ),
    status: lifecycle,
    tarief: {
      eenheid: UNKNOWN,
      max: tariefValue(job.rate_max),
      min: tariefValue(job.rate_min),
      valuta: "EUR",
    },
    titel: field(job.title, parserVersion, "title"),
  };
};

const resolveBinding = (
  bindings: readonly BackfillBronBinding[],
  platform: string
): BackfillBronBinding | null => resolveMotianV1Binding(bindings, platform);

const DEFAULT_BACKFILL_EXECUTION: BackfillExecution = {
  mode: "fixture",
  scope: "active",
};

const SOURCE_FAILURE_PLATFORM = "__source__";

type BackfillMetricKey = keyof BackfillPlatformMetrics;

interface MutableBackfillPlatformMetrics {
  duplicates: number;
  errors: number;
  extra: number;
  found: number;
  imported: number;
  matched: number;
  missing: number;
  rejected: number;
  selected: number;
  skipped: number;
}

interface MutableBackfillRunMetrics extends MutableBackfillPlatformMetrics {
  platforms: Record<string, MutableBackfillPlatformMetrics>;
}

interface BackfillEvidenceArtifacts {
  scopeManifest?: BackfillScopeManifest;
  targetReconciliation?: BackfillTargetReconciliation;
}

interface OrderedMappingDigest {
  readonly hash: ReturnType<typeof createHash>;
  readonly platformCounts: Record<string, number>;
  lastId: string | null;
  records: number;
}

const createOrderedMappingDigest = (): OrderedMappingDigest => ({
  hash: createHash("sha256"),
  lastId: null,
  platformCounts: {},
  records: 0,
});

const appendOrderedMapping = (
  digest: OrderedMappingDigest,
  mapping: BackfillTargetProvenanceRecord,
  platform: string
): void => {
  digest.hash.update(
    `${JSON.stringify([
      mapping.v1Id,
      mapping.bronId,
      mapping.bronReferentie,
      mapping.contentHash,
      mapping.rawPayloadRef,
    ])}\n`,
    "utf-8"
  );
  digest.lastId = mapping.v1Id;
  digest.platformCounts[platform] = (digest.platformCounts[platform] ?? 0) + 1;
  digest.records += 1;
};

const orderedMappingHash = (digest: OrderedMappingDigest): string =>
  digest.hash.digest("hex");

const isValidSnapshotWindow = (snapshot: BackfillSnapshotWindow): boolean => {
  const snapshotStart = Date.parse(snapshot.startedAt);
  const snapshotEnd = Date.parse(snapshot.completedAt);
  return (
    Number.isFinite(snapshotStart) &&
    Number.isFinite(snapshotEnd) &&
    snapshotEnd >= snapshotStart
  );
};

const emptyPlatformMetrics = (): MutableBackfillPlatformMetrics => ({
  duplicates: 0,
  errors: 0,
  extra: 0,
  found: 0,
  imported: 0,
  matched: 0,
  missing: 0,
  rejected: 0,
  selected: 0,
  skipped: 0,
});

const emptyMetrics = (
  bindings: readonly BackfillBronBinding[]
): MutableBackfillRunMetrics => ({
  ...emptyPlatformMetrics(),
  platforms: Object.fromEntries(
    bindings.map((binding) => [binding.platform, emptyPlatformMetrics()])
  ),
});

const incrementMetric = (
  metrics: MutableBackfillRunMetrics,
  platform: string,
  key: BackfillMetricKey
): void => {
  metrics[key] += 1;
  const platformMetrics = metrics.platforms[platform] ?? emptyPlatformMetrics();
  metrics.platforms[platform] = platformMetrics;
  platformMetrics[key] += 1;
};

const platformForJob = (
  bindings: readonly BackfillBronBinding[],
  job: NeonV1JobRow
): string =>
  resolveBinding(bindings, job.platform)?.platform ||
  job.platform ||
  "__unbound__";

const snapshotMetrics = (
  metrics: MutableBackfillRunMetrics
): BackfillRunEvidence["metrics"] => ({
  duplicates: metrics.duplicates,
  errors: metrics.errors,
  extra: metrics.extra,
  found: metrics.found,
  imported: metrics.imported,
  matched: metrics.matched,
  missing: metrics.missing,
  platforms: Object.fromEntries(
    Object.entries(metrics.platforms).map(([platform, platformMetrics]) => [
      platform,
      { ...platformMetrics },
    ])
  ),
  rejected: metrics.rejected,
  selected: metrics.selected,
  skipped: metrics.skipped,
});

const backfillEvidence = (
  execution: BackfillExecution,
  metrics: MutableBackfillRunMetrics,
  artifacts: BackfillEvidenceArtifacts,
  failure?: BackfillFailureEvidence
): BackfillRunEvidence => {
  let evidence: BackfillRunEvidence = {
    execution: { ...execution },
    metrics: snapshotMetrics(metrics),
  };
  if (artifacts.scopeManifest) {
    evidence = {
      ...evidence,
      scopeManifest: structuredClone(artifacts.scopeManifest),
    };
  }
  if (artifacts.targetReconciliation) {
    evidence = {
      ...evidence,
      targetReconciliation: structuredClone(artifacts.targetReconciliation),
    };
  }
  return failure ? { ...evidence, failure: { ...failure } } : evidence;
};

const backfillResult = (
  execution: BackfillExecution,
  metrics: MutableBackfillRunMetrics,
  artifacts: BackfillEvidenceArtifacts,
  status: BackfillRunResult["status"],
  failure?: BackfillFailureEvidence
): BackfillRunResult => {
  const evidence = backfillEvidence(execution, metrics, artifacts, failure);
  return { evidence, metrics: evidence.metrics, status };
};

class BackfillFailureError extends Error {
  readonly failure: BackfillFailureEvidence;
  readonly metricRecorded: boolean;

  constructor(failure: BackfillFailureEvidence, metricRecorded = false) {
    const validated = backfillFailureEvidenceSchema.parse(failure);
    super(`Motian v1 backfill failed during ${validated.phase}`);
    this.name = "BackfillFailureError";
    this.failure = validated;
    this.metricRecorded = metricRecorded;
  }
}

const isBackfillFailure = (cause: unknown): cause is BackfillFailureError =>
  cause instanceof BackfillFailureError;

const provenanceMatches = (
  actual: BackfillProvenanceRecord,
  expected: Omit<BackfillProvenanceRecord, "aanvraagId">,
  expectedRawPayloadRef?: string
): boolean => {
  const addressed = parseContentAddressedRawObjectPath(actual.rawPayloadRef);
  return (
    actual.v1Id === expected.v1Id &&
    actual.bronId === expected.bronId &&
    actual.bronReferentie === expected.bronReferentie &&
    actual.contentHash === expected.contentHash &&
    addressed?.contentHash === expected.contentHash &&
    (expectedRawPayloadRef === undefined ||
      actual.rawPayloadRef === expectedRawPayloadRef)
  );
};

const readProvenance = async (
  provenanceStore: RunNeonV1BackfillInput["provenanceStore"],
  v1Id: string
): Promise<BackfillProvenanceRecord | null> => {
  try {
    return await provenanceStore.findByV1Id(v1Id);
  } catch {
    throw new BackfillFailureError({
      code: "PROVENANCE_READ_FAILED",
      phase: "provenance",
    });
  }
};

const requireRawReadback = async (input: {
  body: Uint8Array;
  contentHash: string;
  objectStore: ObjectStore;
  rawPayloadRef: string;
}): Promise<void> => {
  let stored;
  try {
    stored = await input.objectStore.get(input.rawPayloadRef);
  } catch {
    throw new BackfillFailureError({
      code: "RAW_READBACK_FAILED",
      phase: "raw-write",
    });
  }
  if (!stored || stored.contentType !== "json") {
    throw new BackfillFailureError({
      code: "RAW_READBACK_FAILED",
      phase: "raw-write",
    });
  }

  let readbackHash: string;
  try {
    readbackHash = await hashContent(stored.body);
  } catch {
    throw new BackfillFailureError({
      code: "RAW_READBACK_FAILED",
      phase: "raw-write",
    });
  }
  if (
    readbackHash !== input.contentHash ||
    !bytesEqual(stored.body, input.body)
  ) {
    throw new BackfillFailureError({
      code: "RAW_READBACK_FAILED",
      phase: "raw-write",
    });
  }
};

const persistAndVerifyRaw = async (input: {
  body: Uint8Array;
  contentHash: string;
  job: NeonV1JobRow;
  objectStore: ObjectStore;
  startedAt: Date;
}): Promise<string> => {
  const rawPayloadRef = buildContentAddressedRawObjectPath({
    bronSlug: input.job.platform,
    contentHash: input.contentHash,
    contentType: "json",
    startedAt: input.startedAt,
  });
  try {
    await input.objectStore.put({
      body: input.body,
      contentType: "json",
      expiresAt: new Date(input.startedAt.getTime() + 90 * 86_400_000),
      path: rawPayloadRef,
    });
  } catch {
    throw new BackfillFailureError({
      code: "RAW_WRITE_FAILED",
      phase: "raw-write",
    });
  }
  await requireRawReadback({
    body: input.body,
    contentHash: input.contentHash,
    objectStore: input.objectStore,
    rawPayloadRef,
  });
  return rawPayloadRef;
};

const importNeonV1Job = async (input: {
  curateStore: CurateStore;
  job: NeonV1JobRow;
  bindings: readonly BackfillBronBinding[];
  metrics: MutableBackfillRunMetrics;
  objectStore: ObjectStore;
  provenanceStore: RunNeonV1BackfillInput["provenanceStore"];
  scrapeRunId: string;
  startedAt: Date;
}): Promise<BackfillProvenanceRecord | null> => {
  const platformBinding = resolveBinding(input.bindings, input.job.platform);
  const platform =
    platformBinding?.platform ?? platformForJob(input.bindings, input.job);
  incrementMetric(input.metrics, platform, "found");
  incrementMetric(input.metrics, platform, "selected");
  if (!platformBinding) {
    incrementMetric(input.metrics, platform, "rejected");
    return null;
  }

  try {
    let rawBody: Uint8Array;
    let contentHash: string;
    try {
      rawBody = rawBodyForJob(input.job);
      contentHash = await hashContent(rawBody);
    } catch {
      throw new BackfillFailureError({
        code: "RAW_WRITE_FAILED",
        phase: "raw-write",
      });
    }
    const expectedProvenance = {
      bronId: platformBinding.bronId,
      bronReferentie: input.job.external_id,
      contentHash,
      rawPayloadRef: "",
      v1Id: input.job.id,
    };
    const existing = await readProvenance(input.provenanceStore, input.job.id);
    if (existing) {
      if (!provenanceMatches(existing, expectedProvenance)) {
        throw new BackfillFailureError({
          code: "PROVENANCE_MISMATCH",
          phase: "provenance",
        });
      }
      await requireRawReadback({
        body: rawBody,
        contentHash,
        objectStore: input.objectStore,
        rawPayloadRef: existing.rawPayloadRef,
      });
      incrementMetric(input.metrics, platform, "matched");
      incrementMetric(input.metrics, platform, "skipped");
      return existing;
    }

    const draftBase = mapV1JobToDraft(input.job);
    const draft: NormalisedAanvraagDraft = {
      ...draftBase,
      contentHash,
    };
    const rawPayloadRef = await persistAndVerifyRaw({
      body: rawBody,
      contentHash,
      job: input.job,
      objectStore: input.objectStore,
      startedAt: input.startedAt,
    });

    let curated;
    try {
      curated = await curateObservation(input.curateStore, {
        bronId: platformBinding.bronId,
        draft,
        observedAt: input.startedAt,
        rawPayloadRef,
        scrapeRunId: input.scrapeRunId,
      });
    } catch {
      throw new BackfillFailureError({
        code: "CURATE_FAILED",
        phase: "curate",
      });
    }

    if (curated.status === "quarantined" || !curated.aanvraagId) {
      throw new BackfillFailureError({
        code: "CURATE_REJECTED",
        phase: "curate",
      });
    }

    const provenance: BackfillProvenanceRecord = {
      ...expectedProvenance,
      aanvraagId: curated.aanvraagId,
      rawPayloadRef,
    };
    try {
      await input.provenanceStore.registerV1Id(provenance);
    } catch {
      throw new BackfillFailureError({
        code: "PROVENANCE_WRITE_FAILED",
        phase: "provenance",
      });
    }
    const registered = await readProvenance(
      input.provenanceStore,
      input.job.id
    );
    if (
      !registered ||
      registered.aanvraagId !== curated.aanvraagId ||
      !provenanceMatches(registered, expectedProvenance, rawPayloadRef)
    ) {
      throw new BackfillFailureError({
        code: "PROVENANCE_MISMATCH",
        phase: "provenance",
      });
    }
    incrementMetric(input.metrics, platform, "matched");
    if (curated.status === "curated") {
      incrementMetric(input.metrics, platform, "imported");
    } else {
      incrementMetric(input.metrics, platform, "skipped");
    }
    return registered;
  } catch (error) {
    incrementMetric(input.metrics, platform, "errors");
    if (isBackfillFailure(error)) {
      throw new BackfillFailureError(error.failure, true);
    }
    throw new BackfillFailureError(
      { code: "CURATE_FAILED", phase: "curate" },
      true
    );
  }
};

const importNeonV1Jobs = async (input: {
  bindings: readonly BackfillBronBinding[];
  curateStore: RunNeonV1BackfillInput["curateStore"];
  jobs: readonly NeonV1JobRow[];
  metrics: MutableBackfillRunMetrics;
  objectStore: RunNeonV1BackfillInput["objectStore"];
  provenanceStore: RunNeonV1BackfillInput["provenanceStore"];
  scrapeRunId: string;
  startedAt: Date;
}): Promise<readonly BackfillProvenanceRecord[]> => {
  const provenanceRecords: BackfillProvenanceRecord[] = [];
  /* oxlint-disable no-await-in-loop -- backfill imports must stay ordered for deterministic metrics */
  for (const job of input.jobs) {
    const provenance = await importNeonV1Job({
      bindings: input.bindings,
      curateStore: input.curateStore,
      job,
      metrics: input.metrics,
      objectStore: input.objectStore,
      provenanceStore: input.provenanceStore,
      scrapeRunId: input.scrapeRunId,
      startedAt: input.startedAt,
    });
    if (provenance) {
      provenanceRecords.push(provenance);
    }
  }
  /* oxlint-enable no-await-in-loop */
  return provenanceRecords;
};

const importFromSource = async (input: {
  batchSize: number;
  bindings: readonly BackfillBronBinding[];
  curateStore: RunNeonV1BackfillInput["curateStore"];
  metrics: MutableBackfillRunMetrics;
  objectStore: RunNeonV1BackfillInput["objectStore"];
  provenanceStore: RunNeonV1BackfillInput["provenanceStore"];
  scrapeRunId: string;
  source: NeonV1Source;
  startedAt: Date;
}): Promise<BackfillScopeManifest> => {
  const mappingDigest = createOrderedMappingDigest();
  let lastSourceId: string | null = null;
  let selected = 0;
  const consume = async (jobs: readonly NeonV1JobRow[]): Promise<void> => {
    for (const job of jobs) {
      if (lastSourceId !== null && job.id.localeCompare(lastSourceId) <= 0) {
        throw new BackfillFailureError({
          code: "SOURCE_READ_FAILED",
          phase: "source-read",
        });
      }
      lastSourceId = job.id;
      selected += 1;
    }
    const provenanceRecords = await importNeonV1Jobs({
      bindings: input.bindings,
      curateStore: input.curateStore,
      jobs,
      metrics: input.metrics,
      objectStore: input.objectStore,
      provenanceStore: input.provenanceStore,
      scrapeRunId: input.scrapeRunId,
      startedAt: input.startedAt,
    });
    for (const provenance of provenanceRecords) {
      const platform = input.bindings.find(
        (binding) => binding.bronId === provenance.bronId
      )?.platform;
      if (!platform) {
        throw new BackfillFailureError({
          code: "SOURCE_READ_FAILED",
          phase: "source-read",
        });
      }
      appendOrderedMapping(mappingDigest, provenance, platform);
    }
  };

  try {
    let snapshot: BackfillSnapshotWindow;
    if (input.source.consumeSnapshot) {
      snapshot = await input.source.consumeSnapshot(input.batchSize, consume);
    } else if (input.source.streamBatches) {
      const startedAt = new Date().toISOString();
      for await (const batch of input.source.streamBatches(input.batchSize)) {
        await consume(batch);
      }
      snapshot = { completedAt: new Date().toISOString(), startedAt };
    } else {
      const startedAt = new Date().toISOString();
      const jobs = await input.source.loadJobs();
      await consume(jobs);
      snapshot = { completedAt: new Date().toISOString(), startedAt };
    }
    if (!isValidSnapshotWindow(snapshot)) {
      throw new BackfillFailureError({
        code: "SOURCE_READ_FAILED",
        phase: "source-read",
      });
    }
    return {
      contractVersion: BACKFILL_SCOPE_MANIFEST_VERSION,
      digestAlgorithm: "sha256",
      itemEncoding: "json-array-line/v1",
      order: "source-id-ascending",
      orderedDigest: orderedMappingHash(mappingDigest),
      platformCounts: { ...mappingDigest.platformCounts },
      selected,
      snapshot: { ...snapshot },
    };
  } catch (error) {
    if (isBackfillFailure(error)) {
      throw error;
    }
    throw new BackfillFailureError({
      code: "SOURCE_READ_FAILED",
      phase: "source-read",
    });
  }
};

const syncAggregateReconciliation = (
  metrics: MutableBackfillRunMetrics
): void => {
  const platformMetrics = Object.values(metrics.platforms);
  for (const key of [
    "duplicates",
    "extra",
    "matched",
    "missing",
    "selected",
  ] as const) {
    metrics[key] = platformMetrics.reduce(
      (sum, platform) => sum + platform[key],
      0
    );
  }
};

const reconcileProvenance = async (input: {
  batchSize: number;
  bindings: readonly BackfillBronBinding[];
  metrics: MutableBackfillRunMetrics;
  provenanceStore: RunNeonV1BackfillInput["provenanceStore"];
  scopeManifest: BackfillScopeManifest;
}): Promise<BackfillTargetReconciliation> => {
  const bronIds = [...new Set(input.bindings.map((binding) => binding.bronId))];
  const platformByBronId = new Map(
    input.bindings.map((binding) => [binding.bronId, binding.platform])
  );
  const digest = createOrderedMappingDigest();
  const summaries: Record<string, { distinctV1Ids: number; records: number }> =
    {};
  const lastV1IdByBronId = new Map<string, string>();
  let snapshot: BackfillSnapshotWindow;
  try {
    snapshot = await input.provenanceStore.consumeReconciliationSnapshot(
      bronIds,
      input.batchSize,
      (batch) => {
        for (const record of batch) {
          const platform = platformByBronId.get(record.bronId);
          if (!platform) {
            throw new BackfillFailureError({
              code: "RECONCILIATION_READ_FAILED",
              phase: "reconcile",
            });
          }
          if (
            digest.lastId !== null &&
            record.v1Id.localeCompare(digest.lastId) < 0
          ) {
            throw new BackfillFailureError({
              code: "RECONCILIATION_READ_FAILED",
              phase: "reconcile",
            });
          }
          appendOrderedMapping(digest, record, platform);
          const summary = summaries[record.bronId] ?? {
            distinctV1Ids: 0,
            records: 0,
          };
          summary.records += 1;
          if (lastV1IdByBronId.get(record.bronId) !== record.v1Id) {
            summary.distinctV1Ids += 1;
            lastV1IdByBronId.set(record.bronId, record.v1Id);
          }
          summaries[record.bronId] = summary;
        }
        return Promise.resolve();
      }
    );
  } catch {
    throw new BackfillFailureError({
      code: "RECONCILIATION_READ_FAILED",
      phase: "reconcile",
    });
  }

  if (!isValidSnapshotWindow(snapshot)) {
    throw new BackfillFailureError({
      code: "RECONCILIATION_READ_FAILED",
      phase: "reconcile",
    });
  }

  const configuredPlatforms = new Set<string>();
  for (const binding of input.bindings) {
    configuredPlatforms.add(binding.platform);
    const platformMetrics =
      input.metrics.platforms[binding.platform] ?? emptyPlatformMetrics();
    input.metrics.platforms[binding.platform] = platformMetrics;
    const summary = summaries[binding.bronId] ?? {
      distinctV1Ids: 0,
      records: 0,
    };
    const sourceCount =
      input.scopeManifest.platformCounts[binding.platform] ?? 0;
    platformMetrics.matched = Math.min(
      platformMetrics.matched,
      summary.distinctV1Ids,
      sourceCount
    );
    platformMetrics.missing = Math.max(sourceCount - summary.distinctV1Ids, 0);
    platformMetrics.extra = Math.max(summary.distinctV1Ids - sourceCount, 0);
    platformMetrics.duplicates = Math.max(
      summary.records - summary.distinctV1Ids,
      0
    );
  }

  for (const [platform, platformMetrics] of Object.entries(
    input.metrics.platforms
  )) {
    if (!configuredPlatforms.has(platform)) {
      platformMetrics.missing = Math.max(
        platformMetrics.selected - platformMetrics.matched,
        0
      );
    }
  }
  syncAggregateReconciliation(input.metrics);
  const orderedDigest = orderedMappingHash(digest);
  return {
    contractVersion: BACKFILL_TARGET_RECONCILIATION_VERSION,
    digestAlgorithm: "sha256",
    distinctV1Ids: Object.values(summaries).reduce(
      (sum, summary) => sum + summary.distinctV1Ids,
      0
    ),
    itemEncoding: "json-array-line/v1",
    matchesScope:
      digest.records === input.scopeManifest.selected &&
      orderedDigest === input.scopeManifest.orderedDigest,
    order: "source-id-ascending",
    orderedDigest,
    platformCounts: { ...digest.platformCounts },
    records: digest.records,
    snapshot: { ...snapshot },
  };
};

const assertNoImportFailures = (
  metrics: MutableBackfillRunMetrics,
  targetReconciliation: BackfillTargetReconciliation
): void => {
  const hasDrift =
    metrics.missing > 0 ||
    metrics.extra > 0 ||
    metrics.duplicates > 0 ||
    !targetReconciliation.matchesScope;
  if (metrics.errors > 0 || metrics.rejected > 0 || hasDrift) {
    throw new BackfillFailureError(
      { code: "RECONCILIATION_DRIFT", phase: "reconcile" },
      true
    );
  }
};

const recordBackfillFailure = async (input: {
  artifacts: BackfillEvidenceArtifacts;
  cause: unknown;
  execution: BackfillExecution;
  metrics: MutableBackfillRunMetrics;
  runStore: RunNeonV1BackfillInput["runStore"];
  scrapeRunId: string;
}): Promise<BackfillRunResult> => {
  const failure = isBackfillFailure(input.cause)
    ? input.cause.failure
    : backfillFailureEvidenceSchema.parse({
        code: "RECONCILIATION_READ_FAILED",
        phase: "reconcile",
      });
  if (!isBackfillFailure(input.cause) || !input.cause.metricRecorded) {
    const failurePlatform =
      failure.phase === "source-read"
        ? SOURCE_FAILURE_PLATFORM
        : "__reconcile__";
    incrementMetric(input.metrics, failurePlatform, "errors");
  }
  const result = backfillResult(
    input.execution,
    input.metrics,
    input.artifacts,
    "failed",
    failure
  );
  await input.runStore.failRun(input.scrapeRunId, failure, result.evidence);
  return result;
};

export const runNeonV1Backfill = async (
  input: RunNeonV1BackfillInput
): Promise<BackfillRunResult> => {
  const execution = input.execution ?? DEFAULT_BACKFILL_EXECUTION;
  if (execution.mode === "production" && execution.scope !== "full") {
    throw new Error("Production Motian v1 backfills require scope: full");
  }
  if (execution.mode === "production" && !input.source.consumeSnapshot) {
    throw new Error(
      "Production Motian v1 backfills require a consistent source snapshot"
    );
  }
  const startedAt = input.startedAt ?? new Date();
  const metrics = emptyMetrics(input.bindings);
  const artifacts: BackfillEvidenceArtifacts = {};
  const [primaryBinding] = input.bindings;
  const primaryBronId =
    primaryBinding?.bronId ?? "00000000-0000-4000-8000-000000000099";
  const { scrapeRunId } = await input.runStore.startRun(primaryBronId);
  const batchSize = input.batchSize ?? 1000;

  try {
    artifacts.scopeManifest = await importFromSource({
      batchSize,
      bindings: input.bindings,
      curateStore: input.curateStore,
      metrics,
      objectStore: input.objectStore,
      provenanceStore: input.provenanceStore,
      scrapeRunId,
      source: input.source,
      startedAt,
    });
    artifacts.targetReconciliation = await reconcileProvenance({
      batchSize,
      bindings: input.bindings,
      metrics,
      provenanceStore: input.provenanceStore,
      scopeManifest: artifacts.scopeManifest,
    });
    assertNoImportFailures(metrics, artifacts.targetReconciliation);

    const result = backfillResult(execution, metrics, artifacts, "succeeded");
    await input.runStore.completeRun(scrapeRunId, result.evidence);
    return result;
  } catch (error) {
    return recordBackfillFailure({
      artifacts,
      cause: error,
      execution,
      metrics,
      runStore: input.runStore,
      scrapeRunId,
    });
  }
};
