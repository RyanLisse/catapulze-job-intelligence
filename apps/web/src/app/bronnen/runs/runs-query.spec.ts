import { describe, expect, it } from "bun:test";

import {
  DEFAULT_RUN_KIND,
  parseRunsQuery,
  runsHref,
  toScrapeRunsApiQuery,
} from "./runs-query";

describe("parseRunsQuery", () => {
  it("defaults runKind to poll when unset (backfill OFF)", () => {
    expect(parseRunsQuery({}).runKind).toBe(DEFAULT_RUN_KIND);
    expect(parseRunsQuery({ runKind: "nope" }).runKind).toBe("poll");
  });

  it("accepts known filters and drops invalid bronId", () => {
    const query = parseRunsQuery({
      bronId: "not-a-uuid",
      failureCode: "FETCH_FAILED",
      runKind: "all",
      status: "failed",
    });
    expect(query).toEqual({
      bronId: undefined,
      cursor: undefined,
      failureCode: "FETCH_FAILED",
      runKind: "all",
      status: "failed",
    });
  });

  it("keeps valid uuid bronId and cursor", () => {
    const bronId = "00000000-0000-4000-8000-000000000001";
    const query = parseRunsQuery({
      bronId,
      cursor: "2026-09-06T12:00:00.000Z|abc",
      runKind: "backfill",
    });
    expect(query.bronId).toBe(bronId);
    expect(query.cursor).toBe("2026-09-06T12:00:00.000Z|abc");
    expect(query.runKind).toBe("backfill");
  });
});

describe("runsHref / toScrapeRunsApiQuery", () => {
  it("serializes runKind always and clears cursor on override", () => {
    const base = parseRunsQuery({
      cursor: "c1",
      failureCode: "FETCH_FAILED",
      runKind: "poll",
      status: "failed",
    });
    expect(runsHref(base)).toContain("runKind=poll");
    expect(runsHref(base)).toContain("cursor=c1");
    expect(runsHref(base, { cursor: undefined })).not.toContain("cursor=");
    expect(toScrapeRunsApiQuery(base)).toContain("failureCode=FETCH_FAILED");
  });
});
