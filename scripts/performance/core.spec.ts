import { describe, expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  aggregateRecords,
  createCohortDimensions,
  fingerprintCohort,
  fingerprintCommand,
  isGitBound,
  parseMetadata,
  percentile,
  readRecords,
  redactCommand,
  redactEvidenceText,
  renderAggregateMarkdown,
  writeRecord,
} from "./core";
import type { PerformanceRecord } from "./core";

const record = (
  label: string,
  durationMs: number,
  commandExitCode = 0,
  overrides: Partial<PerformanceRecord> = {}
): PerformanceRecord => {
  const command = ["bun", "test"];
  const commandFingerprint = fingerprintCommand(command);
  const runtime = {
    arch: "arm64",
    bun: "1.3.14",
    cpuCount: 8,
    cpuModel: "Test CPU",
    memoryBytes: 1024,
    os: "darwin",
    osRelease: "test",
  };
  const runKind = overrides.runKind ?? "unknown";
  const metadata = overrides.metadata ?? {};
  const cohortDimensions = createCohortDimensions({
    commandFingerprint,
    executor: "test",
    label,
    metadata,
    runKind,
    runtime,
  });
  return {
    attempt: 1,
    cohortDimensions,
    cohortFingerprint: fingerprintCohort(cohortDimensions),
    command,
    commandExitCode,
    commandFingerprint,
    commandStatus: commandExitCode === 0 ? "passed" : "failed",
    durationMs,
    endedAt: "2026-08-28T10:00:01.000Z",
    executor: "test",
    git: { dirty: false, sha: "a".repeat(40) },
    id: crypto.randomUUID(),
    label,
    measurement: {
      boundary: "subprocess-spawn-to-exit",
      kind: "command-wall-clock",
      unit: "milliseconds",
    },
    measurementError: null,
    metadata,
    resources: {
      cpuSystemMicroseconds: null,
      cpuUserMicroseconds: null,
      maxRssBytes: null,
      unsupportedReason: "unsupported by test runtime",
    },
    retryOf: null,
    runKind,
    runtime,
    schemaVersion: 1,
    startedAt: "2026-08-28T10:00:00.000Z",
    wrapperStatus: "complete",
    ...overrides,
  };
};

describe("performance records", () => {
  test("uses nearest-rank percentiles", () => {
    expect(percentile([40, 10, 30, 20], 0.5)).toBe(20);
    expect(percentile([40, 10, 30, 20], 0.95)).toBe(40);
  });

  test("structurally redacts headers, env assignments, flags, and embedded URLs", () => {
    expect(
      redactCommand([
        "curl",
        "-H",
        "Authorization: Bearer abc.def",
        "--header",
        "Cookie: session=private",
        "DATABASE_URL=postgres://user:pass@host/db",
        "--dsn=postgres://admin:pw@db.internal/app",
        "prefix=https://user:pass@example.com/path",
        "https://example.com/run?token=query-secret&mode=fast",
        "Cookie: standalone=private",
        "--token",
        "plain-secret",
        "-u",
        "alice:password",
        "--user=bob:password",
        "--proxy-user",
        "proxy:password",
        "--oauth-token",
        "oauth-secret",
        "--access-token=access-secret",
        "--user-agent",
        "normal-client",
        "--auth-mode=safe",
        "AUTH_MODE=safe",
        "-ualice:compact-secret",
        "-HAuthorization: Basic compact-basic",
        "--proxy-header=Proxy-Authorization: Basic proxy-basic",
        "https://example.com/oauth?access_token=access&oauth_signature=signed&x-amz-signature=aws&mode=fast",
        "AWS_SECRET_ACCESS_KEY=aws-secret",
        "aws-access-key-id=AKIAEXAMPLE",
        "AWS_SESSION_TOKEN=session-token",
        "--aws-access-key-id=AKIAFLAG",
        "--x-amz-credential",
        "signed-credential",
        "X-Amz-Security-Token=query-style-argument",
        "https://example.com/object?X-Amz-Credential=scope%2Frequest&x_amz_security_token=session&X-Goog-Credential=google%2Frequest&safe=visible",
        "AWS_REGION=eu-west-1",
      ])
    ).toEqual([
      "curl",
      "-H",
      "Authorization: [REDACTED]",
      "--header",
      "Cookie: [REDACTED]",
      "DATABASE_URL=[REDACTED]",
      "--dsn=[REDACTED]",
      "prefix=[REDACTED_URL]",
      "[REDACTED_URL]",
      "Cookie: [REDACTED]",
      "--token",
      "[REDACTED]",
      "-u",
      "[REDACTED]",
      "--user=[REDACTED]",
      "--proxy-user",
      "[REDACTED]",
      "--oauth-token",
      "[REDACTED]",
      "--access-token=[REDACTED]",
      "--user-agent",
      "normal-client",
      "--auth-mode=safe",
      "AUTH_MODE=safe",
      "-u[REDACTED]",
      "-HAuthorization: [REDACTED]",
      "--proxy-header=Proxy-Authorization: [REDACTED]",
      "[REDACTED_URL]",
      "AWS_SECRET_ACCESS_KEY=[REDACTED]",
      "aws-access-key-id=[REDACTED]",
      "AWS_SESSION_TOKEN=[REDACTED]",
      "--aws-access-key-id=[REDACTED]",
      "--x-amz-credential",
      "[REDACTED]",
      "X-Amz-Security-Token=[REDACTED]",
      "[REDACTED_URL]",
      "AWS_REGION=eu-west-1",
    ]);
  });

  test("accepts only allowlisted non-secret metadata", () => {
    expect(
      parseMetadata([
        "workflow=ci",
        "suite=tokenized-dataset",
        "provider=https://user:pass@example.com/path?token=private&mode=fast",
        "pipeline=--oauth-token private",
        "sequence-position=2",
        "postgres-image-digest=sha256:abc123",
        "runner=https://example.com?refresh_token=refresh&id_token=id&client_secret=client&signature=signed",
      ])
    ).toEqual({
      pipeline: "--oauth-token [REDACTED]",
      "postgres-image-digest": "sha256:abc123",
      provider: "[REDACTED_URL]",
      runner: "[REDACTED_URL]",
      "sequence-position": "2",
      suite: "tokenized-dataset",
      workflow: "ci",
    });
    expect(() => parseMetadata(["arbitrary=value"])).toThrow("not allowlisted");
    expect(() => parseMetadata(["sequence-position=0"])).toThrow(
      "integer from 1 through 10000"
    );
    expect(() => parseMetadata(["sequence-position=10001"])).toThrow(
      "integer from 1 through 10000"
    );
  });

  test("redacts arbitrary URLs, unknown query parameters, and secrets in paths", () => {
    const evidence = redactEvidenceText(
      "spawn /tmp/token/private-value/tool from https://example.invalid/run?unknown=private-value),; next"
    );

    expect(evidence).toBe(
      "spawn /tmp/token/[REDACTED]/tool from [REDACTED_URL] next"
    );
    expect(evidence).not.toContain("private-value");
    expect(evidence).not.toContain("example.invalid");
  });

  test("rejects unredacted URL tokens during record readback", async () => {
    const directory = await mkdtemp(
      path.join(tmpdir(), "ji-performance-url-readback-")
    );
    try {
      const invalid = record("test", 1);
      invalid.command = [
        "curl",
        "https://example.invalid/run?unknown=private-value),;",
      ];
      invalid.commandFingerprint = fingerprintCommand(invalid.command);
      invalid.cohortDimensions = createCohortDimensions({
        commandFingerprint: invalid.commandFingerprint,
        executor: invalid.executor,
        label: invalid.label,
        metadata: invalid.metadata,
        runKind: invalid.runKind,
        runtime: invalid.runtime,
      });
      invalid.cohortFingerprint = fingerprintCohort(invalid.cohortDimensions);
      await Bun.write(
        path.join(directory, "unredacted-url.json"),
        JSON.stringify(invalid)
      );

      await expect(readRecords(directory)).rejects.toThrow(
        "command contains unredacted credentials"
      );
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  test("accepts only complete Git bindings", () => {
    const sha1 = "a".repeat(40);
    const sha256 = "b".repeat(64);

    expect(isGitBound({ dirty: false, sha: sha1 })).toBe(true);
    expect(isGitBound({ dirty: true, sha: sha256 })).toBe(true);
    for (const sha of [null, "", " ", "abc123", "g".repeat(40)]) {
      expect(isGitBound({ dirty: false, sha })).toBe(false);
    }
    expect(isGitBound({ dirty: null, sha: sha1 })).toBe(false);
  });

  test("readback accepts fully bound or fully unbound Git metadata only", async () => {
    const directory = await mkdtemp(
      path.join(tmpdir(), "ji-performance-git-binding-")
    );
    try {
      const accepted = [
        record("sha1", 1, 0, {
          git: { dirty: false, sha: "a".repeat(40) },
        }),
        record("sha256", 1, 0, {
          git: { dirty: true, sha: "b".repeat(64) },
        }),
        record("unbound", 1, 0, { git: { dirty: null, sha: null } }),
      ];
      await Promise.all(
        accepted.map(async (candidate) => {
          const caseDirectory = path.join(directory, candidate.label);
          await Bun.write(
            path.join(caseDirectory, `${candidate.label}.json`),
            JSON.stringify(candidate)
          );
          await expect(readRecords(caseDirectory)).resolves.toHaveLength(1);
        })
      );

      const rejected = [
        ["empty", "", false],
        ["whitespace", " ", false],
        ["short", "abc123", false],
        ["non-hex", "g".repeat(40), false],
        ["partial-sha", "a".repeat(40), null],
        ["partial-dirty", null, false],
      ] as const;
      await Promise.all(
        rejected.map(async ([name, sha, dirty]) => {
          const caseDirectory = path.join(directory, name);
          await Bun.write(
            path.join(caseDirectory, `${name}.json`),
            JSON.stringify(record(name, 1, 0, { git: { dirty, sha } }))
          );
          await expect(readRecords(caseDirectory)).rejects.toThrow(
            "git must be fully unbound or contain a full SHA-1/SHA-256 and dirty state"
          );
        })
      );
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  test("writes atomic records and validates their runtime shape", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "ji-performance-"));
    try {
      await writeRecord(directory, record("test", 123));
      const files = await readdir(directory);
      expect(files.filter((file) => file.endsWith(".json"))).toHaveLength(1);
      expect(files.filter((file) => file.endsWith(".md"))).toHaveLength(1);
      expect(files.some((file) => file.endsWith(".tmp"))).toBe(false);
      const records = await readRecords(directory);
      expect(records[0]?.durationMs).toBe(123);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  test("fails explicitly on unknown record properties", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "ji-performance-bad-"));
    try {
      await Bun.write(
        path.join(directory, "corrupt.json"),
        JSON.stringify({ ...record("test", 1), unexpected: true })
      );
      await expect(readRecords(directory)).rejects.toThrow(
        "Invalid performance record corrupt.json: record has unknown properties: unexpected"
      );
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  test("fails explicitly when a record fingerprint is corrupted", async () => {
    const directory = await mkdtemp(
      path.join(tmpdir(), "ji-performance-hash-")
    );
    try {
      const corrupted = record("test", 1);
      corrupted.commandFingerprint = "0".repeat(64);
      await Bun.write(
        path.join(directory, "fingerprint.json"),
        JSON.stringify(corrupted)
      );
      await expect(readRecords(directory)).rejects.toThrow(
        "Invalid performance record fingerprint.json: commandFingerprint mismatch"
      );
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  test("rejects cohort dimensions not canonically derived from metadata", async () => {
    const directory = await mkdtemp(
      path.join(tmpdir(), "ji-performance-cohort-tamper-")
    );
    try {
      const tamperedRecords = [
        {
          dimension: "provider" as const,
          metadata: { provider: "github" },
          name: "provider",
          value: "exe-dev",
        },
        {
          dimension: "workloadProfile" as const,
          metadata: { profile: "baseline" },
          name: "profile",
          value: "tampered-profile",
        },
      ];
      await Promise.all(
        tamperedRecords.map(async (tamper) => {
          const invalid = record("test", 1, 0, {
            metadata: tamper.metadata,
          });
          invalid.cohortDimensions = {
            ...invalid.cohortDimensions,
            [tamper.dimension]: tamper.value,
          };
          invalid.cohortFingerprint = fingerprintCohort(
            invalid.cohortDimensions
          );
          const caseDirectory = path.join(directory, tamper.name);
          await Bun.write(
            path.join(caseDirectory, `${tamper.name}.json`),
            JSON.stringify(invalid)
          );
          await expect(readRecords(caseDirectory)).rejects.toThrow(
            "cohortDimensions do not match record identity"
          );
        })
      );
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  test("rejects an empty command consistently with the canonical schema", async () => {
    const directory = await mkdtemp(
      path.join(tmpdir(), "ji-performance-empty-command-")
    );
    try {
      await Bun.write(
        path.join(directory, "empty-command.json"),
        JSON.stringify({ ...record("test", 1), command: [] })
      );
      await expect(readRecords(directory)).rejects.toThrow(
        "command must be a non-empty string array"
      );
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  test("rejects non-integer exit codes and invalid resource counters", async () => {
    const directory = await mkdtemp(
      path.join(tmpdir(), "ji-performance-integer-fields-")
    );
    try {
      const invalidRecords = [
        {
          expected: "commandExitCode must be an integer",
          name: "exit-code",
          override: { commandExitCode: 0.5 },
        },
        {
          expected: "cpuUserMicroseconds must be greater than or equal to 0",
          name: "negative-cpu",
          override: {
            resources: {
              ...record("test", 1).resources,
              cpuUserMicroseconds: -1,
            },
          },
        },
        {
          expected: "cpuSystemMicroseconds must be an integer",
          name: "fractional-cpu",
          override: {
            resources: {
              ...record("test", 1).resources,
              cpuSystemMicroseconds: 1.5,
            },
          },
        },
        {
          expected: "maxRssBytes must be greater than or equal to 0",
          name: "negative-rss",
          override: {
            resources: { ...record("test", 1).resources, maxRssBytes: -1 },
          },
        },
      ];
      await Promise.all(
        invalidRecords.map(async ({ expected, name, override }) => {
          const caseDirectory = path.join(directory, name);
          await Bun.write(
            path.join(caseDirectory, `${name}.json`),
            JSON.stringify({ ...record("test", 1), ...override })
          );
          await expect(readRecords(caseDirectory)).rejects.toThrow(expected);
        })
      );
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  test("rejects non-canonical durations and timestamps when reading records", async () => {
    const directory = await mkdtemp(
      path.join(tmpdir(), "ji-performance-time-")
    );
    try {
      const invalidRecords = [
        ["negative", { durationMs: -1 }, "durationMs must be an integer"],
        ["fractional", { durationMs: 1.5 }, "durationMs must be an integer"],
        ["started", { startedAt: "not-a-date" }, "startedAt must be"],
        [
          "non-canonical",
          { startedAt: "2026-08-28 10:00:00Z" },
          "startedAt must be",
        ],
        [
          "impossible-date",
          { startedAt: "2026-02-30T10:00:00Z" },
          "startedAt must be",
        ],
        ["ended", { endedAt: "2026-99-99T25:61:61Z" }, "endedAt must be"],
      ] as const;
      await Promise.all(
        invalidRecords.map(async ([name, override, expected]) => {
          const caseDirectory = path.join(directory, name);
          const filename = `${name}.json`;
          await Bun.write(
            path.join(caseDirectory, filename),
            JSON.stringify({ ...record("test", 1), ...override })
          );
          await expect(readRecords(caseDirectory)).rejects.toThrow(expected);
        })
      );

      const reversedDirectory = path.join(directory, "reversed");
      await Bun.write(
        path.join(reversedDirectory, "reversed.json"),
        JSON.stringify({
          ...record("test", 1),
          endedAt: "2026-08-28T09:59:59.999Z",
        })
      );
      await expect(readRecords(reversedDirectory)).rejects.toThrow(
        "endedAt must not be earlier than startedAt"
      );
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  test("excludes failed samples from percentiles and separates cohorts", () => {
    const warm = record("test", 100, 0, { runKind: "warm" });
    const failed = record("test", 900, 1);
    const cold = record("test", 200, 0, { runKind: "cold" });
    const unknown = record("test", 300);
    const rows = aggregateRecords([warm, failed, cold, unknown]);
    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.p50Ms).toSorted()).toEqual([100, 200, 300]);
    expect(rows.find((row) => row.cohort.includes("unknown"))?.samples).toBe(2);
    expect(rows.reduce((total, row) => total + row.failed, 0)).toBe(1);
    expect(renderAggregateMarkdown([warm, failed])).toContain("low N");
  });

  test("excludes git-unbound records from aggregate evidence", () => {
    const comparable = record("test", 100);
    const missingSha = record("test", 200, 0, {
      git: { dirty: false, sha: null },
    });
    const unknownDirtyState = record("test", 300, 0, {
      git: { dirty: null, sha: "abc123" },
    });

    const rows = aggregateRecords([comparable, missingSha, unknownDirtyState]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ p50Ms: 100, passed: 1, samples: 1 });
    const report = renderAggregateMarkdown([
      comparable,
      missingSha,
      unknownDirtyState,
    ]);
    expect(report).toContain("Excluded as non-comparable:** 2 record(s)");
    expect(report).toContain("durations (not end-to-end wall-clock):** 100 ms");
  });

  test("includes the Postgres image digest but not sequence position in cohort identity", () => {
    const first = record("test", 100, 0, {
      metadata: {
        "postgres-image-digest": "sha256:first",
        "sequence-position": "1",
      },
    });
    const second = record("test", 100, 0, {
      metadata: {
        "postgres-image-digest": "sha256:first",
        "sequence-position": "2",
      },
    });
    const otherImage = record("test", 100, 0, {
      metadata: { "postgres-image-digest": "sha256:second" },
    });
    expect(first.cohortFingerprint).toBe(second.cohortFingerprint);
    expect(first.cohortFingerprint).not.toBe(otherImage.cohortFingerprint);
  });

  test("keeps observed machine resources in cohort identity with a machine label", () => {
    const baseline = record("test", 100, 0, {
      metadata: { machine: "performance-large" },
    });
    const changedRuntime = {
      ...baseline.runtime,
      cpuCount: baseline.runtime.cpuCount + 1,
      memoryBytes: baseline.runtime.memoryBytes + 1,
      osRelease: "changed-release",
    };
    const cohortDimensions = createCohortDimensions({
      commandFingerprint: baseline.commandFingerprint,
      executor: baseline.executor,
      label: baseline.label,
      metadata: baseline.metadata,
      runKind: baseline.runKind,
      runtime: changedRuntime,
    });

    expect(baseline.cohortDimensions).toMatchObject({
      cpuCount: 8,
      machine: "performance-large",
      memoryBytes: 1024,
      osRelease: "test",
      version: 2,
    });
    expect(fingerprintCohort(cohortDimensions)).not.toBe(
      baseline.cohortFingerprint
    );
  });

  test("keeps generated test results out of Git status", () => {
    const result = Bun.spawnSync(
      ["git", "check-ignore", "-q", ".artifacts/test-results/example.xml"],
      { stderr: "ignore", stdout: "ignore" }
    );
    expect(result.exitCode).toBe(0);
  });

  test("keeps branch and observed SHA outside canonical cohort identity", () => {
    const first = record("test", 100, 0, {
      git: { dirty: false, sha: "first" },
      metadata: { branch: "main" },
    });
    const second = record("test", 100, 0, {
      git: { dirty: true, sha: "second" },
      metadata: { branch: "feature" },
    });
    expect(first.cohortFingerprint).toBe(second.cohortFingerprint);
  });
});
