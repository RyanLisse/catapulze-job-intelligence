/**
 * Opt-in Effect tracing hooks for `@ji/performance` (CTP-478 / Slice 12).
 *
 * Import from `@ji/performance/effect` — do **not** re-export from the package
 * root. The root barrel already carries Node-only critical-path sinks; pulling
 * this module through browser bundles would also drag Effect runtime (#203).
 *
 * Native critical-path sessions remain the default. Prod Effect stays OFF until
 * CTP-479 (parked).
 */
export {
  CRITICAL_PATH_SPAN_ATTRIBUTE_KEYS,
  sanitizeCriticalPathSpanAttributes,
  sanitizeLooseCriticalPathSpanAttributes,
} from "./attributes";
export type {
  CriticalPathSpanAttributeKey,
  CriticalPathSpanAttributes,
} from "./attributes";
export { isEffectPerformanceSpansEnabled } from "./flag";
export {
  annotateCriticalPathSpan,
  criticalPathSpanName,
  withCriticalPathSpan,
} from "./spans";
export type { WithCriticalPathSpanOptions } from "./spans";
