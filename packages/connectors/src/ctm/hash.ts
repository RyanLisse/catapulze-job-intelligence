import { hashContent } from "../object-store";
import type { CtmEntry } from "./types";

export const hashCtmListingItem = (item: CtmEntry): Promise<string> => {
  const canonical = JSON.stringify({
    aanvraagnummer: item.aanvraagnummer,
    cpv: item.cpv ?? null,
    organisatie: item.organisatie ?? null,
    procedure: item.procedure ?? null,
    publicatiedatum: item.publicatiedatum ?? null,
    referentie: item.referentie ?? null,
    sluitingstijd: item.sluitingstijd ?? null,
    titel: item.titel,
  });
  return hashContent(new TextEncoder().encode(canonical));
};

export const hashCtmPayload = (body: Uint8Array): Promise<string> =>
  hashContent(body);
