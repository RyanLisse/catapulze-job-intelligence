import { hashContent } from "../object-store";
import type { InhuurdeskAssignment } from "./types";

export const hashInhuurdeskListingItem = (
  item: InhuurdeskAssignment
): Promise<string> => {
  const canonical = JSON.stringify({
    aanvraagnummer: item.aanvraagnummer,
    client: item.client ?? null,
    description: item.description ?? null,
    endDate: item.endDate ?? null,
    hoursPerWeek: item.hoursPerWeek ?? null,
    location: item.location ?? null,
    startDate: item.startDate ?? null,
    title: item.title,
  });
  return hashContent(new TextEncoder().encode(canonical));
};

export const hashInhuurdeskPayload = (body: Uint8Array): Promise<string> =>
  hashContent(body);
