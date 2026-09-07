/**
 * Opt-in Effect performance spans (CTP-478 / Slice 12).
 * Default OFF — prod Effect enablement is CTP-479 (parked).
 * Rollback: leave unset / set to anything other than "1".
 */
export const isEffectPerformanceSpansEnabled = (): boolean =>
  process.env.PERF_EFFECT_SPANS === "1";
