import { describe, expect, it } from "bun:test";

import { classifyRecoveryCandidate } from "./curate-scrape-run";

const pointer = (input: {
  contentHash: string;
  observedAt?: string;
  rawPayloadRef?: string;
  scrapeRunId: string;
  startedAt: string;
}) => ({
  contentHash: input.contentHash,
  observedAt: input.observedAt ?? input.startedAt,
  phase: "observation" as const,
  rawPayloadRef: input.rawPayloadRef ?? `raw/${input.contentHash}.json`,
  scrapeRunId: input.scrapeRunId,
  startedAt: new Date(input.startedAt),
});

describe("classifyRecoveryCandidate", () => {
  const current = pointer({
    contentHash: "hash-b",
    scrapeRunId: "00000000-0000-4000-8000-000000000002",
    startedAt: "2026-09-02T00:00:00.000Z",
  });

  it("keeps fresh same-content observations on the normal processing path", () => {
    expect(
      classifyRecoveryCandidate({
        candidate: pointer({
          contentHash: "hash-b",
          scrapeRunId: "00000000-0000-4000-8000-000000000003",
          startedAt: "2026-09-03T00:00:00.000Z",
        }),
        current,
        legacyPending: false,
      })
    ).toBe("process");
  });

  it("processes a same-run observation after lifecycle reconciliation", () => {
    expect(
      classifyRecoveryCandidate({
        candidate: pointer({
          contentHash: "hash-c",
          observedAt: "2026-09-02T00:01:00.000Z",
          scrapeRunId: "00000000-0000-4000-8000-000000000002",
          startedAt: "2026-09-02T00:00:00.000Z",
        }),
        current: {
          ...current,
          observedAt: "2026-09-02T00:02:00.000Z",
          phase: "lifecycle",
        },
        legacyPending: false,
      })
    ).toBe("process");
  });

  it("does not let an older observation rewind a newer observation in the same run", () => {
    expect(
      classifyRecoveryCandidate({
        candidate: pointer({
          contentHash: "hash-a",
          observedAt: "2026-09-02T00:01:00.000Z",
          scrapeRunId: "00000000-0000-4000-8000-000000000002",
          startedAt: "2026-09-02T00:00:00.000Z",
        }),
        current: {
          ...current,
          observedAt: "2026-09-02T00:02:00.000Z",
        },
        legacyPending: false,
      })
    ).toBe("superseded");
  });

  it("uses source time rather than a later lifecycle validity floor", () => {
    expect(
      classifyRecoveryCandidate({
        candidate: pointer({
          contentHash: "hash-c",
          observedAt: "2026-09-02T00:01:30.000Z",
          scrapeRunId: "00000000-0000-4000-8000-000000000002",
          startedAt: "2026-09-02T00:00:00.000Z",
        }),
        current: {
          ...current,
          observedAt: "2026-09-02T00:01:00.000Z",
        },
        legacyPending: false,
      })
    ).toBe("process");
  });

  it("marks an exact legacy pointer as already committed without raw readback", () => {
    expect(
      classifyRecoveryCandidate({
        candidate: current,
        current,
        legacyPending: true,
      })
    ).toBe("already_committed");
  });

  it("does not treat an exact lifecycle version as a committed legacy observation", () => {
    expect(
      classifyRecoveryCandidate({
        candidate: current,
        current: { ...current, phase: "lifecycle" },
        legacyPending: true,
      })
    ).toBe("process");
  });

  it("blocks recovery when the durable version phase is ambiguous", () => {
    expect(
      classifyRecoveryCandidate({
        candidate: current,
        current: { ...current, phase: "ambiguous" },
        legacyPending: false,
      })
    ).toBe("blocked_ordering");
  });

  it("reprocesses an exact forward-path tuple while its marker is recoverable", () => {
    expect(
      classifyRecoveryCandidate({
        candidate: current,
        current,
        legacyPending: false,
      })
    ).toBe("process");
  });

  it("marks legacy same-content work unchanged without lifecycle rewrite", () => {
    expect(
      classifyRecoveryCandidate({
        candidate: pointer({
          contentHash: "hash-b",
          scrapeRunId: "00000000-0000-4000-8000-000000000001",
          startedAt: "2026-09-01T00:00:00.000Z",
        }),
        current,
        legacyPending: true,
      })
    ).toBe("unchanged");
  });

  it("supersedes an older A observation when B is already current", () => {
    expect(
      classifyRecoveryCandidate({
        candidate: pointer({
          contentHash: "hash-a",
          scrapeRunId: "00000000-0000-4000-8000-000000000001",
          startedAt: "2026-09-01T00:00:00.000Z",
        }),
        current,
        legacyPending: true,
      })
    ).toBe("superseded");
  });

  it("processes a later A after B so A to B to A is not collapsed", () => {
    expect(
      classifyRecoveryCandidate({
        candidate: pointer({
          contentHash: "hash-a",
          scrapeRunId: "00000000-0000-4000-8000-000000000003",
          startedAt: "2026-09-03T00:00:00.000Z",
        }),
        current,
        legacyPending: true,
      })
    ).toBe("process");
  });

  it("processes the oldest observation when no curated identity exists", () => {
    expect(
      classifyRecoveryCandidate({
        candidate: pointer({
          contentHash: "hash-a",
          scrapeRunId: "00000000-0000-4000-8000-000000000001",
          startedAt: "2026-09-01T00:00:00.000Z",
        }),
        current: null,
        legacyPending: true,
      })
    ).toBe("process");
  });
});
