# Live `/jobs` browser verification

This opt-in Playwright harness verifies the deployed `/jobs` path without
starting a server, replacing network responses, accepting fixture mode, or
recording production business payloads. It is deliberately a canary-only
release proof, not a completeness proof for ordinary production data.

Every run requires `E2E_EXPECTED_RELEASE_SHA`, an exact 40-character Git SHA.
The API exposes only its configured `APP_RELEASE_SHA` at `GET /version`:

```json
{ "releaseSha": "0123456789abcdef0123456789abcdef01234567" }
```

The runner refuses any redirect, non-200 response, malformed identity, or SHA
mismatch before it starts Playwright. Configure `APP_RELEASE_SHA` in the
deployment environment; it is public metadata, not a secret. An absent server
value returns HTTP 503 rather than pretending to identify a release.

## Data and artifact boundaries

The authenticated read lane requires all of the following:

- `E2E_DATA_MODE=canary`;
- one immutable UUID in `E2E_CANARY_ID`;
- a Boolean `E2E_QUERY` whose search and batch responses each contain
  **exactly that one ID**;
- `E2E_CANARY_DIGEST`, the mandatory pinned SHA-256 of canonical JSON for the
  direct-detail response's `aanvraag` object (never the raw preview);
- `E2E_EXPECTED_SUBJECT_ID`, the exact Better Auth user ID expected from the
  dedicated account.

The browser deep-links directly to `/jobs?q=…&job=<E2E_CANARY_ID>`; it never
clicks the first search result. A wrong ID, no ID, duplicate IDs, or a
production record listed first fails before any harness attachment is written.
The test reads only opaque IDs from search/batch payloads and never retains
their fields. It validates the direct-detail canary ID and required pinned
digest in memory, then issues a runtime-only screenshot attestation. A caller
cannot self-declare that a screenshot is safe. Raw-preview response bodies are
never read by the harness.

Every run, including local isolated runs, turns trace, video, and Playwright's
automatic screenshots off. Each lane also installs an exact method/path
allowlist for every `/v1` request. Any unexpected capability request fails the
evidence, including a successful mutation outside the mutation lane's explicit
allowlist.
After every assertion succeeds, the authenticated lane emits only:

- a sanitized JSON route/status list with no headers, origins, query strings,
  payloads, cookies, IDs, or subjects;
- an explicitly sanitized canary screenshot whose entire rendered body is
  masked (including the global header/account area, application content,
  overlays, and toasts), so no response-derived field or real payload can be
  retained;
- a sanitized pass manifest.

Failed runs intentionally receive no harness attachment or pass manifest.
No run retains a Playwright trace. Local isolated runs must still use seeded or
explicit non-PII canary data. Never attach or share a storage state, cookie,
cleanup token, raw preview, ordinary vacancy, or aanvraag payload.

RJC-403 production proof remains split: canary browser/network/release-SHA
proof is separate from real-data completeness, which uses aggregate counts,
ID-set digests, and sanitized text-free readbacks.

## Authenticated read-only run

Install Chromium separately on the driver machine; this repository does not
install browser binaries during dependency install. Use only a known non-PII
canary record.

```bash
E2E_LIVE=1 \
E2E_AUTH_MODE=session \
E2E_DATA_MODE=canary \
E2E_BASE_URL=https://jobs.example \
E2E_API_URL=https://api.jobs.example \
E2E_EXPECTED_RELEASE_SHA=0000000000000000000000000000000000000000 \
E2E_QUERY='"canary job intelligence record"' \
E2E_CANARY_ID=00000000-0000-4000-8000-000000000001 \
E2E_CANARY_DIGEST=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
E2E_EXPECTED_SUBJECT_ID='<dedicated-test-account-id>' \
E2E_STORAGE_STATE='/absolute/untracked/authenticated-state.json' \
bun run e2e:live:jobs
```

Both URLs must be HTTPS origins without a path, query, credentials, or
fragment. Use `.example` placeholders exactly as above; do not copy
`example.example`. The runner refuses fixture mode, test-host targets, and
non-local HTTP. Local mode permits only localhost URLs and never permits
fixture evidence.

The storage state must be captured from a real dedicated-account login outside
the repository. The settled Better Auth contract is a host-only API cookie:
`better-auth.session_token` over local HTTP or
`__Secure-better-auth.session_token` over HTTPS, with the API at
`/api/auth/get-session`. A future approved verifier must prove that endpoint
returns a non-expired session and exactly `E2E_EXPECTED_SUBJECT_ID`, without
logging/attaching a cookie or response body. Until Ryan explicitly authorizes
that narrow cookie-to-configured-API preflight, the authenticated and mutation
commands fail safely before a browser starts; this harness does not invent
credentials or fall back to role headers.

The browser client must use Better Auth cookies with
`credentials: "include"`. A `Bearer recruiter:`/role bearer or a
caller-role header is a recorded boolean violation and fails the run; no header
value is retained.

## Anonymous protected-state run

The anonymous lane has no storage state. It verifies the protected `/jobs`
heading and login link, sees no capability REST call, and requires the same
release SHA proof:

```bash
E2E_LIVE=1 \
E2E_AUTH_MODE=anonymous \
E2E_BASE_URL=https://jobs.example \
E2E_API_URL=https://api.jobs.example \
E2E_EXPECTED_RELEASE_SHA=0000000000000000000000000000000000000000 \
bun run e2e:live:jobs:anonymous
```

## Isolated mutation run

Saved searches, snapshots, and markeringen have no public delete APIs. Mutation
verification is therefore local and isolated only:

- `E2E_LIVE=1`, `E2E_LOCAL_MODE=1`, `E2E_TEST_ENV=isolated`, and
  `E2E_ALLOW_WRITES=1` are exact;
- it has the same session, release SHA, canary, and artifact requirements as
  the read-only lane;
- `E2E_TEST_ACCOUNT_ID` must equal `E2E_EXPECTED_SUBJECT_ID` in config and
  the Better Auth-derived subject before any cleanup or browser write;
- the cleanup URL is same-origin `/e2e/cleanup`, requires an environment-only
  token, and must return exactly HTTP 204 to an idempotent empty-resource
  preflight before Playwright launches;
- the normal cleanup call must also return exact HTTP 204. Its receipt contains
  only status, namespace, and resource kinds, and is attached only after the
  full flow passes.

```bash
E2E_LIVE=1 \
E2E_LOCAL_MODE=1 \
E2E_ALLOW_WRITES=1 \
E2E_TEST_ENV=isolated \
E2E_AUTH_MODE=session \
E2E_DATA_MODE=canary \
E2E_BASE_URL=http://localhost:3001 \
E2E_API_URL=http://localhost:3000 \
E2E_EXPECTED_RELEASE_SHA=0000000000000000000000000000000000000000 \
E2E_QUERY='"canary job intelligence record"' \
E2E_CANARY_ID=00000000-0000-4000-8000-000000000001 \
E2E_CANARY_DIGEST=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
E2E_EXPECTED_SUBJECT_ID='<dedicated-test-account-id>' \
E2E_TEST_ACCOUNT_ID='<dedicated-test-account-id>' \
E2E_STORAGE_STATE='/absolute/untracked/state.json' \
E2E_TEST_NAMESPACE='e2e-20260902-local' \
E2E_CLEANUP_URL=http://localhost:3000/e2e/cleanup \
E2E_CLEANUP_TOKEN='<environment-only-token>' \
bun run e2e:live:jobs:writes
```

Until a dedicated cleanup endpoint and the approved session verifier exist,
the mutation command fails before a browser can mutate anything.

If both the primary mutation flow and cleanup fail, the runner reports a
sanitized `AggregateError` that preserves both failure classes without
retaining raw Playwright, payload, account, or credential details.

## Offline checks

These commands never start a browser or contact a configured target:

```bash
bun run test:e2e-live-jobs:config
bun run check-types:e2e-live-jobs
bun run e2e:live:jobs:discover
bun run e2e:live:jobs:anonymous:discover
bun run e2e:live:jobs:writes:discover
```
