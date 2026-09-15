import { UNKNOWN } from "@ji/domain";

import type { NeonV1JobRow } from "./neon-v1-types";

const STARAPPLE_HOST = "www.starapple.nl";
const STARAPPLE_HOST_WITHOUT_WWW = "starapple.nl";
const STARAPPLE_VACATURES_PATH = /^\/vacatures\/(?<slug>[^/]+)\/?$/iu;
const STARAPPLE_LIVE_URL_PREFIX = "https://www.starapple.nl/vacatures/";
const WAYBACK_URL_PREFIX = "https://web.archive.org/web/";

type MotianLifecycleJob = Pick<
  NeonV1JobRow,
  "archived_at" | "deleted_at" | "status"
>;

const decodeOnce = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const normalizeStarappleSlug = (value: string): string =>
  decodeOnce(value.trim())
    .replaceAll(/[\s_]+/gu, "-")
    .replaceAll(/-+/gu, "-")
    .replaceAll(/^-+|-+$/gu, "")
    .toLowerCase();

const isStarapplePlatform = (platform: string): boolean => {
  const normalized = platform.trim().toLowerCase();
  return normalized === "starapple" || normalized === "starapple-nl";
};

const slugFromExternalUrl = (externalUrl: string): string | null => {
  let parsed: URL;
  try {
    parsed = new URL(externalUrl);
  } catch {
    return null;
  }

  const hostname = parsed.hostname.toLowerCase();
  if (hostname !== STARAPPLE_HOST && hostname !== STARAPPLE_HOST_WITHOUT_WWW) {
    return null;
  }

  const match = STARAPPLE_VACATURES_PATH.exec(parsed.pathname);
  return match?.groups?.slug ?? null;
};

const slugForJob = (job: NeonV1JobRow): string | null => {
  const externalUrl = job.external_url?.trim();
  const urlSlug = externalUrl ? slugFromExternalUrl(externalUrl) : null;
  const rawSlug = urlSlug ?? job.external_id;
  const slug = normalizeStarappleSlug(rawSlug);
  return slug.length > 0 ? slug : null;
};

/** Keep this predicate aligned with the lifecycle used by the Neon backfill. */
export const isMotianJobClosed = (
  job: MotianLifecycleJob,
  sourceStatus = job.status?.trim() || null
): boolean => {
  const sourceHasArchiveSignal =
    (job.archived_at !== null && job.archived_at !== undefined) ||
    (job.deleted_at !== null && job.deleted_at !== undefined);
  const sourceIsClosed =
    sourceHasArchiveSignal ||
    (sourceStatus !== null && sourceStatus.toLowerCase() !== "open");
  return sourceIsClosed;
};

const liveUrlForSlug = (slug: string): string =>
  `${STARAPPLE_LIVE_URL_PREFIX}${slug}/`;

/**
 * Resolve a Motian row to the canonical source URL used by Catapulze.
 * Starapple's external URL is treated as a slug hint only; other platforms
 * retain the existing Motian URL behavior until their templates are known.
 */
export const resolveMotianBronUrl = (
  job: NeonV1JobRow
): string | typeof UNKNOWN => {
  if (!isStarapplePlatform(job.platform)) {
    return job.external_url?.trim() || UNKNOWN;
  }

  const slug = slugForJob(job);
  if (!slug) {
    return UNKNOWN;
  }

  const canonicalLiveUrl = liveUrlForSlug(slug);
  return isMotianJobClosed(job)
    ? `${WAYBACK_URL_PREFIX}${canonicalLiveUrl}`
    : canonicalLiveUrl;
};
