# ASML

## Inventory

- Listing UI: `https://www.asml.com/en/careers/find-your-job` (Sitecore/Next.js)
- Discovery: `https://www.asml.com/en/job_posting-sitemap.xml`
- Verified sitemap volume: approximately 586 `<loc>` entries on 2026-09-16
- Detail sample: `https://www.asml.com/en/careers/find-your-job/senior-electrical-safety-expert-nominated-person--installatie-verantwoordelijke-euv-factory-j00333473`
- Apply board: `https://asml.wd3.myworkdayjobs.com/ASMLEXT1` (the connector does not crawl this board)

The sitemap is global. The connector keeps canonical careers detail URLs and drops the listing root and non-detail noise. It does not discover jobs through filter/facet query parameters.

## Detail parsing

ASML detail pages do not publish a `JobPosting` JSON-LD block. With the ASML-only `detailSynthesizer` config field, the shared JSON-LD client reads `props.pageProps.jobData` from `__NEXT_DATA__` and synthesises the minimum `JobPosting` node needed by the shared normaliser.

The sample maps as follows:

| ASML `jobData` | JSON-LD / normalised field |
| --- | --- |
| `displayJobTitle` | `JobPosting.title` |
| `datePosted` | `JobPosting.datePosted`, retaining `2026-08-17T00:00:00` |
| `descriptionExternal` | `JobPosting.description` |
| `id` (`J-00333473`) | `identifier.value` and `labelBlock.referentienummer` |
| `city` (`Veldhoven`) | `jobLocation.address.addressLocality` and shared `locatieTekst` |
| `country` (`Netherlands`) | `jobLocation.address.addressCountry` = `NL`; shared normaliser `locatieLand` remains its documented `NL` value |
| `timeType` (`Full time`) | `employmentType` = `FULL_TIME` |
| `detailPageUrl` | `JobPosting.url` |
| `applyUrl` | `labelBlock.workdayApplyUrl` |

The Workday requisition id is `J-00333473`, while the ASML canonical URL slug ends in lowercase `j00333473`; these are related identifiers but are not interchangeable. A Workday apply link is retained as source metadata only.

## Robots and terms

Robots allows the canonical careers pages and provides a sitemap. The following disallowed filter parameters are honoured: `job_country`, `query`, `job_type`, `job_teams`, `job_technical_fields`, `job_degrees`, `job_experience_levels`, `job_educational_backgrounds`, `job_city`, `sort_by`, and `tags`, including their `&` variants. `/en/Presentation` and `/sitecore` paths are also excluded.

The terms of use were a standard IP skim and are not Gate0; `voorwaardenStatus` is therefore `te_toetsen`.

## Operations

- `bronId`: `00000000-0000-4000-8000-00000000000f`
- Parser version: `asml/v1`
- Live gate: `ASML_LIVE=1`
- Crawl delay: 2000 ms
- Method: `json-ld`
- `listingHashCoversDetail: false`; known hashes are intentionally not forwarded because the sitemap hash cannot cover changes in detail-page `jobData`.

The fixture is a sanitised capture: recruiter/owner fields are redacted and no cookies or tokens are retained.
