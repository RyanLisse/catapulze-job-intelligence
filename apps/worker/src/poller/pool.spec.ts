import { describe, expect, it } from "bun:test";

import { runWithConcurrency } from "./pool";

interface Tracker {
  readonly finished: string[];
  readonly maxInFlight: () => number;
  readonly started: string[];
  readonly worker: (item: string) => Promise<string>;
}

/**
 * Workers that only resolve once released, so a test decides the interleaving
 * instead of hoping the event loop produces it.
 */
const trackerWithGates = (): Tracker & {
  release: (item: string) => void;
} => {
  const started: string[] = [];
  const finished: string[] = [];
  const gates = new Map<string, () => void>();
  const releasedEarly = new Set<string>();
  let inFlight = 0;
  let peak = 0;

  const complete = (item: string, resolve: (value: string) => void): void => {
    inFlight -= 1;
    finished.push(item);
    resolve(item);
  };

  return {
    finished,
    maxInFlight: () => peak,
    // Releasing an item that has not started yet is remembered, so a test can
    // drain the whole run in one pass without knowing the interleaving.
    release: (item: string) => {
      const gate = gates.get(item);
      if (gate === undefined) {
        releasedEarly.add(item);
        return;
      }
      gate();
    },
    started,
    worker: (item: string) => {
      started.push(item);
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      // oxlint-disable-next-line promise/avoid-new -- the gate is released by the test, not by another promise
      return new Promise<string>((resolve) => {
        if (releasedEarly.delete(item)) {
          complete(item, resolve);
          return;
        }
        gates.set(item, () => complete(item, resolve));
      });
    },
  };
};

const immediateTracker = (): Tracker => {
  const started: string[] = [];
  const finished: string[] = [];
  let inFlight = 0;
  let peak = 0;
  return {
    finished,
    maxInFlight: () => peak,
    started,
    worker: async (item: string) => {
      started.push(item);
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await Promise.resolve();
      await Promise.resolve();
      inFlight -= 1;
      finished.push(item);
      return item;
    },
  };
};

const items = ["a", "b", "c", "d"];

describe("runWithConcurrency", () => {
  it("runs strictly one at a time at limit 1", async () => {
    const tracker = immediateTracker();
    const results = await runWithConcurrency(
      items,
      1,
      tracker.worker,
      new AbortController().signal
    );

    expect(tracker.maxInFlight()).toBe(1);
    expect(tracker.started).toEqual(items);
    expect(tracker.finished).toEqual(items);
    expect(results.map((entry) => entry.status)).toEqual([
      "fulfilled",
      "fulfilled",
      "fulfilled",
      "fulfilled",
    ]);
  });

  it("never exceeds the limit and keeps the input as the starting order", async () => {
    const tracker = trackerWithGates();
    const run = runWithConcurrency(
      items,
      2,
      tracker.worker,
      new AbortController().signal
    );

    await Promise.resolve();
    expect(tracker.started).toEqual(["a", "b"]);
    expect(tracker.maxInFlight()).toBe(2);

    // Finishing "b" first must still hand the free slot to "c", not "d".
    tracker.release("b");
    await Promise.resolve();
    await Promise.resolve();
    expect(tracker.started).toEqual(["a", "b", "c"]);

    for (const item of items) {
      tracker.release(item);
    }
    await run;

    expect(tracker.started).toEqual(items);
    expect(tracker.maxInFlight()).toBe(2);
  });

  it("returns results in starting order, not completion order", async () => {
    const tracker = trackerWithGates();
    const run = runWithConcurrency(
      items,
      4,
      tracker.worker,
      new AbortController().signal
    );
    await Promise.resolve();

    for (const item of items.toReversed()) {
      tracker.release(item);
    }
    const results = await run;

    expect(tracker.finished).toEqual(["d", "c", "b", "a"]);
    expect(
      results.map((entry) =>
        entry.status === "fulfilled" ? entry.value : entry.reason
      )
    ).toEqual(items);
  });

  it("stops starting new items once the signal aborts", async () => {
    const controller = new AbortController();
    const tracker = trackerWithGates();
    const run = runWithConcurrency(items, 2, tracker.worker, controller.signal);

    await Promise.resolve();
    expect(tracker.started).toEqual(["a", "b"]);

    controller.abort();
    tracker.release("a");
    tracker.release("b");
    const results = await run;

    // The two in flight finish; "c" and "d" are never started.
    expect(tracker.started).toEqual(["a", "b"]);
    expect(results).toHaveLength(2);
  });

  it("starts nothing when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const tracker = immediateTracker();

    const results = await runWithConcurrency(
      items,
      2,
      tracker.worker,
      controller.signal
    );

    expect(tracker.started).toEqual([]);
    expect(results).toEqual([]);
  });

  it("lets the other items finish when one worker rejects", async () => {
    const started: string[] = [];
    const boom = new Error("source exploded");
    const results = await runWithConcurrency(
      items,
      2,
      async (item: string) => {
        started.push(item);
        await Promise.resolve();
        if (item === "b") {
          throw boom;
        }
        return item;
      },
      new AbortController().signal
    );

    expect(started).toEqual(items);
    expect(results).toHaveLength(4);
    expect(results[1]).toEqual({ reason: boom, status: "rejected" });
    expect(
      results.filter((entry) => entry.status === "fulfilled")
    ).toHaveLength(3);
  });

  it("handles an empty list without starting a runner", async () => {
    const tracker = immediateTracker();
    const results = await runWithConcurrency(
      [],
      4,
      tracker.worker,
      new AbortController().signal
    );

    expect(results).toEqual([]);
    expect(tracker.started).toEqual([]);
  });
});
