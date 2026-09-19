# BF1942 corpus consumption — outstanding items & work streams

Date: 2026-09-18. Scope: `features/bf1942-engine-reference/`, `features/bf1942-3d-models/`, `tools/bf1942-models/`.

## What was consumed

| File | Lines | Key finding |
|---|---|---|
| `engine-reference/ledger.md` | 619 | 804 symbols across 25 subsystems; ~15 rows still `open` |
| `engine-reference/README.md` | 317 | Game loop settled (30 Hz); physics subsystem is the worked example |
| `bf1942-3d-models/parity-gaps.md` | 252 | 117 gaps across 7 axes; 3 structural absences identified |
| `bf1942-3d-models/gap-research-2026-09-17.md` | 94 | P0/P1/P2 triage + agent dispatch notes (A–E) |
| `bf1942-3d-models/gap-research-status-2026-09-17.md` | 54 | Live open/closed matrix for 16 ranked gaps |
| `parity-audit/{animation,projectiles-collision,vehicle-physics,effects-materials,audio,level-content,infantry-gameplay}.md` | 7,181 | 7 audit reports = 117 individual gaps |
| `bf1942-3d-models/parity-gaps.md` | 252 | Corrections to existing docs; ranked list; 20 UNVERIFIED markers |
| `subsystems/{physics,handweapon-view-and-deviation,ingame-hud,supply-depots,manned-guns,tank-driving,hitpoints-and-damage,seats-and-entry,standardmesh-vertex-format}.md` | — | Narrative write-ups per subsystem |

## The three structural absences (confirmed across audits)

1. **102 of 216 EffectBundles produce zero geometry** — every smoke, fire, dust, debris, damage effect. The emitter data model is 80% unparsed (`intensity`, spread cones, flipbooks, drag).
2. **No soldier geometry in any level** — `soldierSpawns` renders as 2D minimap dots only.
3. **Nothing beyond a round collides** — projectiles stop at terrain/sea/hull (closed), but tanks, jeeps, debris, and infantry do not.

## Live open items by stream

### Engine RE — binary verification (needs Ghidra / `xref.py`)

| ID | Question | Blocker |
|---|---|---|
| **SM-5** | 12-byte POD before `primitive` in `.sm` — is it ever read? | `stdmesh.py` assumes it's reserved |
| **bit 29** | Meaning of bit 29 in vertex-format `flags` | `standardmesh-vertex-format.md` §"still open" |
| **PHY-1** | Where jump becomes upward velocity (client) | Reader has the gate; not the impulse |
| **PHY-2** | Force magnitudes behind the power slide | Structure confirmed, numbers unread |
| **PHH-9** | Exact within-radius explosion falloff shape | Cutoff/multiply/dispatch confirmed, falloff open |
| **SEAT-11** | Seat-switch `force` value at call site | Pattern confirmed, one call unread |
| **VHUD-9** | What sets `ShowTurretIcon`; `IconLookRotation` unit/sign | Dial sprites settled, trigger angle unsettled |
| **VHUD-10** | Driver's own weapons feeding ammo panel live values | Static half confirmed, live path unread |
| **GUN-2** | Exact turret-integrator closed-form (not accel·dt/clamp) | Structure settled, formula open |
| **TANK-4** | Gear-ratio curve values (not just index formula) | Index closed, curve contents unread |
| **HP-13** | Client HUD meaning of Armor::status messages (0x14/0x13/0x15) | Fire conditions confirmed, client effect unread |
| **LM-3** | Confirm envmap TEXCOORDINDEX reset pairs with lightmap path | Inferred, not closed |

### Parity gaps — extraction pipeline (`tools/bf1942-models/`)

| # | Gap | Size | Impact | Notes |
|---|---|---|---|---|
| **1** | `Object.geometry.scale` / `.color` dropped — `_COMMAND` regex can't match 3-segment commands | M | **Very high** — every forest is identical clones | 8,596 scale + 5,123 color lines; 47% of 18,258 placements |
| **12** | Terrain default-patch fill only works on 3 levels shipping `terrainDefault.dds` | S | **Medium** — 84 dry patches render as void | Fall back to `detail.dds` or nearest tile avg |
| **13** | Re-extract EoD's 239 maps onto current schema | S | **High** — flags/spawns/minimap missing on all | `extract_maps_all.py --mod eod --skip-existing` ready to run |
| **14** | Game rules: tickets, kits, team skins, briefing (0% parse on 3 files) | S | Low-medium | Needs `menu.rfa` localisation table for briefing strings |
| **17** | Water/wave directives beyond parsed set (`Water.baseTex`, `envmapcolor`, typo) | S | Low | 6 directives ignored |
| **6** | `spawnPointManagerSettings.con` (495 blocks, 23 levels) | S | Medium | 0% parsed |
| **9** | `Materialmap.raw` never read | M | Low-medium | Has visual role UNVERIFIED |
| **10** | Terrain LOD directives ignored | M | Low-medium | Payload issue |
| **11** | No per-object draw distance or LOD chain | M | Medium (perf) | 6 LOD levels read and discarded |
| **15** | No 3D combat-area boundary | S | Low | Data already in `scene.json` |
| **16** | Destroyed-state / ladder flags | S | Low in vanilla | UNVERIFIED for FH/FHSW |

### Parity gaps — viewer runtime (`viewer/`)

| Gap | Size | Impact | Notes |
|---|---|---|---|
| **Soldiers in flythrough** | M | **Highest visual** | `soldierSpawns` + `groundHeight()` exist; no kit soldier placed |
| **Kit soldier grafting** | M | **Highest** | 43 live kit geometries; blocked on GAP 1.2 + 1.4 |
| **Animation clips** | M | High | 1,154 `.baf` clips; only frame 0 sampled |
| **Hand weapons in `poses.html`** | M | Medium | No muzzle nodes, no `GunFire` import |
| **Scope overlay + scoped view** | S | Medium | Depends on weapon stat block |
| **Ground vehicles drivable** | — | High | `GroundVehicle` class exists; PHY-\* ledger needed |
| **Sniper rifles in catalogue** | S | High | Nested in parent `Objects.con`; folder walk misses |
| **Static building ambience** | S | Medium | `loadSoundScript` on 93 placements not harvested |
| **envmap materials** | S | High | 494 glass materials; cubemap already extracted |
| **Non-Conquest modes** | L | Medium-high | 1,420 vehicle + 1,736 soldier spawns unread |
| **Mod HUD chrome** | S | Medium | 16 mods ship own `menu.rfa`; viewer uses vanilla |
| **Ticket counters into `scene.json`** | S | Low-medium | Parsed by dossiers, not emitted |
| **Combat-area boundary in 3D** | S | Low | Already in data, unused by 3D |
| **Foliage billboard falloff** | M | Medium (perf) | Blocked on scale/color (Gap 1) |
| **Lens flare / sun corona** | S | Low | 8 `setFlare*` + 8 `setCorona*` verbs, 21 levels, all ignored |
| **Lens flare textures** | — | — | "Full write-up" — see below |

### Sound / audio

| Gap | Size | Impact | Notes |
|---|---|---|---|
| **643 WAV files not extracted** | S | Low | 7.59 MB MP3 delta on 14 GB tree |
| **4,280 sound script entries** | S | Low | 919 changed after `/* */` comment fix; map ambience unaffected |
| **Building engine/ambience sounds** | S | Medium | Level `Sounds/*.con` only; object `loadSoundScript` not harvested |
| **Stereo flag** | — | — | CLOSED (HRTF panner confirmed) |

### Interface (spawn screen, HUD, menus)

| Gap | Notes |
|---|---|
| Spawn-map dimming | **CLOSED** (MEME-10: alpha = 0.8 × (1−T/100) = 0.64 at default T=20) |
| Ticket counters | Parsed by dossiers, not in `scene.json` |
| Mod HUD chrome | 16 mods ship own `menu.rfa`; viewer uses vanilla only |
| In-game HUD beyond minimap | `menu/InGame` declares ~50 HUD groups; none reach viewer |

## Stale documentation (needs doc fix)

`parity-gaps.md` "still open" rows are STALE for:
- Collision off (now on by default)
- Fog aliases (now CLOSED — dead spellings correctly ignored)
- Sniper rifles (now CLOSED — `CATALOGUE_KINDS` handles nested `HandFireArms`)
- EoD schema (now CLOSED — all 239 maps re-extracted with full schema)
- EffectBundles selected but not played (now CLOSED for selection; **play is still OPEN**)
- Spawn-soldier decoration (PARTIAL — decoration ships, no AI/idle anim)
- Stereo audio (CLOSED)
- Fog `setFogColorVec` (CLOSED — confirmed dead spelling)

## Proposed work streams for parallel agents

| Stream | Focus | Open items from this report | Binary RE needed? |
|---|---|---|---|
| **S1 — Extraction fidelity** | `con.py` regex fix for scale/color, fog spellings, level-local meshes, spawn timers | Gap 1, Fog spellings, Gap 2, Gap 6 | No |
| **S2 — EffectBundles / particle runtime** | Parse `intensity`, cones, flipbooks; bake 102 missing EffectBundles into glb; wire play path | Gap "EffectBundles selected but not played", SPR-6 (wrap/clamp), EMT-* | Yes (client) |
| **S3 — Soldiers in flythrough** | Place kit soldier at spawn pads; graft 43 kit geometries; first animation clip | Gap "No soldier anywhere", kit grafting, animation frame 0 | No |
| **S4 — Hand weapons + scope overlay** | Muzzle nodes, `GunFire` import, scope art, weapon stat block | Sniper catalogue, muzzle nodes, scope overlay | No |
| **S5 — Non-Conquest modes + mod HUD** | Extract Tdm/Ctf/SP layouts; detect mod `menu.rfa` | Non-Conquest modes, mod HUD chrome | No |
| **S6 — Building ambience + envmap** | Harvest `loadSoundScript`; parse `envmap true` in `rs.py`; bind cubemap | Building sounds (G9), `envmap` materials | No |
| **S7 — Binary verification pass** | Resolve the 12 open ledger rows above | SM-5, bit 29, PHY-1/2, PHH-9, SEAT-11, VHUD-9/10, GUN-2, TANK-4, HP-13, LM-3 | Yes (Ghidra/xref.py) |

## Immediate P0 recommendation

Per `gap-research-2026-09-17.md` P0 list + the status matrix, the highest-leverage items that need no binary RE:

1. **Gap 1**: `_COMMAND` regex fix (47% of placed statics affected) — S, very high impact
2. **Gap 13**: Re-run EoD extraction (239 maps, `--skip-existing` ready) — S, high
3. **Soldiers in flythrough** — M, highest visual miss
4. **Building ambience** — S, medium, 93 silent objects
5. **envmap materials** — S, high, 494 glass materials
