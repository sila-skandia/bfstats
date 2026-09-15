# Hand-weapon first-person placement, deviation, and zoom

Settled 2026-09-15, first-person mount closed in a second pass the same day, the
animation runtime under the arms read in a third. Two binaries were read side by side:

- **Client** `BF1942.exe` (sha256 `60c9452d…`, the corpus binary) — addresses `0x00xxxxxx`.
- **Server** `bf1942_lnxded.static` (54,895 symbols) — addresses `0x08xxxxxx`, cited
  with symbol names. The deviation and zoom state machines live in `dice::ref2::world`
  (shared engine source), so the server's *named* functions were used to find and then
  verify the client's stripped equivalents. Everything below marked VERIFIED was read
  in decompiled/disassembled code in at least one binary; where it was read in **both**,
  both addresses are given.

The .con vocabulary covered: `setMinDev`, `setFireDev`, `setDevMod`, `setTurnDev`,
`setSpeedDev`, `setMiscDev`, `soldierCameraPosition`, `soldierZoomPosition`,
`SoldierZoomFov`, `zoomFov`, `UnZoomBetweenFireTime`, `altFireOnce`, `useScope`.

---

## 1. Template storage (VERIFIED, both binaries)

`FireArmsTemplate` (client offsets; lnxded offsets in parens). The client console
accessors (`ConsoleClass` thunks) reach the template through an adjusted interface
pointer that is **+4** from the base used by `makeScript`; base-relative offsets are
given here. Client `FireArmsTemplate::makeScript` = `FUN_0053a110`, the
offset→property rosetta.

| property | client | lnxded | shape |
|---|---|---|---|
| `UnZoomBetweenFireTime` | +0x3d0 | +0x268 | float, 0 = off |
| `useScope` | +0x3d4 | — | bool |
| `zoomFov` | +0x3d8 | +0x270 | float, default −1.0 = no zoom |
| `SoldierZoomFov` | +0x3dc | +0x274 | float **factor**, default −1.0 |
| `soldierZoomPosition` | +0x3e0 | +0x278 | Vec3 |
| `soldierCameraPosition` | +0x3ec | +0x284 | Vec3 |
| `setFireDev c` (decay) | +0x4f0 | +0x2f4 | float/tick |
| `setMinDev` | +0x4f8 | +0x2fc | float |
| `setFireDev a` (cap) | — | +0x2f8 | float |
| `setFireDev b` (add/shot) | — | +0x2f0 | float |

`HandFireArmsTemplate` additions (client / lnxded), argument order from the lnxded
**named setters** `setTurnDev(f,f,f,f)` 0x08294740, `setSpeedDev` 0x08294770,
`setMiscDev(f,f,f)` 0x082947a0; client offsets from the `setDevMod` console execute
`FUN_004cf9d0` and `HandFireArms::updateDeviation` `FUN_00551f50`:

| .con args | role | client | lnxded |
|---|---|---|---|
| `setTurnDev a b c d` | a=cap, b=per-`MouseLookY` term, c=per-`MouseLookX` term, d=decay/tick | 0x56c / 0x560 / 0x564 / 0x568 | 0x370 / 0x364 / 0x368 / 0x36c |
| `setSpeedDev a b c d` | a=cap, b=moving-gate (throttle) term, c=moving-gate (yaw) term, d=decay/tick | 0x57c / 0x570 / 0x574 / 0x578 | 0x380 / 0x374 / 0x378 / 0x37c |
| `setMiscDev a b c` | a=cap, b=raise while jumping, c=decay/tick | 0x588 / 0x580 / 0x584 | 0x38c / 0x384 / 0x388 |
| `setDevMod s c p` | stance multiplier: standing / crouch / prone | 0x58c / 0x590 / 0x594 | 0x390 / 0x394 / 0x398 |

Pose index order 0=stand, 1=crouch, 2=prone: read in `HandFireArms::getDevMod`
(client `FUN_00551930` @ 0x00551930, lnxded 0x08294400) and consistent with the
already-verified `BFSoldierTemplate::directionalSpeed` pose indexing.

The tuple-role→offset pairing for turn/speed args b vs c is taken from the lnxded
setter argument order plus which input channel each offset multiplies; the b/c
assignment (which arg is Y vs X, throttle vs yaw) is **INFERRED** from that pairing
— consistent in both binaries, but no .con doc cross-check was done.

---

## 2. Q2 — the deviation combine rule (VERIFIED, decompiled in the client)

`HandFireArms::updateDeviation(bool)` — client `FUN_00551f50` @ **0x00551f50**
(lnxded `0x08293e80`, byte-for-byte same algorithm). Base class
`FireArms::updateDeviation` — client `FUN_00539620` @ **0x00539620** (lnxded
`0x0828d410`). Full decompiled client source was read; this is not a paraphrase of
the assembly.

### State

Per weapon instance (client offsets): `speed` +0x2f0, `turn` +0x2ec, `misc` +0x2f4,
`fire` +0x1ac, `aiPending` +0x1b0, `total` +0x1a8. All in crosshair-radius units.

### Per tick

Let `M = devMod[pose]` (getDevMod; returns 1.0 if the holder is not a soldier).
Inputs come from the soldier's `PlayerInput` array with a per-channel valid bitmask;
threshold constant **0.01** (deadzone) in both binaries (lnxded `.rodata 0x086c08a4`).

Input channel numbering (VERIFIED in the client: `FUN_0053af70` checks
`inputFire == 8`; the alt-fire mask bit is 0x800000 = bit 23; the input-value array
offsets at 0x5008xx differ by exactly (23−8)×4):
`0=Yaw, 1=Pitch, 2=Roll, 3=Throttle, 4=MouseLookX, 5=MouseLookY, …, 8=Fire,
9=Action(jump), …, 23=AltFire`.

Accumulators:

```
speedAcc = M·speedDev.b·[|in[3]| > 0.01]  +  M·speedDev.c·[|in[0]| > 0.01]   (binary gates)
turnAcc  = M·turnDev.b·|in[5]|            +  M·turnDev.c·|in[4]|             (analog scaled)
miscAcc  = M·miscDev.b·[bool arg]                                            (jump, see below)
```

Per-channel update, identical for speed / turn / misc
(cap = `arg_a·M`, decay = `arg_decay / M`):

```
if acc == 0:          state = max(state − decay, 0)
else if state < cap:  state = clamp(state + M·acc − decay, 0, cap)
else:                 state = max(state − decay, cap)      # saturated while input held
```

Note the **M² on the raise**: each term already carries one factor of M inside the
accumulator and the apply step multiplies by M again (`fVar4 * fStack_20` etc. in
the decompile; the same double multiply is in the lnxded x87 code at 0x0829431e /
0x0829400b). Crouch/prone (M<1) therefore reduces the raise quadratically, raises
caps linearly (·M), and speeds decay (÷M). This is the engine's actual arithmetic,
read twice; it is not a decompiler artifact.

Fire channel (linear, no cap check on decay):

```
fire = max(fire − fireDev.c / M, 0)        # hand weapons (÷M); vehicle FireArms: no ÷M
```

raised at trigger time in `FireArms::Fire` (lnxded 0x0828a2aa):

```
fire = min(fire + fireDev.b, fireDev.a)    # add per shot, clamped to cap a
```

Total:

```
total = minDev + fire + speed + turn + misc + aiPending;   aiPending = 0
```

`aiPending` (+0x1b0 client, +0x190 lnxded) is **not** a player fire term: its only
writer is `FireArms::setAIDeviation(float)` (lnxded 0x0828e350) — bot aim error.

### What the bool argument is (VERIFIED in lnxded caller)

`BFSoldier::handlePlayerInput(IPlayer*, PlayerInput&, float)` (lnxded 0x08273c70)
makes the only call (site 0x08274da2, vtable slot +0x128 GCC / **+0x174** in the
client `HandFireArms` vtable at 0x008f9750). The bool is
`input[9] (c_PIAction = jump) != 0 && soldier+0x3c8 == 0`, with the jump input
additionally masked by a soldier state bit — i.e. **miscDev is the jump/airborne
deviation**. It does not fire for swimming or vehicles (vehicle guns are plain
`FireArms` and have no misc/turn/speed channels at all).

### Clock (VERIFIED structure, cadence partly OPEN)

There is **no dt anywhere** in either updateDeviation. Decay and raise amounts are
per *call*, and the call is one per `handlePlayerInput`. On the server that is the
server tick. On the client the exact cadence of handlePlayerInput for the local
player (render frame vs fixed step) was not traced — OPEN — but whatever it is, the
deviation clock is that cadence, not seconds.

### What consumes the total (VERIFIED, lnxded)

- Crosshair: `FireArms::getMenuCrossHairRadius`/`Size` (0x0828d470/0x0828d480)
  return `total` directly.
- Ballistics: `FireArms::fireBarrel` (0x0828aba0) applies the random cone only when
  `total > 0.01` (reads at 0x0828af0b, 0x0828b88c).
- **Zoom/aiming appears nowhere in the formula.** There is no aim multiplier, in
  either binary, on any path between the accumulators and the total.

---

## 3. Q1 — the first-person mount: what the offsets displace, and through what

Settled in both binaries on 2026-09-15 (second pass). The first pass had the
right chain and one wrong leaf: the "base vector ships as (0,0,0)" reading is
withdrawn — it is `center1pHands`.

### The chain (VERIFIED, client `FUN_004fb150` @ **0x004fb150** decompiled in full; lnxded `BFSoldier::updateAnimations` 0x0826e630 read in disassembly)

In the first-person branch (`isFirstPerson && soldier+0x50 == 0`, the second
term excluding a soldier seated in a vehicle) the soldier's skeleton root is
placed at

```
A = rotate90aroundX · T(center1pHands + easedOffset) · S · M
Skeleton::transform(&A, -1)
```

with `BaseMatrix4::mult` semantics (client `FUN_0040d2e0`, lnxded 0x08062440):
`this[i][j] = Σ_k a[i][k]·b[k][j]`, row 3 = `a[3]·B + b[3]`, last column
forced to (0,0,0,1) — a row-vector affine product, translation in m[12..14],
the left factor applied first. `Skeleton::transform` (client `FUN_00611690`,
lnxded 0x083420f0) sets `root.world = root.local × A` and chains the children.

| term | what | where |
|---|---|---|
| `rotate90aroundX` | static `dice::ref2::world` Mat4, rows (1,0,0,0) (0,0,1,0) (0,−1,0,0) (0,0,0,1): maps skeleton (x,y,z) → (x,−z,y). Built at start-up from cos/sin(−π/2) in both binaries: lnxded `__static_initialization_and_destruction_0` 0x0827ecb0 (site 0x0827eda5; `BaseMatrix4::set` 0x080503b0 stores its four Vec4 args as rows); client initializer at 0x00850d00 (θ = [0x008ea530]=π × [0x008eb504]=−0.5, rows to `Mat4::set` FUN_004020d0) filling `DAT_00990170`. Equal to `setRotateXDeg(+90)` in the engine's own convention (0x08251240: m5=c, m6=s, m9=−s, m10=c). | lnxded 0x0879d340, client 0x00990170 |
| `T(base + eased)` | the translation row of `S·M` is replaced by `(S·M).t + t·(S·M)_rot` with `t = BFSoldierTemplate+0x15c/0x160/0x164 + soldier+0x254/0x258/0x25c` (client: template +0x20c/0x210/0x214 + soldier +0x27c/0x280/0x284). `t` is therefore expressed in the frame *before* `S·M`: the camera's. | lnxded 0x0826efdd–0x0826f0dd |
| `S` | `soldier+0x4fc` (client +0x54c), identity from the constructor (lnxded 0x0826b9e5, client `FUN_004ff440`), written on the client by `BFSoldier::updateCameraShake` 0x004facd0: `getCameraShakeTransform` of the lower-body machine (× the shipped-zero `cameraShakeFactor`), the upper-body machine and the trigger machine, multiplied together. It is the "extern camera trans" (`getExternCameraTrans`, a stub on the server) the camera itself rides, so it cancels in view space — the rig is bolted to the shaken camera, not shaken again. | client 0x004facd0 |
| `M` | `ICompositeObject::getRelativeTransformation()` of the soldier's active camera (`*(soldier+0x3f0)` → element → `+8` → `queryInterface(IID_ICompositeObject 0xc378)` → vtable slot +0x74 lnxded / +0x70 client). The SoldierCamera's transform relative to the soldier — i.e. the view frame. | Camera vtable 0x087209a0 |

So in view space the whole first-person rig is `rotate90aroundX(skeleton) +
center1pHands + easedOffset`. **There is no yaw, pitch or aim rotation anywhere
in the chain.** The soldier's aim angles (`+0x284/+0x288`, degrees, clamped by
`setPointUpDownAngle` at template +0x194/+0x198) are used only on the
third-person path (0x0826f0ed: `setRotateXDeg`/`setRotateYDeg` onto torso
bones); the first-person branch never reads them.

### The base vector is `center1pHands` (VERIFIED, both binaries)

`BFSoldierTemplate+0x15c` is written by the `center1pHands` console word:
lnxded `ConsoleClass178::executeObjectMethod` **0x082bbaf0** —
`getActiveTemplate(CID_BFSoldierTemplate)` then stores the Vec3 at
`+0x15c/+0x160/+0x164`; client execute `FUN_004ca700` @ **0x004ca700**
(registrar `FUN_004ca600`, string 0x008dfd44, type `Math::Vec3`) stores
`+0x20c/+0x210/+0x214` of the template from `FUN_005091c0()`, the very fields
`updateAnimations` adds. The constructor zero is only the default; vanilla
ships `-0.12/-1.56/0.1`, FH and FHSW `-0.06/-1.56/0.1`. Two neighbours settled
at the same time: `setCharacterHeight` → `+0x158` (lnxded `ConsoleClass173`
0x082bb700; the −0.9 default is the third-person skeleton's y placement,
`R90x + (0, characterHeight, 0)` at 0x0826e965) and `set1pFov` → `+0x1a0`
(lnxded `ConsoleClass180` 0x082bbe40; client +0x250).

The earlier "no setter writes +0x15c" search looked only at *named*
`BFSoldierTemplate::set*` symbols. The console words are anonymous-namespace
`ConsoleClassNNN` objects whose `executeObjectMethod` is reached through the
vtable slot +0x4c; the name table never mentions the property.

### What the 1P skeleton holds under the arms (VERIFIED, lnxded; client twins by shape)

`AnimationStateMachineInstance::updateAnimations(Skeleton&, int clipIndex,
int mask)` (lnxded 0x0832aed0, client `FUN_00613280`) **returns without
touching the skeleton when `clipIndex >= the state's clip count`**
(0x0832af36). `BFSoldier::updateAnimations` passes `isFirstPerson &&
soldier+0x50 == 0` as the index — slot 0 is a state's 3P clip, slot 1 its 1P
clip — and `updateState(dt, int, weaponName)` (0x0832b270, client
`FUN_00613c60`) gets the magic 0x3a for the lower-body machine in first
person, which resolves to "slot 1 if the state has two clips, else slot 0"
(0x0832b4a5). No `Lb_*` state declares a 1P clip (85 states parsed, 0 with
one). So in first person the lower-body machine applies **nothing**: Bip01,
the pelvis and the legs sit at the `.ske` rest that `BFSoldier::setFirstPerson`
(0x0826d130) restores by copying every bone's local matrix from the template
skeleton (`BFSoldierTemplate+0x284`, stride 0xe8, loop at 0x0826d3d9) after
`Skeleton::removeAllPostAbsoluteBoneTransforms`. The upper-body machine then
plays the 1P clip (52 bones, spine up) on top.

The exporter used to pose the rig with `Lb_Stand` frame 0 under the 1P idle —
the third-person answer. Measured on `UsSoldier.ske` + `1PStandAimThompson`:
the two roots differ by a 178.7° rotation about X that the pelvis undoes, so
the hands end up only *translated*, by (−1.3, +6.4, −9.0) cm in mesh (x,
forward, up). Under `center1pHands` −1.56 the rest pose puts the head bone
1.8 cm *below* the eye; the clip root put it 7.2 cm above. DICE tuned the
number against the pose the engine actually shows. `extract_viewmodel.py` now
bakes the rest lower body.

### What the upper-body machine does with that clip, in time (VERIFIED, both binaries; third pass)

Read to answer §7's pose question — is the retail pose a frame, a blend or a
pitch-driven sweep of `1PStandAimThompson` that "frame 0 over the rest" misses?
It is none of those. The runtime, from `AnimationStateMachineInstance::
updateState` (lnxded 0x0832b270, client `FUN_00613c60` decompiled) and
`BoneAnimation::applyOnSkeleton` (lnxded 0x0832ed60, client `FUN_0066b740`
decompiled), with the instance laid out as `+0x00 speedFactor (1.0 from the
ctor 0x0832ad90, never written by the soldier) · +0x20 state · +0x24 lastState
· +0x28 idleTimer · +0x2c AnimationInfo* cur · +0x30 phase · +0x34 weight ·
+0x38 AnimationInfo* prev · +0x3c prevPhase · +0x40 startPhase` and
`AnimationInfo = {Animation*, float speed, bool loop}` (12 bytes, the state's
vector at lnxded `+0xf4` / client `+0x150`):

- **The clip is indexed by a normalized phase, not by frames or seconds.**
  Each tick `phase += dt × clip.speed × speedFactor` (0x0832b4fa; client
  `param_1[0xc] += speed × *param_1 × dt`). `applyOnSkeleton(skel, phase,
  weight, mask)` takes `frac = modf(phase)` (+1 if negative), `frameA =
  int(frac × N) % frames`, `frameB = (frameA + 1) % frames`, and slerps
  the quaternion / lerps the translation by the remainder (0x832f1ed–
  0x832f26d, client lines 94–105). `N = frames` for a looping clip, so the
  wrap 12→0 is an ordinary interpolated interval; `N = frames − 1` for a
  one-shot, whose phase < 0 clamps to the first frame and > 1 to the last.
  **A full pass of any clip therefore lasts `1/|speed|` seconds whatever its
  frame count** — there is no frames-per-second anywhere in the engine.
  `1PStandAimThompson` at 0.1 is a 10 s breath; `1PFireThompson` at 10.0 is
  exactly the 0.1 s of the 600 rpm cycle; `1PReloadThompson` at its tweaked
  **0.21** is a 4.76 s pass against the 4.8 s `reloadtime` — DICE fitted the
  rate to the timer; `1PDeployThompson` at 1.0 is one second. The exporter's
  `BAF_FPS = 25` (which put the reload at 18 s and the sway at 4.8 s) is
  withdrawn, and with it the reload's `bakedSpan / reloadTime` stretch,
  which had been reproducing the 4.8 s by construction.
- **Speeds are what `set1pAnimationSpeed` / `set3pAnimationSpeed` say,
  not the `addAnimation` value.** `animations/{1p,3p}AnimationsTweaking.con`
  run from `AnimationStates.con` after every state is created and cloned
  and name the state outright; `Ub_RunForwardThompson` is declared at 0.7
  and plays at **1.40**. The files are the output of a developer hot-key
  tuner — `BFSoldier::handleFrameUpdate` 0x08271820–0x0827192c probes four
  key codes through the input service and adds `±1·dt` / `±3·dt` to the
  current state's clip speeds via `AnimationStateMachineInstance::
  changeAnimationSpeed(float, float)` 0x0832be00 →
  `AnimationState::changeAnimationSpeed` 0x083287a0 (adds to
  `clips[0].speed` / `clips[1].speed`, sets the `+0x5` dirty flag that
  `writeAnimationSpeedChanges` 0x08328aa0 serialises). Those two call sites
  are the **only** callers of `changeAnimationSpeed` in the binary; nothing
  in gameplay changes a clip's rate. `bf42/animstates.py` now applies the
  tweaking lines.
- **Entering a state blends toward its clip at `setMorphFactor` per
  second, against whatever the skeleton currently holds.** `weight` (+0x34)
  starts at 0 on entry (or 1 when the state's factor exceeds `.rodata`
  1000.0, 0x0832b481) and climbs `dt × state+0x2c` (client `state+0x34`)
  per tick (0x0832b50c), clamped at 1. `Skeleton::setRelativeBoneTransform
  (idx, quat, trans*, weight)` (lnxded 0x0832f6e0, client `FUN_0066b5c0`)
  writes the pose outright at `weight ≥ 1` and otherwise `slerp(fromMat
  (current local), quat, weight)` / `cur + (trans − cur)·weight`. The
  `+0x38` "previous clip" slot that `setCurrentState` 0x0832b150 parks is
  cleared by `updateState` on the very next tick whenever the new state has
  a clip at the slot (`if (prev && cur) prev = 0`, both binaries), so the
  two-clip path in `updateAnimations` (0x0832af74, weight `1 − w` on the
  old clip) is dead in practice: the crossfade is a single clip fading in
  over the last pose. Constructor default 5.0 (0x08328bf8, a 0.2 s fade).
  `Ub_StandAimThompson` sets **0.7** (1.4 s to settle onto the sights after a
  burst), `Ub_FireThompson` 4.0, `Ub_StandRaiseWeaponThompson` 10000 (a cut).
  The viewer's 0.15 s / 0.02 s stand-ins are withdrawn for
  `1 / morphFactor`, carried per family in the glb extras.
- **What ends a one-shot, and the idles.** `AnimationState::update(phase,
  weaponName)` (lnxded 0x08329f00, client `FUN_00613a80`) returns the
  state's `returnToState` / `addTransitionWhenDone` target (`+0xc0`,
  resolved lazily from the `+0xc4` string; the literal `_POSE_` → 0xffff →
  the instance's base state `+0x1c`) once `phase > 1` (or `< 0` for a
  negative speed), else −1; `updateState` then `setCurrentState`s and
  recurses once. Idle fidgets: on every state change `+0x28 = (rand & 3) +
  4.0` s (0x0832b2d9, `.rodata` 0x086c0304), counted down per tick;
  `AnimationStateMachineInstance::checkTransitions()` 0x0832be50 (from
  `AnimatedBundle::handleVisualUpdate` 0x08265730) hands it to
  `AnimationState::checkTransitions(float)` 0x0832a390, which at ≤ 0 picks
  `rand() % n` of the `addIdle` vector (`+0xd4`, `CompoundStateInfo` pairs)
  — `Ub_IdleThompson1..3`, one-shots at their tweaked 0.52 / 0.39 / 0.50
  whose `addTransitionWhenDone Ub_StandAimThompson` brings the aim clip
  back through the 0.7 fade. `setUserRandomStartTime` (`state+0xa`) starts a
  loop at `(rand & 0xff) / 255` (0x0832b413, `.rodata` 0x086c08a0 = 255.0);
  vanilla uses it once, not on any weapon state. Instance `+0x40` is a
  start phase applied when > 0; nothing on the soldier writes it.
- **The mask.** `BFSoldier::updateAnimations` passes −1 in first person and
  `0x10004` in third when the soldier is farther than 100 m
  (`soldier+0x264`, client decompile `local_15c`). `applyOnSkeleton` strips
  bit 0x10000 as "write frame A straight into the bone local, no blend, no
  interpolation" (0x0832eeb7, client line 108) and treats the rest as the
  highest bone level to touch (`bone+0xcc`, 0x0832ef1b) — a distant-LOD
  cheapening. In first person every one of the clip's 52 bones is applied,
  interpolated and weighted.
- **Nothing else reaches a first-person bone.** `Skeleton::transform`
  (0x083420f0, read in full) has exactly two hooks besides the parent
  chain: a post-absolute rotation (`bone+0x88` Mat4*, multiplied into the
  world rotation with the translation kept, 0x8342308–0x8342454) and an IK
  slot (`bone+0xe0` → `applyIK2BoneSolver` 0x083418f0, whose result rows
  overwrite the world rotation). The post-absolute writer is virtual
  (`AnimatedBundle::setPostAbsoluteBoneTransform` 0x082656d0, no direct
  call site) and on the client is called only inside the third-person
  block of `FUN_004fb150` (the `FUN_004f7ca0(pitch)` calls, lines 200–330,
  all under `if (local_16c == 0)`); `setFirstPerson` clears them
  (`removeAllPostAbsoluteBoneTransforms` 0x083418b0). The IK slot's only
  writer is `Skeleton::applyIk` 0x08342610, whose only caller
  `AnimatedBundle::updateIk` 0x08265880 walks the parent chain for
  `IID_IPlayerControlObject` (0x086d3c50) and checks the occupant against
  `CID_BFSoldierTemplate` (0x086c2b88) before touching a bone — hands on a
  vehicle's controls, never a soldier on foot. The lower-body machine's
  `updateAnimations` is not even called in first person (client loop
  `if (!isFirstPerson || i != 0)`), the third-person lean
  (`soldier+0x3ec × 90°`, eased at 3/s from the `+0x416` movement bits) sits
  in the same third-person block, and the three by-reference floats
  `AnimationState::checkTransitions` returns (`state+0xc8/0xcc/0xd0`,
  default 1.0) are per-state locomotion multipliers consumed by
  `handlePlayerInput` 0x0827562a and `BFSoldierNetworkable`, not pose.
  Lead 5 of the pose question is closed: **no aim-pitch, IK or lean term
  runs on the first-person path.**

**So the first-person pose is exactly the current `Ub_*` state's 1P clip,
sampled at a phase that only advances with time, over the `.ske` rest.**
Measured on the shipped data under the §3 chain (57.30° vertical, 1280×720,
`center1pHands` + the Thompson hip offset): across all 13 frames of
`1PStandAimThompson` the right hand bone moves 3.6 px vertically, the left
hand 2.8 px, a point 0.55 m down the barrel 3.2 px; the walk/run clip
(`1pRunThompson`, 17 frames) holds the far end ~20 px lower than the aim
clip and swings the near hand 47 px laterally; `1PDeployThompson`'s last
frame is the aim clip's frame 0 to the pixel. No frame, blend or idle of the
aim family can put the far end 60–70 px lower, and nothing in the machine
depends on the aim pitch. The residual in the capture is not an animation.
Re-rendered headless with the re-exported rig (engine timing, tweaked
speeds, morph factors): right hand bone (819.5, 614.8), left hand (697.9,
478.1), muzzle end (702.8, 427.8) at 57.30° / 1280×720 — the same pixels as
before the pass, as the measurement predicts.

### Axis and sign conventions (VERIFIED)

- The view frame is D3D's, left-handed: +x right, +y up, +z forward.
  `convertWorldPosToScreenPos` (client 0x00440790, bf42plus-hooked) transforms
  by view then projection as row vectors, divides by the view-space **z**
  (visible when z > 0) and maps +x straight to screen-right, −y to
  screen-down. The `x` of `center1pHands` / `soldierCameraPosition` is
  therefore lateral with **positive = the viewer's right**; vanilla's −0.12
  carries the rig 12 cm left of the eye. Q1's "sign convention of x" is
  closed.
- The raw `.ske` frame has its up axis along −z (the pelvis at z = −0.93);
  `rotate90aroundX` is exactly what stands it up. Our `ske.py` mirrors z at
  parse time, so in the parsed (mesh) frame the engine's placement reads
  `(x, y, z)_mesh → (x, z, y)_view` — the axis swap the exporter's Z-up pitch
  plus the glTF handedness flip already perform, which is why the viewer's
  mount is a bare half-turn about Y and a translation.
- `soldierZoomPosition` uses the same frame; zooming the Thompson from
  `-0.01/-0.04/0.09` to `-0.05/-0.01/0.08` moves the gun 4 cm left, 3 cm up
  and 1 cm back toward the eye.

### Interpolation answer (unchanged)

Hip↔zoom is **eased, not snapped**: exponential at **25% of the remaining
distance per visual update** (`BFSoldier::handleVisualUpdate` 0x08270fd0,
constant 0.25f at `.rodata 0x086c08ac`, no dt). The FOV factor converges
faster (0.7·cur + 0.3·target) and snaps within 0.001, each step calling
`BFSoldier::applyFovModifier` 0x0826d490.

### Fields of view (VERIFIED where marked)

- **The camera's FOV is not `set1pFov`.** `RenderView::setFieldOfView(float)`
  (lnxded 0x08444260) keeps the value at `+0x24`, remembers the first value
  ever set as `m_startFov` (0x0874c5f4), and stores `tan(fov/2) /
  tan(startFov/2)` at `+0x1c` (`getFieldOfViewModifier`).
  `Frustum::setupFrustum(fov, aspect, near, far)` (0x08440c70) uses `fov/2`
  as the top/bottom half-angle and `fov/2 / aspect` for the sides (the
  constructor's aspect is 0.75 = h/w, near 0.1, far 1000, 0x08444150). The
  value is a whole **vertical** angle in **radians**;
  `Settings/VideoDefault.con` sets `renderer.fieldOfView 1` = 57.30°. A
  soldier's `vehicleFov` (`PlayerControlObjectTemplate+0x248`, 0x0831c060, a
  different field from set1pFov's +0x1a0) is unset, so `Camera::setVehicleFOV`
  (0x081aadd0) leaves the render view at that default.
- **`set1pFov` belongs to the first-person parts.** `BFSoldier::setFirstPerson`
  calls `dice::ref2::world::setFirstPersonFov(ICompositeObject*, float)`
  (lnxded 0x0826b330, client `FUN_004f7120` @ **0x004f7120**, decompiled) with
  `template+0x1a0` on entry and −1.0 on exit; `applyFovModifier(f)` calls it
  with `f × template+0x1a0` where `f` is the eased `SoldierZoomFov` factor. It
  walks the children (skipping `KitPartTemplate` 0x94a3 /
  `ActiveKitPartTemplate` 0x94bc, recursing into `EffectBundleTemplate`
  0x9474), and for each part with a geometry component queries
  `IID_IViewModifier` (0xf0e2bbfa; client 0x0090350c, lnxded 0x086e6788) and
  calls its slot +0xc — `BStandardMesh::setFieldOfView(float)` (0x083b5560),
  which stores the float at mesh `+0xf0` (−1.0 = none). `StandardMeshRenderer`
  has a dedicated `drawFov(bool)` pass next to `drawOpaque`/`drawTransparent`
  (0x083b7590, a stub on the server). **So yes: the 1P parts get their own
  field of view, `set1pFov × SoldierZoomFov`, drawn in their own pass, and
  they do not follow the camera's zoom.** How that pass turns 0.47 into a
  projection, and whether it moves the near plane, is client-renderer code
  (the pass reads the mesh field directly; the four `IID_IViewModifier` users
  in the client are all setters) — **OPEN**. What the footage rules out: a
  0.47 rad whole angle under the world's formula would draw the arms 2.3×
  larger and off the bottom of the frame; at the hip they appear at the
  world's FOV. `SoldierZoomFov` also scales the zoomed mouse deltas
  (0x0050095f), as before.
- `zoomFov` (the camera side of zoom) is taken as an absolute FOV in the same
  unit — INFERRED from the `vehicleFov` path replacing the view FOV wholesale;
  the camera-mode switch itself (0x004fc8b6) remains a raw-byte read.

### Verified against the retail capture (1280×720, Thompson on Wake)

With the chain above, the rest lower body, `center1pHands` and the hip
offset, the world at 57.3° vertical and no free parameter: the right hand
bone projects to (819, 615) and the retail right hand sits at about
(800–840, 590–640); the gun runs up into the screen at the retail angle
without any yaw term — the 0.35 rad the previous calibration added was
compensating for the Lb_Stand pose, not for the mount. What remains is
systematic and not in this chain: retail holds the far end lower — front
sight ≈ (720, 485) across ten frames against (700, 415) rendered, left hand
≈ (690, 545) against (700, 470), about 60–70 px or 5°, while the near right
hand differs by ~25 px. The candidate is the frame or blend of
`1PStandAimThompson` the upper-body machine actually holds (the retail sight
also drifts ~20 px between looking up and down, which a camera-space rig
with a fixed pose cannot do) — OPEN, see §7. The idle sway itself is under
10 px on both sides.

## 4. Q3 — alt-fire zoom semantics (VERIFIED core, edges inferred)

- **Press-toggle, not hold.** `altFireOnce 1` drives a client-side input filter
  (0x00500901–0x00500943, same gap function): unless the weapon allows repeated
  alt-fire, the *held* AltFire input (channel 23, mask 0x800000) is zeroed in the
  input copy so only fresh presses reach the weapon. Each press toggles zoom; the
  camera state machine switches between modes 0 and 2 (0x004fc849–0x004fc8e2,
  raw-byte read; picks (0,2) or (2,0) transitions off the current zoom state).
- **Zoom is dropped by**: `FireArms::Reload` (lnxded 0x08289d80 → setZoom(false) at
  0x08289e10), weapon switch/holster (`HandFireArms::disable` 0x08293da0 →
  setZoom(false)), and — when `UnZoomBetweenFireTime > 0` — around each shot:
  the fire path sets a pending flag (+0x20c) and `FireArms::handleUpdate`
  (0x08288890) un-zooms/re-zooms against the zoom timer (+0x1cc) when the template
  time (lnxded +0x268) is non-zero. That is the sniper bolt-cycle un-zoom.
- **Movement does not break zoom**: no such path was found in setZoom /
  handleUpdate / handlePlayerInput. Stated as an inferred negative.
- Server side, zoom state arrives as a networked soldier state bit
  (`BFSoldier::setStateBits` 0x0827e200 → `setIsZoomed` 0x0827e100); the toggle
  decision is purely client-side.

---

## 5. What the viewer should change

Current viewer approximations, judged:

| Viewer assumption | Verdict |
|---|---|
| Additive combine of channels | **CONFIRMED** — total = minDev + fire + speed + turn + misc |
| `dev = min·devMod[stance] + …` (devMod multiplies minDev) | **REFUTED** — minDev is *not* scaled by devMod; devMod scales the dynamic channels (caps ·M, raises ·M², decays ÷M) |
| Aiming/zoom × 0.5 | **REFUTED** — zoom has zero effect on deviation |
| Fire bloom: add per shot, linear decay | **CONFIRMED** — +fireDev.b per shot clamped to fireDev.a; decay fireDev.c/M per tick (hand weapons) |
| 60 Hz decay clock | **REFUTED as stated** — decay is per handlePlayerInput call with no dt; cadence = game update rate, not a fixed 60 Hz |
| Speed/turn terms ~ analog input | **Half right** — turn terms scale with |mouse look| (channels 4/5); speed terms are *binary* gates (>0.01) on throttle/yaw, constant magnitude |
| miscDev = airborne/swim/vehicle? | **SETTLED** — jump (c_PIAction) only |
| Weapon drawn in world pass at soldier FOV 53.86 | **REFUTED on both counts** — the camera runs at `renderer.fieldOfView 1` = 57.30° vertical; `set1pFov 0.47` is the 1P parts' own FOV (`setFirstPersonFov` → `IViewModifier::setFieldOfView`, own `drawFov` pass), multiplied by `SoldierZoomFov` when zoomed while the camera goes to `zoomFov`. Placement: rig = rotate90aroundX(skeleton) + center1pHands + eased offset in view space, no rotation term |
| Calibrated x/y/z/yaw on top of `center1pHands` (VIEWMODEL_CAL) | **REFUTED** — the chain has no free parameter; the 0.35 rad yaw compensated for posing the rig on `Lb_Stand` frame 0, which the engine never applies in first person |
| Rig posed on `Lb_Stand` + 1P idle | **REFUTED** — the lower-body machine applies nothing in first person (clip slot 1 absent); root, pelvis and legs are the `.ske` rest |
| The 1P pose is the idle clip's frame 0 | **CONFIRMED to within 4 px** — the engine samples the clip at a time-only phase with slerp between adjacent frames; all 13 frames of `1PStandAimThompson` are within 3.6 px of each other, so frame 0 is representative, and the 5° residual is not a frame choice |
| A clip lasts `frames / 25 fps / speed` (`BAF_FPS`) | **REFUTED** — a pass is `1/\|speed\|` s regardless of frame count (`updateState` phase += dt·speed, `applyOnSkeleton` frac(phase)·N); the fire clip at 10.0 is the 0.1 s shot cycle, the sway 10 s, the reload 4.76 s at its tweaked 0.21 |
| Clip rates are the `addAnimation` values | **REFUTED** — `{1p,3p}AnimationsTweaking.con` (run last, by state name) override them; run 0.7 → 1.40, reload 0.4 → 0.21. Parser now applies them |
| Reload rescaled by `bakedSpan / reloadTime` | **WITHDRAWN** — the engine plays the reload at 1/0.21 = 4.76 s against the 4.8 s timer; the fit was reproducing the data |
| Crossfade 0.15 s (fire 0.02 s) stand-ins | **REFUTED** — weight ramps at the target state's `setMorphFactor` per second against the current pose (default 5, ≥1000 cuts): aim 0.7 → 1.4 s, fire 4.0 → 0.25 s, deploy/reload 10000 → cut |
| An aim-pitch, IK or lean term shapes the 1P arms | **REFUTED** — none on the first-person path in either binary; IK is seated-in-vehicle only, post-absolute rotations third-person only |

---

## 6. Address index (client `BF1942.exe`)

| address | what | how established |
|---|---|---|
| 0x00551f50 | `HandFireArms::updateDeviation(bool)` | decompiled in full; matches lnxded 0x08293e80 |
| 0x00539620 | `FireArms::updateDeviation` (base) | decompiled; matches lnxded 0x0828d410 |
| 0x00551930 | `HandFireArms::getDevMod` | decompiled; matches lnxded 0x08294400 |
| 0x0053a110 | `FireArmsTemplate::makeScript` | decompiled; property-name/offset rosetta |
| 0x004cf9d0 | console `setDevMod` execute | decompiled; stores +0x58c/0x590/0x594 |
| 0x004d2c40 | console `soldierCameraPosition` execute | decompiled; +0x3f0 via adjusted ptr |
| 0x004d2a30 | console `soldierZoomPosition` execute | decompiled; +0x3e4 via adjusted ptr |
| 0x008f9750 | `HandFireArms` vtable (updateDeviation slot +0x174) | memory read; slot pointers resolved |
| 0x008dcd10 | `CID_BFSoldierTemplate` global (0x9493) | read in getDevMod |
| 0x0050095f | zoomed mouse-scale + SoldierZoomFov read | raw-byte disassembly (function gap) |
| 0x004fc8b6 | zoom camera-mode 0↔2 switch | raw-byte disassembly (function gap) |
| 0x00500901 | altFireOnce edge filter (mask 0x800000) | raw-byte disassembly (function gap) |
| 0x004fb150 | `BFSoldier::updateAnimations` | decompiled in full; the 1P chain above |
| 0x00990170 | `world::rotate90aroundX` (static Mat4) | initializer 0x00850d00 read from raw bytes |
| 0x0040d2e0 | `BaseMatrix4::mult` | decompiled; row-vector product |
| 0x00611690 | `Skeleton::transform` | decompiled; root.world = local × M |
| 0x00613280 / 0x00613c60 | `AnimationStateMachineInstance::updateAnimations` / `updateState` | call shape + the 0x3a magic; lnxded 0x0832aed0 / 0x0832b270 |
| 0x004ca700 | console `center1pHands` execute | decompiled; template +0x20c..0x214 |
| 0x004facd0 | `BFSoldier::updateCameraShake` writes S (+0x54c) | decompiled |
| 0x004ff440 | `BFSoldier` constructor (identity S) | decompiled |
| 0x004f7120 | `setFirstPersonFov` | decompiled; IID_IViewModifier slot +0xc |
| 0x0090350c | `IID_IViewModifier` = 0xf0e2bbfa | memory read; matches lnxded 0x086e6788 |
| 0x00440790 | `convertWorldPosToScreenPos` (handedness: divide by view z, +x → right) | decompiled |
| 0x0066b740 | `BoneAnimation::applyOnSkeleton(Skeleton&, float phase, float weight, int mask)` | decompiled in full; lnxded 0x0832ed60 read alongside — phase→frame, slerp, 0x10000 flag |
| 0x0066b5c0 | `Skeleton::setRelativeBoneTransform(int, Quat const&, Vec3 const*, float)` | lnxded 0x0832f6e0 read in full; the weight blend |
| 0x00613a80 | `AnimationState::update(float phase, string const&)` → next state | decompiled via updateState; lnxded 0x08329f00 |
| 0x00613480 | `AnimationStateMachineInstance::setCurrentState(int)` | lnxded 0x0832b150 |
| 0x0054edd0 | `AnimationState` clip count (AnimationInfo stride 12) | call shape in both twins |
| 0x006937d0 / 0x00693820 | `CompressedAnim::GetQuat` / `GetTrans` | lnxded 0x0832fc90 / 0x0832fcf0 |
| 0x00462ca0 | `BaseQuaternion<float>::slerp` | lnxded 0x08226460 |

Key lnxded anchors (named): `HandFireArms::updateDeviation` 0x08293e80,
`FireArms::updateDeviation` 0x0828d410, `FireArms::Fire` 0x0828a090,
`FireArms::fireBarrel` 0x0828aba0, `FireArms::setZoom` 0x082881a0,
`FireArms::handleUpdate` 0x08288890, `FireArms::setAIDeviation` 0x0828e350,
`BFSoldier::handlePlayerInput` 0x08273c70, `BFSoldier::handleVisualUpdate`
0x08270fd0, `BFSoldier::updateAnimations` 0x0826e630, `BFSoldier::setFirstPerson`
0x0826d130, `BFSoldier::getPoseCameraPosition` 0x0827de00 (BFSoldierTemplate
+0x1a4 + pose·12), setters 0x0828faf0 (`setFireDev`), 0x0828fb20 (`setMinDev`),
0x08294740/70/a0 (`setTurnDev`/`setSpeedDev`/`setMiscDev`). Second pass: `rotate90aroundX` 0x0879d340 (init 0x0827ecb0),
`BaseMatrix4::mult` 0x08062440, `BaseMatrix4::set` 0x080503b0,
`setRotateXDeg` 0x08251240, `Skeleton::transform` 0x083420f0,
`AnimationStateMachineInstance::updateAnimations` 0x0832aed0 / `updateState`
0x0832b270, `ConsoleClass178/180/173::executeObjectMethod` 0x082bbaf0 /
0x082bbe40 / 0x082bb700 (`center1pHands` / `set1pFov` / `setCharacterHeight`),
`setFirstPersonFov` 0x0826b330, `BStandardMesh::setFieldOfView` 0x083b5560,
`StandardMeshRenderer::drawFov` 0x083b7590, `RenderView::setFieldOfView`
0x08444260, `Frustum::setupFrustum` 0x08440c70, `Camera::setVehicleFOV`
0x081aadd0, `PlayerControlObjectTemplate::setVehicleFov` 0x0831c060, the
`Camera` vtable 0x087209a0 (ICompositeObject slot +0x74 =
`getRelativeTransformation`).

## 7. Open items

- **The ~5° residual at the far end of the rig, and its ~20 px drift with
  pitch, are not the animation.** Closed on the animation side (§3, third
  pass): the upper-body machine holds the current state's 1P clip at a
  phase that advances only with time, blended in over the previous pose at
  `setMorphFactor`; `applyOnSkeleton`, `updateState`, `AnimationState::
  update`, `checkTransitions`, `Skeleton::transform`'s post-absolute and IK
  hooks and the client `updateAnimations` were all read, and none carries
  an aim-pitch, IK or lean term on the first-person path. Every frame of
  `1PStandAimThompson` lands within 4 px of every other; the deploy clip
  ends on the aim clip's frame 0; the run clip is only ~20 px lower at the
  far end. What is left, with the numbers to beat — retail front sight
  ≈ (720, 485), left hand ≈ (690, 545), right hand (800–840, 590–640) at
  1280×720 against the chain's (700, 415) / (700, 470) / (819, 615) — is a
  rotation of the rig by roughly 5° about the near hand, and it must come
  from something between the skeleton and the pixels: (a) the `drawFov`
  pass's projection (the sibling item below; a symmetric FOV change scales
  uniformly about the centre and does not fit, an asymmetric or
  differently-placed near plane might), (b) how the camera's
  `getRelativeTransformation` `M` relates to the view the pass actually
  renders with — the chain is rigid only if the pass's view is
  `inverse(M × soldierWorld)`, (c) whether the client camera really rides
  `S` (inferred from the server stub `getExternCameraTrans`; the `Ub_*`
  shakes are sinusoidal, so `S` cannot hold a 5° offset but could account
  for the drift if the camera does not follow it), or (d) the 16:9 capture's
  vertical field of view — `Frustum::setupFrustum` takes `fov/2` as the
  vertical half-angle and divides by an aspect the constructor sets to 0.75,
  so what a 1280×720 window does to the vertical angle is unread. Resume from
  the client `StandardMeshRenderer` vtable (`drawFov` slot) and the client
  twin of `Camera::getRelativeTransformation`.
- **The projection of the `drawFov` pass.** The 1P parts get their own FOV
  (`set1pFov × SoldierZoomFov`, verified above); how the client renderer turns
  the mesh's field into a projection matrix, and whether it moves the near
  plane, is untraced. Start from the client's `StandardMeshRenderer` vtable
  (lnxded order: `draw`, `drawFov`, `drawOpaque`, `drawTransparent`,
  `drawSilhouettes`, …) or from `RendPCDX8` reads of mesh `+0xf0`.
- **Exact client cadence of `handlePlayerInput`** (the deviation and easing
  clock). Every `handlePlayerInput` in both binaries is reached through the
  `IPlayerControlObject` vtable — no direct call site to anchor a read; the
  server calls it once per tick, the client per input dispatch. Still per
  call with no dt; the Hz is unmeasured.
- `zoomFov`'s unit on the camera side is inferred from the `vehicleFov` path,
  not read off the camera-mode switch (0x004fc8b6).
- `deviation` / `deviationCorrectionTime` .con words: registered in a different
  (dice::bf-layer) console block; `FireArmsTemplate+0x2ec` (lnxded) is a
  per-projectile random spread applied in `Fire` when > 0 — which .con word maps
  to it is unconfirmed.
- The `turnDev.b`↔MouseLookY / `turnDev.c`↔MouseLookX assignment relies on the
  string-table ordering of the c_PI enum plus the verified Fire=8 anchor;
  channels 4/5 themselves not independently confirmed.
