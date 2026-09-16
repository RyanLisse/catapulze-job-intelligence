import {
  bijOranjeConfig,
  createJsonLdClient,
  createJsonLdConnector,
} from "@ji/connectors/json-ld";

import { normaliseJsonLdObservation } from "../normalise/json-ld";
import type { SourceDefinition } from "./definition";

export const bijOranje = {
  bronId: "00000000-0000-4000-8000-00000000000c",
  // RJC-357/RJC-401: knownHashes deliberately NOT forwarded -- a skip here
  // would freeze detail-only changes; see listingHashCoversDetail below.
  createConnector: ({ bronId, listingFixturePath }) =>
    createJsonLdConnector({
      bronId,
      client: listingFixturePath
        ? createJsonLdClient({
            config: bijOranjeConfig,
            listingFixturePath,
            liveEnabled: false,
          })
        : undefined,
      config: bijOranjeConfig,
    }),
  // RJC-357/RJC-401: the JobPosting lives on the detail page; the sitemap hash
  // sees only url (and no reliable detail fields).
  listingHashCoversDetail: false,
  liveEnv: "BIJORANJE_LIVE",
  naam: "Bij Oranje",
  normalise: normaliseJsonLdObservation,
  seed: {
    crawlDelayMs: 2000,
    methode: "json-ld",
    voorwaardenStatus: "te_toetsen",
  },
  slug: "bij-oranje",
} satisfies SourceDefinition<"bij-oranje">;
