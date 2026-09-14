# Animation parity gaps: BF1942 vs. the bfstats extractor + viewer

Audit date 2026-09-14, repo at `main` / `0380713`. Ground truth is the installed
vanilla game at `~/.wine/drive_c/EA Games/Battlefield 1942/Mods/bf1942/Archives/`.
Every count below was produced by running the repo's own readers
(`bf42/rfa.py`, `bf42/baf.py`, `bf42/animstates.py`) against those archives, or
by parsing the shipped `.glb` files in `tools/bf1942-models/viewer/`.

**The headline is not "glTF animation is missing".** `bf42/gltf.py` has a
complete keyframe writer (`add_animation`, `gltf.py:368`) and a skin writer
(`add_skin`, `gltf.py:327`), and both are exercised in production: the flags in
every level scene are a real 49-frame skinned `.baf` playback, and 37 aircraft
and ship models carry looping propeller/radar clips. The gaps are about *which*
animation reaches the export, and one of them (Gap 1) is a one-line plumbing
omission that silences every windmill in the game.

---

## Reproduce

```bash
cd /home/dylan/projects/skandia/bfstats/tools/bf1942-models
# archive inventory
python3 -c "
import sys, os, collections; from pathlib import Path
sys.path.insert(0,'.')
from bf42.rfa import RfaArchive
A = Path(os.path.expanduser('~/.wine/drive_c/EA Games/Battlefield 1942/Mods/bf1942/Archives'))
a = RfaArchive(A/'animations.rfa')
print(len(a.entries), collections.Counter(Path(n).suffix.lower() for n in a.entries))"
# state machine
python3 -c "
import sys, os; from pathlib import Path
sys.path.insert(0,'.')
from bf42.rfa import RfaArchive; from bf42 import animstates
a = RfaArchive(Path(os.path.expanduser('~/.wine/drive_c/EA Games/Battlefield 1942/Mods/bf1942/Archives/animations.rfa')))
idx = {n.lower(): n for n in a.entries}
read = lambda p: a.read(idx[p.replace(chr(92),'/').lower()]).decode('latin-1') if p.replace(chr(92),'/').lower() in idx else None
m = animstates.parse(read); print(len(m.states), m.missing)"
# what the shipped glbs actually contain
python3 - <<'EOF'
import json, struct, glob, os
def head(p):
    f=open(p,'rb'); f.read(12); ln,_=struct.unpack('<II', f.read(8)); return json.loads(f.read(ln))
for p in sorted(glob.glob('viewer/maps/*/scene.glb')) + sorted(glob.glob('viewer/models/*.glb')):
    js = head(p)
    a = js.get('animations', [])
    if a or js.get('skins'):
        print(os.path.relpath(p), len(a), [x['name'] for x in a][:4], 'skins', len(js.get('skins',[])))
EOF
```

---

## Gap 1 — `setContinousRotationSpeed` rotators are frozen in every level scene

**Gap.** Windmills, watermills, radar-bunker dishes and ship radars stand
perfectly still in the map flythrough, because `extract_map.py` never flushes
the spin keyframes the assembler has already collected.

**Ground truth.** Vanilla declares exactly nine templates with a non-zero
`ObjectTemplate.setContinousRotationSpeed` (29 occurrences of the directive
total, 19 files; note the engine's own misspelling — there is no
`setRotationSpeed` in the game at all). All four world-object ones are
`RotationalBundle`s under `Objects/Buildings/Common/`:

| archive path (inside `Objects.rfa`) | line | template | speed (Y/P/R deg/s) |
|---|---|---|---|
| `Objects/Buildings/Common/euwindmill_m1/Objects.con` | 28-36 | `euwindmillWings` | `0/-10/0` |
| `Objects/Buildings/Common/euwindmill_m1/Objects.con` | 38-46 | `euwindmillStone` | `12/0/0` |
| `Objects/Buildings/Common/eu_watermill_m1/Objects.con` | 26-34 | `eu_watermillWheel` | `0/0/-15` |
| `Objects/Buildings/Common/Radarbun/Objects.con` | 11-19 | `radarbun_tower_M1` | `15/0/` (sic — truncated triple) |
| `Objects/Vehicles/Sea/Enterprise/Objects.con` | — | `Enterprise_rad` | `10/0/0` |
| `Objects/Vehicles/Sea/fletcher/Objects.con` | — | `Fletcher_Radar` | `30/0/0` |
| `Objects/Vehicles/Sea/Gato/Objects.con` | — | `GatoRadar` | `100/0/0` |
| `Objects/Vehicles/Sea/Hatsuzuki/Objects.con` | — | `HatsuzukiRadar` | `30/0/0` |
| `Objects/Vehicles/Sea/Shokaku/Objects.con` | — | `ShokakuRadar` | `15/0/0` |

The windmill block verbatim:

```
ObjectTemplate.create RotationalBundle euwindmillWings
ObjectTemplate.geometry euwindmill_wings_m1
ObjectTemplate.setHasCollisionPhysics 1
ObjectTemplate.setMinRotation 0/0/0
ObjectTemplate.setMaxRotation 0/0/0
ObjectTemplate.setPivotPosition 0/0/0
ObjectTemplate.setMaxSpeed 0/-110/0
ObjectTemplate.setAcceleration 0/10/0
ObjectTemplate.setContinousRotationSpeed 0/-10/0
```

There is **no `setInputTo*` line on any of these four building templates** — the
rotation cannot be player-driven, so its only possible source is the declared
continuous speed. (That the engine therefore spins them unconditionally at all
times is UNVERIFIED against the binary, but no other data path exists.)

These are placed widely. Counting nodes in the already-extracted
`viewer/maps/*/scene.glb` (script above, matching node names): **38 rotator
instances across 20 of the 23 vanilla maps** —

- `euwindmillWings` x5 (Battle of Britain, Battle of the Bulge, Bocage,
  Liberation of Caen, Market Garden)
- `eu_watermillWheel` x3 (Bulge, Caen, Market Garden)
- `radarbun_tower_M1` x9 (Aberdeen 3, El Alamein 2, Guadalcanal 2, Midway 1, Wake 1)
- `HatsuzukiRadar` x12, `ShokakuRadar` x6, `Enterprise_rad` x2, `Fletcher_Radar` x1

**Current state.** `bf42/assemble.py:1590-1605` already detects
`template.continuous_rotation` and appends a spin spec to `self._spin_tracks`.
`Assembler._flush_spin_animations` (`bf42/assemble.py:1611`) turns those into
looping glTF clips. But it is called from exactly one place —
`Assembler.export` (`bf42/assemble.py:1671`) — and the level exporter does not
use `export()`. `extract_map.py:1186` (`_place_template`) drives
`assembler.build_node` directly against its own `GlbBuilder`, so `_spin_tracks`
fills up and is thrown away.

Verified against the shipped assets: in `viewer/maps/market_garden/scene.glb`
the node `euwindmillWings` carries
`{"templateKind": "RotationalBundle", "geometry": "euwindmill_wings_m1",
"control": "vehicle"}` — no `rig` extra, and no animation channel targets it.
The only clips in any `scene.glb` are `FlagBlow *`.

**Size — S.** Extractor only. Call `_flush_spin_animations(builder)` once in
`extract_map.py` after the object pass, and start the clips in `map.html`
alongside the flag clips at `viewer/map.html:2515-2524` (the mixer is already
over `currentRoot`, so they may simply join the existing `flagMixer` loop).
Care needed on two points: the spin clips must be grouped by period the way
`_flush_spin_animations` already does, and `map.html`'s distance cull
(`viewer/map.html:1817`) hides spawner children — a hidden node still costs
mixer time.

**Impact — high for the size.** A windmill is a silhouette landmark on five
European maps and it is the one object a viewer's eye expects to move. Radar
dishes are on nine more. This is the single most visible animation gap in the
flythrough and it is a plumbing fix, not new format work.

---

## Gap 2 — soldier animation is three frozen stills, not 1,458 states of timeline

**Gap.** The pose pipeline samples one frame from 3 of the game's 85 lower-body
locomotion states and writes them as constant two-keyframe clips; nothing
anywhere plays a `.baf` timeline for a soldier.

**Ground truth.** `animations.rfa` holds **1,334 entries: 1,154 `.baf`, 88
`.skn`, 64 `.ske`, 25 `.con`, 3 `.inc`**. Replaying the state machine with the
repo's own parser yields:

```
TOTAL STATES:                     1458
DISTINCT CLIP PATHS REFERENCED:   1171
STATES WITH A 3P CLIP:            1417
STATES WITH A 1P CLIP:            1074
missing = [('multiShotWeaponsMod.inc', 45), ('singleShotWeaponsMod.inc', 44),
           ('AnimationStatesMod', 1)]     # mod hooks vanilla does not ship
```

Family split: **85 `Lb_` (lower-body) states, 287 `Ub_` families expanding to
1,268 states, 105 other** (`Face*`, `HandSign_*`, `Weapon*`, `*Shake`, `Flag*`,
`Parachute`). The complete `Lb_` vocabulary — one clip each, weapon-independent
— covers every motion the audit brief asked about:

```
Lb_Stand Lb_StandRelax Lb_WalkForward Lb_WalkBackward Lb_RunForward Lb_RunBackward
Lb_StrafeLeft Lb_StrafeRight Lb_TurnLeft Lb_TurnRight Lb_StandJump Lb_RunJump
Lb_RunJumpBackward Lb_StandToCrouch Lb_CrouchToStand Lb_Crouch Lb_CrouchForward
Lb_CrouchBackward Lb_CrouchStrafeLeft Lb_CrouchStrafeRight Lb_CrouchTurnLeft
Lb_CrouchTurnRight Lb_CrouchToLie Lb_StandToLie Lb_RunStandToLie Lb_Lie Lb_LieForward
Lb_LieBackward Lb_LieStrafeLeft Lb_LieStrafeRight Lb_LieTurnLeft Lb_LieTurnRight
Lb_LieToCrouch Lb_LieToStand Lb_StartSwim Lb_EndSwim Lb_SwimForward Lb_SwimBackward
Lb_Floating Lb_ClimbLadder1 Lb_ClimbLadder1B Lb_ClimbLadder2 Lb_ClimbLadder2B
Lb_ClimbLadderEnd1 Lb_ClimbLadderEnd2 Lb_ClimbLadderExit Lb_ClimbLadderIdle1
Lb_ClimbLadderIdle2 Lb_ParachuteOpen Lb_ParachuteIdle Lb_ParachuteFall
Lb_ParachuteHitGround Lb_ParachuteDie Lb_ParachuteDeadHitGround Lb_SitInVehicle
Lb_StandInVehicle Lb_DieInVehicle Lb_PassengerInWilly Lb_PassengerInHanomag
Lb_PassengerInM3a1 Lb_PassengerInKubelWagen Lb_DieBackStand Lb_DieChestStand
Lb_DieBackCrouch Lb_DieChestCrouch Lb_DieHead Lb_DieSlow Lb_DieLie Lb_DieSwim
Lb_DieByVehicle Lb_DieHitGround Lb_HitBackStand Lb_HitChestStand Lb_HitBackCrouch
Lb_HitChestCrouch Lb_ExplosionForward Lb_ExplosionBackward Lb_ExplosionBounceFront
Lb_ExplosionBounceBack Lb_ExplosionLandFront Lb_ExplosionLandBack
Lb_ExplosionLandFrontSurvive Lb_ExplosionLandBackSurvive
Lb_ExplosionLandFrontSurviveStandUp Lb_ExplosionLandBackSurviveStandUp
```

(BF1942 spells prone "Lie" and vehicle entry "GoIn" — greps for `prone`, `enter`,
`driver`, `gunner`, `throw`, `bolt` return zero hits on the `.baf` paths. There
is no dedicated gunner pose: gunners reuse `Lb_SitInVehicle`. `Lb_RunStop` is
`rem`-commented at `animations/AnimationStatesLower.con:107-108`, which is why
the literal `createState` count is 86 and the live count 85.)

**Every one of these is a real multi-frame timeline.** Parsing all 1,154 files
with `bf42/baf.py`: **1,153 parse cleanly, zero of them have `frameCount == 1`**
(the one failure is the known-corrupt `animations/Weapons/MedPack/MedPackFire.baf`,
already documented in `bf42/baf.py`'s docstring). Bone counts cluster at 11
(lower body), 44 (3P upper), 52 (1P arms), 25 (facial), 20 (flag). Representative
frame counts:

| clip | bones | frames |
|---|---|---|
| `animations/StandWalkRun/LowerBody/3PWalkLower.baf` | 11 | 24 |
| `animations/StandWalkRun/LowerBody/3PRunLower.baf` | 11 | 13 |
| `animations/Crouch/LowerBody/3PStand2CrouchLower.baf` | 11 | 5 |
| `animations/3P_NoWeapon/3PClimbLadderLower.baf` | 11 | 12 |
| `animations/3P_NoWeapon/3PParachuteGlideLower.baf` | 11 | 12 |
| `animations/3P_NoWeapon/3PSwimForwardLower.baf` | 11 | 22 |
| `animations/DieHit/LowerBody/3PDieStandChestLower.baf` | 11 | 24 |
| `animations/Vehicle/3PGoInTankHatchLower.baf` | 11 | 16 |
| `animations/WeaponHandling/3P/Thompson/3PReloadThompson.baf` | 44 | 35 |
| `animations/WeaponHandling/1P/Thompson/1PReloadThompson.baf` | 52 | 181 |

Only **50 clips live in a `*/LowerBody/` folder** — the whole locomotion set is
small. The 1,268 `Ub_` states are the same ~30 motions cloned across 28 weapons
by `copyState`/`copyState2`.

**Current state.** `extract_pose.py` hard-codes three stances
(`extract_pose.py:55-59`):

```python
STANCES: tuple[tuple[str, str, str], ...] = (
    ("stand", "Lb_Stand", "StandAim"),
    ("crouch", "Lb_Crouch", "Crouch"),
    ("lie", "Lb_Lie", "Lie"),
)
```

and samples a single frame — `--frame` defaults to `0` (`extract_pose.py:633`),
`pose` builds `locals_map` from `lower.local_pose(frame)` /
`upper.local_pose(frame)` (`extract_pose.py:190-191`). The clips it writes are
deliberately constant (`extract_pose.py:467-475`):

```python
for key, _lower, _upper in STANCES:
    ...
    tracks.append((joint_nodes[name], (0.0, 1.0), [value, value]))
    builder.add_animation(key, tracks)
```

Confirmed in the shipped assets: all **224** `viewer/models/poses/*.pose.glb`
carry exactly 3 clips named `stand` / `crouch` / `lie`, each with **2 keyframes
spanning 0.0-1.0 s with identical values** and 110 channels. `poses.html` treats
them as poses, not motion: `STANCE_KEYS = ['stand','crouch','lie']`
(`viewer/poses.html:301`), each action played at weight 0 and crossfaded by a
hand-rolled weight blend (`viewer/poses.html:460-492`, `322-345`).

The model browser is worse: `viewer/models/USSoldier.glb` has **5 nodes, 0
skins, 0 animations** and `animatedParts: []` in its report — the browse soldier
is rigid at bind pose. `bf42/assemble.py` never emits skinned primitives at all
(the only `Primitive(joints=..., weights=...)` call sites are
`extract_pose.py:296-304` and `extract_map.py:992-1000`); across all 229
`viewer/models/*.glb` the skin count is **0**.

**Size — L.** Format side is already done (`gltf.py:368` proves multi-frame
skinned clips export and load; the flag is the working precedent). The work is:
(a) an extractor mode that bakes N states x M frames per soldier+weapon pair —
the combinatorics are the real cost, since 224 pairs x even 10 states is a lot
of `.glb` weight and needs a shared-skeleton / separate-clip-file layout rather
than one fat file per pair; (b) upper/lower split handling, because the engine
blends an `Lb_` clip with a `Ub_<family><Weapon>` clip and glTF has no layer
mask — either bake the composite per pair or emit both and let three.js
`AnimationMixer` additive blending do it; (c) a viewer state machine in
`poses.html` to sequence them.

**Impact — structural for `poses.html`, currently zero for the flythrough.**
See Gap 3: no soldier geometry is placed in a level scene at all, so none of
this is visible while flying a map today. On the pose page, the difference
between "three stills you can crossfade" and "a soldier who walks, reloads and
dies" is the difference between a reference viewer and something people watch.

---

## Gap 3 — no soldier appears in the map flythrough at all

**Gap.** Soldier spawn points are 2D dots on the minimap; no soldier mesh is
ever instantiated in a level scene, so soldier animation has nothing to animate
there.

**Ground truth.** Levels declare soldier spawns as real placed objects; the
extractor already reads them — `extras.soldierSpawns` is populated and reported
(`viewer/map.html:2540` prints `"N spawns"`).

**Current state.** The only consumer of `extras.soldierSpawns` is the minimap
painter (`viewer/map.html:2356-2366`), which draws a filled circle per spawn.
`map.html` fetches only from `MAPS_BASE` (`viewer/map.html:281`, and every
loader call at 607/711/944/1001/1018/2122/2200/2482) — it never touches
`viewer/models/`, so the eight soldier `.glb`s and 224 pose `.glb`s are
unreachable from the flythrough.

**Size — M.** Viewer-side mostly: fetch a soldier pose `.glb` per team, instance
it at the spawn transforms, and put it under the existing distance cull
(`viewer/map.html:1817`). No extraction work — the assets exist. Becomes L if it
should carry Gap 2's motion.

**Impact — high, and it is the blocker that makes Gap 2 matter.** An empty
battlefield reads as a terrain viewer. Even frozen standing soldiers at spawn
points would change what the scene is; animated ones would change it more. Rank
this *ahead* of Gap 2 — a standing figure is worth more than a walking figure
nobody can see.

---

## Gap 4 — tank track belts never deform; the `.ske`/`.skn` vehicle skin path is unexported

**Gap.** Every tracked vehicle's belt is a rigid mesh frozen at its bind pose.
The extractor reads the skeleton and skin names, records them as glTF extras,
and then exports the geometry unskinned.

**Ground truth.** `Objects.rfa` declares **114 `GeometryTemplate.create
AnimatedMesh`** and exactly **114 `GeometryTemplate.setSkin`** (1:1), against
1,274 plain `StandardMesh`. **All 27 templates whose name contains "track" are
`AnimatedBundle`** — 100%, no exceptions. `createSkeleton` appears 124 times
across 50 files naming 51 distinct `.ske`. The bogie-to-belt link is
`useAsBone` + `setBoneOriginOffset`, **174 occurrences each, always paired, in
14 files**. `animations.rfa` ships **25 track `.ske` rigs** among its 64.

Canonical declaration, `Objects/Vehicles/Land/Sherman/Objects.con:95-100`:

```
ObjectTemplate.create AnimatedBundle ShermanTrackL
ObjectTemplate.geometry Sherman_TrackL_M1
ObjectTemplate.hasMobilePhysics 1
ObjectTemplate.createSkeleton animations/shermanTrackL.ske
ObjectTemplate.setAnimatedTextureSpeed -0.006/0
```

and the bogie that drives it, `Objects/Vehicles/Land/Chi-ha/Objects.con:233-236`:

```
ObjectTemplate.addTemplate Chi-ha_WheelL2Dummy
ObjectTemplate.setPosition -0.162/-0.349/-1.73
ObjectTemplate.useAsBone 0/-0.1/0
ObjectTemplate.setBoneOriginOffset 0/-0.3/0
```

**Current state.** `bf42/assemble.py:1543-1550` records the pair as extras and
reports it:

```python
if template.skeleton:
    extras["skeleton"] = template.skeleton
    report.skinned_parts.append(f"{template.name} -> {template.skeleton}")
if template.geometry:
    geom = self.library.geometry(template.geometry)
    if geom and geom.skin:
        extras["skin"] = geom.skin
        report.skinned_parts.append(f"{template.name} skin {geom.skin}")
```

Across the 229 shipped model reports this fires for **27 track templates on 14
vehicles** (Chi-ha, Hanomag, Ho-Ha, KettenKrad, M10, M3A1, PanzerIV, Priest,
Sexton, Sherman, T34, T34-85, Tiger, Wespe) plus 25 soldier/flag templates —
314 `skinnedParts` lines in total. Nothing consumes any of it. `Sherman.glb`'s
`ShermanTrackL` node carries
`{"skeleton": "animations/shermanTrackL.ske", "skin": "animations/Sherman_TrackL_M1.skn",
"animatedTextureSpeed": [0.006, 0.0], ...}` and the file has **0 skins and 0
primitives with `JOINTS_0`**.

`con.py` also has no parse for `useAsBone` / `setBoneOriginOffset` /
`addSkeletonIK` / `setBoneName` / `setCopyLinksCount` (verified by grep: 0 hits
in `bf42/con.py`, `bf42/assemble.py`, `bf42/level.py`, `extract_pose.py`), so
the wheel-to-bone correspondence that drives the deformation is not even read.

The limitation is already acknowledged in the viewer:
`viewer/index.html:2564-2565` — *"the belt geometry itself is static (that needs
the .ske/.skn skinned path), only the texture crawls over it."*

**Size — M.** Extractor: generalise the `_build_flag_cloth` builder
(`extract_map.py:885-1031`) into `assemble.py` so any `AnimatedBundle` with a `skin` exports a glTF
skin (the `.skn` reader `bf42/skin.py` and the `.ske` reader `bf42/ske.py`
already exist and are proven). Then parse `useAsBone`/`setBoneOriginOffset` to
bind each bogie's `Spring` node to its track bone. Viewer: the existing
suspension rig (`viewer/index.html:3826-3849`) already moves the springs, so a
skinned belt would follow for free.

**Impact — moderate, cosmetic.** The belt failing to ride over a compressing
bogie is a detail you notice on a close static inspection of a Sherman, not
while flying. The scrolling texture (already implemented) carries most of the
"this thing is moving" signal. The reason to do it is that it is the last
structural hole in the vehicle pipeline, and it unlocks nothing else.

---

## Gap 5 — engine-gated playback freezes continuous rotators in the model browser

**Gap.** In `index.html` the baked clips only advance while the engine is
toggled on, so a Fletcher's radar — which has no input binding and a declared
continuous 30 deg/s — sits still until you press **E**.

**Ground truth.** `Objects/Vehicles/Sea/fletcher/Objects.con:254-257`, in full:

```
ObjectTemplate.create RotationalBundle Fletcher_Radar
ObjectTemplate.geometry fletch_radar_m1
ObjectTemplate.setMaxSpeed 10/10/10
ObjectTemplate.setContinousRotationSpeed 30/0/0
```

Four lines, no `setInputTo*` anywhere in the block — the same shape as the
windmill in Gap 1. (Contrast `Fletcher_propeller` immediately below at
`:261-265`, which *is* a bounded rig.) Five ship radars are in this class:
Enterprise, Fletcher, Gato, Hatsuzuki, Shokaku.

**Current state.** `bf42/assemble.py:1590-1605` folds `continuous_rotation`
tracks into the same `_spin_tracks` list as throttle-driven Engine spins, and
`_flush_spin_animations` (`bf42/assemble.py:1611-1642`) groups them by period
into clips named `spin`, `spin.1`, ... The viewer then gates the whole mixer on
the engine: `viewer/index.html:1650` — `if (mixer && engineRunning) mixer.update(dt);`
— and `setEngine(false)` rewinds to time 0 (`viewer/index.html:2673-2686`).
Measured on the shipped assets: **37 of 229 model `.glb`s carry clips, every one
named `spin` or `spin.1`** (per-map variants of 18 distinct vehicles — 13
aircraft: AichiVal, Aichival-T, B17, BF109, Corsair, Ilyushin, Mustang, SBD,
SBD-T, Spitfire, Stuka, Yak9, Zero; and the 5 radar ships: Enterprise, Fletcher,
Gato, Hatsuzuki, Shokaku). A throttle-driven propeller and a continuous radar
land in the same clip namespace and are therefore gated identically.

**Size — S.** Extractor: tag the continuous-rotation tracks with a distinct clip
name (`ambient`, say) in `_flush_spin_animations`, keyed off which branch
appended the track. Viewer: play those unconditionally, keep the `spin*` clips
engine-gated.

**Impact — low but it is a correctness bug, not a missing feature.** A user
inspecting the Fletcher sees a dead radar unless they happen to hit E, and the
engine toggle is a *vehicle* concept being applied to a building-class rotator.
Cheap to fix and it shares all its machinery with Gap 1.

---

## Gap 6 — vehicle seat animation states are not parsed

**Gap.** `seatAnimationLowerBody` / `seatAnimationUpperBody` — how a seat tells
the engine which pose its occupant holds — are unread by the extractor.

**Ground truth.** `Objects.rfa`: `seatAnimationLowerBody` 11 occurrences in 11
files, `seatAnimationUpperBody` 9 in 9 files. The states they name exist:
`Lb_SitInVehicle`, `Lb_StandInVehicle`, `Lb_DieInVehicle`,
`Lb_PassengerInWilly`, `Lb_PassengerInHanomag`, `Lb_PassengerInM3a1`,
`Lb_PassengerInKubelWagen`. `animations/Vehicle/` holds **23 `.baf`** including
`3PWillySitLower.baf` (11 bones, 19 frames — the generic driver pose used for
*every* vehicle and every gunner), `3PGoInTankHatchLower.baf` (16 frames),
`3PSitHanomagPassLower.baf` (2 frames), `3PSitM3A1PassLower.baf`,
`3PSitKubelwagenPassLower.baf` (plus a misspelt duplicate
`3PSitKubelvagenPassLower.baf`), `3PDie01WillyLower.baf`. There is **no
dedicated gunner or turret clip** — zero `.baf` paths contain "gunner" or
"turret".

**Current state.** Zero hits for either directive in `bf42/con.py`,
`bf42/assemble.py`, `bf42/level.py`, `extract_pose.py`. Seats are extracted as
`SeatObject` templates with cameras and rig control, but carry no occupant pose.

**Size — S** on the extractor (two `con.py` cases plus a `Report` field);
**blocked by Gap 3** for any visible benefit.

**Impact — low today, medium once soldiers are placed.** A driverless Willy is
what the flythrough shows now; this is the data that would put a figure in the
seat.

---

## Gap 7 — facial rig read but never exported or animated

**Gap.** Every soldier head declares a face skeleton and face skin; both are
recorded as extras and dropped.

**Ground truth.** `animations/Facial/` holds **28 `.baf`** (25 bones each,
2-61 frames — e.g. `animations/Facial/USFaceTalk.baf`, 25 bones / 31 frames).
`UsFace.ske` is the **most-referenced skeleton in the game — 24 of the 124
`createSkeleton` calls**. `JapFace.ske` is the other. The state machine's
largest single source file is `animations/AnimationStatesFace.con` with 35
`createState` declarations.

**Current state.** `viewer/models/USSoldier.glb` node
`USSoldierComplexHead1` carries
`{"templateKind": "AnimatedBundle", "geometry": "Soldier/USComplexHead1",
"alignedBone": "Bip01 Spine3", "skeleton": "animations/UsFace.ske",
"skin": "animations/US1Face.skn"}` and the file has 0 skins. Same in the 224
pose `.glb`s — the head is one of the four skinned parts but it is skinned to
the *body* skeleton, not to `UsFace.ske`; `extract_pose.py` only ever builds
joints from the body `.ske`.

**Size — S-M**, and it rides entirely on Gap 4's generalised skin export.

**Impact — very low.** Facial detail is invisible at any camera distance the
viewer uses, and the 28 clips are mostly talk/blink loops with no gameplay
correlate. Report it for completeness; do not schedule it.

---

## Gap 8 — sprite-sheet material animation is unimplemented

**Gap.** Explosion, fire and blood sprites cycle through a texture atlas in the
game; nothing in the pipeline reads or plays the frame counters.

**Ground truth.** `Objects.rfa` has **96 lines across 32 distinct
`SpriteParticle` templates** carrying `numAnimationFrames` /
`initAnimationFrame` / `animationSpeed`. Every one of the 96 is on a
`SpriteParticle` — never on a part. Examples:

```
Fx_Expl_Core      numAnimationFrames 16  initAnimationFrame CRD_NONE/8/0/0  animationSpeed CRD_NONE/70/0/0
Fx_BuildingFire   numAnimationFrames 16  initAnimationFrame CRD_NORMAL/1/8/0 animationSpeed CRD_NONE/50/0/0
Fx_blood02        numAnimationFrames 4   initAnimationFrame CRD_NONE/2/0/0  animationSpeed CRD_NONE/20/0/0
Fx_CorsairFire    numAnimationFrames 16  initAnimationFrame CRD_NONE/1/0/0  animationSpeed CRD_NONE/95/100/0
```

Note **no muzzle-flash template is in this set** — a grep for `muzz|flash` over
the 32 names returns nothing. The affected effects are explosions, vehicle
damage fires, building fires and blood.

**Current state.** `numAnimationFrames`, `animationSpeed` and
`initAnimationFrame` appear nowhere in `bf42/*.py`, `extract_*.py`,
`viewer/index.html`, `viewer/map.html` or `viewer/gunfire.js` (grep: 0 hits).
`bf42/assemble.py:677-760` bakes a `SpriteParticle` as a single additively
blended unit quad carrying one static texture.

**Size — M.** Extractor: carry the three values as material extras. Format:
glTF has no sprite-sheet primitive, so the viewer must offset `map.offset` /
`map.repeat` per frame — the same mechanism `advanceScroll`
(`viewer/index.html:2607-2618`) already uses for tracks. Viewer: a per-material
frame clock.

**Impact — very low.** The effects that would use it (explosions, wreck fires)
are not simulated in either viewer today — the baked effect payloads are
explicitly hidden in the flythrough (`viewer/map.html:2505-2510`). Blocked by
having an effects runtime worth animating.

---

## Gap 9 — track texture scroll is not wired into the map flythrough

**Gap.** `animatedTextureSpeed` is honoured in the model browser and ignored in
`map.html`.

**Ground truth.** `ObjectTemplate.setAnimatedTextureSpeed` is the *only*
material-animation directive in the whole game — **27 occurrences in 14 files**,
all on tracked-vehicle `AnimatedBundle`s, all u-axis only (`setAnimatedTexture`
without the `Speed` suffix and `setUVRotation` do not exist; the sole
`useUVRotation` line is `Objects/Effects/e_rocketFumeBack/Effects.con:45`, set to
0). Speeds range `-0.015/0` (PanzerIV) to `+0.01/0` (M3A1, which declares it on
one side only).

**Current state.** `animatedTextureSpeed` appears once in
`viewer/index.html` (`:2577`, inside `collectScrolling`) and **zero times** in
`viewer/map.html` and `viewer/flight.js`.

**Size — S.** Lift `collectScrolling` (`viewer/index.html:2574`) and
`advanceScroll` (`viewer/index.html:2608`) into a shared module.

**Impact — negligible today.** No ground vehicle moves in the flythrough, and
the scroll is throttle-multiplied, so a correct implementation would render
identically to the current one. Worth doing only as part of whatever lands
drivable ground vehicles.

---

## Priority

Sorted by impact per unit of size. "Blocked by" is a hard dependency, not a
preference.

| # | Gap | Size | Impact | Blocked by |
|---|---|---|---|---|
| 1 | `setContinousRotationSpeed` rotators frozen in level scenes (38 instances, 20/23 maps) | **S** | **High** — windmills and radar dishes are landmarks that must move | nothing |
| 5 | Continuous rotators gated behind the engine toggle in the model browser | **S** | Low-med — correctness bug, shares all machinery with #1 | nothing |
| 3 | No soldier geometry anywhere in the flythrough | **M** | **High** — an empty battlefield reads as a terrain viewer | nothing |
| 2 | Soldier animation is 3 frozen stills vs. 1,458 states / 1,154 multi-frame clips | **L** | High on `poses.html`, zero elsewhere until #3 lands | #3 for visibility |
| 4 | Track belts rigid at bind pose; `.ske`/`.skn` vehicle skin path unexported (27 templates, 14 vehicles) | **M** | Moderate, cosmetic — close inspection only | nothing |
| 6 | `seatAnimation*` unparsed; no occupant pose on any seat | **S** | Low now, medium after #3 | #3 |
| 9 | Track texture scroll absent from `map.html` | **S** | Negligible until ground vehicles are drivable | drivable ground vehicles |
| 7 | Facial rig (`UsFace.ske`, 28 clips) read but dropped | **S-M** | Very low — invisible at viewer distances | #4's generalised skin export |
| 8 | Sprite-sheet material animation (32 templates) | **M** | Very low — the effects are not simulated | an effects runtime |

---

## Already covered — checked, not a gap

- **glTF animation capability.** `GlbBuilder.add_animation` (`bf42/gltf.py:368`)
  emits real samplers and channels with rotation + translation paths and does the
  Refractor-to-glTF Z-mirror conjugation itself; `add_skin`
  (`bf42/gltf.py:327`) emits inverse bind matrices. Unit-tested at
  `tests/test_gltf.py:47`. **This is not the bottleneck.**
- **Flag cloth.** Full skinned playback of `animations/Flag/FlagBlow.baf` —
  `_build_flag_cloth` (`extract_map.py:885-1031`) builds the joint hierarchy,
  the skin and a clip over every frame. Measured on
  `viewer/maps/bocage/scene.glb`: 49 keyframes over 1.6 s, 40 channels per flag,
  6 flags. `map.html:2512-2524` plays every clip with a randomised start phase so
  a row of flags does not beat in unison.
- **Propeller / rotor / radar spin baking.** `engine_spin_axes`
  (`bf42/assemble.py:130-157`) plus `_flush_spin_animations`
  (`bf42/assemble.py:1611`) produce period-grouped looping clips; 37 of 229
  models carry them, and `index.html:2639-2686` plays them.
- **Input-driven rig.** `ObjectTemplate.rig()` (`bf42/con.py:363-415`) exports
  per-axis specs (input, min/max, free, rate-vs-position driver, maxSpeed,
  deflection sign) for turret traverse, barrel elevation, steering, control
  surfaces and wheel spin. 112 of 229 models carry `riggedParts`, 838 parts
  total. Consumed by `index.html:3793-3849` and `flight.js:87-110`/`:369`.
  Correctly handles the two traps: absent `setMinRotation` means *unlimited*
  (a clamp there would delete every turret traverse), and `setInputTo*` accepts
  raw enum ids as well as `c_PI*` symbols.
- **Landing gear retraction.** Synthesised as a `GEAR_INPUT`-driven position
  axis with the deployed/retracted bound disambiguated by magnitude
  (`bf42/con.py:419-450`), driven manually on **G** (`index.html:3580-3588`) and
  automatically on altitude thresholds in flight (`flight.js:665-667`).
- **Suspension springs.** `Spring` children of a drivetrain inherit the wheel
  axis (`index.html:3826-3849`).
- **Track texture scroll (model browser).** `collectScrolling` /
  `advanceScroll` (`index.html:2561-2618`), throttle-multiplied, with
  per-node material and texture cloning so shared materials do not all crawl.
- **Weapon recoil, muzzle flash, tracers, projectiles.** `viewer/gunfire.js`
  (see `features/bf1942-3d-models/firing-effects.md`); the recoil path poses the
  gun node from its authored rest (`gunfire.js:287`).
- **Water surface animation.** Two scrolling colour layers plus a normal layer
  driven by a `uTime` uniform (`map.html:1068-1110`, advanced at `:1211`).
- **Soldier skinning itself.** 224 `.pose.glb` files, 4 skins each, verified
  0.0 mm agreement between the GPU skinning and a spec-exact recompute
  (`features/bf1942-3d-models/weapon-grip.md`). The skinning is correct; only
  the *motion* is missing.
- **`.baf` decode.** `bf42/baf.py` reads all 1,153 non-corrupt vanilla clips
  with the correct quaternion convention and the position-only precision scale.
  The reader is not the limitation.
- **Destructible transitions.** Checked and **not worth a gap entry**: vanilla
  BF1942 has no mesh-swap destruction animation. `setDeathObject` does not
  exist; the closest directives are `stayAsDestroyed` (1 occurrence,
  `Objects/MOVE_FILES/window_M1/Objects.con:11`), `timeToLiveAfterDeath` (18)
  and `sinkInToLandAfterDeathSpeed` (28), all on gib templates spawned by the
  effect system. There is no animated door, bridge, crane, elevator or lift in
  vanilla either: the **only** `RotationalBundle`/`AnimatedBundle` templates
  declared under `Objects/Buildings/`, `Objects/StaticObjects/` or
  `Objects/Items/` are the four rotators of Gap 1 and the seven `AnimatedFlag`
  variants in `Objects/Items/Flag/Objects.con`. That list is exhaustive.

## Ground-truth corrections worth carrying forward

Two premises in the audit brief are wrong about the game data, and acting on
them would waste effort:

- **`ObjectTemplate.setAnimationType` does not exist in BF1942** — 0
  occurrences in `Objects.rfa`. Neither does `setRotationSpeed` (the engine
  spells it `setContinousRotationSpeed`, missing the "u"), `setNumberOfWheels`,
  `setWheel*`, `setTrack*`, `setIsTrack`, `setSteer*`, `setSuspension*` or
  `setSpring*`. Springs are a template *type* configured by
  `setStrength`/`setDamping`/`setPositionOffset`.
- **There is no `setInputToThrottle`.** Only three `setInputTo*` variants
  exist — `setInputToPitch` (248), `setInputToYaw` (178), `setInputToRoll` (95).
  Throttle is routed by binding `c_PIThrottle` into the *roll* channel: 54 of
  the 95 `setInputToRoll` lines do exactly that
  (e.g. `Objects/Vehicles/Air/AichiVal-T/Physics.con:176`). `bf42/con.py`
  already handles this correctly.
- Propellers are **not** `RotationalBundle`s — they are a static/blurred
  `SimpleObject` pair swapped by a `LodObject` and gated by
  `setNoPropellerEffectAtSpeed` (33 occurrences). The extractor's
  Engine-spin approach is a deliberate and reasonable divergence, not a bug;
  `flight.js:423` accumulates the angle independently.
