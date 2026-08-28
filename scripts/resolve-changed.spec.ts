import { describe, expect, it } from "bun:test";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const resolverSource = path.join(
  import.meta.dir,
  "../tools/quality/resolve-changed.sh"
);

const localRepositoryGitEnvironmentVariables = [
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_CONFIG",
  "GIT_CONFIG_PARAMETERS",
  "GIT_CONFIG_COUNT",
  "GIT_OBJECT_DIRECTORY",
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_IMPLICIT_WORK_TREE",
  "GIT_GRAFT_FILE",
  "GIT_INDEX_FILE",
  "GIT_NO_REPLACE_OBJECTS",
  "GIT_REPLACE_REF_BASE",
  "GIT_PREFIX",
  "GIT_SHALLOW_FILE",
  "GIT_COMMON_DIR",
] as const;

const run = (command: string[], cwd: string): string => {
  const commandEnvironment = { ...process.env };
  for (const variable of localRepositoryGitEnvironmentVariables) {
    commandEnvironment[variable] = undefined;
  }

  const result = Bun.spawnSync({
    cmd: command,
    cwd,
    env: commandEnvironment,
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
    const sentinelRepository = mkdtempSync(
      path.join(tmpdir(), "ji-resolve-changed-sentinel-")
    );
    const originalGitEnvironment = {
      GIT_COMMON_DIR: process.env.GIT_COMMON_DIR,
      GIT_DIR: process.env.GIT_DIR,
      GIT_INDEX_FILE: process.env.GIT_INDEX_FILE,
      GIT_WORK_TREE: process.env.GIT_WORK_TREE,
    };

    try {
      run(["git", "init", "--initial-branch=main"], sentinelRepository);
      run(
        ["git", "config", "resolve-changed.sentinel", "unchanged"],
        sentinelRepository
      );
      const sentinelGitDirectory = path.join(sentinelRepository, ".git");
      const sentinelConfigPath = path.join(sentinelGitDirectory, "config");
      const sentinelConfigBefore = readFileSync(sentinelConfigPath);

      process.env.GIT_DIR = sentinelGitDirectory;
      process.env.GIT_COMMON_DIR = sentinelGitDirectory;
      process.env.GIT_WORK_TREE = sentinelRepository;
      process.env.GIT_INDEX_FILE = path.join(sentinelGitDirectory, "index");

      const resolverTarget = path.join(
        repository,
        "tools/quality/resolve-changed.sh"
      );
      mkdirSync(path.dirname(resolverTarget), { recursive: true });
      copyFileSync(resolverSource, resolverTarget);

      run(["git", "init", "--initial-branch=main"], repository);
      run(
        ["git", "config", "user.email", "quality-test@example.invalid"],
        repository
      );
      run(["git", "config", "user.name", "Quality Test"], repository);

      writeFileSync(path.join(repository, "_git2_tracked"), "baseline\n");
      run(["git", "add", "_git2_tracked"], repository);
      run(["git", "commit", "-m", "test: add baseline"], repository);
      run(
        ["git", "update-ref", "refs/remotes/origin/main", "HEAD"],
        repository
      );

      writeFileSync(path.join(repository, "_git2_tracked"), "");
      writeFileSync(path.join(repository, "_git2_empty"), "");
      writeFileSync(path.join(repository, "_git2_nonempty"), "content\n");

      const resolved = run(
        ["bash", "tools/quality/resolve-changed.sh"],
        repository
      )
        .trim()
        .split("\n");

      expect(resolved).toContain("_git2_tracked");
      expect(resolved).toContain("_git2_nonempty");
      expect(resolved).not.toContain("_git2_empty");
      expect(readFileSync(sentinelConfigPath)).toEqual(sentinelConfigBefore);
    } finally {
      if (originalGitEnvironment.GIT_DIR === undefined) {
        delete process.env.GIT_DIR;
      } else {
        process.env.GIT_DIR = originalGitEnvironment.GIT_DIR;
      }
      if (originalGitEnvironment.GIT_COMMON_DIR === undefined) {
        delete process.env.GIT_COMMON_DIR;
      } else {
        process.env.GIT_COMMON_DIR = originalGitEnvironment.GIT_COMMON_DIR;
      }
      if (originalGitEnvironment.GIT_WORK_TREE === undefined) {
        delete process.env.GIT_WORK_TREE;
      } else {
        process.env.GIT_WORK_TREE = originalGitEnvironment.GIT_WORK_TREE;
      }
      if (originalGitEnvironment.GIT_INDEX_FILE === undefined) {
        delete process.env.GIT_INDEX_FILE;
      } else {
        process.env.GIT_INDEX_FILE = originalGitEnvironment.GIT_INDEX_FILE;
      }
      rmSync(repository, { force: true, recursive: true });
      rmSync(sentinelRepository, { force: true, recursive: true });
    }
  });
});
