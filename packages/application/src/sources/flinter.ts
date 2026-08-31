import {
  createFlinterClient,
  createFlinterConnector,
} from "@ji/connectors/flinter";

import { normaliseFlinterObservation } from "../normalise/flinter";
import type { SourceDefinition } from "./definition";

export const flinter = {
  bronId: "00000000-0000-4000-8000-00000000000a",
  createConnector: ({ bronId, knownHashes, listingFixturePath }) =>
    createFlinterConnector({
      bronId,
      client: listingFixturePath
        ? createFlinterClient({ listingFixturePath, liveEnabled: false })
        : undefined,
      knownHashes,
    }),
  liveEnv: "FLINTER_LIVE",
  naam: "Flinter",
  normalise: normaliseFlinterObservation,
  seed: {
    // Low volume, no pagination, no XHR (docs/sources/flinter.md) -- poll
    // far less often than the JSON/XHR sources.
    crawlDelayMs: 3000,
    methode: "html",
    voorwaardenStatus: "te_toetsen",
  },
  slug: "flinter",
} satisfies SourceDefinition<"flinter">;
