/* oxlint-disable anti-slop/no-unknown-parameters, anti-slop/no-runtime-typeof -- This is the JSON-LD extraction I/O boundary: <script type="application/ld+json"> blocks on arbitrary source HTML carry untyped, source-specific JobPosting shapes (plain object, array, or @graph-wrapped), so the object/array narrowing contract is established here. */
import type { JsonLdLabelBlockField, JsonLdNode, JsonLdValue } from "./types";

const SCRIPT_PATTERN =
  /<script[^>]*type=["']application\/ld\+json["'][^>]*>(?<content>[\s\S]*?)<\/script>/giu;
const NEXT_DATA_PATTERN =
  /<script[^>]*id=["']__NEXT_DATA__["'][^>]*>(?<content>[\s\S]*?)<\/script>/iu;
const VIKE_PAGE_CONTEXT_PATTERN =
  /<script[^>]*id=["']vike_pageContext["'][^>]*>(?<content>[\s\S]*?)<\/script>/iu;
const WORKDAY_APPLY_HREF_PATTERN =
  /href=["'](?<href>https?:\/\/[^"']*myworkdayjobs\.com[^"']*)["']/iu;

const isJsonLdNode = (value: unknown): value is JsonLdNode =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const collectNodes = (value: unknown, out: JsonLdNode[]): void => {
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectNodes(entry, out);
    }
    return;
  }
  if (!isJsonLdNode(value)) {
    return;
  }
  const graph = value["@graph"];
  if (Array.isArray(graph)) {
    collectNodes(graph, out);
    return;
  }
  out.push(value);
};

/** Extracts every JSON-LD node from `<script type="application/ld+json">` blocks in `html`,
 * expanding `@graph` wrappers and tolerating malformed JSON blocks by skipping them. */
export const extractJsonLdNodes = (html: string): JsonLdNode[] => {
  const nodes: JsonLdNode[] = [];
  SCRIPT_PATTERN.lastIndex = 0;
  let match = SCRIPT_PATTERN.exec(html);
  while (match) {
    const raw = match.groups?.content?.trim();
    if (raw) {
      try {
        collectNodes(JSON.parse(raw), nodes);
      } catch {
        // Malformed JSON-LD block on the source page: skip it rather than fail the fetch.
      }
    }
    match = SCRIPT_PATTERN.exec(html);
  }
  return nodes;
};

const isJobPostingType = (value: JsonLdValue | undefined): boolean => {
  if (typeof value === "string") {
    return value === "JobPosting";
  }
  if (Array.isArray(value)) {
    return value.some((entry) => entry === "JobPosting");
  }
  return false;
};

/** Picks the first `JobPosting` node out of a set of extracted JSON-LD nodes. */
export const pickJobPosting = (nodes: JsonLdNode[]): JsonLdNode | null =>
  nodes.find((node) => isJobPostingType(node["@type"])) ?? null;

/** Extracts the first `JobPosting` JSON-LD node directly from a detail page's HTML. */
export const extractJobPosting = (html: string): JsonLdNode | null =>
  pickJobPosting(extractJsonLdNodes(html));

const asRecord = (value: unknown): JsonLdNode | null =>
  isJsonLdNode(value) ? value : null;

const asString = (value: JsonLdValue | undefined): string | undefined =>
  typeof value === "string" && value.trim() ? value : undefined;

const asFiniteId = (value: JsonLdValue | undefined): string | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return asString(value);
};

const countryCode = (country: string): string =>
  country.toLowerCase() === "netherlands" ? "NL" : country;

const employmentType = (timeType: string): string => {
  const normalised = timeType.trim().toLowerCase();
  if (normalised === "full time" || normalised === "full-time") {
    return "FULL_TIME";
  }
  if (normalised === "part time" || normalised === "part-time") {
    return "PART_TIME";
  }
  return timeType;
};

export interface NextJobDataSynthesis {
  jobPosting: JsonLdNode;
  labelBlock: Record<string, string>;
}

const extractNextJobData = (html: string): JsonLdNode | null => {
  NEXT_DATA_PATTERN.lastIndex = 0;
  const raw = NEXT_DATA_PATTERN.exec(html)?.groups?.content?.trim();
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw);
    const root = asRecord(parsed);
    const props = asRecord(root?.props);
    const pageProps = asRecord(props?.pageProps);
    return asRecord(pageProps?.jobData);
  } catch {
    return null;
  }
};

interface NextJobPostingBuild {
  applyUrl?: string;
  id?: string;
  jobPosting: JsonLdNode;
}

const buildNextJobPosting = (
  jobData: JsonLdNode,
  detailUrl: string
): NextJobPostingBuild => {
  const id = asString(jobData.id);
  const title = asString(jobData.displayJobTitle);
  const datePosted = asString(jobData.datePosted);
  const description = asString(jobData.descriptionExternal);
  const city = asString(jobData.city);
  const country = asString(jobData.country);
  const applyUrl = asString(jobData.applyUrl);
  const detailPageUrl = asString(jobData.detailPageUrl) ?? detailUrl;
  const timeType = asString(jobData.timeType);
  const address: JsonLdNode = { "@type": "PostalAddress" };
  if (city) {
    address.addressLocality = city;
  }
  if (country) {
    address.addressCountry = countryCode(country);
  }

  const jobPosting: JsonLdNode = {
    "@type": "JobPosting",
    description: description ?? "",
    employmentType: timeType ? employmentType(timeType) : "",
    hiringOrganization: { "@type": "Organization", name: "ASML" },
    identifier: {
      "@type": "PropertyValue",
      name: "ASML",
      value: id ?? "",
    },
    jobLocation: { "@type": "Place", address },
    title: title ?? "",
    url: detailPageUrl,
  };
  if (datePosted) {
    jobPosting.datePosted = datePosted;
  }
  return { applyUrl, id, jobPosting };
};

/**
 * Builds the minimum schema.org JobPosting shape from a Next.js page's jobData.
 * This is deliberately a separate, config-gated path: most JSON-LD sources must
 * continue to fail closed when a detail page has no explicit JobPosting node.
 */
export const synthesizeJobPostingFromNextData = (
  html: string,
  detailUrl: string
): NextJobDataSynthesis | null => {
  const jobData = extractNextJobData(html);
  if (!jobData) {
    return null;
  }

  const fallbackApplyUrl =
    WORKDAY_APPLY_HREF_PATTERN.exec(html)?.groups?.href?.trim();
  const { applyUrl, id, jobPosting } = buildNextJobPosting(jobData, detailUrl);
  const labelBlock: Record<string, string> = {};
  if (id) {
    labelBlock.referentienummer = id;
  }
  if (applyUrl ?? fallbackApplyUrl) {
    labelBlock.workdayApplyUrl = applyUrl ?? fallbackApplyUrl ?? "";
  }

  return { jobPosting, labelBlock };
};

const extractVikeJob = (html: string): JsonLdNode | null => {
  VIKE_PAGE_CONTEXT_PATTERN.lastIndex = 0;
  const raw = VIKE_PAGE_CONTEXT_PATTERN.exec(html)?.groups?.content?.trim();
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw);
    const root = asRecord(parsed);
    const pageProps = asRecord(root?.pageProps);
    return asRecord(pageProps?.job);
  } catch {
    return null;
  }
};

const facetNames = (value: JsonLdValue | undefined): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  const names: string[] = [];
  for (const entry of value) {
    const name = asString(asRecord(entry)?.name);
    if (name) {
      names.push(name);
    }
  }
  return names;
};

/**
 * Builds the minimum schema.org JobPosting shape from a Vike page's
 * `vike_pageContext.pageProps.job` (Techniekwerkt). Same config-gated contract
 * as `synthesizeJobPostingFromNextData`: the source publishes no explicit
 * JobPosting node, so only opted-in sources take this path. `salary` and
 * `contract` facets were empty on every sampled detail page (2026-09-17) —
 * they map to labelBlock only when the source actually populates them, and
 * never to `tarief`/`employmentType` because their value shape is unverified.
 */
export const synthesizeJobPostingFromVike = (
  html: string,
  detailUrl: string
): NextJobDataSynthesis | null => {
  const job = extractVikeJob(html);
  if (!job) {
    return null;
  }

  const id = asFiniteId(job.id);
  const jobPosting: JsonLdNode = {
    "@type": "JobPosting",
    description: asString(job.description) ?? "",
    hiringOrganization: {
      "@type": "Organization",
      name: asString(job.original_companyname) ?? "",
    },
    identifier: {
      "@type": "PropertyValue",
      name: "Techniekwerkt",
      value: id ?? "",
    },
    jobLocation: {
      "@type": "Place",
      address: {
        "@type": "PostalAddress",
        addressCountry: "NL",
        addressLocality: asString(job.city) ?? "",
      },
    },
    title: asString(job.original_functiontitle) ?? "",
    url: detailUrl,
  };

  const labelBlock: Record<string, string> = {};
  if (id) {
    labelBlock.referentienummer = id;
  }
  const updatedAt = asString(job.updated_at);
  if (updatedAt) {
    labelBlock.gewijzigdOp = updatedAt;
  }
  const facetLabels = {
    branche: job.industry,
    dienstverband: job.contract,
    ervaring: job.experience,
    opleiding: job.education,
    salaris: job.salary,
  };
  for (const [key, facet] of Object.entries(facetLabels)) {
    const names = facetNames(facet);
    if (names.length > 0) {
      labelBlock[key] = names.join(", ");
    }
  }

  return { jobPosting, labelBlock };
};

const asPlainText = (value: JsonLdValue | undefined): string =>
  typeof value === "string" ? value : "";

/** Applies each configured label-block pattern against either the raw detail HTML or the
 * JobPosting's own `description` text, returning only the fields that matched. */
export const extractLabelBlock = (
  html: string,
  jobPosting: JsonLdNode | null,
  fields?: Record<string, JsonLdLabelBlockField>
) => {
  const result: Record<string, string> = {};
  if (!fields) {
    return result;
  }
  const description = asPlainText(jobPosting?.description);
  for (const [key, config] of Object.entries(fields)) {
    const haystack = config.source === "description" ? description : html;
    config.pattern.lastIndex = 0;
    const match = config.pattern.exec(haystack);
    const value = match?.groups?.value?.trim();
    if (value) {
      result[key] = value;
    }
  }
  return result;
};
