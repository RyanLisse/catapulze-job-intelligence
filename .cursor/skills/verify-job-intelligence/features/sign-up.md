# Sign up

A visitor creates an email-and-password account and lands on the dashboard, which greets them by name and shows private API text.

## Sub-features

- `signup-open` shows `Create Account` on `/login`.
- `signup-submit` accepts Name, Email, and Password (password ≥ 8 characters, name ≥ 2).
- `signup-dashboard` after success the URL is `/dashboard`, paragraph includes `Welcome <name>`, and the page contains `API: This is private`.

## How to get to it (user POV)

- Choose header button `Inloggen` (routes to `/login`, which starts on Sign Up).
- Open `/login` directly.

## Driving it with control.mjs

Preconditions:

- Doctor reports `ok: true`.
- Use a unique email `verify+<run-id>@example.test` that is not already in the database.
- Password at least 8 characters.

This path needs a browser (or Better Auth `POST http://localhost:3000/api/auth/sign-up/email` with JSON `{ "name", "email", "password" }`, then a request to `/dashboard` that forwards the `Set-Cookie` values). Prefer the browser: fill labeled `Name`, `Email`, `Password`, choose `Sign Up`.

- **Open signup.** Load `/login`. Heading is `Create Account`.
- **Submit.** Fill the three labeled fields and choose `Sign Up`. Toast `Sign up successful` may appear.
- **Land.** URL is `/dashboard`. Visible text includes `Welcome` plus the name and `API: This is private`.
- **Proof.** Screenshot plus HTML or ARIA snapshot in `artifacts/sign-up/`. Confirm a second `GET /dashboard` with the same cookies still shows the welcome line.

## Gotchas

- Signup writes a real database user. Do not use a personal email. There is no delete-user control in this app.
- Duplicate email fails with a toast; that is not a passing signup.
- Client `router.push("/dashboard")` can race session cookies. Re-load `/dashboard` before asserting.
- `API: This is private` is client-rendered via React Query; wait for it after the welcome paragraph.
- Header chrome is Dutch (`Inloggen`, `Uitloggen`); login form copy remains English.
