# ZZP negation labels (CTP-491)

An explicit exclusion of the freelance contract form must never produce a
`freelance` label. The classifier in
`packages/application/src/normalise/classify-contract-work.ts` now checks a
table of exclusion patterns before any positive freelance match; when the text
excludes ZZP and proves no other form, the contracttype stays unknown.

Rows curated before that fix can still carry the wrong label. This runbook
covers the report-only diagnostic that finds them, and how to correct them.

## What counts as an exclusion

The table has five rows, all matched case-insensitively per clause, against the
title and description joined together. `zzp`, `zzp'er`, `zzp'ers`, `freelance`,
`freelancer` and `freelancers` are interchangeable in every row.

| Shape | Matches |
| --- | --- |
| term then denial | `zzp niet mogelijk`, `zzp is niet toegestaan`, `freelance uitgesloten` |
| denial then term | `niet toegestaan voor zzp`, `niet geschikt voor een zzp'er` |
| `geen` then term | `geen zzp`, `geen zzp mogelijk`, `geen zzp'ers gezocht`, `geen freelancers.` |
| labelled answer | `zzp: nee`, `zzp mogelijkheid: nee`, `zzp toegestaan: nee` |
| not intended for | `niet voor zzp`, `niet bedoeld voor freelancers` |

Two shapes are deliberately left out.

`geen zzp ervaring vereist` is a requirement, not an exclusion, so the `geen`
row only fires when the next word confirms exclusion (`mogelijk`, `toegestaan`,
`beschikbaar`, `gezocht`, `gewenst`, `welkom`, `geaccepteerd`) or the clause
ends there.

`minder geschikt voor zzp'ers` (seen in Striive prose) is a warning about risk,
not a refusal, so it still classifies as freelance. Promote it only with a
product decision, not as a pattern tweak.

Exclusivity phrasing such as `uitsluitend detachering` needs no exclusion rule:
the named alternative already wins on its own evidence. The table never invents
a contract form that the text does not state.

## Report the mislabelled rows

Read-only. The connection is opened in a read-only transaction and the tool
issues one `SELECT`; there is no write path in it.

```bash
DATABASE_URL=postgres://... bun tools/backfill/report-zzp-negation-labels.ts
DATABASE_URL=postgres://... bun tools/backfill/report-zzp-negation-labels.ts --bron=inhuurdesk --limit=100
```

`--limit` defaults to 500 and is capped at 5000. `--bron` filters on
`curated.bron.naam`.

## Reading the numbers

```json
{
  "byBron": { "inhuurdesk": 4 },
  "candidates": [
    {
      "bron": "inhuurdesk",
      "id": "curated-aanvraag-uuid",
      "matchedPhrase": "Geen ZZP mogelijk",
      "titel": "Adviseur A",
      "versie": 3
    }
  ],
  "mislabelled": 4,
  "scanned": 120,
  "truncated": false
}
```

- `scanned` is how many `contracttype = 'freelance'` rows the query returned,
  bounded by `--limit`. It is not the size of the corpus.
- `mislabelled` is how many of those state an exclusion. Every one is a row the
  current classifier would leave unknown or reclassify.
- `matchedPhrase` is the exact substring that proved the exclusion. Read it
  before acting: a phrase that looks wrong means the table needs a fix, not the
  row.
- `byBron` shows which connector produced the bad labels, which is usually the
  faster lead than the row list.
- `truncated` is true when `scanned` hit `--limit`, so more rows may exist. Raise
  the limit or narrow with `--bron` and run again.

`mislabelled: 0` with a healthy `scanned` is the expected steady state once the
corrected rows have been applied and re-ingested.

## Applying the correction

This lane adds no write path. `contracttype` is one of the five derived fields
the existing RJC-394 repair tool already writes with provenance, so route the
correction through it rather than writing a second one:

```bash
bun tools/backfill/repair-motian-v1-derived-fields.ts --manifest=candidates.json
bun tools/backfill/repair-motian-v1-derived-fields.ts --manifest=candidates.json --apply --ingest-quiesced
```

See `docs/runbooks/motian-v1-derived-field-repair.md` for the manifest contract,
the quiescence gate, the audit event, and the rollback path.

Two limits apply. That tool recovers a derived field from the immutable raw
object and only fills fields that are currently null, so it repairs a row whose
`contracttype` is absent; it does not overwrite a row that already says
`freelance`. It is also bound to rows carrying a Motian `v1_id`. For anything
outside that set, the correction is a follow-up: either a targeted write path
with the same provenance and audit guarantees, or a re-ingest of the affected
`bron` so the fixed classifier recurates the row.

Do not hand-edit `curated.aanvraag` rows. The search projection and the audit
trail both derive from the curated write path, and a direct update leaves them
inconsistent.
