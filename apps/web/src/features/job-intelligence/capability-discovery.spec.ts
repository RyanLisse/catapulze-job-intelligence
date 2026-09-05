import { describe, expect, it } from "bun:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { CapabilityDiscovery } from "./capability-discovery";

describe("capability discovery entry point", () => {
  it("renders a protocol-free Dutch entry point from the jobs UI", () => {
    const markup = renderToStaticMarkup(
      createElement(CapabilityDiscovery, {
        load: () =>
          Promise.resolve({
            capabilities: [],
            generatedFrom: "slice-a-registry",
            statusCounts: {
              disabled: 0,
              fixtureStub: 0,
              implemented: 0,
              planned: 0,
            },
          }),
      })
    );

    expect(markup).toContain("Wat kan de assistent?");
    expect(markup).toContain("Mogelijkheden sluiten");
    expect(markup).toContain("dezelfde catalogus als REST en MCP");
  });
});
