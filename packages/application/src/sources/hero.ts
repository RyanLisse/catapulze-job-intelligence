import {
  createJsonLdClient,
  createJsonLdConnector,
  heroConfig,
} from "@ji/connectors/json-ld";

import { normaliseJsonLdObservation } from "../normalise/json-ld";
import type { SourceDefinition } from "./definition";

export const hero = {
  bronId: "00000000-0000-4000-8000-000000000004",
  createConnector: ({ bronId, knownHashes, listingFixturePath }) =>
    createJsonLdConnector({
      bronId,
      client: listingFixturePath
        ? createJsonLdClient({
            config: heroConfig,
            listingFixturePath,
            liveEnabled: false,
          })
        : undefined,
      config: heroConfig,
      knownHashes,
    }),
  liveEnv: "HERO_LIVE",
  naam: "Hero.eu",
  normalise: normaliseJsonLdObservation,
  seed: {
    crawlDelayMs: 2000,
    methode: "json-ld",
    voorwaardenStatus: "te_toetsen",
  },
  slug: "hero",
} satisfies SourceDefinition<"hero">;
