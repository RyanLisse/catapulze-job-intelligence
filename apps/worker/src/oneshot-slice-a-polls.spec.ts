import { describe, expect, it } from "bun:test";

import type { BronId } from "@ji/domain";

import {
  buildPollPayload,
  formatOneshotList,
  parseOneshotArgs,
  selectOneshotTargets,
  sliceARegistryCount,
} from "./oneshot-slice-a-polls";
import type { SliceABronDefinition } from "./slice-a-bronnen";

const bron = (
  slug: SliceABronDefinition["bronSlug"],
  id: string
): SliceABronDefinition => ({
  // SAFETY: test fixture UUIDs only.
  bronId: id as BronId,
  bronSlug: slug,
  naam: slug,
});

const pollableFixture: SliceABronDefinition[] = [
  bron("tenderned", "11111111-1111-1111-1111-111111111111"),
  bron("inhuurdesk", "22222222-2222-2222-2222-222222222222"),
];

describe("parseOneshotArgs", () => {
  it("defaults to list / dry-run with no fan-out filter", () => {
    expect(parseOneshotArgs([])).toEqual({
      bronSlug: null,
      limit: null,
      mode: "list",
    });
    expect(parseOneshotArgs(["--dry-run"])).toEqual({
      bronSlug: null,
      limit: null,
      mode: "list",
    });
    expect(parseOneshotArgs(["--list"])).toEqual({
      bronSlug: null,
      limit: null,
      mode: "list",
    });
  });

  it("requires --run for execute mode and accepts --bron / --limit", () => {
    expect(
      parseOneshotArgs(["--run", "--bron", "tenderned", "--limit", "1"])
    ).toEqual({
      bronSlug: "tenderned",
      limit: 1,
      mode: "run",
    });
    expect(parseOneshotArgs(["--run", "--bron", "all"])).toEqual({
      bronSlug: null,
      limit: null,
      mode: "run",
    });
  });

  it("rejects unknown flags and invalid limits", () => {
    expect(() => parseOneshotArgs(["--explode"])).toThrow(/Usage:/u);
    expect(() => parseOneshotArgs(["--limit", "0"])).toThrow(
      /positive integer/u
    );
    expect(() => parseOneshotArgs(["--bron", "not-a-bron"])).toThrow(/Usage:/u);
  });
});

describe("selectOneshotTargets", () => {
  it("fans out to all pollable by default and filters by slug / limit", () => {
    expect(
      selectOneshotTargets(pollableFixture, {
        bronSlug: null,
        limit: null,
        mode: "list",
      })
    ).toHaveLength(2);
    expect(
      selectOneshotTargets(pollableFixture, {
        bronSlug: "tenderned",
        limit: null,
        mode: "run",
      }).map((row) => row.bronSlug)
    ).toEqual(["tenderned"]);
    expect(
      selectOneshotTargets(pollableFixture, {
        bronSlug: null,
        limit: 1,
        mode: "run",
      })
    ).toHaveLength(1);
  });

  it("returns empty when an explicit slug is not pollable (no seed)", () => {
    const [onlyTenderned] = pollableFixture;
    expect(onlyTenderned).toBeDefined();
    expect(
      selectOneshotTargets(onlyTenderned ? [onlyTenderned] : [], {
        bronSlug: "inhuurdesk",
        limit: null,
        mode: "run",
      })
    ).toEqual([]);
  });
});

describe("formatOneshotList / buildPollPayload", () => {
  it("shapes list output and builds a poll-bron payload", () => {
    const [first] = pollableFixture;
    expect(first).toBeDefined();
    if (!first) {
      expect.unreachable();
    }
    const listed = formatOneshotList(pollableFixture, [first]);
    expect(listed).toEqual({
      mode: "list",
      pollable: 2,
      targets: [
        {
          bronId: "11111111-1111-1111-1111-111111111111",
          bronSlug: "tenderned",
          naam: "tenderned",
        },
      ],
    });
    const payload = buildPollPayload(
      first,
      "33333333-3333-3333-3333-333333333333"
    );
    expect(payload).toEqual({
      bronId: "11111111-1111-1111-1111-111111111111",
      bronSlug: "tenderned",
      scrapeRunId: "33333333-3333-3333-3333-333333333333",
    });
  });
});

describe("slice-a-pollable / schedule contract (CTP-488)", () => {
  it("keeps schedule-slice-a-polls on the shared listPollable helper", async () => {
    const source = await Bun.file(
      new URL("tasks/schedule-slice-a-polls.ts", import.meta.url)
    ).text();
    expect(source).toContain('id: "schedule-slice-a-polls"');
    expect(source).toContain("listPollableSliceABronnen");
    expect(source).toContain('pattern: "*/15 * * * *"');
    expect(sliceARegistryCount()).toBeGreaterThan(0);
  });

  it("documents oneshot CLI as offline runPollBron wrapper", async () => {
    const source = await Bun.file(
      new URL("../scripts/oneshot-slice-a-polls.ts", import.meta.url)
    ).text();
    expect(source).toContain("runBronIngestPipeline");
    expect(source).toContain("runPollBronOnce");
    expect(source.includes('from "@trigger.dev/sdk"')).toBe(false);
  });
});
