---
name: verify-job-intelligence
description: Drive the Catapulze Job Intelligence Next.js UI (port 3001) and Hono/tRPC API (port 3000) the way a user does. Use when proving home API status, login/signup/dashboard, or sign-out against a real local instance.
---

# Verify Job Intelligence

Scripted control for the live Better-T-Stack skeleton: Next.js web on **3001**, Hono + tRPC + Better Auth on **3000**. Product features in `docs/` are not implemented; do not treat them as drive targets.

Run every command from the repository root. The parent directory `clients:catapulze` contains a colon; never prepend an absolute `node_modules/.bin` to `PATH`.

```bash
bun .cursor/skills/verify-job-intelligence/scripts/control.mjs launch
bun .cursor/skills/verify-job-intelligence/scripts/control.mjs doctor
bun .cursor/skills/verify-job-intelligence/scripts/control.mjs snapshot home-api-status
bun .cursor/skills/verify-job-intelligence/scripts/control.mjs stop
```

## Launch

Preconditions: `apps/server/.env` and `apps/web/.env` exist (copy from `.env.example`). Server needs a reachable Neon `DATABASE_URL` and a 32+ character `BETTER_AUTH_SECRET`. Web needs `NEXT_PUBLIC_SERVER_URL=http://localhost:3000`.

`launch` starts `bun run dev:server` and `bun run dev:web` as a detached process group and records PIDs in `.cursor/skills/verify-job-intelligence/.run/pids.json`.

Ready when:

- `GET http://127.0.0.1:3000/` returns body `OK`
- `GET http://127.0.0.1:3001/` is 200 and the HTML contains `Job Intelligence`

Ports **3000** and **3001** are shared defaults. Two instances cannot run side by side. If those ports already answer and the pidfile is not ours, `launch` refuses. Do not start a second copy.

Teardown is `control.mjs stop` (see Cleanup).

## Doctor

Read-only. Answers "is this instance worth driving?"

```bash
bun .cursor/skills/verify-job-intelligence/scripts/control.mjs doctor
```

Requires:

- Server root `OK`
- Web HTML contains `Job Intelligence`
- `GET http://127.0.0.1:3000/trpc/healthCheck` is 200 and the body contains `OK`
- Either this skill owns the PIDs, or `JI_VERIFY_ALLOW_SHARED=1` is set for a user-started `bun run dev`

Run doctor first whenever anything looks off. A shared instance is read-only: never `stop` it.

## Drive

Read `features/README.md`, then the matching feature file. Prefer those recipes over improvising.

Harness:

- HTTP through `control.mjs http <url>` or `control.mjs snapshot <feature-id>`
- Browser (Cursor browser tools, or Chrome headless) for client-rendered text such as the home **Connected** label — curl only sees the SSR/CSR shell
- Stable handles: heading `Job Intelligence`, heading `API status`, link `Dashboard` → `/dashboard`, button `Sign In` → `/login`, headings `Create Account` / `Welcome Back`, labels `Name` / `Email` / `Password`, buttons `Sign Up` / `Sign In`, `sr-only` name `Toggle theme`

Do not call tRPC `privateData` from a test-only client and call that a dashboard proof. The user path is `/login` then `/dashboard`.

Auth sign-up writes a real row to the configured Neon database. Use a unique `verify+<run-id>@example.test` email. There is no cleanup API; leftover verify users are expected.

## Evidence

Proof artifacts live in `.cursor/skills/verify-job-intelligence/artifacts/<feature-id>/`. Cleanup must not delete them.

Standards:

- Exercise the real user path (browser or the same HTTP the browser uses)
- Capture the action and the resulting state (`home.html` plus `trpc-healthCheck.txt`, or a screenshot plus ARIA snapshot)
- For mutations, read back from a second user-facing view (dashboard heading `Welcome <name>`, or session cookie + `GET /dashboard` not redirecting to `/login`)
- Record the feature ID in `meta.json`

Home-page **Connected** is client-side React Query. An HTML snapshot without that word is incomplete for `home-connected`; still capture `trpc-healthCheck.txt` containing `OK`.

## Cleanup

```bash
bun .cursor/skills/verify-job-intelligence/scripts/control.mjs stop
```

Sends SIGTERM (then SIGKILL) to the process groups recorded in `pids.json` only. Never `pkill` turbo, bun, or next. Leaves `artifacts/` in place. If doctor ran under `JI_VERIFY_ALLOW_SHARED=1`, do not stop.

## Helpers

```bash
bun .cursor/skills/verify-job-intelligence/scripts/control.mjs launch
bun .cursor/skills/verify-job-intelligence/scripts/control.mjs doctor
bun .cursor/skills/verify-job-intelligence/scripts/control.mjs snapshot home-api-status
bun .cursor/skills/verify-job-intelligence/scripts/control.mjs http http://127.0.0.1:3001/login
bun .cursor/skills/verify-job-intelligence/scripts/control.mjs stop
```
