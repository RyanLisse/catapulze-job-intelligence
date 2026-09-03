import { describe, expect, it } from "bun:test";

import { z } from "zod";

// `@ji/env/web` validates process.env at import time and Bun caches modules
// per process, so each scenario loads the module in a fresh subprocess with
// exactly the variables under test. This exercises the real createEnv
// contract (server scope, emptyStringAsUndefined, z.url()) rather than the
// resolver in isolation — see internal-server-url.spec.ts for that.

const PUBLIC_URL = "http://localhost:3000";
const INTERNAL_URL = "http://server:3000";
const WEB_ENV_MODULE = `${import.meta.dir}/web.ts`;

const PROBE_SCRIPT = `
const { env, getInternalServerUrl } = await import(${JSON.stringify(WEB_ENV_MODULE)});
console.log(JSON.stringify({
  internal: getInternalServerUrl(),
  publicUrl: env.NEXT_PUBLIC_SERVER_URL,
}));
`;

interface ProbeResult {
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
}

const loadWebEnv = (variables: Record<string, string>): ProbeResult => {
  const result = Bun.spawnSync({
    cmd: ["bun", "-e", PROBE_SCRIPT],
    cwd: import.meta.dir,
    // Deliberately not inheriting process.env: the parent shell may itself
    // carry INTERNAL_SERVER_URL, which would silently mask the fallback case.
    env: {
      HOME: process.env.HOME ?? "",
      PATH: process.env.PATH ?? "",
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

const probeOutputSchema = z.object({
  internal: z.string(),
  publicUrl: z.string(),
});

const parseProbe = (result: ProbeResult): z.infer<typeof probeOutputSchema> => {
  expect(result.exitCode).toBe(0);
  return probeOutputSchema.parse(JSON.parse(result.stdout.trim()));
};

describe("@ji/env/web INTERNAL_SERVER_URL", () => {
  it("uses INTERNAL_SERVER_URL for server-side fetches when set", () => {
    const probe = parseProbe(
      loadWebEnv({
        INTERNAL_SERVER_URL: INTERNAL_URL,
        NEXT_PUBLIC_SERVER_URL: PUBLIC_URL,
      })
    );
    expect(probe.internal).toBe(INTERNAL_URL);
    expect(probe.publicUrl).toBe(PUBLIC_URL);
  });

  it("defaults to NEXT_PUBLIC_SERVER_URL when INTERNAL_SERVER_URL is absent", () => {
    const probe = parseProbe(
      loadWebEnv({ NEXT_PUBLIC_SERVER_URL: PUBLIC_URL })
    );
    expect(probe.internal).toBe(PUBLIC_URL);
  });

  it("treats an empty INTERNAL_SERVER_URL as absent (emptyStringAsUndefined)", () => {
    const probe = parseProbe(
      loadWebEnv({
        INTERNAL_SERVER_URL: "",
        NEXT_PUBLIC_SERVER_URL: PUBLIC_URL,
      })
    );
    expect(probe.internal).toBe(PUBLIC_URL);
  });

  it("rejects an INTERNAL_SERVER_URL without an http(s) scheme", () => {
    // "server:3000" parses as a URL with scheme "server" — the realistic typo.
    const result = loadWebEnv({
      INTERNAL_SERVER_URL: "server:3000",
      NEXT_PUBLIC_SERVER_URL: PUBLIC_URL,
    });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("INTERNAL_SERVER_URL");
  });
});
