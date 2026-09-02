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

  it("normalizes email before existence lookup and account creation", async () => {
    const parsed = parseProvisioningEnvironment({
      ...validEnvironment,
      AUTH_BOOTSTRAP_EMAIL: "  Operator@Example.Invalid ",
    });
    if (!parsed.ok) {
      throw new Error("Expected a valid provisioning fixture");
    }
    const observedEmails: string[] = [];

    const result = await provisionAuthUser(parsed.input, {
      createUser: (credentials) => {
        observedEmails.push(credentials.email);
        return Promise.resolve({ id: "created-user" });
      },
      hasExistingUser: (email) => {
        observedEmails.push(email);
        return Promise.resolve(false);
      },
      readUserRole: () => Promise.resolve("operator"),
    });

    expect(parsed.input.email).toBe("operator@example.invalid");
    expect(observedEmails).toEqual([
      "operator@example.invalid",
      "operator@example.invalid",
    ]);
    expect(result.status).toBe("provisioned");
  });

  it("treats a mixed-case retry as the same existing email", async () => {
    const parsed = parseProvisioningEnvironment({
      ...validEnvironment,
      AUTH_BOOTSTRAP_EMAIL: "OPERATOR@EXAMPLE.INVALID",
    });
    if (!parsed.ok) {
      throw new Error("Expected a valid provisioning fixture");
    }
    let createCalls = 0;

    const result = await provisionAuthUser(parsed.input, {
      createUser: () => {
        createCalls += 1;
        return Promise.resolve({ id: "not-created" });
      },
      hasExistingUser: (email) =>
        Promise.resolve(email === "operator@example.invalid"),
      readUserRole: () => Promise.resolve("operator"),
    });

    expect(result).toEqual({ created: false, status: "already_exists" });
    expect(createCalls).toBe(0);
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

  it("treats a concurrent duplicate as already existing", async () => {
    const parsed = parseProvisioningEnvironment(validEnvironment);
    if (!parsed.ok) {
      throw new Error("Expected a valid provisioning fixture");
    }
    let lookupCalls = 0;

    const result = await provisionAuthUser(parsed.input, {
      createUser: () => Promise.reject(new Error("duplicate")),
      hasExistingUser: () => {
        lookupCalls += 1;
        return Promise.resolve(lookupCalls > 1);
      },
      readUserRole: () => Promise.resolve("operator"),
    });

    expect(result).toEqual({ created: false, status: "already_exists" });
    expect(lookupCalls).toBe(2);
  });

  it("reports created-but-unverified evidence when role readback fails", async () => {
    const parsed = parseProvisioningEnvironment(validEnvironment);
    if (!parsed.ok) {
      throw new Error("Expected a valid provisioning fixture");
    }

    const result = await provisionAuthUser(parsed.input, {
      createUser: () => Promise.resolve({ id: "created-user" }),
      hasExistingUser: () => Promise.resolve(false),
      readUserRole: () =>
        Promise.reject(new Error("sensitive database detail")),
    });

    expect(result).toEqual({
      code: "ROLE_READBACK_FAILED",
      created: true,
      roleVerified: false,
      status: "reconciliation_required",
    });
    expect(formatProvisioningOutput(result)).toBe(
      '{"code":"ROLE_READBACK_FAILED","created":true,"roleVerified":false,"status":"reconciliation_required"}'
    );
  });

  it("requires reconciliation when the stored role differs", async () => {
    const parsed = parseProvisioningEnvironment(validEnvironment);
    if (!parsed.ok) {
      throw new Error("Expected a valid provisioning fixture");
    }

    const result = await provisionAuthUser(parsed.input, {
      createUser: () => Promise.resolve({ id: "created-user" }),
      hasExistingUser: () => Promise.resolve(false),
      readUserRole: () => Promise.resolve("recruiter"),
    });

    expect(result).toEqual({
      code: "ROLE_READBACK_FAILED",
      created: true,
      roleVerified: false,
      status: "reconciliation_required",
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
