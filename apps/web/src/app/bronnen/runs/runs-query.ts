export const RUN_STATUSES = [
  "running",
  "succeeded",
  "failed",
  "cancelled",
] as const;

export type RunStatusFilter = (typeof RUN_STATUSES)[number];

export const RUN_KINDS = ["all", "poll", "backfill", "test"] as const;

export type RunKindFilter = (typeof RUN_KINDS)[number];

export const DEFAULT_RUN_KIND: RunKindFilter = "poll";

export interface RunsQuery {
  readonly bronId?: string;
  readonly cursor?: string;
  readonly failureCode?: string;
  readonly runKind: RunKindFilter;
  readonly status?: RunStatusFilter;
}

const first = (value: string | string[] | undefined): string | undefined => {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
};

const RUN_STATUS_SET: ReadonlySet<string> = new Set(RUN_STATUSES);
const RUN_KIND_SET: ReadonlySet<string> = new Set(RUN_KINDS);

const isRunStatus = (value: string): value is RunStatusFilter =>
  RUN_STATUS_SET.has(value);

const isRunKind = (value: string): value is RunKindFilter =>
  RUN_KIND_SET.has(value);

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export const parseRunsQuery = (params: {
  readonly bronId?: string | string[];
  readonly cursor?: string | string[];
  readonly failureCode?: string | string[];
  readonly runKind?: string | string[];
  readonly status?: string | string[];
}): RunsQuery => {
  const bronIdRaw = first(params.bronId)?.trim();
  const statusRaw = first(params.status)?.trim();
  const runKindRaw = first(params.runKind)?.trim();
  const failureCodeRaw = first(params.failureCode)?.trim();
  const cursorRaw = first(params.cursor)?.trim();

  return {
    bronId: bronIdRaw && UUID_RE.test(bronIdRaw) ? bronIdRaw : undefined,
    cursor: cursorRaw && cursorRaw.length > 0 ? cursorRaw : undefined,
    failureCode:
      failureCodeRaw && failureCodeRaw.length > 0 ? failureCodeRaw : undefined,
    runKind:
      runKindRaw && isRunKind(runKindRaw) ? runKindRaw : DEFAULT_RUN_KIND,
    status: statusRaw && isRunStatus(statusRaw) ? statusRaw : undefined,
  };
};

export const runsQueryToSearchParams = (
  query: RunsQuery,
  overrides: Partial<RunsQuery> = {}
): URLSearchParams => {
  const merged: RunsQuery = {
    bronId: "bronId" in overrides ? overrides.bronId : query.bronId,
    cursor: "cursor" in overrides ? overrides.cursor : query.cursor,
    failureCode:
      "failureCode" in overrides ? overrides.failureCode : query.failureCode,
    runKind: overrides.runKind ?? query.runKind,
    status: "status" in overrides ? overrides.status : query.status,
  };

  const params = new URLSearchParams();
  if (merged.bronId) {
    params.set("bronId", merged.bronId);
  }
  if (merged.status) {
    params.set("status", merged.status);
  }
  // Always serialize runKind so default poll is visible / bookmarkable.
  params.set("runKind", merged.runKind);
  if (merged.failureCode) {
    params.set("failureCode", merged.failureCode);
  }
  if (merged.cursor) {
    params.set("cursor", merged.cursor);
  }
  return params;
};

export const runsHref = (
  query: RunsQuery,
  overrides: Partial<RunsQuery> = {}
): string => {
  const params = runsQueryToSearchParams(query, overrides);
  const qs = params.toString();
  return qs.length > 0 ? `/bronnen/runs?${qs}` : "/bronnen/runs";
};

/** Build GET /v1/scrape-runs query string (omit empty; no limit). */
export const toScrapeRunsApiQuery = (query: RunsQuery): string => {
  const params = new URLSearchParams();
  if (query.bronId) {
    params.set("bronId", query.bronId);
  }
  if (query.status) {
    params.set("status", query.status);
  }
  params.set("runKind", query.runKind);
  if (query.failureCode) {
    params.set("failureCode", query.failureCode);
  }
  if (query.cursor) {
    params.set("cursor", query.cursor);
  }
  return params.toString();
};
