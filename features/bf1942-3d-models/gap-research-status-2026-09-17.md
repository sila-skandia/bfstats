# Gap research status — live open/closed/partial matrix

Date: 2026-09-17. Verify-only audit against current `tools/bf1942-models`
code and extracted viewer trees. Sources: `parity-gaps.md`,
`gap-research-2026-09-17.md`, `gap-research-fog-2026-09-17.md`.

Statuses mean end-to-end for the original gap claim (parse → artefact →
viewer), not "a comment exists somewhere".

| # | Gap | Status | Evidence |
|---|---|---|---|
| 1 | `Object.geometry.scale` / `.color` | **CLOSED** (color needs map re-extract) | **scale:** dotted cmd + stamp + kursk glb 1331 scaled nodes. **color:** landed same session after this audit draft — parse `level.py` `geometry.color`, `StaticInstance.color`, node `extras.color` in `extract_map.py`, viewer `applyInstanceColors` in `map.html`. Test `test_geometry_color_survives_its_second_dot`. Existing glbs lack the extras until re-extract. |
| 2 | Level-local `StandardMesh/` via `add_level_meshes` | **CLOSED** | `bf42/rfa.py:207-240` fills mesh-pool gaps from `Levels/<Map>/StandardMesh/`. Called from `extract_map.py:1760-1764`. Live check: Wake `scene.json` `objects.missingMeshes` is `[]`. |
| 3 | Fog spellings (`fogLinear*` / `setFogColorVec`) | **CLOSED** | Parent settled: those words are **dead** (absent from client/w32ded). Parser accepts only live `fogStart` / `fogEnd` / `fogColorVec` — `bf42/level.py:918-934`. Dead spellings ignored by design; tests `test_dead_fog_spellings_are_ignored`, `test_live_fogstart_beats_dead_foglinear` (`tests/test_level.py:284+`). Doc: `gap-research-fog-2026-09-17.md`. Honouring dead aliases would itself be a fidelity bug. |
| 4 | Map collision default on | **CLOSED** | `--no-collision` opts out (`extract_map.py:1683-1688`); default `include_collision=not args.no_collision` (`extract_map.py:1784-1788`). Wake ships `objects.collision` with 93 parts / 6301 tris / many `defenseMaterial` ids. |
| 5 | Impact EffectBundles selected but not played | **CLOSED** | Selection: `viewer/collision.js` `impactEffect` + `guns.damageEffects` (`map.html:4009`). Play: `GunFire` holds `EffectPlayer` (`gunfire.js:253-258`, `944-950`); map wires library from `_shared/effects.glb` (`map.html:3767-3790`). Artefact present (~1.6 MB). Narrative: `impact-effects.md`. `parity-gaps.md` "still open" row is **stale**. |
| 6 | Emitter intensity / cones / flipbooks parsing | **CLOSED** | Spec builder `bf42/effects.py`: `intensity` `_EMITTER_CRD:37`, flipbook words `73-76` / particle path; launch axes via `relativePosition*` / `positionalSpeed*` (`34-47`) — the authored "cone". Runtime: `viewer/effects-core.js` intensity clock (~170-205) and `numAnimationFrames` flipbook (~296-387). Tests in `tests/test_effects.py`. |
| 7 | Physics scalars exported to glb | **CLOSED** | `Assembler` writes `extras["physics"]` (`bf42/assemble.py:2241-2251`); `con.py` parses mass/drag/torque/gearbox/buoyancy into `physics()`. Viewer reads `extras.physics` (`viewer/ground.js:15`, `:175-178`, `:1120`). Original "never reach the glb" claim is false. Residual free constants in drive models are a separate fidelity backlog (`ground-vehicles.md`), not an export gap. |
| 8 | Soldiers in map flythrough | **CLOSED** | Kit soldiers and bots are placed in levels: `viewer/spawning.js`, `soldier-body.js`, `bot.js` et al. (corpus sweep, "Soldiers in flythrough" / "Kit soldier grafting" rows). |
| 9 | Ground vehicles drivable | **CLOSED** | `GroundVehicle` + `TrackedVehicle` (`viewer/ground.js`); map imports and `ensureDrive` picks class (`map.html:612`, `:4154-4167`, `drive()` ~4290). Wake/Bocage/Kursk ship land templates with engine layers (Willy, Sherman, Tiger, …). Original "3 of 49, all fighters" claim is obsolete. |
| 10 | Sniper rifles in catalogue | **CLOSED** | `CATALOGUE_KINDS` admits nested `HandFireArms` (`extract_models.py:60-70`, `:364-381`). Live: `models.json` lists `K98Sniper` and `No4Sniper`; both `.glb` files present under `viewer/models/`. Tests `tests/test_extract.py:91-104`. |
| 11 | Engine / building sounds | **PARTIAL** | **Engines largely CLOSED:** `extract_vehicle_sounds` (`extract_map.py:611-679`); Wake 8/9 vehicles with layers (land+air+sea). **Buildings still OPEN:** area sounds only from level `Sounds/*.con` matched to placements (`bf42/level.py:1556-1588`). ObjectTemplate `loadSoundScript` on windmill/factory/guardtower/etc. (parity G9, 93 placements) is not harvested into `sounds.areas`. |
| 12 | `envmap` materials | **CLOSED** | `bf42/rs.py` parses `envmap` into a material bool; `viewer/model-envmap.js` `bindEnvmap()` samples the level cubemap on flagged materials (corpus sweep "envmap materials" row). |
| 13 | Non-Conquest modes | **CLOSED** | All `GAMEPLAY_MODES` extracted per mode into `scene.json` and selectable with `?mode=` (`viewer/game-modes.js`) (corpus sweep "Non-Conquest modes" row). |
| 14 | EoD map schema | **CLOSED** | All **239** `viewer/maps/mods/eod/*/scene.json` carry `controlPoints`, `soldierSpawns`, `minimap`, `gameplayMode` (spot-check `the_storm`; full tree sweep 239/239). Original "schema-stale" claim is obsolete for the published tree. |
| 15 | Spawn-map dimming / tickets / mod HUD | **PARTIAL** | **Dimming CLOSED (MEME-10):** open-map α = `(+0x4c)×0.8×(+0x54)` with `+0x54 = 1−T/100`; default T=20 → **0.64**. Viewer `SPAWN_MAP_ALPHA` patched; ledger MEME-10 confirmed. See `gap-research-meme10-2026-09-17.md`. **Tickets OPEN** / **Mod HUD OPEN** unchanged. |
| 16 | `stereo` audio flag | **CLOSED** | `EngineAudio` connects `layer.stereo` voices straight to the bus (no HRTF panner); `engine-audio.js` constructor + `#placePanner` guard. |

## Emitter note (from [Emitter coverage](586b4d3e-c619-44a7-a5e0-b7a84f68cd40))

Parity “intensity unparsed / 80% missing” is stale. Empty-bundle count is the
vehicle BMOne bake filter (~101/215), not missing rate fields. Impact path via
`effects.glb` only leaves ~23 empty. Extra props mapped this pass:
`hasOverDamage`, `intensityOverTime`, `isSpawnEffect`, EffectBundle
`addWorkOnMaterial`. Details: `gap-research-emitters-2026-09-17.md`.

## Stale documentation

- `parity-gaps.md` "Corroborated" / "High impact" rows for collision-off,
  fogLinear aliases, snipers, EoD schema, and "EffectBundles selected but not
  played" lag the tree. Prefer this matrix + the fog research note.
- Fog: do **not** re-open as "missed live spellings" — dead words must stay ignored.

## Top remaining priorities

1. **Static building ambience (G9)** — follow `loadSoundScript` on placed sounding buildings into `sounds.areas`.
2. **`envmap true` materials** — parse in `rs.py` and bind the already-exported cubemap to glass.
3. **Tickets into `scene.json` + spawn HUD draw**.
4. **Non-Conquest mode extraction**.
5. **Mod HUD chrome** along `game.addModPath`.
6. **Soldier spawn polish** — idle clips, kit variety, hide pad under local player.
7. **Vehicle muzzle bake** — optionally widen BMOne-only emitter filter so parked gun smoke/debris ride the vehicle glb (impact path already uses full `effects.glb`).

Closed this session: geometry.color, stereo audio, spawn-soldier decoration (partial), **MEME-10 spawn dim (0.64)**, emitter leftover props + `addWorkOnMaterial`.
