import { describe, expect, it } from "bun:test";

import { sanitizeJobHtml, stripHtmlToText } from "./sanitize-job-html";

describe("sanitizeJobHtml (CTP-481)", () => {
  it("keeps common job-description tags", () => {
    const dirty =
      "<p>Wij zoeken een <b>TypeScript</b> engineer.</p><ul><li>React</li></ul>";
    const safe = sanitizeJobHtml(dirty);
    expect(safe).toContain("<p>");
    expect(safe).toContain("<b>TypeScript</b>");
    expect(safe).toContain("<ul>");
    expect(safe).toContain("<li>React</li>");
  });

  it("strips scripts, handlers and dangerous URLs", () => {
    const evilScheme = ["java", "script", ":alert(3)"].join("");
    const dirty = `<p onclick="alert(1)">x</p><script>alert(2)</script><a href="${evilScheme}">bad</a><a href="https://example.com">ok</a>`;
    const safe = sanitizeJobHtml(dirty);
    expect(safe).not.toContain("<script");
    expect(safe).not.toContain("onclick");
    expect(safe).not.toContain(evilScheme);
    expect(safe).toContain('href="https://example.com"');
    expect(safe).toContain('rel="noopener noreferrer"');
  });

  it("strips to plain text for summaries", () => {
    expect(
      stripHtmlToText(
        "<p>Wij zoeken een <b>TypeScript</b> engineer.</p><ul><li>React</li></ul>"
      )
    ).toBe("Wij zoeken een TypeScript engineer. React");
  });
});
