import { describe, expect, it } from "bun:test";

import { DEFAULT_HTML_STRIP, stripHtml, stripJsonKeys } from "./record";

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
