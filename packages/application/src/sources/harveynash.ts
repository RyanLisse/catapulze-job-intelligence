import {
  createHarveyNashClient,
  createHarveyNashConnector,
} from "@ji/connectors/harveynash";

import { normaliseHarveyNashObservation } from "../normalise/harveynash";
import type { SourceDefinition } from "./definition";

export const harveynash = {
  bronId: "00000000-0000-4000-8000-000000000007",
  createConnector: ({ bronId, knownHashes, listingFixturePath }) =>
    createHarveyNashConnector({
      bronId,
      client: listingFixturePath
        ? createHarveyNashClient({ listingFixturePath, liveEnabled: false })
        : undefined,
      knownHashes,
    }),
  liveEnv: "HARVEYNASH_LIVE",
  naam: "Harvey Nash",
  normalise: normaliseHarveyNashObservation,
  seed: {
    crawlDelayMs: 1500,
    methode: "json-api",
    voorwaardenStatus: "te_toetsen",
  },
  slug: "harveynash",
} satisfies SourceDefinition<"harveynash">;
