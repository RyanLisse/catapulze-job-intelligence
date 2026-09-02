import { describe, expect, it } from "bun:test";

import { parseBooleanQuery } from "@ji/domain";

import { InMemorySearchVersionStore } from "../version";
import { ManticoreSearchEngine } from "./engine";
import {
  cleanupLiveDocuments,
  requireLiveManticoreUrl,
} from "./live-test-hygiene";

// Live integration test against a real Manticore instance (see
// docker-compose.yml's `manticore` service, or scripts/docker-compose-smoke.sh).
// Skipped entirely unless MANTICORE_URL is set — matches golden.spec.ts's
// convention so `bun run gate` (which never sets MANTICORE_URL) stays fast
// and mock-only.
const manticoreUrl = requireLiveManticoreUrl(
  process.env.MANTICORE_URL,
  process.env.MANTICORE_REQUIRE_LIVE === "1"
);

describe.skipIf(!manticoreUrl)(
  "Manticore document-id live integration (RJC-356)",
  () => {
    it("replaces a doc, finds it by its original string id, then deletes it", async () => {
      if (!manticoreUrl) {
        throw new Error("Live test was not skipped without MANTICORE_URL");
      }
      const engine = ManticoreSearchEngine.fromUrl(
        manticoreUrl,
        new InMemorySearchVersionStore()
      );
      // A persisted Manticore volume can already hold docs from prior runs, so
      // a generic query (e.g. "Azure") could be crowded out of the default
      // top-10 hits. Search on a run-unique token instead — no other document,
      // past or present, can match it. Hyphens are stripped: the boolean
      // parser treats a leading "-" as NOT, and a bare term should stay a
      // single unbroken token.
      const runToken = `livespec${crypto.randomUUID().replaceAll("-", "")}`;
      const parsed = parseBooleanQuery(runToken);
      if (!parsed.ok) {
        throw new Error("Expected run-token query parse success");
      }

      const documentId = `live-doc-${crypto.randomUUID()}`;
      try {
        await engine.upsertDocument({
          beschrijving: `Azure platform engineer senior ${runToken}`,
          bronId: "bron-live",
          contracttype: "detachering",
          id: documentId,
          laatstGezienOp: new Date("2026-08-01T00:00:00.000Z"),
          locatieLand: "NL",
          status: "active",
          tariefMax: 120,
          tariefMin: 80,
          titel: "Platform engineer Azure",
        });
        await engine.applyBatch({ appliedSequence: 1n, mutations: [] });

        const found = await engine.search({
          ast: parsed.ast,
          filters: {},
          limit: 10,
          offset: 0,
        });

        expect(found.total).toBeGreaterThanOrEqual(1);
        // The hit id must be the ORIGINAL string id (read back via
        // _source.document_id in client.ts), not Manticore's internal numeric
        // hash — this is the RJC-356 fix under test.
        expect(found.hits.some((hit) => hit.id === documentId)).toBe(true);

        await engine.deleteDocument(documentId);

        const afterDelete = await engine.search({
          ast: parsed.ast,
          filters: {},
          limit: 10,
          offset: 0,
        });

        expect(afterDelete.hits.some((hit) => hit.id === documentId)).toBe(
          false
        );
      } finally {
        await cleanupLiveDocuments(engine, [documentId]);
      }
    });
  }
);
