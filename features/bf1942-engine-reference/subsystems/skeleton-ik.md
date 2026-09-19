# Skeleton IK — where a seated soldier's hands go

`addSkeletonIK` is a `.con` word on an `AnimatedBundleTemplate`. The engine
resolves it every frame into a two-bone reach followed by an outright rotation
override, and the whole of "a driver's hands stay on the wheel" is one integer
on an 88-byte struct. Read 2026-09-19 and re-derived by a second agent; ledger
rows IK-1…IK-4. All addresses `bf1942_lnxded.static`.

**This lives here rather than in
[seats-and-entry-points.md](seats-and-entry-points.md)** because it is not a
seat mechanism: it is the animation system's, it applies to feet as well as
hands, and a `SeatObject` never appears in the chain. That doc cross-references
it for the case that motivated the reading.

The shipped data is remarkably uniform: **2,338 `addSkeletonIK` lines across 16
mods, 2,097 live, zero unparsed, always exactly two slash-triples**, and only
four bone names ever occur — `R_Hand` 1,035, `L_Hand` 1,016, `L_Foot` 24,
`R_Foot` 22. Vanilla's 48 are not a special case.

## 1. The struct, and the field that matters

`addSkeletonIK` (`0x08266cb0`) builds a `SkeletonIkInfo` on the stack at
`ebp-0x88` and appends it, stride `0x58` = 88 bytes (`add edx,0x58`,
`lea eax,[edi+0x58]`):

| offset | type | meaning |
|---|---|---|
| `+0x00` | short | bone-name id |
| `+0x04` | int | **target child index**, or −1 |
| `+0x08` | int | cached bone index, seeded −1 |
| `+0x0c` | Vec3 | the offset, in the target child's frame |
| `+0x18` | Mat4 | the baked rotation |

**`+0x04` is the child added most recently before the line** (IK-1). It is
filled from `call [eax+0x8c]` on `this`'s vptr followed by `dec eax`
(`0x8266d98`), and vptr + 0x8c is `vtable for AnimatedBundleTemplate` + 0x94 =
`BundleTemplate::getNoTemplates()` (`0x081a98f0`), which returns
`([+0x144] − [+0x140]) / 4`; `addTemplate` (`0x081a8e70`) appends exactly one
entry. A line declared before any child gets −1 and measures from the declaring
node — `Vehicles/Common`'s `Attach_*` and the Sherman's `Browning` are that
case.

`updateIk` (`0x08265880`, 0x7fc bytes) spends it: load `+0x04` at `0x82659ed`,
take the declaring node when negative (`js 0x82659f2`), otherwise `getChild()`
(vptr+0x7c) then N `+0x54` siblings (`0x8265a15`–`0x8265a1f`), then
`getAbsoluteTransformation()` (vptr+0x40). The runtime child index equals
template declaration order, because `addBundleChilds` (`0x081a8300`) walks the
template vector forward and `addChild` appends onto the **tail** (`0x8165ea0`
walks `+0x54` to the end), skipping nothing.

The whole mechanism is visible in the Willys: both hand lines come **after**
`addTemplate WillySteering`, so they measure from the wheel that turns, and the
hands turn with it.

**What it is worth, on the data.** Of the 2,097 live lines, 1,423 have no child
before them and 540 have one sitting at the parent's origin — both readings
agree on all 1,963. **134 lines across 70 templates genuinely differ**, and in
every one the child reading is the one that lands a hand:

- `25mmAA_handle2_grip` (FH/FHSW/WarFront): child `25mmAA_Crank` at `0.27/0/0`,
  right hand `0.0/0.0/−0.05`. Against the child the hand is exactly on the crank
  handle; against the node it is 0.27 m off it.
- `BMG_Browning` (FH): the children are muzzles at `±0.08/.05/.77` and the
  offsets are `±/0.04/−1.3`. Against the muzzle that is −0.53, the spade grips —
  within 0.15 m of the `0.12/0.08/−0.68` that every index-−1 Browning uses.
  Against the node it is 1.3 m behind the gunner.
- `BTR60SteeringDummy` (EoD), `zis5steeringdummy` (FinnWars),
  `GunCarrierSteeringDummy` (bf1918): the child sits at the origin but
  **rotates**, so only the child reading turns the hands with the wheel.

One counter-example is worth carrying, because it shows the rule is the
engine's and not a fit: bf1918's `GunboatGRohr` copies the stock Browning offset
onto a template whose only child is a muzzle 1.1 m forward, and the engine
really does put that gunner's hands at the muzzle. The rule is right; that mod
is wrong.

## 2. The second triple is degrees, and the composition is intrinsic

`addSkeletonIK` bakes the rotation at parse time by calling
`dice::ref2::setRotation` (`0x08060d30`) at `0x8266d41` — **the same helper**
`BundleTemplate::setRotation` (`0x081a9050`) calls at `0x081a9085` for
`ObjectTemplate.setRotation`, whose arguments are unambiguously degrees
(`WillySteeringDummy` is itself placed `setRotation 0/34/0`). That shared call
is the argument for the unit; nothing else needs to be believed.

**The composition is three `rotateAboutLine` calls about the matrix's own rows**
(IK-2, corrected): `yaw` / `pitch` / `roll` (`0x08061db0` / `0x08061dd0` /
`0x08061df0`) each call `rotateAboutLine` (`0x08061e10`) about `m+0x10`,
`m+0x00` and `m+0x20` respectively — an intrinsic Y-X'-Z'' composition, equal to
the extrinsic `Ry·Rx·Rz` that a `quat_from_ypr` builds. A first reading said
"each via `rotateZDeg` (`0x080625f0`)"; that is a different helper and is not on
this path. The conclusion — that an existing `quat_from_ypr` is exactly right
for these triples — survives the correction, but the chain that justified it did
not.

## 3. The solve: reach on `i−1`/`i−2`, then override the hand's rotation

`applyIk` (`0x08342610`) only **records** an `IkHandle` at `bone+0xe0`.
`Skeleton::transform` (`0x083420f0`) does the work: it reads that index, calls
`applyIK2BoneSolver` (`0x083418f0` → `maya::applyIK2BoneSolver` `0x08332e10`)
when it is not −1, and **after** the `mult` copies the handle's rotation rows
over the bone's world matrix at `0x8342233`–`0x83422a7`, keeping the translation
the solve produced. A reach, then an outright rotation override.

The solver builds `edx = boneArray + 232·i` at `0x08341908` and reads `−0xa0` /
`−0x90` / `−0x80` (bone `i−1`) and `−0x1d0` (bone `i−2`). **Those are the
forearm and the upper arm.** In `UsSoldier.ske`, `Bip01 R Hand` is 44 with R
Forearm 43 and R UpperArm 42; L Hand 21/20/19; L Foot 4/3/2; R Foot 8/7/6 — for
every one of the four bones the data ever names, array `i−1`/`i−2` is parent and
grandparent, so a hierarchical walk reaches the same chain.

`Skeleton::transform`'s only other hook is the post-absolute transform at
`bone+0x88` (see [physics.md](physics.md) and ledger ANIM-5); `updateIk` itself
is gated on `IID_IPlayerControlObject` `0x086d3c50` plus `CID_BFSoldierTemplate`
`0x086c2b88` — a **seated** soldier.

## 4. One entry per bone, and what a second line really replaces

A later `addSkeletonIK` for the same bone replaces an earlier one (IK-4) — but
**only the Vec3 and the Mat4**. `0x8266d70` finds the existing entry by name id
and the replace branch at `0x8266e1a` writes `slot+0x0c` and `slot+0x18` and
**never reaches `0x8266d98`**, the `getNoTemplates()−1` store. So **the target
child keeps the first declaration's value.**

That is not academic: 24 lines across six mods are affected — FHSW's
`Hotchkiss`, FH/FHSW's `PT_BoatDriverHandDummy`, `AA_Allies_Crank`,
`LcvpHandDummy2`, and Interstate 82's `stratos`, `RedLightning` and `buggy`
steering dummies. A reader that replaces the whole entry re-points those hands
at whichever child happened to be declared last.

## Open

- **Foot IK is untested against anything.** 46 lines across the mods take the
  same code path, and no level that has been driven declares one.
- `updateIk`'s third step, transforming into the soldier's own frame, was
  deliberately not reproduced by the viewer — world space is the same answer for
  its purpose, but nobody has read that step.
- The client twin of `Skeleton::transform` is `0x00611690`; the rest of this
  chain has not been located in the client.
