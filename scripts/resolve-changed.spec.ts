import { describe, expect, it } from "bun:test";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const resolverSource = path.join(
  import.meta.dir,
  "../tools/quality/resolve-changed.sh"
);

// Mirrors `git rev-parse --local-env-vars`. These variables bind Git to the
// caller's repository and must never leak into commands targeting a temp repo.
const GIT_LOCAL_ENVIRONMENT_VARIABLES = [
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_COMMON_DIR",
  "GIT_CONFIG",
  "GIT_CONFIG_COUNT",
  "GIT_CONFIG_PARAMETERS",
  "GIT_DIR",
  "GIT_GRAFT_FILE",
  "GIT_IMPLICIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_NO_REPLACE_OBJECTS",
  "GIT_OBJECT_DIRECTORY",
  "GIT_PREFIX",
  "GIT_REPLACE_REF_BASE",
  "GIT_SHALLOW_FILE",
  "GIT_WORK_TREE",
] as const;
const GIT_LOCAL_ENVIRONMENT_VARIABLE_NAMES = new Set<string>(
  GIT_LOCAL_ENVIRONMENT_VARIABLES
);

const withoutGitLocalEnvironment = (
  environment: Record<string, string | undefined>
) =>
  Object.fromEntries(
    Object.entries(environment).filter(
      ([name]) => !GIT_LOCAL_ENVIRONMENT_VARIABLE_NAMES.has(name)
    )
  );

const run = (
  command: string[],
  cwd: string,
  environment: Record<string, string | undefined> = process.env
): string => {
  const result = Bun.spawnSync({
    cmd: command,
    cwd,
    env: withoutGitLocalEnvironment(environment),
    stderr: "pipe",
    stdout: "pipe",
  });

  if (result.exitCode !== 0) {
    throw new Error(result.stderr.toString());
  }

  return result.stdout.toString();
};

describe("resolve-changed", () => {
  it("ignores only empty untracked libgit2 scratchfiles", () => {
    const repository = mkdtempSync(path.join(tmpdir(), "ji-resolve-changed-"));
    const inheritedGitDirectory = path.join(repository, "inherited.git");
    const inheritedCommonDirectory = path.join(repository, "inherited-common");
    const hookEnvironment = {
      ...process.env,
      GIT_COMMON_DIR: inheritedCommonDirectory,
      GIT_DIR: inheritedGitDirectory,
      GIT_INDEX_FILE: path.join(repository, "inherited-index"),
      GIT_PREFIX: "hook-prefix/",
      GIT_WORK_TREE: path.join(repository, "inherited-worktree"),
    };

    try {
      const resolverTarget = path.join(
        repository,
        "tools/quality/resolve-changed.sh"
      );
      mkdirSync(path.dirname(resolverTarget), { recursive: true });
      copyFileSync(resolverSource, resolverTarget);

      run(
        ["git", "init", "--initial-branch=main"],
        repository,
        hookEnvironment
      );
      run(
        ["git", "config", "user.email", "quality-test@example.invalid"],
        repository,
        hookEnvironment
      );
      run(
        ["git", "config", "user.name", "Quality Test"],
        repository,
        hookEnvironment
      );

      writeFileSync(path.join(repository, "_git2_tracked"), "baseline\n");
      run(["git", "add", "_git2_tracked"], repository, hookEnvironment);
      run(
        ["git", "commit", "-m", "test: add baseline"],
        repository,
        hookEnvironment
      );
      run(
        ["git", "update-ref", "refs/remotes/origin/main", "HEAD"],
        repository,
        hookEnvironment
      );

      writeFileSync(path.join(repository, "_git2_tracked"), "");
      writeFileSync(path.join(repository, "_git2_empty"), "");
      writeFileSync(path.join(repository, "_git2_nonempty"), "content\n");

      const resolved = run(
        ["bash", "tools/quality/resolve-changed.sh"],
        repository,
        hookEnvironment
      )
        .trim()
        .split("\n");

      expect(resolved).toContain("_git2_tracked");
      expect(resolved).toContain("_git2_nonempty");
      expect(resolved).not.toContain("_git2_empty");
      expect(existsSync(path.join(repository, ".git"))).toBe(true);
      expect(existsSync(inheritedGitDirectory)).toBe(false);
      expect(existsSync(inheritedCommonDirectory)).toBe(false);
    } finally {
      rmSync(repository, { force: true, recursive: true });
    }
  });
});
