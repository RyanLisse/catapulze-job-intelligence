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
 *     [--note <text>] [--raw-dir <dir>] [--from-raw <file>]
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

export interface StripResult<T> {
  readonly counts: Record<string, number>;
  readonly value: T;
}

export const stripHtml = async (
  html: string,
  selectors: readonly string[]
): Promise<StripResult<string>> => {
  const counts: Record<string, number> = {};
  let rewriter = new HTMLRewriter();
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
  input: unknown,
  keys: readonly string[]
): StripResult<unknown> => {
  const counts: Record<string, number> = Object.fromEntries(
    keys.map((key) => [key, 0])
  );
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) {
      return node.map(walk);
    }
    if (node === null || typeof node !== "object") {
      return node;
    }
    const out: Record<string, unknown> = {};
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

const main = async (): Promise<void> => {
  const { values } = parseArgs({
    options: {
      body: { type: "string" },
      name: { type: "string" },
      note: { type: "string" },
      "from-raw": { type: "string" },
      "raw-dir": { type: "string" },
      source: { type: "string" },
      strip: { multiple: true, type: "string" },
      "strip-key": { multiple: true, type: "string" },
      url: { type: "string" },
    },
  });
  const { body, name, note, source, url } = values;
  if (!(source && name && url)) {
    throw new Error("--source, --name and --url are required");
  }

  let rawPath = values["from-raw"];
  if (!rawPath) {
    const response = await fetch(url, {
      body,
      headers: {
        "User-Agent": USER_AGENT,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      method: body ? "POST" : "GET",
    });
    if (!response.ok) {
      throw new Error(`${url} answered HTTP ${response.status}`);
    }
    const contentType = response.headers.get("content-type") ?? "";
    const rawDir = path.join(
      values["raw-dir"] ?? path.join(tmpdir(), "ji-fixture-raw"),
      source
    );
    await mkdir(rawDir, { recursive: true });
    rawPath = path.join(
      rawDir,
      `${name}.${contentType.includes("json") ? "json" : "html"}`
    );
    await writeFile(rawPath, await response.text());
  }
  const rawText = await readFile(rawPath, "utf-8");
  const isJson = rawPath.endsWith(".json");
  const capturedAt = (await stat(rawPath)).mtime.toISOString();

  const stripped = isJson
    ? stripJsonKeys(JSON.parse(rawText), values["strip-key"] ?? [])
    : await stripHtml(rawText, [
        ...DEFAULT_HTML_STRIP,
        ...(values.strip ?? []),
      ]);
  const payloadText =
    typeof stripped.value === "string"
      ? stripped.value
      : JSON.stringify(stripped.value);

  const provenance = `Recorded by tools/fixtures/record.ts: ${body ? `POST ${body}` : "GET"} ${url}. Mechanically stripped (${isJson ? "keys" : "elements"}): ${formatCounts(stripped.counts)}.`;
  const fixture = {
    capturedAt,
    captureNote: note ? `${provenance} ${note}` : provenance,
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
