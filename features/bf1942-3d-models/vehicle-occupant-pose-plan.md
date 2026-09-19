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
  id, `0x8266e1a` overwrites) rather than appending.

**The second triple is Refractor yaw/pitch/roll in degrees.**
`addSkeletonIK` bakes it with `dice::ref2::setRotation(Mat4&, const Vec3&)`
(`0x08060d30`), which is the *same* helper `BundleTemplate::setRotation`
(`0x081a9085`) uses for `ObjectTemplate.setRotation`. That helper sets the 3x3
to identity and then applies `yaw` about the matrix's own Y row, `pitch` about
its X row and `roll` about its Z row (`0x08061db0` / `0x08061dd0` /
`0x08061df0`), each through `rotateAboutLine` → `rotateZDeg` (`0x080625f0`) —
hence degrees, and hence exactly the convention `bf42/gltf.py`'s
`quat_from_ypr` already converts for every placed node in the export. Vanilla's
values run to ±180 (`-80/60/50` on the Willys' right hand), which no radian
reading survives.

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
using the bone array entries at `i-1` and `i-2` — 232 bytes apart, read at
negative offsets from the bone — i.e. the forearm and the upper arm. **Then the
bone's world rotation rows are overwritten outright** with the handle's
(`0x8342233`–`0x83422a7`), keeping the translation the solve produced.

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
   `ypr(180, -90, 0)`. This value is **empirical**: it was chosen by loading
   real exported poses in the page and measuring, because two attempts at
   deriving it from the three sign conventions involved (the `.ske`'s
   Z-mirror, the `.baf`'s conjugate quaternion and clip-world yaw, and glTF's
   own mirror in `add_node`) disagreed with what the page draws. The test
   pins it and says so.
2. **A `.baf` seat clip's root track carries the standing origin-at-the-feet
   offset.** `3PWillySitLower` writes `Bip01` at `0/-0.1104/-0.8335`, the same
   0.83 m from the hips that `3PStandLower` writes (`0.004/-0.0075/-0.9992`)
   for a man on the ground. A `SeatObject` is the cushion — `WillySeat` sits
   0.6 m up inside the Willys' body — so a pose parented there rode 0.83 m out
   of the vehicle: the driver's shoulder came out 1.25 m from a wheel 0.60 m of
   arm away, and no solve could reach it. `seat_anchored` drops that
   translation (keeping the rotation) in the static hierarchy and in every clip
   frame, and records what it dropped in the report.

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

## Still open

- **Every seat pose in the published tree is wrong** and needs re-exporting —
  the passenger ones as much as the new driver ones, because both export bugs
  predate this work. `python3 extract_pose.py --seat-poses --out <models>`.
- Seat poses were exported for three soldiers to verify (`USMarineSoldier`,
  `USSoldier`, `JapaneseSoldier`); the full catalogue is 8 pose pairs per
  soldier.
- The seated soldier is **bare-headed** where the reference capture shows a
  helmet. That is `soldier_parts`' head-variant choice
  (`USSoldierComplexHead1`), shared with every other pose export and not
  touched here.
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
