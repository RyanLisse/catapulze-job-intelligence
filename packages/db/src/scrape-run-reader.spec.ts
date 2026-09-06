import { describe, expect, it } from "bun:test";

import { PostgresScrapeRunReader } from "./scrape-run-reader";
import type { ScrapeRunDatabase } from "./scrape-run-reader";

// SAFETY: The test double implements the reader's only used operation and returns a representative database row.
const database = {
  execute: () =>
    Promise.resolve([
      {
        aantal_gevonden: 0,
        bron_id: "00000000-0000-4000-8000-000000000001",
        checkpoint: {
          apiKey: "must-not-leak",
          cursor: "next-page",
          hasMore: true,
          page: 2,
          secretToken: "must-not-leak",
        },
        circuit_status: "closed",
        created_at: "2026-09-06T00:00:00.000Z",
        failure_class: null,
        failure_code: null,
        failure_message: null,
        failure_phase: null,
        fouten: 0,
        geindigd: null,
        gesloten: 0,
        gestart: "2026-09-06T00:00:00.000Z",
        gewijzigd: 0,
        id: "00000000-0000-4000-8000-000000000099",
        nieuw: 0,
        rejected: 0,
        run_kind: "poll",
        status: "running",
        versie_adapter: null,
      },
    ]),
  // SAFETY: The test double implements the reader's only used operation and returns a representative database row.
} as ScrapeRunDatabase;

describe("PostgresScrapeRunReader", () => {
  it("projects checkpoint data to the public allowlist", async () => {
    const result = await new PostgresScrapeRunReader(database).getById(
      "00000000-0000-4000-8000-000000000099"
    );

    expect(result?.checkpoint).toEqual({
      cursor: "next-page",
      hasMore: true,
      page: 2,
    });
    expect(JSON.stringify(result)).not.toContain("must-not-leak");
    expect(JSON.stringify(result)).not.toContain("apiKey");
    expect(JSON.stringify(result)).not.toContain("secretToken");
  });
});
