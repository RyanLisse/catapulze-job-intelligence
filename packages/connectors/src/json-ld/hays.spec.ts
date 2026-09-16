import { describe, expect, it } from "bun:test";

import { normaliseJsonLdObservation } from "../../../application/src/normalise/json-ld";
import { createJsonLdClient } from "./client";
import { haysConfig } from "./configs/hays";

const client = createJsonLdClient({ config: haysConfig, liveEnabled: false });
const scrumUrl =
  "https://www.hays.nl/vacature-details/scrum-master-provincie-utrecht_1049921?q=&location=&applyId=JOB_5377570&jobSource=HaysGCJ&isSponsored=N&specialismId=&subSpecialismId=&jobName=projects/mineral-balm-174308/tenants/ab5d683d-f9a5-4b85-bfe0-eb74881e24cf/jobs/103039416380859078&lang=nl";
const buyerUrl =
  "https://www.hays.nl/vacature-details/buyer-sports-and-outdoor-amsterdam_1050471?q=&location=&applyId=JOB_5411289&jobSource=HaysGCJ&isSponsored=N&specialismId=&subSpecialismId=&jobName=projects/mineral-balm-174308/tenants/ab5d683d-f9a5-4b85-bfe0-eb74881e24cf/jobs/134360935685857990&lang=nl";
const financeUrl =
  "https://www.hays.nl/vacature-details/finance-business-partner-rotterdam_1050462?q=&location=&applyId=JOB_5412125&jobSource=HaysGCJ&isSponsored=N&specialismId=&subSpecialismId=&jobName=projects/mineral-balm-174308/tenants/ab5d683d-f9a5-4b85-bfe0-eb74881e24cf/jobs/96725423613715142&lang=nl";

describe("Hays JSON-LD connector", () => {
  it("discovers the recorded tracking URLs by pathname", async () => {
    const discovered = await client.fetchListing();
    expect(discovered).toHaveLength(10);
    expect(discovered.map(({ url }) => url)).toContain(scrumUrl);
    expect(discovered.map(({ url }) => url)).toContain(buyerUrl);
    expect(discovered.map(({ url }) => url)).toContain(financeUrl);
  });

  it("normalises the recorded Scrum Master detail and leaves annual salary absent", async () => {
    const detail = await client.fetchDetail(scrumUrl);
    const draft = normaliseJsonLdObservation(
      new TextEncoder().encode(
        JSON.stringify({ ...detail, parserVersion: "hays/v1", slug: "hays" })
      ),
      "sha256-test"
    );
    expect(draft.titel.value).toBe("Scrum Master");
    expect(draft.opdrachtgeverNaam.value).toBe("Hays");
    expect(draft.locatieTekst.value).toBe("Provincie Utrecht");
    expect(draft.bronSpecifiek.value).toMatchObject({
      contract_type: "Contracting",
      publicatiedatum: "2026-09-09",
      valid_through: "2026-12-07",
    });
    expect(draft.sluitingsdatum?.toISOString()).toBe(
      "2026-12-07T22:59:59.999Z"
    );
    expect(draft.tarief).toEqual({
      eenheid: "unknown",
      max: "unknown",
      min: "unknown",
      valuta: "EUR",
    });
  });
});
