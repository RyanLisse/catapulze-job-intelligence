import { describe, expect, it } from "bun:test";

import {
  hasNewerMarkering,
  markeringMutationOutcome,
  startMarkeringPolling,
} from "./markering-sync";
import { CapabilityRequestError } from "./rest/capability-client";
import type { JobMarkering } from "./types";

const marker = (
  revision: number,
  status: JobMarkering["status"] = "relevant"
) =>
  ({
    reden: null,
    revision,
    status,
    updatedAt: `2026-09-05T00:00:0${revision}.000Z`,
  }) satisfies JobMarkering;

const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

const createEnvironment = () => {
  let visibilityState: Document["visibilityState"] = "visible";
  let listener: (() => void) | null = null;
  let nextInterval = 0;
  const intervals = new Map<number, () => void>();
  return {
    clock: {
      clearInterval: (interval: number) => {
        intervals.delete(interval);
      },
      setInterval: (handler: () => void) => {
        const interval = nextInterval;
        nextInterval += 1;
        intervals.set(interval, handler);
        return interval;
      },
    },
    intervals,
    get listener() {
      return listener;
    },
    setVisibility: (next: Document["visibilityState"]) => {
      visibilityState = next;
      listener?.();
    },
    visibility: {
      addEventListener: (_type: "visibilitychange", next: () => void) => {
        listener = next;
      },
      removeEventListener: () => {
        listener = null;
      },
      get visibilityState() {
        return visibilityState;
      },
    },
  };
};

describe("bounded markering readback", () => {
  it("applies only newer resource versions and makes repeats idempotent", () => {
    const current = marker(2);
    expect(hasNewerMarkering(current, marker(1, "gevolgd"))).toBe(false);
    expect(hasNewerMarkering(current, marker(2))).toBe(false);
    expect(hasNewerMarkering(current, marker(3, "gevolgd"))).toBe(true);
  });

  it("classifies known rejection separately from post-commit uncertainty", () => {
    const rejected = new CapabilityRequestError(403, {
      error: { code: "FORBIDDEN", message: "denied" },
    });
    const unavailable = new CapabilityRequestError(503, {
      error: { code: "UNAVAILABLE", message: "retry" },
    });
    expect(markeringMutationOutcome(rejected)).toBe("failure");
    expect(markeringMutationOutcome(unavailable)).toBe("uncertain");
    expect(markeringMutationOutcome(new TypeError("network"))).toBe(
      "uncertain"
    );

    for (const status of [408, 409, 429]) {
      expect(
        markeringMutationOutcome(
          new CapabilityRequestError(status, {
            error: { code: "RETRYABLE", message: "try again" },
          })
        )
      ).toBe("uncertain");
    }
  });
});

describe("bounded markering polling", () => {
  it("polls on the interval, reconnects on visibility, and cleans up", async () => {
    const environment = createEnvironment();
    const reads: string[] = [];
    const releases: ((value: JobMarkering | null) => void)[] = [];
    const stop = startMarkeringPolling({
      clock: environment.clock,
      getMarkering: (resourceId) => {
        reads.push(resourceId);
        const pending = Promise.withResolvers<JobMarkering | null>();
        releases.push(pending.resolve);
        return pending.promise;
      },
      onMarkering: () => {},
      resourceId: "job-1",
      visibility: environment.visibility,
    });

    expect(reads).toEqual(["job-1"]);
    releases.shift()?.(marker(1));
    await flush();
    environment.intervals.values().next().value?.();
    expect(reads).toEqual(["job-1", "job-1"]);
    releases.shift()?.(marker(2));
    await flush();

    environment.setVisibility("hidden");
    environment.intervals.values().next().value?.();
    expect(reads).toHaveLength(2);
    environment.setVisibility("visible");
    expect(reads).toHaveLength(3);
    releases.shift()?.(marker(3));
    await flush();

    stop();
    expect(environment.listener).toBeNull();
    expect(environment.intervals.size).toBe(0);
  });

  it("does not apply an in-flight read after a resource switch cleanup", async () => {
    const environment = createEnvironment();
    const pending = Promise.withResolvers<JobMarkering | null>();
    const applied: (JobMarkering | null)[] = [];
    const stop = startMarkeringPolling({
      clock: environment.clock,
      getMarkering: () => pending.promise,
      onMarkering: (markering) => applied.push(markering),
      resourceId: "old-job",
      visibility: environment.visibility,
    });

    stop();
    pending.resolve(marker(5));
    await Promise.resolve();
    await Promise.resolve();
    expect(applied).toEqual([]);
  });

  it("swallows a read failure and allows the next poll to retry", async () => {
    const environment = createEnvironment();
    const applied: (JobMarkering | null)[] = [];
    let attempts = 0;
    const stop = startMarkeringPolling({
      clock: environment.clock,
      getMarkering: () => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error("temporary read failure");
        }
        return marker(2);
      },
      onMarkering: (markering) => applied.push(markering),
      resourceId: "job-1",
      visibility: environment.visibility,
    });

    await Promise.resolve();
    await Promise.resolve();
    environment.intervals.values().next().value?.();
    await Promise.resolve();
    await Promise.resolve();
    expect(attempts).toBe(2);
    expect(applied).toEqual([marker(2)]);
    stop();
  });

  it("keeps a newer revision when a later read is older", async () => {
    const environment = createEnvironment();
    const applied: (JobMarkering | null)[] = [];
    let latest: JobMarkering | null = null;
    let reads = 0;
    const stop = startMarkeringPolling({
      clock: environment.clock,
      getMarkering: () => {
        reads += 1;
        return reads === 1 ? marker(3) : marker(2, "gevolgd");
      },
      onMarkering: (next) => {
        if (hasNewerMarkering(latest, next)) {
          latest = next;
          applied.push(next);
        }
      },
      resourceId: "job-1",
      visibility: environment.visibility,
    });

    await Promise.resolve();
    await Promise.resolve();
    environment.intervals.values().next().value?.();
    await Promise.resolve();
    await Promise.resolve();
    expect(applied).toEqual([marker(3)]);
    stop();
  });
});
