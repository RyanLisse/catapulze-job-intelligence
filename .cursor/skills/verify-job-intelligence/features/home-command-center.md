# Home command center

The public home page (`/`) is a recruiter command center with preview metrics and links into job search. API reachability is verified by doctor via tRPC `healthCheck`; home no longer shows an on-page API status section.

## Sub-features

- `home-open` loads `/` with heading `Vind de juiste opdracht vóór de rest.`
- `home-brand` header lockup still contains `Job Intelligence` (brand text in `header.tsx`).
- `home-cta-search` primary link `Open job search` routes to `/jobs`.
- `home-cta-example` secondary link `Bekijk een zoekvoorbeeld` routes to `/jobs?q=Azure&freshness=30d`.
- `home-health-ok` tRPC `healthCheck` returns `OK` (doctor-only; not rendered on home).

## How to get to it (user POV)

- Open `http://localhost:3001/` in the browser.
- Choose header nav `Overzicht` while on another route.
- Choose the brand link `Catapulze Job Intelligence — overzicht` in the header.

## Driving it with control.mjs

Preconditions:

- Doctor reports `ok: true`.
- No session is required.

- **Open home.** Load `/`. Run `bun .cursor/skills/verify-job-intelligence/scripts/control.mjs http http://localhost:3001/`. Status `200`; body contains `Vind de juiste opdracht` and `Job Intelligence`. Body does **not** contain `API status` or `Connected`.
- **API health (doctor).** Run `bun .cursor/skills/verify-job-intelligence/scripts/control.mjs doctor`. `healthBody` contains `OK`.
- **CTAs.** In a browser, choose `Open job search` and land on `/jobs`.
- **Proof.** Run `bun .cursor/skills/verify-job-intelligence/scripts/control.mjs snapshot home-command-center`. `artifacts/home-command-center/home.html` contains the recruiter H1; `trpc-healthCheck.txt` contains `OK`.

## Gotchas

- Do not expect `API status` or a browser `Connected` label on home — those belonged to the old skeleton and were removed in U9.
- Opening the app at `127.0.0.1:3001` while env uses `localhost` can block Next.js dev chunks. Drive at `localhost:3001`.
- Fixture metrics and charts on home are synthetic preview data, not live ingest counts.
- Do not treat preview copy about U7 REST as evidence that production ingest is wired.
