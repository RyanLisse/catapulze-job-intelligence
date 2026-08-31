import {
  createOnefellowClient,
  createOnefellowConnector,
} from "@ji/connectors/onefellow";

import { normaliseOnefellowObservation } from "../normalise/onefellow";
import type { SourceDefinition } from "./definition";

export const onefellow = {
  bronId: "00000000-0000-4000-8000-000000000009",
  createConnector: ({ bronId, knownHashes, listingFixturePath }) =>
    createOnefellowConnector({
      bronId,
      client: listingFixturePath
        ? createOnefellowClient({ listingFixturePath, liveEnabled: false })
        : undefined,
      knownHashes,
    }),
  liveEnv: "ONEFELLOW_LIVE",
  naam: "Onefellow",
  normalise: normaliseOnefellowObservation,
  seed: {
    crawlDelayMs: 1500,
    methode: "json-api",
    voorwaardenStatus: "te_toetsen",
  },
  slug: "onefellow",
} satisfies SourceDefinition<"onefellow">;
