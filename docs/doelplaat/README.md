# Doelplaat-export — status

Bron: artifact "Catapulze Architectuur Explorer" (doelarchitectuur v1.1, 25-08-2026) — https://claude.ai/code/artifact/93692ad4-4974-4204-986b-d955d28576dc

| Onderdeel | Status | Bestand |
|---|---|---|
| Hoofdplaat — volledige tekst (4 lagen, 2 verticale balken, koppelvlakken, vervolgstappen, laaglogica) | ✅ geëxporteerd 27-08 | `doelplaat-v1.1-tekst.md` |
| Beslissingen (logboek) | ✅ overgenomen uit paneel | hieronder |
| Deep dive Job Intelligence — tab Bronnen (29) | ✅ | `../SOURCE_MATRIX.md` (geverifieerd) |
| Deep dive — tab Requirements + Mapping v1→v2 | ✅ | `../REQUIREMENTS_V2.json` |
| Volledig model (JSON) | ❌ nog niet | zit in cross-origin iframe; "Download JSON" in de viewer, of artifact delen met dit account |
| Documenten-lijst | ❌ nog niet | idem |
| Datamodel (entiteiten) / spec v0.2 §4 (75 velden) | ❌ nog niet | "JSON van de spec" in de deep dive |
| Deep dive tabs Overzicht · Pipeline · Datalaag · Config & stack · Fasen & compliance · JSON Schema · v1-analyse | ❌ nog niet | idem |

## Beslissingen (logboek, alle 2026-08-25)

| Beslissing | Toelichting |
|---|---|
| Naam datastroom: Catapulze Job Intelligence | Losse module; platformen + werkenbij-sites; analyse/search erop |
| Eerst specificeren, dan bouwen (vanaf nul) | Spec beschrijft de gewenste eindsituatie, los van v1 — *heroverwogen 27-08: v1-scrapers hergebruiken, spec groeit uit de slice* |
| Uniforme datastructuur + DWH als harde eis | Essentieel voor Robbie |
| Spott.io als ATS/CRM | Gekozen; inrichting volgt |
| Datalaag/Company OS op cloud-agnostische stack | Postgres + object storage, MCP, LangGraph/Pydantic AI, LiteLLM — *27-08: Manticore erbij, Trigger.dev als orkestratie, TS i.p.v. Python* |
| DWH-technologie nog niet gekozen | Keuze en laadpatroon horen bij de specificatie — *27-08: Postgres + DuckLake voor analytics* |
