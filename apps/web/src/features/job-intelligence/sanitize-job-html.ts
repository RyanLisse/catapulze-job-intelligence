/**
 * Allowlist sanitizer for Opdracht HTML bodies (CTP-481).
 * Keeps formatting from Motian/HTML brons while stripping scripts, handlers,
 * and unsafe URLs. No DOMPurify dependency — works in Bun SSR + browser.
 */

const ALLOWED_TAGS = new Set([
  "a",
  "b",
  "blockquote",
  "br",
  "code",
  "div",
  "em",
  "h1",
  "h2",
  "h3",
  "h4",
  "hr",
  "i",
  "li",
  "ol",
  "p",
  "pre",
  "span",
  "strong",
  "u",
  "ul",
]);

const VOID_TAGS = new Set(["br", "hr"]);

const TAG_PATTERN =
  /(?<raw><\/?(?<name>[a-zA-Z][\w:-]*)(?<attrs>[^>]*)>|<(?<bang>![^>]*)>)/gu;

const ATTR_PATTERN =
  /(?<name>[^\s=/>]+)(?:\s*=\s*(?:"(?<dq>[^"]*)"|'(?<sq>[^']*)'|(?<bare>[^\s"'>]+)))?/gu;

const SAFE_HREF_PATTERN = /^(?:https?:|mailto:|\/|#)/iu;

const stripDangerousSequences = (html: string): string =>
  html
    .replaceAll(/<script\b[^>]*>[\s\S]*?<\/script>/giu, "")
    .replaceAll(/<style\b[^>]*>[\s\S]*?<\/style>/giu, "")
    .replaceAll(/<!--[\s\S]*?-->/gu, "");

const decodeBasicEntities = (value: string): string =>
  value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&");

const escapeAttribute = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

const isSafeHref = (value: string): boolean => {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return false;
  }
  const decoded = decodeBasicEntities(trimmed);
  if (/^[a-z0-9+.-]+:/iu.test(decoded) && !SAFE_HREF_PATTERN.test(decoded)) {
    return false;
  }
  return SAFE_HREF_PATTERN.test(decoded) || !/^[a-z0-9+.-]+:/iu.test(decoded);
};

const sanitizeAttributes = (tagName: string, attrs: string): string => {
  const kept: string[] = [];
  for (const match of attrs.matchAll(ATTR_PATTERN)) {
    const name = match.groups?.name?.toLowerCase();
    if (!name || name.startsWith("on") || name === "style") {
      continue;
    }
    const value =
      match.groups?.dq ?? match.groups?.sq ?? match.groups?.bare ?? "";
    if (tagName === "a") {
      if (name === "href" && isSafeHref(value)) {
        kept.push(
          `href="${escapeAttribute(value.trim())}"`,
          'rel="noopener noreferrer"',
          'target="_blank"'
        );
      }
      continue;
    }
    if (name === "class" || name === "title") {
      kept.push(`${name}="${escapeAttribute(value)}"`);
    }
  }
  return kept.length > 0 ? ` ${kept.join(" ")}` : "";
};

/** Collapse markup to a single-line plain excerpt (summaries / list cards). */
export const stripHtmlToText = (html: string): string =>
  html
    .replaceAll(/<script\b[^>]*>[\s\S]*?<\/script>/giu, " ")
    .replaceAll(/<style\b[^>]*>[\s\S]*?<\/style>/giu, " ")
    .replaceAll(/<[^>]+>/gu, " ")
    .replaceAll(/&nbsp;/giu, " ")
    .replaceAll(/&amp;/giu, "&")
    .replaceAll(/&lt;/giu, "<")
    .replaceAll(/&gt;/giu, ">")
    .replaceAll(/&quot;/giu, '"')
    .replaceAll(/&#39;/giu, "'")
    .replaceAll(/\s+/gu, " ")
    .trim();

export const sanitizeJobHtml = (dirty: string): string => {
  const withoutDanger = stripDangerousSequences(dirty);
  let output = "";
  let cursor = 0;

  for (const match of withoutDanger.matchAll(TAG_PATTERN)) {
    const index = match.index ?? 0;
    output += withoutDanger.slice(cursor, index);
    cursor = index + match[0].length;

    if (match.groups?.bang !== undefined) {
      continue;
    }

    const raw = match.groups?.raw ?? match[0];
    const name = match.groups?.name?.toLowerCase();
    const attrs = match.groups?.attrs ?? "";
    if (!name || !ALLOWED_TAGS.has(name)) {
      continue;
    }

    const isClosing = raw.startsWith("</");
    if (isClosing) {
      if (!VOID_TAGS.has(name)) {
        output += `</${name}>`;
      }
      continue;
    }

    if (VOID_TAGS.has(name)) {
      output += `<${name}>`;
      continue;
    }

    output += `<${name}${sanitizeAttributes(name, attrs)}>`;
  }

  output += withoutDanger.slice(cursor);
  return output;
};
