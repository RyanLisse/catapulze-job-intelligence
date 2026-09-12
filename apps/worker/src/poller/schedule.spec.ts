import { describe, expect, it } from "bun:test";

import type { BronId } from "@ji/domain";

import type { PollCandidate } from "./schedule";
import { dueCandidates, partitionByLiveFlag } from "./schedule";

/** 2026-06-15 10:55 Europe/Amsterdam (CEST, UTC+2). */
const NOW = new Date("2026-06-15T08:55:00.000Z");

const minutesBefore = (reference: Date, minutes: number): Date =>
  new Date(reference.getTime() - minutes * 60_000);

const candidate = (overrides: Partial<PollCandidate> = {}): PollCandidate => ({
  // SAFETY: literal UUID, the only shape BronId brands; nothing in
  // `dueCandidates` reads the id beyond carrying it through.
  bronId: "11111111-1111-4111-8111-111111111111" as BronId,
  bronSlug: "tenderned",
  interval: "*/15 * * * *",
  lastRunAt: minutesBefore(NOW, 10),
  ...overrides,
});

const slugsOf = (candidates: readonly PollCandidate[]): string[] =>
  candidates.map((entry) => entry.bronSlug);

describe("dueCandidates", () => {
  it("is due when the source has never run", () => {
    expect(dueCandidates([candidate({ lastRunAt: null })], NOW)).toHaveLength(
      1
    );
  });

  it("is not due 10 minutes into a quarter-hourly interval", () => {
    expect(
      dueCandidates([candidate({ lastRunAt: minutesBefore(NOW, 10) })], NOW)
    ).toEqual([]);
  });

  it("is due once a quarter-hourly slot has passed 16 minutes back", () => {
    expect(
      dueCandidates([candidate({ lastRunAt: minutesBefore(NOW, 16) })], NOW)
    ).toHaveLength(1);
  });

  it("is not due 50 minutes into an hourly interval", () => {
    expect(
      dueCandidates(
        [
          candidate({
            interval: "0 * * * *",
            lastRunAt: minutesBefore(NOW, 50),
          }),
        ],
        NOW
      )
    ).toEqual([]);
  });

  it("reads the interval in Europe/Amsterdam, not UTC", () => {
    // 02:00 Amsterdam is 00:00 UTC in summer. `now` is 00:30 UTC / 02:30
    // Amsterdam, so the 02:00 slot has passed locally but not in UTC.
    const summerNow = new Date("2026-06-15T00:30:00.000Z");
    const lastRunAt = new Date("2026-06-14T23:00:00.000Z");
    expect(
      dueCandidates(
        [candidate({ interval: "0 2 * * *", lastRunAt })],
        summerNow
      )
    ).toHaveLength(1);
  });

  it("is never due on an interval that is not a usable cron", () => {
    expect(dueCandidates([candidate({ interval: "hourly" })], NOW)).toEqual([]);
  });

  it("keeps only the due sources out of a mixed set", () => {
    expect(
      slugsOf(
        dueCandidates(
          [
            candidate({
              bronSlug: "tenderned",
              lastRunAt: minutesBefore(NOW, 16),
            }),
            candidate({
              bronSlug: "inhuurdesk",
              lastRunAt: minutesBefore(NOW, 10),
            }),
          ],
          NOW
        )
      )
    ).toEqual(["tenderned"]);
  });
});

describe("partitionByLiveFlag", () => {
  it("skips a source whose live flag is unset in production", () => {
    const result = partitionByLiveFlag([candidate()], {
      NODE_ENV: "production",
    });
    expect(result.live).toEqual([]);
    expect(slugsOf(result.notLive)).toEqual(["tenderned"]);
  });

  it("polls the same source once its live flag is set", () => {
    const result = partitionByLiveFlag([candidate()], {
      NODE_ENV: "production",
      TENDER_NED_LIVE: "1",
    });
    expect(slugsOf(result.live)).toEqual(["tenderned"]);
    expect(result.notLive).toEqual([]);
  });

  it("polls a fixture-backed source outside production", () => {
    const result = partitionByLiveFlag([candidate()], {
      NODE_ENV: "development",
    });
    expect(slugsOf(result.live)).toEqual(["tenderned"]);
    expect(result.notLive).toEqual([]);
  });

  it("reads the flag name from the source definition, per source", () => {
    const result = partitionByLiveFlag(
      [
        candidate({ bronSlug: "tenderned" }),
        candidate({ bronSlug: "inhuurdesk" }),
      ],
      { INHUURDESK_LIVE: "1", NODE_ENV: "production" }
    );
    expect(slugsOf(result.live)).toEqual(["inhuurdesk"]);
    expect(slugsOf(result.notLive)).toEqual(["tenderned"]);
  });
});
