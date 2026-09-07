import { describe, expect, it } from "bun:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { JOB_FIXTURES } from "./fixtures";
import { JobDetail } from "./job-detail";
import { JobResults } from "./job-results";
import type { JobListing } from "./types";

const htmlJob = JOB_FIXTURES.find((job) => job.id === "job-html-nvb");
const plainJob = JOB_FIXTURES.find((job) => job.id === "job-001");

describe("JobDetail Opdracht body + raw scroll (CTP-481 / CTP-483)", () => {
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

  it("renders entity-encoded description as HTML, not visible tags (CTP-483)", () => {
    if (!htmlJob) {
      throw new Error("Expected job-html-nvb fixture");
    }
    const encodedJob: JobListing = {
      ...htmlJob,
      description:
        "&lt;p&gt;Wij zoeken een &lt;b&gt;TypeScript&lt;/b&gt; engineer.&lt;/p&gt;&lt;ul&gt;&lt;li&gt;React&lt;/li&gt;&lt;/ul&gt;",
      summary: "Wij zoeken een TypeScript engineer. React",
    };
    const markup = renderToStaticMarkup(
      createElement(JobDetail, {
        descriptionId: "d",
        job: encodedJob,
        onClose: () => {},
        titleId: "t",
      })
    );
    const opdrachtStart = markup.indexOf(">Opdracht<");
    const rawStart = markup.indexOf(">Raw preview<");
    const opdrachtMarkup = markup.slice(opdrachtStart, rawStart);
    expect(opdrachtMarkup).toContain('data-body-format="html"');
    expect(opdrachtMarkup).toContain("<b>TypeScript</b>");
    expect(opdrachtMarkup).toContain("<li>React</li>");
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

describe("JobResults list card summary (CTP-483)", () => {
  it("does not show raw HTML tags in the mobile summary teaser", () => {
    if (!htmlJob) {
      throw new Error("Expected job-html-nvb fixture");
    }
    const dirtySummaryJob: JobListing = {
      ...htmlJob,
      summary:
        "&lt;p&gt;Wij zoeken een &lt;b&gt;TypeScript&lt;/b&gt; engineer.&lt;/p&gt;",
    };
    const markup = renderToStaticMarkup(
      createElement(JobResults, {
        jobs: [dirtySummaryJob],
        onSelect: () => {},
        selectedJobId: null,
      })
    );
    expect(markup).toContain("Wij zoeken een TypeScript engineer.");
    expect(markup).not.toContain("&lt;p&gt;");
    expect(markup).not.toContain("<b>TypeScript</b>");
  });
});

describe("CTP-482 aangevuld provenance badge", () => {
  it("renders aangevuld badge with tooltip above UI threshold only", () => {
    if (!plainJob) {
      throw new Error("Expected job-001 fixture");
    }
    const enrichedJob: JobListing = {
      ...plainJob,
      enrichedFields: [
        { confidence: 0.8, field: "locatie", source: "deterministic" },
        { confidence: 0.79, field: "tarief", source: "deterministic" },
      ],
      location: "Utrecht",
      rate: null,
    };
    const markup = renderToStaticMarkup(
      createElement(JobDetail, {
        descriptionId: "d",
        job: enrichedJob,
        onClose: () => {},
        titleId: "t",
      })
    );
    expect(markup).toContain('title="aangevuld (locatie)"');
    expect(markup).toContain(">aangevuld<");
    expect(markup).not.toContain('title="aangevuld (tarief)"');
    expect(markup).toContain("Tarief onbekend");
    expect(markup).toContain("Werkvorm");
  });
});
