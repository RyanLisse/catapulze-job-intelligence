import { createCtmClient, createCtmConnector } from "@ji/connectors/ctm";

import { normaliseCtmObservation } from "../normalise/ctm";
import type { SourceDefinition } from "./definition";

export const ctm = {
  bronId: "00000000-0000-4000-8000-00000000000b",
  createConnector: ({ bronId, knownHashes, listingFixturePath }) =>
    createCtmConnector({
      bronId,
      client: listingFixturePath
        ? createCtmClient({ listingFixturePath, liveEnabled: false })
        : undefined,
      knownHashes,
    }),
  liveEnv: "CTM_LIVE",
  naam: "CTM",
  normalise: normaliseCtmObservation,
  seed: {
    crawlDelayMs: 1500,
    methode: "feed",
    // Unconfirmed: the T&C page redirect-loops (docs/sources/ctm.md), so a
    // human must set this to "toegestaan" before CTM_LIVE is ever set.
    voorwaardenStatus: "te_toetsen",
  },
  slug: "ctm",
} satisfies SourceDefinition<"ctm">;
