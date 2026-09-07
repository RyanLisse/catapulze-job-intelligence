# JI demo — Ryan self-finish (2026-09-07)

**Owner:** Ryan  
**Done when:** a client-safe 3–6 min H.264 MP4 exists under `demos/` with a one-line `.meta.txt` (tip SHA + duration), covering the tour below. Bot takes are discarded for external use.

**Live tip (re-check; do not trust a stale SHA):**

```bash
bun scripts/demo/preflight.ts
```

Defaults: app `https://app.23-88-60-222.sslip.io`, API `https://api.23-88-60-222.sslip.io`. Cookie Domain hotfix (#200) is live (shared parent `.23-88-60-222.sslip.io`).

---

## Auth (no secrets here)

- Better Auth email/password; public sign-up off.
- Prefer one **`admin`** login so `/jobs` and `/bronnen` both work (`recruiter` for search alone; `operator`/`admin` for bronnen).
- Credentials live in **1Password** / Coolify vault only. Never paste into chat, Linear, or git.
- Missing user: Coolify server terminal → `auth:provision` per `docs/runbooks/auth-access.md` with `ROLE=admin`. Strip `AUTH_BOOTSTRAP_*` after success.
- Still Ryan-only: **CTP-371 / Gate F** secret rotation when ready.

---

## Record (one command)

Inject secrets via 1Password (or Coolify), never argv:

```bash
JI_DEMO_EMAIL='…' JI_DEMO_PASSWORD='…' bun scripts/demo/record.ts
```

Optional overrides: `JI_DEMO_APP_URL`, `JI_DEMO_API_URL`, `JI_DEMO_QUERY` (default `java OR devops`), `JI_DEMO_OUT_DIR` (default `demos`).

The script:

1. Runs the same preflight as above (exact tip SHA + `/readyz` ready, searchProjection lag 0).
2. Opens headed Chromium at 1280×800 on `DISPLAY` (default `:1`).
3. Tours home → login (password field not logged) → `/jobs` Boolean search → one detail → `/bronnen` KPIs → `/bronnen/runs` → optional `/dashboard` → sign out.
4. Writes `demos/ji-feature-demo-ryan-YYYYMMDD.mp4` + `.meta.txt`.

**Manual Mac fallback:** QuickTime/OBS at 1280×800; same tour; drop MP4 under `demos/` and write the meta line yourself.

---

## Tour (client-safe story)

1. `/` — home / command center once.
2. `/login` → sign in (blur password; do not linger on a personal email).
3. `/jobs` — generic Boolean query; wait for real result count + facets.
4. Open **one** result → detail/provenance. Blur contact / client-sensitive fields if present.
5. `/bronnen` — KPI cards + source list. Scroll past red/empty agent rows; do not dwell.
6. `/bronnen/runs` — one healthy run if available.
7. Optional `/dashboard` only if it stays authed and clean.
8. Sign out.

**Do not film:** Spott / Company OS / Motian admin, Coolify, vault, env, terminal, passwords, full-screen private opdrachtgever lists, long “agents failing” panels.

---

## Gotchas

| Issue | Status |
|-------|--------|
| Host-only cookies on `api.*` → app SSR 401 | Fixed #200 |
| UI maps 401 → “zoeken tijdelijk niet beschikbaar” | Re-login |
| `operator` alone may lack search | Prefer `admin` |
| Motian Neon | Do not bounce for demo |
| CTP-479 Effect prod flags | Parked — leave off |

---

## Out of scope

- CoS will not re-record unless asked.
- No secrets in chat or this file.
- CTP-371 Gate F remains Ryan when ready.
- Discarded bot takes: `ji-feature-demo-20260907.mp4`, `ji-feature-demo-take2-20260907.mp4`.
