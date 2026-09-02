# Live `/jobs` browser verification

This is an opt-in Playwright harness for the deployed `/jobs` path. It drives
the real web app and the REST calls the browser makes; it does not start a
server, replace network responses, or accept fixture mode as live evidence.

The authenticated lane is read-only and requires explicit non-PII canary data.
It uses a genuine pre-authenticated Playwright storage state, proves a supplied
Boolean canary query has a visible result, opens that result, verifies
provenance and raw-preview UI, and observes the browser's actual REST calls:

- `GET /v1/bronnen`
- `POST /v1/aanvragen/search`
- `POST /v1/aanvragen/batch`
- `GET /v1/aanvragen/:id`
- `GET /v1/aanvragen/:id/versies`
- `GET /v1/raw/:ref`

The test fails on a browser console error, page error, failed request (including
CORS), or any tracked 4xx/5xx response. It stores a screenshot, Playwright
trace/video, and redacted network-event list under
`.artifacts/e2e/live-jobs/`, which is ignored by git.

## Read-only run

Install Chromium separately on the machine that will drive the target; this
repository deliberately does not install browser binaries during dependency
install. Choose a known, non-sensitive canary Boolean query that is expected to
return at least one result. Its record and raw-preview payload must contain no
production business data or PII.

```bash
E2E_LIVE=1 \
E2E_AUTH_MODE=session \
E2E_DATA_MODE=canary \
E2E_BASE_URL=https://jobs.example.example \
E2E_API_URL=https://api.jobs.example.example \
E2E_QUERY='canary job intelligence record' \
E2E_STORAGE_STATE='/absolute/untracked/authenticated-state.json' \
bun run e2e:live:jobs
```

Both URLs must be HTTPS origins with no path, query, embedded credential, or
fragment. The runner refuses `NEXT_PUBLIC_USE_FIXTURES=true|1`, and the page
itself must visibly identify as `Live · U7 REST`, never `Previewdata · fixtures`.
It also refuses `localhost`, `.test`, `.local`, and `.invalid` hosts unless
`E2E_LOCAL_MODE=1` is explicit. Local mode permits only local URLs and still
requires the real REST adapter; it does not make fixture evidence acceptable.

The storage state must be captured from a real, dedicated account login outside
the repository. The harness never accepts credentials, invents an authorization
header, or signs a user in itself. `E2E_STORAGE_STATE` must be an absolute path
outside the working tree. `E2E_DATA_MODE=canary` is mandatory for every
authenticated run, including a local isolated target.

Open each capture before sharing it. A production result may contain business
data, so this harness must never be pointed at ordinary production vacancies or
raw payloads. It may prove a deployed release only with a deliberately
non-sensitive canary record. Never put a browser storage state, session cookie,
cleanup token, or other credential in this repository.

RJC-403 production proof is intentionally split: browser/network/release-SHA
proof uses only canary data; actual-data completeness is a separate operation
using aggregate counts, ID-set digests, and sanitized text-free readbacks. Do
not substitute screenshots, traces, or raw previews for that aggregate proof.

## Anonymous protected-state run

The anonymous proof deliberately uses no storage state. It verifies that
`/jobs` shows `Log in om opdrachten te bekijken`, exposes a `/login` link, and
does not make any `/v1/*` capability request. Run it separately from the
authenticated read path:

```bash
E2E_LIVE=1 \
E2E_AUTH_MODE=anonymous \
E2E_BASE_URL=https://jobs.example.example \
E2E_API_URL=https://api.jobs.example.example \
bun run e2e:live:jobs:anonymous
```

## Isolated mutation run

Saved searches, snapshots, and markeringen have no public delete APIs. The
mutation spec is therefore intentionally stricter than the read-only lane:

- it only accepts an isolated **local** environment;
- `E2E_LIVE=1`, `E2E_LOCAL_MODE=1`, and `E2E_ALLOW_WRITES=1` must all be exact;
- `E2E_AUTH_MODE=session` and a real pre-authenticated browser storage state
  are mandatory; no role header is manufactured by the test;
- `E2E_DATA_MODE=canary` is mandatory, and the isolated target must contain
  only seeded or explicit non-PII canary records used by this test;
- `E2E_TEST_ENV=isolated`, a dedicated `E2E_TEST_ACCOUNT_ID`, an absolute
  untracked `E2E_STORAGE_STATE`, and a lowercase `E2E_TEST_NAMESPACE` beginning
  with `e2e-` are required;
- it writes a namespace into the saved-search and snapshot query;
- it requires a same-origin `E2E_CLEANUP_URL` ending in `/e2e/cleanup` and an
  environment-only `E2E_CLEANUP_TOKEN` before the browser starts.

The cleanup endpoint is not currently implemented by this product. A dedicated
test environment must provide an idempotent endpoint that accepts the account,
namespace, and resource ids; it must accept an empty resource list as an
idempotent no-op preflight and remove or tombstone the saved search, snapshot,
and markering without logging secret headers or raw payloads. Until that
endpoint exists, the mutation command fails safely before Playwright starts or
the browser can write.

```bash
E2E_LIVE=1 \
E2E_LOCAL_MODE=1 \
E2E_ALLOW_WRITES=1 \
E2E_TEST_ENV=isolated \
E2E_AUTH_MODE=session \
E2E_DATA_MODE=canary \
E2E_BASE_URL=http://localhost:3001 \
E2E_API_URL=http://localhost:3000 \
E2E_QUERY='canary job intelligence record' \
E2E_TEST_ACCOUNT_ID='<dedicated-test-account-id>' \
E2E_STORAGE_STATE='/absolute/untracked/state.json' \
E2E_TEST_NAMESPACE='e2e-20260902-local' \
E2E_CLEANUP_URL=http://localhost:3000/e2e/cleanup \
E2E_CLEANUP_TOKEN='<environment-only-token>' \
bun run e2e:live:jobs:writes
```

The mutation flow clicks the real UI controls for mark relevant, save search,
and create snapshot. It emits only a cleanup receipt with status, namespace,
and resource kinds; it never records the cleanup token or storage state.

## Offline checks

These checks never launch a browser or contact a configured target:

```bash
bun run test:e2e-live-jobs:config
bun run check-types:e2e-live-jobs
bun run e2e:live:jobs:discover
bun run e2e:live:jobs:anonymous:discover
bun run e2e:live:jobs:writes:discover
```
