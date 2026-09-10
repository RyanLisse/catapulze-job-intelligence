# Motian v1 derived-field diagnostic

This is a **report-only** diagnostic for a small, explicitly approved set of
historical Motian rows. It reads the current curated row and its current
immutable S3 raw object, then reports which null derived fields could be
recovered. It never connects to Motian and has no `--apply` mode.

Use it when a current `curated.aanvraag` row has a Motian `v1_id`, a
content-addressed JSON raw pointer, and a missing one of:

- `opdrachtgever_naam`
- `contracttype`
- `publicatiedatum`
- `start_datum`
- `sluitingsdatum`

## Preconditions

Use a destination `DATABASE_URL` with read access and the normal durable raw
store variables: `RAW_S3_BUCKET`, `RAW_S3_ACCESS_KEY_ID`,
`RAW_S3_SECRET_ACCESS_KEY`, and, where applicable, `RAW_S3_ENDPOINT` and
`RAW_S3_REGION`. The tool refuses the worker-local filesystem store.

Prepare a reviewed JSON manifest with at most 100 candidates. Each candidate
binds the exact current row and raw pointer; do not construct it from `v1_id`
alone.

```json
{
  "version": "motian-v1-derived-field-repair/v1",
  "candidates": [
    {
      "aanvraagId": "curated-aanvraag-uuid",
      "bronId": "source-uuid",
      "bronReferentie": "source-reference",
      "contentHash": "64-character-lowercase-sha256",
      "rawPayloadRef": "raw/source/2026/09/64-character-lowercase-sha256.json",
      "v1Id": "motian-job-id"
    }
  ]
}
```

The manifest is an approval artifact. Store it outside Git when its source
references are sensitive. Its SHA-256 is included in the report, so the exact
bytes used for a review can be recorded without printing any raw values.

## Run a bounded dry run

The explicit limit is required and must be at least the manifest size. This
prevents an accidental corpus scan.

Typecheck the standalone tools explicitly; the workspace-wide `check-types`
command does not include files under `tools/backfill`.

```bash
bun run check-types:backfill
```

```bash
bun tools/backfill/repair-motian-v1-derived-fields.ts \
  --manifest /secure/path/motian-pilot.json \
  --limit 10
```

The output contains only candidate `v1Id`s, plan/result counts, field names,
reason codes, and the manifest digest. It does not print a raw payload,
company name, description, source reference, database URL, or credential.

## How a candidate is accepted

For every candidate, the diagnostic verifies all of these before proposing a
field:

1. The current row exactly matches all manifest identity, hash, and pointer
   values.
2. Its raw ref is a content-addressed JSON path, and the raw object's SHA-256
   matches both that path and the current row's `content_hash`.
3. The raw root decodes as the original `to_jsonb(jobs)` Motian shape. Native
   source payloads, including Striive `{ "job": ... }` records, are rejected.
4. Raw `id`, normalized platform/bron binding, and `external_id` match the
   current curated identity.
5. The source publishes a concrete field value and the curated target is
   currently `NULL`.

Timezone-less historical timestamps use the same explicit UTC conversion as
the original Motian backfill. Missing source data stays absent.

## Interpret and retain the report

`wouldPatch` is grouped by field. `projectionEventsRequired` is the count of
rows that would need a normal `aanvraag.gewijzigd` event if an approved future
apply tool is built. `raw_schema_not_motian` is expected for rows whose current
raw pointer has since been replaced by a live native-source payload; do not
attempt to repair those with this tool.

Attach the reviewed manifest digest and redacted report to CTP-492. A future
apply design must re-lock and recheck every accepted row, update only null
columns, write a validated metadata-only audit event, and append one durable
outbox event in the same transaction. It must not mutate raw objects,
provenance fields, source pointers, content hashes, or versions without a
separate approved history contract.
