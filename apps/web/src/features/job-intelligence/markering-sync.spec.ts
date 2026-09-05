import { describe, expect, it } from "bun:test";

import { hasNewerMarkering, markeringMutationOutcome } from "./markering-sync";
import { CapabilityRequestError } from "./rest/capability-client";
import type { JobMarkering } from "./types";

const marker = (
  revision: number,
  status: JobMarkering["status"] = "relevant"
) =>
  ({
    reden: null,
    revision,
    status,
    updatedAt: `2026-09-05T00:00:0${revision}.000Z`,
  }) satisfies JobMarkering;

describe("bounded markering readback", () => {
  it("applies only newer resource versions and makes repeats idempotent", () => {
    const current = marker(2);
    expect(hasNewerMarkering(current, marker(1, "gevolgd"))).toBe(false);
    expect(hasNewerMarkering(current, marker(2))).toBe(false);
    expect(hasNewerMarkering(current, marker(3, "gevolgd"))).toBe(true);
  });

  it("classifies known rejection separately from post-commit uncertainty", () => {
    const rejected = new CapabilityRequestError(403, {
      error: { code: "FORBIDDEN", message: "denied" },
    });
    const unavailable = new CapabilityRequestError(503, {
      error: { code: "UNAVAILABLE", message: "retry" },
    });
    expect(markeringMutationOutcome(rejected)).toBe("failure");
    expect(markeringMutationOutcome(unavailable)).toBe("uncertain");
    expect(markeringMutationOutcome(new TypeError("network"))).toBe(
      "uncertain"
    );
  });
});
