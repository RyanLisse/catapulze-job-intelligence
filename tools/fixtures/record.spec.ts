import { describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  DEFAULT_HTML_STRIP,
  recordFixture,
  stripHtml,
  stripJsonKeys,
} from "./record";

describe("stripHtml", () => {
  it("removes script/style/svg/nav/footer and named contact blocks but keeps JSON-LD and content", async () => {
    const html = `<html><head><script>track()</script><style>a{}</style><script type="application/ld+json">{"@type":"JobPosting"}</script></head><body><nav><a>menu</a></nav><svg><path/></svg><h1>Titel</h1><div class="vacancy-contact-info"><p>Recruiter</p></div><footer>adres</footer></body></html>`;
    const { counts, value } = await stripHtml(html, [
      ...DEFAULT_HTML_STRIP,
      ".vacancy-contact-info",
    ]);
    expect(value).toBe(
      `<html><head><script type="application/ld+json">{"@type":"JobPosting"}</script></head><body><h1>Titel</h1></body></html>`
    );
    expect(counts).toEqual({
      ".vacancy-contact-info": 1,
      footer: 1,
      nav: 1,
      'script:not([type="application/ld+json"])': 1,
      style: 1,
      svg: 1,
    });
  });

  it("drops a named attribute but keeps the element and its content", async () => {
    const { counts, value } = await stripHtml(
      `<article class="job recruiter-jan"><p>Tekst</p></article>`,
      [],
      ["article::class"]
    );
    expect(value).toBe("<article><p>Tekst</p></article>");
    expect(counts).toEqual({ "article::class": 1 });
  });
});

describe("stripJsonKeys", () => {
  it("deletes named keys at any depth and leaves every other value untouched", () => {
    const { counts, value } = stripJsonKeys(
      { data: [{ id: "a", recruiter: { name: "x" } }, { id: "b" }], total: 2 },
      ["recruiter"]
    );
    expect(value).toEqual({ data: [{ id: "a" }, { id: "b" }], total: 2 });
    expect(counts).toEqual({ recruiter: 1 });
  });
});

describe("recordFixture (end to end, --from-raw, no network)", () => {
  it("writes the envelope for a brand-new source with the raw file's mtime and the real trimmed size", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "record-spec-"));
    const rawPath = path.join(dir, "raw.html");
    const html = `<html><head><script>x()</script></head><body><h1>Titel</h1><footer>adres</footer></body></html>`;
    await writeFile(rawPath, html);
    const mtime = new Date("2026-09-16T17:37:21.029Z");
    await utimes(rawPath, mtime, mtime);

    const summary = await recordFixture([
      "--source",
      "brand-new-source",
      "--name",
      "detail-1",
      "--url",
      "https://example.test/detail-1",
      "--from-raw",
      rawPath,
      "--out-dir",
      path.join(dir, "out"),
    ]);

    const fixture = JSON.parse(
      await readFile(
        path.join(dir, "out", "brand-new-source", "detail-1.json"),
        "utf-8"
      )
    );
    const trimmed = "<html><head></head><body><h1>Titel</h1></body></html>";
    expect(fixture).toMatchObject({
      capturedAt: "2026-09-16T17:37:21.029Z",
      contentType: "html",
      contractVersion: "connector-fixture/v1",
      payload: trimmed,
      source: "brand-new-source",
    });
    expect(summary).toContain(`${html.length}→${trimmed.length} bytes`);
    await rm(dir, { force: true, recursive: true });
  });
});
