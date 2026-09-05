import type { SearchAdapter } from "@ji/search";

import type { PublicBronView } from "../../bronnen";
import type { SpottWriteClient } from "../../export/spott/client";
import type { SliceAStores } from "../stores/types";

export interface SourcingAssessmentAttestationPayload {
  readonly claims: readonly {
    readonly field: "deadline" | "rate" | "location" | "contract_type";
    readonly sourceReferenceIds: readonly string[];
    readonly status: "known" | "unknown" | "uncertain";
    readonly vacancyId: string;
    readonly value?: string;
  }[];
  readonly queryDigest: string;
  readonly searchStatus: "complete" | "incomplete" | "unknown";
  readonly selectedIds: readonly string[];
  readonly sourceReferences: readonly {
    readonly capabilityId: string;
    readonly id: string;
    readonly maxAgeSeconds?: number;
    readonly observedAt: string | null;
    readonly reference: string;
  }[];
  readonly usedCapabilities: readonly string[];
}

export interface SliceAHandlerDeps {
  readonly bronnen: {
    getById: (bronId: string) => Promise<PublicBronView | null>;
    list: () => Promise<readonly PublicBronView[]>;
  };
  readonly searchAdapter: SearchAdapter;
  /**
   * Server-composed authority for sourcing evidence. Request payloads may
   * identify the query and selection they expect, but only this boundary can
   * attest the canonical query, authorized selection, search completeness,
   * provenance, and observation timestamps.
   */
  readonly sourcingAssessmentAuthority?: {
    readonly attest: (
      request: {
        readonly queryDigest: string;
        readonly selectedIds: readonly string[];
      },
      principal: {
        readonly kind: "user" | "agent" | "service";
        readonly subjectId: string;
      }
    ) =>
      | SourcingAssessmentAttestationPayload
      | Promise<SourcingAssessmentAttestationPayload>;
  };
  /** Server-owned clock; overridden only by deterministic composition tests. */
  readonly now?: () => Date;
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
