/* oxlint-disable-file */
import type {
  ScrapeRunListQuery,
  ScrapeRunReader,
  ScrapeRunView,
} from "@ji/application/registry";
import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import type * as schema from "./schema";

export type ScrapeRunDatabase = PostgresJsDatabase<typeof schema>;
const checkpoint = (
  value: unknown
): Readonly<Record<string, unknown>> | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const allowed = new Set(["cursor", "page", "offset", "hasMore"]);
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => allowed.has(key))
  );
};
const map = (r: any): ScrapeRunView => ({
  aantalGevonden: r.aantal_gevonden,
  bronId: r.bron_id,
  checkpoint: checkpoint(r.checkpoint),
  circuitStatus: r.circuit_status,
  createdAt: new Date(r.created_at),
  failureClass: r.failure_class,
  failureCode: r.failure_code,
  failureMessage: r.failure_message,
  failurePhase: r.failure_phase,
  fouten: r.fouten,
  geindigd: r.geindigd ? new Date(r.geindigd) : null,
  gesloten: r.gesloten,
  gestart: new Date(r.gestart),
  gewijzigd: r.gewijzigd,
  id: r.id,
  lifecycleSummary: { incremented: 0, reopened: 0, reset: 0, staled: 0 },
  nieuw: r.nieuw,
  observationDistribution: {},
  rejected: r.rejected,
  runKind: r.run_kind,
  status: r.status,
  versieAdapter: r.versie_adapter,
});
export class PostgresScrapeRunReader implements ScrapeRunReader {
  constructor(private readonly database: ScrapeRunDatabase) {}
  async getById(id: string) {
    const rows = await this.database.execute<any>(
      sql`SELECT * FROM curated.scrape_run WHERE id=${id}::uuid`
    );
    return rows[0] ? map(rows[0]) : null;
  }
  async list(q: ScrapeRunListQuery) {
    const rows = await this.database.execute<any>(
      sql`SELECT * FROM curated.scrape_run ORDER BY gestart DESC, id DESC LIMIT ${(q.limit ?? 50) + 1}`
    );
    const mapped = rows.map(map);
    const items = mapped.slice(0, q.limit ?? 50);
    return {
      items,
      nextCursor:
        mapped.length > items.length
          ? `${items.at(-1)?.gestart.toISOString()}|${items.at(-1)?.id}`
          : null,
    };
  }
}
