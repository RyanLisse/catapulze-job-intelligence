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

const createLauncherFixture = (
  sourceShaValue = sourceSha,
  statusExitCode = 0
) => {
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
  "rev-parse --verify HEAD") printf '%s\\n' "${sourceShaValue}" ;;
  "status --porcelain=v1 --untracked-files=all") exit ${statusExitCode} ;;
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
          CRABBOX_EXE_DEV_CONTROL_HOST: "exe.dev",
          EXE_DEV_REGION: "FRA",
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
            CRABBOX_EXE_DEV_CONTROL_HOST: "exe.dev",
            EXE_DEV_REGION: "FRA",
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

  test("requires explicit approval for the configured control host", () => {
    for (const controlHost of [undefined, "example.invalid"]) {
      const fixture = createLauncherFixture();
      try {
        const environment = {
          ...process.env,
          CAPTURE_ARGUMENTS: fixture.argumentsFile,
          CAPTURE_ENVIRONMENT: fixture.environmentFile,
          CRABBOX_EXE_DEV_CONTROL_HOST: controlHost,
          EXE_DEV_REGION: "FRA",
          PATH: `${fixture.binDirectory}:${process.env.PATH ?? "/usr/bin:/bin"}`,
        };
        if (controlHost === undefined) {
          delete environment.CRABBOX_EXE_DEV_CONTROL_HOST;
        }

        const result = Bun.spawnSync(["bash", launcher, "--dry-run"], {
          env: environment,
          stderr: "pipe",
          stdout: "pipe",
        });

        expect(result.exitCode).not.toBe(0);
        expect(result.stderr.toString()).toContain(
          "set CRABBOX_EXE_DEV_CONTROL_HOST=exe.dev"
        );
        expect(() => readFileSync(fixture.argumentsFile)).toThrow();
      } finally {
        rmSync(fixture.workspace, { force: true, recursive: true });
      }
    }
  });

  test("requires the configured region before invoking Crabbox", () => {
    for (const region of [undefined, "AMS"]) {
      const fixture = createLauncherFixture();
      try {
        const environment = {
          ...process.env,
          CAPTURE_ARGUMENTS: fixture.argumentsFile,
          CAPTURE_ENVIRONMENT: fixture.environmentFile,
          CRABBOX_EXE_DEV_CONTROL_HOST: "exe.dev",
          EXE_DEV_REGION: region,
          PATH: `${fixture.binDirectory}:${process.env.PATH ?? "/usr/bin:/bin"}`,
        };
        if (region === undefined) {
          delete environment.EXE_DEV_REGION;
        }

        const result = Bun.spawnSync(["bash", launcher, "--dry-run"], {
          env: environment,
          stderr: "pipe",
          stdout: "pipe",
        });

        expect(result.exitCode).not.toBe(0);
        expect(result.stderr.toString()).toContain("set EXE_DEV_REGION=FRA");
        expect(() => readFileSync(fixture.argumentsFile)).toThrow();
      } finally {
        rmSync(fixture.workspace, { force: true, recursive: true });
      }
    }
  });

  test("accepts SHA-256 object ids and exports their complete value", () => {
    const sha256ObjectId = "b".repeat(64);
    const fixture = createLauncherFixture(sha256ObjectId);
    try {
      const result = Bun.spawnSync(["bash", launcher, "--dry-run"], {
        env: {
          ...process.env,
          CAPTURE_ARGUMENTS: fixture.argumentsFile,
          CAPTURE_ENVIRONMENT: fixture.environmentFile,
          CRABBOX_EXE_DEV_CONTROL_HOST: "exe.dev",
          EXE_DEV_REGION: "FRA",
          PATH: `${fixture.binDirectory}:${process.env.PATH ?? "/usr/bin:/bin"}`,
        },
        stderr: "pipe",
        stdout: "pipe",
      });

      expect(result.exitCode).toBe(0);
      expect(readFileSync(fixture.environmentFile, "utf-8")).toBe(
        `${sha256ObjectId}\nclean\n`
      );
    } finally {
      rmSync(fixture.workspace, { force: true, recursive: true });
    }
  });

  test("fails closed when Git status cannot determine source state", () => {
    const fixture = createLauncherFixture(sourceSha, 70);
    try {
      const result = Bun.spawnSync(["bash", launcher, "--dry-run"], {
        env: {
          ...process.env,
          CAPTURE_ARGUMENTS: fixture.argumentsFile,
          CAPTURE_ENVIRONMENT: fixture.environmentFile,
          CRABBOX_EXE_DEV_CONTROL_HOST: "exe.dev",
          EXE_DEV_REGION: "FRA",
          PATH: `${fixture.binDirectory}:${process.env.PATH ?? "/usr/bin:/bin"}`,
        },
        stderr: "pipe",
        stdout: "pipe",
      });

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr.toString()).toContain(
        "could not determine the source Git state"
      );
      expect(() => readFileSync(fixture.argumentsFile)).toThrow();
    } finally {
      rmSync(fixture.workspace, { force: true, recursive: true });
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

  test("clears inherited database requirements from the unit phase", () => {
    const workspace = mkdtempSync(path.join(tmpdir(), "ji-shadow-unit-"));
    const binDirectory = path.join(workspace, "bin");
    const captureFile = path.join(workspace, "unit-environment");
    mkdirSync(binDirectory);
    createExecutable(
      path.join(binDirectory, "bun"),
      `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "\${DATABASE_URL-unset}" "\${DATABASE_TEST_URL-unset}" "\${DATABASE_APP_TEST_URL-unset}" "\${MIGRATION_DATABASE_URL-unset}" "\${REQUIRE_DATABASE_TESTS-unset}" >"$CAPTURE_FILE"
`
    );

    try {
      const result = Bun.spawnSync(
        ["bash", "-c", 'source "$SHADOW_SCRIPT"; run_unit_suite'],
        {
          cwd: workspace,
          env: {
            ...process.env,
            CAPTURE_FILE: captureFile,
            DATABASE_APP_TEST_URL: "inherited",
            DATABASE_TEST_URL: "inherited",
            DATABASE_URL: "inherited",
            MIGRATION_DATABASE_URL: "inherited",
            PATH: `${binDirectory}:${process.env.PATH ?? "/usr/bin:/bin"}`,
            REQUIRE_DATABASE_TESTS: "1",
            SHADOW_SCRIPT: shadowScript,
          },
          stderr: "pipe",
          stdout: "pipe",
        }
      );

      expect(result.stderr.toString()).toBe("");
      expect(result.exitCode).toBe(0);
      expect(readFileSync(captureFile, "utf-8")).toBe(
        "unset\nunset\nunset\nunset\nunset\n"
      );
    } finally {
      rmSync(workspace, { force: true, recursive: true });
    }
  });

  test("accepts both Git object formats in remote fingerprints", () => {
    const result = Bun.spawnSync(
      [
        "bash",
        "-c",
        'source "$SHADOW_SCRIPT"; is_valid_git_oid "$(printf a%.0s {1..40})"; is_valid_git_oid "$(printf b%.0s {1..64})"; ! is_valid_git_oid "$(printf c%.0s {1..63})"',
      ],
      {
        env: { ...process.env, SHADOW_SCRIPT: shadowScript },
        stderr: "pipe",
        stdout: "pipe",
      }
    );

    expect(result.stderr.toString()).toBe("");
    expect(result.exitCode).toBe(0);
  });

  test("records the effective Crabbox profile", () => {
    const result = Bun.spawnSync(
      ["bash", "-c", 'source "$SHADOW_SCRIPT"; printf "%s\\n" "$PROFILE"'],
      {
        env: { ...process.env, SHADOW_SCRIPT: shadowScript },
        stderr: "pipe",
        stdout: "pipe",
      }
    );

    expect(result.stderr.toString()).toBe("");
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toBe("exe-dev-shadow\n");
  });

  test("records the configured machine class and observed CPU model", () => {
    const workspace = mkdtempSync(path.join(tmpdir(), "ji-shadow-machine-"));
    const evidenceDirectory = path.join(
      workspace,
      ".artifacts/crabbox/exe-dev-shadow"
    );
    mkdirSync(evidenceDirectory, { recursive: true });
    writeFileSync(path.join(workspace, "bun.lock"), "lockfile");

    try {
      const result = Bun.spawnSync(
        ["bash", "-c", 'source "$SHADOW_SCRIPT"; write_fingerprint'],
        {
          cwd: workspace,
          env: { ...process.env, SHADOW_SCRIPT: shadowScript },
          stderr: "pipe",
          stdout: "pipe",
        }
      );
      const fingerprint = JSON.parse(
        readFileSync(
          path.join(evidenceDirectory, "execution-fingerprint.json"),
          "utf-8"
        )
      );

      expect(result.stderr.toString()).toBe("");
      expect(result.exitCode).toBe(0);
      expect(fingerprint.machine).toBe("4cpu-8gb-40gb");
      expect(fingerprint.cpuModel.length).toBeGreaterThan(0);
    } finally {
      rmSync(workspace, { force: true, recursive: true });
    }
  });

  test("includes imported fixtures in the correctness dataset manifest", () => {
    const workspace = mkdtempSync(path.join(tmpdir(), "ji-shadow-dataset-"));
    const fixturesDirectory = path.join(
      workspace,
      "scripts/ci-metrics/fixtures"
    );
    mkdirSync(fixturesDirectory, { recursive: true });
    writeFileSync(
      path.join(workspace, "scripts/ci-metrics/core.spec.ts"),
      "test"
    );
    writeFileSync(path.join(fixturesDirectory, "jobs.json"), "fixture");

    try {
      const result = Bun.spawnSync(
        ["bash", "-c", 'source "$SHADOW_SCRIPT"; write_dataset_manifest'],
        {
          cwd: workspace,
          env: { ...process.env, SHADOW_SCRIPT: shadowScript },
          stderr: "pipe",
          stdout: "pipe",
        }
      );

      expect(result.stderr.toString()).toBe("");
      expect(result.exitCode).toBe(0);
      expect(result.stdout.toString()).toContain(
        "scripts/ci-metrics/fixtures/jobs.json"
      );
    } finally {
      rmSync(workspace, { force: true, recursive: true });
    }
  });
});
