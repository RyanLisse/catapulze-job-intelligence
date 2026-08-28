import { describe, expect, test } from "bun:test";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const launcher = path.join(import.meta.dir, "crabbox-exe-dev-shadow-run.sh");
const shadowScript = path.join(import.meta.dir, "crabbox-exe-dev-shadow.sh");
const sourceSha = "a".repeat(40);

const createExecutable = (filePath: string, contents: string): void => {
  writeFileSync(filePath, contents);
  chmodSync(filePath, 0o755);
};

const createLauncherFixture = () => {
  const workspace = mkdtempSync(path.join(tmpdir(), "ji-shadow-launcher-"));
  const binDirectory = path.join(workspace, "bin");
  const argumentsFile = path.join(workspace, "arguments");
  const environmentFile = path.join(workspace, "environment");
  mkdirSync(binDirectory);
  createExecutable(
    path.join(binDirectory, "git"),
    `#!/usr/bin/env bash
set -euo pipefail
case "$*" in
  "rev-parse --verify HEAD") printf '%s\\n' "${sourceSha}" ;;
  "status --porcelain=v1 --untracked-files=all") ;;
  *) exit 64 ;;
esac
`
  );
  createExecutable(
    path.join(binDirectory, "crabbox"),
    `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$@" >"$CAPTURE_ARGUMENTS"
printf '%s\\n' "$CRABBOX_SOURCE_GIT_SHA" "$CRABBOX_SOURCE_GIT_STATE" >"$CAPTURE_ENVIRONMENT"
`
  );

  return { argumentsFile, binDirectory, environmentFile, workspace };
};

describe("exe.dev shadow scripts", () => {
  test("forwards ordinary flags with source identity", () => {
    const fixture = createLauncherFixture();
    try {
      const result = Bun.spawnSync(["bash", launcher, "--dry-run"], {
        env: {
          ...process.env,
          CAPTURE_ARGUMENTS: fixture.argumentsFile,
          CAPTURE_ENVIRONMENT: fixture.environmentFile,
          PATH: `${fixture.binDirectory}:${process.env.PATH ?? "/usr/bin:/bin"}`,
        },
        stderr: "pipe",
        stdout: "pipe",
      });

      expect(result.exitCode).toBe(0);
      expect(readFileSync(fixture.argumentsFile, "utf-8")).toBe(
        "job\nrun\n--dry-run\nexe-dev-shadow\n"
      );
      expect(readFileSync(fixture.environmentFile, "utf-8")).toBe(
        `${sourceSha}\nclean\n`
      );
    } finally {
      rmSync(fixture.workspace, { force: true, recursive: true });
    }
  });

  test("rejects every existing-lease id form before invoking Crabbox", () => {
    const forbiddenArguments = [
      ["--id", "lease"],
      ["--id=lease"],
      ["-id", "lease"],
      ["-id=lease"],
    ];

    for (const arguments_ of forbiddenArguments) {
      const fixture = createLauncherFixture();
      try {
        const result = Bun.spawnSync(["bash", launcher, ...arguments_], {
          env: {
            ...process.env,
            CAPTURE_ARGUMENTS: fixture.argumentsFile,
            CAPTURE_ENVIRONMENT: fixture.environmentFile,
            PATH: `${fixture.binDirectory}:${process.env.PATH ?? "/usr/bin:/bin"}`,
          },
          stderr: "pipe",
          stdout: "pipe",
        });

        expect(result.exitCode).not.toBe(0);
        expect(result.stderr.toString()).toContain(
          "existing-lease --id arguments are forbidden"
        );
        expect(() => readFileSync(fixture.argumentsFile)).toThrow();
      } finally {
        rmSync(fixture.workspace, { force: true, recursive: true });
      }
    }
  });

  test("preserves intermediate shell-function failures in a phase", () => {
    const workspace = mkdtempSync(path.join(tmpdir(), "ji-shadow-phase-"));
    try {
      const result = Bun.spawnSync(
        [
          "bash",
          "-c",
          `source "$SHADOW_SCRIPT"
mkdir -p .artifacts/crabbox/exe-dev-shadow
: >.artifacts/crabbox/exe-dev-shadow/phases.jsonl
monotonic_ms() { printf '1000\\n'; }
iso_timestamp() { printf '2026-08-29T00:00:00Z\\n'; }
failing_phase() {
  (exit 23)
  printf 'masked\\n' >continued-after-failure
}
set +e
run_phase "failure-test" "failing_phase" failing_phase
status=$?
set -e
[[ $status -eq 23 ]]
[[ ! -e continued-after-failure ]]
grep -q '"exitStatus":23' .artifacts/crabbox/exe-dev-shadow/phases.jsonl
`,
        ],
        {
          cwd: workspace,
          env: { ...process.env, SHADOW_SCRIPT: shadowScript },
          stderr: "pipe",
          stdout: "pipe",
        }
      );

      expect(result.stderr.toString()).toBe("");
      expect(result.exitCode).toBe(0);
    } finally {
      rmSync(workspace, { force: true, recursive: true });
    }
  });
});
