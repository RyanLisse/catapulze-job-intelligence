/**
 * Bounded-concurrency runner for one poll cycle.
 *
 * A cycle used to be a plain `for` over the due sources, so its wall clock was
 * the sum of every source's run. Two sources pace themselves with their own
 * `crawl_delay_ms` (BlueTrail around 680 s, Opdrachtoverheid around 940 s),
 * which pushed a full cycle to 33 to 38 minutes and made the quarter-hour
 * intervals in `curated.bron.interval` unreachable. Running sources side by side
 * fixes that without touching politeness: each source still runs one at a
 * time, and the per-bron limiter inside `executeBronRun` keeps pacing per host.
 */

/**
 * Runs `worker` over `items` with at most `limit` calls in flight.
 *
 * - Items start in array order; a free slot always takes the lowest unstarted
 *   index, so the starting order is the input order.
 * - A rejecting worker is captured as a settled result and does not stop the
 *   others, which is what keeps one broken source from ending a cycle.
 * - `signal` is checked before every start, never mid-item: an abort stops new
 *   starts and lets the items already running finish.
 *
 * Returns one settled result per item that was started, in starting order.
 * Items skipped by an abort have no entry, so the length is the number of
 * items the cycle actually reached.
 */
export const runWithConcurrency = async <Item, Result>(
  items: readonly Item[],
  limit: number,
  worker: (item: Item) => Promise<Result>,
  signal: AbortSignal
): Promise<PromiseSettledResult<Result>[]> => {
  const settled: PromiseSettledResult<Result>[] = [];
  // Indices are handed out in ascending order and every handed-out index is
  // written back, so `settled` stays dense even when an abort cuts the run.
  let nextIndex = 0;

  const runOne = async (item: Item, index: number): Promise<void> => {
    try {
      settled[index] = { status: "fulfilled", value: await worker(item) };
    } catch (error) {
      settled[index] = { reason: error, status: "rejected" };
    }
  };

  // Wrapping every item keeps the queue probe total: an `undefined` entry
  // means "queue exhausted" and never "this item happens to be undefined".
  const queue = items.map((item, index) => ({ index, item }));
  const slots = Math.max(1, Math.min(Math.floor(limit), queue.length));
  const runners = Array.from({ length: slots }, async () => {
    while (!signal.aborted) {
      const entry = queue[nextIndex];
      if (entry === undefined) {
        return;
      }
      nextIndex += 1;
      // oxlint-disable-next-line no-await-in-loop -- a slot runs one item at a time; that is the bound
      await runOne(entry.item, entry.index);
    }
  });

  await Promise.all(runners);
  return settled;
};
