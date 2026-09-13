/**
 * CTP-491 report-only diagnostic.
 *
 * Lists curated aanvragen still labelled `contracttype = 'freelance'` whose
 * current description states an explicit ZZP or freelance exclusion. Read-only
 * by construction: the connection is opened in a read-only transaction and the
 * tool issues a single SELECT. Applying the correction is a separate, audited
 * step -- see docs/runbooks/zzp-negation-labels.md.
 */

import { matchFreelanceExclusion } from "@ji/application/normalise";
import postgres from "postgres";

const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 5000;
const REPORT_STATEMENT_TIMEOUT_MS = 30_000;

export interface CliArguments {
  readonly bron?: string;
  readonly limit: number;
}

export interface CandidateRow {
  readonly beschrijving: string;
  readonly bronNaam: string;
  readonly id: string;
  readonly titel: string;
  readonly versie: number;
}

export interface MislabelledCandidate {
  readonly bron: string;
  readonly id: string;
  readonly matchedPhrase: string;
  readonly titel: string;
  readonly versie: number;
}

export interface ZzpNegationReport {
  readonly byBron: Record<string, number>;
  readonly candidates: readonly MislabelledCandidate[];
  readonly mislabelled: number;
  readonly scanned: number;
  readonly truncated: boolean;
}

export const parseArguments = (argv: readonly string[]): CliArguments => {
  let limit = DEFAULT_LIMIT;
  let bron: string | undefined;
  for (const argument of argv) {
    const limitMatch = /^--limit=(?<value>\d+)$/u.exec(argument);
    if (limitMatch?.groups?.value) {
      limit = Math.trunc(Number(limitMatch.groups.value));
      continue;
    }
    const bronMatch = /^--bron=(?<value>.+)$/u.exec(argument);
    if (bronMatch?.groups?.value) {
      bron = bronMatch.groups.value.trim();
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }
  if (limit < 1 || limit > MAX_LIMIT) {
    throw new Error(`--limit must be between 1 and ${MAX_LIMIT}`);
  }
  return { bron, limit };
};

/**
 * The pure half: given the freelance-labelled rows, keep only those whose
 * description states an exclusion, and name the phrase that proves it.
 */
export const buildReport = (
  rows: readonly CandidateRow[],
  limit: number
): ZzpNegationReport => {
  const candidates: MislabelledCandidate[] = [];
  const byBron: Record<string, number> = {};
  for (const row of rows) {
    const matchedPhrase = matchFreelanceExclusion(
      `${row.titel}\n${row.beschrijving}`
    );
    if (matchedPhrase === null) {
      continue;
    }
    candidates.push({
      bron: row.bronNaam,
      id: row.id,
      matchedPhrase,
      titel: row.titel,
      versie: row.versie,
    });
    byBron[row.bronNaam] = (byBron[row.bronNaam] ?? 0) + 1;
  }
  return {
    byBron,
    candidates,
    mislabelled: candidates.length,
    scanned: rows.length,
    truncated: rows.length >= limit,
  };
};

const readFreelanceRows = async (
  sql: postgres.Sql,
  input: CliArguments
): Promise<CandidateRow[]> => {
  const rows = await sql<CandidateRow[]>`
    SELECT
      aanvraag.id::text AS "id",
      aanvraag.titel AS "titel",
      aanvraag.beschrijving AS "beschrijving",
      aanvraag.versie AS "versie",
      bron.naam AS "bronNaam"
    FROM curated.aanvraag AS aanvraag
    JOIN curated.bron AS bron ON bron.id = aanvraag.bron_id
    WHERE aanvraag.contracttype = 'freelance'
      AND (${input.bron ?? null}::text IS NULL OR bron.naam = ${input.bron ?? null})
    ORDER BY aanvraag.id
    LIMIT ${input.limit}
  `;
  return [...rows];
};

const runReport = async (input: CliArguments): Promise<ZzpNegationReport> => {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for the report-only diagnostic");
  }
  const sql = postgres(databaseUrl, {
    connect_timeout: 10,
    connection: {
      default_transaction_read_only: true,
      statement_timeout: REPORT_STATEMENT_TIMEOUT_MS,
    },
    idle_timeout: 20,
    max: 1,
  });
  try {
    return buildReport(await readFreelanceRows(sql, input), input.limit);
  } finally {
    await sql.end({ timeout: 5 });
  }
};

const main = async (): Promise<void> => {
  const arguments_ = parseArguments(process.argv.slice(2));
  console.log(JSON.stringify(await runReport(arguments_), null, 2));
};

if (import.meta.main) {
  try {
    await main();
  } catch {
    console.error(
      JSON.stringify({ reason: "command_failed", status: "error" })
    );
    process.exitCode = 1;
  }
}

export { DEFAULT_LIMIT, MAX_LIMIT, runReport };
