import { hashContent } from "../object-store";
import type { InhuurdeskAssignment } from "./types";

/**
 * RJC-357/RJC-401: this listing hash covers EVERY `InhuurdeskAssignment`
 * field — fetch() re-serialises the listing row with no second request, so
 * an unchanged listing hash proves the whole payload (and everything the
 * Inhuurdesk normaliser derives) is unchanged. `id` was added for that
 * guarantee; keep this list in sync with `InhuurdeskAssignment` or the
 * known-hash skip becomes unsafe (see docs/sources/inhuurdesk.md).
 */
export const hashInhuurdeskListingItem = (
  item: InhuurdeskAssignment
): Promise<string> => {
  const canonical = JSON.stringify({
    aanvraagnummer: item.aanvraagnummer,
    client: item.client ?? null,
    description: item.description ?? null,
    endDate: item.endDate ?? null,
    hoursPerWeek: item.hoursPerWeek ?? null,
    id: item.id ?? null,
    location: item.location ?? null,
    startDate: item.startDate ?? null,
    title: item.title,
  });
  return hashContent(new TextEncoder().encode(canonical));
};

export const hashInhuurdeskPayload = (body: Uint8Array): Promise<string> =>
  hashContent(body);
