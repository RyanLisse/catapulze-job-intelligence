import {
  createJsonLdClient,
  createJsonLdConnector,
  proActConfig,
} from "@ji/connectors/json-ld";

import { normaliseJsonLdObservation } from "../normalise/json-ld";
import type { SourceDefinition } from "./definition";

export const proAct = {
  bronId: "00000000-0000-4000-8000-000000000005",
  createConnector: ({ bronId, knownHashes, listingFixturePath }) =>
    createJsonLdConnector({
      bronId,
      client: listingFixturePath
        ? createJsonLdClient({
            config: proActConfig,
            listingFixturePath,
            liveEnabled: false,
          })
        : undefined,
      config: proActConfig,
      knownHashes,
    }),
  liveEnv: "PROACT_LIVE",
  naam: "Pro-Act IT",
  normalise: normaliseJsonLdObservation,
  seed: {
    crawlDelayMs: 10_000,
    methode: "json-ld",
    voorwaardenStatus: "te_toetsen",
  },
  slug: "pro-act",
} satisfies SourceDefinition<"pro-act">;
