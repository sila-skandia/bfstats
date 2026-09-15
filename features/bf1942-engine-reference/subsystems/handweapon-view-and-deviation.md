# Hand-weapon first-person placement, deviation, and zoom

Settled 2026-09-15, first-person mount closed in a second pass the same day, the
clock and the zoom unit closed in a third (§2 "Clock", §3 "Fields of view",
§7), the renderer's `drawFov` pass and the animation runtime under the arms
read in the same pass (§3). Two binaries were read side by side:

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

**Pointer caveat (third pass).** `makeScript`'s `this` is itself an interface
subobject 4 bytes into the template: the pointer the *weapon* holds at
`FireArms+0x4c` — the one `FireArms::setZoom` 0x005391b0, the zoom camera-mode
switch 0x004fc849 and the zoomed mouse-scale 0x0050095f all dereference — sees
every row below **4 bytes higher** (`useScope` +0x3d8, `zoomFov` +0x3dc,
`SoldierZoomFov` +0x3e0, `soldierZoomPosition` +0x3e4, `soldierCameraPosition`
+0x3f0, `UnZoomBetweenFireTime` +0x3d4). Read the table against whichever
pointer the code in front of you is using; the lnxded column has no such split
(GCC's `[this+0x4c]` is the object start, `zoomFov` +0x270 in `setZoom`).

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

### Clock (VERIFIED, both binaries: one call per fixed 1/30 s tick)

There is **no dt anywhere** in either updateDeviation. Decay and raise amounts are
per *call*, and the call is one per `handlePlayerInput`. That call is made **once
per simulation tick of 1/30 s, on the client exactly as on the server**, and the
tick is independent of the frame rate. The chain, every link read in the client
and matched to its named lnxded twin (third pass, 2026-09-15):

| step | client | lnxded | what it does |
|---|---|---|---|
| the rate | `g_simulationFps` **0x00957640** = 30.0f | `g_simulationFps` 0x08716b5c = 30.0 | a `.data` float with 50 READ xrefs and no writer in the client, no console word in either binary (the only static initializer that touches it, lnxded 0x0813ad50, truncates it to an int for a `GhostManager` table) |
| the tick length | `Setup::initInputDevices` **0x00444e70**: `Setup+0x220 = new InputManager(g_simulationFps, 0x400)`, `Setup+0x184 = 1.0f / inputManager+0x1c` | `Setup::initInputDevices` 0x080be490: `Setup+0xcc = 1 / g_simulationFps` | the ctor (**0x0049d610**) stores the fps at +0x1c and sizes a ring of 1024 samples |
| the accumulator | `InputManager::update` **0x0049ce70** | `Setup::updateInputs` 0x080bc540 | `n = floor((getExactTime() − lastTick) / tickDt)` by repeated subtraction, `lastTick += n·tickDt`; a backlog above 10 ticks is dropped to 1 (statics 0x0097b5f8/…; lnxded `oldTime`/`thisSecond`/`ticksThisSecond` 0x08716b80/88/90). The client then polls the device once with `n·tickDt` and samples every registered input map `n` times (the extra ticks with 0 elapsed); `+0xc` = produced |
| the frame | `Setup::mainLoop` **0x0044abc0** | `Setup::mainLoop` 0x080bc090 | busy-waits to the frame cap `1/Setup+0x17c`, stores the frame dt at `Setup+0x180`, loops `Setup::updateInputs` **0x00449470** until `Setup+0x31c` (= produced − consumed, `InputManager::getPendingTicks` **0x0049d1c0**) is non-zero, then `g_game(0x0095f8d4)->update(nTicks, Setup+0x184)` (Game vtable vptr+0x28). The frame dt goes to rendering and `ObjectManager::handleFrameUpdates` (slot +0x18) — never into the simulation |
| the input | `Setup::updateInputs` **0x00449470** per tick: pop one `gameInput` sample (`FUN_0049cd40`), map it per local player (`FUN_0049d5b0`), hand it to **0x00448520** → `g_game->addPlayerInput` (vptr+0x2c = `Game::addPlayerInput` **0x0040ecb0**, a `list::push_back` on the `Game+0x2c` queue map; defined in Ghidra this pass), consumed++ (`FUN_0049cd80`) | `Game::addPlayerInput` 0x0805d900 | **one `PlayerInput` per local player per tick** |
| the update | `GameClient::update(int nTicks, float tickDt)` **0x0048fca0** | `GameServer::update` 0x08132940 | `nTicks > 9 → 1`; `processLocalPlayersInputs(nTicks)` **0x00488840** moves one queued input per tick into the `ActionBuffer` (`PlayerAction::set` 0x00483e70, `ActionBuffer::pushBack` 0x00484890, zero-filled when the queue is dry); then `nTicks ×` `simulateFrame(tickDt)` (vptr+0x13c; lnxded +0x140); then the queues are cleared |
| the tick | `GameClient::simulateFrame(float)` **0x004b6cb0** — the address bf42plus labelled "`World::update`" | `GameServer::simulateFrame` 0x0815c2a0 | `simulatePlayersUpdate(dt)` **0x004b6c20** → per player `simulatePlayerUpdate(player, dt)` **0x004b6a30**: `PlayerAction::get` 0x004913a0 pops **one** buffered action, then either `BFPlayer::handleInput(input, dt)` (slot +0x30, 0x004b6b90) or `controlObject->handlePlayerInput(player, input, dt)` (IObject slot +0x94, 0x004b6b56; GCC slot +0x98, lnxded 0x0815bde0); then `objectManager(0x0097d764)->updateObjects(dt,0,3)`, physics, collisions, game logic — all with the same `dt` |

So `dt` at `handlePlayerInput` is always **1/30 s**, and the deviation clock is
**30 Hz** — not the render rate, and not seconds. Two corroborations from the same
read: `BFSoldier::handlePlayerInput` advances the aim angles by
`look × dt × g_simulationFps` (lnxded 0x08274305 / 0x08274526), a factor that is
exactly 1 at the fixed tick and shows the engine treating an input sample as a
per-tick quantity; and `FireArmsTemplate::makeScript` 0x0053a110 multiplies a
stored per-tick field by `g_simulationFps` at 0x0053a9ba to print it back as
per-second. The viewer's `deviation.js` now ticks at `TICK_HZ = 30`.

The hip↔zoom **ease** is on a different clock: `BFSoldier::handleVisualUpdate` is
IObject vtable slot vptr+0x4c and its only callers are inside
`ObjectDrawer::objectsVisualUpdate` (lnxded 0x08198130, from `drawVisible(float)`)
— the draw pass, once per rendered frame. Deviation at 30 Hz, easing per frame;
the viewer keeps them apart the way the engine does.

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
  which stores the float at mesh `+0xf0` (−1.0 = none) **and bakes a
  projection matrix for it** — see "The drawFov pass" below, read in both
  binaries on 2026-09-15 (third pass). `StandardMeshRenderer` has a dedicated
  `drawFov(bool)` pass next to `drawOpaque`/`drawTransparent` (lnxded
  0x083b7590, a stub on the server; client 0x0062cb00, read). **So yes: the
  1P parts get their own field of view, `set1pFov × SoldierZoomFov`, drawn in
  their own pass, and they do not follow the camera's zoom.**
- **`zoomFov` is an absolute FOV in the render view's unit — VERIFIED (third
  pass; was inferred).** Client `FireArms::setZoom` 0x005391b0 (twin of lnxded
  0x082881a0, read side by side in objdump) saves
  `g_renderView(0x009ab868)->getFieldOfView()` (IRenderView slot +0x18) into
  `weapon+0x1f4`, copies `zoomFov` into `+0x1f8`, publishes it as **component
  0x5000** through its own `setComponent` (slot +0x28; lnxded slot +0x2c at
  0x0828826c–0x08288283, the only other publisher being the
  `UnZoomBetweenFireTime` re-zoom in `FireArms::handleUpdate`, client
  0x0053eaad), and on the apply/restore path at 0x005393d9–0x005393f6 writes
  the `+0x1f8` value straight into slot +0x14 = `RenderView::setFieldOfView
  (float)` — the same slot `Camera::setVehicleFOV` 0x081aadd0 uses for
  `vehicleFov` (lnxded RenderView vtable 0x0874c600: vptr+0x14 set, +0x18
  get). No conversion anywhere: the Thompson's `zoomFov 0.5` is a 28.6°
  vertical field, a sniper's 0.1 is 5.7°. The camera-mode switch
  (0x004fc849–0x004fc8ea, decoded from the PE bytes) only picks the 0↔2
  camera transition: `isZoomed() && useScope` → `(0, 2)` on soldier and weapon
  (slot +0x28), else `zoomFov > 0` → `(2, 0)`; it never touches the value.
- **Correction:** the zoomed mouse deltas are scaled by **`zoomFov`, not
  `SoldierZoomFov`**. The site 0x0050095f multiplies the two look locals by
  `[[weapon+0x4c]+0x3dc]`, and off that pointer +0x3dc is the field `setZoom`
  tests first and publishes as the zoom FOV; `SoldierZoomFov` is +0x3e0 there
  (§1 pointer caveat). Since `renderer.fieldOfView 1` makes the default FOV
  1.0 rad, multiplying by `zoomFov` is multiplying by the zoomed/default FOV
  ratio — which is also why the unit had to be radians.

### The drawFov pass (VERIFIED, client read in full; lnxded for the shared halves)

The projection the 1P parts are drawn with is not built by the pass. It is
built **when the field of view is set**, by the mesh, from the render view:

```
BStandardMesh::setFieldOfView(fov)             client 0x005ad160, lnxded 0x083b5560
  mesh+0xf0 = fov
  if fov != -1.0:
    saved = pRenderView->getFieldOfView()      RenderView slot +0x18
    pRenderView->setFieldOfView(fov)           slot +0x14  (marks +0x311 dirty)
    memcpy(mesh+0xf4, pRenderView->getProjectionMatrix(), 64)   slot +0x64
    pRenderView->setFieldOfView(saved)
```

(`0x005ad160` was compiled against the `IViewModifier` subobject at mesh+0x18,
so it reads as `[this+0xd8]`/`[this+0xdc]`; the fields are mesh+0xf0/+0xf4 in
both binaries.) `getProjectionMatrix` calls `updateProjectionMatrix` first
(client 0x005b7fb0, lnxded 0x08444870), so the copy is the render view's
perspective for the mesh's own angle, with the render view's **current**
aspect, near and far. That matrix, in the engine's row-vector convention, is

```
m00 = cot(fov/2) · aspect      m11 = cot(fov/2)
m22 = (near+far)/far           m23 = 1
m32 = −near · (near+far)/far   m33 = 0        (all other entries 0)
```

— a D3D left-handed perspective whose `fov` is a **whole vertical angle in
radians** and whose `aspect` is **height/width** (the z terms are the
first-order form of `far/(far−near)`; identical for near 0.1, far 1000).
The client's `RenderView` (vtable 0x00905c98, constructor 0x005b8120)
defaults to aspect 0.75, near 0.1, far 1000 and FOV `g_degToRad × 60` =
60°; `Renderer_initDevice` 0x00462f50 then sets `aspect = height/width` of
the current display mode (RendPCDX8 slot +0x30), so at 1280×720 the 1P
matrix is built with 0.5625, and `renderer.fieldOfView 1` in
`VideoDefault.con` puts the world at 1.0 rad. Nothing on the first-person
path calls `RenderView::setNearPlane` (client 0x005b7cd0): **the 1P parts
keep the world's near plane, 0.1 m.** The mesh field is also a LOD switch:
`StandardMesh_selectLod` 0x005adfd0 returns LOD 0 whenever mesh+0xf0 is set.

The pass itself is sequenced by `Renderer_drawView` 0x004662c0, once per
view, on the client:

1. `pRenderView = view+0x94`; unless `getPlayerDefinedFOVEnabled()` (slot
   +0x78) the render view takes the camera's FOV; `RendPCDX8_setViewMatrix`
   0x0045fd50 / `RendPCDX8_setProjectionMatrix` 0x0045fdc0 push the world's
   matrices (`IDirect3DDevice8::SetTransform` slot 0x94 with D3DTS_VIEW = 2 /
   D3DTS_PROJECTION = 3).
2. `g_standardMeshRenderer` 0x009a9468 → `drawOpaque` (slot +0x1c) and
   `drawTransparent` (+0x20); deferred state flushed (0x00604750).
3. Gated on `Renderer+0xda` (the same flag that draws the meshes at all):
   unless `g_pIGame` slot +0x74 returns 4, **`RendPCDX8_clear(2, 0, 1.0, 0)`
   0x00667680 — the depth buffer cleared to 1.0** (device `Clear`, slot 0x90,
   flag mapped through RendPCDX8 slot +0x1f4); then a state block
   (0x006038c0): `D3DRS_AMBIENT = Renderer+0xa4`, `SetLight(0, &Renderer+0x44)`,
   `D3DRS_LIGHTING = 1`, light 0 enabled, `D3DRS_SPECULARENABLE = 1`,
   `SetTextureStageState(0, D3DTSS_MIPMAPLODBIAS, −10000)` — the parts always
   sample the finest mip; **`drawFov(Renderer+0xdc)` (slot +0x18)**; block
   popped (0x00603900).

`drawFov` 0x0062cb00 is `drawOpaque` 0x0062cc70 with other lists: pass id
`g_meshPassId` 0x009c9be4 = 2, the `Shaders/SkinningShader2Bones` vertex
shader bound (0x00570630) for list +0x88 (skinned `StandardMesh`es, drawn
through vtable slot +0x48 = `StandardMesh_drawSkinned` 0x005b06d0), then
unbound for list +0x68 (everything else, through `AnimatedMesh_drawByContext`
0x0062b8d0 → `AnimatedMesh_drawLod` 0x0062b2f0 / `StandardMesh_drawLod`
0x005aeec0). Meshes reach those lists per frame through
`StandardMeshRenderer::drawMesh` 0x0062c690 / `drawAnimatedMesh` 0x0062c620,
which put any mesh with `+0xf0 != −1` on the fov lists. Every draw path
honours the baked matrix:

- fixed function (`StandardMesh_drawLod`, `AnimatedMesh_drawLod`): if
  `mesh+0xf0 != −1`, `SetTransform(D3DTS_PROJECTION, mesh+0xf4)` immediately
  before `SetTransform(D3DTS_WORLD, …)` (0x005aefa4), and after the blocks
  `SetTransform(3, renderView->getProjectionMatrix())` restores the world's.
  The deferred-state layer cannot undo this: `RendPCDX8_drawPrimitives`
  0x00667d40 flushes only ids a popped block made pending (0x00603900), and
  the projection is never popped inside the pass.
- vertex shader (`StandardMesh_drawSkinned`): at 0x005b091c the matrix
  product fed to the shader constants takes `mesh+0xf4` instead of
  `renderView->getProjectionMatrix()` when the field is set.

The 1P parts in the data are `SimpleObject` children of the soldier
(`USSoldier1PBody`, `1pUSSoldierRightHand`, `1pUSSoldierLeftHand`, all
`setIsFirstPersonPart 1`, geometry `AnimatedMesh` + `.skn`), reached by
`setFirstPersonFov`'s child walk; the weapon is reached by `addItem` /
`enableItem` (lnxded 0x08277bd0 / 0x08278460, `isFirstPerson ?
template+0x1a0 : −1`). The client hands `template+0x250` (0.47) or −1 at every
site (0x004f9610, 0x004f9867, 0x004f9c24, 0x004fa103, and `setFirstPerson`
0x004fae80 itself); `applyFovModifier` 0x004f7290 runs from
`handleVisualUpdate` 0x004fc2d0 **only while the zoom factor is easing**.

**Where it stops matching: the retail capture.** With the placement chain of
this section, the world's 57.3° puts the right-hand bone at (816, 614) — in
the retail box (800–840, 590–640) — while the engine's own 0.47 rad puts it at
(1042, 939), off the frame, the left hand at (768, 631) against retail
(690, 545), and the muzzle at (762, 492) against the front sight (720, 485).
Ten frames across both clips show the arms at natural size; none is zoomed.
So the retail client draws the parts at the world's projection, which no
static path above produces once `mesh+0xf0` holds 0.47. The data says 0.47
(`CommonSoldierData.inc` read from the archive), bf42plus patches nothing on
this path, and the parts' geometry exists when `setFirstPerson` walks them.
What is left is runtime: something between spawn and the frame either never
delivers 0.47 to these meshes or hands them back −1. See §7.

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
| 60 Hz decay clock | **REFUTED — it is a fixed 30 Hz** — decay is per handlePlayerInput call with no dt, and the client makes one call per simulation tick of `1/g_simulationFps` = 1/30 s regardless of frame rate (§2 "Clock"). `deviation.js` `TICK_HZ` is now 30 |
| Hip↔zoom ease steps on the same clock as deviation | **REFUTED** — `handleVisualUpdate` is called from the drawer (`ObjectDrawer::objectsVisualUpdate`), once per rendered frame; the viewer's per-frame ease is right |
| Zoom scales the mouse by `SoldierZoomFov` | **CORRECTED** — by `zoomFov` (0x0050095f reads +0x3dc off the weapon's template pointer, which is `zoomFov` there) |
| `zoomFov` is in the render FOV's unit (radians, whole vertical angle) | **CONFIRMED** — `FireArms::setZoom` 0x005391b0 writes it into `RenderView::setFieldOfView` verbatim |
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
| 0x0050095f | zoomed mouse-scale × **`zoomFov`** (`[[weapon+0x4c]+0x3dc]`; corrected from "SoldierZoomFov") | raw-byte disassembly (function gap), gated by `FireArms::isZoomed` slot +0xf8 |
| 0x004fc849–0x004fc8ea | zoom camera-mode 0↔2 switch, decoded: `isZoomed && useScope` → (0,2), else `zoomFov > 0` → (2,0), slot +0x28 on soldier and weapon | objdump of the PE bytes (function gap) |
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
| 0x00957640 | `g_simulationFps` = 30.0f | memory read; 50 READ xrefs, no writer; lnxded 0x08716b5c |
| 0x0044abc0 | `Setup::mainLoop` | decompiled; `game->update(Setup+0x31c, Setup+0x184)`; lnxded 0x080bc090 |
| 0x00449470 | `Setup::updateInputs` (one input per local player per tick) | decompiled; lnxded 0x080bc540 |
| 0x00444e70 | `Setup::initInputDevices` (`Setup+0x184 = 1/fps`) | decompiled; lnxded 0x080be490 |
| 0x0049d610 / 0x0049ce70 / 0x0049d1c0 | input manager ctor / `update` (the tick accumulator) / `getPendingTicks` | decompiled |
| 0x00448520 | per-player hand-off → `Game::addPlayerInput` | decompiled (ends in vptr+0x2c) |
| 0x0040ecb0 | `Game::addPlayerInput` (queue push; **defined in Ghidra this pass**) | raw bytes then decompiled; lnxded 0x0805d900 |
| 0x0048fca0 | `GameClient::update(int nTicks, float tickDt)` (**defined in Ghidra this pass**) | decompiled; lnxded 0x08132940 |
| 0x00488840 | `GameClient::processLocalPlayersInputs` | decompiled; lnxded 0x081379b0 |
| 0x004b6cb0 | `GameClient::simulateFrame(float)` — relabels bf42plus's "`World::update`" | decompiled; GameClient vtable +0x13c at 0x008d8ee4; lnxded 0x0815c2a0 |
| 0x004b6c20 / 0x004b6a30 | `simulatePlayersUpdate` / `simulatePlayerUpdate` (the `handlePlayerInput(…, 1/30)` call, 0x004b6b56) | decompiled; lnxded 0x0815bfa0 / 0x0815bd00 |
| 0x005391b0 | `FireArms::setZoom(bool)` (`zoomFov` → component 0x5000 → `RenderView::setFieldOfView`) | objdump; lnxded 0x082881a0 |
| 0x0050ee00 | `FireArms::isZoomed` (HandFireArms vtable slot +0xf8) | vtable read; lnxded 0x08290160 |
| 0x009ab868 / 0x0095f8d4 / 0x0097d764 | `g_renderView` / `g_game` / `objectManager` | slot use matched to lnxded 0x0874c600 / 0x0870d918 / 0x0871dc24 |
| 0x005ad160 / 0x005ad0b0 | `BStandardMesh::setFieldOfView` / `getFieldOfView` (IViewModifier table 0x0090567c; bakes mesh+0xf4 from `pRenderView`) | raw-byte disassembly, then function created; matches lnxded 0x083b5560 |
| 0x00905708 / 0x00916738 | `vtbl_StandardMesh` (19 slots; +0x48 skinned draw 0x005b06d0) / `vtbl_AnimatedMesh` | memory read; slot counts matched to lnxded 0x08747500 |
| 0x005aeec0 / 0x0062b2f0 | `StandardMesh_drawLod` / `AnimatedMesh_drawLod` (SetTransform(3, mesh+0xf4) at 0x005aefa4, restore after) | decompiled |
| 0x005b06d0 | `StandardMesh_drawSkinned` (mesh+0xf4 into the skinning-shader constants, 0x005b091c) | function created; projection choice read |
| 0x005adfd0 | `StandardMesh_selectLod` (fov meshes → LOD 0) | decompiled |
| 0x00916800 / 0x0062c3c0 / 0x005c2cc0 | `vtbl_StandardMeshRenderer` / ctor / factory (`StandardMeshRenderer.Standard`, registered 0x005d06f1) | memory read; ctor decompiled |
| 0x0062cb00 / 0x0062cc70 / 0x0062c690 / 0x0062c620 | `drawFov` / `drawOpaque` / `drawMesh` / `drawAnimatedMesh` | functions created; decompiled / raw bytes |
| 0x009a9468 / 0x009c9be4 | `g_standardMeshRenderer` (created 0x005a38a7) / `g_meshPassId` (2 = fov) | decompiled |
| 0x004662c0 / 0x00466d80 | `Renderer_drawView` (pass order, Z clear 0x00466c08, drawFov 0x00466c5a) / `Renderer_drawFrame` | decompiled + raw bytes |
| 0x00905c98 / 0x005b8120 / 0x005c1fc0 | `vtbl_RenderView` / ctor (defaults 60°, 0.1, 1000, 0.75) / factory | memory read; decompiled |
| 0x005b7b40 / 0x005b7fb0 / 0x005b8100 / 0x005b7d10 / 0x005b7cd0 | `RenderView::setFieldOfView` / `updateProjectionMatrix` / `getProjectionMatrix` / `setAspect` / `setNearPlane` | decompiled / raw bytes; match lnxded 0x08444260 / 0x08444870 |
| 0x009ab86c / 0x009595b8 / 0x009ab8b0 | `m_startFov` / `firstTime` / `g_degToRad` | decompiled |
| 0x00462f50 | `Renderer_initDevice` (`setAspect(height/width)`) | decompiled |
| 0x0045fdc0 / 0x0045fd50 / 0x009c0184 | `RendPCDX8_setProjectionMatrix` / `setViewMatrix` / `g_pD3DDevice8` (slot 0x94 = SetTransform) | decompiled |
| 0x00917838 / 0x00667680 / 0x00667d40 / 0x0063db90 | `vtbl_RendPCDX8` / `clear` (+0x54) / `drawPrimitives` (+0x8c) / `getCurrentDisplayMode` (+0x30) | memory read; decompiled |
| 0x006038c0 / 0x00603900 / 0x00604750 | deferred-state push / pop / flush | decompiled |
| 0x00570630 | `RendPCDX8_bindVertexShader` (`Shaders/SkinningShader2Bones`) | decompiled |
| 0x004f7290 / 0x004fae80 / 0x004fc2d0 | `BFSoldier::applyFovModifier` / `setFirstPerson` / `handleVisualUpdate` (client) | decompiled |
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
  differently-placed near plane might — and the pass as read bakes a
  symmetric perspective at the world's 0.1 m near plane, §3 "The drawFov
  pass", so (a) waits on the runtime answer the next item is after), (b) how the camera's
  `getRelativeTransformation` `M` relates to the view the pass actually
  renders with — the chain is rigid only if the pass's view is
  `inverse(M × soldierWorld)`, (c) whether the client camera really rides
  `S` (inferred from the server stub `getExternCameraTrans`; the `Ub_*`
  shakes are sinusoidal, so `S` cannot hold a 5° offset but could account
  for the drift if the camera does not follow it), or (d) the 16:9 capture's
  vertical field of view — `Frustum::setupFrustum` takes `fov/2` as the
  vertical half-angle and divides by an aspect the constructor sets to 0.75;
  read since (§3 "The drawFov pass"): `Renderer_initDevice` 0x00462f50 sets
  aspect = height/width from the display mode, so the vertical field stays
  57.3° at 16:9 and only the sides widen. Resume from `drawFov` 0x0062cb00
  (vtable 0x00916800 slot +0x18, read) and the client twin of
  `Camera::getRelativeTransformation`.
- **Why retail draws the 1P parts at the world's FOV.** The projection, the
  pass and every draw path are read (§3, "The drawFov pass") and all of them
  apply the baked `set1pFov` matrix, yet the capture shows the arms at 57.3°
  and the measured rig under 0.47 rad is off the frame. The static reading
  leaves only runtime causes. Resume from: `BFSoldier::setFirstPerson` client
  0x004fae80 (the walk at its `FUN_004f7120` call — confirm each child's
  `+0x5c` geometry is the instance later drawn, and whether
  `updateFlags(1,0)`/`(2,0)` (ICompositeObject slot +0x28) re-creates it);
  the client callers of `setFirstPerson` (0x004fc910 twice, 0x004fea30,
  0x004feab0, 0x004fe8f0, 0x00564c90, 0x004ae4a0) for the order against kit
  and camera attach; `StandardMesh_drawLod` 0x005aeec0 at 0x005aef80 under a
  debugger, watching `mesh+0xf0` for the hand meshes. The decisive live test
  is a zoom: `applyFovModifier` only runs while the factor eases, so if the
  meshes carry −1 at the hip they would jump to `0.47 × 0.6` on the first
  right-click. Until then the viewer keeps the footage-matching world FOV in
  its near pass and exposes the engine value behind `?fov1p=engine`.
- **The reader of component 0x5000.** `FireArms::setZoom` publishes `zoomFov`
  as component 0x5000 and, on its own apply path, also writes it into
  `RenderView::setFieldOfView`; which object *queries* 0x5000 (the soldier
  camera, presumably, to drive the same call) was not located — no `cmp`
  against 0x5000 exists in either binary, so the id travels through a global
  or a table. Resume from the three `push 0x5000` sites (client 0x00539281,
  0x00539348, 0x0053eaad) and `BCompositeObject::setComponent` (lnxded
  0x08165360) to see where the value is stored, then who reads that slot. The
  unit itself is closed (§3).
- **The client's normal frame cap.** `Setup+0x17c` is the cap `mainLoop`
  busy-waits to (`1/cap`); the one writer found sets it to `2 × g_simulationFps`
  = 60 only in the client-hosted-server branch (0x00455e0a, gated on
  `Setup+0x3ee`). The plain client's default was not read; lnxded's ctor
  stores 100.0f (0x42c80000) in its twin field `Setup+0xc4` (0x080b7cf1). It
  does not affect the simulation, only how often `handleVisualUpdate` runs.
- **The AT/thrown family's vocabulary.** `deviation` / `deviationCorrectionTime`
  (lnxded strings 0x086f5487 / 0x086f546f) are registered by the **AI-layer**
  initializer 0x084a2050, not by any FireArms console block, so they are not
  the `minDeviation`/`maxDeviation` words the viewer's `deviation.js` stands
  in for. Where that family's floor-and-lid is stored and read is still open.

Closed in the third pass (2026-09-15), left here so nobody reopens them:

- ~~The pose the upper-body machine holds in first person~~ — it is the
  current state's 1P clip at a time-driven phase, blended in at
  `setMorphFactor`, with no aim-pitch, IK or lean term on the first-person
  path (§3; ledger ANIM-1..6). The residual is the first item above.
- ~~The projection of the `drawFov` pass~~ — the mesh bakes the render view's
  own perspective for `set1pFov` into `mesh+0xf4` when the field is set, and
  every draw path applies it; near plane unchanged at 0.1 m (§3 "The drawFov
  pass"; ledger VIEW-9). What stays open is the retail disagreement above.
- ~~Exact client cadence of `handlePlayerInput`~~ — one call per fixed 1/30 s
  simulation tick, frame-rate independent; the ease is per rendered frame
  (§2 "Clock"; ledger DEV-5, VIEW-11, GL-1).
- ~~`zoomFov`'s unit~~ — written verbatim into `RenderView::setFieldOfView` by
  `FireArms::setZoom` 0x005391b0; radians, whole vertical angle (§3; VIEW-12).
  The mouse-scale at 0x0050095f is by `zoomFov`, not `SoldierZoomFov` (VIEW-10).
- ~~Which .con word writes `FireArmsTemplate+0x2ec`~~ — `fireingForce` (sic),
  `ConsoleClass334::executeObjectMethod` 0x082d5350; and it is not a spread at
  all but a recoil impulse: `Fire` multiplies it into the barrel's negated
  forward and hands the vector to `getRootParent(this)->addForce` (slot +0x68)
  at the weapon's position (lnxded 0x0828a48f–0x0828a4cc). Ledger FA-1.
- ~~Channels 4/5 = MouseLookX/Y~~ — read out of the enum-indexed jump table of
  lnxded `operator<<(ostream&, PlayerInputMap)` 0x081d89f0 (table 0x086c88c4:
  4 MouseLookX, 5 MouseLookY, 8 Fire, 9 Action, 23 AltFire) and out of
  `BFSoldier::handlePlayerInput`, which copies in[4] into the unclamped angle
  at +0x288 and in[5] into the pitch-clamped angle at +0x284 (0x08273e3c–
  0x08273e8b). So `turnDev.b` (× |in[5]|) is the pitch term and `turnDev.c`
  (× |in[4]|) the yaw term, as §1 has it. Ledger DEV-6.
