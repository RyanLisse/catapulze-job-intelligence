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
DATABASE_URL=postgres://... bun tools/backfill/report-zzp-negation-labels.ts --bron=inhuurdesk
```

`--bron` filters on `curated.bron.naam`. There is no limit flag: the scan walks
the whole corpus by keyset pagination on the primary key, 1000 rows per page,
so the numbers always describe every freelance-labelled row rather than a
window. On failure the tool prints the error name and message alongside
`"reason": "command_failed"` and exits 1.

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
  "scanned": 120
}
```

- `scanned` is how many `contracttype = 'freelance'` rows exist, across every
  page. It is the whole labelled population, not a window.
- `mislabelled` is how many of those state an exclusion. Every one is a row the
  current classifier would leave unknown or reclassify.
- `matchedPhrase` is the exact substring that proved the exclusion. Read it
  before acting: a phrase that looks wrong means the table needs a fix, not the
  row.
- `byBron` shows which connector produced the bad labels, which is usually the
  faster lead than the row list.
`mislabelled: 0` with a healthy `scanned` is the expected steady state once the
corrected rows have been applied and re-ingested.

## Applying the correction

Apply is a follow-up. This lane ships the report only, and no tool in the
repository can currently perform this correction.

The RJC-394 repair tool (`tools/backfill/repair-motian-v1-derived-fields.ts`)
does write `contracttype` with provenance, an audit event and a rollback path,
but it does not fit this case on two counts. It only fills a derived field that
is currently null, so it will not touch a row that already says `freelance`,
which is exactly the set this report finds. It is also bound to rows carrying a
Motian `v1_id`, which the mislabelled rows need not have.

So the correction needs its own path, and it must carry the same guarantees as
the existing one: an explicit reviewed manifest, a quiescence gate, one audit
event and one `aanvraag.gewijzigd` outbox event per changed row, and a rollback.
See `docs/runbooks/motian-v1-derived-field-repair.md` for the shape to copy.

Re-ingesting the affected `bron` is the other route. The fixed classifier
recurates the row through the normal curated write path, which produces the
provenance and the projection update for free. Prefer this where the source
still publishes the vacancy.

Do not hand-edit `curated.aanvraag` rows. The search projection and the audit
trail both derive from the curated write path, and a direct update leaves them
inconsistent.
