import { listPublicBronnen, mapPublicBronnen } from "@ji/application/bronnen";
import {
  createMemorySliceAStores,
  createSliceARegistry,
  permissionsForRole,
  sliceARoles,
} from "@ji/application/registry";
import type {
  CapabilityRegistry,
  InvocationPrincipal,
  SliceACapabilityCatalog,
  SliceAHandlerDeps,
  SliceARole,
} from "@ji/application/registry";
import { createBronRuntimeClient, createPostgresMartsReader } from "@ji/db";
import { user } from "@ji/db/schema/auth";
import { InMemorySearchEngine, SearchAdapter } from "@ji/search";
import { eq } from "drizzle-orm";

/**
 * Marktvragen worker runtime: one lazily-built registry shared across warm
 * task invocations. The full Slice A catalog is composed (same registry the
 * server exposes over REST/MCP) — the chat task only declares the four marts
 * tools, but capability-level authorization still runs on every invoke.
 *
 * `searchAdapter`/`stores` are inert in-memory implementations: no marts
 * capability reads them, and the worker has no Manticore route in every
 * deployment mode.
 */
export interface MarktvragenRuntime {
  readonly close: () => Promise<void>;
  readonly registry: CapabilityRegistry<
    SliceACapabilityCatalog[number]["capability"][]
  >;
  readonly resolvePrincipal: (
    userId: string
  ) => Promise<InvocationPrincipal | null>;
}

const DEPLOYMENT_SCOPE_ID = "catapulze" as const;

let runtimeInstance: MarktvragenRuntime | undefined;

const isSliceARole = (role: string): role is SliceARole =>
  // SAFETY: sliceARoles is a readonly tuple of SliceARole literals; widening to
  // readonly string[] only feeds Array#includes, never writes back.
  (sliceARoles as readonly string[]).includes(role);

const buildRuntime = (databaseUrl: string): MarktvragenRuntime => {
  const runtime = createBronRuntimeClient(databaseUrl);
  const marts = createPostgresMartsReader({ databaseUrl });
  const deps: SliceAHandlerDeps = {
    bronnen: {
      getById: async (bronId) => {
        const record = await runtime.bronPersistence.findById(bronId);
        return record ? (mapPublicBronnen([record])[0] ?? null) : null;
      },
      list: () => listPublicBronnen(runtime.bronPersistence),
    },
    martsReader: marts.reader,
    scopeId: DEPLOYMENT_SCOPE_ID,
    searchAdapter: new SearchAdapter({ engine: new InMemorySearchEngine() }),
    stores: createMemorySliceAStores(),
  };
  const { registry } = createSliceARegistry(deps);

  return {
    close: async () => {
      await Promise.all([runtime.close(), marts.close()]);
    },
    registry,
    // Live role lookup per turn: a demoted user loses marts access on their
    // next message without the session needing to restart.
    resolvePrincipal: async (userId) => {
      const rows = await runtime.database
        .select({ role: user.role })
        .from(user)
        .where(eq(user.id, userId))
        .limit(1);
      const role = rows[0]?.role;
      if (!(role && isSliceARole(role))) {
        return null;
      }
      return {
        kind: "user",
        permissions: permissionsForRole(role),
        subjectId: userId,
      };
    },
  };
};

export const getMarktvragenRuntime = (
  databaseUrl: string
): MarktvragenRuntime => {
  runtimeInstance ??= buildRuntime(databaseUrl);
  return runtimeInstance;
};
