import { describe, expect, it } from "bun:test";

import {
  formatProvisioningOutput,
  parseProvisioningEnvironment,
  provisionAuthUser,
} from "./provisioning";
import type { ProvisioningInput } from "./provisioning";

const validEnvironment = {
  AUTH_BOOTSTRAP_CONFIRM: "PROVISION_AUTH_USER",
  AUTH_BOOTSTRAP_EMAIL: "operator@example.invalid",
  AUTH_BOOTSTRAP_ENABLED: "1",
  AUTH_BOOTSTRAP_NAME: "Operator",
  AUTH_BOOTSTRAP_PASSWORD: "secret-password-123",
  AUTH_BOOTSTRAP_ROLE: "operator",
} as const;

describe("auth user provisioning", () => {
  it("is disabled by default and requires explicit confirmation", () => {
    expect(parseProvisioningEnvironment({})).toEqual({
      code: "BOOTSTRAP_DISABLED",
      ok: false,
    });
    expect(
      parseProvisioningEnvironment({
        ...validEnvironment,
        AUTH_BOOTSTRAP_CONFIRM: undefined,
      })
    ).toEqual({ code: "CONFIRMATION_REQUIRED", ok: false });
  });

  it("rejects an injected role outside the server allowlist", () => {
    expect(
      parseProvisioningEnvironment({
        ...validEnvironment,
        AUTH_BOOTSTRAP_ROLE: "root",
      })
    ).toEqual({ code: "INVALID_BOOTSTRAP_INPUT", ok: false });
  });

  it("refuses an existing email without creating or changing the user", async () => {
    let createCalls = 0;
    const parsed = parseProvisioningEnvironment(validEnvironment);
    if (!parsed.ok) {
      throw new Error("Expected a valid provisioning fixture");
    }

    const result = await provisionAuthUser(parsed.input, {
      createUser: () => {
        createCalls += 1;
        return Promise.resolve({ id: "not-created" });
      },
      hasExistingUser: () => Promise.resolve(true),
      readUserRole: () => Promise.resolve("operator"),
    });

    expect(result).toEqual({ created: false, status: "already_exists" });
    expect(createCalls).toBe(0);
  });

  it("passes credentials separately from the validated server role and verifies readback", async () => {
    const parsed = parseProvisioningEnvironment(validEnvironment);
    if (!parsed.ok) {
      throw new Error("Expected a valid provisioning fixture");
    }
    let receivedCredentials: Omit<ProvisioningInput, "role"> | null = null;

    const result = await provisionAuthUser(parsed.input, {
      createUser: (credentials, role) => {
        receivedCredentials = credentials;
        expect(role).toBe("operator");
        return Promise.resolve({ id: "created-user" });
      },
      hasExistingUser: () => Promise.resolve(false),
      readUserRole: (id) => {
        expect(id).toBe("created-user");
        return Promise.resolve("operator");
      },
    });

    expect(receivedCredentials).not.toHaveProperty("role");
    expect(result).toEqual({
      created: true,
      role: "operator",
      roleVerified: true,
      status: "provisioned",
    });
  });

  it("never includes email or password in operator evidence", async () => {
    const parsed = parseProvisioningEnvironment(validEnvironment);
    if (!parsed.ok) {
      throw new Error("Expected a valid provisioning fixture");
    }
    const result = await provisionAuthUser(parsed.input, {
      createUser: () => Promise.resolve({ id: "created-user" }),
      hasExistingUser: () => Promise.resolve(false),
      readUserRole: () => Promise.resolve("operator"),
    });

    const output = formatProvisioningOutput(result);
    expect(output).not.toContain(validEnvironment.AUTH_BOOTSTRAP_EMAIL);
    expect(output).not.toContain(validEnvironment.AUTH_BOOTSTRAP_PASSWORD);
    expect(output).toBe(
      '{"created":true,"role":"operator","roleVerified":true,"status":"provisioned"}'
    );
  });
});
