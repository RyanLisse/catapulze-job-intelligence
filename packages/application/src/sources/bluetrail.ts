import {
  bluetrailConfig,
  createJsonLdClient,
  createJsonLdConnector,
} from "@ji/connectors/json-ld";

import { normaliseJsonLdObservation } from "../normalise/json-ld";
import type { SourceDefinition } from "./definition";

export const bluetrail = {
  bronId: "00000000-0000-4000-8000-000000000006",
  createConnector: ({ bronId, knownHashes, listingFixturePath }) =>
    createJsonLdConnector({
      bronId,
      client: listingFixturePath
        ? createJsonLdClient({
            config: bluetrailConfig,
            listingFixturePath,
            liveEnabled: false,
          })
        : undefined,
      config: bluetrailConfig,
      knownHashes,
    }),
  liveEnv: "BLUETRAIL_LIVE",
  naam: "BlueTrail",
  normalise: normaliseJsonLdObservation,
  seed: {
    crawlDelayMs: 5000,
    methode: "json-ld",
    voorwaardenStatus: "te_toetsen",
  },
  slug: "bluetrail",
} satisfies SourceDefinition<"bluetrail">;
