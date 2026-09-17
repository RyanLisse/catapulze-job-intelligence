import {
  createJsonLdClient,
  createJsonLdConnector,
  intermediairConfig,
} from "@ji/connectors/json-ld";

import { normaliseJsonLdObservation } from "../normalise/json-ld";
import type { SourceDefinition } from "./definition";

export const intermediair = {
  bronId: "00000000-0000-4000-8000-000000000037",
  // Sitemap metadata covers only the URL, not detail-page JobPosting fields.
  createConnector: ({ bronId, listingFixturePath }) =>
    createJsonLdConnector({
      bronId,
      client: listingFixturePath
        ? createJsonLdClient({
            config: intermediairConfig,
            listingFixturePath,
            liveEnabled: false,
          })
        : undefined,
      config: intermediairConfig,
    }),
  listingHashCoversDetail: false,
  liveEnv: "INTERMEDIAIR_LIVE",
  naam: "Intermediair",
  normalise: normaliseJsonLdObservation,
  seed: {
    crawlDelayMs: 2000,
    methode: "json-ld",
    voorwaardenStatus: "te_toetsen",
  },
  slug: "intermediair",
} satisfies SourceDefinition<"intermediair">;
