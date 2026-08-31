import { bluetrail } from "./bluetrail";
import type { SourceDefinition } from "./definition";
import { harveynash } from "./harveynash";
import { hero } from "./hero";
import { inhuurdesk } from "./inhuurdesk";
import { needstaffing } from "./needstaffing";
import { opdrachtoverheid } from "./opdrachtoverheid";
import { proAct } from "./pro-act";
import { striive } from "./striive";
import { tenderned } from "./tenderned";

export type {
  CreateSourceConnectorInput,
  SourceDefinition,
} from "./definition";
export { resolveTenderNedTestImportDays } from "./tenderned";

/** Registry of every ingestable bron. Adding a source = one file in this folder + one line here. */
export const SOURCES = {
  bluetrail,
  harveynash,
  hero,
  inhuurdesk,
  needstaffing,
  opdrachtoverheid,
  "pro-act": proAct,
  striive,
  tenderned,
} as const satisfies Record<string, SourceDefinition>;

export type SupportedBronSlug = keyof typeof SOURCES;

export const isSupportedBronSlug = (
  value: string
): value is SupportedBronSlug => Object.hasOwn(SOURCES, value);

/** Alphabetical so `z.enum` shapes and CLI help stay stable across additions. */
export const SUPPORTED_BRON_SLUGS: readonly SupportedBronSlug[] = Object.keys(
  SOURCES
)
  .filter(isSupportedBronSlug)
  .toSorted();

const normaliseNaam = (naam: string): string => naam.trim().toLowerCase();

/** `record.naam` is the only source-identifying field on a bron row (no slug column yet),
 * so match it case-insensitively against each definition's own `naam`. */
export const findSourceByNaam = <Source extends Pick<SourceDefinition, "naam">>(
  sources: readonly Source[],
  naam: string
): Source | undefined => {
  const wanted = normaliseNaam(naam);
  return sources.find((source) => normaliseNaam(source.naam) === wanted);
};

export const resolveSourceByNaam = (
  naam: string
): (typeof SOURCES)[SupportedBronSlug] | undefined =>
  findSourceByNaam(Object.values(SOURCES), naam);
