# Job search

The `/jobs` route exposes Boolean job search with filters, sort, pagination, and result cards. With `NEXT_PUBLIC_USE_FIXTURES=1` in `apps/web/.env`, the UI uses in-repo fixture data and does not require Manticore or a live REST index.

## Sub-features

- `jobs-open` loads `/jobs` with search label `Zoek opdrachten met Boolean-logica`.
- `jobs-results` results region has `aria-label="Zoekresultaten"`.
- `jobs-query` the query input accepts Boolean syntax (placeholder e.g. `(Azure OR "Power BI") NOT junior`).
- `jobs-nav` header nav link `Zoeken` routes to `/jobs`.

## How to get to it (user POV)

- Choose header nav `Zoeken`.
- From home, choose `Open job search` or `Bekijk een zoekvoorbeeld`.
- Open `http://localhost:3001/jobs` directly (optional query string, e.g. `?q=Azure&freshness=30d`).

## Driving it with control.mjs

Preconditions:

- Doctor reports `ok: true`.
- `NEXT_PUBLIC_USE_FIXTURES=1` (or `true`) in `apps/web/.env` for verification without Manticore. Without fixtures, `/jobs` needs a reachable REST/search stack.

- **HTTP shell.** Run `bun .cursor/skills/verify-job-intelligence/scripts/control.mjs http http://localhost:3001/jobs`. Status `200`; body contains `Zoek opdrachten met Boolean-logica` and `Zoekresultaten`.
- **Browser results.** In a browser, wait for `[aria-label="Zoekresultaten"]` to contain at least one result card when fixtures are enabled.
- **Submit a query.** Type a Boolean query in `#job-query` and submit the search form; URL query param `q` updates and results refresh.
- **Proof.** Save HTML or a screenshot under `artifacts/job-search/` with `meta.json` recording `NEXT_PUBLIC_USE_FIXTURES` and the query exercised.

## Gotchas

- Fixture mode is a verification precondition in cloud/local verify passes; record it in `meta.json` when fixtures were required.
- Without fixtures, an empty or loading shell may mean Manticore/REST is down — that is an environment gap, not a passing search proof.
- Search UI copy is Dutch; auth pages remain English (`Create Account`, `Sign In`, etc.).
- Pagination controls use Dutch labels `Vorige pagina` / `Volgende pagina`.
