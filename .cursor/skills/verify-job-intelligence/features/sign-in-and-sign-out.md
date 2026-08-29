# Sign in and sign out

A returning user signs in from `Welcome Back`, sees the dashboard, then signs out and returns to home without a session.

## Sub-features

- `signin-switch` from `Create Account`, choose `Already have an account? Sign In` to get `Welcome Back`.
- `signin-submit` valid email/password reaches `/dashboard`.
- `signout` the user-menu control labeled with the account name exposes `Sign Out` and returns to `/`.

## How to get to it (user POV)

- `/login` → `Already have an account? Sign In`.
- Header `Sign In` while signed out, then switch to the sign-in form.
- Signed-in header button showing the user's name → `Sign Out`.

## Driving it with control.mjs

Preconditions:

- Doctor reports `ok: true`.
- An existing account (from a prior sign-up run). Do not invent credentials.

Browser path:

- **Switch form.** On `/login`, choose `Already have an account? Sign In`. Heading becomes `Welcome Back`.
- **Submit.** Fill labeled `Email` and `Password`, choose `Sign In`. Land on `/dashboard` with paragraph `Welcome <name>`.
- **Sign out.** Open the header button whose name is the user name, choose `Sign Out`. URL becomes `/`. Header shows button `Sign In` again.
- **Proof.** After sign-in, `GET /dashboard` with cookies is 200. After sign-out, `GET /dashboard` without those cookies (or after cookie clear) redirects to `/login`. Save both under `artifacts/sign-in-and-sign-out/`.

## Gotchas

- `/login` opens on Sign Up. If you submit email/password on `Create Account` you are signing **up**, not in.
- Sign-out `onSuccess` pushes `/`. Proving sign-out requires a follow-up `/dashboard` request that redirects.
- Shared local sessions: signing out here signs out that browser profile on 3001.
- Dashboard welcome is a `<p>Welcome {name}</p>`, not a heading.
