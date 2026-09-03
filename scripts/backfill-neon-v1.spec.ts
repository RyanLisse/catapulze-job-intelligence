import { describe, expect, it } from "bun:test";

import type {
  BackfillFailureDiagnostic,
  BackfillFailureEvidence,
} from "@ji/application/backfill";

import { formatBackfillFailureDiagnostic } from "./backfill-neon-v1";

const failure: BackfillFailureEvidence = {
  code: "PROVENANCE_WRITE_FAILED",
  phase: "provenance",
};

class PostgresError extends Error {
  override readonly name = "PostgresError";
}

describe("formatBackfillFailureDiagnostic", () => {
  it("prints row context and redacts postgres URLs from the cause message", () => {
    const cause = new PostgresError(
      "duplicate at postgresql://example.invalid/db via postgres://fallback.invalid/db"
    );
    const diagnostic: BackfillFailureDiagnostic = {
      error: new Error("backfill wrapper", { cause }),
      platform: "nationalevacaturebank",
      sourceJobId: "v1-job-000001",
    };

    const formatted = formatBackfillFailureDiagnostic(failure, diagnostic);

    expect(formatted).toBe(
      'backfill failure code=PROVENANCE_WRITE_FAILED phase=provenance platform="nationalevacaturebank" sourceJobId="v1-job-000001" cause="PostgresError" message="duplicate at <url> via <url>"'
    );
    expect(formatted).not.toContain("example.invalid");
    expect(formatted).not.toContain("fallback.invalid");
  });

  it("does not stringify non-Error causes or allow multiline diagnostics", () => {
    const diagnostic: BackfillFailureDiagnostic = {
      error: new Error("backfill wrapper", {
        cause: { payload: "must-not-be-printed" },
      }),
      platform: "source\nplatform",
      sourceJobId: "row\ridentifier",
    };

    const formatted = formatBackfillFailureDiagnostic(failure, diagnostic);

    expect(formatted).toContain('platform="source platform"');
    expect(formatted).toContain('sourceJobId="row identifier"');
    expect(formatted).toContain('cause="UnknownError"');
    expect(formatted).toContain('message="No underlying error"');
    expect(formatted).not.toContain("must-not-be-printed");
    expect(formatted.split("\n")).toHaveLength(1);
  });
});
