import { describe, expect, it } from "bun:test";

import { extractJsonLdBlocks, findJobPosting } from "./json-ld";

const wrapScript = (json: string): string =>
  `<html><head><script type="application/ld+json">${json}</script></head><body></body></html>`;

describe("json-ld", () => {
  it("extracts a single JSON-LD block", () => {
    const html = wrapScript(
      '{"@context":"https://schema.org","@type":"JobPosting","title":"Foo"}'
    );
    const blocks = extractJsonLdBlocks(html);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ title: "Foo" });
  });

  it("extracts multiple blocks in document order", () => {
    const html = [
      '<script type="application/ld+json">{"a":1}</script>',
      "<div>filler</div>",
      '<script type="application/ld+json">{"b":2}</script>',
    ].join("\n");
    const blocks = extractJsonLdBlocks(html);
    expect(blocks).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it("skips a malformed block without throwing", () => {
    const html = [
      '<script type="application/ld+json">{not: valid json}</script>',
      '<script type="application/ld+json">{"@type":"JobPosting","title":"Bar"}</script>',
    ].join("\n");
    const blocks = extractJsonLdBlocks(html);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ title: "Bar" });
  });

  it("returns an empty array when there is no JSON-LD", () => {
    expect(extractJsonLdBlocks("<html><body>plain</body></html>")).toEqual([]);
  });

  it("finds a top-level JobPosting node", () => {
    const blocks = [
      { "@type": "BreadcrumbList" },
      { "@type": "JobPosting", title: "Match" },
    ];
    expect(findJobPosting(blocks)).toMatchObject({ title: "Match" });
  });

  it("finds a JobPosting nested under @graph", () => {
    const blocks = [
      {
        "@graph": [
          { "@type": "Organization" },
          { "@type": "JobPosting", title: "Nested" },
        ],
      },
    ];
    expect(findJobPosting(blocks)).toMatchObject({ title: "Nested" });
  });

  it("returns undefined when no JobPosting node exists", () => {
    expect(findJobPosting([{ "@type": "Organization" }])).toBeUndefined();
  });
});
