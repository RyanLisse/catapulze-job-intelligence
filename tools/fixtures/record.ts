/**
 * Records one live response as a connector fixture, per the AGENTS.md
 * "Fixtures are real recordings" rule:
 *
 * - one real request (GET, or POST when `--body` is given);
 * - the raw response is written untouched to a temp dir, never the repo
 *   (it can hold PII);
 * - `capturedAt` is that raw file's mtime in UTC, never a rounded value;
 * - trimming is mechanical only: HTML elements removed by selector, JSON
 *   keys deleted by name. Nothing is retyped or invented.
 *
 * Usage:
 *   bun tools/fixtures/record.ts --source <slug> --name <file-stem> --url <url>
 *     [--body '<json>'] [--strip <css selector>]... [--strip-key <key>]...
 *     [--strip-attr '<css selector>::<attribute>']...
 *     [--note <text>] [--raw-dir <dir>] [--from-raw <file>] [--no-defaults]
 *
 * `--no-defaults` drops DEFAULT_HTML_STRIP so only the named `--strip`
 * selectors apply -- for pages whose parser reads data inside one of the
 * defaults (Need Staffing's pagination lives in a `<nav>`).
 *
 * `--from-raw` re-trims an earlier recording without a second request; the
 * raw file's mtime (the original fetch time) stays the capturedAt.
 */
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";

export const USER_AGENT = "Catapulze-JI fixture capture";

/** Always stripped from HTML. JSON-LD scripts are data, not script, and stay. */
export const DEFAULT_HTML_STRIP = [
  'script:not([type="application/ld+json"])',
  "style",
  "svg",
  "nav",
  "footer",
] as const;

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | JsonObject;
export interface JsonObject {
  [key: string]: JsonValue;
}

const isJsonObject = (value: JsonValue): value is JsonObject =>
  value instanceof Object && !Array.isArray(value);

export interface StripResult<T> {
  readonly counts: Record<string, number>;
  readonly value: T;
}

export const stripHtml = async (
  html: string,
  selectors: readonly string[],
  /** `selector::attribute` -- drops one attribute that carries PII (e.g. a
   * recruiter-name class) without removing the element's content. */
  attributes: readonly string[] = []
): Promise<StripResult<string>> => {
  const counts: Record<string, number> = {};
  let rewriter = new HTMLRewriter();
  for (const spec of attributes) {
    const [selector = "", attribute = ""] = spec.split("::");
    counts[spec] = 0;
    rewriter = rewriter.on(selector, {
      element: (element) => {
        if (element.hasAttribute(attribute)) {
          counts[spec] = (counts[spec] ?? 0) + 1;
          element.removeAttribute(attribute);
        }
      },
    });
  }
  for (const selector of selectors) {
    counts[selector] = 0;
    rewriter = rewriter.on(selector, {
      element: (element) => {
        // ponytail: lol-html still visits children of a removed element, so a
        // nested match (svg inside nav) counts once per selector it matches.
        counts[selector] = (counts[selector] ?? 0) + 1;
        element.remove();
      },
    });
  }
  const value = await rewriter.transform(new Response(html)).text();
  return { counts, value };
};

export const stripJsonKeys = (
  input: JsonValue,
  keys: readonly string[]
): StripResult<JsonValue> => {
  const counts: Record<string, number> = Object.fromEntries(
    keys.map((key) => [key, 0])
  );
  const walk = (node: JsonValue): JsonValue => {
    if (Array.isArray(node)) {
      return node.map(walk);
    }
    if (!isJsonObject(node)) {
      return node;
    }
    const out: JsonObject = {};
    for (const [key, child] of Object.entries(node)) {
      if (keys.includes(key)) {
        counts[key] = (counts[key] ?? 0) + 1;
        continue;
      }
      out[key] = walk(child);
    }
    return out;
  };
  return { counts, value: walk(input) };
};

const formatCounts = (counts: Record<string, number>): string =>
  Object.entries(counts)
    .map(([what, count]) => `${what}×${count}`)
    .join(", ") || "nothing";

interface FetchRawInput {
  readonly body: string | undefined;
  readonly name: string;
  readonly rawDirRoot: string;
  readonly source: string;
  readonly url: string;
}

/** One real request; the untouched response lands outside the repo, because a
 * raw page can hold PII that must never be committed. */
const fetchRaw = async (input: FetchRawInput): Promise<string> => {
  const headers = new Headers({ "User-Agent": USER_AGENT });
  if (input.body) {
    headers.set("Content-Type", "application/json");
  }
  const response = await fetch(input.url, {
    body: input.body,
    headers,
    method: input.body ? "POST" : "GET",
  });
  if (!response.ok) {
    throw new Error(`${input.url} answered HTTP ${response.status}`);
  }
  const contentType = response.headers.get("content-type") ?? "";
  const rawDir = path.join(input.rawDirRoot, input.source);
  await mkdir(rawDir, { recursive: true });
  const rawPath = path.join(
    rawDir,
    `${input.name}.${contentType.includes("json") ? "json" : "html"}`
  );
  await writeFile(rawPath, await response.text());
  return rawPath;
};

const main = async (): Promise<void> => {
  const { values } = parseArgs({
    options: {
      body: { type: "string" },
      "from-raw": { type: "string" },
      name: { type: "string" },
      "no-defaults": { type: "boolean" },
      note: { type: "string" },
      "raw-dir": { type: "string" },
      source: { type: "string" },
      strip: { multiple: true, type: "string" },
      "strip-attr": { multiple: true, type: "string" },
      "strip-key": { multiple: true, type: "string" },
      url: { type: "string" },
    },
  });
  const { body, name, note, source, url } = values;
  if (!(source && name && url)) {
    throw new Error("--source, --name and --url are required");
  }

  const rawPath =
    values["from-raw"] ??
    (await fetchRaw({
      body,
      name,
      rawDirRoot: values["raw-dir"] ?? path.join(tmpdir(), "ji-fixture-raw"),
      source,
      url,
    }));
  const rawText = await readFile(rawPath, "utf-8");
  const isJson = rawPath.endsWith(".json");
  const rawStats = await stat(rawPath);
  const capturedAt = rawStats.mtime.toISOString();

  // SAFETY: the raw file was written from a JSON response and re-read
  // verbatim, so JSON.parse yields a JSON value.
  const parsedJson = isJson ? (JSON.parse(rawText) as JsonValue) : null;
  const stripped = isJson
    ? stripJsonKeys(parsedJson, values["strip-key"] ?? [])
    : await stripHtml(
        rawText,
        [
          ...(values["no-defaults"] ? [] : DEFAULT_HTML_STRIP),
          ...(values.strip ?? []),
        ],
        values["strip-attr"] ?? []
      );

  const provenance = `Recorded by tools/fixtures/record.ts: ${body ? `POST ${body}` : "GET"} ${url}. Mechanically stripped (${isJson ? "keys" : "elements"}): ${formatCounts(stripped.counts)}.`;
  const fixture = {
    captureNote: note ? `${provenance} ${note}` : provenance,
    capturedAt,
    contentType: isJson ? "json" : "html",
    contractVersion: "connector-fixture/v1",
    payload: stripped.value,
    source,
  };
  const outPath = path.join(
    import.meta.dir,
    "../../fixtures/connectors",
    source,
    `${name}.json`
  );
  await writeFile(outPath, `${JSON.stringify(fixture, null, 2)}\n`);

  console.log(
    `${url} ${rawText.length}→${payloadText.length} bytes capturedAt=${capturedAt} stripped: ${formatCounts(stripped.counts)} raw=${rawPath}`
  );
};

if (import.meta.main) {
  await main();
}
