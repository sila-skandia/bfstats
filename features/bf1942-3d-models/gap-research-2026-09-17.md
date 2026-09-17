# Gap research plan — model extraction & map playthrough

Date: 2026-09-17. Trigger: deep research across feature docs, parity audits,
engine ledger, and both client/server binaries (Ghidra). Agents investigate in
parallel; highest-priority items proceed without waiting for confirmation.

## Sources consulted

| Source | Role |
|---|---|
| `features/bf1942-3d-models/parity-gaps.md` + `parity-audit/*` | Ranked gap catalogue (may lag code) |
| `features/bf1942-3d-models/*.md` (flythrough, kits, collision, HUD, …) | Shipped-work narratives |
| `features/bf1942-engine-reference/ledger.md` + `symbols.json` | Binary-verified claims; open rows |
| `.agents/skills/bf1942-mod-extraction/SKILL.md` | Pipeline + Ghidra working rules |
| `features/authentic-spawn-map/README.md` §8 | Interface backlog |
| Ghidra project `bf1942-mp-enabler` — `BF1942.exe` open | Client RE |
| `BF1942_w32ded.exe` + `bf1942_lnxded.static` on disk | Server RE (import if missing) |

## Working rule (from the skill)

Survey the data first. Open Ghidra only when a model/map is visibly wrong and
the archives cannot explain why — or when a ledger row is already `open` and
blocks a known viewer defect.

## Priority triage

### P0 — verify stale vs live (code may have landed)

Several "High impact, small" rows in `parity-gaps.md` already have parsers /
call sites in tree. Confirm end-to-end (parse → scene.json/glb → viewer) and
either close the doc row or file a concrete remaining bug:

1. `Object.geometry.scale` / `.color` — `level.py` + `gltf.py` present
2. Level-local `StandardMesh/` via `add_level_meshes` — called from `extract_map.py`
3. Fog spellings `fogStart`/`fogEnd`/`setFogColorVec` — in `parse_init_con`
4. Map collision on by default — landed per parity-gaps "Landed" table

### P0 — still structurally open (keystones)

| # | Gap | Why now | Binary angle |
|---|---|---|---|
| K1 | EffectBundles selected on impact but not played | Blocks impact look + audio + decals | Emitter load / EffectBundle draw path |
| K2 | Emitter data model ~80% unparsed (`intensity`, cones, flipbooks) | Every particle gap is downstream | Client EffectTemplate / ParticleSystem |
| K3 | Physics scalars never exported to glb | Flight/drive constants typed by hand | Confirm which template fields the sim reads (lnxded) |
| K4 | No soldier in map flythrough | Highest visual parity miss for "playthrough" | Spawn → kit → 3P mesh bind |
| K5 | Ground vehicles not drivable (3/49) | Land is 61% of spawn slots | PHY-* ledger + ResponsePhysics |

### P1 — high leverage, small once verified

| Gap | Lead |
|---|---|
| Sniper rifles absent from armoury | Nested in parent `Objects.con`; folder walk misses them |
| Engine / building sounds unreachable | Extraction reach + event plumbing, not bytes |
| `envmap true` dropped (494 materials) | Cubemap already extracted for water |
| Non-Conquest modes never extracted | 1,420 vehicle + 1,736 soldier spawns idle |
| EoD maps schema-stale | Re-run `extract_maps_all.py` |
| Spawn-map dimming (MEME-10) | Settled: open-map alpha 0.8×(1−T/100); default 0.64 |
| Ticket counters not drawn | Parsed in dossiers, missing from scene.json |
| Mod HUD chrome | 16 mods ship own `menu.rfa`; viewer uses vanilla only |

### P2 — Ghidra open ledger that unblocks fidelity

| ID | Question |
|---|---|
| MEME-10 | Settled — see gap-research-meme10-2026-09-17.md |
| MMAP-1/2 unread writers | Who sets zoom toggle +0x3c, +0x48, yaw target +0x68, static bit +0x58 |
| SM-5 | 12-byte POD before `primitive` — moot for extraction if never read |
| LM-3 | Confirm envmap TEXCOORDINDEX reset pairs with lightmap path |
| fogStart ≡ fogLinearStart? | Audit left UNVERIFIED; settle against renderer console registrar |
| PHY-1 residual | Where jump becomes upward velocity (client-predicted) |

## Agent dispatch

| Agent | Mission |
|---|---|
| A — Gap status audit | Diff parity-gaps "still open" against current `tools/bf1942-models` code + one extracted map; produce a live open/closed matrix |
| B — Emitter / EffectBundle | Trace parser coverage vs Game.rfa emitter fields; list missing keys with counts; find client load/draw entry points |
| C — Map playthrough soldiers + modes | How to place a kit soldier at `soldierSpawns`; cost of extracting Tdm/Ctf/SP; sniper roster fix path |
| D — Ghidra MEME-10 + fog aliases | Client: spawn map dim + fog console words; import/open w32ded if useful for physics/effects twins |
| E — Physics export + drive | Which PhysicsNode / Engine / Spring scalars the extractor already parses but drops; ground-vehicle drive blockers |

## Immediate actions (this session, no wait)

1. Write this plan. **Done.**
2. Spawn A–E in parallel. **First wave failed (usage limits, empty transcripts).** Retries with inherit model in flight; status matrix written directly in `gap-research-status-2026-09-17.md`.
3. Fog `fogLinear*` / `setFogColorVec`. **Settled + fixed** — `gap-research-fog-2026-09-17.md`, ledger FOG-1..3.
4. Import `BF1942_w32ded.exe`. **Done.**
5. P1 fixes without waiting. **Fog + `geometry.color` parse/export/viewer tint.**

### Discovery during research (not in original parity-gaps)

- **`fogLinear*` / `setFogColorVec` are dead.** Honouring them as aliases was itself a fidelity bug (Gazala 500/850, Midway colour). Corrected.
- Sniper catalogue path already has `CATALOGUE_KINDS` for nested `HandFireArms` — verify against live `models.json` rather than re-implementing.
- `bf1942_lnxded.static` in Ghidra needs a language upgrade (4.6→4.7) before MCP can open it; use `nm`/`objdump` on the ELF or the newly imported `BF1942_w32ded.exe` until upgraded.
