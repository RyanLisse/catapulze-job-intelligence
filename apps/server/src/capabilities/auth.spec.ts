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

    expect(await resolve(new Headers())).toBeNull();
  });

  it("does not parse a caller-declared admin role", async () => {
    const resolve = createSessionPrincipalResolver(
      (headers) => {
        expect(headers.get("Authorization")).toBe("Bearer admin:attacker");
        return Promise.resolve(null);
      },
      () => now
    );

    const principal = await resolve(
      new Headers({ Authorization: "Bearer admin:attacker" })
    );

    expect(principal).toBeNull();
  });

  it("maps a validated cookie session to its server-owned role", async () => {
    const resolve = createSessionPrincipalResolver(
      () => Promise.resolve(activeSession("recruiter")),
      () => now
    );

    const principal = await resolve(
      new Headers({ Cookie: "better-auth.session_token=signed-cookie" })
    );

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

    const principal = await resolve(
      new Headers({ Authorization: "Bearer opaque.signed-session" })
    );

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

    const principal = await resolve(
      new Headers({
        Authorization: "Bearer forged.token",
        Cookie: "better-auth.session_token=otherwise-valid",
      })
    );

    expect(principal).toBeNull();
  });

  it("fails closed for expired, malformed-role, and failed lookups", async () => {
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
    const failed = createSessionPrincipalResolver(() =>
      Promise.reject(new Error("session store unavailable"))
    );

    expect(await expired(new Headers())).toBeNull();
    expect(await invalidRole(new Headers())).toBeNull();
    expect(await failed(new Headers())).toBeNull();
  });
});
