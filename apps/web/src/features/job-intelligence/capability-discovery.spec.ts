import { describe, expect, it } from "bun:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  capabilityDisplayStatus,
  CapabilityDiscovery,
} from "./capability-discovery";

describe("capability discovery entry point", () => {
  it("renders a protocol-free Dutch entry point from the jobs UI", () => {
    const markup = renderToStaticMarkup(
      createElement(CapabilityDiscovery, {
        load: () =>
          Promise.resolve({
            capabilities: [],
            generatedFrom: "slice-a-registry",
            statusCounts: {
              denied: 0,
              disabled: 0,
              executable: 0,
              fixtureStub: 0,
              planned: 0,
            },
          }),
      })
    );

    expect(markup).toContain("Wat kan de assistent?");
    expect(markup).toContain("Mogelijkheden sluiten");
    expect(markup).toContain("dezelfde catalogus als REST en MCP");
  });

  it("shows a permission-denied capability distinctly from availability", () => {
    expect(
      capabilityDisplayStatus({
        allowed: false,
        availability: {
          executable: false,
          reason: "Niet toegestaan",
          safeNextStep: "Vraag toegang aan",
          status: "implemented",
        },
        id: "list_alerts",
        outcome: "Lijst alerts",
        requiredPermission: "operator",
      })
    ).toBe("denied");
  });
});
