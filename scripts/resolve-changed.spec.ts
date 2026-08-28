import { describe, expect, it } from "bun:test";
import {
  copyFileSync,
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

const run = (command: string[], cwd: string): string => {
  const result = Bun.spawnSync({
    cmd: command,
    cwd,
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

    try {
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
    } finally {
      rmSync(repository, { force: true, recursive: true });
    }
  });
});
