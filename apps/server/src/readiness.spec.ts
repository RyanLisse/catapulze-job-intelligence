import { describe, expect, it, mock } from "bun:test";

import { Hono } from "hono";

import { createReadinessHandler } from "./readiness";

describe("GET /readyz", () => {
  it("returns 200 when the database and migration are ready", async () => {
    const reportFailure = mock(() => {});
    const app = new Hono();
    app.get(
      "/readyz",
      createReadinessHandler(
        () => Promise.resolve({ ready: true }),
        reportFailure
      )
    );

    const response = await app.request("/readyz");

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("OK");
    expect(reportFailure).not.toHaveBeenCalled();
  });

  it("returns a generic 503 and reports a migration mismatch", async () => {
    const reportFailure = mock(() => {});
    const app = new Hono();
    app.get(
      "/readyz",
      createReadinessHandler(
        () =>
          Promise.resolve({
            ready: false,
            reason: "migration_mismatch" as const,
          }),
        reportFailure
      )
    );

    const response = await app.request("/readyz");

    expect(response.status).toBe(503);
    expect(await response.text()).toBe("Service Unavailable");
    expect(reportFailure).toHaveBeenCalledWith({
      ready: false,
      reason: "migration_mismatch",
    });
  });

  it("returns the same generic 503 and reports a database error", async () => {
    const reportFailure = mock(() => {});
    const app = new Hono();
    app.get(
      "/readyz",
      createReadinessHandler(
        () =>
          Promise.resolve({ ready: false, reason: "database_error" as const }),
        reportFailure
      )
    );

    const response = await app.request("/readyz");

    expect(response.status).toBe(503);
    expect(await response.text()).toBe("Service Unavailable");
    expect(reportFailure).toHaveBeenCalledWith({
      ready: false,
      reason: "database_error",
    });
  });
});
