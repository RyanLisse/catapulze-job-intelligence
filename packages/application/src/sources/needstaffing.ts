import {
  createNeedstaffingClient,
  createNeedstaffingConnector,
} from "@ji/connectors/needstaffing";

import { normaliseNeedstaffingObservation } from "../normalise/needstaffing";
import type { SourceDefinition } from "./definition";

export const needstaffing = {
  bronId: "00000000-0000-4000-8000-000000000003",
  createConnector: ({ bronId, knownHashes, listingFixturePath }) =>
    createNeedstaffingConnector({
      bronId,
      client: listingFixturePath
        ? createNeedstaffingClient({ listingFixturePath, liveEnabled: false })
        : undefined,
      knownHashes,
    }),
  liveEnv: "NEEDSTAFFING_LIVE",
  naam: "Need Staffing IT",
  normalise: normaliseNeedstaffingObservation,
  seed: {
    crawlDelayMs: 2000,
    methode: "html",
    voorwaardenStatus: "te_toetsen",
  },
  slug: "needstaffing",
} satisfies SourceDefinition<"needstaffing">;
