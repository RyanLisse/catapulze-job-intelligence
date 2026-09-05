import { describe, expect, it } from "bun:test";

const script = await Bun.file(
  new URL("docker-compose-smoke.sh", import.meta.url)
).text();
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
    expect(script).toContain(`${composeCommand} --profile projector down\n`);
  });
});
