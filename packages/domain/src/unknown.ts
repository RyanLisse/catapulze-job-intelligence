export const UNKNOWN = "unknown" as const;

export type UnknownValue = typeof UNKNOWN;

export const isUnknown = (value: string): value is UnknownValue =>
  value === UNKNOWN;
