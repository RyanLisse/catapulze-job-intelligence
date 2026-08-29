import { describe, expect, it } from "bun:test";

import {
  createTenderNedConnector,
  requestedListingSize,
  TENDER_NED_MAX_PAGE_SIZE,
} from "@ji/connectors/tenderned";

describe("TenderNed connector", () => {
  it("never requests a listing page size above 100", () => {
    expect(requestedListingSize(101)).toBe(TENDER_NED_MAX_PAGE_SIZE);
    expect(requestedListingSize(50)).toBe(50);
  });

  it("binds the connector to the supplied bron id", () => {
    const connector = createTenderNedConnector({ bronId: "bron-test" });
    expect(connector.bronId).toBe("bron-test");
  });
});
