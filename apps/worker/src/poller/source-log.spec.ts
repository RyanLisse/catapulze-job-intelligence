import { describe, expect, it } from "bun:test";

import {
  failedSourceLog,
  MAX_ERROR_MESSAGE_LENGTH,
  redactErrorMessage,
} from "./source-log";

const base = { bronSlug: "harveynash", durationMs: 1234 } as const;

describe("failedSourceLog", () => {
  it("truncates a long message to the cap", () => {
    const message = `boom ${"x".repeat(1000)}`;
    const log = failedSourceLog({ ...base, error: new Error(message) });

    expect(log.errorMessage).toHaveLength(MAX_ERROR_MESSAGE_LENGTH);
    expect(log.errorMessage).toBe(message.slice(0, MAX_ERROR_MESSAGE_LENGTH));
    expect(log.errorName).toBe("Error");
    expect(log.bronSlug).toBe("harveynash");
    expect(log.durationMs).toBe(1234);
  });

  it("keeps a short message whole", () => {
    const log = failedSourceLog({
      ...base,
      error: new Error("HTTP 503 from /vacancies"),
    });

    expect(log.errorMessage).toBe("HTTP 503 from /vacancies");
  });

  it("reports zero volume so a failure cannot read as a successful poll", () => {
    const log = failedSourceLog({ ...base, error: new Error("nope") });

    expect(log.curated).toBe(0);
    expect(log.found).toBe(0);
    expect(log.remaining).toBe(0);
  });

  it("names a non-Error throw without inventing a message", () => {
    const log = failedSourceLog({ ...base, error: "plain string" });

    expect(log.errorName).toBe("UnknownError");
    expect(log.errorMessage).toBe("plain string");
  });

  it("omits errorMessage when the error carries none", () => {
    const error = new Error("cleared below");
    error.message = "";
    const log = failedSourceLog({ ...base, error });

    expect(log.errorMessage).toBeUndefined();
    expect(Object.hasOwn(log, "errorMessage")).toBe(false);
  });

  it("carries a custom error name", () => {
    const error = new Error("gateway timeout");
    error.name = "FetchError";

    expect(failedSourceLog({ ...base, error }).errorName).toBe("FetchError");
  });
});

describe("redactErrorMessage", () => {
  it("strips a postgres connection string with its password", () => {
    const redacted = redactErrorMessage(
      "connect ECONNREFUSED postgres://ji_app:hunter2@10.0.0.4:5432/ji tail"
    );

    expect(redacted).toBe("connect ECONNREFUSED [redacted] tail");
    expect(redacted).not.toContain("hunter2");
  });

  it("strips the postgresql:// spelling and every occurrence", () => {
    const redacted = redactErrorMessage(
      "postgresql://a:b@h/d and postgresql://c:d@h/d"
    );

    expect(redacted).toBe("[redacted] and [redacted]");
  });

  it("redacts before truncating so a cut cannot leave a password", () => {
    const redacted = redactErrorMessage(
      `${"p".repeat(MAX_ERROR_MESSAGE_LENGTH - 10)}postgres://ji_app:hunter2@h/d`
    );

    expect(redacted).not.toContain("hunter2");
    expect(redacted).toHaveLength(MAX_ERROR_MESSAGE_LENGTH);
  });

  it("leaves a message without a connection string untouched", () => {
    expect(redactErrorMessage("HTTP 429 from bluetrail")).toBe(
      "HTTP 429 from bluetrail"
    );
  });
});
