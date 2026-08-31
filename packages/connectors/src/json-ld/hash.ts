import { hashContent } from "../object-store";
import type { JsonLdDiscoveryUrl } from "./types";

export const hashJsonLdListingItem = (
  item: JsonLdDiscoveryUrl
): Promise<string> =>
  hashContent(
    new TextEncoder().encode(
      JSON.stringify({ lastmod: item.lastmod ?? null, url: item.url })
    )
  );

export const hashJsonLdPayload = (body: Uint8Array): Promise<string> =>
  hashContent(body);
