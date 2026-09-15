import { describe, expect, it } from "bun:test";

import { UNKNOWN } from "@ji/domain";

import { isMotianJobClosed, resolveMotianBronUrl } from "./motian-bron-url";
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

describe("isMotianJobClosed", () => {
  it("matches the Neon lifecycle signals", () => {
    expect(isMotianJobClosed(starappleJob({ status: null }))).toBe(false);
    expect(isMotianJobClosed(starappleJob({ status: "paused" }))).toBe(true);
    expect(
      isMotianJobClosed(starappleJob({ deleted_at: "2026-09-01T12:00:00Z" }))
    ).toBe(true);
  });
});
