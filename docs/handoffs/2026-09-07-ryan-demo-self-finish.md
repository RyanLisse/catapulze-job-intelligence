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

Voiceover WAV (HeyGen Sharon, nl) lives under `demos/.tmp/` (gitignored). Scripts: `scripts/demo/narration.ts`, `scripts/demo/narration-search.ts`.

```bash
# Optional: prove cursor + VO mux without login (~18s home smoke)
bun run demo:smoke-cursor-vo

# Full product tour (needs secrets)
JI_DEMO_EMAIL='…' JI_DEMO_PASSWORD='…' bun run demo:record

# Search methods + filters overview (Boolean OR/AND, facets, sort, archive, chips)
JI_DEMO_EMAIL='…' JI_DEMO_PASSWORD='…' bun run demo:record-search
```

What the recorders do:

1. Live preflight (tip SHA + `/readyz` ready, lag 0).
2. **ffmpeg x11grab** at 1280×800 with **`-draw_mouse 1`** on `DISPLAY` (default `:1`).
3. Headed Chromium at `0,0` with an **orange ring overlay** and deliberate `mouse.move` steps.
4. Mux Dutch voiceover (AAC) into `demos/*.mp4` + `.meta.txt`.

`demo:record-search` specifically shows:

1. Boolean OR + phrase + NOT — `(Azure OR "Power BI") NOT junior`
2. Boolean AND — `Azure AND data`
3. Facets — Bron, Contract, Gepubliceerd (30d), optional minimumtarief → chips
4. Sort — Nieuwste eerst
5. Archive — **Ook in archief zoeken** (`archief=1`)
6. **Alles wissen** → one result detail with provenance

Overrides: `JI_DEMO_APP_URL`, `JI_DEMO_API_URL`, `JI_DEMO_OUT_DIR`, `JI_DEMO_VOICEOVER`, `JI_DEMO_SEARCH_VOICEOVER`, `DISPLAY`.

---

## Tour

1. `/` home → 2. login (blur password) → 3. `/jobs` Boolean search → 4. one detail → 5. `/bronnen` → 6. `/bronnen/runs` → 7. `/dashboard` → 8. sign out.

**Do not film:** Spott/Motian admin, Coolify, vault, terminal, passwords, long red agent panels.

---

## Out of scope

- CoS will not re-record unless asked.
- CTP-371 Gate F remains Ryan when ready.
- Discarded bot takes: `ji-feature-demo-20260907.mp4`, `ji-feature-demo-take2-20260907.mp4`.
