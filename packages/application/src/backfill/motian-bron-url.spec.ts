import { describe, expect, it } from "bun:test";

import { loadConnectorFixture } from "@ji/connectors";
import { UNKNOWN } from "@ji/domain";

import {
  buildStarappleLiveIndex,
  isMotianJobClosed,
  resolveMotianBronUrl,
  resolveStarappleBronTarget,
} from "./motian-bron-url";
import type { StarappleLiveIndex } from "./motian-bron-url";
import type { NeonV1JobRow } from "./neon-v1-types";

const starappleJob = (overrides: Partial<NeonV1JobRow> = {}): NeonV1JobRow => ({
  external_id: "senior-projectleider-amsterdam",
  external_url: null,
  id: "job-1",
  platform: "starapple-nl",
  title: "Senior projectleider",
  ...overrides,
});

describe("resolveMotianBronUrl", () => {
  it("builds the canonical URL from an existing Starapple vacatures URL", () => {
    expect(
      resolveMotianBronUrl(
        starappleJob({
          external_url:
            "https://www.starapple.nl/vacatures/senior-projectleider-amsterdam/",
        })
      )
    ).toBe(
      "https://www.starapple.nl/vacatures/senior-projectleider-amsterdam/"
    );
  });

  it("recovers a slug from a missing-www Starapple URL", () => {
    expect(
      resolveMotianBronUrl(
        starappleJob({
          external_url:
            "https://starapple.nl/vacatures/data-engineer-utrecht/?source=motian",
        })
      )
    ).toBe("https://www.starapple.nl/vacatures/data-engineer-utrecht/");
  });

  it("falls back to external_id when the external URL has a wrong path", () => {
    for (const externalUrl of [
      "https://www.starapple.nl/vacature/slug-from-id/",
      "https://www.starapple.nl/jobs/slug-from-id/",
    ]) {
      expect(
        resolveMotianBronUrl(
          starappleJob({
            external_id: "slug_from_id",
            external_url: externalUrl,
          })
        )
      ).toBe("https://www.starapple.nl/vacatures/slug-from-id/");
    }
  });

  it("normalizes encoded spaces, underscores, repeated dashes, and case", () => {
    expect(
      resolveMotianBronUrl(
        starappleJob({
          external_id: "  Senior__Project%20Leader---Utrecht  ",
        })
      )
    ).toBe("https://www.starapple.nl/vacatures/senior-project-leader-utrecht/");
  });

  it("uses an archive redirect for closed rows", () => {
    expect(
      resolveMotianBronUrl(
        starappleJob({
          external_id: "archived-role",
          status: "closed",
        })
      )
    ).toBe(
      "https://web.archive.org/web/https://www.starapple.nl/vacatures/archived-role/"
    );
    expect(
      resolveMotianBronUrl(
        starappleJob({
          archived_at: "2026-09-01T12:00:00.000Z",
          external_id: "archived-by-timestamp",
        })
      )
    ).toBe(
      "https://web.archive.org/web/https://www.starapple.nl/vacatures/archived-by-timestamp/"
    );
  });

  it("keeps open rows on the live canonical URL", () => {
    expect(
      resolveMotianBronUrl(
        starappleJob({ external_id: "open-role", status: " OPEN " })
      )
    ).toBe("https://www.starapple.nl/vacatures/open-role/");
  });

  it("preserves non-Starapple URL behavior", () => {
    expect(
      resolveMotianBronUrl({
        ...starappleJob(),
        external_url: "  https://example.com/jobs/original  ",
        platform: "nationalevacaturebank",
      })
    ).toBe("https://example.com/jobs/original");
  });

  it("returns UNKNOWN when a Starapple slug is absent", () => {
    expect(
      resolveMotianBronUrl(
        starappleJob({ external_id: "   ", external_url: "not a URL" })
      )
    ).toBe(UNKNOWN);
  });
});

const liveIndexFromSlugs = (slugs: readonly string[]): StarappleLiveIndex => ({
  slugs: new Set(slugs),
});

// fixtures/connectors/starapple/vacancy-sitemap.json — a mechanical
// selection of 52 real slugs from the live vacancy-sitemap.xml (CTP-527).
const loadLiveIndex = async (): Promise<StarappleLiveIndex> => {
  const fixture = await loadConnectorFixture<string>(
    "starapple/vacancy-sitemap.json"
  );
  return buildStarappleLiveIndex(fixture.payload);
};

describe("resolveStarappleBronTarget against the recorded vacancy sitemap", () => {
  it("parses only /vacatures/ locs out of the real sitemap", async () => {
    const index = await loadLiveIndex();
    expect(index.slugs.size).toBe(52);
    expect(index.slugs.has("devops-platform-engineer")).toBe(true);
    expect(index.slugs.has("next-gen-engineers")).toBe(false);
  });

  it("keeps a still-listed derived slug on the live URL", async () => {
    const index = await loadLiveIndex();
    const resolution = resolveStarappleBronTarget(
      starappleJob({
        external_id: "devops-platform-engineer",
        title: "DevOps Platform Engineer",
      }),
      index
    );
    expect(resolution).toEqual({
      fromSlug: "devops-platform-engineer",
      kind: "live",
      match: "exact",
      slug: "devops-platform-engineer",
      url: "https://www.starapple.nl/vacatures/devops-platform-engineer/",
    });
  });

  it("treats an exact listed slug as exact even with live numeric siblings", async () => {
    // `devops-platform-engineer-2` is a sibling repost in the same sitemap;
    // the recorded slug itself is still advertised, so it stays exact.
    const index = await loadLiveIndex();
    expect(index.slugs.has("devops-platform-engineer-2")).toBe(true);
    const resolution = resolveStarappleBronTarget(
      starappleJob({ external_id: "devops-platform-engineer" }),
      index
    );
    expect(resolution).toMatchObject({ kind: "live", match: "exact" });
  });

  it("archives the audited next-gen-engineers 404 instead of fabricating the rename", async () => {
    // The live site renamed it to
    // `next-generation-software-engineers-gezocht-5` — a different string the
    // source never recorded. Fuzzy slug arithmetic would fabricate a link to
    // a vacature Motian never named, so the resolution stays an archive.
    const index = await loadLiveIndex();
    expect(
      index.slugs.has("next-generation-software-engineers-gezocht-5")
    ).toBe(true);
    const resolution = resolveStarappleBronTarget(
      starappleJob({
        external_id: "next-gen-engineers",
        title: "Next Gen Engineers",
      }),
      index
    );
    expect(resolution).toEqual({
      fromSlug: "next-gen-engineers",
      kind: "archive",
      reason: "unresolvable",
      url: "https://web.archive.org/web/https://www.starapple.nl/vacatures/next-gen-engineers/",
    });
  });

  it("archives the audited java-developer-33 404 as ambiguous, not as java-developer", async () => {
    // Nine live `java-developer*` slugs mean sibling reposts the sitemap
    // cannot tell apart; resolving to the unnumbered one would be a guess.
    const index = await loadLiveIndex();
    const resolution = resolveStarappleBronTarget(
      starappleJob({
        external_id: "java-developer-33",
        title: "Java Developer",
      }),
      index
    );
    expect(resolution).toEqual({
      fromSlug: "java-developer-33",
      kind: "archive",
      reason: "unresolvable",
      url: "https://web.archive.org/web/https://www.starapple.nl/vacatures/java-developer-33/",
    });
  });

  it("follows a genuinely unambiguous repost rematch", async () => {
    // `open-sollicitatie` is absent but exactly one live slug carries its
    // numeric repost suffix — the only rematch shape that is not a guess.
    const index = await loadLiveIndex();
    const resolution = resolveStarappleBronTarget(
      starappleJob({
        external_id: "open-sollicitatie",
        title: "Open sollicitatie",
      }),
      index
    );
    expect(resolution).toEqual({
      fromSlug: "open-sollicitatie",
      kind: "live",
      match: "rematch",
      slug: "open-sollicitatie-3629",
      url: "https://www.starapple.nl/vacatures/open-sollicitatie-3629/",
    });
  });

  it("keeps closed rows on the archive redirect even when the slug is live", async () => {
    const index = await loadLiveIndex();
    const resolution = resolveStarappleBronTarget(
      starappleJob({
        external_id: "devops-platform-engineer",
        status: "closed",
      }),
      index
    );
    expect(resolution).toEqual({
      fromSlug: "devops-platform-engineer",
      kind: "archive",
      reason: "closed",
      url: "https://web.archive.org/web/https://www.starapple.nl/vacatures/devops-platform-engineer/",
    });
  });

  it("reports unknown when no slug can be derived", async () => {
    const index = await loadLiveIndex();
    expect(
      resolveStarappleBronTarget(
        starappleJob({ external_id: " ", external_url: null }),
        index
      )
    ).toEqual({ kind: "unknown" });
  });
});

describe("resolveStarappleBronTarget edge cases on synthetic indices", () => {
  it("rematches a stale numbered slug when its whole live family is one slug", () => {
    const index = liveIndexFromSlugs(["devops-engineer-linux"]);
    expect(
      resolveStarappleBronTarget(
        starappleJob({
          external_id: "devops-engineer-linux-44",
          title: "DevOps Engineer Linux",
        }),
        index
      )
    ).toMatchObject({
      kind: "live",
      match: "rematch",
      slug: "devops-engineer-linux",
    });
  });

  it("refuses a rematch when two live slugs share the base", () => {
    const index = liveIndexFromSlugs([
      "devops-platform-engineer",
      "devops-platform-engineer-2",
    ]);
    expect(
      resolveStarappleBronTarget(
        starappleJob({
          external_id: "devops-platform-engineer-33",
          title: "DevOps Platform Engineer",
        }),
        index
      )
    ).toMatchObject({ kind: "archive", reason: "unresolvable" });
  });

  it("does not treat a shared non-numeric prefix as a sibling repost", () => {
    // `devops-engineer-linux` shares the `devops-engineer` stem but is not a
    // `devops-engineer-<n>` repost, so a lone `devops-engineer-2` stays a
    // single unambiguous match for derived `devops-engineer`.
    const index = liveIndexFromSlugs([
      "devops-engineer-2",
      "devops-engineer-linux",
    ]);
    expect(
      resolveStarappleBronTarget(
        starappleJob({ external_id: "devops-engineer", title: "Other" }),
        index
      )
    ).toMatchObject({
      kind: "live",
      match: "rematch",
      slug: "devops-engineer-2",
    });
  });
});

describe("resolveMotianBronUrl with a live index", () => {
  it("returns the rematched live URL through the mapping entry point", () => {
    const index = liveIndexFromSlugs(["open-sollicitatie-3629"]);
    expect(
      resolveMotianBronUrl(
        starappleJob({ external_id: "open-sollicitatie" }),
        index
      )
    ).toBe("https://www.starapple.nl/vacatures/open-sollicitatie-3629/");
  });

  it("returns the archive URL for an unresolvable open slug", () => {
    const index = liveIndexFromSlugs(["something-else"]);
    expect(
      resolveMotianBronUrl(
        starappleJob({ external_id: "next-gen-engineers" }),
        index
      )
    ).toBe(
      "https://web.archive.org/web/https://www.starapple.nl/vacatures/next-gen-engineers/"
    );
  });

  it("leaves non-Starapple platforms untouched even with an index", () => {
    const index = liveIndexFromSlugs(["open-sollicitatie-3629"]);
    expect(
      resolveMotianBronUrl(
        {
          ...starappleJob(),
          external_url: " https://example.com/jobs/original ",
          platform: "nationalevacaturebank",
        },
        index
      )
    ).toBe("https://example.com/jobs/original");
  });
});

describe("isMotianJobClosed", () => {
  it("matches the Neon lifecycle signals", () => {
    expect(isMotianJobClosed(starappleJob({ status: null }))).toBe(false);
    expect(isMotianJobClosed(starappleJob({ status: "paused" }))).toBe(true);
    expect(
      isMotianJobClosed(starappleJob({ deleted_at: "2026-09-01T12:00:00Z" }))
    ).toBe(true);
  });
});
