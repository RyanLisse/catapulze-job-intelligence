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

const PAGE_SIZE = 1000;
const REPORT_STATEMENT_TIMEOUT_MS = 30_000;

export interface CliArguments {
  readonly bron?: string;
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
}

export const parseArguments = (argv: readonly string[]): CliArguments => {
  let bron: string | undefined;
  for (const argument of argv) {
    const bronMatch = /^--bron=(?<value>.+)$/u.exec(argument);
    if (bronMatch?.groups?.value) {
      bron = bronMatch.groups.value.trim();
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }
  return { bron };
};

/**
 * The pure half: given the freelance-labelled rows, keep only those whose
 * description states an exclusion, and name the phrase that proves it.
 */
export const buildReport = (
  rows: readonly CandidateRow[]
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
  };
};

/**
 * Reads every freelance-labelled row by keyset pagination on the primary key,
 * so the scan covers the whole corpus without holding one long transaction or
 * paying an OFFSET scan per page. The cursor is the last id of the page.
 */
const readFreelanceRows = async (
  sql: postgres.Sql,
  input: CliArguments
): Promise<CandidateRow[]> => {
  const all: CandidateRow[] = [];
  let cursor: string | null = null;
  for (;;) {
    // oxlint-disable-next-line no-await-in-loop -- keyset pages are sequential by design
    const page: postgres.RowList<CandidateRow[]> = await sql<CandidateRow[]>`
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
        AND (${cursor}::uuid IS NULL OR aanvraag.id > ${cursor}::uuid)
      ORDER BY aanvraag.id
      LIMIT ${PAGE_SIZE}
    `;
    all.push(...page);
    if (page.length < PAGE_SIZE) {
      return all;
    }
    cursor = page.at(-1)?.id ?? null;
    if (cursor === null) {
      return all;
    }
  }
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
    return buildReport(await readFreelanceRows(sql, input));
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
  } catch (error) {
    console.error(
      JSON.stringify({
        error:
          error instanceof Error
            ? { message: error.message, name: error.name }
            : { message: String(error), name: "UnknownError" },
        reason: "command_failed",
        status: "error",
      })
    );
    process.exitCode = 1;
  }
}

export { PAGE_SIZE, runReport };
