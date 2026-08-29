import type { SearchAdapter } from "@ji/search";

import type { PublicBronView } from "../../bronnen";
import type { SliceAStores } from "../stores/types";

export interface SliceAHandlerDeps {
  readonly bronnen: {
    getById: (bronId: string) => Promise<PublicBronView | null>;
    list: () => Promise<readonly PublicBronView[]>;
  };
  readonly searchAdapter: SearchAdapter;
  readonly stores: SliceAStores;
}

export interface CompleteTaskResult {
  readonly evidence: readonly string[];
  readonly status: "blocked" | "partial" | "success";
  readonly summary: string;
}
