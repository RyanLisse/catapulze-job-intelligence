import {
  createJsonLdClient,
  createJsonLdConnector,
  techniekwerktConfig,
} from "@ji/connectors/json-ld";

import { normaliseJsonLdObservation } from "../normalise/json-ld";
import type { SourceDefinition } from "./definition";

export const techniekwerkt = {
  bronId: "00000000-0000-4000-8000-000000000039",
  // Sitemap metadata covers only the URL, not detail-page fields.
  // Do not pass known hashes, so detail-only changes remain observable.
  createConnector: ({ bronId, listingFixturePath }) =>
    createJsonLdConnector({
      bronId,
      client: listingFixturePath
        ? createJsonLdClient({
            config: techniekwerktConfig,
            listingFixturePath,
            liveEnabled: false,
          })
        : undefined,
      config: techniekwerktConfig,
    }),
  listingHashCoversDetail: false,
  liveEnv: "TECHNIEKWERKT_LIVE",
  naam: "Techniekwerkt",
  normalise: normaliseJsonLdObservation,
  seed: {
    crawlDelayMs: 2000,
    methode: "json-ld",
    voorwaardenStatus: "te_toetsen",
  },
  slug: "techniekwerkt",
} satisfies SourceDefinition<"techniekwerkt">;
