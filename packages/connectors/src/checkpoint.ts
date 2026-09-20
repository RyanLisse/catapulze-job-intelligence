import type { BronId, ScrapeRunId } from "@ji/domain";

import type { ConnectorCheckpoint, ConnectorRunMetrics } from "./contract";

export interface CheckpointKey {
  bronId: BronId;
  scrapeRunId: ScrapeRunId;
}

export interface ConnectorRunProgress {
  checkpoint: ConnectorCheckpoint | null;
  metrics: ConnectorRunMetrics;
  /** Cumulative listing identities for this scrapeRunId. Durable retries can
   * finish reconciliation without pretending the resumed attempt alone saw
   * earlier pages. Absent on legacy checkpoints, which remain incomplete. */
  observedBronReferenties?: string[];
}

export interface RunProgressStore {
  load: (key: CheckpointKey) => Promise<ConnectorRunProgress | null>;
}
