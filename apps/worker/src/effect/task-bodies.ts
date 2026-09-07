import type { Effect } from "effect";

import type { BronIngestPipelineResult } from "../poll-bron-run";
import { runDrainOutbox } from "../tasks/drain-outbox";
import { runPollBron } from "../tasks/poll-bron";
import type { PollBronPayload } from "../tasks/poll-bron-schema";
import type { WorkerFault } from "./faults";
import { fromWorkerPromise } from "./from-promise";
import { runWorkerPromise } from "./run";
import type { RunWorkerPromiseOptions } from "./run";

export interface DrainOutboxEffectPayload {
  batchSize?: number;
  leaseSeconds?: number;
  limit?: number;
  maxAttempts?: number;
}

export const pollBronTaskBodyProgram = (
  payload: PollBronPayload
): Effect.Effect<BronIngestPipelineResult, WorkerFault> =>
  fromWorkerPromise(() => runPollBron(payload));

/**
 * Opt-in Effect Promise boundary for poll-bron task body.
 * Default schemaTask `run` stays native `runPollBron` (prod Effect OFF).
 * Trigger.dev maxAttempts / queue concurrency remain the durability surface.
 */
export const runPollBronEffect = (
  payload: PollBronPayload,
  options: RunWorkerPromiseOptions = {}
): Promise<BronIngestPipelineResult> =>
  runWorkerPromise(pollBronTaskBodyProgram(payload), options);

export const drainOutboxTaskBodyProgram = (
  payload: DrainOutboxEffectPayload
): Effect.Effect<Awaited<ReturnType<typeof runDrainOutbox>>, WorkerFault> =>
  fromWorkerPromise(() => runDrainOutbox(payload));

/**
 * Opt-in Effect Promise boundary for drain-outbox task body.
 * Default schemaTask `run` stays native `runDrainOutbox` (prod Effect OFF).
 */
export const runDrainOutboxEffect = (
  payload: DrainOutboxEffectPayload,
  options: RunWorkerPromiseOptions = {}
): Promise<Awaited<ReturnType<typeof runDrainOutbox>>> =>
  runWorkerPromise(drainOutboxTaskBodyProgram(payload), options);
