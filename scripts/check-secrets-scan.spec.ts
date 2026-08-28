import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

import { collectSecretViolations } from "./check-secrets-scan";

const repoRoot = path.join(import.meta.dir, "..");

describe("check-secrets-scan", () => {
  it("catches a clearly fake AWS access key", () => {
    const fake = ["AKIA", "IOSFODNN7EXAMPLE"].join("");
    expect(
      collectSecretViolations("fixture.ts", `const k = "${fake}";`)
    ).toEqual([`fixture.ts looks like an AWS access key (${fake})`]);
  });

  it("does not treat .env.example placeholders as secrets", () => {
    const serverExample = readFileSync(
      path.join(repoRoot, "apps/server/.env.example"),
      "utf-8"
    );
    const webExample = readFileSync(
      path.join(repoRoot, "apps/web/.env.example"),
      "utf-8"
    );
    expect(
      collectSecretViolations("apps/server/.env.example", serverExample)
    ).toEqual([]);
    expect(
      collectSecretViolations("apps/web/.env.example", webExample)
    ).toEqual([]);
    expect(serverExample).toMatch(/^DATABASE_URL=/mu);
    expect(serverExample).not.toMatch(/AKIA[0-9A-Z]{16}/u);
    expect(webExample).toMatch(/^NEXT_PUBLIC_SERVER_URL=/mu);
  });
});
