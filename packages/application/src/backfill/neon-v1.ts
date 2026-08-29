import path from "node:path";

import type { ObjectStore } from "@ji/connectors";
import { buildRawObjectPath } from "@ji/connectors";
import { UNKNOWN } from "@ji/domain";

import { curateObservation } from "../identity/curate";
import type { CurateStore } from "../identity/curate";
import {
  field,
  provenanceFor,
  type NormalisedAanvraagDraft,
} from "../normalise";

export const NEON_V1_BACKFILL_CONTRACT_VERSION = "neon-v1-backfill/v1" as const;

export const NEON_V1_PARSER_VERSION = "neon-v1/2026-08-29";

export const NEON_V1_FORBIDDEN_TABLES = [
  "applications",
  "candidates",
  "chat_conversations",
  "chat_messages",
  "interviews",
  "job_matches",
  "messages",
  "screening_calls",
] as const;

export type NeonV1ForbiddenTable = (typeof NEON_V1_FORBIDDEN_TABLES)[number];

export interface NeonV1JobRow {
  readonly company?: string | null;
  readonly contract_type?: string | null;
  readonly created_at?: string | null;
  readonly description?: string | null;
  readonly end_client?: string | null;
  readonly external_id: string;
  readonly external_url?: string | null;
  readonly id: string;
  readonly location?: string | null;
  readonly platform: string;
  readonly province?: string | null;
  readonly rate_max?: number | null;
  readonly rate_min?: number | null;
  readonly title: string;
  readonly updated_at?: string | null;
}

export interface NeonV1Fixture {
  readonly capturedAt: string;
  readonly contractVersion: typeof NEON_V1_BACKFILL_CONTRACT_VERSION;
  readonly jobs: readonly NeonV1JobRow[];
}

export interface BackfillRunMetrics {
  readonly errors: number;
  readonly found: number;
  readonly imported: number;
  readonly rejected: number;
  readonly skipped: number;
}

export interface BackfillRunResult {
  readonly metrics: BackfillRunMetrics;
  readonly status: "failed" | "succeeded";
}

export interface NeonV1Source {
  readonly label: string;
  loadJobs: () => Promise<readonly NeonV1JobRow[]>;
}

export interface BackfillBronBinding {
  readonly bronId: string;
  readonly platform: string;
}

export interface BackfillRunStore {
  completeRun: (
    scrapeRunId: string,
    metrics: BackfillRunMetrics
  ) => Promise<void>;
  failRun: (scrapeRunId: string, reason: string) => Promise<void>;
  startRun: (bronId: string) => Promise<{ scrapeRunId: string }>;
}

export interface BackfillProvenanceStore {
  findByV1Id: (v1Id: string) => Promise<{ aanvraagId: string } | null>;
  registerV1Id: (v1Id: string, aanvraagId: string) => Promise<void>;
}

export interface RunNeonV1BackfillInput {
  readonly bindings: readonly BackfillBronBinding[];
  readonly curateStore: CurateStore;
  readonly objectStore: ObjectStore;
  readonly provenanceStore: BackfillProvenanceStore;
  readonly runStore: BackfillRunStore;
  readonly source: NeonV1Source;
  readonly startedAt?: Date;
}

const fixtureRoot = path.join(process.cwd(), "fixtures", "backfill");

export const fixturePath = (...segments: string[]): string =>
  path.join(fixtureRoot, ...segments);

export const loadNeonV1Fixture = async (
  relativePath: string
): Promise<NeonV1Fixture> => {
  const file = Bun.file(fixturePath(relativePath));
  const parsed = (await file.json()) as NeonV1Fixture;
  if (parsed.contractVersion !== NEON_V1_BACKFILL_CONTRACT_VERSION) {
    throw new Error(
      `Unsupported Neon v1 fixture contract: ${String(parsed.contractVersion)}`
    );
  }
  return parsed;
};

export const createFixtureNeonV1Source = (
  fixture: NeonV1Fixture
): NeonV1Source => ({
  label: "fixture",
  loadJobs: async () => [...fixture.jobs],
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

const tariefValue = (value: number | null | undefined): string | typeof UNKNOWN =>
  value === null || value === undefined ? UNKNOWN : String(value);

export const mapV1JobToDraft = (job: NeonV1JobRow): NormalisedAanvraagDraft => {
  const parserVersion = NEON_V1_PARSER_VERSION;
  const beschrijving =
    job.description?.trim() ||
    `${job.title} (${job.platform}/${job.external_id})`;
  const opdrachtgever = job.end_client?.trim() || job.company?.trim() || UNKNOWN;

  return {
    beschrijving: field(beschrijving, provenanceFor(parserVersion, "description")),
    bronReferentie: field(
      job.external_id,
      provenanceFor(parserVersion, "external_id")
    ),
    bronSpecifiek: field(
      {
        contract_type: job.contract_type ?? null,
        location: job.location ?? null,
        platform: job.platform,
        province: job.province ?? null,
        v1_created_at: job.created_at ?? null,
        v1_updated_at: job.updated_at ?? null,
      },
      provenanceFor(parserVersion, "bron_specifiek")
    ),
    bronUrl: field(
      job.external_url?.trim() || UNKNOWN,
      provenanceFor(parserVersion, "external_url")
    ),
    contentHash: "",
    extractieMethode: "json-api",
    lifecycle: "active",
    locatieLand: field("NL", provenanceFor(parserVersion, "location")),
    locatieTekst: field(
      job.location?.trim() || UNKNOWN,
      provenanceFor(parserVersion, "location")
    ),
    opdrachtgeverNaam: field(
      opdrachtgever,
      provenanceFor(parserVersion, "company")
    ),
    parserVersion,
    startDatum: field(UNKNOWN, provenanceFor(parserVersion, "start_date")),
    status: "active",
    tarief: {
      eenheid: UNKNOWN,
      max: tariefValue(job.rate_max),
      min: tariefValue(job.rate_min),
      valuta: "EUR",
    },
    titel: field(job.title, provenanceFor(parserVersion, "title")),
  };
};

const resolveBinding = (
  bindings: readonly BackfillBronBinding[],
  platform: string
): BackfillBronBinding | null =>
  bindings.find((binding) => binding.platform === platform) ?? null;

const emptyMetrics = (): BackfillRunMetrics => ({
  errors: 0,
  found: 0,
  imported: 0,
  rejected: 0,
  skipped: 0,
});

export const runNeonV1Backfill = async (
  input: RunNeonV1BackfillInput
): Promise<BackfillRunResult> => {
  const startedAt = input.startedAt ?? new Date();
  const metrics = emptyMetrics();
  const primaryBronId =
    input.bindings[0]?.bronId ?? "00000000-0000-4000-8000-000000000099";
  const started = await input.runStore.startRun(primaryBronId);
  const scrapeRunId = started.scrapeRunId;

  try {
    const jobs = await input.source.loadJobs();
    if (jobs.length > 0) {
      const binding = bindingsForJobs(jobs, input.bindings);
      if (!binding.ok) {
        throw new Error(binding.reason);
      }
    }

    metrics.found = jobs.length;

    for (const job of jobs) {
      const platformBinding = resolveBinding(input.bindings, job.platform);
      if (!platformBinding) {
        metrics.rejected += 1;
        continue;
      }

      const existing = await input.provenanceStore.findByV1Id(job.id);
      if (existing) {
        metrics.skipped += 1;
        continue;
      }

      const draftBase = mapV1JobToDraft(job);
      const contentHash = await contentHashForJob(job);
      const draft: NormalisedAanvraagDraft = {
        ...draftBase,
        contentHash,
      };

      const rawBody = new TextEncoder().encode(JSON.stringify(job));
      const rawPayloadRef = buildRawObjectPath({
        bronSlug: job.platform,
        contentType: "json",
        recordId: `${job.external_id}-${contentHash.slice(0, 12)}`,
        runId: scrapeRunId,
        startedAt,
      });
      await input.objectStore.put({
        body: rawBody,
        contentType: "json",
        expiresAt: new Date(startedAt.getTime() + 90 * 86_400_000),
        path: rawPayloadRef,
      });

      const curated = await curateObservation(input.curateStore, {
        bronId: platformBinding.bronId,
        draft,
        observedAt: startedAt,
        rawPayloadRef,
        scrapeRunId,
      });

      if (curated.status === "quarantined" || !curated.aanvraagId) {
        metrics.errors += 1;
        continue;
      }

      await input.provenanceStore.registerV1Id(job.id, curated.aanvraagId);
      if (curated.status === "curated") {
        metrics.imported += 1;
      } else {
        metrics.skipped += 1;
      }
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

const bindingsForJobs = (
  jobs: readonly NeonV1JobRow[],
  bindings: readonly BackfillBronBinding[]
):
  | { bronId: string; ok: true }
  | { ok: false; reason: string } => {
  const platforms = [...new Set(jobs.map((job) => job.platform))];
  if (platforms.length === 0) {
    return { bronId: bindings[0]?.bronId ?? "00000000-0000-4000-8000-000000000099", ok: true };
  }

  const primaryPlatform = platforms[0];
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

export const assertReadOnlyMotianAccess = (): void => {
  const url = resolveMotianDatabaseUrl();
  if (!url) {
    return;
  }
  if (/write|admin|owner/iu.test(url)) {
    throw new Error("MOTIAN_DATABASE_URL must use a read-only role");
  }
};

export class UnreachableNeonV1Source implements NeonV1Source {
  readonly label = "unreachable";

  loadJobs(): Promise<readonly NeonV1JobRow[]> {
    return Promise.reject(new Error("Motian-Neon source unreachable"));
  }
}

export class InMemoryBackfillProvenanceStore implements BackfillProvenanceStore {
  private readonly byV1Id = new Map<string, string>();

  findByV1Id(v1Id: string): Promise<{ aanvraagId: string } | null> {
    const aanvraagId = this.byV1Id.get(v1Id);
    return Promise.resolve(aanvraagId ? { aanvraagId } : null);
  }

  registerV1Id(v1Id: string, aanvraagId: string): Promise<void> {
    this.byV1Id.set(v1Id, aanvraagId);
    return Promise.resolve();
  }
}

export class InMemoryBackfillRunStore implements BackfillRunStore {
  readonly runs: {
    metrics?: BackfillRunMetrics;
    reason?: string;
    scrapeRunId: string;
    status: "failed" | "running" | "succeeded";
  }[] = [];

  startRun(_bronId: string): Promise<{ scrapeRunId: string }> {
    const scrapeRunId = crypto.randomUUID();
    this.runs.push({ scrapeRunId, status: "running" });
    return Promise.resolve({ scrapeRunId });
  }

  completeRun(
    scrapeRunId: string,
    metrics: BackfillRunMetrics
  ): Promise<void> {
    const run = this.runs.find((entry) => entry.scrapeRunId === scrapeRunId);
    if (run) {
      run.metrics = metrics;
      run.status = "succeeded";
    }
    return Promise.resolve();
  }

  failRun(scrapeRunId: string, reason: string): Promise<void> {
    const run = this.runs.find((entry) => entry.scrapeRunId === scrapeRunId);
    if (run) {
      run.reason = reason;
      run.status = "failed";
    }
    return Promise.resolve();
  }
}
