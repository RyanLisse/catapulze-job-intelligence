import { readdir } from "node:fs/promises";
import path from "node:path";

const AWS_ACCESS_KEY = /AKIA[0-9A-Z]{16}/gu;
const GITHUB_PAT = /ghp_[A-Za-z0-9]{36}/gu;
const OPENAI_LIVE = /sk-live-[A-Za-z0-9]{20,}/gu;
const MAX_SCAN_FILE_BYTES = 10 * 1024 * 1024;
const REPOSITORY_LOCAL_GIT_VARIABLES = [
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

const skipPath = (filePath: string): boolean =>
  filePath.endsWith(".spec.ts") ||
  filePath.endsWith(".test.ts") ||
  filePath.includes("/check-secrets-scan.ts");

export const collectSecretViolations = (
  filePath: string,
  source: string
): string[] => {
  if (skipPath(filePath)) {
    return [];
  }
  const violations: string[] = [];
  if (AWS_ACCESS_KEY.test(source)) {
    violations.push(`${filePath} looks like an AWS access key`);
  }
  AWS_ACCESS_KEY.lastIndex = 0;
  if (source.includes("-----BEGIN") && source.includes("PRIVATE KEY-----")) {
    violations.push(`${filePath} contains a PEM private key block`);
  }
  if (GITHUB_PAT.test(source)) {
    violations.push(`${filePath} looks like a GitHub PAT`);
  }
  GITHUB_PAT.lastIndex = 0;
  if (OPENAI_LIVE.test(source)) {
    violations.push(`${filePath} looks like a live OpenAI key`);
  }
  OPENAI_LIVE.lastIndex = 0;
  return violations;
};

const isScannable = (relativePath: string): boolean => {
  const pathSegments = relativePath.split("/");
  return !pathSegments.some((segment) =>
    [
      ".artifacts",
      ".cache",
      ".git",
      ".next",
      ".omc",
      ".turbo",
      "coverage",
      "dist",
      "logs",
      "node_modules",
      "openwiki",
    ].includes(segment)
  );
};

const isLocalDotenv = (relativePath: string): boolean => {
  const fileName = path.posix.basename(relativePath);
  return (
    fileName === ".env" ||
    (fileName.startsWith(".env.") && fileName !== ".env.example")
  );
};

const listWorkspaceFiles = async (
  rootDir: string,
  relativeDirectory = ""
): Promise<string[]> => {
  const directory = path.join(rootDir, relativeDirectory);
  const entries = await readdir(directory, { withFileTypes: true });
  const nestedPaths = await Promise.all(
    entries.map((entry): string[] | Promise<string[]> => {
      const relativePath = path.posix.join(relativeDirectory, entry.name);
      if (!isScannable(relativePath)) {
        return [];
      }
      if (entry.isDirectory()) {
        return listWorkspaceFiles(rootDir, relativePath);
      }
      return entry.isFile() && !isLocalDotenv(relativePath)
        ? [relativePath]
        : [];
    })
  );

  return nestedPaths.flat();
};

const readIfPresent = async (
  rootDir: string,
  relativePath: string,
  maxFileBytes: number
): Promise<{ source: string | null; tooLarge: boolean }> => {
  const file = Bun.file(`${rootDir}/${relativePath}`);
  if (!(await file.exists())) {
    return { source: null, tooLarge: false };
  }
  if (file.size > maxFileBytes) {
    return { source: null, tooLarge: true };
  }
  return { source: await file.text(), tooLarge: false };
};

export const scanTrackedFiles = async (
  rootDir: string,
  maxFileBytes = MAX_SCAN_FILE_BYTES,
  environment: NodeJS.ProcessEnv = process.env
): Promise<string[]> => {
  const gitEnvironment = { ...environment };
  for (const variable of REPOSITORY_LOCAL_GIT_VARIABLES) {
    gitEnvironment[variable] = undefined;
  }
  const proc = Bun.spawn(["git", "ls-files"], {
    cwd: rootDir,
    env: gitEnvironment,
    stderr: "pipe",
    stdout: "pipe",
  });
  const listed = await new Response(proc.stdout).text();
  const gitExitCode = await proc.exited;
  const listedPaths = listed.split("\n").filter((relativePath) => {
    if (!relativePath) {
      return false;
    }
    return isScannable(relativePath);
  });
  const workspacePaths = await listWorkspaceFiles(rootDir);
  const paths =
    gitExitCode === 0
      ? [...new Set([...listedPaths, ...workspacePaths])].toSorted()
      : workspacePaths;
  const violations: string[] = [];
  for (const relativePath of paths) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- sequential reads bound scan memory
    const { source, tooLarge } = await readIfPresent(
      rootDir,
      relativePath,
      maxFileBytes
    );
    if (tooLarge) {
      violations.push(
        `${relativePath} exceeds the ${maxFileBytes}-byte secret-scan limit`
      );
      continue;
    }
    if (source === null) {
      continue;
    }
    violations.push(...collectSecretViolations(relativePath, source));
  }
  return violations;
};

if (import.meta.main) {
  const violations = await scanTrackedFiles(process.cwd());
  if (violations.length > 0) {
    for (const line of violations) {
      console.error(line);
    }
    process.exit(1);
  }
}
