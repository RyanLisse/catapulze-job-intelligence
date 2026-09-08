import { describe, expect, it } from "bun:test";

import {
  createTestSliceARegistry,
  permissionsForRole,
} from "@ji/application/registry";
import { Hono } from "hono";

import type { PrincipalResolver } from "./auth";
import {
  createRestCapabilityHandler,
  matchPath,
  restRouteSpecificity,
  restRoutesFromRegistry,
} from "./rest";

const adminResolver: PrincipalResolver = () =>
  Promise.resolve({
    ok: true,
    principal: {
      kind: "user",
      permissions: permissionsForRole("admin"),
      subjectId: "rest-routing-admin",
    },
  });

const mountRest = () => {
  const bundle = createTestSliceARegistry();
  const routes = restRoutesFromRegistry(bundle.registry);
  const rest = createRestCapabilityHandler(
    bundle.registry,
    routes,
    adminResolver,
    {
      allowedCookieOrigin: null,
    }
  );
  const app = new Hono();
  app.all("/v1/*", rest);
  return { app, routes };
};

describe("REST route specificity (CTP-417 overlap shadow)", () => {
  it("ranks static /v1/bronnen/overlap above /v1/bronnen/{id}", () => {
    expect(restRouteSpecificity("/v1/bronnen/overlap")).toBeGreaterThan(
      restRouteSpecificity("/v1/bronnen/{id}")
    );
  });

  it("lists get_bron_overlap before get_bron for the overlap pathname", () => {
    const { routes } = mountRest();
    const pathname = "/v1/bronnen/overlap";
    const matches = routes.filter(
      (route) =>
        route.method === "GET" &&
        matchPath(route.pathPattern, pathname) !== null
    );
    expect(matches.map((route) => route.capabilityId)).toEqual([
      "get_bron_overlap",
      "get_bron",
    ]);
  });

  it("serves GET /v1/bronnen/overlap via get_bron_overlap (200)", async () => {
    const { app } = mountRest();
    const response = await app.request("/v1/bronnen/overlap");
    expect(response.status).toBe(200);
    // SAFETY: get_bron_overlap output schema guarantees this shape on 200.
    const body = (await response.json()) as {
      readonly overlapGroepCount: number;
      readonly perBron: unknown[];
      readonly topGroups: unknown[];
    };
    expect(body.overlapGroepCount).toBe(0);
    expect(body.perBron).toEqual([]);
    expect(body.topGroups).toEqual([]);
  });

  it("still resolves UUID bron ids through get_bron", async () => {
    const { app } = mountRest();
    const response = await app.request(
      "/v1/bronnen/00000000-0000-4000-8000-000000000001"
    );
    expect(response.status).toBe(200);
    // SAFETY: get_bron output includes bronId for a known fixture id.
    const body = (await response.json()) as { readonly bronId: string };
    expect(body.bronId).toBe("00000000-0000-4000-8000-000000000001");
  });

  it("keeps /v1/bronnen/overview as get_bron INVALID_INPUT (not a capability)", async () => {
    // No REST /v1/bronnen/overview — operator KPIs use GET /v1/dashboard.
    // Without a static sibling, {id} still captures the slug and UuidString
    // rejects it. Same failure mode Catapulze saw next to overlap; separate
    // from the overlap shadow once overlap is unshadowed.
    const { app } = mountRest();
    const response = await app.request("/v1/bronnen/overview");
    expect(response.status).toBe(400);
    // SAFETY: registry INVALID_INPUT failures always carry error.code.
    const body = (await response.json()) as {
      readonly error: { readonly code: string };
    };
    expect(body.error.code).toBe("INVALID_INPUT");
  });
});
