import { describe, expect, it } from "bun:test";

import { JOB_FIXTURES } from "./fixtures";
import {
  parseJobSearchState,
  searchJobs,
  serializeJobSearchState,
  toggleSearchFilter,
} from "./search-state";
import { selectableJobSortOptions } from "./types";

describe("job search URL state", () => {
  it("round-trips shareable filters and selection", () => {
    const original = parseJobSearchState(
      new URLSearchParams(
        "q=data&source=inhuurdesk&source=tenderned&contract=interim&location=Amsterdam&freshness=7d&minRate=90&sort=rate-high&page=2&job=job-001&preview=loading"
      )
    );

    expect(parseJobSearchState(serializeJobSearchState(original))).toEqual(
      original
    );
  });

  it("rejects invalid enum and numeric values", () => {
    const state = parseJobSearchState(
      new URLSearchParams(
        "source=database&contract=stage&freshness=never&minRate=-10&sort=random&page=0&preview=done"
      )
    );

    // RJC-368: sources are opaque bron slugs from the live register, not a
    // fixed enum, so any provided value passes through unfiltered (deduped)
    // -- an unrecognized slug just matches zero bronnen/facets downstream.
    expect(state.filters.sources).toEqual(["database"]);
    expect(state.filters.contractTypes).toEqual([]);
    expect(state.filters.freshness).toBe("all");
    expect(state.filters.minRate).toBeNull();
    expect(state.sort).toBe("relevance");
    expect(state.page).toBe(1);
    expect(state.previewStatus).toBe("ready");
  });
});

describe("fixture job search", () => {
  it("searches, filters and sorts deterministically", () => {
    const state = parseJobSearchState(
      new URLSearchParams(
        "q=Azure&source=inhuurdesk&source=tenderned&minRate=100&sort=rate-high"
      )
    );
    const result = searchJobs(JOB_FIXTURES, state);

    expect(result.items.map(({ id }) => id)).toEqual(["job-003", "job-001"]);
    expect(result.total).toBe(2);
    expect(result.status).toBe("ready");
  });

  it("returns an explicit empty presentation state", () => {
    const state = parseJobSearchState(
      new URLSearchParams("q=kwantumteleportatie")
    );
    const result = searchJobs(JOB_FIXTURES, state);

    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.status).toBe("empty");
    expect(result.message).toContain("Geen vacatures");
  });

  it("evaluates OR, NOT, groups and quoted phrases with Boolean precedence", () => {
    const orResult = searchJobs(
      JOB_FIXTURES,
      parseJobSearchState(new URLSearchParams("q=Azure OR BPMN"))
    );
    const groupedResult = searchJobs(
      JOB_FIXTURES,
      parseJobSearchState(
        new URLSearchParams('q=(Azure OR "Power BI") NOT Databricks')
      )
    );
    const phraseResult = searchJobs(
      JOB_FIXTURES,
      parseJobSearchState(new URLSearchParams('q="Machine Learning"'))
    );

    expect(orResult.items.map(({ id }) => id)).toEqual([
      "job-001",
      "job-002",
      "job-003",
    ]);
    expect(groupedResult.items.map(({ id }) => id)).toEqual([
      "job-003",
      "job-006",
    ]);
    expect(phraseResult.items.map(({ id }) => id)).toEqual(["job-010"]);
  });

  it("treats adjacent terms as AND and rejects malformed syntax", () => {
    const implicitAnd = searchJobs(
      JOB_FIXTURES,
      parseJobSearchState(new URLSearchParams("q=Azure Kubernetes"))
    );
    const malformed = searchJobs(
      JOB_FIXTURES,
      parseJobSearchState(new URLSearchParams("q=(Azure OR)"))
    );

    expect(implicitAnd.items.map(({ id }) => id)).toEqual(["job-003"]);
    expect(malformed.status).toBe("syntax-error");
    expect(malformed.items).toEqual([]);
  });

  it("sorts hourly and yearly rates within separate comparable groups", () => {
    const state = parseJobSearchState(new URLSearchParams("sort=rate-high"));
    const result = searchJobs(JOB_FIXTURES, { ...state, pageSize: 100 });
    const rates = result.items.map(({ id, rate }) => ({
      id,
      max: rate?.max ?? null,
      period: rate?.period ?? null,
    }));

    expect(rates).toEqual([
      { id: "job-003", max: 125, period: "hour" },
      { id: "job-005", max: 120, period: "hour" },
      { id: "job-001", max: 115, period: "hour" },
      { id: "job-004", max: 108, period: "hour" },
      { id: "job-007", max: 105, period: "hour" },
      { id: "job-009", max: 103, period: "hour" },
      { id: "job-002", max: 98, period: "hour" },
      { id: "job-006", max: 94, period: "hour" },
      { id: "job-008", max: 102_000, period: "year" },
      { id: "job-010", max: 96_000, period: "year" },
      { id: "job-011", max: null, period: null },
    ]);
  });

  it("paginates without mutating fixture order", () => {
    const before = JOB_FIXTURES.map(({ id }) => id);
    const state = parseJobSearchState(new URLSearchParams("page=2"));
    const result = searchJobs(JOB_FIXTURES, { ...state, pageSize: 3 });

    expect(result.items).toHaveLength(3);
    expect(result.page).toBe(2);
    expect(JOB_FIXTURES.map(({ id }) => id)).toEqual(before);
  });

  it("toggles a filter value without mutating the input", () => {
    const values = ["interim"] as const;

    expect(toggleSearchFilter(values, "vast")).toEqual(["interim", "vast"]);
    expect(toggleSearchFilter(values, "interim")).toEqual([]);
    expect(values).toEqual(["interim"]);
  });
});

// RJC-394: the deadline sort stays hidden until the loader provides real
// sluitingsdatum values; one flag flips it back on.
describe("selectableJobSortOptions", () => {
  it("hides closing-soon without enriched data and offers it with", () => {
    expect(selectableJobSortOptions(false)).toEqual([
      "relevance",
      "newest",
      "rate-high",
    ]);
    expect(selectableJobSortOptions(true)).toContain("closing-soon");
  });

  it("parses a hidden sort from the URL back to relevance", () => {
    const state = parseJobSearchState(new URLSearchParams("sort=closing-soon"));
    expect(state.sort).toBe("relevance");
  });
});
