import { describe, expect, it } from "bun:test";

import {
  activateBronInRegister,
  createBron,
  isPollableBron,
  listPublicBronnen,
} from "./register";
import type { BronRegisterRecord } from "./register";

const tendernedBron = () => ({
  crawlDelayMs: 1000,
  interval: "*/15 * * * *",
  loginVereist: false,
  mappingRef: "fixtures/connectors/tenderned/mapping.json",
  method: "json-api" as const,
  naam: "TenderNed",
  rateLimitPerMinute: 30,
  secretRef: null,
  status: "deferred" as const,
  voorwaardenStatus: "toegestaan" as const,
});

describe("bron register", () => {
  it("creates a deferred bron without scheduling polls", () => {
    const created = createBron(tendernedBron());
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }

    expect(isPollableBron(created.record)).toBe(false);
  });

  it("blocks activation without a passing test-import", () => {
    const created = createBron(tendernedBron());
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }

    const activation = activateBronInRegister({
      bronId: created.record.bronId,
      records: [created.record],
      testImportPassed: false,
    });

    expect(activation.ok).toBe(false);
  });

  it("lists bronnen without exposing secret values", () => {
    const record: BronRegisterRecord = {
      ...tendernedBron(),
      actief: false,
      bronId: "bron-1",
      lastRun: null,
      secretRef: "trigger://tenderned/api-key",
      status: "deferred",
    };

    const [view] = listPublicBronnen([record]);
    expect(view?.hasSecretRef).toBe(true);
    expect(JSON.stringify(view)).not.toContain("trigger://");
  });

  it("activates a bron after a passing test-import", () => {
    const created = createBron(tendernedBron());
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }

    const activation = activateBronInRegister({
      bronId: created.record.bronId,
      records: [created.record],
      testImportPassed: true,
    });

    expect(activation.ok).toBe(true);
    if (activation.ok) {
      expect(activation.record.status).toBe("ready");
      expect(isPollableBron(activation.record)).toBe(true);
    }
  });
});
