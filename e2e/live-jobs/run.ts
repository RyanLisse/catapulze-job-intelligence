import {
  assertAnonymousLiveRun,
  assertAuthenticatedLiveRun,
  assertMutationLiveRun,
} from "./config";
import { preflightLiveJobsCleanup } from "./mutation-cleanup";

const [mode] = process.argv.slice(2);

let configPath: string | null = null;
if (mode === "session") {
  configPath = "playwright.live.config.ts";
} else if (mode === "anonymous") {
  configPath = "playwright.live-anonymous.config.ts";
} else if (mode === "writes") {
  configPath = "playwright.live-writes.config.ts";
}

if (!configPath) {
  throw new Error("Usage: bun e2e/live-jobs/run.ts <session|anonymous|writes>");
}

const run = async (): Promise<number> => {
  if (mode === "writes") {
    const config = assertMutationLiveRun();
    await preflightLiveJobsCleanup(config);
  } else if (mode === "anonymous") {
    assertAnonymousLiveRun();
  } else {
    assertAuthenticatedLiveRun();
  }

  const result = Bun.spawnSync({
    cmd: ["./node_modules/.bin/playwright", "test", `--config=${configPath}`],
    stderr: "inherit",
    stdout: "inherit",
  });

  return result.exitCode ?? 1;
};

process.exit(await run());
