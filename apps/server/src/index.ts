import { trpcServer } from "@hono/trpc-server";
import { createContext } from "@ji/api/context";
import { appRouter } from "@ji/api/routers/index";
import { auth } from "@ji/auth";
import { closeDb, getDbReadiness } from "@ji/db";
import { env } from "@ji/env/server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";

import { createSessionPrincipalResolver } from "./capabilities/auth";
import { PRODUCTION_UNAVAILABLE_CAPABILITIES } from "./capabilities/capability-availability";
import { createMcpHandler } from "./capabilities/mcp";
import {
  createRestCapabilityHandler,
  restRoutesFromRegistry,
} from "./capabilities/rest";
import { createHealthRoutes } from "./http/health";
import { createReleaseHandler } from "./http/release";
import { createReadinessDeps, createReadinessHandler } from "./readiness";
import { createProductionSliceARegistry } from "./slice-a-registry";

const DEFAULT_PORT = 3000;
const SHUTDOWN_DRAIN_TIMEOUT_MS = 10_000;

const app = new Hono();
const allowedWebOrigin = new URL(env.CORS_ORIGIN).origin;

app.use(logger());
app.use(
  "/*",
  cors({
    allowHeaders: [
      "Content-Type",
      "Authorization",
      "MCP-Protocol-Version",
      "Mcp-Method",
      "Mcp-Name",
    ],
    allowMethods: ["DELETE", "GET", "POST", "PUT", "OPTIONS"],
    credentials: true,
    origin: allowedWebOrigin,
  })
);

app.on(["POST", "GET"], "/api/auth/*", (c) => auth.handler(c.req.raw));

app.use(
  "/trpc/*",
  trpcServer({
    createContext: (_opts, context) => createContext({ context }),
    router: appRouter,
  })
);

app.get("/", (c) => c.text("OK"));
app.get("/version", createReleaseHandler(env.APP_RELEASE_SHA));

const sliceA = await createProductionSliceARegistry({
  databaseUrl: env.DATABASE_URL,
  manticoreUrl: env.MANTICORE_URL,
  nodeEnv: env.NODE_ENV,
  rawObjectStorePath: env.RAW_OBJECT_STORE_PATH,
  rawS3AccessKeyId: env.RAW_S3_ACCESS_KEY_ID,
  rawS3Bucket: env.RAW_S3_BUCKET,
  rawS3Endpoint: env.RAW_S3_ENDPOINT,
  rawS3Region: env.RAW_S3_REGION,
  rawS3SecretAccessKey: env.RAW_S3_SECRET_ACCESS_KEY,
  redisUrl: env.REDIS_URL,
});

// Component-wise readiness (RJC-391): postgres/manticore/rawObjectStore/
// redis/searchProjection, each checked independently — see readiness.ts.
// `/livez` (createHealthRoutes' `live`) stays process-only, unaffected.
const readinessHandler = createReadinessHandler(
  createReadinessDeps({
    checkDbReadiness: getDbReadiness,
    database: sliceA.deps.database,
    manticoreUrl: sliceA.deps.manticoreUrl,
    nodeEnv: env.NODE_ENV,
    objectStore: sliceA.deps.objectStore,
    rawObjectStoreKind: sliceA.deps.rawObjectStoreKind,
    redisUrl: env.REDIS_URL,
  })
);
const healthRoutes = createHealthRoutes(readinessHandler);

app.get("/health", healthRoutes.health);
app.get("/livez", healthRoutes.live);
app.get("/readyz", healthRoutes.ready);

const restRoutes = restRoutesFromRegistry(sliceA.registry);
const resolvePrincipal = createSessionPrincipalResolver(
  (headers) =>
    auth.api.getSession({
      headers,
      query: { disableCookieCache: true },
    }),
  () => new Date(),
  (event) => {
    process.stderr.write(
      `${JSON.stringify({ event: "auth_session_lookup_failed", ...event })}\n`
    );
  }
);
const restHandler = createRestCapabilityHandler(
  sliceA.registry,
  restRoutes,
  resolvePrincipal,
  {
    allowedCookieOrigin: allowedWebOrigin,
    unavailableCapabilities: PRODUCTION_UNAVAILABLE_CAPABILITIES,
  }
);
const mcpHandler = createMcpHandler(sliceA.registry, resolvePrincipal, {
  allowedCookieOrigin: allowedWebOrigin,
  allowedHost: new URL(env.BETTER_AUTH_URL).hostname,
  recordMetric: (metric) => {
    process.stderr.write(`${JSON.stringify(metric)}\n`);
  },
  unavailableCapabilities: PRODUCTION_UNAVAILABLE_CAPABILITIES,
});

app.all("/v1/*", (context) => restHandler(context));
app.post("/mcp", (context) => mcpHandler(context));

const server = Bun.serve({
  fetch: app.fetch,
  port: process.env.PORT ?? DEFAULT_PORT,
});

let shutdownPromise: Promise<void> | undefined;

const shutdown = async (): Promise<void> => {
  let drainTimedOut = false;

  const markDrainTimeout = async (): Promise<void> => {
    await Bun.sleep(SHUTDOWN_DRAIN_TIMEOUT_MS);
    drainTimedOut = true;
  };

  await Promise.race([server.stop(false), markDrainTimeout()]);

  if (drainTimedOut) {
    await server.stop(true);
  }

  await Promise.all([sliceA.deps.close(), closeDb()]);
  process.exit(drainTimedOut ? 1 : 0);
};

const handleShutdown = (): void => {
  shutdownPromise ??= shutdown();
};

process.once("SIGINT", handleShutdown);
process.once("SIGTERM", handleShutdown);
