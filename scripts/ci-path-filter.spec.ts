import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

const workflowPath = path.join(process.cwd(), ".github/workflows/ci.yml");

const readCodePatterns = (): string[] => {
  const workflow = readFileSync(workflowPath, "utf-8");
  const codeFilter = workflow.match(
    /filters: \|\n\s+code:\n(?<patterns>(?:\s+- "[^"]+"\n)+)/u
  );

  if (!codeFilter?.groups?.patterns) {
    throw new Error("Could not find the CI code path filter");
  }

  return [
    ...codeFilter.groups.patterns.matchAll(/- "(?<pattern>[^"]+)"/gu),
  ].map((match) => {
    if (!match.groups?.pattern) {
      throw new Error("Could not parse a CI code path filter pattern");
    }

    return match.groups.pattern;
  });
};

const isCodeChange = (changedPaths: string[]): boolean => {
  const codePatterns = readCodePatterns();

  return changedPaths.some((changedPath) =>
    codePatterns.some((pattern) => new Bun.Glob(pattern).match(changedPath))
  );
};

describe("CI code path filter", () => {
  it("classifies benchmark-only changes as code", () => {
    expect(isCodeChange(["benchmarks/search/profile.json"])).toBe(true);
  });

  it("classifies script-only changes as code", () => {
    expect(isCodeChange(["scripts/replay-run.ts"])).toBe(true);
  });

  it("classifies spec-only changes anywhere in the repository as code", () => {
    expect(isCodeChange(["standalone/contract.spec.ts"])).toBe(true);
  });

  it("keeps documentation-only changes out of the full suite", () => {
    expect(isCodeChange(["docs/ci-path-filter.md"])).toBe(false);
  });
});
