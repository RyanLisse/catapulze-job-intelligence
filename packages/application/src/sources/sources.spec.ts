import { describe, expect, it } from "bun:test";

import {
  findSourceByNaam,
  resolveSourceByNaam,
  SOURCES,
  SUPPORTED_BRON_SLUGS,
} from "./index";

describe("source registry", () => {
  it("lists slugs alphabetically and keeps each definition's slug equal to its key", () => {
    expect(SUPPORTED_BRON_SLUGS).toEqual([...SUPPORTED_BRON_SLUGS].toSorted());
    for (const slug of SUPPORTED_BRON_SLUGS) {
      expect(SOURCES[slug].slug).toBe(slug);
    }
  });

  it("resolves a bron by its naam regardless of case and whitespace", () => {
    expect(resolveSourceByNaam("  tenderned ")?.slug).toBe("tenderned");
    expect(resolveSourceByNaam("INHUURDESK")?.slug).toBe("inhuurdesk");
  });

  it("matches on the definition's naam, not on naam === slug", () => {
    const sources = [
      ...Object.values(SOURCES),
      { naam: "Need Staffing IT", slug: "needstaffing" },
    ];
    expect(findSourceByNaam(sources, "need staffing it")?.slug).toBe(
      "needstaffing"
    );
    expect(findSourceByNaam(sources, "needstaffing")).toBeUndefined();
  });

  it("returns undefined for an unknown naam", () => {
    expect(resolveSourceByNaam("Werken voor Nederland")).toBeUndefined();
  });

  it("gives every source a unique bronId (a shared id cross-contaminates known-hashes and observations)", () => {
    const slugsByBronId = new Map<string, string[]>();
    for (const [slug, source] of Object.entries(SOURCES)) {
      const slugs = slugsByBronId.get(source.bronId) ?? [];
      slugs.push(slug);
      slugsByBronId.set(source.bronId, slugs);
    }
    const collisions = [...slugsByBronId.entries()]
      .filter(([, slugs]) => slugs.length > 1)
      .map(([bronId, slugs]) => `${bronId} shared by ${slugs.join(", ")}`);
    expect(collisions).toEqual([]);
  });

  it("gives every source a unique slug", () => {
    const slugs = Object.keys(SOURCES);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});
