import type { SearchAdapter } from "@ji/search";

import type { PublicBronView } from "../../bronnen";
import type { SpottWriteClient } from "../../export/spott/client";
import type { SliceAStores } from "../stores/types";

export interface SliceAHandlerDeps {
  readonly bronnen: {
    getById: (bronId: string) => Promise<PublicBronView | null>;
    list: () => Promise<readonly PublicBronView[]>;
  };
  readonly searchAdapter: SearchAdapter;
  /**
   * Trusted deployment boundary. Catapulze currently runs one tenant per
   * deployment; this value is supplied by server composition and is never
   * accepted from an HTTP/MCP request or derived from a user role.
   */
  readonly scopeId: string;
  /** Trusted deployment policy; omitted means runtime availability is unknown. */
  readonly capabilityAvailability?: {
    readonly unavailableCapabilityIds: () =>
      | Promise<ReadonlySet<string>>
      | ReadonlySet<string>;
  };
  /** Clock injection affects freshness only and is excluded from the digest. */
  readonly now?: () => Date;
  readonly spottWriteClient?: SpottWriteClient;
  readonly stores: SliceAStores;
}

export interface CompleteTaskResult {
  readonly evidence: readonly string[];
  readonly status: "blocked" | "partial" | "success";
  readonly summary: string;
}
