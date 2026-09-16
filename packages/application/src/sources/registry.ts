import { asml } from "./asml";
import { bam } from "./bam";
import { bijOranje } from "./bij-oranje";
import { bluetrail } from "./bluetrail";
import { ctm } from "./ctm";
import type { SourceDefinition } from "./definition";
import { eneco } from "./eneco";
import { flinter } from "./flinter";
import { freelancerNl } from "./freelancer-nl";
import { harveynash } from "./harveynash";
import { hays } from "./hays";
import { heijmans } from "./heijmans";
import { hero } from "./hero";
import { inhuurdesk } from "./inhuurdesk";
import { needstaffing } from "./needstaffing";
import { ns } from "./ns";
import { onefellow } from "./onefellow";
import { opdrachtoverheid } from "./opdrachtoverheid";
import { proAct } from "./pro-act";
import { rabobank } from "./rabobank";
import { randstad } from "./randstad";
import { rijkswaterstaat } from "./rijkswaterstaat";
import { striive } from "./striive";
import { tbi } from "./tbi";
import { tenderned } from "./tenderned";
import { tenmonks } from "./tenmonks";
import { unica } from "./unica";
import { vattenfall } from "./vattenfall";
import { volkerwessels } from "./volkerwessels";
import { werkenVoorNederland } from "./werken-voor-nederland";

export type {
  CreateSourceConnectorInput,
  SourceDefinition,
} from "./definition";
export { resolveTenderNedTestImportDays } from "./tenderned";

/** Registry of every ingestable bron. Adding a source = one file in this folder + one line here. */
export const SOURCES = {
  asml,
  bam,
  "bij-oranje": bijOranje,
  bluetrail,
  ctm,
  eneco,
  flinter,
  "freelancer-nl": freelancerNl,
  harveynash,
  hays,
  heijmans,
  hero,
  inhuurdesk,
  needstaffing,
  ns,
  onefellow,
  opdrachtoverheid,
  "pro-act": proAct,
  rabobank,
  randstad,
  rijkswaterstaat,
  striive,
  tbi,
  tenderned,
  tenmonks,
  unica,
  vattenfall,
  volkerwessels,
  "werken-voor-nederland": werkenVoorNederland,
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
