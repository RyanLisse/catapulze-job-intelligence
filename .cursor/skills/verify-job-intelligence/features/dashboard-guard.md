# Dashboard guard

Visiting the dashboard without a session sends the user to login. The guard is implemented as a page-level `redirect("/login")` in `apps/web/src/app/dashboard/page.tsx`, not Next.js middleware. The dashboard is not a public page and has no header nav link (only `Overzicht` and `Zoeken` appear in the main nav).

## Sub-features

- `guard-redirect` unauthenticated `GET /dashboard` redirects to `/login` (307/302).
- `guard-login-visible` the login route then shows `Create Account` (default) or `Welcome Back`.

## How to get to it (user POV)

- Open `http://localhost:3001/dashboard` directly while signed out.

## Driving it with control.mjs

Preconditions:

- Doctor reports `ok: true`.
- No Better Auth session cookies are sent.

- **Unauthenticated fetch.** Run `bun .cursor/skills/verify-job-intelligence/scripts/control.mjs http http://localhost:3001/dashboard`. Status is `307` or `302` and the `location` header contains `/login`. Doctor also reports `dashboardLocation: "/login"`.
- **Login shell.** Run `bun .cursor/skills/verify-job-intelligence/scripts/control.mjs http http://localhost:3001/login`. Status `200`. In a browser, heading is `Create Account` or `Welcome Back` (client-rendered).
- **Proof.** Save the dashboard response headers and browser login evidence under `artifacts/dashboard-guard/` (`meta.json` plus screenshot or `login.html`).

## Gotchas

- A 200 dashboard HTML that still says `Welcome` is a logged-in session, not a passing guard.
- The login page defaults to **Sign Up** (`Create Account`). `Welcome Back` appears only after choosing `Already have an account? Sign In`.
- There is no `Dashboard` link in the header; do not follow a stale map that references one.
- Do not expect middleware-based auth on `/dashboard`; assert the page redirect response.
