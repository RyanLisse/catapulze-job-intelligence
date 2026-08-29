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
const nodeImage =
  "node:24-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e";

const createExecutable = (filePath: string, contents: string): void => {
  writeFileSync(filePath, contents);
  chmodSync(filePath, 0o755);
};

const createLauncherFixture = (
  sourceShaValue = sourceSha,
  statusExitCode = 0,
  statusOutput = ""
) => {
  const workspace = mkdtempSync(path.join(tmpdir(), "ji-shadow-launcher-"));
  const binDirectory = path.join(workspace, "bin");
  const argumentsFile = path.join(workspace, "arguments");
  const environmentFile = path.join(workspace, "environment");
  const materializedWorkspaceFile = path.join(
    workspace,
    "materialized-workspace"
  );
  mkdirSync(binDirectory);
  mkdirSync(path.join(workspace, "scripts"));
  writeFileSync(
    path.join(workspace, "scripts/check-secrets-scan.ts"),
    `const arguments_ = process.argv.slice(2);
const manifestIndex = arguments_.indexOf("--write-manifest");
const manifestPath = arguments_[manifestIndex + 1];
await Bun.write(manifestPath, "${"b".repeat(64)}  scripts/check-secrets-scan.ts\\n");
`
  );
  createExecutable(
    path.join(binDirectory, "git"),
    `#!/usr/bin/env bash
set -euo pipefail
for variable in GIT_ALTERNATE_OBJECT_DIRECTORIES GIT_COMMON_DIR GIT_CONFIG GIT_CONFIG_COUNT GIT_CONFIG_PARAMETERS GIT_DIR GIT_GRAFT_FILE GIT_IMPLICIT_WORK_TREE GIT_INDEX_FILE GIT_NO_REPLACE_OBJECTS GIT_OBJECT_DIRECTORY GIT_PREFIX GIT_REPLACE_REF_BASE GIT_SHALLOW_FILE GIT_WORK_TREE; do
  [[ -z "\${!variable+x}" ]] || exit 65
done
expected_workspace_root="\${EXPECTED_WORKSPACE_ROOT:-$PWD}"
if [[ "$#" -eq 2 && "$1" == "rev-parse" && "$2" == "--show-toplevel" ]]; then
  printf '%s\\n' "$expected_workspace_root"
elif [[ "$#" -eq 5 && "$1" == "-C" && "$2" == "$expected_workspace_root" && "$3" == "rev-parse" && "$4" == "--verify" && "$5" == "HEAD" ]]; then
  printf '%s\\n' "${sourceShaValue}"
elif [[ "$#" -eq 5 && "$1" == "-C" && "$2" == "$expected_workspace_root" && "$3" == "status" && "$4" == "--porcelain=v1" && "$5" == "--untracked-files=all" ]]; then
  printf '%s' '${statusOutput}'
  exit ${statusExitCode}
elif [[ "$#" -eq 6 && "$1" == "-C" && "$2" == "$expected_workspace_root" && "$3" == "archive" && "$4" == "--format=tar" && "$5" == --output=* && "$6" == "${sourceShaValue}" ]]; then
  output="\${5#--output=}"
  /usr/bin/tar -cf "$output" -C "$expected_workspace_root" scripts
else
  exit 64
fi
`
  );
  createExecutable(
    path.join(binDirectory, "crabbox"),
    `#!/usr/bin/env bash
set -euo pipefail
if [[ "$#" -eq 1 && "$1" == "--version" ]]; then
  printf '%s\\n' "\${CRABBOX_VERSION_OUTPUT:-0.46.0}"
  exit 0
fi
printf '%s\\n' "$@" >"$CAPTURE_ARGUMENTS"
printf '%s\\n' "$CRABBOX_SOURCE_GIT_SHA" "$CRABBOX_SOURCE_GIT_STATE" >"$CAPTURE_ENVIRONMENT"
printf '%s\\n' "$PWD" >"$CAPTURE_MATERIALIZED_WORKSPACE"
printf '%s\\n' "$CRABBOX_SOURCE_MANIFEST_SHA256" "$CRABBOX_SOURCE_MANIFEST_FILE_COUNT" "$CRABBOX_SOURCE_MATERIALIZATION_DURATION_MS" "$CRABBOX_SOURCE_PREFLIGHT_DURATION_MS" >>"$CAPTURE_ENVIRONMENT"
`
  );

  return {
    argumentsFile,
    binDirectory,
    environmentFile,
    materializedWorkspaceFile,
    workspace,
  };
};

const launcherEnvironment = (
  fixture: ReturnType<typeof createLauncherFixture>
) => ({
  ...process.env,
  CAPTURE_ARGUMENTS: fixture.argumentsFile,
  CAPTURE_ENVIRONMENT: fixture.environmentFile,
  CAPTURE_MATERIALIZED_WORKSPACE: fixture.materializedWorkspaceFile,
  CRABBOX_EXE_DEV_CONTROL_HOST: "exe.dev",
  EXE_DEV_REGION: "FRA",
  EXPECTED_WORKSPACE_ROOT: fixture.workspace,
  PATH: `${fixture.binDirectory}:${process.env.PATH ?? "/usr/bin:/bin"}`,
});

const writeInputManifest = (workspace: string, entries: string[]): string => {
  const manifest = entries
    .map((relativePath) => `${"b".repeat(64)}  ${relativePath}`)
    .join("\n");
  const manifestPath = path.join(workspace, ".crabbox-input-manifest.sha256");
  writeFileSync(manifestPath, `${manifest}\n`);
  return manifestPath;
};

describe("exe.dev shadow scripts", () => {
  test("forwards ordinary flags with source identity", () => {
    const fixture = createLauncherFixture();
    try {
      const result = Bun.spawnSync(["bash", launcher, "--dry-run"], {
        env: launcherEnvironment(fixture),
        stderr: "pipe",
        stdout: "pipe",
      });

      expect(result.exitCode).toBe(0);
      expect(readFileSync(fixture.argumentsFile, "utf-8")).toBe(
        "job\nrun\n--dry-run\nexe-dev-shadow\n"
      );
      const environment = readFileSync(fixture.environmentFile, "utf-8");
      expect(environment).toMatch(
        new RegExp(`^${sourceSha}\\nclean\\nsha256:[0-9a-f]{64}\\n1\\n`, "u")
      );
      expect(readFileSync(fixture.materializedWorkspaceFile, "utf-8")).not.toBe(
        `${fixture.workspace}\n`
      );
      const metadata = environment.trim().split("\n");
      expect(Number.isInteger(Number(metadata[4]))).toBe(true);
      expect(Number.isInteger(Number(metadata[5]))).toBe(true);
    } finally {
      rmSync(fixture.workspace, { force: true, recursive: true });
    }
  });

  test("isolates source fingerprinting from inherited repository bindings", () => {
    const fixture = createLauncherFixture();
    try {
      const result = Bun.spawnSync(["bash", launcher, "--dry-run"], {
        env: {
          ...launcherEnvironment(fixture),
          GIT_DIR: "/foreign/repository/.git",
          GIT_INDEX_FILE: "/foreign/repository/.git/index",
          GIT_WORK_TREE: "/foreign/repository",
        },
        stderr: "pipe",
        stdout: "pipe",
      });

      expect(result.stderr.toString()).toBe("");
      expect(result.exitCode).toBe(0);
      expect(readFileSync(fixture.environmentFile, "utf-8")).toContain(
        `${sourceSha}\nclean\n`
      );
    } finally {
      rmSync(fixture.workspace, { force: true, recursive: true });
    }
  });

  test("excludes generated artifacts from sync and Docker contexts", () => {
    const repositoryRoot = path.join(import.meta.dir, "..");
    const crabboxConfig = readFileSync(
      path.join(repositoryRoot, ".crabbox.yaml"),
      "utf-8"
    );
    const dockerignore = readFileSync(
      path.join(repositoryRoot, ".dockerignore"),
      "utf-8"
    );

    expect(crabboxConfig.split("\n")).toContain("    - .artifacts");
    expect(dockerignore.split("\n")).toContain(".artifacts");
    expect(dockerignore.split("\n")).toContain("**/.artifacts");
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
        env: launcherEnvironment(fixture),
        stderr: "pipe",
        stdout: "pipe",
      });

      expect(result.exitCode).toBe(0);
      expect(readFileSync(fixture.environmentFile, "utf-8")).toContain(
        `${sha256ObjectId}\nclean\n`
      );
    } finally {
      rmSync(fixture.workspace, { force: true, recursive: true });
    }
  });

  test("rejects a dirty workspace before invoking Crabbox", () => {
    const fixture = createLauncherFixture(sourceSha, 0, " M source.ts\n");
    try {
      const result = Bun.spawnSync(["bash", launcher, "--dry-run"], {
        env: launcherEnvironment(fixture),
        stderr: "pipe",
        stdout: "pipe",
      });

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr.toString()).toContain(
        "source workspace must be clean before materialization"
      );
      expect(() => readFileSync(fixture.argumentsFile)).toThrow();
    } finally {
      rmSync(fixture.workspace, { force: true, recursive: true });
    }
  });

  test("rejects an unpinned Crabbox client before materialization", () => {
    const fixture = createLauncherFixture();
    try {
      const result = Bun.spawnSync(["bash", launcher, "--dry-run"], {
        env: {
          ...launcherEnvironment(fixture),
          CRABBOX_VERSION_OUTPUT: "0.47.0",
        },
        stderr: "pipe",
        stdout: "pipe",
      });

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr.toString()).toContain(
        "expected Crabbox 0.46.0, found 0.47.0"
      );
      expect(() => readFileSync(fixture.argumentsFile)).toThrow();
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
    writeInputManifest(workspace, ["bun.lock"]);

    try {
      const result = Bun.spawnSync(
        ["bash", "-c", 'source "$SHADOW_SCRIPT"; write_fingerprint'],
        {
          cwd: workspace,
          env: {
            ...process.env,
            CRABBOX_CLIENT_VERSION: "0.46.0",
            CRABBOX_SOURCE_MANIFEST_FILE_COUNT: "1",
            CRABBOX_SOURCE_MANIFEST_SHA256: `sha256:${"c".repeat(64)}`,
            CRABBOX_SOURCE_MATERIALIZATION_DURATION_MS: "12",
            CRABBOX_SOURCE_PREFLIGHT_DURATION_MS: "34",
            SHADOW_SCRIPT: shadowScript,
          },
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
      expect(fingerprint.crabboxClientVersion).toBe("0.46.0");
      expect(fingerprint.cpuModel.length).toBeGreaterThan(0);
      expect(fingerprint.nodeImage).toBe(nodeImage);
      expect(fingerprint.sourceManifestFileCount).toBe(1);
      expect(fingerprint.sourceMaterializationDurationMs).toBe(12);
      expect(fingerprint.sourcePreflightDurationMs).toBe(34);
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
    writeFileSync(path.join(workspace, ".crabbox.yaml"), "jobs: {}\n");
    writeInputManifest(workspace, [
      ".crabbox.yaml",
      "scripts/ci-metrics/core.spec.ts",
      "scripts/ci-metrics/fixtures/jobs.json",
    ]);

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
      expect(result.stdout.toString()).toContain(".crabbox.yaml");
    } finally {
      rmSync(workspace, { force: true, recursive: true });
    }
  });

  test("pins the Node runtime image in Docker and evidence", () => {
    const repositoryRoot = path.join(import.meta.dir, "..");
    const dockerfile = readFileSync(
      path.join(repositoryRoot, "apps/web/Dockerfile"),
      "utf-8"
    );
    const script = readFileSync(shadowScript, "utf-8");

    expect(dockerfile.match(new RegExp(nodeImage, "gu"))?.length).toBe(2);
    expect(script).toContain(`readonly NODE_IMAGE="${nodeImage}"`);
  });
});
