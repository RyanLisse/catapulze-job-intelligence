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
  type BackfillProvenanceStore,
  type BackfillRunMetrics,
  type BackfillRunResult,
  type BackfillRunStore,
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

const contentHashForJob = async (job: NeonV1JobRow): Promise<string> => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(job))
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

const tariefValue = (
  value: number | null | undefined
): string | typeof UNKNOWN =>
  value === null || value === undefined ? UNKNOWN : String(value);

export const mapV1JobToDraft = (job: NeonV1JobRow): NormalisedAanvraagDraft => {
  const parserVersion = NEON_V1_PARSER_VERSION;
  const beschrijving =
    job.description?.trim() ||
    `${job.title} (${job.platform}/${job.external_id})`;
  const opdrachtgever =
    job.end_client?.trim() || job.company?.trim() || UNKNOWN;

  return {
    beschrijving: field(beschrijving, parserVersion, "description"),
    bronReferentie: field(job.external_id, parserVersion, "external_id"),
    bronSpecifiek: field(
      {
        contract_type: job.contract_type ?? null,
        location: job.location ?? null,
        platform: job.platform,
        province: job.province ?? null,
        v1_created_at: job.created_at ?? null,
        v1_updated_at: job.updated_at ?? null,
      },
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
    lifecycle: "active",
    locatieLand: field("NL", parserVersion, "location"),
    locatieTekst: field(
      job.location?.trim() || UNKNOWN,
      parserVersion,
      "location"
    ),
    opdrachtgeverNaam: field(opdrachtgever, parserVersion, "company"),
    parserVersion,
    startDatum: field(UNKNOWN, parserVersion, "start_date"),
    status: "active",
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

interface MutableBackfillRunMetrics {
  errors: number;
  found: number;
  imported: number;
  rejected: number;
  skipped: number;
}

const emptyMetrics = (): MutableBackfillRunMetrics => ({
  errors: 0,
  found: 0,
  imported: 0,
  rejected: 0,
  skipped: 0,
});

const bindingsForJobs = (
  jobs: readonly NeonV1JobRow[],
  bindings: readonly BackfillBronBinding[]
): { bronId: string; ok: true } | { ok: false; reason: string } => {
  const platforms = [...new Set(jobs.map((job) => job.platform))];
  if (platforms.length === 0) {
    const [fallbackBinding] = bindings;
    return {
      bronId: fallbackBinding?.bronId ?? "00000000-0000-4000-8000-000000000099",
      ok: true,
    };
  }

  const [primaryPlatform] = platforms;
  if (!primaryPlatform) {
    return { ok: false, reason: "Neon v1 fixture contains no platform values" };
  }

  const binding = resolveBinding(bindings, primaryPlatform);
  if (!binding) {
    return {
      ok: false,
      reason: `No bron binding configured for platform ${primaryPlatform}`,
    };
  }

  return { bronId: binding.bronId, ok: true };
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
}): Promise<void> => {
  const platformBinding = resolveBinding(input.bindings, input.job.platform);
  if (!platformBinding) {
    input.metrics.rejected += 1;
    return;
  }

  const existing = await input.provenanceStore.findByV1Id(input.job.id);
  if (existing) {
    input.metrics.skipped += 1;
    return;
  }

  const draftBase = mapV1JobToDraft(input.job);
  const contentHash = await contentHashForJob(input.job);
  const draft: NormalisedAanvraagDraft = {
    ...draftBase,
    contentHash,
  };

  const rawBody = new TextEncoder().encode(JSON.stringify(input.job));
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
    input.metrics.errors += 1;
    return;
  }

  await input.provenanceStore.registerV1Id(input.job.id, curated.aanvraagId);
  if (curated.status === "curated") {
    input.metrics.imported += 1;
  } else {
    input.metrics.skipped += 1;
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
  input.metrics.found += input.jobs.length;
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

export const runNeonV1Backfill = async (
  input: RunNeonV1BackfillInput
): Promise<BackfillRunResult> => {
  const startedAt = input.startedAt ?? new Date();
  const metrics = emptyMetrics();
  const [primaryBinding] = input.bindings;
  const primaryBronId =
    primaryBinding?.bronId ?? "00000000-0000-4000-8000-000000000099";
  const { scrapeRunId } = await input.runStore.startRun(primaryBronId);
  const batchSize = input.batchSize ?? 1000;

  try {
    if (input.source.streamBatches) {
      let validatedBindings = false;
      for await (const batch of input.source.streamBatches(batchSize)) {
        if (batch.length > 0 && !validatedBindings) {
          const binding = bindingsForJobs(batch, input.bindings);
          if (!binding.ok) {
            throw new Error(binding.reason);
          }
          validatedBindings = true;
        }
        await importNeonV1Jobs({
          bindings: input.bindings,
          curateStore: input.curateStore,
          jobs: batch,
          metrics,
          objectStore: input.objectStore,
          provenanceStore: input.provenanceStore,
          scrapeRunId,
          startedAt,
        });
      }
    } else {
      const jobs = await input.source.loadJobs();
      if (jobs.length > 0) {
        const binding = bindingsForJobs(jobs, input.bindings);
        if (!binding.ok) {
          throw new Error(binding.reason);
        }
      }
      await importNeonV1Jobs({
        bindings: input.bindings,
        curateStore: input.curateStore,
        jobs,
        metrics,
        objectStore: input.objectStore,
        provenanceStore: input.provenanceStore,
        scrapeRunId,
        startedAt,
      });
    }

    await input.runStore.completeRun(scrapeRunId, metrics);
    return { metrics, status: "succeeded" };
  } catch (error) {
    await input.runStore.failRun(
      scrapeRunId,
      error instanceof Error ? error.message : "Neon v1 backfill failed"
    );
    return {
      metrics: {
        ...metrics,
        errors: metrics.errors + 1,
      },
      status: "failed",
    };
  }
};

export const assertReadOnlyMotianAccess = (): void => {
  const url = resolveMotianDatabaseUrl();
  if (!url) {
    return;
  }
  if (/write|admin|owner/iu.test(url)) {
    throw new Error("MOTIAN_DATABASE_URL must use a read-only role");
  }
};
