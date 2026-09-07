import { isEffectSurfaceEnabled } from "@ji/env/effect-flags";

/**
 * Opt-in Effect Manticore HTTP client (CTP-479 / Slice 14 canary for search).
 * Default OFF — `ManticoreSearchEngine.fromUrl` keeps FetchManticoreClient.
 * Rollback: unset JI_EFFECT_SEARCH (or any value other than "1").
 */
export const isEffectSearchEnabled = (): boolean =>
  isEffectSurfaceEnabled("search");
