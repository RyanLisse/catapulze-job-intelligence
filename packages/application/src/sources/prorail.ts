import {
  createJsonLdClient,
  createJsonLdConnector,
  prorailConfig,
} from "@ji/connectors/json-ld";

import { normaliseJsonLdObservation } from "../normalise/json-ld";
import type { SourceDefinition } from "./definition";

export const prorail = {
  bronId: "00000000-0000-4000-8000-000000000022",
  // Listing metadata covers only detail URLs, not JobPosting fields.
  // Do not pass known hashes, so detail-only changes remain observable.
  createConnector: ({ bronId, listingFixturePath }) =>
    createJsonLdConnector({
      bronId,
      client: listingFixturePath
        ? createJsonLdClient({
            config: prorailConfig,
            listingFixturePath,
            liveEnabled: false,
          })
        : undefined,
      config: prorailConfig,
    }),
  listingHashCoversDetail: false,
  liveEnv: "PRORAIL_LIVE",
  naam: "ProRail",
  normalise: normaliseJsonLdObservation,
  seed: {
    crawlDelayMs: 2000,
    methode: "json-ld",
    voorwaardenStatus: "te_toetsen",
  },
  slug: "prorail",
} satisfies SourceDefinition<"prorail">;
