import { describe, expect, it } from "bun:test";

import { createTestSliceARegistry } from "@ji/application/registry";
import type { Context } from "hono";
import { z } from "zod";

import { createSessionPrincipalResolver } from "./auth";
import { createMcpHandler } from "./mcp";
import { createRestCapabilityHandler, restRoutesFromRegistry } from "./rest";

const currentTime = new Date("2026-09-02T12:00:00.000Z");
const allowedOrigin = "https://app.catapulze.test";
const validBearer = "Bearer valid.signed-session";
const expiredBearer = "Bearer expired.signed-session";

const resolvePrincipal = createSessionPrincipalResolver(
  (headers) => {
    const authorization = headers.get("Authorization");
    const hasValidCookie = headers
      .get("Cookie")
      ?.includes("better-auth.session_token=valid-session");
    if (authorization === validBearer || hasValidCookie) {
      return Promise.resolve({
        session: { expiresAt: new Date("2026-09-02T13:00:00.000Z") },
        user: { id: "recruiter-1", role: "recruiter" },
      });
    }
    if (authorization === expiredBearer) {
      return Promise.resolve({
        session: { expiresAt: new Date("2026-09-02T11:00:00.000Z") },
        user: { id: "recruiter-1", role: "recruiter" },
      });
    }
    return Promise.resolve(null);
  },
  () => currentTime
);

const createRestContext = (
  headers: Headers,
  options: {
    readonly body?: object;
    readonly method?: string;
    readonly onBodyRead?: () => void;
    readonly path?: string;
  } = {}
): Context => {
  const method = options.method ?? "POST";
  const path = options.path ?? "/v1/aanvragen/search";
  const context = {
    req: {
      json: () => {
        options.onBodyRead?.();
        return Promise.resolve(options.body ?? { query: "Azure" });
      },
      method,
      path,
      raw: { headers },
      url: `http://server.test${path}`,
    },
  };
  // SAFETY: The REST handler reads only the request members represented by this focused test double.
  return context as Context;
};

const createMcpContext = (
  headers: Headers,
  name = "search_aanvragen"
): Context => {
  const context = {
    req: {
      json: () =>
        Promise.resolve({
          id: "request-1",
          jsonrpc: "2.0",
          method: "tools/call",
          params: { arguments: { query: "Azure" }, name },
        }),
      raw: { headers },
    },
  };
  // SAFETY: The MCP handler reads only req.json and req.raw.headers from this focused test double.
  return context as Context;
};

const mcpResponseSchema = z.object({
  result: z
    .object({
      isError: z.boolean().optional(),
    })
    .optional(),
});

const readMcpError = async (response: Response): Promise<boolean> => {
  const body = mcpResponseSchema.parse(await response.json());
  return body.result?.isError === true;
};

describe("REST and MCP authentication boundary", () => {
  const bundle = createTestSliceARegistry();
  const rest = createRestCapabilityHandler(
    bundle.registry,
    restRoutesFromRegistry(bundle.registry),
    resolvePrincipal,
    { allowedCookieOrigin: allowedOrigin }
  );
  const mcp = createMcpHandler(bundle.registry, resolvePrincipal);

  it("rejects anonymous REST and MCP calls", async () => {
    const restResponse = await rest(createRestContext(new Headers()));
    const mcpResponse = await mcp(createMcpContext(new Headers()));

    expect(restResponse.status).toBe(401);
    expect(await readMcpError(mcpResponse)).toBe(true);
  });

  it("rejects a forged admin header for REST and MCP writes", async () => {
    const headers = new Headers({ Authorization: "Bearer admin:attacker" });
    const restResponse = await rest(
      createRestContext(headers, {
        body: {},
        path: "/v1/bronnen/00000000-0000-4000-8000-000000000001/runs",
      })
    );
    const mcpResponse = await mcp(createMcpContext(headers, "start_run"));

    expect(restResponse.status).toBe(401);
    expect(await readMcpError(mcpResponse)).toBe(true);
  });

  it("accepts a validated cookie for REST and signed bearer session for MCP", async () => {
    const restResponse = await rest(
      createRestContext(
        new Headers({
          Cookie: "better-auth.session_token=valid-session",
          Origin: allowedOrigin,
        })
      )
    );
    const bearerRestResponse = await rest(
      createRestContext(new Headers({ Authorization: validBearer }))
    );
    const mcpResponse = await mcp(
      createMcpContext(new Headers({ Authorization: validBearer }))
    );

    expect(restResponse.status).toBe(200);
    expect(bearerRestResponse.status).toBe(200);
    expect(await readMcpError(mcpResponse)).toBe(false);
  });

  it("rejects untrusted or missing origins before cookie-authenticated write effects", async () => {
    let bodyReads = 0;
    let resolverCalls = 0;
    const countedResolver = (headers: Headers) => {
      resolverCalls += 1;
      return resolvePrincipal(headers);
    };
    const csrfProtectedRest = createRestCapabilityHandler(
      bundle.registry,
      restRoutesFromRegistry(bundle.registry),
      countedResolver,
      { allowedCookieOrigin: allowedOrigin }
    );
    const onBodyRead = () => {
      bodyReads += 1;
    };
    const cookie = "better-auth.session_token=valid-session";

    const untrusted = await csrfProtectedRest(
      createRestContext(
        new Headers({ Cookie: cookie, Origin: "https://evil.example" }),
        { onBodyRead }
      )
    );
    const missing = await csrfProtectedRest(
      createRestContext(new Headers({ Cookie: cookie }), { onBodyRead })
    );

    expect(untrusted.status).toBe(403);
    expect(missing.status).toBe(403);
    expect(resolverCalls).toBe(0);
    expect(bodyReads).toBe(0);
  });

  it("rejects expired and invalid sessions on both transports", async () => {
    const expiredHeaders = new Headers({ Authorization: expiredBearer });
    const invalidHeaders = new Headers({
      Authorization: "Bearer invalid.signed-session",
    });

    const [expiredRest, invalidRest, expiredMcp, invalidMcp] =
      await Promise.all([
        rest(createRestContext(expiredHeaders)),
        rest(createRestContext(invalidHeaders)),
        mcp(createMcpContext(expiredHeaders)),
        mcp(createMcpContext(invalidHeaders)),
      ]);

    expect(expiredRest.status).toBe(401);
    expect(invalidRest.status).toBe(401);
    expect(await readMcpError(expiredMcp)).toBe(true);
    expect(await readMcpError(invalidMcp)).toBe(true);
  });
});
