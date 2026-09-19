import { randomBytes, randomUUID } from "node:crypto";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import * as authSchema from "@ji/db/schema/auth";
import {
  aanvraag,
  aanvraagVersie,
  bron,
  outboxEvent,
  scrapeRun,
} from "@ji/db/schema/curated";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import {
  EFFECT_E2E_SCHEMA_VERSION,
  canaryQuery,
  privateAuthPath,
  readEffectE2eConfig,
} from "./contracts";
import type { EffectE2eAuthFile, EffectE2eSeedArtifact } from "./contracts";

const authBootstrapConfirmation = "PROVISION_AUTH_USER";

const writePrivateJson = async (
  filePath: string,
  value: EffectE2eAuthFile
): Promise<void> => {
  await mkdir(path.dirname(filePath), { mode: 0o700, recursive: true });
  await writeFile(filePath, `${JSON.stringify(value)}\n`, {
    encoding: "utf-8",
    mode: 0o600,
  });
  await chmod(filePath, 0o600);
};

const provisionOperator = async (
  config: ReturnType<typeof readEffectE2eConfig>,
  credentials: Omit<EffectE2eAuthFile, "subjectId" | "role">
): Promise<void> => {
  const serverSecret = process.env.BETTER_AUTH_SECRET;
  const betterAuthUrl = process.env.BETTER_AUTH_URL;
  const corsOrigin = process.env.CORS_ORIGIN;
  if (!serverSecret || !betterAuthUrl || !corsOrigin) {
    throw new Error(
      "BETTER_AUTH_SECRET, BETTER_AUTH_URL, and CORS_ORIGIN are required to provision the synthetic operator."
    );
  }

  const child = Bun.spawn(["bun", "apps/server/src/auth/provision-user.ts"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      AUTH_BOOTSTRAP_CONFIRM: authBootstrapConfirmation,
      AUTH_BOOTSTRAP_EMAIL: credentials.email,
      AUTH_BOOTSTRAP_ENABLED: "1",
      AUTH_BOOTSTRAP_NAME: credentials.name,
      AUTH_BOOTSTRAP_PASSWORD: credentials.password,
      AUTH_BOOTSTRAP_ROLE: "operator",
      BETTER_AUTH_SECRET: serverSecret,
      BETTER_AUTH_URL: betterAuthUrl,
      CORS_ORIGIN: corsOrigin,
      DATABASE_URL: config.databaseUrl,
    },
    stderr: "pipe",
    stdout: "pipe",
  });
  const [exitCode, stdout] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
  ]);
  if (exitCode !== 0) {
    throw new Error("Synthetic operator provisioning failed.");
  }
  const output = stdout
    .trim()
    .split("\n")
    .map((line) => line.trim())
    .findLast((line) => line.length > 0);
  if (!output) {
    throw new Error("Synthetic operator provisioning returned no status.");
  }
  let parsed: { readonly status?: string };
  try {
    // SAFETY: provision-user emits one JSON status object per successful run.
    parsed = JSON.parse(output) as { readonly status?: string };
  } catch {
    throw new Error("Synthetic operator provisioning returned invalid status.");
  }
  if (parsed.status !== "provisioned") {
    throw new Error(
      "Synthetic operator provisioning did not create a new user."
    );
  }
};

const assertDisposableDatabase = async (
  sql: ReturnType<typeof postgres>,
  expectedName: string,
  expectedMarker: string
): Promise<void> => {
  await sql`SELECT set_config('application_name', ${expectedMarker}, false)`;
  const [row] = await sql<
    {
      marker: string;
      name: string;
    }[]
  >`SELECT current_database() AS name, current_setting('application_name') AS marker`;
  if (row?.name !== expectedName || row.marker !== expectedMarker) {
    throw new Error(
      "Effect E2E database identity does not match the disposable target."
    );
  }
};

const readUser = async (
  database: ReturnType<typeof drizzle>,
  email: string
): Promise<{ readonly id: string; readonly role: string }> => {
  const [stored] = await database
    .select({ id: authSchema.user.id, role: authSchema.user.role })
    .from(authSchema.user)
    .where(eq(authSchema.user.email, email));
  if (!stored) {
    throw new Error("Synthetic operator was not found after provisioning.");
  }
  return stored;
};

const main = async (): Promise<void> => {
  const config = readEffectE2eConfig();
  const query = canaryQuery(config.canaryId);
  const title = `Effect E2E Boolean ${config.canaryId.slice(0, 8).toUpperCase()}`;
  const bronId = randomUUID();
  const scrapeRunId = randomUUID();
  const aanvraagId = config.canaryId;
  const aanvraagVersionId = randomUUID();
  const outboxId = randomUUID();
  const now = new Date();
  const started = new Date(now.getTime() - 1000);
  const shortId = config.canaryId.slice(0, 8);
  const email = `effect-e2e-operator-${shortId}@example.invalid`;
  const name = `Effect E2E Operator ${shortId}`;
  const password = randomBytes(24).toString("base64url");
  const authPath = privateAuthPath(process.env, config.privateDir);

  const databaseClient = postgres(config.databaseUrl, {
    connect_timeout: 5,
    max: 1,
  });
  const database = drizzle(databaseClient, {
    schema: {
      ...authSchema,
      aanvraag,
      aanvraagVersie,
      bron,
      outboxEvent,
      scrapeRun,
    },
  });

  try {
    await assertDisposableDatabase(
      databaseClient,
      config.databaseName,
      config.databaseMarker
    );
    const existing = await database
      .select({ id: aanvraag.id })
      .from(aanvraag)
      .where(eq(aanvraag.id, aanvraagId));
    if (existing.length > 0) {
      throw new Error(
        "Effect E2E canary already exists in the target database."
      );
    }

    await provisionOperator(config, { email, name, password });
    const user = await readUser(database, email);
    if (user.role !== "operator") {
      throw new Error("Synthetic operator role readback failed.");
    }

    await database.transaction(async (transaction) => {
      await transaction.insert(bron).values({
        actief: true,
        categorie: "msp_broker",
        crawlDelayMs: 0,
        id: bronId,
        ingestieType: "html",
        interval: "*/15 * * * *",
        naam: `Effect E2E Source ${shortId}`,
        rateLimitPerMinute: 600,
        status: "ready",
        voorwaardenStatus: "toegestaan",
      });
      await transaction.insert(scrapeRun).values({
        aantalGevonden: 1,
        bronId,
        fouten: 0,
        geindigd: now,
        gestart: started,
        gewijzigd: 0,
        id: scrapeRunId,
        nieuw: 1,
        rejected: 0,
        runKind: "poll",
        status: "succeeded",
      });
      await transaction.insert(aanvraag).values({
        beschrijving: `Synthetic ${query} vacancy for the disposable Effect E2E lane.`,
        bronId,
        bronReferentie: `effect-e2e-${config.canaryId}`,
        contentHash: config.canaryDigest,
        eersteGezienOp: started,
        extractieMethode: "html_parser",
        id: aanvraagId,
        laatstGezienOp: now,
        opdrachtgeverNaam: "Synthetic E2E opdrachtgever",
        publicatiedatum: now.toISOString().slice(0, 10),
        rawPayloadRef: `effect-e2e/${config.runId}/${config.canaryId}.html`,
        scrapeRunId,
        startDatum: "2027-01-01",
        status: "active",
        titel: title,
        versie: 1,
      });
      await transaction.insert(aanvraagVersie).values({
        aanvraagId,
        contentHash: config.canaryDigest,
        id: aanvraagVersionId,
        rawPayloadRef: `effect-e2e/${config.runId}/${config.canaryId}.html`,
        scrapeRunId,
        snapshot: { description: `Synthetic ${query} vacancy`, title },
        versie: 1,
      });
      await transaction.insert(outboxEvent).values({
        aggregateId: aanvraagId,
        aggregateType: "aanvraag",
        eventType: "aanvraag.nieuw",
        id: outboxId,
        payload: { reason: "effect_e2e_seed" },
      });
    });

    await writePrivateJson(authPath, {
      email,
      name,
      password,
      role: "operator",
      subjectId: user.id,
    });
    await mkdir(config.artifactDir, { mode: 0o755, recursive: true });
    const artifact: EffectE2eSeedArtifact = {
      auth: { role: "operator", subjectId: user.id },
      canary: {
        digest: config.canaryDigest,
        id: aanvraagId,
        query,
        title,
      },
      cleanup: {
        aanvraagId,
        bronId,
        database: "disposable",
        scrapeRunId,
      },
      evidence: {
        authStoredPrivately: true,
        seedPath: path.join(config.artifactDir, "seed.json"),
      },
      rows: { booleanJobs: 1, bronnen: 1 },
      schemaVersion: EFFECT_E2E_SCHEMA_VERSION,
      status: "passed",
    };
    await writeFile(
      artifact.evidence.seedPath,
      `${JSON.stringify(artifact, null, 2)}\n`,
      { encoding: "utf-8", mode: 0o644 }
    );
    process.stdout.write(`${JSON.stringify(artifact)}\n`);
  } finally {
    await databaseClient.end({ timeout: 5 });
  }
};

try {
  await main();
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Effect E2E seed failed."}\n`
  );
  process.exitCode = 1;
}
