import { describe, expect, it } from "bun:test";

import {
  buildContentAddressedRawObjectPath,
  hashContent,
} from "@ji/connectors";

import { planMotianV1DerivedFieldRepair } from "./motian-v1-derived-field-repair";
import type {
  CurrentMotianDerivedFieldRow,
  MotianDerivedFieldRepairManifestEntry,
} from "./motian-v1-derived-field-repair";
import { planReportCandidate } from "./repair-motian-v1-derived-fields";

const V1_ID = "motian-001";
const BRON_ID = "00000000-0000-4000-8000-000000000030";
const AANVRAAG_ID = "00000000-0000-4000-8000-000000000901";

interface MotianRawFixture {
  readonly application_deadline?: string | null;
  readonly company?: string | null;
  readonly contract_type?: string | null;
  readonly external_id: string;
  readonly id: string;
  readonly platform: string;
  readonly posted_at?: string | null;
  readonly start_date?: string | null;
  readonly title: string;
}

const rawBody = (overrides: Partial<MotianRawFixture> = {}): Uint8Array =>
  new TextEncoder().encode(
    JSON.stringify({
      application_deadline: "2026-09-15 09:30:00",
      archived_at: null,
      company: "NVB opdrachtgever",
      contract_type: "detachering",
      deleted_at: null,
      description: null,
      end_client: null,
      external_id: "external-001",
      external_url: null,
      id: V1_ID,
      location: null,
      platform: "nationalevacaturebank",
      posted_at: "2026-09-10 08:10:11",
      province: null,
      rate_max: null,
      rate_min: null,
      scraped_at: null,
      start_date: "2026-10-01 00:00:00",
      status: null,
      title: "Data engineer",
      ...overrides,
    })
  );

const candidate = async (
  input: {
    readonly body?: Uint8Array;
    readonly current?: Partial<CurrentMotianDerivedFieldRow>;
    readonly manifest?: Partial<MotianDerivedFieldRepairManifestEntry>;
  } = {}
): Promise<{
  readonly current: CurrentMotianDerivedFieldRow;
  readonly manifest: MotianDerivedFieldRepairManifestEntry;
  readonly raw: { readonly body: Uint8Array; readonly contentType: "json" };
}> => {
  const body = input.body ?? rawBody();
  const contentHash = await hashContent(body);
  const rawPayloadRef = buildContentAddressedRawObjectPath({
    bronSlug: "nationalevacaturebank",
    contentHash,
    contentType: "json",
    startedAt: new Date("2026-09-10T00:00:00.000Z"),
  });
  const manifest = {
    aanvraagId: AANVRAAG_ID,
    bronId: BRON_ID,
    bronReferentie: "external-001",
    contentHash,
    rawPayloadRef,
    v1Id: V1_ID,
    ...input.manifest,
  };
  return {
    current: {
      ...manifest,
      contracttype: null,
      opdrachtgeverNaam: null,
      publicatiedatum: null,
      sluitingsdatum: null,
      startDatum: null,
      ...input.current,
    },
    manifest,
    raw: { body, contentType: "json" },
  };
};

describe("planMotianV1DerivedFieldRepair", () => {
  it("plans only null fields and keeps Motian legacy timestamps in UTC", async () => {
    const input = await candidate();

    await expect(planMotianV1DerivedFieldRepair(input)).resolves.toEqual({
      kind: "patch",
      patch: {
        contracttype: "detachering",
        opdrachtgeverNaam: "NVB opdrachtgever",
        publicatiedatum: "2026-09-10T08:10:11.000Z",
        sluitingsdatum: new Date("2026-09-15T09:30:00.000Z"),
        startDatum: "2026-10-01",
      },
      sourceAbsentFields: [],
      v1Id: V1_ID,
    });
  });

  it("rejects a body whose digest no longer matches the current raw pointer", async () => {
    const input = await candidate();
    const tampered = new TextEncoder().encode("tampered");

    await expect(
      planMotianV1DerivedFieldRepair({
        ...input,
        raw: { body: tampered, contentType: "json" },
      })
    ).resolves.toEqual({
      kind: "rejected",
      reason: "raw_hash_mismatch",
      v1Id: V1_ID,
    });
  });

  it("rejects a content-addressed raw ref with a non-JSON suffix", async () => {
    const input = await candidate();
    const rawPayloadRef = input.current.rawPayloadRef.replace(
      /\.json$/u,
      ".html"
    );

    await expect(
      planMotianV1DerivedFieldRepair({
        ...input,
        current: { ...input.current, rawPayloadRef },
        manifest: { ...input.manifest, rawPayloadRef },
      })
    ).resolves.toEqual({
      kind: "rejected",
      reason: "raw_ref_not_content_addressed",
      v1Id: V1_ID,
    });
  });

  it("rejects a content-addressed raw ref for another Motian platform", async () => {
    const input = await candidate();
    const rawPayloadRef = input.current.rawPayloadRef.replace(
      "raw/nationalevacaturebank/",
      "raw/striive/"
    );

    await expect(
      planMotianV1DerivedFieldRepair({
        ...input,
        current: { ...input.current, rawPayloadRef },
        manifest: { ...input.manifest, rawPayloadRef },
      })
    ).resolves.toEqual({
      kind: "rejected",
      reason: "raw_ref_not_content_addressed",
      v1Id: V1_ID,
    });
  });

  it("rejects a native Striive payload even when its raw hash is valid", async () => {
    const input = await candidate({
      body: new TextEncoder().encode(
        JSON.stringify({ job: { clientName: "Stichting ICTU", id: V1_ID } })
      ),
    });

    await expect(planMotianV1DerivedFieldRepair(input)).resolves.toEqual({
      kind: "rejected",
      reason: "raw_schema_not_motian",
      v1Id: V1_ID,
    });
  });

  it("rejects a Striive envelope even when it mimics the Motian root fields", async () => {
    const motianRoot = JSON.parse(new TextDecoder().decode(rawBody()));
    const input = await candidate({
      body: new TextEncoder().encode(
        JSON.stringify({ ...motianRoot, job: { id: V1_ID } })
      ),
    });

    await expect(planMotianV1DerivedFieldRepair(input)).resolves.toEqual({
      kind: "rejected",
      reason: "raw_schema_not_motian",
      v1Id: V1_ID,
    });
  });

  it("does not overwrite a populated curated field", async () => {
    const input = await candidate({
      body: rawBody({
        application_deadline: null,
        contract_type: null,
        posted_at: null,
        start_date: null,
      }),
      current: { opdrachtgeverNaam: "existing value" },
    });

    await expect(planMotianV1DerivedFieldRepair(input)).resolves.toEqual({
      kind: "unchanged",
      sourceAbsentFields: [
        "contracttype",
        "publicatiedatum",
        "startDatum",
        "sluitingsdatum",
      ],
      v1Id: V1_ID,
    });
  });

  it("reports source absence without guessing a field value", async () => {
    const input = await candidate({
      body: rawBody({
        application_deadline: null,
        company: null,
        contract_type: null,
        posted_at: null,
        start_date: null,
      }),
    });

    await expect(planMotianV1DerivedFieldRepair(input)).resolves.toEqual({
      kind: "unchanged",
      sourceAbsentFields: [
        "opdrachtgeverNaam",
        "contracttype",
        "publicatiedatum",
        "startDatum",
        "sluitingsdatum",
      ],
      v1Id: V1_ID,
    });
  });

  it("rejects a raw root whose identity is not the current curated identity", async () => {
    const input = await candidate({ body: rawBody({ external_id: "other" }) });

    await expect(planMotianV1DerivedFieldRepair(input)).resolves.toEqual({
      kind: "rejected",
      reason: "source_identity_mismatch",
      v1Id: V1_ID,
    });
  });

  it("is idempotent because planning has no writes", async () => {
    const input = await candidate();

    const [first, second] = await Promise.all([
      planMotianV1DerivedFieldRepair(input),
      planMotianV1DerivedFieldRepair(input),
    ]);

    expect(first).toEqual(second);
  });
});

describe("planReportCandidate", () => {
  it("does not read S3 when any current identity field differs from its manifest", async () => {
    const input = await candidate();
    let rawReads = 0;
    const mismatchedCurrentRows = [
      { ...input.current, aanvraagId: "another-aanvraag" },
      { ...input.current, bronId: "another-bron" },
      { ...input.current, bronReferentie: "another-reference" },
      { ...input.current, contentHash: "a".repeat(64) },
      { ...input.current, rawPayloadRef: "raw/other/2026/09/ref.json" },
      { ...input.current, v1Id: "another-v1-id" },
    ];

    const reports = await Promise.all(
      mismatchedCurrentRows.map((current) =>
        planReportCandidate({
          current,
          manifest: input.manifest,
          readRawObject: () => {
            rawReads += 1;
            return Promise.resolve(input.raw);
          },
        })
      )
    );

    expect(reports).toEqual(
      mismatchedCurrentRows.map(() => ({
        reason: "current_row_mismatch",
        status: "rejected",
        v1Id: V1_ID,
      }))
    );
    expect(rawReads).toBe(0);
  });
});
