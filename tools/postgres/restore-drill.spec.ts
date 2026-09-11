/**
 * Guard: the restore drill must never join the developer compose project.
 *
 * `docker-compose.yml` pins `name: catapulze-job-intelligence`, so a drill
 * that runs `docker compose` without its own `-p` adopts the developer's
 * running stack and tears it down in its cleanup trap. It must also publish
 * the source Postgres on its own host port so it cannot bind, or be reached
 * on, the shared 5432.
 */
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

const SHARED_COMPOSE_PROJECT = "catapulze-job-intelligence";
const SHARED_POSTGRES_PORT = "5432";

const COMPOSE_ARRAY_PATTERN = /^compose=\((?<args>.+)\)$/mu;
const COMPOSE_PROJECT_DEFAULT_PATTERN =
  /^compose_project="\$\{RESTORE_DRILL_PROJECT:-(?<value>[^}]+)\}"$/mu;
const SOURCE_PORT_DEFAULT_PATTERN =
  /^export POSTGRES_HOST_PORT="\$\{RESTORE_DRILL_SOURCE_PORT:-(?<value>[^}]+)\}"$/mu;

const script = readFileSync(
  path.join(import.meta.dir, "restore-drill.sh"),
  "utf-8"
);

describe("restore drill compose isolation", () => {
  it("runs every compose invocation under an explicit project", () => {
    const composeArgs = COMPOSE_ARRAY_PATTERN.exec(script)?.groups?.args;

    expect(composeArgs).toBeDefined();
    expect(composeArgs).toContain("-p ");
    expect(composeArgs).toContain('"$compose_project"');
  });

  it("does not use the shared developer compose project", () => {
    const projectDefault =
      COMPOSE_PROJECT_DEFAULT_PATTERN.exec(script)?.groups?.value;

    expect(projectDefault).toBeDefined();
    expect(projectDefault).not.toBe(SHARED_COMPOSE_PROJECT);
    expect(script).not.toContain(SHARED_COMPOSE_PROJECT);
  });

  it("defaults the source postgres to a drill-only host port", () => {
    const sourcePortDefault =
      SOURCE_PORT_DEFAULT_PATTERN.exec(script)?.groups?.value;

    expect(sourcePortDefault).toBeDefined();
    expect(sourcePortDefault).not.toBe(SHARED_POSTGRES_PORT);
  });
});
