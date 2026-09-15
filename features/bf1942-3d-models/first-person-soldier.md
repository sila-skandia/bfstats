# Standing in the level: the first-person soldier

An investigation, not an implementation. The question is what it takes to put
the viewer's camera behind a soldier's eyes in a `map.html` level — on the
ground, weapon drawn, walls that stop you — and what the game's own data says
each piece should be.

Everything below was read out of `~/.wine/drive_c/EA Games/Battlefield 1942`
or measured with this repo's own readers. Reproduce commands are in §8.
Anything I could not settle from data says **UNVERIFIED** and says what it
would take.

> **Read §6b before §2.3 and §2.4.** Two of this document's original findings
> have since been **disproven by decompiling the retail client**, and they are
> the two that decide how the soldier moves: the movement speeds and the
> gravity. Both were derived here from shipped assets, both derivations were
> sound, and both answers were wrong — the speeds by a factor of 2.6 and gravity
> by 50%. The engine hardcodes the speeds in two float tables at `0x009581b4`
> and sets gravity to **−14.73 m/s²** in the `BasicPhysicsSystem` constructor at
> `0x00578f00`. The shipped module uses those. The superseded derivations are
> left in place, marked, because *how* a careful derivation went wrong is worth
> more than deleting it — but nothing in §2.3 or §2.4 should be copied into code
> without reading §6b first. Addresses are in
> [`../bf1942-engine-reference/symbols.json`](../bf1942-engine-reference/symbols.json),
> subsystem `physics`; `./xref.py list physics` prints them.

Companions: [`weapon-grip.md`](weapon-grip.md) (the pose/weld pipeline),
[`projectile-collision.md`](projectile-collision.md) (`collision.js`),
[`kits.md`](kits.md) and [`spawn-points.md`](spawn-points.md) (already
thorough on spawn groups — not repeated here),
[`parity-audit/infantry-gameplay.md`](parity-audit/infantry-gameplay.md) (the
audit this corrects in four places),
[`../flyable-vehicles/input-and-cockpit.md`](../flyable-vehicles/input-and-cockpit.md)
and [`../flyable-vehicles/camera-modes.md`](../flyable-vehicles/camera-modes.md)
(the camera/input shape to reuse).

---

## 1. The four facts that decide the design

**1. There is no first-person weapon model.** Not one of the 28 `HandFireArms`
has a `1P_*` alternative. The whole `Objects/HandWeapons/` tree contains
exactly two filenames beginning `1p`, and both are `1p_ATrocket_m1` — the
Bazooka's and Panzershreck's loaded rocket, bound to skeleton part `rocket`
inside the ordinary third-person bundle. In first person the game draws **the
same weapon mesh you already have**, welded to a *different body*: a 1P torso
and a 1P pair of hands, skinned to the same skeleton, playing a parallel set of
1P clips. So the viewmodel is not a new asset class. It is the weld we already
ship (`weapon-grip.md`, 224/224 pairs) with three meshes swapped and a
different clip family on the upper body.

**2. The stance deltas are declared exactly, and the absolute is 1.65 m.**
`setPoseCameraPos` gives 0.65 / 0.12 / −0.70 for standing / crouching / lying,
so crouch is 0.53 m below standing and prone is 1.35 m below it. *Those three
deltas are the durable finding and nothing has touched them.* The absolute was
originally taken from `center1pHands -0.12/-1.56/0.1` and read as 1.56 m; the
shipped module instead reads `setCharacterHeight -1.00` on the line below as the
origin-to-feet distance, which puts the eye at **1.65 / 1.12 / 0.30 m**. Both
readings are inferences off the same block and they differ by 9 cm. The second
is preferred because it explains all three heights from one declared constant
rather than one of them from a hand-rig offset; §6b has the argument.

**3. Movement speed is not declared in any `.con` — it is hardcoded in the
executable.** ~~The footstep clock plus the measured stride gives you the
answer~~ — it does not, and §2.3's derivation of run 2.28 / walk 1.08 /
crouch 1.58 / crawl 0.69 m/s is **wrong**. `BFSoldierTemplate::directionalSpeed`
at `0x009581b4` is `{6, 4, 2, 2, 1, 1}` m/s indexed by pose and by whether there
is any forward input at all, `strafeSpeed` at `0x009581cc` is `{4, 2, 1}`, and
`walkSpeedFactor` at `0x009581d8` is 1/3. A run is **6 m/s** and a backpedal
**4** — a ratio no stride-derived model can produce at all, because a stride
model has one number per gait. **The audit's cited `maxSpeed 5.0` is still not
the run speed** — it is an AI planning figure, and the Hanomag half-track
declares the same 5.0 — but it was nearer than the derivation was.

**4. `fireArms: []` on all 28 hand weapons is one string, and the muzzle node
already ships.** `assemble.py` tests `template.kind.lower() == "firearms"`; a
hand weapon is a `HandFireArms`. Meanwhile `No4.glb` already contains a node
named `e_MuzzGun` at `[0, 0.045, −0.745]` with its two emitters under it. And
25 of 28 weapons set `fireInCameraDof 1` with `projectilePosition 0/0/0`, so
the round is fired **along the camera axis**, not out of the muzzle — the
muzzle offset is for the flash only. Firing from a first-person camera is
therefore simpler than firing from a vehicle, not harder.

---

## 2. What the game does

### 2.1 The camera

`Objects/Soldiers/Common/Objects.con`, complete:

```con
ObjectTemplate.create Camera SoldierCamera
ObjectTemplate.setPivotPosition 0/0/0
ObjectTemplate.setMaxSpeed 0/0/0
ObjectTemplate.setHasTarget 0
ObjectTemplate.CVMInside 1
ObjectTemplate.CVMChase 0
ObjectTemplate.CVMFrontChase 0
ObjectTemplate.CVMFlyBy 0
ObjectTemplate.CVMTrace 0
ObjectTemplate.CVMExternTrace 0
```

Read it against `camera-modes.md` §2's 13-command `Camera` vocabulary and what
is *absent* is the finding: **no `setInputToYaw`, no `setInputToPitch`, no
`setMinRotation`/`setMaxRotation`, no `toggleMouseLook`.** A vehicle camera is
a rotating part with its own clamps and its own modal free-look. The soldier's
camera is not a part that moves — the *body* turns, and the camera rides it.
`Objects/Soldiers/Common/AI/Objects.con` says so directly:

```con
aiTemplatePlugIn.driveTurnControl      PIMouseLookX
aiTemplatePlugIn.aimHorizontalControl  PIMouseLookX
aiTemplatePlugIn.aimVerticalControl    PIMouseLookY
```

`setMaxSpeed 0/0/0` is consistent: the camera has no rate limit because it has
no axis of its own. There is no free-look on foot in BF1942.

The numbers that matter are all on the soldier, in
`Objects/Soldiers/Common/CommonSoldierData.inc`:

```con
objectTemplate.center1pHands -0.12/-1.56/0.1
ObjectTemplate.setPoseCameraPos c_BfSoldierStanding  0/0.65/0
ObjectTemplate.setPoseCameraPos c_BfSoldierCrouching 0/0.12/0
ObjectTemplate.setPoseCameraPos c_BfSoldierLying     0/-0.7/0
ObjectTemplate.setCharacterHeight -1.00
ObjectTemplate.set1pFov 0.47
ObjectTemplate.setTurnLeftRightAngle 20.0 14.0
ObjectTemplate.setPointUpDownAngle 38.0  38.0
ObjectTemplate.setLiePointUpDownAngle 0.0 -6.0
ObjectTemplate.addTemplate SoldierCamera
ObjectTemplate.setIsFirstPersonPart 2
```

Swept across the 18 installed mod directories that have an `Archives/` folder
(14 of which ship soldier data at all — XPack1, XPack2, FHSWEurope and STFHSWE
inherit it), **every one of these values is identical except two**: FH and FHSW
nudge `center1pHands` to `-0.06/-1.56/0.1` — the X only, the 1.56 never moves —
and FinnWars uses `c_BfSoldierLying 0/-0.8/0.0`. `set1pFov` is declared 18
times and is `0.47` all 18; `setCharacterHeight` is declared 17 times and is
`-1.00` all 17, which is why it reads as a sentinel rather than a measurement
and should not be built on.

**Eye height, derived twice.**

The `setPoseCameraPos` triple is relative to the soldier's own origin, and
nothing declares where that origin sits above the feet. Two independent routes
converge:

- `center1pHands -0.12/-1.56/0.1` places the 1P render rig relative to the
  camera. The 1P meshes are skinned to the ordinary soldier skeleton — measured
  `1PUSbody.skn` rest bbox z ∈ [1.166, 1.459] in the same mesh space where the
  3P body spans z ∈ [0.005, 1.651] at the standing pose — so the rig's origin
  *is* the feet. Camera = feet + 1.56 m.
- `UsSoldier.ske`'s root bone `Bip01` rests at z = +0.9266 m (the pelvis). If
  the PCO origin is the skeleton root, camera = 0.9266 + 0.65 = **1.577 m**.

The two agree to 1.7 cm. Take **1.56 m** and treat the residual as DICE's own
hand-tuning.

> **A third route was found later and it is the one that ships.**
> `CommonSoldierData.inc` declares `setCharacterHeight -1.00` on the line below
> the `setPoseCameraPos` triple. Read as the origin-to-feet distance it gives
> **1.65 / 1.12 / 0.30** — and its merit over both routes above is that it
> explains all three stances from one declared line, where `center1pHands`
> explains only the standing one and only via a hand-rig offset. It also puts
> the prone eye at 0.30 m rather than 0.21, and 0.21 m is a low number for a
> lying man's eyes. Still an inference. The two routes above are kept because
> the *deltas* they confirm are what actually matter and are unaffected.

| stance | declared offset | eye above feet (~~then~~ / now) | posed head bone | posed helmet bone `A` |
|---|---|---|---|---|
| standing | `0/0.65/0` | ~~1.56~~ / **1.65** | 1.638 | 1.754 |
| crouching | `0/0.12/0` | ~~1.03~~ / **1.12** | 1.074 | 1.194 |
| lying | `0/-0.7/0` | ~~0.21~~ / **0.30** | 0.316 | 0.420 |

The head-bone column is measured by posing `UsSoldier.ske` with the same
`Lb_Stand`+`Ub_StandAim` / `Lb_Crouch`+`Ub_Crouch` / `Lb_Lie`+`Ub_Lie` clips
`extract_pose.py` already resolves. Its stance deltas (−0.564, −1.322) agree
with the declared ones (−0.53, −1.35) to 3.4 cm and 2.8 cm — so
`setPoseCameraPos` really is tracking the head, and the engine uses a constant
per stance rather than the animated bone.

**FOV. UNVERIFIED units, but the uncertainty does not matter.** `set1pFov 0.47`
is the only first-person FOV in vanilla, and the `Camera` template has no FOV
command at all (`camera-modes.md` §5a). The same quantity appears as
`ObjectTemplate.vehicleFov` in mods — 426 uses, values clustered 0.25–0.9 with
`0` meaning "engine default" 2,396 times — so 0.47 sits exactly where a vehicle
cockpit sits. Two readings survive:

- half-angle in radians: vertical FOV = 2 × 0.47 rad = **53.9°**
- tangent of the half-angle: vertical FOV = 2 × atan(0.47) = **50.4°**

Both land between 50 and 54 degrees, which is within three.js's default 50. Pick
one, note it, move on. What *is* certain is the **ratio**, which is
reading-independent: a sniper's `zoomFov 0.1` is 4.7× the base, binoculars'
`0.2` is 2.35×.

One trap: `soldierZoomFov` is 0.6 on the No4, i.e. *larger* than the base 0.47,
so it cannot be the main camera's zoomed FOV — a sniper scope would then be the
widest view in the game, which `zoomFov 0.1` rules out. The reading that fits is
that `zoomFov` is the camera and `soldierZoomFov` is the FOV the **viewmodel**
is drawn with. Marked UNVERIFIED; it does not block anything.

**Look clamps.** The soldier carries them, not the camera:
`setPointUpDownAngle 38.0 38.0` (standing/crouched pitch, degrees up and down)
and `setLiePointUpDownAngle 0.0 -6.0` (prone — a much tighter band, which is
what prone feels like in game). `setTurnLeftRightAngle 20.0 14.0` is the
torso-twist threshold at which the legs shuffle to catch up; the animation
state machine's `Lb_TurnLeft` / `Lb_TurnRight` transitions fire off
`c_PIMouseLookX`, which is the same mechanism. Exact semantics of all three
are **UNVERIFIED**; the ±38° pitch clamp is the one worth honouring, and
`map.html` already clamps its free-fly pitch to ±1.2 rad (68.8°), so this is a
constant change.

**Per weapon, the camera moves.** 26 of 28 hand weapons declare
`soldierCameraPosition` — the No4 `-0.02/-0.03/0.01`, the Colt `0.02/-0.05/0.2`,
the Binoculars `0/-0.03/0.2` — and 20 declare `soldierZoomPosition` for the
zoomed view. Nothing in the repo parses either (`grep -ric soldierCameraPosition
bf42/ *.py` → 0).

### 2.2 The viewmodel

**No hand weapon has first-person geometry.** Reproduce:

```bash
python3 - <<'EOF'
from pathlib import Path; from bf42.rfa import RfaArchive
import re
A=Path.home()/'.wine/drive_c/EA Games/Battlefield 1942/Mods/bf1942/Archives'
a=RfaArchive(A/'Objects.rfa')
hits=[]
for n in a.entries:
    if not (n.lower().startswith('objects/handweapons/') and n.lower().endswith(('.con','.inc'))): continue
    for m in re.finditer(r'(?im)^\s*(GeometryTemplate\.(?:create\s+\w+|file)\s+\S*1p\S*|ObjectTemplate\.geometry\s+\S*1p\S*|ObjectTemplate\.setIsFirstPersonPart.*)', a.read(n).decode('latin-1')):
        hits.append((n, m.group(1).strip()))
print(len(hits), hits)
EOF
# 2 [('Objects/HandWeapons/Bazooka/Geometries.con', 'GeometryTemplate.file 1p_ATrocket_m1'),
#    ('Objects/HandWeapons/Panzershreck/Geometries.con', 'GeometryTemplate.file 1p_ATrocket_m1')]
```

Both are the rocket in the tube. `BazookaRocket` is `addTemplate`d under
`BazookaComplex` and `bindToSkeletonPart rocket` — an ordinary third-person
part whose source file happens to be named `1p_`. There is no
`setIsFirstPersonPart` anywhere in `Objects/HandWeapons/` at all.

**The soldier does have 1P geometry, and it is a body plus hands.**
`Objects/Soldiers/USSoldier/Objects.con`:

```con
ObjectTemplate.addTemplate USSoldier1PBody
ObjectTemplate.setIsFirstPersonPart 1
ObjectTemplate.addTemplate 1pUSSoldierRightHand
ObjectTemplate.setIsFirstPersonPart 1
ObjectTemplate.addTemplate 1pUSSoldierLeftHand
ObjectTemplate.setIsFirstPersonPart 1
```

and all three are `AnimatedMesh` with their own `.skn` against the shared
skeleton (`Geometries.con`: `Soldier/1PUsBody` → `animations/1PUSbody.skn`,
file `1PUsBody`). **Not static props — skinned, exactly like the 3P body.**
`bf42/skin.py` already reads them.

16 distinct meshes serve all 8 soldiers — 6 bodies (`1PUsBody`, `1PDesGerBody`,
`1pBritBody`, `1pGerBody`, `1pJapBody`, `1pRussBody`) and 5 hand pairs (Brit,
Ger, Jap, Russ, Us; the desert German borrows the German hands, the Marine and
Canadian the US ones). The winning copies live in `StandardMesh_001.rfa` and
total **885 KB uncompressed** before textures — for reference,
`USSoldier__No4.pose.glb` alone is 1.12 MB.

So: **the first-person view is the third-person weld with a different body.**
Same skeleton, same `Bip01 R Hand` graft, same weapon mesh. That is the single
most important structural fact in this document, because it means stage 2 is a
variant of `extract_pose.py` rather than a new pipeline.

### 2.3 Movement

The control map, `Mods/bf1942/Settings/Default/Controls/Infantry.con`:

| input | key | meaning |
|---|---|---|
| `c_PIThrottle` | W / S | forward / back |
| `c_PIYaw` | D / A | **strafe**, not turn |
| `c_PIMouseLookX/Y` | mouse | turn the whole body, and aim |
| `c_PIWalk` | LeftShift, push-and-hold | **walk** — the slow one. There is no sprint in BF1942 |
| `c_PICrouch` | LeftCtrl, push-and-hold | crouch |
| `c_PILie` | Z, non-repetitive | prone toggle |
| `c_PIAction` | Space | jump |
| `c_PIFire` / `c_PIAltFire` | LMB / RMB | fire / zoom |
| `c_PIReload` | R | reload |
| `c_PINextItem` / `c_PIPrevItem` | mouse wheel | weapon cycle |
| `c_PIUse` | E | enter vehicle / pick up kit |

`game.setInfMouseSensitivity 0.250000`, `game.setInfMouseInvert 0`.

That A/D is strafe and not yaw is confirmed structurally, not just by feel —
`animations/AnimationStatesLower.con` transitions on `c_PIYaw` into
`Lb_StrafeLeft` / `Lb_StrafeRight`, and on `c_PIMouseLookX` into `Lb_TurnLeft` /
`Lb_TurnRight`.

**A soldier is not an Engine-driven PCO.** `BFSoldier` is its own template kind.
It has no `Engine` child, no `setInputTo*` on any part, and its children are
exactly `SoldierEntry` (an `EntryPoint`, `setEntryRadius 3`), `SoldierCamera`,
`Parachute`, and the mesh parts. Its physics block is:

```con
ObjectTemplate.mass 100
ObjectTemplate.drag 1.0
ObjectTemplate.hasMobilePhysics 1
ObjectTemplate.hasCollisionPhysics 1
ObjectTemplate.hasResponsePhysics 1
ObjectTemplate.SpeedMod 0.5
ObjectTemplate.angleMod 1
```

`SpeedMod` / `angleMod` are collision-damage modifiers, not speeds — the same
pair that [`collision-and-crash.md`](../flyable-vehicles/collision-and-crash.md)
documents on vehicles (planes 2,
tanks 0.75, submarines 0.05).

**So where is the speed?** In the executable, and this section did not find it.
Everything from here to the end of §2.3's table is **superseded** — kept because
the reasoning is instructive, not because the answer is usable. Skip to §6b for
the numbers that ship. Three lines of evidence, of which the first two still
hold:

1. **The clips are in-place.** Posing every locomotion clip's root bone and
   summing frame-to-frame displacement gives a closed loop:
   `3PRunLower` net 1.8 cm over 13 frames, `3PWalkLower` net 0.1 cm over 24,
   `3PCrouchForwardLower` 1.9 cm, `3PLieForwardLower` 1.9 cm. No root motion —
   the engine translates the body, the clip only cycles the legs.
2. **`aiTemplatePlugIn.maxSpeed 5.0` is not it.** Sweeping all 40 AI `maxSpeed`
   declarations: fighters 60, Tiger 10, M10/Priest/Sexton 12, **Hanomag 5.0 —
   identical to the soldier**. A half-track and a running man do not share a top
   speed; this is the AI's planning figure.
3. **The footstep clock is declared, and it is in seconds.**
   `Objects/Soldiers/Common/Sounds/SoldierSound.inc`:

```con
SoldierSound.setStandFrequency  1.5
SoldierSound.setRunFrequency    0.36   SoldierSound.setRandomRunFrequency   0.017
SoldierSound.setWalkFrequency   0.66   SoldierSound.setRandomWalkFrequency  0.04
SoldierSound.setCrouchFrequency 0.50   SoldierSound.setRandomCrouchFrequency 0.04
SoldierSound.setCrawlFrequency  0.6    SoldierSound.setRandomCrawlFrequency 0.3
SoldierSound.setSwimFrequency   1      SoldierSound.setLadderFrequency 0.46
```

Multiply by the step length, measured as the maximum forward separation of the
two posed foot bones over the cycle (each clip verified to be a full two-step
cycle by tracing the sign of `L−R` per frame):

| gait | clip | frames | step length | footstep period | ~~derived speed~~ | engine's |
|---|---|---|---|---|---|---|
| run | `3PRunLower` | 13 | 0.821 m | 0.36 s | ~~2.28 m/s~~ | **6** |
| walk (Shift) | `3PWalkLower` | 24 | 0.711 m | 0.66 s | ~~1.08 m/s~~ | **2** |
| crouch move | `3PCrouchForwardLower` | 18 | 0.790 m | 0.50 s | ~~1.58 m/s~~ | **2** |
| prone crawl | `3PLieForwardLower` | 18 | 0.414 m | 0.60 s | ~~0.69 m/s~~ | **1** |

Derived ratios 1 : 0.47 : 0.69 : 0.30; the engine's are 1 : 0.33 : 0.33 : 0.17.
**Every derived figure is between 2.4x and 2.6x too slow, and even the ratios
are wrong.** The error is not in the measurements — the frequencies are shipped,
the strides were measured correctly, the clips really are in-place. It is in the
assumption joining them: a step length times a footstep rate only equals a
walking speed if the clip rate is fixed and the body is carried to match it.
Refractor does the opposite. The body moves at the table speed and the
locomotion clip is *played at a rate driven by that speed*, so the footstep
period is an output of the motion, not an input to it. Multiplying the two
recovers the speed the clip was authored at, which is not the speed the engine
moves you at. §6b has the rest.

**Jump.** `c_PIAction` selects `Lb_StandJump` (`3pJumpStandLower.baf`, 13
frames, speed 0.8) or `Lb_RunJump` (`3pJumpRunLower.baf`, 16 frames, speed 1.0).
The clips carry no arc — 4.3 cm and 5.2 cm of total root travel — so the impulse
is engine-side and remains **UNVERIFIED**; `physics.js` carries 5.4 m/s labelled
as a tunable, chosen to give a ~1.0 m apex, and says how to measure it properly.

**Gravity, on the other hand, is settled, and it is not 9.81.** This section
originally said "nothing in `Objects.rfa` or `Game.rfa` declares a gravity
constant for a soldier … `gunfire.js` already defines `GRAVITY = 9.81`; use
that". The first clause is true and the conclusion does not follow.
`BasicPhysicsSystem::BasicPhysicsSystem` at `0x00578f00` writes `0xC16BAE14` —
**−14.73 m/s²** — into the world gravity field. It is a console property that no
vanilla `.con` sets, so the constructor's default is the live value on every
map, and the only writers anywhere are the three chat cheats at `0x00729b30`
(`EarthWalk` −10, `MoonWalk` −1.67, `SpaceWalk` −0.1) — which is itself the
proof that −14.73 is deliberate rather than a leftover. `gunfire.js` was
corrected in the same pass (`6b53d38`). Everything in this game falls half again
as fast as it does on Earth, and that single number is most of why the original
build "felt broken" and the corrected one does not.

**No stamina, no sprint.** Shift is bound to `c_PIWalk`, which the state
machine uses only to enter `Lb_WalkForward` — the *slower* gait. There is no
faster one: `Lb_RunForward` is the default. `grep -i "stamina\|sprint"` over
every vanilla `.con` returns six hits and all six are `GrenadeAlliesSprint`,
the Mk2 grenade's safety lever (`bindToSkeletonPart sprint`, mesh
`gran_al_Sprint_m1`) — a spelling of "spring", not a player state.

### 2.4 Soldier-world collision

This is the question with the most surprising answer.

```con
rem CommonSoldierData.inc
ObjectTemplate.geometry BodyCollision
ObjectTemplate.setSkeletonCollisionBone Bip01_Head      0.02   2    40
ObjectTemplate.setSkeletonCollisionBone Bip01_Spine2    0.08  -0.45 41
ObjectTemplate.setSkeletonCollisionBone Bip01_L_Forearm 0.02   0.0  42
ObjectTemplate.setSkeletonCollisionBone Bip01_R_Forearm 0.02   0.0  42
ObjectTemplate.setSkeletonCollisionBone Bip01_L_Calf    0.03   0.3  42
ObjectTemplate.setSkeletonCollisionBone Bip01_R_Calf    0.03   0.3  42
ObjectTemplate.setSkeletonCollisionBone Bip01_L_Foot    0.035  0    42
ObjectTemplate.setSkeletonCollisionBone Bip01_R_Foot    0.035  0    42
```

```con
rem Objects/Soldiers/Common/Geometries.con -- the whole file
GeometryTemplate.create SkeletonCollisionMesh BodyCollision
GeometryTemplate.file bodycollision_m1
```

**`bodycollision_m1` does not exist.** Not in `standardMesh.rfa`, not in
`StandardMesh_001.rfa`, not in `animations.rfa`, `aiMeshes.rfa`, `treeMesh.rfa`,
`Objects.rfa` or `menu.rfa` — and not in a single archive of any of the 18
installed mod directories. `SkeletonCollisionMesh` is declared exactly once in all of
vanilla, and the file it names ships nowhere. The only reading that fits is
that a `SkeletonCollisionMesh` is *generated* from the eight
`setSkeletonCollisionBone` lines — a bone, a radius in metres, an up/down
adjustment, a material id — and the `file` line is vestigial. **Strong
inference**, and it is the sort of thing the binary could settle if it ever
mattered (see the `bf1942-mod-extraction` skill §9), but it does not: those
eight capsules are the *hitbox*, the thing a bullet tests against, with
materials 40 (head), 41 (chest) and 42 (limbs) resolving through
`damage.json`'s tables. They are not what stops a soldier walking into a wall.

**Nothing in vanilla declares a step height, a slope limit, a movement capsule
radius or a ground friction for the player.** `grep -iE
"gravity|slope|stepheight|friction|climb|ladder"` across every `.con` in
`Bf1942/Game.rfa` returns **zero** live lines. The only ground-property knob
anywhere is `materialFriction` in `materialManagerdefine.con`, declared for the
20 base materials only — water 0.1, grass 0.8, dry dirt and default 1.0 — and
it reads as a physics-response term for sliding bodies rather than a walk-speed
scalar.

So the soldier's movement collider is **ours to choose**, and the data gives us
sizes rather than rules. Measured from the posed 3P body skin (US soldier,
No4, `Lb_*`+`Ub_*` frame 0):

| stance | body bbox, width × depth × height (m) | helmet bone `A` height |
|---|---|---|
| standing | 0.62 × 0.82 × 1.65 | 1.754 |
| crouching | 0.70 × 1.09 × 1.10 | 1.194 |
| prone | 0.72 × **2.14** × 0.45 | 0.420 |

(Body skin only — the head and hands are separate meshes, which is why the
standing height stops 10 cm below the helmet bone. The prone depth of 2.14 m is
the outstretched figure including the forward arm.)

So: a vertical capsule of roughly **0.3 m radius, 1.8 m tall standing and 1.3 m
crouched**, and prone is not a vertical capsule at all — it is a ~0.45 m tall
volume 2.1 m long, which for a viewer is most cheaply a short capsule plus a
"you cannot crawl forward into that" test. Step-up height and slope limit are
inventions; say so where they land, the way `camera-modes.md` §1 says which of
its four camera modes are DICE's and which are ours.

*The shipped numbers moved slightly when the movement core was replaced, and
they now live in `physics.js` rather than here:* `BODY_RADIUS` 0.30,
`BODY_HEIGHT` 1.80 / 1.30 / 0.60, `STEP_HEIGHT` 0.45, `MAX_GROUND_SLOPE`
cos 60°. The heights are sized off the corrected eye heights (a man is about
0.15 m of skull above his eyes) rather than off the helmet bone, and the slope
limit is deliberately more permissive than the 45° this section's build chose,
because BF1942 infantry climb dunes no modern shooter would allow. All four are
still inventions and `physics.js` labels every one of them as such.

`collision.js` gives you everything needed to enforce it:
`WorldCollider.surfaceHeight(x, z)` for the floor,
`WorldCollider.cast(ox,oy,oz, dx,dy,dz, maxDist, skipOwner)` for a swept
segment against water / terrain / hulls at 1.2–2.1 µs,
`WorldCollider.sweepSphere(...)` for the fat query a *body* wants, and
`Heightfield.normal(x, z, out)` for the slope under your feet — a
central-difference normal at the same one-cell resolution the collider works
at. A capsule is three to five casts per frame against a budget that already
absorbs 192. (That estimate was wrong for the ray-ring sweep this section's
build used — eleven — and right for the swept-sphere one that replaced it:
**four**.)

### 2.5 Spawning

`spawn-points.md` covers the data model in full; three things it does not, all
measured here.

**Spawn points sit on the ground.** Comparing every soldier spawn's `y` against
the level's own decoded `Heightmap.raw`:

| level | n | median delta | p25 / p75 |
|---|---|---|---|
| Bocage | 32 | **−0.001 m** | −0.097 / +0.020 |
| El Alamein | 29 | **−0.001 m** | −0.001 / −0.001 |
| Berlin | 28 | +0.070 m | −0.001 / +0.255 |
| Wake | 17 | +0.285 m | +0.206 / +0.338 |
| Omaha Beach | 28 | +0.431 m | +0.100 / +1.355 |

Bocage and El Alamein are exactly on the lattice; Wake and Omaha are elevated
because their spawns sit on decks, bunker roofs and the Atlantic Wall, which the
heightfield does not know about. So: **place the soldier's feet at the spawn
point and clamp with `surfaceHeight`, but let the hull collider win where it is
higher.**

**The team is already resolved in `scene.json`.** `level.py:701 team_of_group`
matches a `SpawnPoint.setGroup` against a `ControlPoint.spawnGroupId` and takes
that flag's declared `team`; `extract_map.py:1273` emits it. Coverage across the
22 extracted vanilla maps is good but not total:

```
bocage     n=32  teams={1:6, 2:7, 0:19}   groups=[1,2,6,7,8]
wake       n=17  teams={2:17}             groups=[1,2,3,4,5]
gazala     n=49  teams={1:15, 2:14, 0:14, None:6}
midway     n=15  teams={0:15}             groups=[3,4]
```

`team: 0` is a neutral flag at map start, `null` a group no control point
claims (usually a `spawnPointManager.group` from `GlobalSpawnGroups.con` — the
carrier and battleship groups 64–83). For a deterministic flythrough spawn,
pick a group whose control point declares `unableToChangeTeam 1` — that is the
uncapturable HQ, and on Bocage it is group 1 (`AXISBASE_Cpoint`, team 1) and
group 2 (`ALLIESBase_Cpoint`, team 2).

**`setSpawnAsParaTroper` is declared 489 times across vanilla and is live 43 of
them** — those drop you in mid-air under a chute. Corrected during the build,
because the raw occurrence count is the wrong unit three times over: 446 of the
489 are an explicit `0`; the 43 live ones are Market Garden 36, Liberation of
Caen 6 and Coral Sea 1; and of those, Caen's six are on an
`Objects/ParaTrooperSpawnObject` template rather than a `SpawnPoint`, while
Market Garden's 36 are the same 12 templates repeated across its Conquest,
SinglePlayer and TDM directories. **In the Conquest data the extractor actually
reads it is 13 — 12 on Market Garden and 1 on Coral Sea** (and Coral Sea places
no soldier spawns in Conquest at all, so the count that can ever reach a player
is 12, all on one map). Filter them out of a spawn pick anyway, or the first
thing a Market Garden visitor experiences is a fall.

**The kit wiring, for when it is no longer deferred**, is four lines of
`Init.con` per level:

```con
game.setTeamSkin 1 GermanSoldier
game.setKit 1 0 German_Scout      game.setKit 1 1 German_Assault
game.setKit 1 2 German_AT         game.setKit 1 3 German_Medic
game.setKit 1 4 German_Engineer
game.setTeamSkin 2 USSoldier
game.setKit 2 0 US_Scout          ...
```

`(team, slot 0..4) -> Kit`, last write wins (the rule
`parity-audit/infantry-gameplay.md` GAP 1.2 established against
Liberation_of_Caen). `viewer/models/kits.json` already carries every kit's
nation, class, worn meshes and pickup mesh; what is missing is only the
per-level binding, which is one regex over `Init.con` in `extract_map.py` and
five more keys in `scene.json`. That is the whole of "wiring kits later".

### 2.6 Animation in first person

**Every upper-body state declares two clips: the 3P one and the 1P one.**
`animations/AnimationStatesJump.con`:

```con
AnimationStateMachine.createState Ub_StandJumpThompson
AnimationStateMachine.setOtherState c_AsmFaceState FaceFire1
AnimationStateMachine.addAnimation Animations/StandWalkRun/3p/Thompson/3pJumpStandUpperThompson.baf 0.8 0
AnimationStateMachine.addAnimation Animations/StandWalkRun/1p/Thompson/1pRunThompson.baf 0.4 1
AnimationStateMachine.addTransitionWhenDone Ub_StandAimThompson
include copyToallWeapons.inc Thompson
```

379 of the 1,154 `.baf` clips are 1P. **They carry 52 bones — the spine chain,
neck, head, both arms and every finger — and no pelvis and no legs**, rooted at
`Bip01 Spine` (translation exactly `0/0/0` on the stand/aim/fire/reload/idle
families) or `Bip01 Spine1` (`0.1257/-0.0001/0` on run and crawl). That is why
you never see your own legs: there is no 1P leg mesh and no 1P leg track.

**A reload is three clips at once.** The upper-body state also names a weapon
state through `setOtherState c_AsmWeaponState`, which plays a clip on the
*weapon's own* skeleton:

```con
AnimationStateMachine.createState Ub_StandReloadThompson
AnimationStateMachine.setOtherState c_AsmWeaponState WeaponReloadThompson
AnimationStateMachine.addAnimation .../3p/Thompson/3PReloadThompson.baf 0.4 c_AsmPlayOnce
AnimationStateMachine.addAnimation .../1p/Thompson/1PReloadThompson.baf 0.4 c_AsmPlayOnce
...
AnimationStateMachine.createState WeaponReloadThompson
AnimationStateMachine.addAnimation Animations/Weapons/Thompson/ThompsonReload.baf 0.4 c_AsmPlayOnce
```

`ThompsonReload.baf` is 181 frames against the Thompson's `trigger` / `block` /
`load` / `mag` / `clip` bones — the same bones `No4Complex` already binds parts
to via `bindToSkeletonPart`. So the moving magazine is already rigged in the
exported weapon glb.

**Per-state playback rates are a data table, and it is large.**
`3pAnimationsTweaking.con` (88,207 B) and `1pAnimationsTweaking.con` (73,510 B)
carry `set3pAnimationSpeed` / `set1pAnimationSpeed` per state per weapon;
`MiscAnimationsTweaking.con` (4,417 B) does the weapon channel. A sample:

| state | 3P speed | 1P speed |
|---|---|---|
| `Ub_StandAimNo4` | 0.80 | **0.10** |
| `Ub_RunForwardNo4` | 1.60 | 1.54 |
| `Ub_StandReloadNo4` | 0.52 | 0.60 |
| `Ub_FireThompson` | 2.00 | **10.00** |
| `WeaponReloadNo4` | 0.60 | — |

The 0.1 on every weapon's 1P `StandAim` is the answer to "what plays when you
are just standing there": **the aim clip at a tenth speed** — a slow breathing
sway. `addIdle` then drops in `Ub_Idle<W>1/2/3` one-shots (71-frame
`1pIdle1No4` and friends) after a dwell.

**View bob is data, not invention.** The locomotion states carry camera shake:

```con
rem Lb_WalkForward                       rem Lb_RunForward
setCameraShakeYaw       0 0.10 3.0        0 0.15 8.0
setCameraShakeUpDown    0 0.06 7          0 0.08 15
setCameraShakeLeftRight 0 0.01 0.5        0 0.02 5
setCameraShakeFadeIn    0 0.6             0 0.6
```

Three arguments, and all three have since been read out of the binary — see
§6c. Briefly: the first is a **slot index** (a state may chain three shakes;
vanilla always uses 0), the second is an amplitude, and the third is an
**angular rate in radians per second**, because it is the multiplier on seconds
inside the engine's own `sin()`. `AnimationStatesCameraShakes.con` is 15,906 B
more of the same for every weapon's fire state and for `BigExplosion` /
`SmallExplosion` / `HitShake` / `DieShake`.

The sting is also in §12: the engine multiplies the *locomotion* half of this
by `cameraShakeFactor`, which ships as zero. The weapon-fire and explosion
shakes are unaffected, and those are the ones worth having.

**The repo's own parser already reads the 1P half.** `bf42/animstates.py:57`
`ClipRef.is_first_person` discriminates on a `/1p/` path segment, and
`_copy_latest` already honours `donor_1p` in the six-argument `copyState`. What
is missing is a `clip_1p()` accessor beside `clip_3p()` — two lines. Measured
against the parsed machine (1,458 states):

| state family | weapons with a 1P clip |
|---|---|
| `Ub_StandAim<W>` | **28 / 28** |
| `Ub_Crouch<W>` | **28 / 28** |
| `Ub_Lie<W>` | **28 / 28** |
| `Ub_RunForward<W>` | **28 / 28** |
| `Ub_StandReload<W>` | **28 / 28** |
| `Ub_Fire<W>` | 26 / 28 (the two knives use `Ub_FireKnife*A..E` variants) |

### 2.7 What it takes to fire

Confirmed: `fireArms` is `[]` in every hand-weapon report. The cause is one
string, at `bf42/assemble.py:1675`:

```python
if template.kind.lower() == "firearms" and template.projectile_template:
```

A hand weapon's kind is `HandFireArms`. Nothing else about the path is
hand-weapon-hostile.

And the muzzle node **already ships**. `No4.glb`'s node list contains
`e_MuzzGun` at translation `[0.0, 0.045, -0.745]` (glTF, Z negated from the
authored `0/0.045/0.745`) with `em_MuzzGun` and `em_MuzzGun_glow` beneath it;
`Thompson.glb` has `e_MuzzThomp` at `[-0.004, 0.08, -0.38]`; `Colt.glb` has
`e_MuzzGun` at `[0.0, 0.001, -0.14]`. 25 of 28 weapons declare a muzzle or
rocket-exhaust effect child with an authored offset; the three that do not
(`Detonator`, `MedPack`, `RepairPack`) have no projectile either.

What `gunfire.js` needs is narrow: a node carrying `userData.fireArms`
(`gunfire.js:297`) and a descendant carrying `userData.muzzle`
(`gunfire.js:305`). Both are produced by `_fire_arms`. So the change is (a) let
the test accept `handfirearms`, (b) let the muzzle position come from the
`e_Muzz*` child's offset rather than only from `projectilePosition`.

**But for a first-person soldier the muzzle position barely matters**, and this
is the part the audit missed. All 25 hand weapons that fire anything declare
`fireInCameraDof 1`, and 24 of them put the spawn point at the weapon origin:

```con
ObjectTemplate.projectilePosition 0/0/0
ObjectTemplate.fireInCameraDof 1
```

(the `Binoculars` is the one exception, at `0/0/2`). The round is spawned on the
camera's line of fire, not the barrel's. That is why a BF1942 rifle hits what
the crosshair covers regardless of where the model's muzzle happens to point,
and it means a first-person shot is `collider.cast(cameraPos, cameraForward,
range)` — which `collision.js` already does, at 1.2–2.1 µs. The `e_Muzz*`
offset is where the *flash* is drawn, nothing more. `fireInCameraDof` is parsed
by nothing (`grep -ric fireInCameraDof bf42/ *.py` → 0).

Spread and recoil are fully authored and fully unparsed, in two different
vocabularies. The rifle/SMG family (`No4`, `K98`, `Thompson`, …) uses
`setMinDev` / `setFireDev` / `setDevMod` / `setTurnDev` / `setSpeedDev` /
`setMiscDev`; the AT/explosive family (`Bazooka`, `Panzershreck`) uses
`minDeviation` / `maxDeviation` / `minDevStanding|Crouching|Lying` /
`subDevStanding|…` / `addDevWalk|Run|Jump|Yaw|Pitch|Strafe` / `addDevFire` /
`subDev`. The second set is the one worth having for an on-foot mode, because
it is explicitly stance- and motion-aware. The Bazooka, in full:

```con
ObjectTemplate.minDeviation 0        ObjectTemplate.maxDeviation 0.5
ObjectTemplate.minDevStanding  0.2   ObjectTemplate.subDevStanding  0.03
ObjectTemplate.minDevCrouching 0.1   ObjectTemplate.subDevCrouching 0.05
ObjectTemplate.minDevLying     0.05  ObjectTemplate.subDevLying     0.025
ObjectTemplate.addDevWalk 0.01  ObjectTemplate.addDevRun 0.02  ObjectTemplate.addDevJump 0.05
ObjectTemplate.addDevYaw  0.02  ObjectTemplate.addDevPitch 0.02  ObjectTemplate.addDevStrafe 0.01
ObjectTemplate.addDevFire 0.08  ObjectTemplate.subDev 0.01
```

Crouching halves the floor, going prone halves it again, and moving adds to it
— the game saying in data why you should get down.

---

## 3. What we already have

Verified against this working tree, not taken from the audit.

| need | state |
|---|---|
| swept world collision | **DONE.** `viewer/collision.js`: `WorldCollider.cast` against water / terrain heightfield / static hulls, 1.2–2.1 µs, owner-skipping, material ids out. Bocage 427 nodes / 21,661 tris / 51 materials. |
| ground height | **DONE.** `collider.surfaceHeight(x,z)`, bilinear off the level's own 512² @ 4 m lattice, rebuilt from the terrain tiles at load. `map.html:626 groundHeight()` already delegates to it. |
| slope under your feet | **DONE.** `Heightfield.normal(x,z,out)`, central difference at one cell. |
| surface material under your feet | **DONE.** `Heightfield.material(x,z)`, nearest-sampled off `terrain/materials.png`. |
| camera already clamped to the ground | **PARTIAL.** `map.html:665 clampAltitude()` holds the free-fly camera at `groundHeight + 1.5`, unconditionally, with no body and no walls. |
| posed soldier holding any weapon | **DONE.** 224 `.pose.glb` (8 soldiers × 28 weapons), three stances each, right palm median 2.6 cm. `USSoldier__No4.pose.glb` is 1.12 MB. |
| kit parts | **DONE.** `viewer/models/kits.json`, 35 kits / 77 worn meshes for vanilla, grafted at `A` / `backpack` / `HipPack`. |
| spawn points with team and group | **DONE.** `scene.json.soldierSpawns`, 32 on Bocage, team resolved through `spawnGroupId`. |
| firing runtime | **DONE for vehicles.** `viewer/gunfire.js` — tracers, flash curves, recoil ease, gravity, rocket motors, collider-aware impacts. |
| first-person camera + input shape | **DONE for vehicles.** `flight.js` `VehicleCamera`, four modes, clamps read from the `.con`, C to cycle. Reuse the shape. |
| 1P animation clip resolution | ~~ALMOST~~ **DONE.** `animstates.py` now carries `clip_1p()` beside `clip_3p()`, and parses `setOtherState c_AsmWeaponState` into `State.weapon_state`. §11. |
| **1P soldier geometry export** | ~~BLOCKED~~ **SHIPPED.** `extract_viewmodel.py` walks the children directly, which is the §4.1 alternative. §11. |
| `fireArms` on hand weapons | **BLOCKED on one string.** §2.7. |

---

## 4. Four corrections to `parity-audit/infantry-gameplay.md`

**4.1 GAP 1.6's suggested route does not work.** The audit says 1P extraction is
"**S** to extract (`extract_pose.py --first-person` reusing the cockpit path)".
The cockpit path cannot reach a soldier:

```
reaches_first_person(library, 'Corsair')   -> True
reaches_first_person(library, 'USSoldier') -> False
reaches_first_person(library, 'USSoldier1PBody') -> True
```

and `python3 extract_models.py USSoldier --cockpit` silently produces no
`.cockpit.glb`. The reason is that there are **two** gates, not one, and
`Assembler(first_person=True)` inverts only the second:

- `bf42/con.py:285` — `instance_template_name` returns `None` for any child
  with `first_person_part not in (None, 0)`. The 1P body and both 1P hands are
  erased at the *reference* level, before `geometry_is_first_person` ever sees
  a geometry name.
- `bf42/assemble.py:41` — `geometry_is_first_person` then skips `1P*` geometry.

So the 1P soldier export needs `instance_template_name` to take a
`first_person` flag (or the caller to walk `template.children` directly). Still
small, but it is a different line than the audit names.

Same rule has a second casualty: `SoldierCamera` is added with
`setIsFirstPersonPart 2` — **the only `2` in vanilla**, against 40 zeros and 24
ones — so it too is dropped, and `USSoldier.report.json` reports `cameras: []`.
The one node that would carry the eye point is filtered out.

**4.2 "Movement speed is in `Objects/Soldiers/Common/AI/Objects.con`:
`aiTemplatePlugIn.maxSpeed 5.0`" is wrong.** It is the AI's planning speed. The
Hanomag declares the same 5.0; vanilla fighters declare 60 (216 km/h, well under
their in-game speed). ~~The real figure has to be derived from the footstep
clock and the stride (§2.3), which lands at 2.28 m/s.~~ The real figure is 6 m/s
and it is hardcoded in the executable (§6b); `maxSpeed 5.0` is still not it, but
it was a great deal closer than this document's derivation.

**4.3 "No hand weapon has a muzzle node" is half wrong.** The muzzle *node* is
in every armed hand weapon's glb already, at the authored offset, with its
emitters attached. What is absent is the `fireArms` extras block, because
`assemble.py` tests for kind `firearms` and a hand weapon is `HandFireArms`.
And because all 25 armed ones set `fireInCameraDof 1` (24 of them with
`projectilePosition 0/0/0`), a first-person shot should come from the camera
anyway.

**4.4 GAP 3.2's dependency chain is stale.** The audit ranks "export + index
level collision" as size **L** and blocking, and ranks importing `aiMeshes.rfa`
as the cheap route to it. Both are superseded: collision ships from the real
`.sm` hulls, is indexed by a uniform grid, and is measured. Everything that
depended on GAP 3.2 is now unblocked.

---

## 5. The shortest path, staged

Each stage is shippable on its own and each leaves the viewer better than it
found it. Sizes use the repo's S/M/L.

### Stage 1 — Boots on the ground

> Shipped, then rebuilt on `physics.js`. The plan below is the original and its
> movement numbers are superseded; §6a records what was built from it and §6b
> what replaced them.

**What ships:** a mode toggle in `map.html` beside `pilot the plane` that drops
the camera to a soldier's eye height at a real team spawn point and makes the
world solid. No body, no weapon, no animation.

**Not a third-person mode first.** The brief asks whether "walk around as a
soldier you can see" is a cheaper stepping stone. It is not: it needs a
`.pose.glb` loaded and disposed per level, the three stance clips crossfaded, a
chase camera that has to frame a body against terrain, and a figure whose feet
have to visibly meet the ground — all of which stage 1 skips entirely, and none
of which advances the first-person camera. It is *cheaper after* stage 2, not
before (see stage 5).

- Spawn: pick a `soldierSpawns` entry whose `team` matches a chosen side and
  whose control point is `unableToChangeTeam` if one exists; skip the
  paratrooper ones; face the authored `rotation[0]` yaw.
- Eye at ground + **1.56 m**, crouch (hold Ctrl) 1.03, prone (Z) 0.21, with the
  transitions eased rather than snapped.
- Speeds 2.28 / 1.08 / 1.58 / 0.69 m/s per §2.3; W/S forward-back, A/D strafe,
  mouse turns the body, Shift walks, Space jumps against 9.81.
- Pitch clamped to ±38° standing and crouched, to the narrow prone band lying.
- FOV 54°, not the page's current default.
- Walls: a 0.31 m radius, 1.75 m capsule (§2.4). Per frame, cast the horizontal move
  as a segment and slide along the hit normal; cast down for the floor; cast up
  for head clearance; allow a 0.4 m step-up and refuse slopes past ~45°
  (`Heightfield.normal` gives the slope directly). Three to five
  `WorldCollider.cast` calls per frame against a budget that already carries
  192.
- View bob straight from `setCameraShakeUpDown` / `Yaw` / `LeftRight` on
  `Lb_WalkForward` / `Lb_RunForward`, with the declared 0.6 s fade-in. (Two
  errors here, both settled in §6c: the fade is a *rate*, so 0.6 is a 1.67 s
  ramp; and the engine multiplies the whole locomotion shake by a
  `cameraShakeFactor` that ships as zero, so there is no bob to take.)

**Why this first, and why it is worth shipping alone:** it is the whole
experience minus the props. Standing in Bocage's bunker at eye height, walking
to the hedgerow and being stopped by it, is the moment the extraction stops
being a model browser. And everything it needs already exists — the collider,
the heightfield, the spawn list, the input capture. **Nothing has to be
re-extracted.**

**Cost: M**, and entirely inside `viewer/map.html` plus a new
`viewer/soldier.js` (the `flight.js` shape: the movement and capsule logic in a
module that takes an injected `collider`, the page only feeding it `dt` and
taking a pose). No Python, no new assets.

**The one risk:** the derived speeds and the capsule are ours. Put them in one
labelled constant block with the derivation in a comment, the way
`camera-modes.md` §6b labels its six chase-camera numbers.

### Stage 2 — The weapon in your hands

**What ships:** a `.fp.glb` per (soldier, weapon) — 1P body, 1P hands, the
weapon welded at `Bip01 R Hand` exactly as today — grafted to the stage-1
camera, with `soldierCameraPosition` applied per weapon.

- `bf42/con.py` — `instance_template_name` gains a `first_person` mode so the
  three 1P children survive (§4.1). One flag, threaded from `extract_pose.py`.
- `extract_pose.py --first-person` — same skeleton, same clips, swap the four
  3P parts for the three 1P ones. `bf42/skin.py` already reads
  `1PUSbody.skn` / `1pUSRightHand.skn` / `1pUSLeftHand.skn`; the weld is
  unchanged because the hand joint is unchanged.
- Pose it with the **1P** upper clip rather than the 3P one:
  `animstates.py` gains `clip_1p()` beside `clip_3p()` (two lines), and
  `1PStandAimNo4.baf` resolves for 28/28 weapons.
- The viewer parents the result to the camera at
  `camera + (-0.12, -1.56, 0.1)` in the camera's frame — i.e. draw the rig with
  its feet at the soldier's feet — plus the weapon's own
  `soldierCameraPosition` nudge, and renders it on a near-clip layer so it never
  intersects the world.

**Cost: M.** Payload is 885 KB of source mesh for all 8 nations; output is one
file per pair you choose to ship, and stage 2 only needs the default kit's
weapon per nation (5 classes × 8 soldiers = 40 files at most, and the fixed
default kit means **one**).

**What it buys:** the actual ask. Weapon drawn and visible, in the correct
hands, at the game's own offsets.

### Stage 3 — It moves and it sounds right

- **Bake real clips.** `bf42/baf.py` already exposes `Animation.frames` and
  `local_pose(frame)`; `extract_pose.py` samples frame 0 only
  (`extract_pose.py:633`). Bake N frames into a glTF animation for the 1P
  families that matter: `1PStandAim<W>` at its declared 0.1 speed (the idle
  sway), `1pRun<W>`, `1PFire<W>`, `1pReload<W>`. The per-state rates come from
  the tweaking tables, which `animstates.py` already replays.
- **The weapon's own clip.** `WeaponReload<W>` / `WeaponFire<W>` drive the
  bolt, magazine and trigger bones the exported weapon already binds parts to.
  Three channels, one mixer.
- **Footsteps.** `Objects/Soldiers/Common/Sounds/MaterialToSound.con` maps
  material ids onto sound families — terrain 0–15 to Grass / Water / Gravel /
  Mud / Frozen / Sand / Concrete, hull materials 38–100+ to Mud / Metal / Wood.
  `collision.js` already returns exactly those ids for both terrain and hulls,
  the `.ssc` player shipped in `69b095d`, and the step clock is
  `setRunFrequency 0.36` / `setWalkFrequency 0.66`. Only the samples need
  extracting: the run / walk / crouch / crawl / jump / land / stop scripts name
  **81 distinct `.wav` files** (`SOWASAND1..4`, `SORUNGRASS1..3`, `SORUNMTL1..4`,
  `SOWAICE1..4`, `SOCRAWL1..6`, `SOSTOP*` …) and **all 81 are present** in
  `sound.rfa` / `sound_001.rfa` — as are all 165 named by the full soldier
  `.ssc` set, radio voice included.

**Cost: M for the clips, S for the footsteps**, and the footsteps are the best
ratio in this document — the material query is free, the mapping table is 5 KB,
nothing is missing from the archives, and nothing says "I am standing in a
level" like the ground changing under you.

### Stage 4 — Firing

- `assemble.py` accepts `handfirearms` and takes the muzzle from the `e_Muzz*`
  child (§2.7). One conditional, one lookup.
- Fire from the camera, per `fireInCameraDof 1`, through the collider that
  already resolves a material and an impact bundle.
- `con.py` picks up the deviation and recoil families; the stance-aware set
  (`minDevStanding/Crouching/Lying`, `addDevRun/Walk/Jump`) is the one that
  makes crouching mean something.

**Cost: S–M**, and it rides entirely on `gunfire.js`.

### Stage 5 — Optional, and cheap because of stage 2

- **Third-person soldier.** Once the camera rig exists, a `C` key that pulls
  back to the existing `.pose.glb` is nearly free — `VehicleCamera`'s chase
  mode is already written and already solves the roll-free follow frame. It is
  *not* a cheaper first step: it needs the pose glb loaded, the stance clips
  blended and a visible body that has to look right against the ground, all of
  which stage 1 skips entirely.
- **Kits.** Parse `game.setKit` / `game.setTeamSkin` out of `Init.con` into
  `scene.json` (five keys), join against the shipped `kits.json`, and the
  spawn screen becomes real. §2.5.

---

## 6. Cost summary

| stage | scope | new assets | files touched | size |
|---|---|---|---|---|
| 1 — on the ground | viewer only | none | `map.html`, new `viewer/soldier.js` | **M** |
| 2 — the viewmodel | extractor + viewer | 1 `.fp.glb` for a fixed kit (885 KB of source mesh covers all 8 nations) | `con.py`, `animstates.py`, `extract_pose.py`, `soldier.js` | **M** |
| 3a — real 1P clips | extractor + viewer | grows the `.fp.glb` | `extract_pose.py` | **M** |
| 3b — footsteps | extractor + viewer | ~40 `.wav` | `extract_map.py` or a new step, `soldier.js` | **S** |
| 4 — firing | extractor + viewer | none | `assemble.py`, `con.py`, `soldier.js` | **S–M** |
| 5 — third person, kits | viewer + extractor | none | `map.html`, `extract_map.py` | **S** each |

---

## 6a. Stage 1, as first built — a historical record

> **This section describes a build that no longer exists.** It is kept because
> the bugs in it were real and the reasoning is worth keeping, but every
> movement number quoted below — the eye at 1.56, the speeds 2.28 / 1.08 / 1.58
> / 0.69, the 0.31 m capsule, the 0.43 m step, the 45° slope, the 9.81 gravity,
> the eleven casts a frame — has since been replaced. **§6b is the build that
> ships.** Do not copy a figure out of this section.

Shipped, then superseded. `viewer/soldier.js` (new, imports nothing),
`tests/test_soldier.py` + `tests/soldier_harness.mjs` (29 assertions, suite
401 -> 430), 175 lines in `viewer/map.html`, and `setSpawnAsParaTroper` through
`bf42/level.py` + `extract_map.py`.

### What the plan got right

| predicted | built |
|---|---|
| viewer-only, size M, nothing re-extracted | held — the only Python is the paratrooper flag, which is optional |
| eye 1.56 / 1.03 / 0.21 | exact, and measured back out of the running page |
| speeds 2.28 / 1.08 / 1.58 / 0.69 | exact, and Shift is the slow gait |
| pitch clamped +-38, FOV ~54 | 38.00 / -38.00 measured, FOV 53.86 |
| 0.31 m capsule sliding against `WorldCollider.cast` | held |
| bob from the declared `setCameraShake*` | amplitudes held; the *rate* did not — see below, and then §6c, which settled it and then took the bob away again |
| "three to five casts per frame" | **wrong: 11.** Nine sweep probes, one floor, one post-move step test |

### What the plan got wrong, and what the build had to change

**The bob's frequency term is not usable.** The amplitudes (`0.08` run, `0.06`
walk) are the game's and they are what ships. The third argument is not: read as
Hz, `15` against a 2.78 steps/s run cadence is five times too fast, and the
walk/run ratio it implies (7:15 = 2.14) does not match the step-rate ratio the
same archive declares (0.66:0.36 = 1.83). The phase now comes off the footstep
clock instead — which is unambiguous, is in the same file, and puts the bob in
step with the footstep audio stage 3 hangs on the same clock.

> **Superseded by §6c.** The reasoning above is sound and the conclusion is
> wrong. `15` is not five times too fast because it is not in Hz: it is radians
> per second, which is 2.39 Hz. Substituting the footstep clock ran the run bob
> at 5.56 Hz — 2.3x the engine's rate — and that is the "little bobble" a player
> reported the moment this landed on the corrected movement speeds.

**Stance transitions are data, which the plan did not notice.** The plan had an
invented ease constant. The state machine declares a clip *and a rate* for every
transition, so they are measurable: `Lb_StandToCrouch` 5 frames at 4x = 48 ms,
`Lb_CrouchToLie` 9 at 1.6x = 216 ms, `Lb_LieToStand` 9 at -3.0x = 115 ms. All
three now come from there. BF1942 drops prone in 48 ms and takes 115 ms to get
up, and that asymmetry is most of how going down and coming up feel.

**Step-up cannot live in the sweep.** The plan said "allow a 0.4 m step-up". The
first attempt put the lowest horizontal probe below the step height so it could
see a kerb — which also makes every slope past 31 degrees read as a wall, and
refuses terrain the slope limit explicitly allows. The probes now start *above*
the step height and see only walls; kerbs and slopes are settled afterwards by
one probe from head height against the floor you actually landed on. They are
two different questions and they needed two different tests.

**`STEP_UP` is 0.43, not 0.4, and it is derived.** The posed standing knee
(`Bip01 L Calf`) is at 0.547 m and the ankle at 0.121 m, so a foot rises 0.426 m
without the hip moving. Prone gets 0.12 m, which is ours and is only there
because crawling over a knee-high kerb is silly.

**45 degrees stayed, and stopped being a guess.** Sampled against each level's
own `Heightmap.raw` on its 4 m lattice, the fraction of cells at or under 45
degrees is Bocage 98.5%, Wake 98.7%, El Alamein 98.5%, Berlin 100%, Omaha Beach
96.9% — so it admits essentially all walkable ground and rejects Omaha's bluff
faces, which you cannot walk up in game either. Still ours; no longer arbitrary.

**`setSpawnAsParaTroper` needed correcting twice** — see §2.5. The viewer skips
them two ways: the flag where a level has been re-extracted, and an
altitude-over-terrain fallback where it has not, so no already-shipped map has
to be rebuilt.

### Four bugs the node harness caught that a browser would have hidden

Worth recording because they are the argument for the harness existing:

1. **The skin gap was subtracted from every move**, not only from a contact,
   scaling a run down 53% and stopping a walk dead. In a browser this reads as
   "feels a bit slow".
2. **`WorldCollider`'s terrain march bisects against `maxDist`**, so its
   precision is `maxDist / 256` — 2.3 m on the 600 m probe a spawn drop wants.
   That put a spawned soldier a fifth of a metre under his own feet and
   silently ate the first jump. `floorAt` now asks the two halves separately:
   hulls through the grid, ground and sea through `surfaceHeight`, no ray.
3. **A flat radius over-reserves on oblique contact** — a 45-degree approach
   stopped 0.39 m from a wall instead of 0.31, because the leading probe starts
   17 cm nearer and a radius along the diagonal is only 22 cm of plane
   clearance. Both terms are recoverable from the normal the collider already
   returns.
4. **Any surface within a step's height pulled the body up, every frame**, with
   no cause required — so standing still inside stacked geometry ratchets you
   onto the roof. Raising now has to be a step you walked onto or a surface you
   came down on. Tightening that broke landing, which the suite caught in the
   same run: the floor probe is now swept from wherever the feet were higher
   during the frame, because a probe starting where gravity just put you passes
   straight through the ground at fall speed.

### Verified in a browser

Headless Chromium (the vendored Playwright), SwiftShader, against the real
extracted Bocage — 21,661 collision triangles, heightfield 512^2 at 4 m. Driven
through the page's own paths: the checkbox, the flag `<select>`, real
`KeyboardEvent`s, and `window.__look` (which calls the same `lookDelta` a
pointer-lock `pointermove` calls). Readings come back through `window.__soldier()`.

| | measured |
|---|---|
| spawn | `2nd_Panzer_Division_HQ`, 5 flags found, feet exactly on the terrain, grounded |
| eye above feet | **1.5600** |
| FOV / near plane | 53.86 / 0.2 |
| one second of each gait | run **2.28 m**, walk **1.08**, crouch **1.58**, prone **0.69** |
| stance eye heights | stand **1.56**, crouch **1.03**, prone **0.21**, and 1.56 again both ways back |
| pitch clamp | **+38.00 / -38.00 degrees** |
| page errors | **none** |

**Forty runs, eight headings from each of the five flags, two seconds each.** A
clear run is 4.56 m. Three ended short against a hull (3.04 m, 4.50 m, 4.00 m)
and reported `blocked`; that is a lower bound, because `blocked` is sampled on
the final frame only, so a run that struck a wall and then slid clear of it
reads as unblocked. The feet tracked the terrain to **0.00 m on 39 of 40** runs
while the ground moved between -1.10 m and +1.54 m beneath them; the fortieth
ended 0.18 m above terrain, standing on a placed object, which is the hull floor
path working. None ended on water.

**Walking into a wall, photographed.** Spawned at `US_HQ` /
`alliesSpawnPoint_hangar2` — inside the hangar, facing a concrete wall — and
held W for three simulated seconds:

```
frame   0   x 1162.04  z -589.99  speed 2.28  blocked false
frame  40   x 1163.50  z -589.57  speed 2.28  blocked false
frame  80   x 1164.96  z -589.14  speed 2.28  blocked false
frame 100   x 1165.58  z -588.93  speed 0.65  blocked TRUE
frame 120   x 1165.58  z -588.71  speed 0.65  blocked TRUE
frame 160   x 1165.58  z -588.28  speed 0.65  blocked TRUE
```

**`x` freezes at 1165.58 and stays frozen for ninety frames while `z` keeps
advancing** — stopped dead by the wall and sliding along it at the parallel
component of his speed. 4.07 m covered of a possible 6.84. The screenshot shows
the wall filling the view with the 0.2 m near plane not clipping through it, and
holding Ctrl against it drops the eye to 1.03 m in place.

**What I could not verify visually.** The rest of the geometry cases — a 0.30 m
kerb climbed, a 0.80 m kerb refused, a 20-degree ramp walked up, a 60-degree
face refused, a 4 m ledge fallen off, a beam too low to stand under — are
asserted in `tests/test_soldier.py` against a world built for them, **not**
demonstrated in the browser. Bocage has no geometry at known heights to aim at,
and I did not go looking for a real kerb or cliff on it to photograph. The
browser run proves the integration and the wall; the harness proves the rest.

### Cost, measured

Eleven collider queries per frame: nine horizontal sweep probes, one floor
probe, one post-move step test. Two of the eleven resolve ground through
`surfaceHeight` without a ray, so the collider's own counter sees nine.

| | per frame |
|---|---|
| node harness, synthetic world (48 triangles) | **1.85 us** for the whole `step()` |
| Bocage, the collider's own accumulator over 1200 sim frames | 203.7 us |
| Bocage, batched 20,000 iterations of one frame's nine probes, through `__castRay` | 179 us |
| Bocage, the same batch straight at `collider.cast` — no wrapper, no allocation | **189 us** |

Three independent measurements inside 15% of each other, so this is not the
`performance.now()` granularity artefact `projectile-collision.md` ran into — it
is real time. It is also **1.1% of a 16.7 ms frame**, against a page spending
4.1 ms/frame on the SwiftShader render alone, so it is not close to being the
thing that limits this page.

Two honest caveats. The wrapper is not the cost: going straight at
`collider.cast` measured *slower* than going through `__castRay`, which puts
both inside the noise and means the ~21 us per cast is the grid query itself in
this environment. And the environment matters — headless CPU rasterisation with
the JIT under load. `projectile-collision.md` measured **1.23 us** per cast on
this same Bocage index under its own harness, which would put a frame at 11 us.
**This build did not reproduce that figure and does not claim it**; 189 us/frame
is what was measured here, and the gap between the two is unexplained.

---

## 6b. Stage 1, corrected: the soldier on `physics.js`

The build in §6a and a second, independent one were written in parallel on two
branches, and merging them is what produced the module that ships. The second
branch had decompiled the retail client's physics and had `viewer/physics.js`:
the engine's gravity, its integrator, its two hardcoded soldier speed tables and
a swept-sphere collision resolve. The first had everything §6a describes about
the *camera* — the FOV, the pitch clamp, the bob, the stance clip timings, the
footstep clock, spawning at a flag.

The merge kept both halves and threw away the overlap in one direction only:
**`physics.js` owns the motion, `soldier.js` owns the camera.** `soldier.js` no
longer declares a gravity, a speed, a jump impulse, a capsule or a collision
resolve; it imports all of them. There is exactly one of each in the tree.

### What was replaced, and by what

| §6a had | ships now | where it came from |
|---|---|---|
| `GRAVITY = 9.81` | **−14.73** | `BasicPhysicsSystem` ctor, `0x00578f00` |
| `SPEED = {run 2.28, walk 1.08, crouch 1.58, prone 0.69}` | **`directionalSpeed[6] = {6,4,2,2,1,1}`**, `strafeSpeed[3] = {4,2,1}`, `walkSpeedFactor` 1/3 | `0x009581b4` / `0x009581cc` / `0x009581d8`, indexed at `0x005013f8` |
| `JUMP_SPEED = 3.0`, derived from a clip length under 9.81 | **5.4, and labelled UNMEASURED** | chosen for a ~1 m apex under the real gravity |
| `EYE = {1.56, 1.03, 0.21}` | **{1.65, 1.12, 0.30}** | `setPoseCameraPos` + `setCharacterHeight -1.00` |
| a per-frame Euler step on the raw frame dt | **four sub-steps of dt/4, semi-implicit**, under a fixed 60 Hz accumulator | integrator at `0x00578aa0` |
| nine horizontal probe rays + a post-move step test | **one swept capsule (three spheres) + one downward ray** | `CollisionIndex.sweepSphere` |
| `refuseUnsteppable`, a second resolver running after the sweep | folded into `SoldierBody`'s own resolve | — |

### What of §6a survived untouched

All of the presentation layer, which is the half this document was always
strongest on: `FOV_DEG = 53.86` from `set1pFov 0.47`; `PITCH_LIMIT_DEG = 38`
from `setPointUpDownAngle`; the `BOB` amplitudes off `setCameraShake*` (the
*phase* did not survive — §6c); `STEP_PERIOD` from `SoldierSound.inc`; the
six `STANCE_TRANSITION` durations read off the animation clips; `spawnFlags` /
`pickSpawn` / `spawnYaw` and the paratrooper filtering; the "a soldier may only
be raised by a step he took or a landing" rule, which was a real fix and is now
`SoldierBody`'s. The stance *timings* are still `soldier.js`'s and are handed to
`SoldierBody.setPoseFlags` as a duration, so the easing has one implementation
and the durations have one source.

Also kept: the eye heights' **deltas**. Only the absolute moved, and only
because `setCharacterHeight -1.00` explains all three heights from one declared
line where `center1pHands`'s −1.56 explains one of them from a hand-rig offset.
Neither is proven. If the binary ever settles it, it settles one number.

### The one place the viewer knowingly disagrees with retail

`World::update` at `0x004b6cb0` passes the raw frame dt straight down with no
accumulator and no clamp anywhere below it, so retail integrates a different
trajectory at 30 fps than at 100. The viewer runs a fixed 60 Hz accumulator with
render interpolation instead, because the end goal is replaying captured rounds
and a recorded input stream has to land in the same place on any machine.
*Inside* a tick nothing diverges. This is the only deliberate divergence and
`physics.js`'s header states it.

### Measured, walking the real maps

Driven through the page's own paths on the extracted levels — the checkbox, the
flag `<select>`, the real key set, `window.__lookDelta` calling the same
`lookDelta` a pointer-lock `pointermove` calls — and read back through
`window.__soldier()`.

| | Wake | Berlin |
|---|---|---|
| one second of run | **6.00 m** | **6.00 m** |
| one second of backpedal | **4.00 m** | **4.00 m** |
| one second of strafe | **4.00 m** | — |
| Shift walk / crouch / prone | **2.00 / 2.00 / 1.00 m** | **2.00 m** crouch |
| eye above feet, standing | **1.65** | **1.65** |
| FOV / near plane | 53.86 / 0.2 | 53.86 / 0.2 |
| spawn at flag | 5 flags, feet exactly on the terrain | 4 flags, on a hull floor 0.23 m above it |

**The 6:4 pair is the tell.** No speed model derived from stride length can
produce it, because `directionalSpeed` is indexed
`pose * 2 + (forwardInput <= 0)` — *any* input that is not forward takes the
second slot, so standing still and walking backwards share a number. Measured
ratio 1.5000.

**The jump arc is the gravity test that needs no instrumentation.** Take-off at
5.4 m/s peaked at **0.974 m** and was airborne 41 frames. Under −14.73 the
closed form is 0.990 m (Euler at 60 Hz undershoots slightly); under 9.81 it
would be 1.486 m. The harness's 4 m ledge drop is the same test from the other
direction: **44 airborne frames** against a predicted 44.2 at −14.73 and 54 at
−9.81. There is no tolerance that covers both.

**Walls stop and slide rather than lifting.** Walking a bunker on Wake from
32 m out: 6.00 m/s all the way in with the feet *exactly* on the terrain every
sampled frame, then `contacts 1` and the speed falling to 3.5 m/s as the
along-wall component survives — and `y − ground` staying at **0.00**, which is
the thing that matters. The old resolver's failure mode was a wall normal's
small upward component turning forward motion into climb; grounded wall contacts
are now flattened before they are projected, so a wall can only ever redirect
sideways.

**Building interiors are walkable.** The near-LOD interior meshes are in the
collider, so a soldier walked in through the doorway of a `pacificfarm1` hut on
Wake's airfield and stood on its floor: 14 of 24 bearings at eye height report a
wall inside 1.2–1.8 m, the rest are the open veranda side, and he is grounded
with the feet on the floor and the roof beams overhead in view.

**Cost fell rather than rose.** Four collider queries per frame against §6a's
eleven — three sphere sweeps for the capsule on an unobstructed pass, plus the
one downward ray that finds the floor; a blocked frame pays for extra slide
passes and tops out at thirteen. Being cheaper was not the goal and is not the
argument; having one resolver is.

### Tests

`tests/test_soldier.py` is 32 assertions over `soldier_harness.mjs`, and
`tests/test_physics.py` is 34 over `physics_harness.mjs`. They overlap on
purpose: the physics suite asserts the constants at the source, and the soldier
suite re-asserts the movement numbers *through the presentation layer*, because
a presentation layer is exactly the thing that can quietly reintroduce a speed
of its own. The harness's synthetic world had to change in three places — the
steep face went from 60° to 70° because `MAX_GROUND_SLOPE` is now cos 60° and a
60° face sits exactly on the boundary; and two runs had to be shortened, because
a soldier covers 2.6x the ground he used to and both walked clean off the test
geometry they were aimed at. Full suite 529.

---

## 6c. The view bob, settled in the binary — and then removed

A player walking Wake in first person reported that "walking has degraded since
merging to main… now it has this little bobble." It had. The merge put §6a's
presentation layer, whose bob phase came off the footstep clock, on top of
§6b's corrected movement speeds — and the bob had never been calibrated against
a body that moves at the engine's 6 m/s rather than the derivation's 2.28.

The open question was the third argument of `setCameraShakeUpDown 0 0.08 15`,
which §6a could not pin down and substituted a guess for. It is answerable, and
the answer changes the outcome twice over.

### What `getCameraShakeTransform` actually computes

`0x00613e90` in the client;
`dice::anim::AnimationStateMachineInstance::getCameraShakeTransform(Mat4&, float, float)`
at `0x0832b6c0` in the Linux dedicated server, which is where the name comes
from. Per channel, per frame:

```
value = amplitude * sin(rate * t) * fade * cameraShakeFactor
```

`t` is a seconds accumulator the same function advances with `t += dt`. Six
`sin()` call sites, one per channel, each `fld [block+rate]; fmul [this+8];
call sin; fmul <amp*factor>`. That makes the third argument's unit mechanical
rather than interpretive: **it is an angular rate in radians per second**,
because it is the multiplier on seconds inside a sine. 15 rad/s is 2.39 Hz.

Four more things fell out of the same read:

- **The first argument is a slot index**, clamped 0..2. A state may chain three
  shakes, each with its own `timeToShake` and `fadeOut`; the engine advances to
  the next as one expires. All of vanilla uses slot 0, which is why it looked
  like a constant.
- **`fadeIn` and `fadeOut` are rates per second, not durations.**
  `fade += fadeIn * dt` clamped to 1. `setCameraShakeFadeIn 0 0.6` is a 1.67 s
  ramp, not a 0.6 s one. `fadeIn <= 0` snaps straight to full.
- **Channels map to a transform, and the rotations are degrees.** `UpDown` →
  translate Y, `LeftRight` → translate X, `InOut` → translate Z; `Pitch`/`Yaw`/
  `Roll` → `setRotateXDeg`/`YDeg`/`ZDeg`.
- **Nothing scales by ground speed.** `BFSoldier::updateCameraShake`
  (`0x004facd0`) passes its `dt` straight down. The gait's only job is to choose
  which animation state is current.

And the data is richer than the two states §6a quoted. Crouching and lying
declare a vertical bob and **nothing else** — no sway, no yaw — where §6a had
invented both for them:

| state | `UpDown` | `LeftRight` | `Yaw` | `FadeIn` |
|---|---|---|---|---|
| `Lb_WalkForward` / `Backward` | 0.06 @ 7 | 0.01 @ 0.5 | 0.10 @ 3.0 | 0.6 |
| `Lb_RunForward` / `Backward` / `Strafe*` | 0.08 @ 15 | 0.02 @ 5 | 0.15 @ 8.0 | 0.6 |
| `Lb_CrouchForward` / `Backward` | 0.07 @ 10.0 | — | — | 0.3 |
| `Lb_LieForward` / `Backward` / `Strafe*` | 0.04 @ 5.0 | — | — | 0.3 |

Backpedalling and strafing declaring *exactly* the run's numbers, at two-thirds
the run's speed, is the data agreeing with the code: there is no speed term.

### The sting: it is multiplied by a shipped zero

A `BFSoldier` holds four `AnimationStateMachineInstance`s (68 bytes each from
`+0x294` in the server build; 0 lower body, 1 upper body, 2 camera-shake
triggers, the last proven by `triggerCameraShake`; the fourth takes no part
here). `updateCameraShake` composes the first three — and passes a hardcoded `1.0f` to the upper body and the
trigger machine, but `cameraShakeFactor` to the **lower** body. The lower body
is where every `Lb_Walk`/`Run`/`Crouch`/`Lie` state lives. It is the entire
walking view bob.

`cameraShakeFactor` is `DAT_0099000c`, a `PlayerControlObjectTemplate` console
property. It sits in BF1942.exe's `.data`, past the section's raw bytes (they
end at `0x00960000`), so the loader zero-fills it: `0.0f` at start-up. No static
initialiser writes it; its only writers are the
console accessor behind the registrar at `0x004f1310`. Every `.con`, `.inc` and
`.tweak` in `Objects.rfa`, `animations.rfa`, `Game.rfa` and `menu.rfa` was
searched, along with both `Settings/` trees. Nothing assigns it.

**Retail BF1942 has no first-person walking view bob.** The `Lb_*` shakes are
real, carefully authored, and inert. Weapon-fire (`Ub_*`) and explosion / hit /
death shakes are unaffected — those run at `1.0`.

This is the trap in reading `AnimationStatesLower.con` on its own, and §6a fell
into it in good faith: the data is sitting right there, it is obviously a view
bob, and it is obviously meant. It is also obviously switched off.

### What ships

`soldier.js` implements the engine's arithmetic exactly — per-channel
`amplitude * sin(rate * t) * fade`, `fade` climbing at `fadeIn` per second, no
speed term — and sets `CAMERA_SHAKE_FACTOR = 0`, the engine's value. A caller
that wants the bob sets `soldier.cameraShakeFactor`, which is what the console
property does, and gets the engine's real shape rather than an invention.

Two behaviours are the engine's rather than the obvious choice. A locomotion
shake does not fade *out*, because no `Lb_*` state declares
`setCameraShakeFadeOut`: stopping zeroes it on the spot. And changing gait
restarts the fade but not the clock, because `setCurrentState` (`0x006127f0`)
zeroes the fade factor and leaves the time accumulator alone — so the sine never
jumps mid-stride.

`STEP_PERIOD` stays, unchanged and still from `SoldierSound.inc`, but it is now
only the footstep clock. A stride and a camera shake turn out to be unrelated
clocks; tying them together was the bug.

### Measured, before and after

Driven headlessly through `Soldier` over a 40 s hold, sampling the last 30, with
rates taken off interpolated rising zero crossings. `still` is 0 everywhere in
both.

| gait | speed | before: vertical | after: vertical | declared |
|---|---|---|---|---|
| run | 6.00 | 0.080 m @ **5.556 Hz** | 0.080 m @ **2.387 Hz** | 15 rad/s = 2.387 Hz |
| walk | 2.00 | 0.060 m @ **3.030 Hz** | 0.060 m @ **1.114 Hz** | 7 rad/s = 1.114 Hz |
| crouch | 2.00 | 0.040 m @ 4.000 Hz | **0.070 m** @ 1.592 Hz | 10 rad/s = 1.592 Hz |
| prone | 1.00 | 0.020 m @ 3.333 Hz | **0.040 m** @ 0.796 Hz | 5 rad/s = 0.796 Hz |
| backpedal | 4.00 | 0.080 m @ 5.556 Hz | 0.080 m @ 2.387 Hz | run's, exactly |
| strafe | 4.00 | 0.080 m @ 5.556 Hz | 0.080 m @ 2.387 Hz | run's, exactly |

Every "after" rate matches its declaration to three decimals, in every channel,
including the walk's 0.5 rad/s sway at 0.080 Hz — a 12.6 s period, which is why
the measurement window is 30 s. The run's vertical bob was running at **2.33x**
the engine's rate. At 0.08 m amplitude that is the reported bobble.

And then, with `cameraShakeFactor` at the value the game ships: every number in
the "after" column is zero, which is the state the player was comparing against
when he said it used to be almost perfect.

Evidence is recorded in `features/bf1942-engine-reference/`: `symbols.json` rows
`0x00613e90`, `0x004facd0`, `0x0099000c`, `0x005dd6e0`, and `ledger.md` rows
CS-1 through CS-6.

---

## 7. What is still unknown

Named individually, because each is a separate piece of work and none of them
blocks stage 1.

Two entries that used to be on this list have since been **settled by the
binary** and are recorded here so nobody re-opens them: the **movement speeds**
(two float tables at `0x009581b4`) and **gravity** (−14.73, `0x00578f00`). See
§6b. A third — **the eye's absolute height** — is not settled and has merely
changed its preferred reading from 1.56 to 1.65; both are inferences off
`CommonSoldierData.inc` and the binary would settle it.

- **`set1pFov 0.47`'s units.** Both surviving readings land 50–54° vertical, so
  it does not matter for us, but it would matter for a mod with
  `vehicleFov 0.9091`. Settling it means the binary.
- **`setPointUpDownAngle` / `setLiePointUpDownAngle` / `setTurnLeftRightAngle`
  semantics.** The names say pitch and yaw clamps and the values are plausible
  as such (±38°; a narrow prone band; a 20°/14° torso-twist threshold), but
  nothing in data confirms whether they clamp the camera, the spine, or the
  angle at which the legs shuffle.
- **`soldierZoomFov` vs `zoomFov`.** 0.6 > 0.47 rules out "zoomed camera FOV"
  for the first (§2.1). The viewmodel-FOV reading is inference.
- **The `.baf` nominal frame rate — settled: there is none.** The engine
  advances a normalized phase by `dt × speed` and maps `frac(phase) × N`
  onto the frames (`AnimationStateMachineInstance::updateState` /
  `BoneAnimation::applyOnSkeleton`, both binaries, §11 third pass), so a
  clip cycle lasts `1/|speed|` seconds and the frame count never enters.
  The walk-vs-run "they cannot both be right" puzzle dissolves: the 1P walk
  plays `1pRun` at 0.5 (a 2.0 s stride cycle) and the run at its tweaked
  1.40 (0.71 s), whatever `setWalkFrequency` / `setRunFrequency` say about
  the footstep sounds.
- **Jump impulse, step-up height, slope limit, movement capsule radius.** None
  exist in vanilla data and none were found in the client either — the jump
  state (pose flag 0x80; its states carry sound trigger `c_SstJump` = 4) exists in the state machine at
  `0x005013f8` but only the flag is read there, and the impulse is not in either
  speed table nor in `CommonSoldierData.inc`. Ours to choose; `physics.js`
  labels all four. The jump is the one worth measuring and it is an evening's
  work in wine: time a flat-ground hop from leaving the floor to landing and
  read `v = |g| · t / 2`.
- **What field `+0x44` holds in the drag scale** at `0x00578990`, which
  multiplies velocity by up to 25x before the wind is subtracted. Water
  submersion depth is the standing suspicion. Every caller in this viewer passes
  zero, so the factor is inert, and `physics.js` says not to treat it as
  verified.
- **The soldier's bounding radius for the drag term.** Read from a virtual
  getter, not from any `.con`. 0.8 m is inferred because it makes the drag
  equation reproduce `setParachuteSpeed 30.00` from `setParachuteDrag 24.00` to
  within 1.8% — good evidence for the *shape* of the drag equation and weaker
  evidence for the radius.
- **Whether `SkeletonCollisionMesh` really is synthesised from the eight
  `setSkeletonCollisionBone` lines.** The named mesh `bodycollision_m1` ships
  nowhere in any mod, which leaves no other reading, but it is inference.
- ~~**`setCameraShake*`'s first argument.**~~ **Settled** — a slot index,
  0..2, for chaining up to three shakes per state. All of vanilla uses 0. The
  other two are an amplitude and an angular rate in radians per second, and the
  locomotion half of the whole system ships multiplied by zero. §6c.
- **Swim.** `setSwimFrequency 1`, eight `3PSwim*` clips, `DamageFromWater 1` /
  `WaterDamageDelay 90` / `hpLostWhileDamageFromWater 1`. Not investigated; the
  collider already knows where the water is.
- **Ladders.** `c_CGLadders` is one of the 47 unparsed collision groups
  (`projectile-collision.md`), and 20 `3PClimbLadder*` clips exist. Out of
  scope here and worth recording.

---

## 8. Reproduce

All commands from `tools/bf1942-models/`.

Dump vanilla's object scripts once, for grepping:

```bash
python3 - <<'EOF'
from pathlib import Path; from bf42.rfa import RfaArchive
A=Path.home()/'.wine/drive_c/EA Games/Battlefield 1942/Mods/bf1942/Archives'
a=RfaArchive(A/'Objects.rfa')
out=[f'===== {n} =====\n'+a.read(n).decode('latin-1')+'\n'
     for n in sorted(a.entries) if n.lower().endswith(('.con','.inc'))]
open('/tmp/vanilla_objects_dump.txt','w').write(''.join(out))   # 1,753 files
EOF
```

The soldier's whole declaration:

```bash
python3 -c "
from pathlib import Path; from bf42.rfa import RfaArchive
A=Path.home()/'.wine/drive_c/EA Games/Battlefield 1942/Mods/bf1942/Archives'
a=RfaArchive(A/'Objects.rfa')
for f in ['Objects/Soldiers/Common/CommonSoldierData.inc',
          'Objects/Soldiers/Common/Objects.con',
          'Objects/Soldiers/Common/Geometries.con',
          'Objects/Soldiers/Common/Sounds/SoldierSound.inc']:
    print('='*20, f); print(a.read(f).decode('latin-1'))"
```

`bodycollision_m1` ships nowhere:

```bash
python3 -c "
from pathlib import Path; from bf42.rfa import RfaArchive
M=Path.home()/'.wine/drive_c/EA Games/Battlefield 1942/Mods'
n=0
for mod in sorted(p for p in M.iterdir() if p.is_dir()):
    arc=next((c for c in mod.iterdir() if c.is_dir() and c.name.lower()=='archives'), None)
    if not arc: continue
    for f in arc.glob('*.rfa'):
        try: a=RfaArchive(f)
        except Exception: continue
        n += sum('bodycol' in e.lower() for e in a.entries)
print(n)"   # 0
```

Stance eye heights, posed off the game's own clips:

```bash
python3 - <<'EOF'
from pathlib import Path
import extract_pose as EP, extract_models as EM
from bf42 import ske as ske_mod, pose as pose_mod
G=Path.home()/'.wine/drive_c/EA Games/Battlefield 1942'
meshes,_,_,_ = EM.build_pools(EM.mod_chain(G,'bf1942'), [])
sk = EP.read_skeleton(meshes, 'animations/UsSoldier.ske')
stances,_ = EP.collect_stances(EP.state_machine(meshes), meshes, sk, 'No4', 0)
for key in ('stand','crouch','lie'):
    w = pose_mod.worlds_by_name(sk, pose_mod.posed_worlds(sk, stances[key]))
    z = lambda n: w[ske_mod.canonical(n)][1][2]
    print(f"{key:6} head {z('Bip01 Head'):.4f}  helmet {z('A'):.4f}  toe {z('Bip01 L Toe0'):.4f}")
EOF
# stand  head 1.6376  helmet 1.7538  toe 0.0122
# crouch head 1.0738  helmet 1.1936  toe 0.0128
# lie    head 0.3157  helmet 0.4201  toe 0.1049
```

The body bounds that size the movement capsule (§2.4), and the 1P meshes'
own bounds:

```bash
python3 - <<'EOF'
from pathlib import Path
import extract_pose as EP, extract_models as EM
from bf42 import pose as pose_mod
G=Path.home()/'.wine/drive_c/EA Games/Battlefield 1942'
meshes,_,_,_ = EM.build_pools(EM.mod_chain(G,'bf1942'), [])
sk = EP.read_skeleton(meshes, 'animations/UsSoldier.ske')
stances,_ = EP.collect_stances(EP.state_machine(meshes), meshes, sk, 'No4', 0)
for stance in ('stand','crouch','lie'):
    posed = pose_mod.worlds_by_name(sk, pose_mod.posed_worlds(sk, stances[stance]))
    for skn_path, label in (('animations/USbody.skn','3P body'),
                            ('animations/1PUSbody.skn','1P body')):
        skn = EP.read_skin(meshes, skn_path)
        binds = pose_mod.refine_binds(skn)
        bone_map, _ = pose_mod.remap_influences(skn, sk, binds)
        pts = [p for p in pose_mod.skinned_positions(skn, posed, bone_map, binds) if p]
        ax = lambda i: (min(p[i] for p in pts), max(p[i] for p in pts))
        print(f'{stance:6} {label:8} x{ax(0)} y{ax(1)} z{ax(2)}')
EOF
# stand  3P body  x(-0.365, 0.257) y(-0.172, 0.646) z( 0.005, 1.651)
# stand  1P body  x(-0.383, 0.157) y( 0.002, 0.638) z( 1.292, 1.566)
# crouch 3P body  x(-0.440, 0.259) y(-0.424, 0.665) z( 0.002, 1.099)
# crouch 1P body  x(-0.459, 0.120) y( 0.006, 0.661) z( 0.679, 0.886)
# lie    3P body  x(-0.454, 0.269) y(-1.056, 1.079) z(-0.048, 0.404)
# lie    1P body  x(-0.343, 0.208) y( 0.383, 1.070) z( 0.008, 0.204)
```

(The 1P body is posed here with the *third-person* upper clip, because that is
what `collect_stances` resolves today — see stage 2 for the `clip_1p()` change
that would pose it with `1PStandAimNo4` instead. Its standing top at z = 1.566
is the neck stump, and it landing within a centimetre of the 1.56 m eye is the
third coincidence supporting §2.1.)

Locomotion is in-place, and the step length:

```bash
python3 - <<'EOF'
from pathlib import Path
import math, extract_pose as EP, extract_models as EM
from bf42 import ske as ske_mod, pose as pose_mod, baf
from bf42.rfa import RfaArchive
G=Path.home()/'.wine/drive_c/EA Games/Battlefield 1942'
meshes,_,_,_ = EM.build_pools(EM.mod_chain(G,'bf1942'), [])
sk = EP.read_skeleton(meshes, 'animations/UsSoldier.ske')
a = RfaArchive(G/'Mods/bf1942/Archives/animations.rfa')
for clip, period in [('animations/StandWalkRun/LowerBody/3PRunLower.baf', 0.36),
                     ('animations/StandWalkRun/LowerBody/3PWalkLower.baf', 0.66),
                     ('animations/Crouch/LowerBody/3PCrouchForwardLower.baf', 0.50),
                     ('animations/Lie/LowerBody/3PLieForwardLower.baf', 0.60)]:
    an = baf.parse(a.read(clip), clip)
    root = next(b for b in an.bones if b.name.strip().lower() == 'bip01')
    net = math.dist(root.translations[-1], root.translations[0])
    best = 0.0
    for f in range(an.frames):
        w = pose_mod.worlds_by_name(sk, pose_mod.posed_worlds(
            sk, pose_mod.align_clip_roots(sk, an.local_pose(f))))
        lf = w[ske_mod.canonical('Bip01 L Foot')][1]
        rf = w[ske_mod.canonical('Bip01 R Foot')][1]
        best = max(best, abs(lf[1] - rf[1]))
    print(f"{clip.rsplit('/',1)[-1]:28} frames {an.frames:3} rootNet {net:.3f} "
          f"step {best:.3f} -> {best/period:.2f} m/s")
EOF
# 3PRunLower.baf               frames  13 rootNet 0.018 step 0.821 -> 2.28 m/s
# 3PWalkLower.baf              frames  24 rootNet 0.001 step 0.711 -> 1.08 m/s
# 3PCrouchForwardLower.baf     frames  18 rootNet 0.019 step 0.790 -> 1.58 m/s
# 3PLieForwardLower.baf        frames  18 rootNet 0.019 step 0.414 -> 0.69 m/s
```

The `rootNet` and `step` columns are sound and reproducible; the `m/s` column is
**not the engine's speed** — see §2.3 and §6b. What it recovers is the speed
each clip was *authored* at, which is a genuinely useful number for driving
playback rate and a wrong one for driving a body.

Every hand weapon's muzzle, camera nudge and camera-DOF flag: the script in
§2.7's table, or read the muzzle nodes straight out of the shipped glbs:

```bash
python3 - <<'EOF'
import struct, json
for n in ('No4', 'Thompson', 'Colt'):
    d = open(f'viewer/models/{n}.glb','rb').read()
    j = json.loads(d[20:20+struct.unpack_from('<I', d, 12)[0]])
    for nd in j['nodes']:
        if 'muzz' in (nd.get('name') or '').lower():
            print(n, nd['name'], nd.get('translation'),
                  (nd.get('extras') or {}).get('templateKind'))
EOF
# No4 em_MuzzGun      None                    Particle
# No4 em_MuzzGun_glow None                    SpriteParticle
# No4 e_MuzzGun       [0.0, 0.045, -0.745]    EffectBundle   <- the authored offset
```

The two gates that hide the 1P soldier:

```bash
python3 -c "
from pathlib import Path
import extract_models as EM
from bf42.assemble import reaches_first_person
G=Path.home()/'.wine/drive_c/EA Games/Battlefield 1942'
meshes, tex, objects, game = EM.build_pools(EM.mod_chain(G,'bf1942'), [])
lib = EM.build_library(objects)
for n in ('Corsair','USSoldier','USSoldier1PBody'):
    print(n, reaches_first_person(lib, n))"
# Corsair True / USSoldier False / USSoldier1PBody True
```

1P clip coverage in the parsed state machine:

```bash
python3 - <<'EOF'
from pathlib import Path
import extract_pose as EP, extract_models as EM
G=Path.home()/'.wine/drive_c/EA Games/Battlefield 1942'
meshes,_,_,_ = EM.build_pools(EM.mod_chain(G,'bf1942'), [])
m = EP.state_machine(meshes)
weapons = m.weapons('Ub_StandAim')
for fam in ('Ub_StandAim','Ub_Crouch','Ub_Lie','Ub_RunForward','Ub_Fire','Ub_StandReload'):
    got = sum(bool(s and any(c.is_first_person for c in s.clips))
              for s in (m.state(f'{fam}{w}') for w in weapons))
    print(f'{fam:16} {got}/{len(weapons)}')
EOF
```

Spawn points against the heightmap:

```bash
python3 - <<'EOF'
import statistics
from pathlib import Path
import extract_map as EM
G = Path.home()/'.wine/drive_c/EA Games/Battlefield 1942'
for lvl in ('Bocage','Wake','El_Alamein','Omaha_Beach','Berlin'):
    files, info, hm, _ = EM.load_level(G, 'bf1942', lvl)
    d = sorted(i.position[1] - hm.height_at(*hm.world_to_index(i.position[0], i.position[2]))
               for i in info.gameplay.soldier_spawns)
    print(f'{lvl:14} n={len(d):3} median {statistics.median(d):+.3f}  '
          f'p25 {d[len(d)//4]:+.3f}  p75 {d[3*len(d)//4]:+.3f}')
EOF
```

## 9. Firing from the hip, as built

Stage: on-foot weapon firing with a data-driven crosshair, in `viewer/map.html`
on top of `viewer/gunfire.js` and a new `viewer/deviation.js`. Everything below
reads the `weapon` document extras and the `fireArms`/`muzzle` nodes the
extractor now bakes into every hand-weapon glb (§2.7); nothing about any
individual weapon appears in the viewer's source.

### What was built

- **`viewer/deviation.js`** — `DeviationModel`, the cone a shot is sampled
  inside, in degrees of half-angle. Import-free and DOM-free like `physics.js`,
  driven under node by `tests/test_deviation.py` via
  `tests/deviation_harness.mjs` (21 tests, run with the soldier/collision/
  physics suites).
- **`GunFire` extensions** (`viewer/gunfire.js`), both options, both `null` on
  every existing caller so `index.html` and the pilot path are untouched:
  - `aimRay: () => ({origin, dir})` — the round leaves the caller's origin
    along the caller's direction instead of the muzzle transform. This is
    `fireInCameraDof 1` (all 25 armed hand weapons): the eye down the camera
    axis, the muzzle node placing only the flash.
  - `spreadDeg: () => degrees` — each shot's direction is rotated by a random
    polar/azimuthal offset inside that cone, `theta = spread x sqrt(u)` so a
    burst paints a disc, not a ring.
  - A typed `bullet` round with no tracer stat now spawns the dim stand-in
    streak *when the group has an `aimRay`*: hand weapons declare no tracer at
    all, and a round that is never spawned never sweeps and never hits.
    Vehicle guns keep the old contract exactly.
- **The viewmodel** — one hand-weapon glb per spawned soldier, default per
  flag team (axis Mp40, allies Thompson, `?weapon=<Template>` overrides),
  loaded from the mod-resolved models base, parented to the camera (which is
  now in the scene graph for exactly this reason), collected into the shared
  `GunFire` with `replace: false`. Disposed on respawn-to-other-team, mode
  exit and map switch.
- **Trigger** — left mouse under pointer lock. Full-auto holds `setFiring`;
  `fireOnce` weapons queue one shot per click and hold the declared cycle
  (`roundOfFire 0.37` on a No4 is a 2.7 s bolt) across clicks. Magazine from
  `magazine.size`; dry triggers an automatic magazine change after
  `reloadTime`, R asks early; the count draws bottom-right in the HUD's voice.
- **Crosshair** — DOM over the canvas, four bars and a dot off `tokens.css`
  ink, gap per frame `0.5 x viewportHeight x tan(dev) / tan(vfov/2)` at the
  *current* (zoom-eased) FOV. `CHTCrossHair` draws the cross, `CHTIcon` keeps
  the dot alone (its authored icon art is not extracted), `CHTNone` and a
  scoped aim draw nothing.
- **Zoom** — right mouse is a press-toggle (`altFireOnce` masks the held
  alt-fire input, client 0x00500901; every vanilla hand weapon declares it —
  a mod weapon without it falls back to hold-to-zoom). Zoom multiplies the
  view FOV by `zoom.soldierFov`, eased `0.7·cur + 0.3·target` per visual
  frame with a 0.001 snap, scales the mouse-look deltas by the same factor
  while zoomed (client 0x0050095f), and displaces the viewmodel rig from
  `weapon.view.cameraPosition` (hip) to `.zoomPosition` at 25% of the
  remaining distance per frame — all engine-verified in the corpus doc
  (`handweapon-view-and-deviation.md` §§3–4). Zoom drops on reload and on
  holstering (entering a vehicle); `UnZoomBetweenFireTime > 0` (the
  snipers' 3.0) un-zooms around each shot and re-zooms when the timer runs
  out; movement never breaks it. Scoped weapons hide the rifle while
  zoomed. The rig's *base* offset (`BFSoldierTemplate+0x15c`, added by
  `updateAnimations` before the per-weapon vector) is not extracted yet —
  `VIEWMODEL_BASE` in `map.html` is the marked stand-in for it.
- **Recoil** — per shot, degrees sampled uniformly inside `recoil.up` /
  `recoil.leftRight`, written into `soldier.look()` unscaled, so the standing
  pitch clamp catches a mag dump the same way it catches the mouse.

### The deviation rule, as decompiled

No longer provisional. The combining rule is `HandFireArms::updateDeviation`
— client `BF1942.exe` @ 0x00551f50, lnxded 0x08293e80, read in full in both
binaries and documented in
`features/bf1942-engine-reference/subsystems/handweapon-view-and-deviation.md`
(committed 9276c9c). With `M = devMod[stance]` (1.0 when absent), per tick:

    speedAcc = M·speed.b·[|throttle| > 0.01] + M·speed.c·[|strafe| > 0.01]
    turnAcc  = M·turn.b·|mouseLookY|         + M·turn.c·|mouseLookX|
    miscAcc  = M·misc.b·[jumping]

    per channel (cap = a·M, decay = d/M):
      acc == 0:     state = max(state − decay, 0)
      state < cap:  state = clamp(state + M·acc − decay, 0, cap)
      else:         state = max(state − decay, cap)

    fire += fire.b per shot, clamped to fire.a; fire −= fire.c/M per tick
    total = minDev + fire + speed + turn + misc

The load-bearing corrections against the old approximation: minDev is NOT
scaled by devMod (the stance ladder lives in the channels — raises ·M², caps
·M, decays ÷M, so prone also *recovers* faster); the speed gates are binary
on the 0.01 deadzone, never scaled by achieved velocity; miscDev is the jump
channel, nothing else; and **aiming/zoom has no effect on deviation at all**
— the former ×0.5 was an invention and is gone.

Still OPEN, marked at their declarations in `deviation.js`: the tick cadence
(`TICK_HZ = 60`, the viewer's sim rate — the engine's rule is per
`handlePlayerInput` call, dt-free, client call rate untraced), the units of
MouseLookX/Y (rad/s here; vanilla ships `setTurnDev 0 0 0 0`, so nothing can
calibrate it), and the AT family's `minDeviation`/`maxDeviation` vocabulary
(different console block, corpus doc §7 — floor-and-lid is the stand-in).

### What remains

- ~~Real 1P hands and arms, and the fire/reload animations — still blocked in
  the exporter (§4); the viewmodel is the 3P weapon mesh with no hands.~~
  **Extracted.** `extract_viewmodel.py` ships the 1P sleeves, hands and the
  welded weapon with idle/walk/run/fire/reload/deploy baked in — §11. The
  *viewer* still mounts the bare weapon glb; swapping it for the `.fp.glb`
  is the remaining half.
- Scope overlay art (`sniper.tga` is named in the data), and CHTIcon's
  authored crosshair icons.
- Hand-weapon fire *sound* — the vehicle weapon-audio path keys off a
  vehicle's own sound scripts and does not yet know about kits.
- The first-person rig's *base* placement vector
  (`BFSoldierTemplate+0x15c`) and the renderer-side handling of the 1P rig
  (own projection? near plane?) — both OPEN in the corpus doc; until they
  are read, `VIEWMODEL_BASE` stands in and the rig renders under the world
  pass at the (zoom-modified) view FOV.

## 10. The deploy screen

Joining on foot is a choice now, not a teleport. Ticking `spawn on foot` opens
the fullscreen map in a deploy state — the same canvas and projection the M
key shows, wearing a header (level name, "select spawn point") and a commit
bar (team badge, Spawn button, key hints). Every flag that owns soldier
spawns gets a ring; clicking one — or pressing 1-9 — selects it, and the
chosen ring pulses. Spawn (or Enter) closes the screen and runs today's
`setOnFoot` at that flag; Escape cancels back to fly. A level with no
spawn-owning flags skips the screen and keeps the old instant path and its
refusal message.

The selection is the panel's flag `<select>` — the screen reads and writes
it, `buildSpawnFlags` now preserves the value across its rebuild, and a level
switch clears it in `show()` so the memory never crosses maps.

Once alive, R stays reload (or quick-respawn with an empty hand), and the
road back to the screen is M or Shift+R: a redeploy. Cancelling a redeploy
keeps the life in progress and restores the select to the flag he actually
stands at.

Under `?shots` the flow is drivable headlessly: `__setOnFoot(true)` parks the
join on the screen, and `window.__deploy` is `{ open, flags, select(name),
spawn() }` — `open` and `flags` (name/team/spawns/selected) are state,
`select` is the click on a marker (name or index), `spawn` is the button.

## 11. The viewmodel, extracted

Stage 2 and the clip half of stage 3, shipped: `tools/bf1942-models/
extract_viewmodel.py`, `viewer/models/viewmodels/USSoldier__Thompson.fp.glb`
and `GermanSoldier__MP40.fp.glb` (~1.5 MB each), `tests/test_viewmodel.py`
(19 assertions, suite 621). The viewer mounts both rigs per the instructions
at the end of this section, which are kept as the record of why.

### What the 1P rig actually is, sharpened

§2.2 said "a 1P torso and a 1P pair of hands". Half right. Reading the skins
themselves:

- **`1PUSbody.skn` is not a torso — it is the two camo forearm sleeves.**
  230 vertices, skinned to exactly eight bones: `Bip01 L/R Forearm` and the
  forearm helper chains `Bone01..03` / `Bone07..09` (the same names the face
  skins reuse for face bones — here they really are the skeleton's forearm
  helpers, and `pose.remap_influences`' chain-distance check passes them).
  There is no spine, no shoulder, no chest in the skin at all. The "body" in
  the filename is DICE's, not a description.
- **The hands are the full-detail hands**: 312 vertices each, 17 bones — the
  hand, all fifteen finger joints, and a `Wrist bone` helper — against the
  3P hands' coarser weighting. This is why fingers curl correctly around the
  grip in first person.
- All three are `AnimatedMesh` with `.skn` against the ordinary soldier
  skeleton, exactly as §2.2 measured. Same skeleton, same `Bip01 R Hand`
  weld, same weapon glb. Posed with `Lb_Stand` + `1PStandAimThompson`
  frame 0, the palms land on the welded Thompson at **R 0.038 m / L
  0.046 m** — the same weld quality as the 3P poses.

So the reference footage's "camo sleeves from screen bottom-center" is
literally the asset: sleeves and hands are all the geometry there is, and
the game hides everything else by never drawing it (`setIsFirstPersonPart 1`
parts are the only ones rendered in first person; there is no 1P torso to
clip through the camera).

### The clip inventory

For the Thompson, 41 `Ub_*` states carry a 1P clip (of the 379 1P clips in
the 1,154-clip archive). The exporter bakes the six families a viewmodel
needs; every clip is 52 bones — spine chain, neck, head, both arms, every
finger, no pelvis, no legs:

| baked as | state | clip | frames | speed (after tweaking) | span = 1/speed | morph factor |
|---|---|---|---|---|---|---|
| `idle` | `Ub_StandAimThompson` | `1PStandAimThompson.baf` | 13 | 0.1, looping | 10 s | 0.7 |
| `walk` | `Ub_WalkForwardThompson` | `1pRunThompson.baf` | 17 | 0.5, looping | 2.0 s | 0.5 |
| `run` | `Ub_RunForwardThompson` | `1pRunThompson.baf` | 17 | 1.40 (declared 0.7), looping | 0.71 s | 0.5 |
| `fire` | `Ub_FireThompson` | `1PFireThompson.baf` | 8 | 10.0, looping | 0.1 s | 4.0 |
| `reload` | `Ub_StandReloadThompson` | `1PReloadThompson.baf` | 181 | 0.21 (declared 0.4), once | 4.76 s | 10000 (cut) |
| `deploy` | `Ub_StandRaiseWeaponThompson` | `1PDeployThompson.baf` | 29 | 1.0, once | 1.0 s | 10000 (cut) |

Also in the data and not yet baked: crouch/lie aim variants
(`Ub_CrouchThompson` plays the stand-aim clip at 0.5, `Ub_LieThompson` a
dedicated `1pLieAimThompson` at 0.2), crawl, eject-clip, fire-end, and the
three idle one-shots `1pIdle1..3Thompson`. All resolve through the same
`clip_1p()` path when wanted.

**The walk/run distinction is a rate, not a clip** — both play `1pRun` and
only the state speed differs, which is why the export carries both names.

**The spans are data after all** (third pass, below). The engine has no
authoring rate: a full pass of a clip lasts `1/|speed|` seconds however
many frames it holds, and the speed is the one the tweaking scripts set.
The reload at its tweaked 0.21 is a 4.76 s pass against the Thompson's
`reloadtime 4.8` — DICE fitted the rate to the timer, which is why the
earlier `bakedSpan / reloadTime` stretch (3.75 under a 25 fps reading)
happened to land, and why it is gone. Fire at 10.0 is a 0.1 s pass, the
shot cycle itself.

### The weapon channel is declared, not conventional

§2.6 showed `Ub_StandReloadThompson` naming `WeaponReloadThompson` through
`setOtherState c_AsmWeaponState`. The parser now reads that command
(`animstates.State.weapon_state`), and the clone machinery substitutes the
weapon name through `copyState`/`copyState2` — so `Ub_StandReloadK98`
answers `WeaponReloadK98`, whose clip resolved through the No4 donor is
`Animations/Weapons/No4/No4Reload.baf`, all from data.

Two findings from parsing it everywhere rather than assuming the pattern:

- **Automatic weapons declare no weapon state on fire.** `Ub_FireThompson`
  pairs nothing; `Ub_FireColt` pairs `WeaponFireColt`. Only single-shot
  weapons (and the bazooka's rocket-in-tube) animate the weapon on the fire
  channel. `WeaponFireThompson` exists as a state but no body state names
  it. The export follows the data: the Thompson's `fire` animation moves
  arms only, its `reload` moves the magazine.
- **The weapon-channel math has an exact identity check.** A weapon clip
  poses the weapon's own skeleton in the raw file convention; the exported
  bound parts (`boundBone` extras — `magasin`, `flerp`) sit relative to the
  main bone in the parsed convention. Conjugating each clip local by
  diag(1,1,−1), chaining worlds, and re-expressing against the main bone
  reproduces the static rest at frame 0 to **0.1 mm** on the real
  `ThompsonReload.baf` — and frame 60 puts the magazine 0.27 m right and
  0.41 m down, which is the hand pulling it out. The baked tracks land on
  the same nodes the static export placed.

### Where the exporter was blocked, and how it was unblocked

§4.1 named two gates and offered two routes. The shipped route is the
second: `extract_viewmodel.first_person_parts` walks `template.children`
directly and keeps exactly the refs with `setIsFirstPersonPart 1` and a
skinned geometry — `con.instance_template_name` (which erases them, con.py:370)
is never consulted. Nothing about the 3P paths changed, so every existing
export is byte-identical.

Small additions elsewhere, each doing one thing:

- `bf42/animstates.py` — `State.clip_1p()` / `StateMachine.clip_1p()` (the
  two lines §2.6 predicted), plus `weapon_state` parsing and cloning above.
- `bf42/con.py` — parses `center1pHands` and `set1pFov` onto
  `ObjectTemplate`. Both live in `CommonSoldierData.inc`, which the object
  library never reads (it indexes `.con` only, and does not replay
  `include`) — so the exporter's `soldier_view_constants` replays the
  soldier's own include chain textually, the engine's way, and hands the
  joined text to the ordinary parser. Vanilla answers −0.12/−1.56/0.1 and
  0.47, which are §2.1's numbers read from data instead of quoted at it.

### What is in the file

`<Soldier>__<Weapon>.fp.glb`: the full soldier skeleton posed at
`Lb_Stand` + idle frame 0 (so a viewer that ignores animations shows the
ready pose), three skinned meshes, the weapon template tree under a
`<Weapon> grip` wrapper on `Bip01 R Hand` (same `weldBone` extras as the
pose glbs), and one glTF animation per family. Every animation carries every
bone any family animates — a bone this clip leaves alone holds the base pose
as a two-key constant — so crossfading any two clips never mixes an animated
bone against an unanimated one; the weapon's bound parts get the same
treatment. Textures resolve through the normal `.rs` path; none missing on
either shipped file.

Doc extras (`extras` on the glb root document, mirrored in the
`.fp.report.json`):

- `view`: `center1pHands`, `fov1p`, `soldierCameraPosition`,
  `soldierZoomPosition`, `soldierZoomFov`, `zoomFov` — everything the mount
  needs, per weapon.
- `clips`: per family — source clip path, frames, the state's speed (after
  the `{1p,3p}AnimationsTweaking.con` overrides), loop flag, `duration` =
  one full pass in seconds (the engine's `1/|speed|`, third pass below),
  `morphFactor` (the per-second blend-in rate, `setMorphFactor`),
  `returnTo`, and the weapon-channel clip where one is declared.
- `weaponStats`: the armoury block; `clipTiming: "1/speed"` marks the
  timing convention (the former `bafFps: 25` is gone — the engine has none).

### How the viewer should mount it (wired — map.html follows this recipe)

**Wired.** `loadHandWeapon` mounts the two shipped rigs exactly as the six
steps below say: camera-parented at `center1pHands` (the `VIEWMODEL_BASE`
stand-in now serves only the bare-weapon fallback), 180° about Y, the eased
hip/zoom offsets unchanged, an AnimationMixer running idle/walk/run off
`soldier.gait` (crouch and prone play the aim until their families are
baked), fire as a clamped one-shot per `guns.onShot`, reload at its own engine
span (one pass = `1/speed`, 4.76 s), deploy on every spawn, and the whole
rig on a `VIEWMODEL_LAYER` near pass over cleared depth. Only the
`view: "first"` muzzle emitters strobe on foot. Crossfades last
`1 / morphFactor` of the clip being entered, from the extras (third pass).

**Second pass (2026-09-15, corpus doc §3).** The mount is now the engine's
arithmetic with no free parameter, and two of the numbers above changed
under it:

- The engine applies **no lower-body clip in first person** —
  `AnimationStateMachineInstance::updateAnimations` returns when the state
  has no 1P clip slot, and no `Lb_*` state declares one — so Bip01, the
  pelvis and the legs are the `.ske` rest, restored by
  `BFSoldier::setFirstPerson` from the template skeleton. The exporter bakes
  that now instead of `Lb_Stand` frame 0; the arms come out 9 cm lower and
  6 cm further out, and the head bone lands 1.8 cm under the eye at
  `center1pHands` −1.56 (the clip root had put it 7 cm above). The rig is no
  longer feet-at-origin: the rest legs sit bent, at y ≈ 0.38, unseen.
- `center1pHands` *is* the engine's base vector (`BFSoldierTemplate+0x15c`,
  written by the console word of that name); the calibrated x/y/z/yaw that
  `map.html` carried on top of it (`VIEWMODEL_CAL`) is gone. The 0.35 rad of
  yaw was compensating for the Lb_Stand pose.
- The world camera is `renderer.fieldOfView 1` = 57.30° vertical, not
  `set1pFov`; `set1pFov 0.47` is what `setFirstPersonFov` hands each
  first-person part, multiplied by `SoldierZoomFov` when zoomed, drawn in
  the renderer's own `drawFov` pass. The viewer's near pass now takes
  `FOOT_FOV × the factor` and the world camera takes `zoomFov` on zoom.
  Third pass (2026-09-15): the pass and its projection are read on the
  client — see step 6 — and the engine's 0.47 rad does not reproduce the
  capture, so the world FOV stays the viewer's default with the engine
  value behind a query flag.

Against the retail capture the right hand and the gun's direction now land
without calibration; the front sight and left hand sit ~60–70 px (≈5°)
higher than retail, a residual the corpus doc §7 keeps open.

**Third pass (2026-09-15, corpus doc §3 "in time").** The animation runtime
under the arms was read in both binaries to ask whether that residual is a
frame, a blend or an aim-driven sweep of the idle clip. It is none of them,
and three numbers in this section changed under it:

- **A clip's pass is `1/|speed|` seconds, whatever its frame count.** The
  engine advances a normalized phase by `dt × speed` and maps
  `frac(phase) × N` onto the frames with a slerp between neighbours; there
  is no authoring rate anywhere. `BAF_FPS = 25` is withdrawn. The fire clip
  at 10.0 is the 0.1 s of the 600 rpm cycle, the aim sway at 0.1 a 10 s
  breath (not 4.8 s), the deploy 1 s, and the reload — at its *tweaked* 0.21
  — 4.76 s against the 4.8 s `reloadTime`, so the `bakedSpan / reloadTime`
  stretch was reproducing the data and is gone.
- **The tweaking scripts are the rates.** `1pAnimationsTweaking.con` /
  `3pAnimationsTweaking.con`, run last from `AnimationStates.con`, replace
  the `addAnimation` speeds by state name: run 0.7 → 1.40, reload 0.4 →
  0.21. `bf42/animstates.py` applies them now; they are the saved output of
  a developer hot-key tuner in `BFSoldier::handleFrameUpdate`, the only
  thing in the binary that changes a clip's rate.
- **Crossfades are `1/setMorphFactor` of the state being entered**, blending
  from whatever pose the skeleton holds: aim 0.7 (a 1.4 s settle back onto
  the sights after a burst), fire 4.0, deploy and reload 10000 (a cut). The
  0.15 s / 0.02 s stand-ins are gone; the factor rides in the extras.
- **Every rig has to be re-exported when the timing changes, not the two
  that were measured.** This pass re-exported only the Thompson and MP40
  rigs and dropped the viewer's `bakedSpan / reloadTime` stretch in the
  same change, so the other 34 kept their `bafFps: 25` bake with nothing
  rescaling them: reloads ran 3.75–6.1× their `reloadTime` (a No4's 9.8 s
  against 1.6 s, the Garand's 23 s against 4 s). All 36 are re-exported; a
  rig's report carries `"clipTiming": "1/speed"` once it is on the engine's
  clock, and `bafFps` means it is stale. In the same fix, an empty magazine
  now goes through `startReload` like R does — the dry path had never
  re-armed the arms' clip, so only the first reload of a life animated.

On the pose itself: all 13 frames of `1PStandAimThompson` project within
4 px of one another, the deploy clip ends on the aim clip's frame 0, and
nothing on the first-person path — no aim pitch, no IK (seated-in-vehicle
only), no post-absolute rotation (third person only) — touches the 52 bones
beyond the clip. Frame 0 over the rest is the engine's pose to within the
sway. The ~5° residual lives between the skeleton and the pixels (the
`drawFov` projection, the camera's relative transform, or the 16:9 vertical
field of view); the corpus doc §7 carries the numbers to beat.

**Third pass (2026-09-15, corpus doc §2 "Clock").** The two clocks the rig
lives on are now read, not assumed. The client is a fixed-step simulation at
`g_simulationFps` = 30 Hz: `Setup::mainLoop` hands `GameClient::update` a
tick count and `1/30`, and every tick pops one buffered `PlayerInput` into
`handlePlayerInput(…, 1/30)` — so the deviation cone's per-call decay and
bloom are per-1/30-s amounts, and `deviation.js` ticks at 30, not the 60 of
the viewer's own body sim. The hip↔zoom ease and the FOV-factor ease
(`handleVisualUpdate`) are called from the drawer, once per rendered frame,
which is what this page already did. `zoomFov` is confirmed as the render
view's own unit (written verbatim into `RenderView::setFieldOfView`), and it
is `zoomFov`, not `soldierZoomFov`, that scales the zoomed mouse deltas.

The engine's own chain is decompiled in
[`../bf1942-engine-reference/subsystems/handweapon-view-and-deviation.md`](../bf1942-engine-reference/subsystems/handweapon-view-and-deviation.md)
§3: the offsets displace the **rig**, in the soldier's view frame — the
camera never moves.

1. **Parent the rig to the camera.** The glb is feet-at-origin, +Y up, arms
   extending along **+Z** (same root pitch as the pose glbs). A three.js
   camera looks down −Z, so the mount is a child group with a 180° Y turn.
2. **Place it at `center1pHands`**, read from the extras, not retyped:
   x lateral (positive = the viewer's right), y vertical, z along view. It
   is the engine's own base vector, added to the eased weapon offset in
   camera space; with vanilla's −0.12/−1.56/0.1 the skeleton root sits
   1.56 m below the eye and the head bone 2 cm under it — sleeves at the
   bottom of the frame, weapon raked up-forward.
3. **Add the weapon's own nudge**: `soldierCameraPosition` at the hip,
   `soldierZoomPosition` zoomed, **eased at 25% of the remaining distance
   per frame** (the engine's constant, dt-free); while zoomed multiply the
   arms' FOV by `soldierZoomFov` (0.7/0.3 ease) and scale mouse deltas by
   `zoomFov` — the zoomed camera FOV itself, in radians, i.e. its ratio to
   the 1.0 rad default (corpus doc §3, third pass; an earlier reading said
   `soldierZoomFov`). All four values are in the extras.
4. **Drive the mixer off the soldier state**: `idle` looping always (it is
   the breathing sway — at its declared 0.1x it is slow enough to read as
   idle sway, not animation); crossfade to `walk`/`run` by gait; `fire` while
   the trigger is down (it loops); `reload` one-shot at its baked span (the
   engine's `1/speed` — 4.76 s for the Thompson's tweaked 0.21 against the
   4.8 s `reloadTime`; the earlier `bakedSpan / reloadTime` stretch is
   gone); `deploy` one-shot on weapon raise. Each crossfade lasts
   `1 / clips.<family>.morphFactor` (the target state's `setMorphFactor`;
   ≥ 1000 is a cut) — the third pass below.
5. **Keep firing from the camera.** `fireInCameraDof 1` (§2.7) — the rig is
   presentation; the shot ray, deviation and recoil paths do not change.
   The in-file muzzle nodes are where the *flash* draws, and the weapon tree
   carries first-person-specific emitters (`em_1P_MuzzThomp`,
   `effect.view: "first"`) that the 3P glb also has but a 1P mount should
   prefer.
6. **Render on a near layer** (separate pass or depth-clear) so the rig
   never intersects walls; the game draws 1P parts in their own `drawFov`
   pass, after the world, over a depth buffer cleared to 1.0, with the
   finest mip forced. Each part carries a projection baked when its field of
   view was set (`setFirstPersonFov` → `IViewModifier::setFieldOfView`):
   the render view's own perspective for `set1pFov × SoldierZoomFov` as a
   whole vertical angle, `height/width` aspect, and the **world's near
   plane, 0.1 m** — nothing moves it. That is what the code applies per
   mesh (corpus doc §3, "The drawFov pass"). The retail capture, measured,
   does not show it: under 0.47 rad the right hand lands at (1042, 939) and
   retail has it at (816, 614), which is the world's 57.3°. So the viewer's
   near pass keeps `FOOT_FOV × factor` at near 0.1, and `?fov1p=engine`
   renders the engine's value for the day the difference is understood.

What §11 leaves undone, so nobody hunts for it: the crouch/lie/crawl and
idle-fidget families (resolve today, one tuple each in `FAMILIES`), the
other six nations' arms (one CLI pair each — the meshes total 885 KB for
all eight), knives (their fire states are `Ub_FireKnife*A..E` variants and
need a family alias). The `.baf` base rate is no longer on the list: there
is none, a pass is `1/speed` (third pass).
