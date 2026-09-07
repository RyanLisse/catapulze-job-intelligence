import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  assertFixtureOnly,
  buildDryRunArtifact,
  loadTemplate,
  validateBaselineArtifact,
} from "./harness";
import { readToolchainPins } from "./versions";

const ROOT = path.resolve(import.meta.dir, "../..");

describe("effect-baseline harness", () => {
  test("template is fixture-only and forbids blind write retries", () => {
    const template = loadTemplate();
    expect(template.workload.fixtureOnly).toBe(true);
    expect(template.workload.liveProviders).toBe(false);
    expect(template.retryOwnership.blindWriteRetries).toBe(false);
    expect(template.retryOwnership.requestMaxAttempts).toBe(3);
    expect(template.retryOwnership.triggerMaxAttempts).toBe(2);
    assertFixtureOnly(template);
  });

  test("toolchain pins reflect lockfile reality without inventing a direct Effect dep", () => {
    const pins = readToolchainPins("1.4.0");
    expect(pins.bunPackageManager).toBe("bun@1.3.14");
    expect(pins.typescript).toBe("6.0.3");
    expect(pins.typesBun).toBe("1.4.0");
    expect(pins.effectDirect).toBeNull();
    expect(pins.effectTransitive).toBe("3.21.0");
    expect(pins.compatibilityNotes.length).toBeGreaterThan(0);
  });

  test("dry-run artifact validates and keeps metrics unmeasured", () => {
    const artifact = buildDryRunArtifact("cold");
    validateBaselineArtifact(artifact);
    expect(artifact.status).toBe("dry-run");
    expect(artifact.issue).toBe("CTP-454");
    expect(artifact.cohort.runKind).toBe("cold");
    expect(artifact.workload.adapters).toContain("json-ld-listing");
    expect(artifact.workload.adapters).toContain("spott-get");
    expect(artifact.metrics.latencyMs).toEqual({
      failures: 0,
      n: 0,
      p50: null,
      p95: null,
    });
    expect(artifact.git.headSha).toMatch(/^[0-9a-f]{40}$/u);
  });

  test("schema and ADR files exist for CTP-454", () => {
    for (const relative of [
      "docs/adr/ADR-0013-effectts-platform-baseline.md",
      "docs/effectts/json-ld-spott-wire-contract.md",
      "scripts/effect-baseline/baseline-artifact.schema.json",
      "scripts/effect-baseline/baseline-artifact.template.json",
    ]) {
      const contents = readFileSync(path.join(ROOT, relative), "utf-8");
      expect(contents.length).toBeGreaterThan(20);
    }
  });

  test("assertFixtureOnly rejects live providers", () => {
    const template = loadTemplate();
    expect(() =>
      assertFixtureOnly({
        ...template,
        workload: { ...template.workload, liveProviders: true },
      })
    ).toThrow(/refuses live providers/u);
  });
});
