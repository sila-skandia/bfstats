# Hand-weapon first-person placement, deviation, and zoom

Settled 2026-09-15. Two binaries were read side by side:

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

## 3. Q1 — soldierCameraPosition / soldierZoomPosition semantics

### What the offsets displace (VERIFIED, lnxded names + client storage)

They do **not** move the camera. The chain, all in `dice::ref2::world`:

1. **`FireArms::setZoom(bool)`** (lnxded 0x082881a0). When the holder is a
   `BFSoldier`: zoom **on** copies `soldierZoomPosition` → soldier `+0x248`
   (targetOffset) and `SoldierZoomFov` → soldier `+0x260` (targetFovFactor)
   (0x082882e6); zoom **off** copies `soldierCameraPosition` → `+0x248` and `1.0`
   → `+0x260` (0x082883cb). The *target* snaps; nothing is drawn from it directly.
2. **`BFSoldier::handleVisualUpdate(float,float)`** (lnxded 0x08270fd0), gated on
   soldier `+0x268` = isFirstPerson (set by `BFSoldier::setFirstPerson`,
   0x0826d130): eases the current offset `+0x254` toward the target:
   `cur += (target − cur) · 0.25` per visual update, component-wise, no dt
   (constant 0.25f at `.rodata 0x086c08ac`). The FOV factor eases separately:
   `fovCur = 0.7·fovCur + 0.3·fovTarget` while `|Δ| > 0.001`, and each step calls
   `BFSoldier::applyFovModifier(fovCur)` (0x0826d490).
3. **`BFSoldier::updateAnimations(float)`** (lnxded 0x0826e630), in the
   first-person branch (animation state flag bit 2): builds
   `finalOffset = BFSoldierTemplate+0x15c (base Vec3, name OPEN) + easedOffset`,
   transforms it by the soldier's aim/view rotation, composes with
   `rotate90aroundX` (0x0879d340) and hands the matrix to
   **`dice::anim::Skeleton::transform`** (0x083420f0) on the soldier's skeleton
   (0x0826f0dd..0x0826e9a3).

So: **the offsets displace the first-person arms+weapon rig, expressed in the
soldier's view frame.** The camera eye stays on the head; hip→zoom moves the gun.
Axis meaning from the data (Thompson hip `-0.01/-0.04/0.09` → zoom
`-0.05/-0.01/0.08`): y is vertical (zooming raises the gun toward the eye line),
z is along the view direction, x is lateral. The *sign convention* of x (left vs
right) was not pinned down from the basis columns — OPEN.

### Interpolation answer

Hip↔zoom is **eased, not snapped**: exponential at **25% of the remaining distance
per visual update** (frame-rate dependent — there is no dt in the easing). The FOV
factor converges faster (30% per step) and snaps when within 0.001.

### FOV / near plane (partial)

- `SoldierZoomFov` is a **multiplier on the soldier's view FOV** (applyFovModifier),
  *and* it scales the mouse-look deltas while zoomed — client code at
  0x0050095f–0x00500973 (inside an unresolved-function gap in `BF1942.exe`,
  read from raw bytes): `if (weapon->isZoomed()) { yawDelta *= SoldierZoomFov;
  pitchDelta *= SoldierZoomFov; }`.
- No separate first-person weapon FOV and no near-plane special-casing fell out of
  this path. If the 1P rig gets its own projection, it happens in the renderer,
  not in the world layer — **OPEN**. Until shown otherwise the rig renders under
  the same (modified) view FOV.

---

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
| Weapon drawn in world pass at soldier FOV 53.86 | Placement: apply `soldierCameraPosition` (hip) / `soldierZoomPosition` (zoom) as a view-space translation of the weapon rig, eased at 25%/frame on toggle; FOV: multiply view FOV by `SoldierZoomFov` when zoomed (0.7/0.3 ease). No separate weapon FOV found (OPEN). |

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

Key lnxded anchors (named): `HandFireArms::updateDeviation` 0x08293e80,
`FireArms::updateDeviation` 0x0828d410, `FireArms::Fire` 0x0828a090,
`FireArms::fireBarrel` 0x0828aba0, `FireArms::setZoom` 0x082881a0,
`FireArms::handleUpdate` 0x08288890, `FireArms::setAIDeviation` 0x0828e350,
`BFSoldier::handlePlayerInput` 0x08273c70, `BFSoldier::handleVisualUpdate`
0x08270fd0, `BFSoldier::updateAnimations` 0x0826e630, `BFSoldier::setFirstPerson`
0x0826d130, `BFSoldier::getPoseCameraPosition` 0x0827de00 (BFSoldierTemplate
+0x1a4 + pose·12), setters 0x0828faf0 (`setFireDev`), 0x0828fb20 (`setMinDev`),
0x08294740/70/a0 (`setTurnDev`/`setSpeedDev`/`setMiscDev`).

## 7. Open items

- Exact client cadence of `handlePlayerInput` (deviation/easing clock in Hz).
- Name of `BFSoldierTemplate+0x15c` (the 1P base offset the weapon offset adds to).
- Sign convention of the x component of the placement vectors.
- Renderer-side handling of the 1P rig (own projection? near plane?) — client
  renderer only, untraced.
- `deviation` / `deviationCorrectionTime` .con words: registered in a different
  (dice::bf-layer) console block; `FireArmsTemplate+0x2ec` (lnxded) is a
  per-projectile random spread applied in `Fire` when > 0 — which .con word maps
  to it is unconfirmed.
- The `turnDev.b`↔MouseLookY / `turnDev.c`↔MouseLookX assignment relies on the
  string-table ordering of the c_PI enum plus the verified Fire=8 anchor;
  channels 4/5 themselves not independently confirmed.
