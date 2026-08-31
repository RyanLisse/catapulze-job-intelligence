import {
  createOpdrachtoverheidClient,
  createOpdrachtoverheidConnector,
} from "@ji/connectors/opdrachtoverheid";

import { normaliseOpdrachtoverheidObservation } from "../normalise/opdrachtoverheid";
import type { SourceDefinition } from "./definition";

export const opdrachtoverheid = {
  // Distinct hex-suffix UUID (not the decimal ..001/..002 sequence used by
  // tenderned/inhuurdesk) to avoid collisions with sibling Slice C source
  // branches picking the same next-in-sequence id.
  bronId: "00000000-0000-4000-8000-0000000000ad",
  createConnector: ({ bronId, knownHashes, listingFixturePath }) =>
    createOpdrachtoverheidConnector({
      bronId,
      client: listingFixturePath
        ? createOpdrachtoverheidClient({
            listingFixturePath,
            liveEnabled: false,
          })
        : undefined,
      knownHashes,
    }),
  liveEnv: "OPDRACHTOVERHEID_LIVE",
  naam: "Opdrachtoverheid",
  normalise: normaliseOpdrachtoverheidObservation,
  seed: {
    crawlDelayMs: 1000,
    methode: "json-api",
    voorwaardenStatus: "te_toetsen",
  },
  slug: "opdrachtoverheid",
} satisfies SourceDefinition<"opdrachtoverheid">;
