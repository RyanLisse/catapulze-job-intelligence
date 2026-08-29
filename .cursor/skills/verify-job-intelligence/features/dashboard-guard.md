# Dashboard guard

Visiting the dashboard without a session sends the user to login. The dashboard is not a public page.

## Sub-features

- `guard-redirect` unauthenticated `GET /dashboard` redirects to `/login`.
- `guard-login-visible` the login route then shows `Create Account` (default) or `Welcome Back`.

## How to get to it (user POV)

- Choose the `Dashboard` header link while signed out.
- Open `http://localhost:3001/dashboard` directly.

## Driving it with control.mjs

Preconditions:

- Doctor reports `ok: true`.
- No Better Auth session cookies are sent.

- **Follow the header.** Note `Dashboard` goes to `/dashboard`.
- **Unauthenticated fetch.** Run `bun .cursor/skills/verify-job-intelligence/scripts/control.mjs http http://localhost:3001/dashboard`. Status is `307` or `302` and the `location` header contains `/login`.
- **Login shell.** Run `bun .cursor/skills/verify-job-intelligence/scripts/control.mjs http http://localhost:3001/login`. Status `200` and the body contain `Create Account` or `Welcome Back`.
- **Proof.** Save the dashboard response headers and login HTML under `artifacts/dashboard-guard/` (copy from the http output into `meta.json` plus `login.html`).

## Gotchas

- A 200 dashboard HTML that still says `Welcome` is a logged-in session, not a passing guard.
- The login page defaults to **Sign Up** (`Create Account`). `Welcome Back` appears only after choosing `Already have an account? Sign In`.
