# Mesh viewer fidelity — implementation plan

Round of 2026-09-16. Inputs: research reports R1–R5 + X1 and their verifier
verdicts under [reports/](reports/). **Only verifier-confirmed claims appear as
fact** below; corrected forms replace the original wording; open items are
named as assumptions.

Implementers: one track at a time from [prompts/I-implementer-template.md](prompts/I-implementer-template.md).
Do not edit `features/bf1942-engine-reference/` — proposed ledger rows are for
the lead to merge after this plan lands.

---

## Ordering (user-visible value / risk)

| Priority | Track | Why first |
|---|---|---|
| 1 | **T5 — Scope overlay (D4)** | Four HUD vars; atlas and layout already exist; lowest risk |
| 2 | **T2 — Sniper fire (D2)** | Clear code bugs (loop flag, fire→reload, dim tracer); large visual win |
| 3 | **T4a — Tank HUD ammo + soldier (D3 HUD)** | Confirmed `mannedActive` / `ShowSoldierIcon` gates; no extract |
| 4 | **T1 — Tree collision (D1)** | Parser + re-extract; medium risk, must carve bushes correctly |
| 5 | **T4b — Tank cockpit graft (D3 view)** | Asset exists; diagnosis is viewer graft / `setFirstPerson` |
| 6 | **T3 — Tank drivetrain (D3 drive)** | Highest risk; force-law rewrite; video bars are inference |

Tracks **T5, T2, T1, T3** can run in parallel after seams are named (below).
**T4a** shares `hud.vars` / `feedVehicleHud` with **T5** — serialize those two
writers or land T5 first then T4a. **T4b** is independent of T4a except for
shared `map.html` cockpit entry path.

---

## Track T1 — Tree collision (D1)

### Behaviour to reproduce

A TreeMesh with `CID_SimpleCollisionMesh` **and** `setHasCollisionPhysics 1`
participates in both projectile rays and body/static queries via the same
`IVectorCollider` as StandardMesh (V-R1: projectile path confirmed; body path
reaches the same interface; HCP is bit1/`0x200`, **not** the selector for
`StaticResponsePhysics`). Face `u16` is the SM-6 material word; `defenseMaterial
= material & 0xFF`. Hits spawn wood ricochets (e.g. rifle 218 vs def 165 →
`e_RichoWood`); trees have no hitpoints. Zero-collider / HCP=0 meshes stay
fly-through (bushes).

Exporter rule (V-R1 confirmed): emit hull only when **SCM present AND HCP=1**.
HCP=0+SCM (27 bf1942 templates) must **not** get solids.

### Files to change (order)

1. `tools/bf1942-models/bf42/treemesh.py` — promote `_skip_collision` to a
   parser returning vertices `(x,y,z)`, faces `(i0,i1,i2, material_u16)`; keep
   rejecting class ids other than `0` / `0xEB97C2FA`.
2. `tools/bf1942-models/bf42/assemble.py` — `_collision_for_geometry` /
   `_collision_layer_faces`: stop returning `[]` for `treemesh`; apply HCP∧SCM
   gate using the owning object template.
3. Re-extract maps (Wake first).
4. `viewer/collision.js` — no structural change expected if hulls land as
   existing `extras.collision` / `defenseMaterial` statics (assumption: same
   indexing as SM).

### Extraction

```bash
# from tools/bf1942-models, after parser lands
python extract_map.py --mod bf1942 --map wake
# then any other maps that place TreeMesh palms
```

### Acceptance

Headless Wake (`?mod=bf1942&map=wake&shots`), palm
`Pacific_Palm_large_1_M1` near `[1365.34, 116.129, -771.936]` (X1):

- `__castRay` chest-height into trunk returns palm owner (not farm behind).
- Walk +W 2 s into trunk: `blocked=true` or non-zero contacts (not x through).
- Shot into trunk: hit material wood / effect in `{e_RichoWood, RichoWoodDecal,
  e_richoWood}` on the palm owner.
- A known bush (HCP=0) remains walk-through.

### Tests

- Python: parse real `.tm` SCM blocks from installed mods (version 5, index
  bounds); assert HCP∧SCM gate on a palm vs `Afri_bush1_M1`.
- `tools/bf1942-models/tests/collision_harness.mjs`: static with tree hull
  blocks cast + sweepSphere.

### Must not touch

`gunfire.js` impact tables beyond consuming `defenseMaterial`; HUD; drivetrain.

---

## Track T2 — Sniper fire animation (D2)

### Behaviour to reproduce

Bolt snipers: `Ub_Fire*` is `c_AsmPlayOnce` (1.0 s), then **always**
`addTransitionWhenDone` → `Ub_StandReload*` (1.667 s) → `_POSE_` (V-R2
confirmed). Not a looping fire clip (Thompson is). Projectile geometry is
`invisible 1` — retail draws **no** rifle streak. 1P muzzle: `e_MuzzGun` /
`fx_MuzzGun2` at grip offset; retail flash ~2–3% frame, &lt;1/15 s (evidence;
authored sizes from R2). Shell eject delay 2.0 s on 1P — not the shot flash.

Viewer today: `extract_viewmodel` hardcodes fire `loop=True`; `updateViewmodelAnimation`
holds clamped `fire` while `cool>0`; `gunfire.js` spawns dim `#spawnTracer(..., false)`
for every `aimRay` bullet (X1-13 / V-X1 confirmed).

### Files to change (order)

1. `tools/bf1942-models/extract_viewmodel.py` — fire clip `loop=False` for
   PlayOnce weapons; encode fire→reload chain / `returnTo` from ASM (No4Sniper /
   K98Sniper tables in R2).
2. `tools/bf1942-models/viewer/map.html` `updateViewmodelAnimation` — do not
   clamp last fire frame for the whole `cool`; play fire once then transition
   into the bolt/reload upper-body clip (even when mag not empty), matching ASM.
3. `tools/bf1942-models/viewer/gunfire.js` — for hand-weapon `aimRay` +
   `kind==='bullet'` with no tracer interval: **do not** spawn the dim visual
   tracer (hit tests may still use eye ray).
4. Effects / extract — shrink 1P muzzle flash to retail scale/lifetime (R2
   bundle numbers); do not confuse with shell-eject delay.

### Extraction

```bash
python extract_viewmodel.py   # kits / sniper 1P clips
# re-extract effects if muzzle scale is in the baked EffectBundle
python extract_effects.py     # only if flash size is bake-time
```

### Acceptance

Headless scout No4Sniper (X1 recipe: spawn Airfield, teleport, `__setTrigger`):

- After one shot: clip sequence fire → reload-bolt (or equivalent named clip),
  **not** `fire` held ≥20 frames then idle.
- `__effects()` / frame orange width ≤ ~5% of 800 px WebGL frame; gone within
  one 15 fps sample (~67 ms) preferred, ≤2 frames hard cap.
- No visible floating streak between eye and impact (compare
  `mesh-sniper-shot-15fps.png` vs `game-sniper-shot-15fps.png`).

### Tests

- `soldier_harness.mjs` / viewmodel: PlayOnce fire does not loop; cool does not
  force clamped fire for full RoF window.
- Parser/ASM: No4Sniper fire `return_to` is StandReload (fixtures from R2).

### Must not touch

`CrossHair/*` (T5); tree hulls; tank drive.

---

## Track T3 — Tank drivetrain (D3 drive)

### Behaviour to reproduce

One whole-body thrust at the engine node:
`e = thr − ρ(v·fwd)/fadeSpeed`, `K = 0.1|thr| + e|e|`, `a = fwd * K * ratio`
(V-R3 confirmed). `SpinWheel` is visual-only. EngineGrip builds a target
velocity (default factor → ~2 m/s band), not a second copy of body thrust.
Viewer today applies `driveAccel` **per side** → ~2× body thrust at yaw 0
(V-R3 claim 22 confirmed). Sphere-drag top-speed prediction (~31 m/s) does
**not** match video (~8 m/s band) — do not ship drag-only closure as “done.”

**Assumption (open):** EngineGrip opposition / Coulomb friction is the real
top-speed governor. If wrong, after removing double thrust the tank may still
overshoot retail cruise — document and stop rather than inventing fadeSpeed.

**Not in scope:** treating X1’s ~9.25 m/s as retail truth (V-X1 corrected).

### Files to change (order)

1. `tools/bf1942-models/viewer/ground.js` `TrackedVehicle` / `GroundVehicle` —
   apply body thrust **once** per step (not per driven side); keep gear curve /
   `differentialRPM` (already settled TANK-2/3).
2. Align EngineGrip path with `v_tgt` opposition rather than duplicating `K*ratio`
   as a force on each track.
3. Update `features/bf1942-3d-models/ground-vehicles.md` — remove stale
   “TrackedVehicle not wired into map.html” (V-R3 confirmed stale).

### Extraction

None for the double-thrust fix.

### Acceptance

Wake Sherman at X1 PCO; throttle 3 s straight:

- Initial accel ~4.4 m/s² order (body-thrust formula), **not** ~8.8.
- Cruise in a band compatible with retail capture (~8±4 m/s inferred — treat as
  soft bar; fail only if still ≪3 m/s or ≫20 m/s after double-thrust removal).
- Yaw while moving still turns (undivided throttle + differential RPM).

### Tests

- `ground_harness.mjs`: yaw 0 → single-body accel matches `K*ratio` once;
  both tracks do not double it.

### Must not touch

HUD feed; cockpit meshes; `fadeSpeed` defaults without evidence.

---

## Track T4a — Tank HUD ammo + soldier (D3 HUD)

### Behaviour to reproduce

Sherman root: `NumberOfWeaponIcons 2`, cannon mag **30** + reload bar, coax
mag **400** + heat on `c_PIAltFire` (V-R4 confirmed). Live texts/heat/reload
must come from the **driver’s** FireArms. Viewer: `feedVehicleHud` uses
`nodes = mannedActive() ? … : []` and `mannedActive()` is false on drivetrain
root (X1-19 / V-X1 / V-R4 confirmed). Soldier group stays visible in vehicles
in retail; viewer forces `ShowSoldierIcon = onFootActive` and early-returns
(V-R4 / V-X1 confirmed).

Landscape HUD stretch `x·W/800`, `y·H/600` already matches retail (V-R4 / V-X1).
Portrait letterbox in `_scaleFor` is **wrong vs engine** (always independent
stretch) — fix in this track or a one-line follow-up.

**Leave open:** `IconLookRotation` unit/sign (VHUD-9); do not invent dial angle.
**Assumption:** feeding `ShowTurretIcon=true` without rotation is optional and
may look wrong — prefer leave unfed until angle settled.

### Files to change (order)

1. `map.html` `feedVehicleHud` / `drive()` — when occupying a ground vehicle
   root with FireArms, feed primary/secondary ammo texts, heat, reload from
   those FireStates even if `mannedActive()` is false; **or** redefine
   `mannedActive` carefully so manned-gun seats do not double-step.
2. `map.html` `updateSoldierHud` — keep `Soldier/ShowSoldierIcon` true while
   seated; keep feeding soldier HP / health-bar icons; do not early-return
   before soldier art when `inVehicle`.
3. `hud.js` `_scaleFor` — always independent stretch (remove portrait
   letterbox), matching VHUD-11.
4. Coordinate `CrossHair/*` for vehicle `CHTCrossHair` with **T5** (shared
   owner: single `setHudVar` helper / one feed site).

### Extraction

None.

### Acceptance

Enter Wake Sherman; `__renderOnce` / `__hudVars()`:

- `Ammo/PrimaryAmmoText` ∈ {30…} and `SecondaryAmmoText` ∈ {400…} (or live
  counts matching FireState).
- `Soldier/ShowSoldierIcon === true` with soldier health art present.
- Compare strip to `game-tank-1p-hudstrip.png` / `_hud-scale-compare.png`
  (vehicle HP x near indep prediction, not letterbox x).

### Tests

- Extend any existing HUD feed unit/harness: mock occupancy root + two FireStates
  → texts set while `mannedActive()` false.

### Must not touch

`ground.js` thrust; tree parser; sniper ASM.

---

## Track T4b — Tank cockpit interior (D3 view)

### Behaviour to reproduce

1P frame is mesh `1P_Sherman_Gunner_M1` via `DistCompareSelector` /
`addLodComparison 0.5` (V-R4 confirmed). `--cockpit` asset already on disk
(`Sherman.cockpit.glb`). Eye at `ShermanCamera`; `vehicleFov` 0 → world FOV.
Defect is viewer graft / `setFirstPerson` / swap, not missing extract.

### Files to change

1. `flight.js` / tank first-person path — ensure cockpit mode runs
   `CockpitSwap` for `lodShermanCockpit` (interior on, exterior shroud off).
2. No change to `extract_models.py` unless graft proves a naming mismatch.

### Extraction

Only if graft fix proves the glb is stale:

```bash
python extract_models.py Sherman --cockpit
```

### Acceptance

Driver 1P screenshot / `__renderOnce`: riveted interior frame visible (compare
`game-tank-1p.png`); not open hull with only a black CSS wedge.

### Must not touch

HUD vars (T4a); drivetrain.

---

## Track T5 — Sniper scope overlay (D4)

### Behaviour to reproduce

`FireArms::setZoom` writes `CrossHair/ScopeIndex` 0/1 when `useScope`; weapon
sync copies `ScopeIcon` / `SniperSight` / `SightIcon` (V-R5 confirmed). Layout
+ `sniper.png` already extracted. Viewer writes **zero** `CrossHair/*` (V-R5 /
V-X1 / hud.js:505).

### Files to change

1. `map.html` soldier / zoom feed — on zoom with scoped weapon: set
   `CrossHair/ShowCrossHair`, `ScopeIndex` (1 when scoped), `ScopeIcon` → atlas
   key (`sniper.tga` → `sniper`), `SniperSight` / `SightIcon` from weapon data;
   clear ScopeIndex on unzoom / vehicle entry.
2. Resolve icon string → atlas basename the same way other HUD pictures do.
3. Do not invent PictureNode letterbox unless 16:9 aperture looks oval after
   stretch (V-R5 open).

### Extraction

None for vanilla sniper. Mods with other scope TGAs may need atlas pack later.

### Acceptance

Zoom No4Sniper; `__hudVars()` has `CrossHair/ScopeIndex === 1` and ScopeIcon
bound; canvas shows black frame + scope circle (compare `game-sniper-zoom.png`).
Unzoom clears overlay. Zoom factor curve may stay as today (already ≈ retail).

### Tests

- HUD vars: zoom toggles ScopeIndex; missing ScopeIcon culls picture (negative).

### Must not touch

Fire clip chain (T2) except shared zoom bit; tank drive.

---

## Seams (one owner each)

| Shared surface | Owner track | Rule |
|---|---|---|
| `gameHud.vars` / `setHudVar` | **T5** for all `CrossHair/*`; **T4a** for Vehicle/Ammo/Soldier vehicle feed | No second ad-hoc object; one table |
| `feedVehicleHud` / `mannedActive` | **T4a** | T5 must not redefine mannedActive |
| `updateViewmodelAnimation` / fire clips | **T2** | — |
| `gunfire.js` tracers / aimRay visuals | **T2** | Hit tests may keep eye ray |
| Static collision grid / `extras.collision` | **T1** | — |
| `TrackedVehicle.#step` / `driveAccel` | **T3** | — |
| Cockpit swap / `setFirstPerson` | **T4b** | — |
| Effects registry / muzzle bundles | **T2** | — |

---

## Integration pass

After tracks land, one agent (or the lead) walks Wake headless + interactive:

1. Spawn scout → walk into palm → shoot palm (wood hit).
2. Scope in → confirm overlay → fire once → bolt cycle → no floating round /
   huge flash.
3. Enter Sherman → see cockpit frame → confirm `30`/`400` + soldier strip →
   drive 3 s → fire cannon + coax.

Budget: ~half day. Owner: whoever merges the last track; file notes under
`features/mesh-viewer-fidelity-defects/reports/integration.md`.

---

## Needs a decision (not a planner call)

1. **Two-state 1P FOV** — default near-pass ~26.9° (`set1pFov 0.47`) vs world
   57.3°; `?fov1p=world` equalizes (X1). Changes every hip capture. Leave as
   viewer flag until product call; do not couple into T2/T5.
2. **Portrait HUD** — engine always independent-stretches; fixing `_scaleFor`
   changes mobile layout. Accept as intentional parity (recommended) or keep
   letterbox as a known divergence.
3. **IconLookRotation** — ship dial without angle (likely wrong) vs leave off
   (recommended until VHUD-9 closes).

---

## Explicitly not fixing this round

- Full Coulomb / materialFriction coupling into EngineGrip (API exists; call
  graph open; V-R3 corrected “no materialFriction strings”).
- Turret dial angle (VHUD-9).
- CrossHair default RGB ints (capture is red; defaults open).
- HCP=0+SCM bush body-block parity with retail (exporter Open; exporter skips).
- Pixel-perfect hip pose vs doorway PNGs without near-pass camera projection.

---

## Proposed corpus rows (lead merges)

| id | finding | status | evidence |
|---|---|---|---|
| TM-2 | TreeMesh SCM participates in ray + body queries via IVectorCollider; export iff SCM∧HCP=1 | verified | V-R1 |
| TM-3 | Tree face u16 = SM-6 material; wood ricochet table 218→165 | verified | V-R1 |
| ASM-FIRE-1 | Bolt sniper fire PlayOnce → StandReload → _POSE_; not looping | verified | V-R2 |
| GUN-VIS-1 | Invisible rifle projectiles; no dim aimRay tracer in retail | verified | V-R2 |
| TANK-7 | Body thrust once at engine; viewer per-side driveAccel doubles it | verified | V-R3 |
| TANK-8 | SpinWheel visual-only; EngineGrip v_tgt path | verified | V-R3 |
| VHUD-10 | Driver FireArms feed Primary/Secondary ammo texts (30/400 Sherman) | verified | V-R4 |
| VHUD-11 | HUD map independent stretch W/800 H/600; no letterbox | verified | V-R4 |
| VHUD-12 | Soldier HUD remains visible in vehicles | verified | V-R4 |
| TANK-VIEW-1 | Tank 1P = cockpit mesh via DistCompareSelector 0.5; --cockpit sufficient | verified | V-R4 |
| SCOPE-1 | setZoom writes ScopeIndex; defect = missing CrossHair/* feed | verified | V-R5 |
| DOC-GV-1 | ground-vehicles.md “TrackedVehicle not wired” is stale | verified | V-R3 |

---

## Documentation to update (per track)

| Track | Docs |
|---|---|
| T1 | `features/bf1942-3d-models/projectile-collision.md`, `parity-gaps.md` |
| T2 | `first-person-soldier.md`, `firing-effects.md` |
| T3 | `ground-vehicles.md` (remove stale wiring claim) |
| T4a/T4b | `in-game-hud.md`, `seats-and-manned-guns.md`, `ground-vehicles.md` |
| T5 | `in-game-hud.md`, `first-person-soldier.md` |

---

## Parallelism summary

```
T5 ─────────────────────────────┐
T2 ─────────────────────────────┼── integration
T1 ─────────────────────────────┤
T3 ─────────────────────────────┤
T4a (after T5 CrossHair seam) ──┤
T4b ────────────────────────────┘
```
