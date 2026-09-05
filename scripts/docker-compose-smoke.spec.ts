import { describe, expect, it } from "bun:test";
import {
  chmod,
  copyFile,
  mkdtemp,
  mkdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const script = await Bun.file(
  new URL("docker-compose-smoke.sh", import.meta.url)
).text();
const scriptPath = path.join(import.meta.dir, "docker-compose-smoke.sh");
const ensureVolumeScriptPath = path.join(
  import.meta.dir,
  "../tools/postgres/ensure-volume.sh"
);
const composeCommand = ['"', "$", "{compose_command[@]}", '"'].join("");

const positionOf = (fragment: string): number => {
  const position = script.indexOf(fragment);
  if (position === -1) {
    throw new Error(`docker-compose smoke script is missing: ${fragment}`);
  }
  return position;
};

const expectInOrder = (...fragments: readonly string[]): void => {
  let previous = -1;
  for (const fragment of fragments) {
    const position = positionOf(fragment);
    expect(position).toBeGreaterThan(previous);
    previous = position;
  }
};

const mockDocker = `#!/usr/bin/env bash
set -u
printf 'docker %s\\n' "$*" >> "\${MOCK_LOG:?}"
if [[ "$*" == *"config --format json"* ]]; then
  printf '%s\\n' '{"volumes":{"postgres_data":{"name":"mock-postgres-volume"}}}'
  exit 0
fi
if [[ "$*" == *" ps -aq"* ]]; then
  exit 0
fi
if [[ "$*" == *" ps"* ]]; then
  printf '%s\\n' 'mock compose ps'
  exit 0
fi
if [[ "$*" == *"logs --no-color --tail 80 server projector"* ]]; then
  printf '%s\\n' 'mock server/projector logs'
  exit 0
fi
if [[ "$*" == *"volume inspect"* ]]; then
  exit 1
fi
if [[ "$*" == *"port manticore 9308"* ]]; then
  printf '%s\\n' '127.0.0.1:9308'
  exit 0
fi
if [[ "$*" == *"reconcile-projection.ts"* ]]; then
  exit "\${MOCK_RECONCILE_EXIT:-0}"
fi
if [[ "$*" == *"--profile projector down"* ]]; then
  exit "\${MOCK_CLEANUP_EXIT:-0}"
fi
exit 0
`;

const mockBun = `#!/usr/bin/env bash
set -u
if [[ "\${1:-}" == "-e" ]]; then
  program="\${2:-}"
  if [[ "$program" == *"config.volumes.postgres_data.name"* ]]; then
    printf 'bun -e config\\n' >> "\${MOCK_LOG:?}"
    cat >/dev/null
    printf '%s\\n' 'mock-postgres-volume'
    exit 0
  fi
  if [[ "$program" == *"searchProjection"* ]]; then
    printf 'bun -e readiness\\n' >> "\${MOCK_LOG:?}"
    cat >/dev/null
    exit 0
  fi
  printf 'bun -e unknown\\n' >> "\${MOCK_LOG:?}"
  cat >/dev/null
  exit 0
fi
printf 'bun %s\\n' "$*" >> "\${MOCK_LOG:?}"
exit 0
`;

const mockCurl = `#!/usr/bin/env bash
set -u
printf 'curl %s\\n' "$*" >> "\${MOCK_LOG:?}"
if [[ "$*" == *"--write-out"* ]]; then
  printf '307'
  exit 0
fi
if [[ "$*" == *"readyz"* && "$*" != *"--fail"* ]]; then
  printf '%s\\n' '{"components":{"searchProjection":{"status":"ok","lagEvents":0}}}'
fi
exit 0
`;

interface SmokeRun {
  commands: string[];
  exitCode: number;
  stderr: string;
  stdout: string;
}

const expectCommandsInOrder = (
  commands: readonly string[],
  ...expected: readonly string[]
): void => {
  let previous = -1;
  for (const command of expected) {
    const position = commands.indexOf(command);
    expect(position).toBeGreaterThan(previous);
    previous = position;
  }
};

const writeExecutable = async (
  filePath: string,
  contents: string
): Promise<void> => {
  await writeFile(filePath, contents);
  await chmod(filePath, 0o755);
};

const runSmokeWithMocks = async (
  reconcileExit = 0,
  cleanupExit = 0
): Promise<SmokeRun> => {
  const workspace = await mkdtemp(
    path.join(tmpdir(), "ji-docker-compose-smoke-")
  );
  const binDirectory = path.join(workspace, "bin");
  const logPath = path.join(workspace, "commands.log");
  try {
    await mkdir(path.join(workspace, "apps/server"), { recursive: true });
    await mkdir(path.join(workspace, "tools/postgres"), { recursive: true });
    await mkdir(binDirectory);
    await writeFile(
      path.join(workspace, ".env"),
      "COMPOSE_PROJECT_NAME=smoke\n"
    );
    await writeFile(path.join(workspace, "apps/server/.env"), "TEST=1\n");
    await writeFile(logPath, "");
    await copyFile(
      ensureVolumeScriptPath,
      path.join(workspace, "tools/postgres/ensure-volume.sh")
    );
    await writeExecutable(path.join(binDirectory, "docker"), mockDocker);
    await writeExecutable(path.join(binDirectory, "bun"), mockBun);
    await writeExecutable(path.join(binDirectory, "curl"), mockCurl);

    const child = Bun.spawn(["bash", scriptPath], {
      cwd: workspace,
      env: {
        ...process.env,
        MOCK_CLEANUP_EXIT: String(cleanupExit),
        MOCK_LOG: logPath,
        MOCK_RECONCILE_EXIT: String(reconcileExit),
        PATH: `${binDirectory}:${process.env.PATH ?? "/usr/bin:/bin"}`,
      },
      stderr: "pipe",
      stdout: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    const rawCommands = await Bun.file(logPath).text();
    const commands = rawCommands.trim().split("\n").filter(Boolean);
    return { commands, exitCode, stderr, stdout };
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
};

describe("docker-compose smoke orchestration", () => {
  it("bootstraps the search generation before the healthchecked app stack", () => {
    expectInOrder(
      `${composeCommand} --profile projector build`,
      `${composeCommand} up -d --wait postgres manticore redis`,
      "bun run db:migrate",
      `${composeCommand} run --rm --no-deps server \\\n  bun /app/tools/manticore/start-search-generation.ts --apply`,
      `${composeCommand} --profile projector up -d --no-build projector`,
      `${composeCommand} up -d --no-build --wait server web`
    );
  });

  it("drains and reconciles only after the projector generation is ready", () => {
    expectInOrder(
      `${composeCommand} --profile projector up -d --no-build projector`,
      "wait_for_projection_drain",
      `${composeCommand} --profile projector stop projector`,
      `${composeCommand} run --rm --no-deps server \\\n  bun /app/tools/search/reconcile-projection.ts --fail-on-drift`,
      "curl --fail --silent --show-error --retry 10 --retry-delay 2 http://localhost:3000/readyz >/dev/null"
    );
    expect(script).toContain(
      'projection?.status === "ok" && projection.lagEvents === 0'
    );
    expect(script).toContain("local readiness_attempts=60");
    expect(script).toContain("sleep 2");
  });

  it("does not turn the opt-in projector into a default Compose service", () => {
    expect(script).not.toContain(
      `${composeCommand} --profile projector up -d --no-build\n`
    );
    expect(script).toContain(
      `${composeCommand} --profile projector up -d --no-build projector`
    );
  });

  it("keeps compose run invocations portable across Compose versions", () => {
    expect(script).not.toContain(
      `${composeCommand} run --rm --no-deps --no-build`
    );
    expect(script).toContain(`${composeCommand} run --rm --no-deps server`);
  });

  it("builds and cleans the opt-in projector profile explicitly", () => {
    expect(script).toContain(`${composeCommand} --profile projector build`);
    expect(script).not.toContain(`${composeCommand} build\n`);
    expect(script).toContain(`${composeCommand} --profile projector down`);
  });

  it("executes the happy path in order and waits for a drained projection", async () => {
    const result = await runSmokeWithMocks();

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain(
      "docker-compose smoke: Manticore document-id live test passed"
    );
    expect(result.commands).toHaveLength(21);
    expect(result.commands).toContain("bun -e config");
    expectCommandsInOrder(
      result.commands,
      "docker compose --env-file .env ps -aq",
      "docker compose --env-file .env config --format json",
      "docker volume inspect mock-postgres-volume",
      "docker volume create mock-postgres-volume",
      "docker compose --env-file .env --profile projector build",
      "docker compose --env-file .env up -d --wait postgres manticore redis",
      "bun run db:migrate",
      "docker compose --env-file .env run --rm --no-deps server bun /app/tools/manticore/start-search-generation.ts --apply",
      "docker compose --env-file .env --profile projector up -d --no-build projector",
      "docker compose --env-file .env up -d --no-build --wait server web",
      "curl --silent --show-error --max-time 5 http://localhost:3000/readyz",
      "bun -e readiness",
      "docker compose --env-file .env --profile projector stop projector",
      "docker compose --env-file .env run --rm --no-deps server bun /app/tools/search/reconcile-projection.ts --fail-on-drift",
      "curl --fail --silent --show-error --retry 10 --retry-delay 2 http://localhost:3000/readyz",
      "curl --fail --silent --show-error --retry 10 --retry-delay 2 http://localhost:3001/",
      "curl --silent --output /dev/null --write-out %{http_code} http://localhost:3001/dashboard",
      "docker compose --env-file .env port manticore 9308",
      "bun test packages/search/src/manticore/live.spec.ts",
      "docker compose --env-file .env --profile projector down"
    );
  }, 20_000);

  it("propagates reconciliation failure, skips later curls, and still cleans the profile", async () => {
    const result = await runSmokeWithMocks(23, 17);
    const reconciliationIndex = result.commands.findIndex((command) =>
      command.includes("reconcile-projection.ts --fail-on-drift")
    );

    expect(result.exitCode).toBe(23);
    expect(result.stderr).toContain(
      "docker-compose smoke: collecting failure diagnostics (exit 23)"
    );
    expect(result.stderr).toContain("mock compose ps");
    expect(result.stderr).toContain("mock server/projector logs");
    expect(reconciliationIndex).toBeGreaterThan(-1);
    expect(result.commands.slice(reconciliationIndex + 1)).toEqual([
      "docker compose --env-file .env ps",
      "docker compose --env-file .env logs --no-color --tail 80 server projector",
      "docker compose --env-file .env --profile projector down",
    ]);
    expect(result.commands).not.toContain(
      "curl --fail --silent --show-error --retry 10 --retry-delay 2 http://localhost:3000/readyz"
    );
    expect(result.commands).not.toContain(
      "curl --fail --silent --show-error --retry 10 --retry-delay 2 http://localhost:3001/"
    );
    expect(result.commands).not.toContain(
      "curl --silent --output /dev/null --write-out %{http_code} http://localhost:3001/dashboard"
    );
  }, 20_000);

  it("returns a cleanup failure when the primary smoke path succeeds", async () => {
    const result = await runSmokeWithMocks(0, 17);

    expect(result.exitCode).toBe(17);
    expect(result.stderr).toBe("");
    expect(result.commands.at(-1)).toBe(
      "docker compose --env-file .env --profile projector down"
    );
  }, 20_000);
});
