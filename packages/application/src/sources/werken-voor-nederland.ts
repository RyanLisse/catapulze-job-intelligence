import {
  createJsonLdClient,
  createJsonLdConnector,
  werkenVoorNederlandConfig,
} from "@ji/connectors/json-ld";

import { normaliseJsonLdObservation } from "../normalise/json-ld";
import type { SourceDefinition } from "./definition";

export const werkenVoorNederland = {
  bronId: "00000000-0000-4000-8000-00000000000e",
  // RJC-357/RJC-401: knownHashes deliberately NOT forwarded -- a skip here
  // would freeze detail-only changes; see listingHashCoversDetail below.
  createConnector: ({ bronId, listingFixturePath }) =>
    createJsonLdConnector({
      bronId,
      client: listingFixturePath
        ? createJsonLdClient({
            config: werkenVoorNederlandConfig,
            listingFixturePath,
            liveEnabled: false,
          })
        : undefined,
      config: werkenVoorNederlandConfig,
    }),
  // RJC-357/RJC-401: the JobPosting lives on the detail page; the sitemap hash
  // sees only url and lastmod, not the detail fields.
  listingHashCoversDetail: false,
  liveEnv: "WERKEN_VOOR_NEDERLAND_LIVE",
  naam: "Werken voor Nederland",
  normalise: normaliseJsonLdObservation,
  seed: {
    crawlDelayMs: 2000,
    methode: "json-ld",
    voorwaardenStatus: "te_toetsen",
  },
  slug: "werken-voor-nederland",
} satisfies SourceDefinition<"werken-voor-nederland">;
