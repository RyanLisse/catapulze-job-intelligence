import { describe, expect, it } from "bun:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { JOB_FIXTURES } from "./fixtures";
import { JobDetail } from "./job-detail";

const htmlJob = JOB_FIXTURES.find((job) => job.id === "job-html-nvb");
const plainJob = JOB_FIXTURES.find((job) => job.id === "job-001");

describe("JobDetail Opdracht body + raw scroll (CTP-481)", () => {
  it("renders NVB HTML body as sanitized markup, not escaped tags", () => {
    if (!htmlJob) {
      throw new Error("Expected job-html-nvb fixture");
    }
    const markup = renderToStaticMarkup(
      createElement(JobDetail, {
        descriptionId: "d",
        job: htmlJob,
        onClose: () => {},
        titleId: "t",
      })
    );
    expect(markup).toContain('data-body-format="html"');
    expect(markup).toContain("<b>TypeScript</b>");
    expect(markup).toContain("<li>React</li>");
    const opdrachtStart = markup.indexOf(">Opdracht<");
    const rawStart = markup.indexOf(">Raw preview<");
    expect(opdrachtStart).toBeGreaterThan(-1);
    expect(rawStart).toBeGreaterThan(opdrachtStart);
    const opdrachtMarkup = markup.slice(opdrachtStart, rawStart);
    // Opdracht must render real tags, not escaped literals.
    expect(opdrachtMarkup).toContain("<p>");
    expect(opdrachtMarkup).not.toContain("&lt;p&gt;");
    expect(opdrachtMarkup).not.toContain("&lt;b&gt;");
  });

  it("escapes plain-text bron bodies", () => {
    if (!plainJob) {
      throw new Error("Expected job-001 fixture");
    }
    const markup = renderToStaticMarkup(
      createElement(JobDetail, {
        descriptionId: "d",
        job: plainJob,
        onClose: () => {},
        titleId: "t",
      })
    );
    expect(markup).toContain('data-body-format="plain"');
    expect(markup).toContain("datapijplijnen");
  });

  it("exposes a scrollable raw preview container", () => {
    if (!htmlJob) {
      throw new Error("Expected job-html-nvb fixture");
    }
    const markup = renderToStaticMarkup(
      createElement(JobDetail, {
        descriptionId: "d",
        job: htmlJob,
        liveData: true,
        onClose: () => {},
        titleId: "t",
      })
    );
    expect(markup).toContain('data-testid="job-raw-preview-scroll"');
    expect(markup).toContain("overflow-y-auto");
    expect(markup).toContain("max-h-72");
    expect(markup).toContain("min-h-0");
    expect(markup).toContain("nationalevacaturebank");
  });
});
