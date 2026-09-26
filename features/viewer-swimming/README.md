# A man in the water

Stream W8-B of the 2026-09-19 parity round. The owner's report:

> water in general is broken. You can walk on it, but in game if you enter water
> the soldier assumes a swimming animation, and will drown after an amount of
> time in the water.

Both halves are now the engine's. He cannot walk on it, he swims, he floats at
the draft the engine teleports him to, he stows his rifle, he wades out where it
is shallow, he plays the swim death if he is killed in it, and he drowns on the
soldier template's own clock.

Branch: `worktree-agent-ae2794646b0b16539`. Commits:

| commit | what |
|---|---|
| `6f9759c` | `viewer/swim.js`, the law; `physics.js` stops standing on the sea and floats a swimmer; `soldier.js` owns the state and the drowning clock |
| `db95618` | `extract_pose.py --swim`, `gaits/swim.gait.glb`; the six families in `soldier-body.js`; the `map.html` and `world.js` hooks |
| `a425ff9` | the ordering fix that lets a swimmer stand up in the shallows, and `c_AsmHideWeapon` honoured on the drawn body |

---

## 1. What puts him in the swim state, and what takes him out

`BFSoldier::updateSwimming(float)`, lnxded **`0x08282190`**, called once a tick
from `BFSoldier::handleUpdate` (`0x0827237a` and `0x08272c63`). The whole
function, in order:

| step | address | what |
|---|---|---|
| no water on this map | `0x082821a4` → `0x082821b9 cmp ah,0x40; jne` | `terrainBase->vtbl+0xc` compared with **-1.0** (`0x086b05ec`); equal means the level has no water and the function returns |
| on a ladder | `0x082821d0`, `0x082821da test eax,0x10` | the **lower** body's `getCurrentStateFlags()` (`this+0x294`) carrying `c_AsmIsClimbing`; returns before the water is even sampled, and before the *exit* test, so a ladder neither starts nor ends a swim |
| the depth | `0x08282215`, `0x0828221e`, `0x0828223a` | `surfaceY = terrainBase->vtbl+0x5c(pos.x, pos.z)`, then `depth = max(0, surfaceY - pos.y)`. **A function of x and z only** — the same trap HP-5's `touchesWater` documents on the vehicle side. `pos` is the object's own origin, which for a soldier is his feet |
| enter | `0x082823c5` (`0x086d29bc` = **0.43**), or `0x082823b1` | `depth > 0.43` (or the surface above the composite object's own reference height) → `setAnimationState(0, "Lb_StartSwim")` at `0x082823f7` and `setAnimationState(1, "Ub_StartSwim")` at `0x08282426` |
| leave | `0x082822a8` (`0x086d29b8` = **0.35**) | `depth <= 0.35` → `Lb_EndSwim` / `Ub_EndSwim` (`0x086d2988`, `0x086d2993`) |
| float | `0x082822bc`, `0x082822d4` (`0x086c4f70` = **0.4**) | while swimming and `surfaceY > pos.y`, **teleport** the body to `surfaceY - 0.4` through the object's vtable `+0x3c` |

So the swim state is not a physics mode the engine solves. It is an **animation
state**, entered by name on both machines, and what physics reads is the
`c_AsmIsSwimming` flag those states carry. `BFSoldier::isSwimming()`
(`0x0827eba0`) is literally `getCurrentStateFlags(this+0x294) >> 3 & 1`.

**The flag bits, re-derived rather than assumed.** `ObjTemplBFModule::init`
registers them one per bit through `addConstantHelper` (`0x08298280`):

| word | value | push |
|---|---|---|
| `c_AsmHideWeapon` | `0x2` | `0x0829914a` |
| `c_AsmLockFreeLook` | `0x4` | `0x0829917a` |
| `c_AsmIsSwimming` | `0x8` | `0x082991aa` |
| `c_AsmIsClimbing` | `0x10` | `0x082991da` |
| `c_AsmIsCrouching` | `0x20` | `0x0829920a` |
| `c_AsmIsLying` | `0x40` | `0x0829923a` |

That is PHY-6's "state-flag bit `0x8`" named, and it independently re-derives
PHY-8's `0x20`/`0x40` pair.

**The state machine itself** is `animations/AnimationStatesSwim.con`, five lower
states and five upper, with `animations/3pAnimationsTweaking.con` overriding two
of the speeds. All five lower states declare `setFlag c_AsmIsSwimming` **and**
`setFlag c_AsmHideWeapon`; the upper five declare no flags at all, which is
consistent with every reader above looking at `this+0x294`, the lower machine.

`Lb_EndSwim` declares `c_AsmIsSwimming` too. So leaving the water does **not**
drop the flag: the exit clip plays first and its `addTransitionWhenDone Lb_Stand`
is what drops it. The drowning clock and the `5.0·vCmd` gain both stay up for
that third of a second.

### The one thing that was NOT read

`ResponsePhysics::checkVsTerrain(float)` (`0x0825a960`) is what calls
`setUnderWater` (`0x0825ac60`, and the zero arm at `0x0825ad41`), and I did not
finish reading how it forms the argument. It matters for one number only — see
§4 — and nothing else in this document rests on it.

---

## 2. The drowning law

It is **the same mechanism as the vehicle's `hpLostWhileDamageFromWater`**, not a
separate one. `Armor::update(float dt)`, lnxded **`0x08172f40`**:

```
inWater = armor[0x10]                                   // refreshed from +0x11
if (!inWater || !damageFromWater)  timer = waterDamageDelay
else {
  timer -= dt
  if (timer < 0) { damage(hpLostWhileDamageFromWater); timer = 1.0 }
}
```

Every field mapped off its own setter, so there is no guessing about which
offset is which:

| `.con` word | setter | offset | used in `update` as |
|---|---|---|---|
| `damageFromWater` | `0x08173fd9` | `+0xe0` | the gate |
| `waterDamageDelay` | `0x08174059` **and** `0x0817405f` | `+0xe4` (live timer) and `+0xec` (stored delay) | both |
| `hpLostWhileDamageFromWater` | `0x081743d9` | `+0x124` | the damage |
| `damageFromDeepWater` | `0x08174019` | `+0x138` | the second, inert timer |
| `deepWaterDamageDelay` | `0x08174089` / `0x0817408f` | `+0x13c`, `+0x140` | " |
| `hpLostWhileDamageFromDeepWater` | `0x08174409` | `+0x134` | " |
| `deepWaterLevel` | `0x081744a9` | `+0x144` | the deep-water test at `0x08172fad` |

Two details decide the shape of it. The timer resets to a flat **1.0** after it
fires (`0x3f800000`), not to the delay — so the delay is a grace period that
happens once and the bleed after it is a hit a second. And the dry arm is a plain
assignment of the **whole** stored delay, so **surfacing for one tick buys the
full grace again**.

**What arms it for a soldier, and this is what makes it swim-keyed rather than
depth-keyed.** `Armor::setLastHitMaterialIndex(int)` (`0x081736b0`, IArmor vtable
`+0x60`):

```
if (mat != 1) return;                                    // water only
if (object->getTemplate()->getClassId() == CID_BFSoldierTemplate)   // 0x086c2b88
     armor[0x11] = BFSoldier::isSwimming(object);        // 0x08173700 - 0x0817370e
else armor[0x11] = 1;                                    // 0x081736f3
```

A vehicle that touches water is wet. A **soldier** is wet only while
`c_AsmIsSwimming` is up. Material index 1 being water is confirmed independently:
`GameServer::handleCollisionLandOrWater` (`0x08154960`) hardcodes the literal 1
into all three material lookups on its `param_7 == 1` arm.

**The numbers are shipped data**, `Objects/Soldiers/Common/CommonSoldierData.inc`,
which every vanilla soldier includes:

```
ObjectTemplate.hpLostWhileDamageFromWater 1
ObjectTemplate.WaterDamageDelay 90
ObjectTemplate.DamageFromWater 1
ObjectTemplate.HitPoints 30
```

**90 s of grace, then 1 HP a second off 30: dead 119 s after he starts
swimming.** Surveyed over every `.con`/`.inc`/`.tweak`/`.ssc` entry of every
`Mods/bf1942/Archives/**.rfa`: no vanilla object sets `deepWaterLevel`,
`damageFromDeepWater`, `deepWaterDamageDelay` or
`hpLostWhileDamageFromDeepWater`, so `Armor::update`'s second timer is inert in
vanilla and is not modelled. (The first survey missed the soldier entirely
because it only read `.con` files and the soldier's numbers are in a `.inc`.)

### A refutation to carry back

`viewer/armor.js`'s header says the water-damage tick "explicitly skips
soldiers — no HP loss at all", citing `R4-13` from a `verify-r4.md` that is not
in the tree. **That is wrong.** The soldier-specific branch at `0x081736f9`
exists precisely so that a soldier's water damage is armed by `isSwimming()`
rather than by contact; if soldiers were skipped, the generic `armor[0x11] = 1`
would do and the branch would be dead code. `CommonSoldierData.inc` shipping all
three water words is the data agreeing.

`armor.js` itself is unchanged — the timer lives in `swim.js` because it is the
soldier's, and `world.js` applies its output to the player's `Armor` beside the
fall damage.

---

## 3. The other two questions

**Does the speed table change in water?** No. There is no swim entry in
`directionalSpeed`. The lnxded table at `0x0872edec` holds the same six values
as the client's `0x009581b4` and the two floats after it are `strafeSpeed[0..1]`,
not a fourth pose row; `getPose()` (`0x0827ddc0`) can only answer 0, 1 or 2, and
the swim states declare neither `c_AsmIsCrouching` nor `c_AsmIsLying`, so a
swimming soldier is posed standing and reads the standing row. What changes is
the **gain**: `5.0·vCmd` (`0x086c5288`, applied at `0x08274b6f`) instead of
`0.75·vCmd`, and — PHY-6's important half — **not** under the
`IResponsePhysics+0xa4 == 0` gate, so it applies every tick whether or not the
solver resolved an impulse.

**Can a swimming soldier fire, and what happens to his weapon?** His weapon is
**stowed, and that is read, not assumed**, twice over:

* every lower swim state declares `setFlag c_AsmHideWeapon` (the `.con`), and
* `BFSoldier::enableItem(char)` returns without enabling anything while that bit
  is set: `0x082784a1` reads the flags, `0x082784af and eax,0x2`,
  `0x082784b2 jne` straight to the function's exit. `selectBestLoadedWeapon`
  (`0x08273af1`) and `handleMessage` (`0x082772ac`) read the same bit.

The clips agreeing is the third witness: every swim clip is under
`animations/3P_NoWeapon/` and the swim death's upper half is under
`DieHit/3P/EmptyHands/`.

And he loses one input outright. `BFSoldier::handleSwimAction(PlayerInput&,
Vec3&)` (`0x08282460`), called from `handlePlayerInput` at `0x08273d58`, is four
lines: refresh the cached swim bit, and if it is up and bit **9** of the
PlayerInput's 64-bit mask at `+0xdc` is held, zero the axis at `+0x24`. Index 9
is **`c_PIAction`** — read off the `PlayerInputMap` switch table at `0x086c88c4`
(`operator<<(ostream&, PlayerInputMap)`, `0x081d89f9`), whose 0x38 cases are
`c_PIYaw, c_PIPitch, c_PIRoll, c_PIThrottle, c_PIMouseLookX, c_PIMouseLookY,
c_PICameraX, c_PICameraY, c_PIFire, c_PIAction, …`. So the **jump** input is
discarded while swimming; `c_PIFire` (index 8) is not touched.

### The death case

`BFSoldier::handleDamage(float)` tests `c_AsmIsSwimming` **before** it looks at
the pose. `0x08270c51` reads the lower body's flags, `0x08270c63 and eax,0x8`,
and the two `setAnimationState` calls at `0x08270c73` and `0x08270c85` take the
states `BFSoldierTemplate::init` cached at template `+0x258` and `+0x25c`
(`0x0827b660` / `0x0827b6af`) — `Lb_DieSwim` and `Ub_DieSwim`,
`AnimationStatesDie.con`. A man who dies in the water never plays a standing
death.

---

## 4. What the viewer now does

`viewer/swim.js` is the law, free of `three` and of the DOM, run under node by
`tests/test_swim.py`. `SoldierBody` reads it **duck-typed through an injected
collaborator** rather than importing it, so `physics.js` keeps the single
dependency it has always had and no existing harness had to learn a new module.

| number | value | where from |
|---|---|---|
| enter depth | 0.43 m | `0x086d29bc` |
| leave depth | 0.35 m | `0x086d29b8` |
| draft | 0.40 m | `0x086c4f70` |
| locomotion gain | `5.0·vCmd`, ungated | `0x086c5288`, `0x08274b6f` |
| stroke bands | `|throttle| > 0.5` | the states' own `addTransitionOne c_PIThrottle` |
| entry / exit clip length | 1/2.6 s and 1/3.2 s | the state speeds; a clip's span is `1/|speed|` (ledger ANIM-1) |
| drowning | 90 s, then 1 HP/s | `CommonSoldierData.inc` |
| **speed ceiling** | **1/3 of the table** | **a viewer number — see below** |

### The one invented number, and why

The engine's `5.0·vCmd` is capped by the drag on a body in water, and that drag
is **not the law `physics.js` carries**. A soldier is a `PhysicsNode`, and PHY-4
settled that every live `PhysicsNode` takes the **box** branch (`0x08252f50` /
`0x08253280`), which is quadratic in speed. `PointBody.applyDrag` here is the
*sphere* law, linear in v, with an inferred bounding radius. Balancing `5·vCmd`
against that gives **167 m/s** at a 6 m/s command — a man crossing Wake in four
seconds — so the module must either carry the box law or cap the speed, and the
box law is a bigger job than this stream and belongs beside the vehicles that
need it too (`physics.md` §3 says exactly that).

The cap is `walkSpeedFactor` (1/3, `0x0872ee10`), giving **2.0 m/s** forward. It
is a shipped constant rather than one I chose, and the box law's own balance
agrees with it: with the submersion scale saturated (25× dry drag) and the
soldier's collision extent taken as roughly 0.8 × 1.8 m,
`sqrt(5·6·100 / (25² · (π/4)·0.8·1.8))` = **2.06 m/s**. The saturation is the
assumption — at the 0.4 m draft against a 1.8 m box the scale would be 6.33 and
the balance 8.1 m/s, which is *faster than running* and so is almost certainly
not what the engine does. Which of the two `checkVsTerrain` produces is the open
item in §1. The arithmetic is written out beside `SWIM_SPEED_CEILING_FACTOR` so
that whoever reads it can replace the constant with the real thing.

Everything else about the motion is the engine's: the `5.0·vCmd` acceleration,
ungated, is applied; PHY-7's submersion drag scale is now live
(`updatePhysics(dt, { underWater })`); the position is pinned, not solved.

### The ordering that had to be right

`updateSwimming` runs out of `handleUpdate`, i.e. **after** the tick's
integration and resolve, and `handlePlayerInput` reads the flag the *previous*
`handleUpdate` left. Getting that backwards is not cosmetic. The pin puts the
feet at `surface - 0.4` every tick, so a depth measured before the resolve is
**always exactly 0.4** and the 0.35 exit test can never fire: a man swimming at a
beach could never stand up. Measured after the resolve, `#settle` has already put
him on the seabed in the shallows, the depth falls under 0.35 there, and he wades
out. The first build had it the wrong way round and a headless run caught it —
eight seconds of swimming at a beach with the depth pinned at exactly 0.40.

### And `#settle` no longer stands on the sea

`WorldCollider.surfaceHeight` answers `max(heightfield, waterLevel)`, which is
the right question for a vehicle on a bridge and the wrong one for a man. Where
the sea is the higher surface, `#settle` now asks the heightfield what is
actually underfoot: shallow water is standing on the seabed with the seabed's own
normal and material, and deep water leaves nothing to stand on, which is what
hands the body to the swim state. The downward hull probe skips a `kind ===
'water'` hit for the same reason.

The surface stays a **collision** even though it is not a floor — HP-14's water
landing damage comes from `handleCollisionLandOrWater`'s `param_7 == 1` arm — so
a one-tick water entry is registered on the crossing, billed against the surface
rather than against wherever inside the tick the body ended up. `test_fall_damage`'s
"falling into water is 67x gentler than onto land" still passes unchanged.

---

## 5. The clips now exported

`extract_pose.py --swim` (and `--shared-assets`, which now includes it) writes
one new sidecar and merges one key into `gaits/gaits.json`:

| file | clips | bytes |
|---|---|---|
| `poses/gaits/swim.gait.glb` | the 12 below, named by engine state | **426,700** |

No absences and no errors: all twelve states exist and all ten `.baf` files they
name are in `animations.rfa`.

| baked clip (= the engine's state) | `.baf` | frames | speed | period | loop | `returnTo` |
|---|---|---|---|---|---|---|
| `Lb_StartSwim` | `3P_NoWeapon/3PSwimStartLower` | 8 | 2.6 | 0.385 s | no | `Lb_SwimForward` |
| `Ub_StartSwim` | `3P_NoWeapon/3PSwimStartUpper` | 8 | 2.6 | 0.385 s | no | `Ub_SwimForward` |
| `Lb_Floating` | `3P_NoWeapon/3PSwimFloatingLower` | 22 | 0.4 | 2.500 s | yes | `Lb_Floating` |
| `Ub_Floating` | `3P_NoWeapon/3PSwimFloatingUpper` | 22 | 0.4 | 2.500 s | yes | `Ub_Floating` |
| `Lb_SwimForward` | `3P_NoWeapon/3PSwimForwardLower` | 22 | 1.0 | 1.000 s | yes | `Lb_Floating` |
| `Ub_SwimForward` | `3P_NoWeapon/3PSwimForwardUpper` | 22 | 1.0 | 1.000 s | yes | `Ub_Floating` |
| `Lb_SwimBackward` | `3P_NoWeapon/3PSwimBackwardLower` | 22 | 1.0 | 1.000 s | yes | `Lb_Floating` |
| `Ub_SwimBackward` | `3P_NoWeapon/3PSwimBackwardUpper` | 22 | 1.0 | 1.000 s | yes | `Ub_Floating` |
| `Lb_EndSwim` | `3P_NoWeapon/3PSwimStartLower` | 8 | **-3.2** | 0.3125 s | no | `Lb_Stand` |
| `Ub_EndSwim` | `3P_NoWeapon/3PSwimStartUpper` | 8 | **-3.2** | 0.3125 s | no | `Ub_Stand` |
| `Lb_DieSwim` | `DieHit/LowerBody/3PDieSwimLower` | 37 | 0.6 | 1.667 s | no | — |
| `Ub_DieSwim` | `DieHit/3p/EmptyHands/3PDieSwimUpper` | 37 | 0.6 | 1.667 s | no | — |

Three facts worth keeping:

- **The entry and the exit are the same clip.** `3PSwimStartLower.baf` forwards
  at 2.6 and backwards at -3.2. `clip_timeline` already reverses a
  negative-speed clip with frame 0 still the cycle's start, so the exit is baked
  as its own timeline rather than left for a renderer to run an action in
  reverse.
- **The shipped entry speed is not the one in the state file.**
  `AnimationStatesSwim.con` writes 3.6; `animations/3pAnimationsTweaking.con`
  re-declares `set3pAnimationSpeed Lb_StartSwim 2.60` over it. Reading the parsed
  machine rather than the file is what catches that.
- **Frame count does not set duration.** A state's `addAnimation <clip> <speed>`
  number is cycles per second (ledger ANIM-1), so the 8-frame entry and the
  22-frame float are 0.385 s and 2.5 s, not the other way round.

`soldier-body.js` gains six families — `swimStart`, `swimFloat`, `swimForward`,
`swimBackward`, `swimEnd`, `swimDie` — each with a fallback chain through
`swimFloat` to `stand`, so a tree published before `swim.gait.glb` existed draws
a man upright in the water rather than drawing nothing. Swimming outranks the
gait for the engine's own reason (it is a whole-body pair set on both machines)
and the parachute outranks swimming, because a canopy over water is the
parachute's landing.

---

## 6. Measured

Served from this worktree on `localhost:5391` with the regenerated sidecar
overlaid on the shared poses tree by symlink; driven headlessly through
`__renderOnce`, `__soldier()`, `__footBody()` and `toDataURL`. Drivers in the
stream's scratch directory (`lib.mjs`, `s1_float.mjs`, `s2_stroke.mjs`,
`s3_shore.mjs`, `s4_drown.mjs`).

**Two things had to be done before any pixel meant anything**, and both are worth
writing down for the next stream:

1. **Stop the page's own rAF loop** (`__renderer.setAnimationLoop(null)`).
   Playwright's page is not a hidden tab, so the loop keeps ticking between
   reads. With it running, a with/without differential on open water reported
   **59.6% of an empty ocean as "the body"**. With it stopped, two dt=0 renders
   are byte-identical and every control below is exactly **0**.
2. **Pin the sea and sky uniforms** for a two-timestamp differential, and redraw
   with `renderer.render(scene, camera)` rather than through `frame()` — the
   page's own `advanceSim(dt)` writes `simTime` straight back into the water
   uniform on every frame, so restoring the uniform and then stepping puts the
   sea back where it was going anyway.

Wake, water level **95.0**, open sea at (1289.4, -534.9).

### He floats at his draft, and he is drawn

```
floating   y 94.600  = waterLevel 95.0 - SWIM_FLOAT_DRAFT 0.4, exactly
           depth 0.403   grounded false   state swimFloat
body       want swimFloat, visible, 19 families bound (7 gait + 6 parachute + 6 swim)
           weaponNode "Type99", weaponVisible FALSE
swimFloat  centre box [324,157]-[576,459]  76,104 px
           14,735 of them change when the body is hidden (19.36%)
           maxDelta 385, meanDelta 179.8
           control (the same box, nothing changed): 0 px, 0.00%
           whole frame: 20,374 of 504,000 (4.04%), control 0
```

`01-swim-float.png` is a Japanese soldier chest-deep in the Pacific with his arms
out and **no rifle**; `01-swim-float-hidden.png` is the same empty ocean.

### It is an animation, not a mesh parked on the sea

```
breathing  the same box, two frames 0.4 s apart, sea and sky uniforms pinned,
           camera still to 0.0002 m, position unchanged (0, 0, 0):
           8,128 of 76,104 px move (10.68%)
           control (pin, redraw, redraw): 0 px
```

A constant clip moves zero. That 10.68% is `Lb_Floating` + `Ub_Floating`, the
2.5 s tread-water loop.

### Forward, and slower than running

```
swimForward  state swimForward, speed 2.000 m/s (run = 6), travelled 6.67 m in 3 s
             y still 94.600 -- the draft holds while he swims
             body differential 6,393 of 76,104 px (8.40%), control 0
release W -> swimFloat, speed decaying through 1.29 m/s
```

`03-swim-forward.png`.

### He wades out, and the exit clip plays

Swum at a Wake beach, sampled every 3 ticks because `Lb_EndSwim` is 19 ticks
long:

```
t 3.05 .. 8.05 s   swimForward  depth 0.40  y 94.60  grounded false
t 9.05 s           swimForward  depth 0.38  y 94.60  grounded false
t 9.10 s           swimEnd      depth 0.34  y 94.66  grounded TRUE
then               state null, swimming false, grounded true, grace back to 90.0
```

`06-swim-end.png` is a man at the water's edge mid-exit; `07-ashore.png` is him
standing on the beach.

### Drowning, in real sim seconds

1,200 renders at the animation loop's own 0.1 s clamp, sampled every 5 s:

```
t   5 .. 85 s   hp 30, grace 83.2 -> 3.2, drowned 0
t  90 s         hp 28, grace 0, drowned 2
t  95 s         hp 23        t 100 s  hp 18        t 105 s  hp 13
t 110 s         hp  8        t 115 s  hp  3        t 120 s  hp  0, destroyed
```

First hit between 85 and 90 s, then one HP a second, dead at 119 s of continuous
swimming. Exactly the `CommonSoldierData.inc` law, applied through the player's
own `Armor`.

### The swim death is drawn

```
__damage(60) on a floating soldier:
  hp 0, destroyed true, swimming true
  body want swimDie, visible TRUE
  whole frame: 6,292 of 504,000 px (1.25%), maxDelta 384, control 0
```

`04-swim-death.png` is a corpse face-down in the water with his arms out. The
`syncFootBody` visibility gate now consults the resolved family, so the one death
this rig can draw is drawn and a land death still draws nobody — which is exactly
the gap W6-B left open and deliberately did not paper over.

---

## 7. The re-extraction the real tree needs

The pose `.glb` files do **not** change; only the one new sidecar and one
manifest key do. So the narrow command is the whole of it:

```bash
cd tools/bf1942-models
python3 extract_pose.py --swim --out ./viewer/models/poses
```

About 1 s. It writes `poses/gaits/swim.gait.glb` (426,700 bytes) and merges the
single key `"swim": "gaits/swim.gait.glb"` into `poses/gaits/gaits.json`.
Nothing else under `poses/` is written, and `models.json` is not touched at all.

**Expected size delta: `poses/gaits/` goes 9,505,203 → 9,931,903 bytes,
+426,700 (+0.41 MiB); 27 entries → 28.**

`python3 extract_pose.py --shared-assets --out ./viewer/models/poses` is the
superset and now includes the swim pass; a mod tree wants `--mod <name>` on
either.

**Nothing was published and nothing was written into the shared tree.** The
extraction for this stream went to a scratch directory and was overlaid on this
worktree by symlink; `tools/bf1942-models/viewer/models/poses` in **this
worktree** is now a real directory of symlinks plus one real
`gaits/swim.gait.glb` and one real `gaits/gaits.json`, all of it gitignored.
`git status --short -- tools/bf1942-models/viewer` reports nothing.

---

## 8. Still open

| Item | Where it stands |
|---|---|
| **The swim speed ceiling is a viewer number** | §4. The engine's cap is the `PhysicsNode` box drag, which this module does not carry. The two ways of reading `ResponsePhysics::checkVsTerrain`'s `setUnderWater` argument give 2.06 m/s (saturated) and 8.1 m/s (at the 0.4 m draft); the second is faster than running, so the first is almost certainly right, but it is an assumption and is labelled one |
| **`deepWaterLevel`'s runtime default** | `Armor::update`'s deep-water test (`0x08172fad`) sets the *ordinary* water byte as well as the deep one. No vanilla object sets the field and no instruction writes `+0x144` outside the property setter, so the default is unread. If it is 0, a soldier's origin going under the surface arms the drown clock by that route too, and the wading case would drown a man who stood in a puddle for 90 s. The soldier-specific `isSwimming()` clause exists to make the answer swim-keyed, so this stream implemented swim-keyed |
| **`0x082823b1`'s second entry condition** | Entering the swim state has an OR arm: the water surface above a float read off the composite object through `IID_ICompositeObject` slot `+0x38`. Not identified. It only ever makes entry *easier* than the 0.43 threshold, so the implementation is conservative |
| **LOOP-1** | The 90 s and the 1 s are `dt`-accumulated seconds and are therefore immune to LOOP-1; the `5.0·vCmd` gain and the `1/|speed|` clip periods are not, and carry the same qualifier as every other per-call quantity in the corpus |
| **The first-person arms while swimming** | `c_AsmHideWeapon` is honoured on the third-person body. The first-person rig (`stance-clips.js`) still draws the weapon, and the engine has no `1P` swim clip family to put in its place — `1pAnimationsTweaking.con` names `Ub_StartSwim` and friends, so there may be one; unsurveyed |
| **Remote players** | `netcode-render.js` and `remote-gait.js` are W6-G's and are untouched. A remote swimmer is drawn with his locomotion gait, because the snapshot carries no swim bit. The bit exists in the engine's own network state (`BFSoldier::getStateBits` `0x0827e1c0`); wiring it is a netcode job |
| **Sound** | Four scripts ship and none is played: `SoldierToSwim.ssc`, `SoldierSwim.ssc`, `SoldierSwimStand.ssc`, `SoldierFromSwim.ssc`, driven by the states' own `setSoundTrigger c_SstToSwim` / `c_SstSwim` / `c_SstSwimStand` / `c_SstFromSwim`, with `SoldierSound.setSwimFrequency 1` and `setRandomSwimFrequency 0.025` |
| **Vehicles in water** | Untouched, and W8-A's. The `Armor::update` water timer this stream read is the same one a vehicle uses, so the numbers in §2 apply there too — vanilla vehicles carry `damageFromWater 1` and `hpLostWhileDamageFromWater` 5 to 10 with **no** delay, which is why a tank in the sea starts losing HP at once |

---

# W9-B: he could still fire, and he could not be seen to swim

Stream W9-B of the same round, on the two defects the lead measured on the
deployed build after W8-B shipped. The owner:

> It does slow me down when I enter, but I can still fire weapons, but in water
> you're locked down and they have a swimming animation.

Branch: `worktree-agent-ad46aa9fa7612154f`. Commits:

| commit | what |
|---|---|
| `d8bb4cf` | the item gate: `SWIM_STATE_FLAGS` and `itemsLocked` in `swim.js`, `Soldier.itemsLocked` beside them, and every item verb in `map.html` asking; the first-person rig goes with the item; `__footBody().playing` reads the mixer back |
| `1555837` | `pointerdown` is an item message too; `__footView()` reports `cycleOnFoot` |

---

## 9. Defect 1 — the gate is on the ITEM, not on the trigger

W8-B had both halves of this and drew the wrong conclusion from them. Its §3
says a swimmer "can still fire — `c_PIFire` is index 8 and is not touched",
which is true of `handleSwimAction` and is not the mechanism. Re-read, and
wider than W8-B read it — every one of these calls
`AnimationStateMachineInstance::getCurrentStateFlags(this+0x294)`
(`0x0832b110`) on the **lower** machine and tests bit `0x2`:

| reader | addresses | what the `jne` skips |
|---|---|---|
| **`BFSoldier::handleMessage(TemplateMessage, IPlayer*)`** `0x08277260` | read `0x082772a4`, `0x082772ac and eax,0x2`, `0x082772af jne 0x08277340` | **the whole dispatch.** Past the gate is `lea eax,[edi-0x6]`, `cmp eax,0x10`, `jmp DWORD PTR [eax*4+0x86d2748]` — a 17-entry jump table over messages **6 to 22** |
| `BFSoldier::selectBestLoadedWeapon()` `0x08273a80` | `0x08273ae9`, `0x08273af1`, `0x08273af4 jne 0x08273be5` | the automatic switch away from an empty weapon |
| `BFSoldier::enableItem(char)` `0x08278460` | `0x082784a1`, `0x082784af`, `0x082784b2 jne 0x082787d1` | the function's own `ret` — nothing can be enabled |

`handleMessage` is the one that matters and it is new here. **Fire is message 6
and AltFire is message 7** — already cited in this tree, in `map.html`'s
demolitions block, out of this same function — and **MenuSelect4 is message
13**, so the whole slot-selection family sits inside the gated range as well.
Exactly two ids are intercepted *before* the gate and survive it: `0x15` at
`0x08277275` (destruction, HP-13) and `0x12` at `0x0827728e`.

So the engine does not refuse the fire input. **It leaves the swimmer with no
item at all.** That is how it is implemented here, and there is no special case
on the trigger anywhere. `viewer/swim.js` carries the law:

```js
export const SWIM_STATE_FLAGS = Object.freeze({
  swimStart: ASM_HIDE_WEAPON | ASM_IS_SWIMMING,   // 0xA, all five of them
  ...
  swimDie: 0,                                     // AnimationStatesDie.con: no flags
});
export function itemsLocked(stateFlags) {
  return (Number(stateFlags) & ASM_HIDE_WEAPON) !== 0;
}
```

with `SwimState.stateFlags` / `SwimState.itemsLocked` and `Soldier.itemsLocked`
on top, and `map.html` gains one helper — `itemsLocked()`, reading
`soldier?.itemsLocked` — and seven callers.

### What else the gate turned out to cover

Everything `handleMessage` dispatches, which on this page is:

| verb | where | while swimming |
|---|---|---|
| the trigger | `footFire`'s `hw.group` and detonator blocks | nothing fires; `guns.setFiring(false)` and the Fire Loop released on the tick he goes under, and no click banked for when he wades out |
| the mouse itself | `pointerdown` | neither button reaches anything — no click queued, no zoom latched |
| weapon selection | `selectKitWeapon` (the number keys, and the wheel through `cycleKitWeapon`) | refused |
| the demolitions pair | `altFireDemolitions`, `selectDetonator` | refused. **A swimming engineer cannot put a charge down and cannot reach his plunger**, because both ends of that pair are messages 6 and 7 |
| the reload | `startReload`, and the automatic change `footFire` starts on a dry magazine | refused; a change already in flight freezes where it was, because its clock is `FireArms::handleUpdate`'s and that is not running on an item he does not have |
| the crosshair | `crosshairAim` | no active item, so no `setCrossHairType` to read, so no reticle |

Two things are deliberately **not** gated. **Entering a vehicle**: climbing into
a boat out of the water is something the game does, and nothing in the read says
otherwise. And **`viewer/seats.js`**: a swimmer is not in a seat, so its weapon
gate is not where this belongs.

### The first-person rig goes with the item, and nothing replaces it

`hw.rig.visible = !locked && ...`, which takes the whole near pass with it (that
pass is gated on `handWeapon?.rig.visible`), and `updateViewmodelAnimation` is
not ticked, so no fire or reload clip runs itself out behind the water.

**There is no first-person swim clip to put in its place, and that is read
rather than assumed.** Parsing the shipped state machine (`bf42.animstates` over
vanilla `animations.rfa`), not one of the ten swim states declares a 1P clip:

```
Lb_StartSwim     3P=animations/3P_NoWeapon/3PSwimStartLower.baf      1P=None
Ub_StartSwim     3P=animations/3P_NoWeapon/3PSwimStartUpper.baf      1P=None
Lb_Floating      3P=animations/3P_NoWeapon/3PSwimFloatingLower.baf   1P=None
Ub_Floating      3P=animations/3P_NoWeapon/3PSwimFloatingUpper.baf   1P=None
Lb/Ub_SwimForward, Lb/Ub_SwimBackward, Lb/Ub_EndSwim                 1P=None
```

The five `AnimationStateMachine.set1pAnimationSpeed Ub_StartSwim 3.60` /
`Ub_Floating 0.40` / `Ub_SwimForward 1.00` / `Ub_SwimBackward 1.00` /
`Ub_EndSwim 3.20` lines in `animations/1pAnimationsTweaking.con` tune a clip
that was never registered. **That closes W8-B's "the first-person arms while
swimming" open item**: the engine's own first-person view of a swimmer is his
empty hands, and that is now what the page draws.

---

## 10. Defect 2 — `want` WAS being applied; nothing was drawing it

The lead's readout was

```
__footBody() -> want: "swimFloat", gait: "stand", visible: false, weaponVisible: false
```

and `gait: "stand"` was read as the applied family. It is not: `gait` is
`soldier.gait`, the locomotion row, and `#gaitFor` answers `'stand'` for **any**
stationary soldier — a swimming one included, which is the same trap
`soldier-body.js`'s own `locoFamily` comment documents. The applied family was
never in that readout at all.

So `__footBody()` now answers with the mixer as well as the request
(`map.html`, in the `window.__footBody` block):

```js
playing: Object.entries(footBody.families)
  .filter(([, actions]) => actions.some(a => a.getEffectiveWeight() > 0))
  .map(([family, actions]) => ({ family, weight: ..., time: ... })),
```

Measured in the sea at Wake, **in first person** (where the body is hidden) and
again in the chase view:

```
first person   want swimFloat   playing [{ swimFloat, weight 1, time 2.3667 }]
chase          want swimFloat   playing [{ swimFloat, weight 1, time 0.1667 }]
```

One family, weight 1, its clock running, in both. The application step does not
drop the swim set and it never did: `syncFootBody` on the deployed build is
byte-identical to this worktree's —

```
$ diff <(sed -n '/^function syncFootBody/,/^}/p' live-map.html) \
       <(sed -n '/^function syncFootBody/,/^}/p' viewer/map.html) && echo IDENTICAL
IDENTICAL
```

— and the drawn skeleton's own local rotations, read out of the scene before any
change in this stream, already differed from the standing pose and changed from
frame to frame (`Bip01_L_UpperArm` `[0.0049, 0.4034, -0.4407, 0.8019]` standing,
`[-0.3477, -0.0992, -0.2840, 0.8880]` floating, `[-0.3002, -0.1636, -0.4250,
0.8381]` 0.4 s later).

**What failed is that nothing put it on screen, for two separate reasons.**

1. `visible: false` persisted after `__footView('chase')` because the call was
   **refused**. On foot the view cycle is the engine's own set of one — CAM-1:
   `SoldierCamera` writes `CVMChase 0` and `BFSoldier::nextCamera` is an empty
   function — and `SOLDIER_3P_ON_FOOT` needs **`?foot3p=1`** to widen it (the
   flag and its switch were deleted on 2026-09-26; see
   `features/viewer-foot-first-person`).
   `SoldierView.setMode` then leaves the mode alone, silently, exactly as
   `Camera::setViewMode` returns 0. The lead's page was drawing no body to look
   at. `__footView()` reported `cycleOnFoot` so that refusal was legible
   instead of looking like a missing body.
2. In first person what the player was actually looking at was his **rifle**,
   held out in front of him, playing its ordinary idle clip. That is the wrong
   thing that was really on screen, and Defect 1's fix is what removes it.

Nothing in `soldier-body.js` or the `syncFootBody` switch needed changing. The
file and line that answers "why was `want` not applied" is therefore
`viewer/map.html:9090` (`const visible = ... && !footView3p.firstPerson ...`)
together with `viewer/map.html:8779` (`SOLDIER_3P_ON_FOOT = SOLDIER_3P_VIEWS &&
params.has('foot3p')`): the body was applied, and hidden.

---

## 11. The frames, each with its zero control

Served from this worktree on `localhost:5393` with the shared poses tree linked
in by `link_viewer_assets.sh`, driven through Playwright under SwiftShader at
840x600, `?mod=bf1942&map=wake&shots&foot3p=1`. **The page's own rAF loop was
stopped** (`__renderer.setAnimationLoop(null)`) before any pixel was read.
Drivers in the stream's scratch directory (`lib.mjs`, `p1_fire.mjs`,
`p2_anim.mjs`, `p3_breathe.mjs`, `p4a_state.mjs`, `p4b_drown.mjs`,
`p5_wade.mjs`). Wake, water level 95.0, open sea at (1289.4, -534.9), a
JapaneseSoldier holding a Type 99.

### He cannot fire, and the control is the same trigger on the beach

`__setTrigger(true)` held for 60 ticks, three times:

```
dry, on the beach     16 shots, 16 rounds spent, firing true,
                      locked false, rigVisible true, crosshair shown
swimming, open sea     0 shots,  0 rounds spent, firing false,
                      locked TRUE, rigVisible false, crosshair hidden
                      stateFlags 10 (0x2 | 0x8), swimState swimFloat, y 94.600
back ashore            4 shots,  4 rounds spent, locked false, rigVisible true
```

and beside it, while swimming: `__altFire()` → **false**, `__demolitions()`
unchanged, the weapon still `Type99` after a slot request.

### The rifle the gate removes, in first person

Same tick, same camera, same sea; the only thing moved is `swim.family`, pushed
off the flag table for one frame, which reproduces W8-B's behaviour exactly
(gate open, rifle in hand). `01-first-person-swimming.png` is an empty ocean;
`02-first-person-gate-open.png` is the Type 99 in the lower right of it.

```
1P, gate shut vs gate open   55,234 of 504,000 px (10.96%)
                             box [487,143]-[744,600], meanDelta 332.8, maxDelta 605
CONTROL (the same frame twice)    0 px, 0.00%
```

### The swim body is drawn, and it is the swim family

Chase view, with and without the body (`__footBodyHide`):

```
body box [354,281]-[486,539]
body in its box   12,802 of 34,056 px (37.59%), meanDelta 145.5, maxDelta 358
whole frame       12,802 of 504,000 px (2.54%)
CONTROL (the same frame twice)   0 px
__footBody() -> want swimFloat, playing [{ swimFloat, weight 1 }], weaponVisible FALSE
```

`06-float-t0.png` is a Japanese soldier chest-deep in the Pacific with his arms
out and **no rifle**.

### It is an animation, not a mesh parked on the sea

Two renders 0.4 s of sim apart, every time-driven uniform pinned (15 numbers, 8
vectors, 5 texture offsets) and redrawn **directly** with
`renderer.render(scene, camera)` rather than through `frame()` — `advanceSim`
writes `simTime` back into the water uniform on every frame, so pinning and then
stepping puts the sea back where it was going anyway. The chase camera was let
settle first: it drifts **0.000042 m** between the two reads, and the body's
position is unchanged at `[1289.4, 94.6, -534.9]`.

```
CONTROL (pin, redraw, redraw)                        0 px, 0.00%
a water-only box [40,400]-[200,560], the noise floor 8,173 px, meanDelta 1.3, maxDelta 6
a sky box        [40,20]-[200,120]                   0 px
the body box, delta > 7   12,608 of 34,056 px (37.02%), meanDelta 146.3, maxDelta 349
CONTROL at the same threshold                        0 px
clip clock  swimFloat 0.2667 s -> 0.6667 s
```

The threshold is the measured noise floor plus one, not a number anyone chose:
the camera's 4e-5 m of residual drift moves the water's view-dependent term by
at most 6 levels, and the body's own change is at 349. `07-float-t1.png` beside
`06-float-t0.png` is the same man with his arms and head in a different place.

### W8-B's four behaviours, re-measured, none regressed

**The state and the draft.** `waterLevel 95.0 - y 94.600 = 0.4000` exactly
(`SWIM_FLOAT_DRAFT`), depth 0.403, `swimming true`, `swimFloat`, `grounded
false`.

**The strokes and the ceiling.** W held for 3 s: state `swimForward`, `playing
[swimForward]`, **2.000 m/s**, travelled **6.665 m** (run is 6 m/s). Released →
`swimFloat`, decaying through 1.681 m/s. Identical to W8-B's 2.000 / 6.67.

**The wade-out at depth <= 0.35**, swum at the Landing Beach ramp rather than
teleported (a teleport drops him wherever he lands and never carries him up the
ramp), sampled every 3 ticks because `Lb_EndSwim` is 19 ticks long:

```
t 19.53  z -688.13  depth 0.403  swimForward  grounded false  locked true
t 23.13  z -692.23  depth 0.334  swimEnd      grounded TRUE   locked true
t 23.33  z -692.46  depth 0.301  swimEnd      grounded true   locked true
t 23.53  z -692.69  depth 0.269  swimEnd      grounded true   locked true
t 23.73  z -693.04  depth 0.219  (null)       grounded true   locked FALSE, want run
t 24.40  z -694.05  depth 0.077  standing, grace back to 90.0
```

The 0.35 threshold is what starts the exit, and the weapon comes back when the
**clip** finishes and not when the depth does — `Lb_EndSwim` declares
`c_AsmHideWeapon` like the other four, so `locked` stays true for the whole
0.3125 s of it. That is §1's "`Lb_EndSwim` still declares `c_AsmIsSwimming`"
with its sibling flag, measured.

**The drowning clock**, 1,250 renders at the animation loop's own 0.1 s clamp,
sampled every 5 s:

```
t   5 .. 85 s   hp 30, drowned 0          (grace 89.9 -> 4.9)
t  90 s         hp 29, drowned 1
t  95 s         hp 24        t 100 s  hp 19        t 105 s  hp 14
t 110 s         hp  9        t 115 s  hp  4        t 120 s  hp 0, destroyed TRUE
```

First hit between 85 and 90 s, then one HP a second off 30, dead at 119 s —
`CommonSoldierData.inc`'s law, unchanged. `swimState` is `swimFloat` and `want`
is `swimFloat` at every sample.

---

## 12. The re-extraction the real tree needs

**None.** This stream extracted nothing and published nothing. The one asset the
swim work needs — `poses/gaits/swim.gait.glb`, 426,700 bytes, and the `"swim"`
key in `poses/gaits/gaits.json` — is already in the shared tree and already on
`mesh.bfstats.io` (all 19 families bind on both). `git status --short` over
`tools/bf1942-models/viewer` reports nothing; the tree was reached by
`link_viewer_assets.sh` symlinks and read only.

## 13. Still open after this stream

| Item | Where it stands |
|---|---|
| **Remote swimmers** | Still W6-G's. `netcode-render.js` and `remote-gait.js` are outside this stream's files and are untouched, so a remote swimmer is still drawn with his locomotion gait: the snapshot carries no swim bit. The bit exists in the engine's own network state (`BFSoldier::getStateBits` `0x0827e1c0`). This is the half of the owner's "they have a swimming animation" that is not yet delivered |
| **Seeing your own swim animation on foot** | Only under `?foot3p=1`, and that stays a marked departure: CAM-1 says the engine authorises one view mode for a soldier. Not widened here. **Withdrawn 2026-09-26**: the flag and the switch behind it are deleted, so a standing soldier has no external view at all; `features/viewer-foot-first-person` has the change and the live check |
| **Messages 8, 9, 11, 12, 14..17, 22** | Named only as "inside the gated range". Their jump-table targets are read (`0x082779d0`, `0x082779dc`, `0x08277a09`, `0x08277ab0`, `0x08277add`, `0x08277b0a`, `0x08277b37`, `0x08277b75`) and all of them are past the gate, which is all this stream needed; the enum itself is unmapped |
| **The swim speed ceiling** | Unchanged and still a viewer number — §8's first row stands |
| **Sound** | Unchanged: the four `.ssc` scripts still ship and none is played |
