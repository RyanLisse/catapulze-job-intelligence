/* oxlint-disable anti-slop/no-unknown-parameters, anti-slop/no-runtime-typeof -- This is the JSON-LD extraction I/O boundary: <script type="application/ld+json"> blocks on arbitrary source HTML carry untyped, source-specific JobPosting shapes (plain object, array, or @graph-wrapped), so the object/array narrowing contract is established here. */
import type { JsonLdLabelBlockField, JsonLdNode, JsonLdValue } from "./types";

const SCRIPT_PATTERN =
  /<script[^>]*type=["']application\/ld\+json["'][^>]*>(?<content>[\s\S]*?)<\/script>/giu;

const isJsonLdNode = (value: unknown): value is JsonLdNode =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const collectNodes = (value: unknown, out: JsonLdNode[]): void => {
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectNodes(entry, out);
    }
    return;
  }
  if (!isJsonLdNode(value)) {
    return;
  }
  const graph = value["@graph"];
  if (Array.isArray(graph)) {
    collectNodes(graph, out);
    return;
  }
  out.push(value);
};

/** Extracts every JSON-LD node from `<script type="application/ld+json">` blocks in `html`,
 * expanding `@graph` wrappers and tolerating malformed JSON blocks by skipping them. */
export const extractJsonLdNodes = (html: string): JsonLdNode[] => {
  const nodes: JsonLdNode[] = [];
  SCRIPT_PATTERN.lastIndex = 0;
  let match = SCRIPT_PATTERN.exec(html);
  while (match) {
    const raw = match.groups?.content?.trim();
    if (raw) {
      try {
        collectNodes(JSON.parse(raw), nodes);
      } catch {
        // Malformed JSON-LD block on the source page: skip it rather than fail the fetch.
      }
    }
    match = SCRIPT_PATTERN.exec(html);
  }
  return nodes;
};

const isJobPostingType = (value: JsonLdValue | undefined): boolean => {
  if (typeof value === "string") {
    return value === "JobPosting";
  }
  if (Array.isArray(value)) {
    return value.some((entry) => entry === "JobPosting");
  }
  return false;
};

/** Picks the first `JobPosting` node out of a set of extracted JSON-LD nodes. */
export const pickJobPosting = (nodes: JsonLdNode[]): JsonLdNode | null =>
  nodes.find((node) => isJobPostingType(node["@type"])) ?? null;

/** Extracts the first `JobPosting` JSON-LD node directly from a detail page's HTML. */
export const extractJobPosting = (html: string): JsonLdNode | null =>
  pickJobPosting(extractJsonLdNodes(html));

const asPlainText = (value: JsonLdValue | undefined): string =>
  typeof value === "string" ? value : "";

/** Applies each configured label-block pattern against either the raw detail HTML or the
 * JobPosting's own `description` text, returning only the fields that matched. */
export const extractLabelBlock = (
  html: string,
  jobPosting: JsonLdNode | null,
  fields?: Record<string, JsonLdLabelBlockField>
) => {
  const result: Record<string, string> = {};
  if (!fields) {
    return result;
  }
  const description = asPlainText(jobPosting?.description);
  for (const [key, config] of Object.entries(fields)) {
    const haystack = config.source === "description" ? description : html;
    config.pattern.lastIndex = 0;
    const match = config.pattern.exec(haystack);
    const value = match?.groups?.value?.trim();
    if (value) {
      result[key] = value;
    }
  }
  return result;
};
