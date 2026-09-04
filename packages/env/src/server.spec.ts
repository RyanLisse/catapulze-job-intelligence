import { describe, expect, it } from "bun:test";

import { z } from "zod";

// `@ji/env/server` validates process.env at import time and Bun caches
// modules per process, so each scenario loads the module in a fresh
// subprocess with exactly the variables under test (same approach as
// web.spec.ts). This exercises the real createEnv contract: the
// APP_RELEASE_SHA-else-SOURCE_COMMIT resolution inside runtimeEnv (an empty
// string counts as unset), the SHA regex, and the startup failure message.

const APP_SHA = "0123456789abcdef0123456789abcdef01234567";
const SOURCE_SHA = "fedcba9876543210fedcba9876543210fedcba98";
const SERVER_ENV_MODULE = `${import.meta.dir}/server.ts`;

const PROBE_SCRIPT = `
const { env } = await import(${JSON.stringify(SERVER_ENV_MODULE)});
console.log(JSON.stringify({ releaseSha: env.APP_RELEASE_SHA ?? null }));
`;

// Minimum the schema needs to boot; unrelated to the release SHA.
const REQUIRED_SERVER_ENV = {
  BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret-1234",
  BETTER_AUTH_URL: "http://localhost:3000",
  CORS_ORIGIN: "http://localhost:3001",
  DATABASE_URL: "postgres://user:pass@localhost:5432/ji_test",
};

interface ProbeResult {
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
}

const loadServerEnv = (variables: Record<string, string>): ProbeResult => {
  const result = Bun.spawnSync({
    cmd: ["bun", "-e", PROBE_SCRIPT],
    cwd: import.meta.dir,
    // Deliberately not inheriting process.env: the parent shell (or Coolify)
    // may itself carry SOURCE_COMMIT, which would mask the cases below.
    env: {
      HOME: process.env.HOME ?? "",
      PATH: process.env.PATH ?? "",
      ...REQUIRED_SERVER_ENV,
      ...variables,
    },
    stderr: "pipe",
    stdout: "pipe",
  });
  return {
    exitCode: result.exitCode,
    stderr: result.stderr.toString(),
    stdout: result.stdout.toString(),
  };
};

const probeOutputSchema = z.object({ releaseSha: z.string().nullable() });

const releaseShaOf = (result: ProbeResult): string | null => {
  expect(result.exitCode).toBe(0);
  // Last line: dotenv may print an injection tip line above the probe JSON.
  const lastLine = result.stdout.trim().split("\n").at(-1) ?? "";
  return probeOutputSchema.parse(JSON.parse(lastLine)).releaseSha;
};

describe("@ji/env/server APP_RELEASE_SHA", () => {
  it("resolves the release SHA from Coolify's SOURCE_COMMIT when APP_RELEASE_SHA is unset", () => {
    expect(releaseShaOf(loadServerEnv({ SOURCE_COMMIT: SOURCE_SHA }))).toBe(
      SOURCE_SHA
    );
  });

  it("treats an empty APP_RELEASE_SHA as unset and still uses SOURCE_COMMIT", () => {
    // docker-compose passes `APP_RELEASE_SHA: ${APP_RELEASE_SHA:-}`, i.e. "".
    expect(
      releaseShaOf(
        loadServerEnv({ APP_RELEASE_SHA: "", SOURCE_COMMIT: SOURCE_SHA })
      )
    ).toBe(SOURCE_SHA);
  });

  it("prefers APP_RELEASE_SHA over SOURCE_COMMIT when both are set", () => {
    expect(
      releaseShaOf(
        loadServerEnv({ APP_RELEASE_SHA: APP_SHA, SOURCE_COMMIT: SOURCE_SHA })
      )
    ).toBe(APP_SHA);
  });

  it("refuses to start on a non-SHA APP_RELEASE_SHA and names both variables", () => {
    // The 2026-09-04 production symptom: an operator-managed value drifted to
    // a non-SHA string; a valid SOURCE_COMMIT must not silently paper over it.
    const result = loadServerEnv({
      APP_RELEASE_SHA: "main",
      SOURCE_COMMIT: SOURCE_SHA,
    });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("Invalid environment variables");
    expect(result.stderr).toContain("APP_RELEASE_SHA");
    expect(result.stderr).toContain("SOURCE_COMMIT");
  });

  it("boots without a release SHA when neither variable is set (/version answers 503)", () => {
    expect(releaseShaOf(loadServerEnv({}))).toBeNull();
  });
});
