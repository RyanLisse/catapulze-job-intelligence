import type { BooleanNode } from "@ji/domain";

import type { SearchFilters } from "./types";

const stableStringify = (value: unknown): string => {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
};

const hashString = async (input: string): Promise<string> => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input)
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "hex"))
    .join("");
};

export const hashAst = async (ast: BooleanNode): Promise<string> =>
  hashString(stableStringify(ast));

export const buildCacheKey = async (
  astHash: string,
  indexVersion: number,
  filters: SearchFilters
): Promise<string> =>
  `search:v1:${astHash}:${indexVersion}:${await hashString(stableStringify(filters))}`;
