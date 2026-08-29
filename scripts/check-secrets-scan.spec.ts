import { describe, expect, it } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  collectSecretViolations,
  scanTrackedFiles,
} from "./check-secrets-scan";

const repoRoot = path.join(import.meta.dir, "..");

describe("check-secrets-scan", () => {
  it("catches a clearly fake AWS access key", () => {
    const fake = ["AKIA", "IOSFODNN7EXAMPLE"].join("");
    expect(
      collectSecretViolations("fixture.ts", `const k = "${fake}";`)
    ).toEqual(["fixture.ts looks like an AWS access key"]);
    expect(
      collectSecretViolations("fixture.ts", fake).join("\n")
    ).not.toContain(fake);
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

  it("scans synchronized files when Git metadata is absent", async () => {
    const workspace = mkdtempSync(path.join(tmpdir(), "ji-secret-scan-"));
    const fake = ["AKIA", "IOSFODNN7EXAMPLE"].join("");

    try {
      mkdirSync(path.join(workspace, "src"));
      writeFileSync(
        path.join(workspace, "src/config.ts"),
        `export const key = "${fake}";`
      );

      expect(await scanTrackedFiles(workspace)).toEqual([
        "src/config.ts looks like an AWS access key",
      ]);
    } finally {
      rmSync(workspace, { force: true, recursive: true });
    }
  });

  it("scans files sequentially and fails closed on oversized input", async () => {
    const workspace = mkdtempSync(path.join(tmpdir(), "ji-secret-scan-size-"));

    try {
      writeFileSync(path.join(workspace, "large.txt"), "12345");
      expect(await scanTrackedFiles(workspace, 4)).toEqual([
        "large.txt exceeds the 4-byte secret-scan limit",
      ]);
    } finally {
      rmSync(workspace, { force: true, recursive: true });
    }
  });

  it("ignores inherited repository-local Git bindings", async () => {
    const workspace = mkdtempSync(path.join(tmpdir(), "ji-secret-scan-git-"));
    const fake = ["AKIA", "IOSFODNN7EXAMPLE"].join("");

    try {
      writeFileSync(path.join(workspace, "config.ts"), fake);
      expect(
        await scanTrackedFiles(workspace, undefined, {
          ...process.env,
          GIT_COMMON_DIR: "/invalid/common",
          GIT_DIR: "/invalid/git-dir",
          GIT_INDEX_FILE: "/invalid/index",
          GIT_WORK_TREE: "/invalid/work-tree",
        })
      ).toEqual(["config.ts looks like an AWS access key"]);
    } finally {
      rmSync(workspace, { force: true, recursive: true });
    }
  });
});
