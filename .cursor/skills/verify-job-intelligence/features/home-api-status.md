# Home API status

Home shows the product name and whether the Hono API is reachable. The status label is filled in the browser from public tRPC `healthCheck`.

## Sub-features

- `home-open` loads `/` with heading `Job Intelligence`.
- `home-api-section` shows heading `API status`.
- `home-health-ok` the API `healthCheck` procedure returns `OK`.
- `home-connected` the browser label reads `Connected` after the query resolves (not visible to curl).

## How to get to it (user POV)

- Open `http://127.0.0.1:3001/` in the browser.
- Choose the `Job Intelligence` link in the header while on another route.

## Driving it with control.mjs

Preconditions:

- Doctor reports `ok: true`.
- No session is required.

- **Open home.** Load `/`. Run `bun .cursor/skills/verify-job-intelligence/scripts/control.mjs http http://127.0.0.1:3001/`. Status `200` and the body contain `Job Intelligence` and `API status`.
- **API health.** Hit tRPC. Run `bun .cursor/skills/verify-job-intelligence/scripts/control.mjs http http://127.0.0.1:3000/trpc/healthCheck`. Status `200` and the body contain `OK`.
- **Connected label.** In a browser, wait until the status text is `Connected` (not `Checking...` or `Disconnected`). Curl cannot prove this sub-feature.
- **Proof.** Save both bodies. Run `bun .cursor/skills/verify-job-intelligence/scripts/control.mjs snapshot home-api-status`. `artifacts/home-api-status/home.html` contains `Job Intelligence`; `trpc-healthCheck.txt` contains `OK`.

## Gotchas

- `Disconnected` means the web app loaded but `NEXT_PUBLIC_SERVER_URL` cannot reach port 3000 (server down, CORS, or wrong env).
- The green/red dot is decorative. Assert the text `Connected` or the tRPC body.
- Do not treat `docs/BUILD_BRIEF.md` copy on the home page as evidence that ingest or search exists.
