# Motian v1 derived-field repair

This is a bounded diagnostic and repair tool for a small, explicitly approved
set of historical Motian rows. The default mode reads the current curated row
and its current immutable S3 raw object, then reports which null derived fields
could be recovered. It never connects to Motian. `--apply` is a separate,
quiescence-gated mode that writes only the five derived fields, one audit event,
and one `aanvraag.gewijzigd` outbox event per changed row.

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
rows that would need a normal `aanvraag.gewijzigd` event during apply.
`raw_schema_not_motian` is expected for rows whose current raw pointer has
since been replaced by a live native-source payload; do not attempt to repair
those with this tool.

Attach the reviewed manifest digest and redacted report to CTP-492. An apply
must be preceded by a reviewed dry-run report and an ingest freeze. Stop
all writers that can change `curated.aanvraag` or its raw pointer, wait for
in-flight work to finish, and retain the exact manifest bytes and digest.

## Apply the reviewed manifest

`--apply` requires both the exact manifest and an explicit
`--ingest-quiesced` acknowledgement. The limit remains mandatory and is capped
at 100; the tool refuses a manifest larger than the limit.

```bash
bun tools/backfill/repair-motian-v1-derived-fields.ts \
  --apply --ingest-quiesced \
  --manifest /secure/path/motian-pilot.json \
  --limit 10
```

Each candidate is re-read, the row is locked and all six identity bindings are
checked again, and the raw object is validated before the transaction commits.
Only fields that are still `NULL` are set. The derived-field update, strict audit event containing the five-field before and after values, and one `aanvraag.gewijzigd` outbox event commit
atomically. Candidate failures are isolated and reported by reason code; raw
hash mismatches remain distinct from other raw read failures.

The apply mode never changes identity, raw pointers, content hashes, versions,
history, or raw storage. Keep the returned audit IDs, outbox IDs, field names,
reason codes, and manifest digest with the repair record.

## Bounded rollback

Rollback is also quiescence-gated and accepts only one repair audit ID. It
restores a field only while it still equals that repair's recorded after-image;
later edits are reported as skipped. A rollback audit and outbox event are
written atomically with any restored fields. If every changed field has a later
value, rollback is an unchanged no-op.

```bash
bun tools/backfill/repair-motian-v1-derived-fields.ts \
  --rollback --ingest-quiesced \
  --audit-id 00000000-0000-4000-8000-000000000000
```
