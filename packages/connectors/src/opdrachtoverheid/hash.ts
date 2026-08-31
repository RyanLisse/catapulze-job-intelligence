import { hashContent } from "../object-store";
import type { OpdrachtoverheidTender } from "./types";

/** Canonical JSON of the listing fields that matter for change detection.
 * Deliberately excludes noisy/derived fields (`similarity_score`,
 * `tender_last_seen`, category ids) so a re-poll that only bumps a
 * last-seen timestamp does not register as a content change. */
export const hashOpdrachtoverheidListingItem = (
  item: OpdrachtoverheidTender
): Promise<string> => {
  const canonical = JSON.stringify({
    contract_type: item.contract_type ?? null,
    exclusive: item.exclusive ?? null,
    extension_option_description: item.extension_option_description ?? null,
    hours_week: item.tender_hours_week ?? null,
    location: item.tender_job_location ?? null,
    max_hours: item.tender_max_hours ?? null,
    max_tariff: item.tender_maximum_tariff ?? null,
    min_hours: item.tender_min_hours ?? null,
    no_max_tariff: item.tender_no_max_tariff ?? null,
    offline_date: item.tender_offline_date ?? null,
    opdrachtgever: item.tender_buying_organization ?? null,
    remote_work_description: item.remote_work_description ?? null,
    start_date: item.tender_start_date ?? null,
    tender_id: item.tender_id,
    tender_name: item.tender_name,
    tender_source: item.tender_source ?? null,
    tender_url: item.tender_url ?? null,
    web_key: item.web_key,
  });
  return hashContent(new TextEncoder().encode(canonical));
};

export const hashOpdrachtoverheidPayload = (
  body: Uint8Array
): Promise<string> => hashContent(body);
