# Job Intelligence verification map

This directory is the maintained source for verifying the user-facing Better-T-Stack skeleton. Read this index before driving the app, then use the matching feature file as the recipe.

The checked-in app is authentication plus a public health check. Vacancy ingest, Boolean search, approvals, and Spott export are planning docs only — they have no feature files.

## Baseline preconditions

- Web at `http://localhost:3001`, API at `http://localhost:3000`.
- `apps/server/.env` and `apps/web/.env` are present.
- Run `bun .cursor/skills/verify-job-intelligence/scripts/control.mjs doctor` and require `ok: true`.
- Never `stop` an instance this skill did not `launch`.
- Ports 3000/3001 cannot be shared by two copies. If a human already has `bun run dev` up, set `JI_VERIFY_ALLOW_SHARED=1` and drive read-only.
- Use `localhost` hostnames in the browser and in `CORS_ORIGIN` / `NEXT_PUBLIC_SERVER_URL`. Opening `127.0.0.1:3001` in Next.js 16 dev blocks client chunks and leaves API status on `Checking...`.

## Driving conventions

- Start every recipe from the baseline unless its preconditions say otherwise.
- Prefer headings, labeled inputs, and link text over CSS or DOM position.
- Treat helper commands as literal.
- Restore nothing on Neon after signup; use a unique verify email per run.
- Do not delete proof artifacts during cleanup.

## Proof and skip reporting

- Capture the user action and the resulting state, not only the final screen.
- UI proof includes saved HTML or a screenshot with `Job Intelligence` visible.
- API proof includes status code and body.
- Record the feature ID in `artifacts/<id>/meta.json`.
- Report an unreachable path with the unmet precondition. Do not mark it verified via a different path.

## Feature entry contract

Each feature file starts with an H1 and one paragraph, then exactly four H2s: `Sub-features`, `How to get to it (user POV)`, `Driving it with control.mjs`, `Gotchas`.

## Features

- [Home API status](./home-api-status.md) covers the public home page and tRPC `healthCheck`.
- [Dashboard guard](./dashboard-guard.md) covers unauthenticated `/dashboard` redirect to `/login`.
- [Sign up](./sign-up.md) covers creating an account and landing on the dashboard.
- [Sign in and sign out](./sign-in-and-sign-out.md) covers returning users and clearing the session.
