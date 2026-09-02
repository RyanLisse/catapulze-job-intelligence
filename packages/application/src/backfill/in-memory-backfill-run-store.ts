import type {
  BackfillRunEvidence,
  BackfillRunMetrics,
  BackfillRunStore,
} from "./neon-v1-types";

export class InMemoryBackfillRunStore implements BackfillRunStore {
  readonly runs: {
    evidence?: BackfillRunEvidence;
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
    evidence: BackfillRunEvidence
  ): Promise<void> {
    const run = this.runs.find((entry) => entry.scrapeRunId === scrapeRunId);
    if (run) {
      run.evidence = evidence;
      run.metrics = evidence.metrics;
      run.status = "succeeded";
    }
    return Promise.resolve();
  }

  failRun(
    scrapeRunId: string,
    reason: string,
    evidence: BackfillRunEvidence
  ): Promise<void> {
    const run = this.runs.find((entry) => entry.scrapeRunId === scrapeRunId);
    if (run) {
      run.evidence = evidence;
      run.metrics = evidence.metrics;
      run.reason = reason;
      run.status = "failed";
    }
    return Promise.resolve();
  }
}
