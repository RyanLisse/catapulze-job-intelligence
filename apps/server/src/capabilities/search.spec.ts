import { describe, expect, it } from "bun:test";

import {
  createRestCapabilityHandler,
  restRoutesFromRegistry,
} from "./rest";
import { createTestSliceARegistry } from "@ji/application/registry";

describe("REST search contract", () => {
  it("returns structured syntax errors for invalid Boolean input", async () => {
    const bundle = createTestSliceARegistry();
    const handler = createRestCapabilityHandler(
      bundle.registry,
      restRoutesFromRegistry(bundle.registry)
    );
    const response = await handler({
      req: {
        header: () => "Bearer recruiter:user-1",
        json: async () => ({ query: "(Azure" }),
        method: "POST",
        path: "/v1/aanvragen/search",
        url: "http://localhost/v1/aanvragen/search",
      },
    } as never);
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("SYNTAX_ERROR");
  });

  it("returns hits for a valid authenticated search", async () => {
    const bundle = createTestSliceARegistry();
    await bundle.deps.engine.upsertDocument({
      beschrijving: "Azure kubernetes",
      bronId: "00000000-0000-4000-8000-000000000001",
      contracttype: "detachering",
      id: "00000000-0000-4000-8000-000000000011",
      laatstGezienOp: new Date("2026-08-01T00:00:00.000Z"),
      locatieLand: "NL",
      status: "active",
      tariefMax: 110,
      tariefMin: 90,
      titel: "Azure engineer",
    });
    const handler = createRestCapabilityHandler(
      bundle.registry,
      restRoutesFromRegistry(bundle.registry)
    );
    const response = await handler({
      req: {
        header: () => "Bearer recruiter:user-1",
        json: async () => ({ query: "Azure" }),
        method: "POST",
        path: "/v1/aanvragen/search",
        url: "http://localhost/v1/aanvragen/search",
      },
    } as never);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ids: string[]; total: number };
    expect(body.total).toBe(1);
    expect(body.ids).toEqual(["00000000-0000-4000-8000-000000000011"]);
  });
});
