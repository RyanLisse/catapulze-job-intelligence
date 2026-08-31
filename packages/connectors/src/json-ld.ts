/* oxlint-disable anti-slop/no-unknown-parameters, anti-slop/no-runtime-typeof, anti-slop/no-unsafe-dictionary-type -- This is the JSON-LD I/O boundary: schema.org JobPosting markup is arbitrary third-party JSON whose shape we don't control, so `unknown`/`Record<string, unknown>` narrowing is established here rather than upstream. */
/**
 * Minimal, regex-free extractor for `<script type="application/ld+json">`
 * blocks embedded in an HTML document. Used as the documented fallback path
 * for sources whose SSR detail pages carry JSON-LD (e.g. Opdrachtoverheid's
 * and Harvey Nash's JobPosting markup) when a private listing API is
 * unavailable or changes.
 *
 * Deliberately does not use a DOM parser: connectors run in worker/server
 * contexts without one, and the extraction only needs to locate script tag
 * boundaries and hand the inner text to `JSON.parse`.
 */

/** Untyped JSON-LD node: schema.org markup is third-party data whose shape
 * we don't own, so this is the deliberate, contained boundary type rather
 * than a per-usage `Record<string, unknown>`. */
export type JsonLdNode = Record<string, unknown>;

const OPEN_MARKER = '<script type="application/ld+json"';
const CLOSE_TAG = "</script>";

/** Every `<script type="application/ld+json">` block in `html`, parsed as JSON.
 * A block that fails to parse (malformed JSON-LD, seen in the wild on some
 * sources) is skipped rather than throwing. */
export const extractJsonLdBlocks = (html: string): unknown[] => {
  const blocks: unknown[] = [];
  let searchStart = 0;

  for (;;) {
    const openIndex = html.indexOf(OPEN_MARKER, searchStart);
    if (openIndex === -1) {
      break;
    }
    const tagEnd = html.indexOf(">", openIndex);
    if (tagEnd === -1) {
      break;
    }
    const closeIndex = html.indexOf(CLOSE_TAG, tagEnd);
    if (closeIndex === -1) {
      break;
    }
    const jsonText = html.slice(tagEnd + 1, closeIndex).trim();
    searchStart = closeIndex + CLOSE_TAG.length;
    if (!jsonText) {
      continue;
    }
    try {
      blocks.push(JSON.parse(jsonText));
    } catch {
      // Malformed JSON-LD block (e.g. unquoted string values) — skip it and
      // keep scanning for the next block rather than failing the whole page.
    }
  }

  return blocks;
};

const isRecord = (value: unknown): value is JsonLdNode =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isJobPosting = (value: unknown): value is JsonLdNode => {
  if (!isRecord(value)) {
    return false;
  }
  const type = value["@type"];
  if (typeof type === "string") {
    return type === "JobPosting";
  }
  return Array.isArray(type) && type.includes("JobPosting");
};

/** Finds the first JobPosting node among parsed JSON-LD blocks, including
 * nodes nested under an `@graph` array. */
export const findJobPosting = (
  blocks: readonly unknown[]
): JsonLdNode | undefined => {
  for (const block of blocks) {
    if (isJobPosting(block)) {
      return block;
    }
    if (isRecord(block) && Array.isArray(block["@graph"])) {
      for (const node of block["@graph"]) {
        if (isJobPosting(node)) {
          return node;
        }
      }
    }
  }
  return undefined;
};

/** Convenience lookup for the common case: extract every JSON-LD block from
 * `html` and return the first whose `@type` matches (e.g. "JobPosting").
 * Unlike `findJobPosting`, this does not look inside `@graph` -- callers
 * that need that should use `extractJsonLdBlocks` + `findJobPosting`
 * directly. Returns undefined when none match or parsing yielded no blocks. */
export const findJsonLdByType = (
  html: string,
  type: string
): JsonLdNode | undefined => {
  for (const block of extractJsonLdBlocks(html)) {
    if (isRecord(block) && block["@type"] === type) {
      return block;
    }
  }
  return undefined;
};
