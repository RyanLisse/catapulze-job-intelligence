import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { chmod, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

interface ComposeService {
  build?: { dockerfile?: string };
  environment?: Record<string, string>;
  env_file?: unknown[];
  ports?: unknown[];
}

interface ComposeConfig {
  name: string;
  services: Record<string, ComposeService>;
  volumes: Record<string, { external?: boolean; name?: string }>;
}

let config: ComposeConfig;
let tempDirectory: string;

beforeAll(async () => {
  tempDirectory = await mkdtemp(path.join(tmpdir(), "docker-smoke-contract-"));
  const configPath = path.join(tempDirectory, "config.json");
  const child = Bun.spawn(["bash", "scripts/docker-compose-smoke.sh"], {
    env: {
      ...globalThis.process.env,
      CATAPULZE_DATABASE_URL: "postgresql://production.invalid/prod",
      COMPOSE_ENV_FILE: ".env",
      COMPOSE_FILE: "production-compose.yml",
      COMPOSE_PROJECT_NAME: "production-project",
      DOCKER_SMOKE_CONFIG_OUTPUT: configPath,
      DOCKER_SMOKE_ENV_FILE: ".env",
      MANTICORE_URL: "https://production.invalid",
      POSTGRES_DATA_VOLUME: "production-volume",
    },
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([
    new Response(child.stderr).text(),
    child.exited,
  ]);
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
  // SAFETY: docker compose config --format json produces this Compose schema;
  // the contract assertions below check every field this test reads.
  config = JSON.parse(await readFile(configPath, "utf-8")) as ComposeConfig;
});

afterAll(async () => {
  await rm(tempDirectory, { force: true, recursive: true });
});

describe("application-image smoke Compose contract", () => {
  it("uses every deployable application Dockerfile", () => {
    expect(config.services.server?.build?.dockerfile).toBe(
      "apps/server/Dockerfile"
    );
    expect(config.services.web?.build?.dockerfile).toBe("apps/web/Dockerfile");
    expect(config.services.migrator?.build?.dockerfile).toBe(
      "apps/server/Dockerfile.migrate"
    );
    expect(config.services.projector?.build?.dockerfile).toBe(
      "apps/server/Dockerfile.projector"
    );
  });

  it("ignores hostile shell configuration and owns its database volume", () => {
    expect(config.name).toMatch(/^catapulze-smoke-/u);
    expect(config.name).not.toBe("production-project");
    expect(config.services.server?.environment?.DATABASE_URL).toBe(
      "postgresql://ji_app:ji_app_smoke@postgres:5432/ji_smoke"
    );
    expect(config.services.server?.environment?.MANTICORE_URL).toBe(
      "http://manticore:9308"
    );
    expect(config.volumes.postgres_data?.external).not.toBe(true);
    expect(config.volumes.postgres_data?.name).toBe(
      `${config.name}_postgres_data`
    );
  });

  it("publishes no host ports and loads no app env files", () => {
    const isolatedServices = [
      "postgres",
      "redis",
      "manticore",
      "raw-storage-minio",
      "server",
      "web",
    ];
    for (const serviceName of isolatedServices) {
      expect(config.services[serviceName]?.ports ?? []).toEqual([]);
    }
    expect(config.services.server?.env_file ?? []).toEqual([]);
    expect(config.services.web?.env_file ?? []).toEqual([]);
  });

  it("tears its project down when an intermediate command fails", async () => {
    const fakeDirectory = await mkdtemp(
      path.join(tmpdir(), "docker-smoke-failure-")
    );
    const fakeDockerPath = path.join(fakeDirectory, "docker");
    const commandLogPath = path.join(fakeDirectory, "commands.log");
    const artifactPath = path.join(fakeDirectory, "artifacts");
    await Bun.write(
      fakeDockerPath,
      `#!/bin/sh\nprintf '%s\\n' "$*" >> '${commandLogPath}'\ncase "$*" in\n  *" config --quiet") exit 0 ;;\n  *" build server web migrator projector") exit 42 ;;\n  *) exit 0 ;;\nesac\n`
    );
    await chmod(fakeDockerPath, 0o755);

    const child = Bun.spawn(["bash", "scripts/docker-compose-smoke.sh"], {
      env: {
        ...globalThis.process.env,
        DOCKER_SMOKE_ARTIFACT_DIR: artifactPath,
        PATH: `${fakeDirectory}:${globalThis.process.env.PATH ?? ""}`,
      },
      stderr: "pipe",
      stdout: "pipe",
    });
    const exitCode = await child.exited;
    const commands = await readFile(commandLogPath, "utf-8");
    await rm(fakeDirectory, { force: true, recursive: true });

    expect(exitCode).toBe(42);
    expect(commands).toContain("build server web migrator projector");
    expect(commands).toContain("down --volumes --remove-orphans");
  });
});
