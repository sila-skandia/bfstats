# Vehicle occupants: who is drawn in a seat, and where their hands go

Goal: game-parity seated soldiers — a driver with his hands on the wheel, a
gunner's torso out of the hatch, nobody at all where the game draws nobody, and
the C-key view cycle hiding the body in first person.

Done as of 2026-09-19 (stream C). Steps 1 and 2 of the original plan — parsing
`addSkeletonIK` and exporting it — were already merged; steps 3 to 6 are this
round's, and the engine questions the plan left open are answered below with
addresses.

## What the engine does

Every claim here is from the unstripped Linux dedicated server,
`~/Downloads/bf1942_lnxded-1.61-patched/bf1942/bf1942_lnxded.static`, and
reproduces with `objdump -d -M intel --start-address=...`.

### Whether a seat draws an occupant at all

**A seat draws an occupant if and only if its `PlayerControlObject` subtree
reaches a `SeatObject`.** No vehicle names are involved anywhere:

- `Sherman`'s own PCO declares two `ShermanEntry` EntryPoints, a Camera and the
  turret bundles, and **no SeatObject** — so the driving position draws nobody.
- `shermanBrowning_PCO1` reaches `ShermanBrowningSeat`, so the hull gunner does.
- `Willy`'s root reaches `WillySeat`, so its driver does.

`ObjectTemplate.seatFlags` then says how much of him. The five values are the
jump table `operator<<(ostream&, ISeatObjectTemplate::SeatFlags)`
(`0x083207f0`) indexes at `0x086e1e3c`:

| flag | bit |
|---|---|
| `c_SeatShowHalfBodySoldier` | 1 |
| `c_SeatShowFullBodySoldier` | 2 |
| `c_SeatShowHeadOfSoldier` | 4 |
| `c_SeatIsOutside` | 8 |
| `c_SeatShowStandingSoldier` | 16 |

Vanilla declares 64 SeatObjects and never uses `c_SeatShowHeadOfSoldier`. Two
(`Elco80SideGunnerSeat`, `Type38SideGunnerSeat`) declare
`c_SeatHalfBodySoldier` — missing the "Show" — which is not in the table and
therefore contributes nothing.

That the jump table only *prints* five values is by itself weak evidence that
there are only five, so it was checked the other way: of the fifteen distinct
`seatFlags` spellings that appear across all 16 mods, only those five occur as
strings anywhere in the binary at all. The other ten —
`c_SeatShowCrouchingSoldier` (11 uses), `c_SeatIsOutSide`, `c_SeatisOutiside`,
`c_SeatShowSittingSoldier`, `c_SeatHalfBodySoldier`, `c_SeatForceSittingSoldier`,
`c_ShowHalfBodySoldier` and three case variants — are unknown to the engine.
One GCMOD seat (`snowspeederCoPilotSeat`) has no recognised flag at all. Those
seats are still drawn, because drawing is gated on reaching a `SeatObject`,
not on a flag; they just get the full body.

`dice::ref2::world::hasSeatObject(IPlayerControlObject*)` at `0x0831dc00` is
the engine's own name for the predicate — `internalFindFirstChildOfCID` over
the PCO's subtree, then `queryInterface(IID_ISeatObject)` — but it has **no
caller in lnxded**, which is what you would expect of a drawing concern on a
dedicated server. The rule is therefore confirmed as a predicate the engine
carries and as consistent with every vanilla vehicle, and **its call site is
unread**: closing that needs the client.

### Which pose a seat plays

`BFSoldier::setUseSeat(SeatFlags, const string& lower, const string& upper)`
(`0x08271950`), in full:

```
skeleton->resetDisableBoneTree()
upper := seat's seatAnimationUpperBody, else template->Ub_SitInVehicle   (+0x298)
if (flags & c_SeatShowHalfBodySoldier)                                   (0x8271b63)
    skeleton->disableBoneTree(boneIndex("Bip01 Pelvis"))
lower := seat's seatAnimationLowerBody,
         else template->Lb_StandInVehicle if c_SeatShowStandingSoldier    (+0x29c)
         else template->Lb_SitInVehicle                                   (+0x294)
```

The three defaults are resolved by name in `BFSoldierTemplate::init` at
`0x0827acaf`, `0x0827acff` and `0x0827ad4f`. **Nothing falls back to
`Lb_Stand`** — the earlier SEAT-9 reading of that was wrong.

So every driver's seat in the game (`WillySeat`, `KubelwagenSeat`,
`ShermanBrowningSeat`, 50-odd more) declares `seatFlags` and no animation at
all, and plays `Ub_SitInVehicle` + `Lb_SitInVehicle`. The extractor exported
poses only for seats that *declared* an animation, which is why a driver never
had a glb to load.

`c_SeatShowHalfBodySoldier` hides the legs rather than swapping a half model:
the viewer scales `Bip01 Pelvis` to nothing, which is the closest a skinned
mesh gets to `disableBoneTree` (hiding a joint does nothing — the mesh draws
the vertices, not the bone).

### `addSkeletonIK`: the two triples

`AnimatedBundleTemplate::addSkeletonIK(const string&, const Vec3&, const Vec3&)`
(`0x08266cb0`) builds an 88-byte `SkeletonIkInfo`:

| offset | field |
|---|---|
| `+0x00` | `short` bone-name id (`BoneManager::getBoneNameIndex`) |
| `+0x04` | `int` target child index |
| `+0x08` | `int` cached bone index, -1 unresolved, -2 lookup failed |
| `+0x0c` | `Vec3` position |
| `+0x18` | `Mat4` rotation, baked at parse time |

Three details of it matter to a reader:

- **Underscores in the bone name become spaces** in place (`0x8266e43`), so
  `Bip01_R_Hand` is the bone `Bip01 R Hand`.
- **The offsets are not in the declaring node's frame.** `+0x04` is
  `BundleTemplate::getNoTemplates() - 1` (`0x8266d98`, vptr+0x8c) — the child
  added most recently *before the line*. The Willys writes both hands on
  `WillySteeringDummy` **after** `addTemplate WillySteering`, so they measure
  from the wheel that turns, which is the whole mechanism by which the hands
  follow the steering. A template that declares IK before any child gets -1,
  meaning the declaring node itself: `Vehicles/Common`'s four `Attach_*`
  bundles, and the Sherman's own `Browning`.
- **A second line for one bone replaces the first** (`0x8266d70` scans by name
  id, `0x8266e1a` overwrites) rather than appending — but it overwrites **only
  the position (`slot+0x0c`) and the baked matrix (`slot+0x18`)**. That branch
  never reaches the `getNoTemplates()` call at `0x8266d98`, so `slot+0x04`
  keeps the target child the *first* declaration recorded, however many
  children were added in between. 24 lines across six mods hit this; FHSW's
  `Hotchkiss` declares the same two lines before any child and again after
  two, and the engine measures both from the mount.

Which reading of the frame is right was checked against the data as well as
the instructions. 2,097 live lines: 1,423 have no child before them and the
two readings agree; 540 have one placed at the parent's origin, where they
also agree numerically; **134 genuinely differ**, over 70 declaring templates.
Where they differ, the child reading is the one that puts a hand somewhere:

- `25mmAA_handle2_grip` (FH, FHSW, WarFront) — the only child is
  `25mmAA_Crank` at `0.27/0/0` and the right hand's offset is `0.0/0.0/-0.05`,
  so the child reading puts that hand exactly on the crank handle. The
  declaring-node reading puts it 0.27 m off it, on the mount.
- `BMG_Browning` (FH) — the children are two muzzle emitters at `±0.08/.05/.77`
  and the offsets are `±/0.04/-1.3`. Against the muzzle that is `-0.53` behind
  the pivot, the spade grips, and within 0.15 m of the `0.12/0.08/-0.68` every
  other Browning in the corpus uses with no child at all. Against the node it
  is 1.3 m back, behind the gunner.
- `BTR60SteeringDummy` (EoD) and every steering dummy like it — the child sits
  at the parent's origin but *rotates*, so the two readings differ only in what
  happens when the wheel turns, and only the child reading turns the hands with
  it. That is the visible behaviour the reference capture shows.

It is not universally respected by content: `GunboatGRohr` (bf1918) copies the
stock `0.12/0.08/-0.68` onto a template whose only child is a muzzle 1.1 m
forward, so the engine puts that gunner's hands up at the muzzle. The rule is
the engine's; the mod is wrong.

**The second triple is Refractor yaw/pitch/roll in degrees.**
`addSkeletonIK` bakes it with `dice::ref2::setRotation(Mat4&, const Vec3&)`
(`0x08060d30`), which is the *same* helper `BundleTemplate::setRotation`
(`0x081a9050`, calling it at `0x081a9085`) uses for
`ObjectTemplate.setRotation`. That helper sets the 3x3 to identity and then
applies `yaw`, `pitch` and `roll` in that order (`0x08061db0` / `0x08061dd0` /
`0x08061df0`) — each of which is `rotateAboutLine(m, axis, angle)`
(`0x08061e10`) about **the matrix's own row**: `yaw` about `m+0x10` (its Y
row), `pitch` about `m+0x00` (its X row), `roll` about `m+0x20` (its Z row).
So it is an intrinsic, body-fixed Y-X'-Z'' composition, which is the same
rotation as the extrinsic `Ry * Rx * Rz` that `quat_from_ypr` builds.

(An earlier reading had each of the three going through `rotateZDeg`
(`0x080625f0`). That is a different helper and is not on this path; the
conclusion is unaffected, because what settles the convention is the shared
call to `0x08060d30`.)

That shared call is the whole argument: `ObjectTemplate.setRotation`'s
arguments are unambiguously degrees in every `.con` in the game
(`WillySteeringDummy` itself is placed with `setRotation 0/34/0`), and
`addSkeletonIK`'s triple goes through the identical helper on the identical
type. Hence degrees, and hence exactly the convention `bf42/gltf.py`'s
`quat_from_ypr` already converts for every placed node in the export.
Vanilla's values run to ±180 (`-80/60/50` on the Willys' right hand), which no
radian reading survives.

### What kind of solve it is: both

`AnimatedBundle::updateIk` (`0x08265880`, confirmed; 0x7fc bytes) runs for a
bundle with a seated `BFSoldier` above it — found by walking the `+0x50` parent
chain for an interface and checking the object's template class id against
`ds:0x86c2b88` (`0x8265966`). For each entry it:

1. walks `getChild()` (vptr+0x7c) and then `targetChild` siblings via `+0x54`
   (`0x82659f4`–`0x8265a1f`), or takes the declaring bundle itself when the
   index is negative (`0x82659f2`), and reads `getAbsoluteTransformation()`
   (vptr+0x40) off what it lands on;
2. transforms the position triple by that matrix (`0x8265a94` onwards — a
   row-vector point transform, translation row added last);
3. re-expresses it in the soldier's own frame by the rigid inverse of the
   soldier's world matrix, built inline at `0x8265b3f`;
4. multiplies the baked rotation by the target's rotation in that frame
   (`BaseMatrix4<float>::mult`, `0x826600f`);
5. calls `Skeleton::applyIk(int, const Vec3&, const Mat4&)` (`0x08342610`) —
   which **only records an `IkHandle`** against the bone (80 bytes: Vec3
   position, Mat4 rotation, int bone index; the bone record's `+0xE0` holds the
   handle index, -1 for none).

The solve is in `Skeleton::transform` (`0x083420f0`): a bone carrying a handle
goes through `Skeleton::applyIK2BoneSolver` (`0x083418f0`), a wrapper over
`maya::applyIK2BoneSolver(const Vec3&, ..., Mat4&, Mat4&)` (`0x08332e10`),
using the bone array entries at `i-1` and `i-2` — 232 bytes apart (`edx` is
built as `base + 232*i` at `0x08341908`, then read at `-0xa0`/`-0x90`/`-0x80`
and `-0x1d0`) — i.e. the forearm and the upper arm. **Then the bone's world
rotation rows are overwritten outright** with the handle's
(`0x8342233`–`0x83422a7`), keeping the translation the solve produced.

That `i-1`/`i-2` is an *array* walk, not a parent walk, and the two only agree
if the skeleton stores each bone right after its parent. In `UsSoldier.ske`
they do, for all four bones the data ever names: `Bip01 R Hand` is 44 with
`R Forearm` 43 and `R UpperArm` 42, `Bip01 L Hand` is 21 with 20 and 19,
`Bip01 L Foot` is 4 with `L Calf` 3 and `L Thigh` 2, `Bip01 R Foot` is 8 with
7 and 6. So the viewer's hierarchical `end.parent.parent` is the same chain.

So the plan's open question — "a two-bone reach up the arm, or a plain override
of the hand bone?" — is **both, in that order**: the arm reaches, and the hand
is then planted at the declared angle regardless of where the arm came from.

## The grammar, across every installed mod

`addSkeletonIK` appears 2,338 times across 16 mods (2,097 live, 241 commented
out), and **every live line parses as exactly `<bone> <a/b/c> <d/e/f>`** — no
other arity, no other shape. Only four bone names are ever used:

| bone | lines |
|---|---|
| `Bip01_R_Hand` | 1,035 |
| `Bip01_L_Hand` | 1,016 |
| `Bip01_L_Foot` | 24 |
| `Bip01_R_Foot` | 22 |

Per mod: FHSW 445, bg42 420, FH 278, bf1918 217, WarFront 127, EoD 122,
interstate 74, FinnWars 73, Pirates 70, DC_Final 64, DesertCombat 58, **bf1942
48**, GCMOD 36, XPack2 29, bfheroes 24, XPack1 12. Vanilla's 48 are not a
special case of anything: the mods use the same two triples on the same four
bones. The feet appear only where a vehicle poses a standing gunner's stance.
The survey is `scratch/survey_ik.py` in this track's scratch directory.

## What was built

| File | Change |
|---|---|
| `bf42/con.py` | `targetChild` (the engine's `getNoTemplates() - 1`), and one entry per bone per template, last write winning |
| `bf42/assemble.py` | `extras.skeletonIK` gains `targetChild` renumbered against the children this configuration actually builds, plus `targetNode`; a node carrying nothing but IK is no longer dropped; `report.skeletonIk` |
| `extract_pose.py` | `resolve_seat_states` (the engine's rule), `seat_pose_name`, `seat_anchored`, the corrected root rotation; `--seat-poses` now covers seats that declare nothing |
| `viewer/seat-ik.js` | new; no `three` import |
| `viewer/map.html` | `loadSeatPose` asks whether the seat draws anybody; `bindSeatIk`, `stepSeatIk`, `hideBelowPelvis`; `__seatIk`/`__seatSoldier` hooks |
| `tests/test_seat_ik.py`, `tests/seat_ik_harness.mjs` | the module under node |
| `tests/test_con.py`, `test_assemble.py`, `test_pose.py` | the extractor changes |

### Two export bugs that were in the way

Both are older than this round and both hit the **passenger** poses that were
believed to be working end to end.

1. **The root rotation was `ypr(180, 0, 0)`** — a pure yaw, which lays the
   soldier on his back with his knees in the air. It is now
   `ypr(180, -90, 0)`, and it is **derived**, from the two frames it has to
   reconcile rather than from a model of how three sign conventions compose.

   *What the file holds.* A seat pose's joint hierarchy is written in the space
   `ske.parse` produces — the `.ske`'s own space, mirrored in Z. In that space
   the soldier's spine runs along **-Z** and, for a sitting clip, his thighs
   run along **+Y**. Measured on all eight distinct poses vanilla ships,
   `head - pelvis` has z between -0.92 and -1.00 and `knee - hip` has y between
   +0.85 and +0.99. The one exception is the informative one:
   `Lb_StandInVehicle`'s thigh runs along +Z, down the spine, because a
   standing lower body has no bend to measure.

   *What glTF wants.* Up is +Y, and the node the pose is parented to is a
   `SeatObject` in the vehicle's own exported tree, where `gltf.py` has
   mirrored Refractor's +Z forward to **-Z**. So an occupant facing the way the
   vehicle faces must face -Z.

   Two images therefore fix the rotation: `R(-Z) = +Y` and `R(+Y) = -Z`. A
   rotation with `y -> -z` and `z -> -y` must take `x -> -x` to keep its
   determinant +1; that matrix is symmetric with trace -1, hence a half turn,
   about the axis `(0, 1, -1)/sqrt(2)`. `quat_from_ypr(180, -90, 0)` is exactly
   that quaternion, and the page agrees with the derivation to three decimals.
   `SeatPoseOrientationTests` now asserts the two images and the axis rather
   than grepping the source for a constant.
2. **A `.baf` seat clip's root track carries the standing origin-at-the-feet
   offset.** `3PWillySitLower` writes `Bip01` at `0/-0.1104/-0.8335`, the same
   0.83 m from the hips that `3PStandLower` writes (`0.004/-0.0075/-0.9992`)
   for a man on the ground. A `SeatObject` is the cushion — `WillySeat` sits
   0.6 m up inside the Willys' body — so a pose parented there rode 0.83 m out
   of the vehicle: the driver's shoulder came out 1.25 m from a wheel 0.60 m of
   arm away, and no solve could reach it. `seat_anchored` drops that
   translation (keeping the rotation) in the static hierarchy and in every clip
   frame, and records what it dropped in the report.

   **Revised 2026-09-26: the root is measured from the standing root, not
   dropped.** Dropping it put every pelvis *on* its `SeatObject`, which is right
   only for a clip whose sitting height matches the Willys'. The Hanomag's
   bench clip puts the hips 0.297 m up and the M3A1's 0.434 m, so their
   passengers floated 0.4-0.55 m over the benches and their heads went through
   the roof (and every fighter pilot's helmet through his canopy).
   `SeatObject::enter` (lnxded `0x083208d0`) parents the soldier under an
   identity transform; the seat nodes are where a *standing* man's hips would
   be. `seat_anchored` now subtracts `Lb_Stand`'s aligned root (0.9992 m up)
   from the seat clip's, which puts every seated foot at standing-foot level
   and the pelvis 5-12 cm over its seat surface in the Hanomag (bench 0.18),
   M3A1 (0.19), Willys (cushion 0.38) and Kubelwagen (0.0). Standing gunners
   (`Lb_StandInVehicle`, the same clip) are unchanged; sit-in-vehicle drivers
   and pilots drop 0.166 m. The Willys driver still solves onto the wheel.
   Reports record `rootOffset` and `standingRoot`.

## How it was verified

Served from this worktree on `:5313` over a Wake level and a Willys/Sherman
re-extracted with this code, driven with Playwright under SwiftShader
(`scratch/drive.mjs`, `scratch/probe.mjs`). Measurements are
`window.__seatIk()`'s own: the declared offset off the target node's live world
pose against the bone's actual world position.

| check | result |
|---|---|
| Willys driver, wheel centred | both hands **0.00000 m** from their targets |
| Willys driver, full left lock | both hands **0.00000 m**; the rim has visibly rotated and the hands with it |
| Willys driver geometry | pelvis 0.03 m from `WillySeat`, head 0.641 m above it, knees 0.467 m forward, feet 0.224 m below the pelvis |
| Sherman driving position | `__seatSoldier()` null, no IK chains — nobody drawn |
| Sherman hull gunner | drawn, `Bip01 Pelvis` scaled to 1e-4 (legs hidden), both hands 0.00000 m from the Browning |
| C cycle | cockpit hides the body; chase, front and flyby show it |
| binding | `WillySteeringDummy` → `WillySteering` (the wheel), `Browning` → itself (`targetChild` -1) |

Captures are in this track's scratch `shots/`: `willy-behind`, `willy-side`,
`willy-behind-lock`, `sherman-gunner-side`, and the before-the-fix
`willy-behind` showing the soldier on his back.

### Re-checked on review

Re-derived and re-driven independently in the `rc-occupant` scratch, against
the **merged** tree (streams A and B are in `main`), the re-extracted Wake and
a re-extracted Willys. The level matters: the published `maps/wake/scene.glb`
carries **no** `skeletonIK` at all, so nothing binds until every level is
re-extracted with this branch's `assemble.py`.

| check | result |
|---|---|
| Willys passenger, **before** this branch (`:5273`, `main`'s poses) | spine `(-0.029, 0.112, 0.993)` — horizontal; knees `(-0.391, 0.910, 0.141)` — straight up; hips **0.837 m** from `WillyPassengerSeat` |
| Willys passenger, **after** | spine `(-0.003, 0.994, -0.112)`; knees `(-0.371, 0.150, -0.916)` — forward; hips **0.031 m** from the seat |
| Willys driver, hands | both **0.00000 m** from their targets; hands level with each other, 0.500 m apart, 0.39 m forward of the pelvis — nine and three |
| Willys driver, seat | pelvis `(-0.394, 0.600, 0.720)` in the vehicle's frame against `WillySeat`'s declared `-0.399/0.6/-0.75`: 0.005 m; head 0.641 m above the seat |
| M3A1 driver (`c_SeatShowHalfBodySoldier`) | drawn, pelvis scaled 1e-4, hips 0.03 m from `M3A1Seat` |
| M3A1 Browning gunner (`c_SeatShowStandingSoldier`) | drawn standing — knees *below* the hips, `(-0.170, -0.898, 0.405)` — hips 0.01 m from the seat |
| M3A1 bench passengers, PCO2 and PCO3 | upright, hips 0.012 m from their own seats, and their knee directions are **opposite** — `(-0.710, 0.195, -0.677)` against `(0.711, 0.191, 0.677)`. The same root rotation serves both, which is the point: the constant is a property of the pose file, and the seat's own world orientation is copied on at runtime |
| six enter/leave cycles | scene returns to 0 seat soldiers, 0 kit parts, 0 IK chains, 9 scene children — after the `leaveVehicle` fix below |
| seat switching, driver ↔ passenger | 2 IK chains → 0 → 2; the passenger seat declares none, correctly |
| C cycle | `cockpit` hides the body; `chase`, `front`, `flyby` show it |
| level change while seated | everything released: 0 soldiers, 0 kit parts, geometries 399 → 119 |

Captures: `rc-occupant/shots/before-willy-passenger-side.png` (the passenger
upside down with his boots out of the back) against
`after-willy-passenger-side.png`, and `helmet-willy-driver-ref-close.png`
taken from the owner's own camera in `models-work/willy-hands-wheel.png`.

## Still open

- **Every seat pose in the published tree is wrong** and needs re-exporting —
  the passenger ones as much as the new driver ones, because both export bugs
  predate this work. `python3 extract_pose.py --seat-poses --out <models>`.
- Seat poses were exported for three soldiers to verify (`USMarineSoldier`,
  `USSoldier`, `JapaneseSoldier`); the full catalogue is 8 pose pairs per
  soldier.
- ~~The seated soldier is **bare-headed** where the reference capture shows a
  helmet.~~ **Done on review.** It is not the head variant: a `BFSoldier`
  template declares a body, a head and two hands and nothing else, so every
  soldier the extractor produces is bare-headed by construction. The helmet
  belongs to the **kit**, and the engine hangs it off one of exactly three
  bones of the wearer's own skeleton — `A` (a child of `Bip01 Head`, index 17
  in `UsSoldier.ske`), `backpack` and `HipPack`. `kits.html` has grafted them
  since the kit work landed; the convention moved into `viewer/kit-graft.js`
  so `map.html` could dress a seated occupant the same way, and both pages now
  read the per-slot rotations from one place. Those rotations were settled by
  eye and stay pinned: three automated checks once passed that graft while
  every helmet was upside down (`kits.md`).

  Only the seated occupant is dressed. The spawn-pad soldiers and the on-foot
  player load the same bare pose glbs and are still bare-headed; it is the
  same call in three more places whenever someone wants it.
- `Bip01_L_Foot` / `Bip01_R_Foot` IK (46 lines across the mods) goes through
  the same code path — the chain is the bone's two ancestors either way — but
  no vehicle on Wake declares one, so it is **untested**.
- The solver keeps the limb plane the clip already has rather than using a pole
  vector, because the data carries none. A target behind the shoulder swings
  the arm through a large arc; it reaches, but the elbow ends up wherever the
  swing puts it.
- `updateIk`'s step 3 (into the soldier's own frame) is not reproduced: the
  viewer composes in world space, which is the same answer, because the engine
  only detours through that frame to store into a skeleton expressed there.
  Noted rather than hidden.

## Found on review, and fixed

- **`leaveVehicle` never disposed the seat pose.** The E-key exit is the one
  path that did not; the debug pilot toggle's did, and `exitManned` did. Once a
  driver's seat had a soldier to leave behind, stepping out of a jeep left him
  sitting in mid-air where the seat had been, with his IK still solved every
  frame, until the next entry replaced him. Six enter/leave cycles left one
  orphan scene and two live chains with the player standing on the grass; they
  now leave nothing.
- **A load still in flight could adopt itself into an empty world.**
  `loadSeatPose` is not awaited at its call sites, so leaving before the glb
  arrived produced the same orphan by a different route. A generation counter,
  bumped by `disposeSeatPose` as well as by `loadSeatPose`, makes a stale load
  discard what it fetched.
- **The pose scene was never given back to the GPU.** `disposeSeatPose`
  disposed skeletons and nothing else — no geometries, no materials, no
  textures, no `mixer.uncacheRoot`. It now does what `disposeHandWeapon` does,
  and skips the grafted kit parts, which are clones sharing cached geometry.
- **A repeated `addSkeletonIK` kept the wrong frame.** The engine's overwrite
  branch (`0x8266e1a`) writes the position and the baked matrix and nothing
  else; it never reaches the `getNoTemplates()` call at `0x8266d98`, so the
  target child stays what the *first* declaration recorded. We replaced the
  whole entry. 24 lines across six mods are affected — FHSW's `Hotchkiss`
  declares the same two lines before any child and again after two, and would
  have measured from the shell ejector instead of the mount.
- **Road to Rome resolved 40 of 50 seat poses.** `M3GMCPassengerSeat` names
  `Ub_PassengerInM3GMC`, which appears in exactly one file in the whole install
  (the M3GMC's own `Objects.con`) and in no `AnimationStates` file anywhere.
  The mod path *is* being read — vanilla's `AnimationStates.con` ends with
  `run AnimationStatesMod`, XPack1 ships `Animations/AnimationStatesMod.con`,
  and parsing XPack1 yields 1,636 states against vanilla's 1,458 with no
  missing runs — the states simply do not exist, which is a bug in the mod.
  The engine leaves the slot alone in that case (`setAnimationState`
  `0x0826cee0` → `findState` `0x08328610` returns -1 → return at `0x0826cf12`)
  and still draws the occupant, so each unresolvable half now drops to the
  engine's own default, the substitution is printed and recorded in
  `seat-poses.json`, and the page asks for the same asset when the declared one
  404s. 50 of 50.
- **The IK rotation was re-baked every frame.** `refractorYpr` is six trig
  calls per bound hand per frame; the engine bakes the triple once while
  reading the `.con` (`0x8266d41`). `collectIkBindings` now does the same, and
  the comment claiming the pass allocated nothing says what is true.

### Left alone, with the reason

- **Enter/leave leaks 6 geometries and 4 textures per cycle** — sampled always
  outside the vehicle, everything warm: 357, 363, 369, 375, 381. It is **not**
  this path: unchecking the pilot box, so `loadSeatPose` returns before
  fetching anything, gives byte-identical numbers. Older code, on the on-foot
  soldier / weapon-rig reload. Raised separately.
- **Dying while seated** does nothing, because the page has no flow for it:
  `soldierArmor` is only ticked in the on-foot branch, so `__damage` while in a
  vehicle latches no death and opens no deploy screen. Nothing for this branch
  to get wrong; worth a row of its own for whoever owns vehicle death.
- **`Lb_StandInVehicle` for a half-body seat.** `setUseSeat` jumps straight to
  `disableBoneTree` when the half-body bit is set (`0x8271a1d` → `0x8271b63`)
  and never sets a lower-body state at all. We resolve one anyway; the legs are
  hidden, so it cannot show, and having one name per pose keeps the asset
  lookup a single path.
