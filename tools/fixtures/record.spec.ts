import { afterEach, describe, expect, it } from "bun:test";
import {
  mkdtemp,
  readFile,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
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

  it("refuses a --raw-dir that resolves inside the repository, before any request", async () => {
    const insideRepoDir = path.join(import.meta.dir, "raw-dir-inside-repo");
    await expect(
      recordFixture([
        "--source",
        "any-source",
        "--name",
        "any-name",
        "--url",
        "https://example.test/any",
        "--raw-dir",
        insideRepoDir,
      ])
    ).rejects.toThrow(/resolves inside the repository/u);
  });

  it("detects JSON content even when the raw file is named .html, and strips the requested keys", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "record-spec-"));
    const rawPath = path.join(dir, "raw.html");
    await writeFile(rawPath, JSON.stringify({ id: "a", recruiter: "Jan" }));

    const summary = await recordFixture([
      "--source",
      "content-sniff",
      "--name",
      "detail-1",
      "--url",
      "https://example.test/detail-1",
      "--from-raw",
      rawPath,
      "--strip-key",
      "recruiter",
      "--out-dir",
      path.join(dir, "out"),
    ]);

    const fixture = JSON.parse(
      await readFile(
        path.join(dir, "out", "content-sniff", "detail-1.json"),
        "utf-8"
      )
    );
    expect(fixture.contentType).toBe("json");
    expect(fixture.payload).toEqual({ id: "a" });
    expect(summary).toContain("recruiter×1");
    await rm(dir, { force: true, recursive: true });
  });

  it("refuses --strip-key when the raw payload is detected as HTML, instead of silently dropping it", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "record-spec-"));
    // Wrong extension on purpose: detection must go by content, not name.
    const rawPath = path.join(dir, "raw.json");
    await writeFile(rawPath, "<html><body>Not JSON</body></html>");

    await expect(
      recordFixture([
        "--source",
        "wrong-ext",
        "--name",
        "detail-1",
        "--url",
        "https://example.test/detail-1",
        "--from-raw",
        rawPath,
        "--strip-key",
        "recruiter",
        "--out-dir",
        path.join(dir, "out"),
      ])
    ).rejects.toThrow(/is not JSON/u);
    await rm(dir, { force: true, recursive: true });
  });
});

describe("recordFixture (live path, mocked fetch, no network)", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("selects POST (not GET) for an empty --body, and locks down the raw directory and file", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "record-spec-"));
    let capturedInit: RequestInit | undefined;
    // SAFETY: this stub matches fetch's (input, init) => Promise<Response>
    // call signature; the cast only narrows away the extra static members
    // (e.g. `preconnect`) TS's global `fetch` type declares.
    globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) => {
      capturedInit = init;
      return Promise.resolve(Response.json({ ok: true }, { status: 200 }));
    }) as typeof fetch;

    const summary = await recordFixture([
      "--source",
      "empty-body-source",
      "--name",
      "detail-1",
      "--url",
      "https://example.test/detail-1",
      "--body",
      "",
      "--raw-dir",
      dir,
      "--out-dir",
      path.join(dir, "out"),
    ]);

    expect(capturedInit?.method).toBe("POST");
    expect(capturedInit?.body).toBe("");
    expect(summary).toContain("capturedAt=");

    if (process.platform !== "win32") {
      const rawDir = path.join(dir, "empty-body-source");
      const dirStat = await stat(rawDir);
      expect(dirStat.mode.toString(8).slice(-3)).toBe("700");
      const rawFileStat = await stat(path.join(rawDir, "detail-1.json"));
      expect(rawFileStat.mode.toString(8).slice(-3)).toBe("600");
    }

    await rm(dir, { force: true, recursive: true });
  });
});
