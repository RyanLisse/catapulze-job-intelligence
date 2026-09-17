import {
  createJsonLdClient,
  createJsonLdConnector,
  zzpOpdrachtenConfig,
} from "@ji/connectors/json-ld";

import { normaliseJsonLdObservation } from "../normalise/json-ld";
import type { SourceDefinition } from "./definition";

export const zzpOpdrachten = {
  bronId: "00000000-0000-4000-8000-000000000013",
  createConnector: ({ bronId, listingFixturePath }) =>
    createJsonLdConnector({
      bronId,
      client: listingFixturePath
        ? createJsonLdClient({
            config: zzpOpdrachtenConfig,
            listingFixturePath,
            liveEnabled: false,
          })
        : undefined,
      config: zzpOpdrachtenConfig,
    }),
  listingHashCoversDetail: false,
  liveEnv: "ZZP_OPDRACHTEN_LIVE",
  naam: "ZZP-Opdrachten.nl",
  normalise: normaliseJsonLdObservation,
  seed: {
    crawlDelayMs: 2000,
    methode: "json-ld",
    voorwaardenStatus: "te_toetsen",
  },
  slug: "zzp-opdrachten",
} satisfies SourceDefinition<"zzp-opdrachten">;
