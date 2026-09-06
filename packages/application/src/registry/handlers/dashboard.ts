import { z } from "zod";

import type {
  SliceADomainFailure,
  SliceADomainFailureDetails,
} from "../schemas";
import type {
  BronRunStatsRow,
  BronRunTimeseriesPoint,
  ScrapeRunView,
} from "../stores/types";
import type { SliceAHandlerDeps } from "./deps";

const domainFailure = (
  code: SliceADomainFailure["code"],
  message: string,
  details?: SliceADomainFailureDetails
) => ({ error: { code, details, message }, ok: false as const });

export const dashboardWindowSchema = z
  .enum(["24u", "24h", "7d", "30d"])
  .default("7d")
  .transform((value) => (value === "24h" ? "24u" : value));

const failureCountSchema = z
  .object({
    code: z.string(),
    count: z.number(),
  })
  .strict();

const statsSchema = z
  .object({
    aantalGevonden: z.number(),
    actief: z.boolean().nullable(),
    avgDurationMs: z.number().nullable(),
    bronId: z.string().nullable(),
    cancelled: z.number(),
    failed: z.number(),
    fouten: z.number(),
    gesloten: z.number(),
    gewijzigd: z.number(),
    interval: z.string().nullable(),
    lastFailureClass: z.string().nullable(),
    lastFailureCode: z.string().nullable(),
    lastFailureMessage: z.string().nullable(),
    lastFailurePhase: z.string().nullable(),
    lastRunAt: z.string().nullable(),
    lastRunStatus: z.string().nullable(),
    naam: z.string().nullable(),
    nieuw: z.number(),
    ongewijzigd: z.number(),
    p95DurationMs: z.number().nullable(),
    rejected: z.number(),
    running: z.number(),
    runs: z.number(),
    succeeded: z.number(),
    successRate: z.number().nullable(),
    topFailures: z.array(failureCountSchema),
  })
  .strict();

const pointSchema = z
  .object({
    aantalGevonden: z.number(),
    avgDurationMs: z.number().nullable(),
    bronId: z.string(),
    bucket: z.string(),
    failed: z.number(),
    fouten: z.number(),
    gewijzigd: z.number(),
    nieuw: z.number(),
    ongewijzigd: z.number(),
    rejected: z.number(),
    runs: z.number(),
    succeeded: z.number(),
  })
  .strict();

const healthSchema = z
  .object({
    bronId: z.string(),
    circuitStatus: z.string(),
    lastRunAt: z.string().nullable(),
    lastRunStatus: z.string().nullable(),
    silenceAlertOpen: z.boolean(),
  })
  .strict();

const alertSchema = z
  .object({
    ackedAt: z.string().nullable(),
    bronId: z.string(),
    createdAt: z.string(),
    id: z.string(),
    kind: z.string(),
    message: z.string(),
  })
  .strict();

const serializeStatsRow = (row: BronRunStatsRow) => ({
  aantalGevonden: row.aantalGevonden,
  actief: row.actief,
  avgDurationMs: row.avgDurationMs,
  bronId: row.bronId,
  cancelled: row.cancelled,
  failed: row.failed,
  fouten: row.fouten,
  gesloten: row.gesloten,
  gewijzigd: row.gewijzigd,
  interval: row.interval,
  lastFailureClass: row.lastFailureClass,
  lastFailureCode: row.lastFailureCode,
  lastFailureMessage: row.lastFailureMessage,
  lastFailurePhase: row.lastFailurePhase,
  lastRunAt: row.lastRunAt?.toISOString() ?? null,
  lastRunStatus: row.lastRunStatus,
  naam: row.naam,
  nieuw: row.nieuw,
  ongewijzigd: row.ongewijzigd,
  p95DurationMs: row.p95DurationMs,
  rejected: row.rejected,
  running: row.running,
  runs: row.runs,
  succeeded: row.succeeded,
  successRate: row.successRate,
  topFailures: [...row.topFailures],
});

const serializeTimeseriesPoint = (point: BronRunTimeseriesPoint) => ({
  aantalGevonden: point.aantalGevonden,
  avgDurationMs: point.avgDurationMs,
  bronId: point.bronId,
  bucket: point.bucket.toISOString(),
  failed: point.failed,
  fouten: point.fouten,
  gewijzigd: point.gewijzigd,
  nieuw: point.nieuw,
  ongewijzigd: point.ongewijzigd,
  rejected: point.rejected,
  runs: point.runs,
  succeeded: point.succeeded,
});

const loadHealth = async (deps: SliceAHandlerDeps, bronId: string) => {
  const health = await deps.stores.bronHealth.getByBronId(bronId);
  if (!health) {
    return null;
  }
  return {
    bronId: health.bronId,
    circuitStatus: health.circuitStatus,
    lastRunAt: health.lastRunAt?.toISOString() ?? null,
    lastRunStatus: health.lastRunStatus,
    silenceAlertOpen: health.silenceAlertOpen,
  };
};

export const getDashboardOverviewInputSchema = z
  .object({
    window: dashboardWindowSchema,
  })
  .strict();

export const getDashboardOverviewOutputSchema = z
  .object({
    alerts: z.array(alertSchema),
    bronnen: z.array(
      z
        .object({
          health: healthSchema.nullable(),
          stats: statsSchema,
        })
        .strict()
    ),
    health: z.array(healthSchema),
    timeseries: z.array(pointSchema),
    total: statsSchema,
    window: z.enum(["24u", "7d", "30d"]),
  })
  .strict();

export const createGetDashboardOverviewHandler =
  (deps: SliceAHandlerDeps) =>
  async (input: z.output<typeof getDashboardOverviewInputSchema>) => {
    if (!deps.bronRunStatsReader) {
      throw new Error("BronRunStatsReader unavailable");
    }
    const stats = await deps.bronRunStatsReader.bronRunStats({
      window: input.window,
    });
    const timeseries = await deps.bronRunStatsReader.bronRunTimeseries({
      window: input.window,
    });
    const sourceRows = stats.bronnen.filter(
      (row): row is typeof row & { bronId: string } => row.bronId !== null
    );
    const bronnen = await Promise.all(
      sourceRows.map(async (row) => ({
        health: await loadHealth(deps, row.bronId),
        stats: serializeStatsRow(row),
      }))
    );
    const healthRows = bronnen.flatMap(({ health }) =>
      health ? [health] : []
    );
    const openAlerts = await deps.stores.alerts.listOpen();
    return {
      ok: true as const,
      value: {
        alerts: openAlerts.map((alert) => ({
          ackedAt: alert.ackedAt?.toISOString() ?? null,
          bronId: alert.bronId,
          createdAt: alert.createdAt.toISOString(),
          id: alert.id,
          kind: alert.kind,
          message: alert.message,
        })),
        bronnen,
        health: healthRows,
        timeseries: timeseries.map(serializeTimeseriesPoint),
        total: serializeStatsRow(stats.totaal),
        window: input.window,
      },
    };
  };

export const getBronStatsInputSchema = z
  .object({
    bronId: z.string().uuid(),
    window: dashboardWindowSchema,
  })
  .strict();

export const getBronStatsOutputSchema = z
  .object({
    health: healthSchema.nullable(),
    stats: statsSchema,
    timeseries: z.array(pointSchema),
    topFailures: z.array(failureCountSchema),
    window: z.enum(["24u", "7d", "30d"]),
  })
  .strict();

export const createGetBronStatsHandler =
  (deps: SliceAHandlerDeps) =>
  async (input: z.output<typeof getBronStatsInputSchema>) => {
    if (!deps.bronRunStatsReader) {
      throw new Error("BronRunStatsReader unavailable");
    }
    const stats = await deps.bronRunStatsReader.bronRunStats({
      bronIds: [input.bronId],
      window: input.window,
    });
    const [source] = stats.bronnen;
    if (!source) {
      return domainFailure("NOT_FOUND", "Bron not found", {
        bronId: input.bronId,
      });
    }
    const timeseries = await deps.bronRunStatsReader.bronRunTimeseries({
      bronIds: [input.bronId],
      window: input.window,
    });
    const health = await loadHealth(deps, input.bronId);
    return {
      ok: true as const,
      value: {
        health,
        stats: serializeStatsRow(source),
        timeseries: timeseries.map(serializeTimeseriesPoint),
        topFailures: [...source.topFailures],
        window: input.window,
      },
    };
  };

const runViewSchema = z
  .object({
    aantalGevonden: z.number(),
    bronId: z.string(),
    checkpoint: z
      .object({
        cursor: z.union([z.string(), z.number()]).optional(),
        hasMore: z.boolean().optional(),
        offset: z.number().optional(),
        page: z.number().optional(),
      })
      .strict()
      .nullable(),
    circuitStatus: z.string(),
    createdAt: z.string(),
    failureClass: z.string().nullable(),
    failureCode: z.string().nullable(),
    failureMessage: z.string().nullable(),
    failurePhase: z.string().nullable(),
    fouten: z.number(),
    geindigd: z.string().nullable(),
    gesloten: z.number(),
    gestart: z.string(),
    gewijzigd: z.number(),
    id: z.string(),
    lifecycleSummary: z
      .object({
        incremented: z.number(),
        reopened: z.number(),
        reset: z.number(),
        staled: z.number(),
      })
      .strict(),
    nieuw: z.number(),
    observationDistribution: z
      .object({
        created: z.number(),
        rejected: z.number(),
        unchanged: z.number(),
        updated: z.number(),
      })
      .strict(),
    rejected: z.number(),
    runKind: z.string(),
    status: z.string(),
    versionAdapter: z.string().nullable(),
  })
  .strict();

const serializeRunView = (run: ScrapeRunView) => ({
  aantalGevonden: run.aantalGevonden,
  bronId: run.bronId,
  checkpoint: run.checkpoint,
  circuitStatus: run.circuitStatus,
  createdAt: run.createdAt.toISOString(),
  failureClass: run.failureClass,
  failureCode: run.failureCode,
  failureMessage: run.failureMessage,
  failurePhase: run.failurePhase,
  fouten: run.fouten,
  geindigd: run.geindigd?.toISOString() ?? null,
  gesloten: run.gesloten,
  gestart: run.gestart.toISOString(),
  gewijzigd: run.gewijzigd,
  id: run.id,
  lifecycleSummary: run.lifecycleSummary,
  nieuw: run.nieuw,
  observationDistribution: run.observationDistribution,
  rejected: run.rejected,
  runKind: run.runKind,
  status: run.status,
  versionAdapter: run.versieAdapter,
});

export const listScrapeRunsInputSchema = z
  .object({
    bronId: z.string().uuid().optional(),
    cursor: z.string().optional(),
    limit: z.number().int().positive().max(100).default(50),
    runKind: z.enum(["all", "poll", "backfill", "test"]).optional(),
    since: z.string().datetime().optional(),
    status: z.enum(["running", "succeeded", "failed", "cancelled"]).optional(),
  })
  .strict();

export const listScrapeRunsOutputSchema = z
  .object({
    items: z.array(runViewSchema),
    nextCursor: z.string().nullable(),
  })
  .strict();

export const createListScrapeRunsHandler =
  (deps: SliceAHandlerDeps) =>
  async (input: z.output<typeof listScrapeRunsInputSchema>) => {
    if (!deps.scrapeRunReader) {
      throw new Error("ScrapeRunReader unavailable");
    }
    const listed = await deps.scrapeRunReader.list({
      bronId: input.bronId,
      cursor: input.cursor,
      limit: input.limit,
      runKind: input.runKind,
      since: input.since ? new Date(input.since) : undefined,
      status: input.status,
    });
    return {
      ok: true as const,
      value: {
        items: listed.items.map(serializeRunView),
        nextCursor: listed.nextCursor,
      },
    };
  };

export const getScrapeRunInputSchema = z
  .object({
    id: z.string().uuid(),
  })
  .strict();

export const getScrapeRunOutputSchema = runViewSchema;

export const createGetScrapeRunHandler =
  (deps: SliceAHandlerDeps) =>
  async (input: z.output<typeof getScrapeRunInputSchema>) => {
    if (!deps.scrapeRunReader) {
      throw new Error("ScrapeRunReader unavailable");
    }
    const run = await deps.scrapeRunReader.getById(input.id);
    if (!run) {
      return domainFailure("NOT_FOUND", "Scrape run not found", {
        id: input.id,
      });
    }
    return {
      ok: true as const,
      value: serializeRunView(run),
    };
  };
