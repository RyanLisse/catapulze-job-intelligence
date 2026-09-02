import { readFile } from "node:fs/promises";
import path from "node:path";

import { buildRawObjectPath } from "@ji/connectors";
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
  BackfillPlatformMetrics,
  BackfillRunEvidence,
  BackfillRunResult,
  NeonV1Fixture,
  NeonV1JobRow,
  NeonV1Source,
  RunNeonV1BackfillInput,
} from "./neon-v1-types";
import {
  NEON_V1_BACKFILL_CONTRACT_VERSION,
  NEON_V1_PARSER_VERSION,
} from "./neon-v1-types";

export {
  NEON_V1_BACKFILL_CONTRACT_VERSION,
  NEON_V1_FORBIDDEN_TABLES,
  NEON_V1_PARSER_VERSION,
  type BackfillBronBinding,
  type BackfillExecution,
  type BackfillExecutionMode,
  type BackfillPlatformMetrics,
  type BackfillProvenanceStore,
  type BackfillRunEvidence,
  type BackfillRunMetrics,
  type BackfillRunResult,
  type BackfillRunStore,
  type BackfillScope,
  type NeonV1Fixture,
  type NeonV1ForbiddenTable,
  type NeonV1JobRow,
  type NeonV1Source,
  type RunNeonV1BackfillInput,
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
): NeonV1Source => ({
  label: "fixture",
  loadJobs: () => Promise.resolve([...fixture.jobs]),
});

export const resolveMotianDatabaseUrl = (): string | undefined =>
  process.env.MOTIAN_DATABASE_URL?.trim() || undefined;

const serialiseRawSource = (job: NeonV1JobRow): string => {
  const serialised = JSON.stringify(job.sourceRow ?? job);
  if (serialised === undefined) {
    throw new Error("Motian v1 source row is not JSON serialisable");
  }
  return serialised;
};

const contentHashForJob = async (job: NeonV1JobRow): Promise<string> => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(serialiseRawSource(job))
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
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

const v1SpecificFieldsForJob = (
  job: NeonV1JobRow,
  sourceStatus: string | null
) => ({
  // Kept for compatibility with the original backfill preview fields;
  // the exact source spelling remains in the durable raw source row.
  platform: job.platform,
  v1_archived_at: job.archived_at ?? null,
  v1_contract_type: job.contract_type ?? null,
  v1_created_at: job.created_at ?? null,
  v1_deleted_at: job.deleted_at ?? null,
  v1_location: job.location ?? null,
  v1_platform: job.platform,
  v1_province: job.province ?? null,
  v1_status: sourceStatus,
  v1_updated_at: job.updated_at ?? null,
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
    startDatum: field(UNKNOWN, parserVersion, "start_date"),
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
  errors: number;
  found: number;
  imported: number;
  rejected: number;
  skipped: number;
}

interface MutableBackfillRunMetrics extends MutableBackfillPlatformMetrics {
  platforms: Record<string, MutableBackfillPlatformMetrics>;
}

const emptyPlatformMetrics = (): MutableBackfillPlatformMetrics => ({
  errors: 0,
  found: 0,
  imported: 0,
  rejected: 0,
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
  errors: metrics.errors,
  found: metrics.found,
  imported: metrics.imported,
  platforms: Object.fromEntries(
    Object.entries(metrics.platforms).map(([platform, platformMetrics]) => [
      platform,
      { ...platformMetrics },
    ])
  ),
  rejected: metrics.rejected,
  skipped: metrics.skipped,
});

const backfillEvidence = (
  execution: BackfillExecution,
  metrics: MutableBackfillRunMetrics
): BackfillRunEvidence => ({
  execution: { ...execution },
  metrics: snapshotMetrics(metrics),
});

const backfillResult = (
  execution: BackfillExecution,
  metrics: MutableBackfillRunMetrics,
  status: BackfillRunResult["status"]
): BackfillRunResult => {
  const evidence = backfillEvidence(execution, metrics);
  return { evidence, metrics: evidence.metrics, status };
};

type BackfillFailureKind = "incomplete" | "recorded";

class BackfillFailureError extends Error {
  readonly kind: BackfillFailureKind;

  constructor(kind: BackfillFailureKind) {
    super(
      kind === "recorded"
        ? "A Motian v1 row could not be imported"
        : "Motian v1 backfill has rejected or errored rows"
    );
    this.name = "BackfillFailureError";
    this.kind = kind;
  }
}

const isBackfillFailure = (
  cause: unknown,
  kind: BackfillFailureKind
): boolean => cause instanceof BackfillFailureError && cause.kind === kind;

const importNeonV1Job = async (input: {
  curateStore: CurateStore;
  job: NeonV1JobRow;
  bindings: readonly BackfillBronBinding[];
  metrics: MutableBackfillRunMetrics;
  objectStore: ObjectStore;
  provenanceStore: RunNeonV1BackfillInput["provenanceStore"];
  scrapeRunId: string;
  startedAt: Date;
}): Promise<void> => {
  const platformBinding = resolveBinding(input.bindings, input.job.platform);
  const platform =
    platformBinding?.platform ?? platformForJob(input.bindings, input.job);
  incrementMetric(input.metrics, platform, "found");
  if (!platformBinding) {
    incrementMetric(input.metrics, platform, "rejected");
    return;
  }

  try {
    const existing = await input.provenanceStore.findByV1Id(input.job.id);
    if (existing) {
      incrementMetric(input.metrics, platform, "skipped");
      return;
    }

    const draftBase = mapV1JobToDraft(input.job);
    const contentHash = await contentHashForJob(input.job);
    const draft: NormalisedAanvraagDraft = {
      ...draftBase,
      contentHash,
    };

    const rawBody = new TextEncoder().encode(serialiseRawSource(input.job));
    const rawPayloadRef = buildRawObjectPath({
      bronSlug: input.job.platform,
      contentType: "json",
      recordId: `${input.job.external_id}-${contentHash.slice(0, 12)}`,
      runId: input.scrapeRunId,
      startedAt: input.startedAt,
    });
    await input.objectStore.put({
      body: rawBody,
      contentType: "json",
      expiresAt: new Date(input.startedAt.getTime() + 90 * 86_400_000),
      path: rawPayloadRef,
    });

    const curated = await curateObservation(input.curateStore, {
      bronId: platformBinding.bronId,
      draft,
      observedAt: input.startedAt,
      rawPayloadRef,
      scrapeRunId: input.scrapeRunId,
    });

    if (curated.status === "quarantined" || !curated.aanvraagId) {
      incrementMetric(input.metrics, platform, "errors");
      return;
    }

    await input.provenanceStore.registerV1Id(input.job.id, curated.aanvraagId);
    if (curated.status === "curated") {
      incrementMetric(input.metrics, platform, "imported");
    } else {
      incrementMetric(input.metrics, platform, "skipped");
    }
  } catch {
    incrementMetric(input.metrics, platform, "errors");
    throw new BackfillFailureError("recorded");
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
}): Promise<void> => {
  /* oxlint-disable no-await-in-loop -- backfill imports must stay ordered for deterministic metrics */
  for (const job of input.jobs) {
    await importNeonV1Job({
      bindings: input.bindings,
      curateStore: input.curateStore,
      job,
      metrics: input.metrics,
      objectStore: input.objectStore,
      provenanceStore: input.provenanceStore,
      scrapeRunId: input.scrapeRunId,
      startedAt: input.startedAt,
    });
  }
  /* oxlint-enable no-await-in-loop */
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
}): Promise<void> => {
  if (input.source.streamBatches) {
    for await (const batch of input.source.streamBatches(input.batchSize)) {
      await importNeonV1Jobs({
        bindings: input.bindings,
        curateStore: input.curateStore,
        jobs: batch,
        metrics: input.metrics,
        objectStore: input.objectStore,
        provenanceStore: input.provenanceStore,
        scrapeRunId: input.scrapeRunId,
        startedAt: input.startedAt,
      });
    }
    return;
  }

  const jobs = await input.source.loadJobs();
  await importNeonV1Jobs({
    bindings: input.bindings,
    curateStore: input.curateStore,
    jobs,
    metrics: input.metrics,
    objectStore: input.objectStore,
    provenanceStore: input.provenanceStore,
    scrapeRunId: input.scrapeRunId,
    startedAt: input.startedAt,
  });
};

const assertNoImportFailures = (metrics: MutableBackfillRunMetrics): void => {
  if (metrics.errors > 0 || metrics.rejected > 0) {
    throw new BackfillFailureError("incomplete");
  }
};

const recordBackfillFailure = async (input: {
  cause: unknown;
  execution: BackfillExecution;
  metrics: MutableBackfillRunMetrics;
  runStore: RunNeonV1BackfillInput["runStore"];
  scrapeRunId: string;
}): Promise<BackfillRunResult> => {
  if (
    !isBackfillFailure(input.cause, "recorded") &&
    !isBackfillFailure(input.cause, "incomplete")
  ) {
    incrementMetric(input.metrics, SOURCE_FAILURE_PLATFORM, "errors");
  }
  const result = backfillResult(input.execution, input.metrics, "failed");
  const reason = isBackfillFailure(input.cause, "incomplete")
    ? "Backfill has rejected or errored records"
    : "Backfill execution failed";
  await input.runStore.failRun(input.scrapeRunId, reason, result.evidence);
  return result;
};

export const runNeonV1Backfill = async (
  input: RunNeonV1BackfillInput
): Promise<BackfillRunResult> => {
  const execution = input.execution ?? DEFAULT_BACKFILL_EXECUTION;
  if (execution.mode === "production" && execution.scope !== "full") {
    throw new Error("Production Motian v1 backfills require scope: full");
  }
  const startedAt = input.startedAt ?? new Date();
  const metrics = emptyMetrics(input.bindings);
  const [primaryBinding] = input.bindings;
  const primaryBronId =
    primaryBinding?.bronId ?? "00000000-0000-4000-8000-000000000099";
  const { scrapeRunId } = await input.runStore.startRun(primaryBronId);
  const batchSize = input.batchSize ?? 1000;

  try {
    await importFromSource({
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
    assertNoImportFailures(metrics);

    const result = backfillResult(execution, metrics, "succeeded");
    await input.runStore.completeRun(scrapeRunId, result.evidence);
    return result;
  } catch (error) {
    return recordBackfillFailure({
      cause: error,
      execution,
      metrics,
      runStore: input.runStore,
      scrapeRunId,
    });
  }
};
