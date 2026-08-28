import { describe, expect, it } from "bun:test";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const resolverSource = path.join(
  import.meta.dir,
  "../tools/quality/resolve-changed.sh"
);

const callerCommonDirectory = path.resolve(
  import.meta.dir,
  Bun.spawnSync({
    cmd: ["git", "rev-parse", "--git-common-dir"],
    cwd: import.meta.dir,
    stderr: "pipe",
    stdout: "pipe",
  })
    .stdout.toString()
    .trim()
);
const callerCommonConfig = path.join(callerCommonDirectory, "config");

const hermeticGitEnvironment = (home: string) => ({
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_TERMINAL_PROMPT: "0",
  HOME: home,
  LANG: "C",
  LC_ALL: "C",
  PATH: process.env.PATH ?? "/usr/bin:/bin",
  TMPDIR: process.env.TMPDIR ?? tmpdir(),
});

const run = (
  command: string[],
  cwd: string,
  environment: Record<string, string>
): string => {
  const result = Bun.spawnSync({
    cmd: command,
    cwd,
    env: environment,
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
    const gitDirectory = path.join(repository, ".git");
    const hermeticHome = path.join(repository, "home");
    const environment = hermeticGitEnvironment(hermeticHome);
    const callerConfigBefore = readFileSync(callerCommonConfig, "utf-8");
    const git = (arguments_: string[]): string =>
      run(
        [
          "git",
          `--git-dir=${gitDirectory}`,
          `--work-tree=${repository}`,
          ...arguments_,
        ],
        repository,
        environment
      );

    try {
      mkdirSync(hermeticHome);
      const resolverTarget = path.join(
        repository,
        "tools/quality/resolve-changed.sh"
      );
      mkdirSync(path.dirname(resolverTarget), { recursive: true });
      copyFileSync(resolverSource, resolverTarget);

      run(
        ["git", "init", "--initial-branch=main", "."],
        repository,
        environment
      );

      const resolvedGitDirectory = realpathSync(
        git(["rev-parse", "--absolute-git-dir"]).trim()
      );
      const resolvedWorkTree = realpathSync(
        git(["rev-parse", "--show-toplevel"]).trim()
      );
      if (
        resolvedGitDirectory !== realpathSync(gitDirectory) ||
        resolvedWorkTree !== realpathSync(repository)
      ) {
        throw new Error("Temporary Git repository binding could not be proven");
      }

      git(["config", "--local", "user.email", "quality-test@example.invalid"]);
      git(["config", "--local", "user.name", "Quality Test"]);

      writeFileSync(path.join(repository, "_git2_tracked"), "baseline\n");
      git(["add", "_git2_tracked"]);
      git(["commit", "-m", "test: add baseline"]);
      git(["update-ref", "refs/remotes/origin/main", "HEAD"]);

      writeFileSync(path.join(repository, "_git2_tracked"), "");
      writeFileSync(path.join(repository, "_git2_empty"), "");
      writeFileSync(path.join(repository, "_git2_nonempty"), "content\n");

      const resolved = run(
        ["bash", "tools/quality/resolve-changed.sh"],
        repository,
        environment
      )
        .trim()
        .split("\n");

      expect(resolved).toContain("_git2_tracked");
      expect(resolved).toContain("_git2_nonempty");
      expect(resolved).not.toContain("_git2_empty");
      expect(existsSync(gitDirectory)).toBe(true);
    } finally {
      const callerConfigAfter = readFileSync(callerCommonConfig, "utf-8");
      rmSync(repository, { force: true, recursive: true });
      expect(callerConfigAfter).toBe(callerConfigBefore);
    }
  });
});
