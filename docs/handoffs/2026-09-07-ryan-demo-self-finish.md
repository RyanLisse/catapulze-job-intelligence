# JI demo — Ryan self-finish (2026-09-07)

**Owner:** Ryan  
**Done when:** a client-safe ~45–60 s H.264 MP4 under `demos/` with (1) a clearly visible cursor and (2) Dutch voiceover, plus a one-line `.meta.txt` (tip SHA + duration). Bot takes stay discarded for external use.

**Live tip (re-check; do not trust a stale SHA):**

```bash
bun run demo:preflight
```

Defaults: app `https://app.23-88-60-222.sslip.io`, API `https://api.23-88-60-222.sslip.io`. Cookie Domain hotfix (#200) is live.

---

## Auth (no secrets here)

- Prefer one **`admin`** login so `/jobs` and `/bronnen` both work.
- Credentials live in **1Password** / Coolify vault only. Never paste into chat, Linear, or git.
- Missing user: Coolify → `auth:provision` per `docs/runbooks/auth-access.md` (`ROLE=admin`). Strip `AUTH_BOOTSTRAP_*` after success.

---

## Record (cursor + voiceover)

Voiceover WAV (HeyGen Sharon, nl) ships as a local artifact under `demos/.tmp/ji-demo-voiceover-nl.wav` (gitignored). Script text: `scripts/demo/narration.ts`.

```bash
# Optional: prove cursor + VO mux without login (~18s home smoke)
bun scripts/demo/smoke-cursor-vo.ts

# Full client tour (needs secrets via 1Password inject)
JI_DEMO_EMAIL='…' JI_DEMO_PASSWORD='…' bun run demo:record
```

What `demo:record` does:

1. Live preflight (tip SHA + `/readyz` ready, lag 0).
2. Starts **ffmpeg x11grab** at 1280×800 with **`-draw_mouse 1`** on `DISPLAY` (default `:1`).
3. Opens headed Chromium pinned to `0,0`, injects an **orange ring overlay** that tracks the pointer, and drives the tour with deliberate `mouse.move` steps so the cursor reads on phone.
4. Muxes the Dutch voiceover (AAC) into `demos/ji-feature-demo-ryan-YYYYMMDD.mp4` and writes `.meta.txt` (`cursor=x11grab+overlay`).

Overrides: `JI_DEMO_APP_URL`, `JI_DEMO_API_URL`, `JI_DEMO_QUERY`, `JI_DEMO_OUT_DIR`, `JI_DEMO_VOICEOVER`, `DISPLAY`.

---

## Tour

1. `/` home → 2. login (blur password) → 3. `/jobs` Boolean search → 4. one detail → 5. `/bronnen` → 6. `/bronnen/runs` → 7. `/dashboard` → 8. sign out.

**Do not film:** Spott/Motian admin, Coolify, vault, terminal, passwords, long red agent panels.

---

## Out of scope

- CoS will not re-record unless asked.
- CTP-371 Gate F remains Ryan when ready.
- Discarded bot takes: `ji-feature-demo-20260907.mp4`, `ji-feature-demo-take2-20260907.mp4`.
