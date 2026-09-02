import { describe, expect, it } from "bun:test";

import { createSessionPrincipalResolver } from "./auth";

const now = new Date("2026-09-02T12:00:00.000Z");

const activeSession = (role: string, id = "user-1") => ({
  session: { expiresAt: new Date("2026-09-02T13:00:00.000Z") },
  user: { id, role },
});

describe("capability principal resolution", () => {
  it("does not treat an anonymous request as a principal", async () => {
    const resolve = createSessionPrincipalResolver(
      () => Promise.resolve(null),
      () => now
    );

    expect(await resolve(new Headers(), "req-anonymous")).toEqual({
      ok: true,
      principal: null,
    });
  });

  it("does not parse a caller-declared admin role", async () => {
    const resolve = createSessionPrincipalResolver(
      (headers) => {
        expect(headers.get("Authorization")).toBe("Bearer admin:attacker");
        return Promise.resolve(null);
      },
      () => now
    );

    const resolution = await resolve(
      new Headers({ Authorization: "Bearer admin:attacker" }),
      "req-forged"
    );

    expect(resolution).toEqual({ ok: true, principal: null });
  });

  it("maps a validated cookie session to its server-owned role", async () => {
    const resolve = createSessionPrincipalResolver(
      () => Promise.resolve(activeSession("recruiter")),
      () => now
    );

    const resolution = await resolve(
      new Headers({ Cookie: "better-auth.session_token=signed-cookie" }),
      "req-cookie"
    );

    expect(resolution.ok).toBe(true);
    if (!resolution.ok) {
      return;
    }
    const { principal } = resolution;
    expect(principal?.kind).toBe("user");
    expect(principal?.subjectId).toBe("user-1");
    expect(principal?.permissions.has("recruiter")).toBe(true);
    expect(principal?.permissions.has("operator")).toBe(false);
  });

  it("maps a validated bearer session without reading a role from the token", async () => {
    const resolve = createSessionPrincipalResolver(
      () => Promise.resolve(activeSession("admin", "admin-1")),
      () => now
    );

    const resolution = await resolve(
      new Headers({ Authorization: "Bearer opaque.signed-session" }),
      "req-bearer"
    );

    expect(resolution.ok).toBe(true);
    if (!resolution.ok) {
      return;
    }
    const { principal } = resolution;
    expect(principal?.kind).toBe("agent");
    expect(principal?.subjectId).toBe("admin-1");
    expect(principal?.permissions.has("admin")).toBe(true);
    expect(principal?.permissions.has("operator")).toBe(true);
  });

  it("does not let an invalid Authorization header fall back to a cookie", async () => {
    const resolve = createSessionPrincipalResolver(
      (headers) => {
        expect(headers.has("Cookie")).toBe(false);
        expect(headers.get("Authorization")).toBe("Bearer forged.token");
        return Promise.resolve(null);
      },
      () => now
    );

    const resolution = await resolve(
      new Headers({
        Authorization: "Bearer forged.token",
        Cookie: "better-auth.session_token=otherwise-valid",
      }),
      "req-no-fallback"
    );

    expect(resolution).toEqual({ ok: true, principal: null });
  });

  it("treats expired and malformed-role sessions as unauthenticated", async () => {
    const expired = createSessionPrincipalResolver(
      () =>
        Promise.resolve({
          session: { expiresAt: new Date("2026-09-02T11:59:59.000Z") },
          user: { id: "user-1", role: "recruiter" },
        }),
      () => now
    );
    const invalidRole = createSessionPrincipalResolver(
      () => Promise.resolve(activeSession("root")),
      () => now
    );
    expect(await expired(new Headers(), "req-expired")).toEqual({
      ok: true,
      principal: null,
    });
    expect(await invalidRole(new Headers(), "req-role")).toEqual({
      ok: true,
      principal: null,
    });
  });

  it("returns a typed unavailable result and logs only sanitized evidence", async () => {
    const events: object[] = [];
    const failed = createSessionPrincipalResolver(
      () => Promise.reject(new Error("DO_NOT_EXPOSE_LOOKUP_DETAIL")),
      () => now,
      (event) => events.push(event)
    );

    const resolution = await failed(new Headers(), "req-unavailable");

    expect(resolution).toEqual({
      error: {
        code: "AUTH_SESSION_UNAVAILABLE",
        message: "Authentication service unavailable",
        requestId: "req-unavailable",
      },
      ok: false,
    });
    expect(events).toEqual([
      {
        code: "AUTH_SESSION_LOOKUP_UNAVAILABLE",
        requestId: "req-unavailable",
      },
    ]);
    expect(JSON.stringify({ events, resolution })).not.toContain(
      "DO_NOT_EXPOSE_LOOKUP_DETAIL"
    );
  });
});
