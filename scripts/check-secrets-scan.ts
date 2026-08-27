const AWS_ACCESS_KEY = /AKIA[0-9A-Z]{16}/gu;
const GITHUB_PAT = /ghp_[A-Za-z0-9]{36}/gu;
const OPENAI_LIVE = /sk-live-[A-Za-z0-9]{20,}/gu;

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
  const awsKeys = source.match(AWS_ACCESS_KEY) ?? [];
  for (const key of awsKeys) {
    violations.push(`${filePath} looks like an AWS access key (${key})`);
  }
  if (source.includes("-----BEGIN") && source.includes("PRIVATE KEY-----")) {
    violations.push(`${filePath} contains a PEM private key block`);
  }
  const pats = source.match(GITHUB_PAT) ?? [];
  for (const token of pats) {
    violations.push(`${filePath} looks like a GitHub PAT (${token})`);
  }
  const openaiKeys = source.match(OPENAI_LIVE) ?? [];
  for (const token of openaiKeys) {
    violations.push(`${filePath} looks like a live OpenAI key (${token})`);
  }
  return violations;
};

const isScannable = (relativePath: string): boolean => {
  if (relativePath.startsWith("node_modules/")) {
    return false;
  }
  if (relativePath.startsWith("openwiki/")) {
    return false;
  }
  return true;
};

const readIfPresent = async (
  rootDir: string,
  relativePath: string
): Promise<string | null> => {
  const file = Bun.file(`${rootDir}/${relativePath}`);
  if (await file.exists()) {
    return file.text();
  }
  return null;
};

export const scanTrackedFiles = async (rootDir: string): Promise<string[]> => {
  const proc = Bun.spawn(["git", "ls-files"], {
    cwd: rootDir,
    stderr: "pipe",
    stdout: "pipe",
  });
  const listed = await new Response(proc.stdout).text();
  await proc.exited;
  const paths = listed.split("\n").filter((relativePath) => {
    if (!relativePath) {
      return false;
    }
    return isScannable(relativePath);
  });
  const sources = await Promise.all(
    paths.map(async (relativePath) => {
      const source = await readIfPresent(rootDir, relativePath);
      return { relativePath, source };
    })
  );
  const violations: string[] = [];
  for (const { relativePath, source } of sources) {
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
