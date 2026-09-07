import { describe, expect, it } from "bun:test";

import { resolveCrossSubDomainCookieDomain } from "./security-config";

describe("resolveCrossSubDomainCookieDomain", () => {
  it("derives the shared sslip parent for demo app + api hosts", () => {
    expect(
      resolveCrossSubDomainCookieDomain(
        "https://api.23-88-60-222.sslip.io",
        "https://app.23-88-60-222.sslip.io"
      )
    ).toBe(".23-88-60-222.sslip.io");
  });

  it("derives a conventional sibling-subdomain parent", () => {
    expect(
      resolveCrossSubDomainCookieDomain(
        "https://api.example.com",
        "https://app.example.com"
      )
    ).toBe(".example.com");
  });

  it("stays disabled for localhost / loopback pairs", () => {
    expect(
      resolveCrossSubDomainCookieDomain(
        "http://localhost:3000",
        "http://localhost:3001"
      )
    ).toBeNull();
    expect(
      resolveCrossSubDomainCookieDomain(
        "http://127.0.0.1:3000",
        "http://127.0.0.1:3001"
      )
    ).toBeNull();
  });

  it("stays disabled when hosts are identical", () => {
    expect(
      resolveCrossSubDomainCookieDomain(
        "https://api.example.com",
        "https://api.example.com"
      )
    ).toBeNull();
  });
});
