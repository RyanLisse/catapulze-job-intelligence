# Auth access and provisioning

The web UI, REST capabilities, and MCP capabilities share one Better Auth
session boundary. A caller cannot choose its own subject or role.

## Runtime contract

- Browser requests use the Better Auth session cookie with
  `credentials: "include"`. The web client never sends an `Authorization`
  role header. Session cookies are `HttpOnly` and `SameSite=Lax` (plus `Secure`
  in production).
- An unsafe REST request that carries a session cookie must send an `Origin`
  header that exactly equals `CORS_ORIGIN`. A foreign or missing origin is
  rejected with `403 CSRF_REJECTED` before the session lookup, body read, or
  capability invocation. Non-browser automation must use a signed Better Auth
  bearer; a cookie plus no origin is intentionally unsupported for writes.
- REST and MCP resolve every request with `auth.api.getSession` and force a
  database-backed check. Expired, revoked, unknown, or malformed sessions fail
  closed.
- A browser session becomes a `user` principal. A signed bearer session
  becomes an `agent` principal. If an `Authorization` header is present, its
  lookup cannot fall back to a valid browser cookie.
- The role comes from the server-owned `user.role` column. Better Auth marks
  this additional field `input: false`, so sign-up and update bodies cannot set
  it. Allowed values are `recruiter`, `operator`, `admin`, and `approver`.
- Public email/password sign-up is disabled. `/jobs` performs no capability
  calls without a session and shows `Log in om opdrachten te bekijken`.

The MCP bearer is not an application JWT. Better Auth 1.7.1 signs the opaque
session token with HMAC-SHA256 and `BETTER_AUTH_SECRET`; `requireSignature` is
enabled. Better Auth then resolves that token against the session store, which
enforces expiry and revocation. Keep bearer tokens in 1Password, rotate/revoke
them like passwords, and never place them in source control or command-line
arguments.

## Migration dependency

Apply `0013_durable_user_writes` first, then
`0014_auth_user_role`. Migration `0014` backfills existing users to
`recruiter`, adds a non-null default, and adds a database check constraint for
the allowed roles. Do not deploy the auth code before the migration is present.

## Provision the first user

The only supported bootstrap path is the unmounted operator CLI. It has no HTTP
route. Run it from a trusted server shell with the production environment and
1Password injection. Do not pass any value as a command argument.

Required one-shot environment names:

- `AUTH_BOOTSTRAP_ENABLED=1`
- `AUTH_BOOTSTRAP_CONFIRM=PROVISION_AUTH_USER`
- `AUTH_BOOTSTRAP_EMAIL`
- `AUTH_BOOTSTRAP_NAME`
- `AUTH_BOOTSTRAP_PASSWORD`
- `AUTH_BOOTSTRAP_ROLE`

With those values supplied through the local 1Password environment file:

```bash
op run --env-file=apps/server/.env.1password -- bun run --filter server auth:provision
```

The command uses Better Auth's password API and hashing. It refuses an existing
email without changing that user, reads the stored role back from Postgres, and
prints only non-secret JSON evidence:

```json
{"created":true,"role":"recruiter","roleVerified":true,"status":"provisioned"}
```

Email is trimmed and lowercased before both the existence lookup and Better Auth
signup. An existing or concurrently created email returns `already_exists` and
exit code 2.

If Better Auth created the account but the stored role cannot be verified, the
command exits 3 and prints explicit reconciliation evidence:

```json
{"code":"ROLE_READBACK_FAILED","created":true,"roleVerified":false,"status":"reconciliation_required"}
```

Inspect and reconcile that existing account before retrying; do not assume the
create was rolled back. Invalid gates, roles, or create failures exit 1 with a
fixed error code. No output includes the email, name, password, database error,
or token. Remove the bootstrap variables from the process environment
immediately after the command; normal server startup never reads or needs them.
