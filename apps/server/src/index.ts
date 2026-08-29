import { trpcServer } from "@hono/trpc-server";
import { createContext } from "@ji/api/context";
import { appRouter } from "@ji/api/routers/index";
import { createTestSliceARegistry } from "@ji/application/registry";
import { auth } from "@ji/auth";
import { closeDb, getDbReadiness } from "@ji/db";
import type { DbReadinessResult } from "@ji/db/readiness";
import { env } from "@ji/env/server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";

import { createMcpHandler } from "./capabilities/mcp";
import {
  createRestCapabilityHandler,
  restRoutesFromRegistry,
} from "./capabilities/rest";
import { createReadinessHandler } from "./readiness";

const DEFAULT_PORT = 3000;
const SHUTDOWN_DRAIN_TIMEOUT_MS = 10_000;

const app = new Hono();

app.use(logger());
app.use(
  "/*",
  cors({
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "OPTIONS"],
    credentials: true,
    origin: env.CORS_ORIGIN,
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

type DbReadinessFailure = Extract<DbReadinessResult, { ready: false }>;

const reportReadinessFailure = (failure: DbReadinessFailure): void => {
  process.stderr.write(
    `${JSON.stringify({ event: "readiness_failed", reason: failure.reason })}\n`
  );
};

app.get(
  "/readyz",
  createReadinessHandler(getDbReadiness, reportReadinessFailure)
);

const sliceA = createTestSliceARegistry();
const restRoutes = restRoutesFromRegistry(sliceA.registry);
const restHandler = createRestCapabilityHandler(sliceA.registry, restRoutes);
const mcpHandler = createMcpHandler(sliceA.registry);

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

  await closeDb();
  process.exit(drainTimedOut ? 1 : 0);
};

const handleShutdown = (): void => {
  shutdownPromise ??= shutdown();
};

process.once("SIGINT", handleShutdown);
process.once("SIGTERM", handleShutdown);
