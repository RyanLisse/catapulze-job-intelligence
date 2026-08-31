import type {
  Connector,
  ConnectorRunKind,
  KnownHashStore,
} from "@ji/connectors";
import type { BronId, VoorwaardenStatus } from "@ji/domain";

import type { NormalisedAanvraagDraft } from "../normalise";

export interface CreateSourceConnectorInput {
  bronId: BronId;
  knownHashes?: KnownHashStore;
  /** Replay/fixture runs: read the listing from this repo fixture instead of HTTP. */
  listingFixturePath?: string;
  /** Whether the source's live env flag (`liveEnv`) is set to "1". */
  live: boolean;
  runKind: ConnectorRunKind;
}

/** Everything the worker, replay, smoke seed and curate path need to know about one bron. */
export interface SourceDefinition<Slug extends string = string> {
  bronId: BronId;
  createConnector: (input: CreateSourceConnectorInput) => Connector;
  /** Env var name that switches the connector from fixtures to live HTTP. */
  liveEnv: string;
  naam: string;
  normalise: (body: Uint8Array, contentHash: string) => NormalisedAanvraagDraft;
  /** Bron row defaults used by the smoke seed. */
  seed: {
    crawlDelayMs: number;
    methode: string;
    voorwaardenStatus: VoorwaardenStatus;
  };
  slug: Slug;
}
