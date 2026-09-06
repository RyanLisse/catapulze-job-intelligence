/* oxlint-disable-file */
import { z } from "zod";

import type { SliceAHandlerDeps } from "./deps";

export const dashboardWindowSchema = z
  .enum(["24u", "24h", "7d", "30d"])
  .default("7d")
  .transform((v) => (v === "24h" ? "24u" : v));
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
    topFailures: z.array(
      z.object({ code: z.string(), count: z.number() }).strict()
    ),
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
const health = (deps: SliceAHandlerDeps, id: string) =>
  deps.stores.bronHealth.getByBronId(id).then((h) =>
    h
      ? {
          bronId: h.bronId,
          circuitStatus: h.circuitStatus,
          lastRunAt: h.lastRunAt?.toISOString() ?? null,
          lastRunStatus: h.lastRunStatus,
          silenceAlertOpen: h.silenceAlertOpen,
        }
      : null
  );
const row = (r: any) => ({
  ...r,
  lastRunAt: r.lastRunAt?.toISOString() ?? null,
});
export const getDashboardOverviewInputSchema = z
  .object({ window: dashboardWindowSchema })
  .strict();
export const getDashboardOverviewOutputSchema = z
  .object({
    alerts: z.array(
      z
        .object({
          ackedAt: z.string().nullable(),
          bronId: z.string(),
          createdAt: z.string(),
          id: z.string(),
          kind: z.string(),
          message: z.string(),
        })
        .strict()
    ),
    bronnen: z.array(
      z.object({ health: healthSchema.nullable(), stats: statsSchema }).strict()
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
    const hs = await Promise.all(
      stats.bronnen.map((s) => health(deps, s.bronId!))
    );
    return {
      ok: true as const,
      value: {
        alerts: (await deps.stores.alerts.listOpen()).map((a) => ({
          ackedAt: a.ackedAt?.toISOString() ?? null,
          bronId: a.bronId,
          createdAt: a.createdAt.toISOString(),
          id: a.id,
          kind: a.kind,
          message: a.message,
        })),
        bronnen: stats.bronnen.map((s, i) => ({
          health: hs[i],
          stats: row(s),
        })),
        health: hs.filter((h): h is NonNullable<typeof h> => h !== null),
        timeseries: timeseries.map((p) => ({
          ...p,
          bucket: p.bucket.toISOString(),
        })),
        total: row(stats.totaal),
        window: input.window,
      },
    };
  };
export const getBronStatsInputSchema = z
  .object({ bronId: z.string().uuid(), window: dashboardWindowSchema })
  .strict();
export const getBronStatsOutputSchema = z
  .object({
    health: healthSchema.nullable(),
    stats: statsSchema,
    timeseries: z.array(pointSchema),
    topFailures: z.array(
      z.object({ code: z.string(), count: z.number() }).strict()
    ),
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
    const source = stats.bronnen[0];
    if (!source) {
      return {
        error: {
          code: "NOT_FOUND",
          details: { bronId: input.bronId },
          message: "Bron not found",
        },
        ok: false as const,
      };
    }
    const [ts, h] = await Promise.all([
      deps.bronRunStatsReader.bronRunTimeseries({
        bronIds: [input.bronId],
        window: input.window,
      }),
      health(deps, input.bronId),
    ]);
    return {
      ok: true as const,
      value: {
        health: h,
        stats: row(source),
        timeseries: ts.map((p) => ({ ...p, bucket: p.bucket.toISOString() })),
        topFailures: source.topFailures,
        window: input.window,
      },
    };
  };
const runViewSchema = z
  .object({
    aantalGevonden: z.number(),
    bronId: z.string(),
    checkpoint: z.record(z.string(), z.unknown()).nullable(),
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
    nieuw: z.number(),
    observationDistribution: z.record(z.string(), z.number()),
    rejected: z.number(),
    runKind: z.string(),
    status: z.string(),
    versionAdapter: z.string().nullable(),
  })
  .strict();
const view = (r: any) => ({
  ...r,
  createdAt: r.createdAt.toISOString(),
  geindigd: r.geindigd?.toISOString() ?? null,
  gestart: r.gestart.toISOString(),
  lifecycleSummary: r.lifecycleSummary,
  versionAdapter: r.versieAdapter,
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
  .object({ items: z.array(runViewSchema), nextCursor: z.string().nullable() })
  .strict();
export const createListScrapeRunsHandler =
  (deps: SliceAHandlerDeps) =>
  async (input: z.output<typeof listScrapeRunsInputSchema>) => {
    if (!deps.scrapeRunReader) {
      throw new Error("ScrapeRunReader unavailable");
    }
    const r = await deps.scrapeRunReader.list({
      ...input,
      since: input.since ? new Date(input.since) : undefined,
    });
    return {
      ok: true as const,
      value: { items: r.items.map(view), nextCursor: r.nextCursor },
    };
  };
export const getScrapeRunInputSchema = z
  .object({ id: z.string().uuid() })
  .strict();
export const getScrapeRunOutputSchema = runViewSchema;
export const createGetScrapeRunHandler =
  (deps: SliceAHandlerDeps) =>
  async (input: z.output<typeof getScrapeRunInputSchema>) => {
    if (!deps.scrapeRunReader) {
      throw new Error("ScrapeRunReader unavailable");
    }
    const r = await deps.scrapeRunReader.getById(input.id);
    return r
      ? { ok: true as const, value: view(r) }
      : {
          error: {
            code: "NOT_FOUND",
            details: { id: input.id },
            message: "Scrape run not found",
          },
          ok: false as const,
        };
  };
