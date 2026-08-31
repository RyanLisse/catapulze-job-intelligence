# Postgres restore runbook v1

Version: **1.0**  
Status: **In-repo drill verified in CI. Production scope changed 2026-08-31: [ADR-0006](../adr/ADR-0006-neon-as-system-of-record.md) makes Neon the production SoR, so production restore evidence is now a Neon PITR/branch-restore drill (procedure to be written), not a Hetzner wal-g restore. The CI drill below keeps proving the local/CI Docker wal-g path only.**  
Requirements: **R21, AE9, JI-037, DEC-005**

## When to use

- Scheduled monthly/quarterly restore drill (AE9)
- Suspected data corruption on production Postgres
- Host loss with intact off-site WAL/base-backup chain
- Before claiming production-readiness after backup configuration changes

## Preconditions

- Off-site S3-compatible bucket with current base backup and continuous WAL
- Isolated empty Postgres 16 target (never restore in-place over production)
- Admin credentials available only to the operator running the drill
- Current git SHA and environment recorded in evidence template

## Isolated target rules

1. Provision a **new** Docker volume or VM disk for the restore target.
2. Bind restored Postgres to `127.0.0.1` or a private network only.
3. Do not attach the production `POSTGRES_DATA_VOLUME`.
4. Destroy the drill target after evidence is captured.

## CI / local fixture drill

The repository ships an isolated MinIO fixture and wal-g-enabled Postgres image:

```bash
cp .env.example .env
bash tools/postgres/restore-drill.sh
```

This script:

1. Starts Postgres with WAL archiving to MinIO (`docker-compose.backup.yml`)
2. Applies Drizzle migrations and writes a marker row
3. Pushes a base backup plus WAL via wal-g
4. Restores into a separate volume/container on port `55432`
5. Runs integrity checks and writes `.artifacts/postgres-restore-evidence.json`

CI runs the same script in `.github/workflows/ci.yml` job `postgres-restore-drill`.

## Production drill (operator)

Production still requires Ryan/Hetzner evidence that is **not** substituted by CI:

| Step | Action | Pass signal |
| --- | --- | --- |
| 1 | Confirm latest base backup and WAL age within policy | Backup list shows backup < 26h; WAL < 15m |
| 2 | Provision empty target on private network | No production volume attached |
| 3 | `wal-g backup-fetch LATEST` into target data directory | Fetch completes without error |
| 4 | Configure `recovery.signal` + `restore_command = 'wal-g wal-fetch %f %p'` | Postgres promotes after replay |
| 5 | Run `tools/postgres/integrity-checks.sh` against target | Migration journal + core relations pass |
| 6 | Record recovery LSN, duration, SHA, environment | Fill `docs/review/postgres-restore-evidence-template.md` |
| 7 | Destroy drill target | No drill credentials reused in production |

## Integrity checks

```bash
bash tools/postgres/integrity-checks.sh <restore-container-name> <marker-value>
```

Checks:

- Drizzle migration journal present
- `staging.source_record`, `curated.bron`, `curated.aanvraag` exist
- Restore marker row from the drill is readable

## Failure handling

| Symptom | Likely cause | Action |
| --- | --- | --- |
| `wal-g wal-fetch` missing segments | WAL retention too short or archive lag | Extend retention; inspect archive_command logs |
| Recovery never promotes | Wrong backup name or incomplete fetch | Re-run fetch; verify bucket encryption credentials |
| Migration journal missing | Restored backup predates migrations | Restore newer backup; re-run migrator only after promotion |
| Public 5432 on target | Compose port misconfiguration | Stop target; fix bind to `127.0.0.1` |

## Evidence

Use `docs/review/postgres-restore-evidence-template.md`. A successful backup upload or Compose healthcheck alone is **not** sufficient evidence.

## Version history

| Version | Date | Change |
| --- | --- | --- |
| 1.0 | 2026-08-30 | Initial runbook with CI MinIO fixture drill and production operator checklist |
