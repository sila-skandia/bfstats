# Bailing out: free fall, the scream, the chute, the glide, the landing

Stream W5-B of the 2026-09-19 parity round. What the engine does when a soldier
steps out of a flying aircraft, read out of the binary and the shipped data, and
what the viewer now does with it.

**The binary.** `/home/dylan/projects/public/bf42plus/bf1942_lnxded.static`
(md5 `59bc08cae90239eef86830db180ed100`, 15,218,900 bytes) — the Linux dedicated
server, not stripped, the authority for gameplay sim. Every address below is
that image's. `~/Downloads/bf1942_lnxded-1.61-patched/bf1942/bf1942_lnxded.static`
is a different md5 but the same layout: both put `setIsParachuting` at
`0x08276f90`. Decompiles through
`features/bf1942-engine-reference/lnxded/decompile.sh`.

**The data.** `~/.wine/drive_c/EA Games/Battlefield 1942/`, vanilla plus 17
mods.

---

## 1. The four states, and what carries each

| state | what the engine keeps | entered by |
|---|---|---|
| free fall | lower-body animation state `Lb_ParachuteFall` (`BFSoldierTemplate+0x1e4`), plus soldier state bit `0x2000` at `+0x3e6` re-set every tick | `BFSoldier::handlePlayerInput` `0x08275eaa`–`0x08275f5d` |
| chute open | soldier state bit **`0x10`** at `BFSoldier+0x3e6` | `BFSoldier::setIsParachuting(bool)` `0x08276f90` |
| glide | `Lb_ParachuteIdle`, reached by `Lb_ParachuteOpen`'s own `addTransitionWhenDone` | the animation state machine |
| landing | `Lb_ParachuteHitGround`, which `addTransitionWhenDone Lb_Stand` | `setIsParachuting(false)` |

`animations/AnimationStatesParachute.con` (in `animations.rfa`) creates all of
them. The state-name-to-template-offset map is `BFSoldierTemplate::init`
`0x0827a730`, which looks each one up by name and stores the result:

```
0x0827ab92   +0x1e4   Lb_ParachuteFall        (string 0x086d227c)
0x0827abe2   +0x1e8   Ub_ParachuteFall
0x0827aaf2   +0x1ec   Lb_ExplosionForward
0x0827ab42   +0x1f0   Lb_ExplosionBackward
0x0827b5e7   +0x250   Lb_ParachuteDie
0x0827b636   +0x254   Ub_ParachuteDie
```

Reproduce:

```bash
objdump -d -M intel --no-show-raw-insn --start-address=0x0827a730 \
  --stop-address=0x0827bc00 /home/dylan/projects/public/bf42plus/bf1942_lnxded.static \
  | grep -E 'push   0x86d2|mov    DWORD PTR \[edx\+0x1'
```

---

## 2. Falling: what arms it, and what the scream is

`BFSoldier::handlePlayerInput` (`0x08273c70`), inside the `stateBits & 0x10 == 0`
arm:

```
if (no active kit part sets its template byte +0x62)
 && getPositionalSpeed().y < -8.0                      // 0x08275eaa, const 0x086d2714
 && currentLowerState != Lb_ParachuteFall              // 0x08275ec6
 && pos.y - terrainBase->getHeight(pos.x, pos.z) > 10.0 // 0x08275f13, const 0x086b9314
                                                       // terrainBase 0x087435f0, vtable +0x54
      setAnimationState(0, Lb_ParachuteFall);
      setAnimationState(1, Ub_ParachuteFall);
```

`./lnxded/vt.py --float 0x86d2714` prints `-8.0`; `--float 0x86b9314` prints
`10.0`. **So it is neither height alone nor time alone: it is a downward speed
of more than 8 m/s taken more than 10 m above the terrain.** The height is
measured against the terrain heightfield, not against a downward cast — standing
11 m up a building over ground at 0 satisfies it. Both gates are required and
the height one is nested inside the speed one — re-derived by the W5-B review
from the Ghidra decompile of `handlePlayerInput`, which reads
`if (kitPartByte62 == 0 && speed.y < -8.0 && lowerState != template[0x1e4]) {
pos = getAbsolutePosition(); if (10.0 < pos.y - terrainBase->getHeight(pos.x,
pos.z)) setAnimationState(0, template[0x1e4]), setAnimationState(1,
template[0x1e8]); }`.

**`BFSoldier::triggerFallingAnimation` (`0x0827e920`) has nothing to do with
this**, and the brief that pointed this stream at it was wrong. It has exactly
one caller in the whole image — `GameServer::handleExplosionOnObject` at
`0x08156bb3` — and occupies no vtable slot: the only other occurrence of its
address anywhere in the file is its own `.symtab` entry (file offset
`0x9f0eb8`). It is the blast-knockback animation, not the skydive.

Both halves of that state declare `AnimationStateMachine.setSoundTrigger
c_SstFallingHigh`, so entering it starts
`Objects/Soldiers/Common/Sounds/SoldierFallingHigh.ssc`. That script is two
patches and six layers, each gated by its own `Volume <- Time` `Ramp p1 p2 0 1`
with a `trigger Volume`, so `p1` is when the layer starts:

| layer | sample | starts at | |
|---|---|---|---|
| 1 | `rcktlp1.wav` | 0 s | looping, `volume .2`, pitch 0.1 → 0.4 |
| 2 | `luft2.wav` | 0 s | looping wind |
| 3 | `fhs1.wav` | 1.2 s | |
| 4 | `fhs2.wav` | 2.3 s | |
| 5 | `soprupp.wav` | **11.5 s** | the easter egg — see below |
| voice | `fallparachute{,2,3}.wav` | 3.3 s | second patch, `randomPlay 1`, under `@Language` |

`tools/bf1942-models/extract_soldier_sounds.py` reads those numbers out of the
script with the pipeline's own `.ssc` parser rather than by hand, and prints
them straight back:

```
c_SstFallingHigh    layered     rcktlp1@0.0s, luft2@0.0s, fhs1@1.2s, fhs2@2.3s, soprupp@11.5s
c_SstFallingHigh    randomPlay  fallparachute@3.3s, fallparachute2@3.3s, fallparachute3@3.3s
c_SstOpenParachute  randomPlay  para1@0.4s, para2@0.4s, para3@0.3s
```

Two things fall out of that run:

- **The canopy's own crack is delayed too** — 0.3 to 0.4 s after you pull, not
  on the frame you pull.
- **`c_SstParachuteLand` has no script at all.** `SoldierSound.inc` says
  `loadSoundScript SoldierParachuteLand.ssc` and both landing states declare the
  trigger, but there is no such file anywhere in vanilla's `Objects.rfa` — its
  two siblings, `SoldierFallingHigh.ssc` and `SoldierOpenParachute.ssc`, are
  right beside it in the same directory. **A parachute landing is silent in
  retail**, which is presumably why nobody remembers a sound for it.

### The easter egg

`soprupp.wav` is 0.853 s at 22 kHz, it sits in the **ambience** patch beside the
rocket loop and the wind rather than with the `@Language` screams, and its gate
is **11.5 seconds of continuous falling** — about 830 m under this engine's
gravity, which is further than any vanilla level can drop you without an
aircraft. Nothing else in the install loads it.

**What the sample contains was not listened to, so "it is a fart" is UNVERIFIED
here** and stays the owner's account. What is verified is the file, the patch it
is in, the `randomPlay` that does *not* cover it, and the 11.5 — which answers
the question the brief asked, "the condition that selects it rather than the
scream": it is not a random choice at all, it is a time threshold, and the
scream layer fires at 3.3 s on every fall regardless.

---

## 3. Opening it: key 9 is real, and it is an item slot

There is no `c_PIParachute`. The chain is:

```
input bit 22 = c_PIMenuSelect9                        (the c_PI* string table, 0x006806a5 on)
  -> GameServer::checkPlayerTriggers  0x08150018       push 0x12, call [vt+0x9c]
  -> TemplateMessage 18
  -> BFSoldier::handleMessage  0x0827728b  (cmp edi,0x12; je 0x08277b84)
       if (!dead) and animMachine[lower].getCurrentState() == BFSoldierTemplate+0x1e4
          setIsParachuting(true)                       0x08277ba7
```

`checkPlayerTriggers` maps input bits 14…22 onto messages 10…18 in one ladder,
each gated on the analog value exceeding 0.5 — bit 14 is `c_PIMenuSelect1`, so
bit 22 is `c_PIMenuSelect9`. **The ripcord is the ninth item slot**, and the
engine simply gives that message a second job while the lower body is in
`Lb_ParachuteFall`. On the ground, or at any other moment, 9 selects item 9.

### What `setIsParachuting(bool)` changes

Read in full at `0x08276f90`. It is short and it does exactly four things:

1. **Sets or clears state bit `0x10`** at `BFSoldier+0x3e6`, and returns early if
   the bit is already in the asked-for state.
2. **Swaps the drag.** `[BFSoldier+0x60]` is the `PointPhysicsNode`;
   `vtable+0x94` is `PointPhysicsNode::setDrag` (`0x08256920`). Opening hands it
   `BFSoldierTemplate+0x2e4` (`setParachuteDrag`), closing hands it
   `BFSoldierTemplate+0x44` (the soldier's own `ObjectTemplate.drag`). That is
   the *whole* of what the parachute does to the physics besides §4's force.
3. **Drives the parachute object's own animation.** `[BFSoldier+0x26c]` is the
   `Parachute` child (`CommonSoldierData.inc`: `ObjectTemplate.addTemplate
   Parachute`, `setPosition 0/0.3/0`); `queryInterface(0xc49e)` on it gives an
   animation interface whose `vtable+0x14` is handed the string `"OpenParachute"`
   — which is the literal `c_SstOpenParachute` at `0x086d3ffe` **read from five
   bytes in**, i.e. the engine indexes past the `c_Sst` prefix. `OpenParachute`
   and `IdleParachute` are states at the bottom of
   `AnimationStatesParachute.con`, playing
   `animations/Vehicle/Parachute/ParachuteOpen.baf` (21 frames) and
   `ParachuteIdle.baf`. The same object's `vtable+0x2c` is called `(0, 1)` on
   open and `(1, 0)` on close.
4. **Sets the soldier's own animation states.** Open: `Lb_ParachuteOpen` +
   `Ub_ParachuteOpen`. Close: `Lb_/Ub_ParachuteHitGround` normally, or
   `Lb_/Ub_ParachuteDeadHitGround` when the byte at `BFSoldier+0x245` (dead) is
   set.

### The numbers, surveyed across every installed mod

`ObjectTemplate.setParachuteDrag` writes `BFSoldierTemplate+0x2e4`
(`ConsoleClass181::executeObjectMethod`, `0x082bc110`) and
`ObjectTemplate.setParachuteSpeed` writes `+0x2e8`
(`ConsoleClass182::executeObjectMethod`, `0x082bc3e0`). Both are
`ObjectTemplate` words on the soldier template, registered in
`__static_initialization_and_destruction_0` at `0x082b1c06` / `0x082b1cd4`
alongside `healFactor`, `repairFactor` and `set1pFov`.

| install | `setParachuteDrag` | `setParachuteSpeed` |
|---|---|---|
| **bf1942 (vanilla)** | **24.00** | **30.00** |
| DesertCombat, DC_Final, EoD, Pirates, WarFront, bfheroes, bg42, interstate | 24.00 | 30.00 |
| FH, FHSW | 24.00 | 10.00 |
| FinnWars | 20.00 | 20.00 |
| GCMOD | 5000.00 | 30.00 |
| bf1918 | 0.00 | 0.00 |

Every one of them declares the pair once, in
`objects/Soldiers/Common/CommonSoldierData.inc`
([`survey_para.py`](survey_para.py) beside this file re-runs the sweep). The same file carries the rest
of what the fall needs: `ObjectTemplate.drag 1.0`, `ObjectTemplate.mass 100`,
`HitPoints 30`, `SpeedMod 0.5`, `Material 40`.

---

## 4. `setParachuteSpeed` is an **acceleration**, and this corrects the corpus

The viewer's `physics.js` recorded `SOLDIER_BOUNDING_RADIUS = 0.8` on the
grounds that it makes the drag equation turn `setParachuteDrag 24` into a
terminal velocity of 30.5 m/s "against `setParachuteSpeed 30.00`". **That
argument is refuted.** `+0x2e8` is read in exactly two places, both in
`BFSoldier::handleUpdate` (`0x08271e30`), and both do this:

```
fld    DWORD PTR [ebx+0x2e8]        ; parachuteSpeed          0x08272700
...                                 ; times rows +0x20/+0x24/+0x28 of a Mat4
call   DWORD PTR [eax+0x6c]         ; addAccelerationAtRelativePosition
```

`PointPhysicsNode::addAccelerationAtRelativePosition` (`0x08256650`) ignores its
position argument entirely and adds the vector straight into the acceleration
accumulator at `+0x1c`, which `updatePositionalPhysics` (`0x082560c0`) spends
over the tick's four sub-steps and then zeroes. It is **30 m/s² along a forward
axis, every tick, beside gravity** — the same accumulator PHY-1's jump impulse
uses. It is not a speed and it was never commensurable with a terminal velocity.

Which forward axis differs between the two sites, and that difference is the
whole feel of the two states:

| state | site | axis | clamp |
|---|---|---|---|
| free fall (bit `0x10` clear, state `Lb_ParachuteFall`) | `0x082726fd` | the **camera**'s `getAbsoluteTransformation()` row 2 — `*(soldier+0x3f0)` → element → `+8` → `queryInterface(IID_ICompositeObject 0xc378)` → `vtable+0x40` | the product's `y` is forced to `<= 0` (`0x0827274d`–`0x08272764`), so it can never lift you |
| under the canopy (bit `0x10` set) | `0x082727f2` | the **soldier**'s own `getAbsoluteTransformation()` row 2 (`BFSoldier` vtable `+0x40`) | none |

(The canopy site's `fld [ecx+0x2e8]` is at `0x082727f2`; `0x082727e3` is the
`call [eax+0x40]` two instructions before it. An earlier draft of this file
quoted the call address as the read address in the prose above the table.)

Row 2 is forward, by two independent routes: the same `+0x20` triple is dotted
against the velocity a few lines earlier to choose `Lb_ExplosionForward` vs
`Lb_ExplosionBackward`, and `setRotateYDeg<float>` (`0x081a24b0`) writes
`m[0x00] = cos`, `m[0x08] = -sin`, `m[0x20] = sin`, `m[0x28] = cos` — so row 2
is the local **Z** axis and row 0 the local X.

`soldier+0x3f0` is not a bare pointer: the constructor allocates it at
`0x0826c1f1` through
`__simple_alloc<_List_node<dice::ref2::world::ICameraObject*>>::allocate(1)` and
makes it circular, so it is the sentinel of a `std::list<ICameraObject*>` and
the `+8` above is that node's data slot. **The free-fall axis is the soldier's
first camera object**, whose relative transform `handleUpdate` itself writes
each tick from the player's pitch and yaw (`0x08271f0d` on). The camera really
does steer the fall.

**One consequence needs no radius at all.** Under the canopy the body is upright,
so its forward row is horizontal, and both the forward term and gravity divide
by the same drag coefficient. The terminal glide ratio is therefore

```
horizontal : vertical  =  parachuteSpeed : |g|  =  30 : 14.73  =  2.037 : 1
```

whatever the drag works out to. That is the one fully-pinned number in the whole
descent.

### The drag law itself, re-read on the server

`PointPhysicsNode::updatePhysics` `0x082562c0` → `updatePositionalDragSimple`
`0x08255fc0`:

```
scale  = 1 + 24 * min(underWater / r, 1)
accel -= (scale*v - wind) * pi * r * r * drag / mass
```

with `r = this->vtable[+0x1c]` → the composite object's `getBoundingRadius()`.
Then `updatePositionalPhysics` integrates four sub-steps of `dt/4` and clears the
accumulator. This confirms `physics.js`'s existing implementation instruction for
instruction on the **server** as well as the client (PHY-3 was read on the
client).

### The radius is the one open number

`BCompositeObject<IPlayerObject>::getBoundingRadius` (`0x08165630`) is
`max(geometry radius, max over children of |childPos| + childRadius)`, cached at
`+0xb4`. Two ends of it are now known and neither is usable as-is:

- **The soldier's own geometry radius is exactly 1.0.** `ObjectTemplate.geometry
  BodyCollision` is a `SkeletonCollisionMesh`, whose `getRadius` (`0x083ad850`)
  reads the template's `+0x34`, which `computeBoundingValues` (`0x083afb80`,
  called from the constructor at `0x083af64a`) fills with `max |v|` over a
  **17-vertex hull the constructor hard-codes** at `0x083af34a`–`0x083af660`.
  There is no `bodycollision_m1` file anywhere in the install, so nothing
  authored can change it. Emulating the constructor ([`emu.py`](emu.py) beside
  this file, a 120-line interpreter over the `objdump` text) recovers the hull
  exactly:

  ```
  ( 0.0, -1.0,  0.0)                                   |v| = 1.000   the feet
  (+-0.2, -0.6, +-0.2)   four                          |v| = 0.663
  (+-0.2/+-0.4, 0.0, +-0.4/+-0.2)   eight              |v| = 0.447
  ( 0.0/+-0.4, +0.8, +-0.4/0.0)   four                 |v| = 0.894
  ```

  `max |v| = 1.0`, which is also the constructor's own default at `0x083af2fb`.
- **But the composite walk adds the children**, and every soldier carries
  `addTemplate Parachute` at `0/0.3/0` whose mesh `standardMesh/Parachute_m1.sm`
  has `max |v| = 13.493` (bbox x,z ±4.158, y 0…13.486 — the extraction pipeline
  already knows this number: `bf42/assemble.py`'s `is_foreign_skeleton_part`
  exists to keep "13.5 m of canopy standing on the soldier's head" out of the
  bake). Taken literally the composite radius is 13.79, at which a soldier's
  terminal fall is 2.5 m/s and **HP-14 fall damage could never happen at all**.

So the engine's own value is somewhere between and this corpus cannot say where.
Two shipped behaviours bound it.

> **Corrected by the W5-B review, 2026-09-21.** The first draft of this section
> put the window at `1.563 < r < 2.8`. Both ends were wrong, and the lower one
> was wrong in the direction that matters: it tested the **vertical** descent
> against HP-14's 8.0 m/s floor, but HP-14's `|v|` is the **full** impact speed
> and the canopy carries `2.0367 ×` the vertical as horizontal all the way to
> the ground. The corrected window is **`2.354 ≤ r < 3.126`**, derived below,
> and the shipped `r = 1.8` sits outside it — which is the whole reason §5
> needed a mechanism of its own.

- **A chute landing is survivable.** `Lb_ParachuteHitGround` ends
  `addTransitionWhenDone Lb_Stand`, and the dead case has its own separate
  `Lb_ParachuteDeadHitGround`. HP-14 subtracts 8.0 from the impact speed and
  returns with no damage at all when that goes negative, so survivability is
  exactly `|v| ≤ 8.0` at touchdown — and `|v|` is the whole velocity, because
  the obliqueness is already carried by the separate `A = |cosθ|³` term (and
  `A` is lerped to 1 for any `F ≥ 3` anyway, so the angle cannot save a long
  drop). With the radius-free glide ratio of §4,

      |v| = v_y · sqrt(1 + 2.0367²) = 2.2690 · v_y ,   v_y = 1473 / (pi · r² · 24)

  so `|v| ≤ 8.0` gives **r ≥ 2.354**. Below that the engine bills the landing:
  at the shipped `r = 1.8` the canopy arrives at `|v| = 13.681 m/s`, and
  `fall-damage.js` returns a severity of **6855** against 30 HP.
- **The canopy never closes in mid-air.** `BFSoldier::handleUpdate` calls
  `setIsParachuting(false)` as soon as `|getPositionalSpeed().y| <= 2.0` (§5).
  A descent that settles at or below 2 m/s would therefore drop the canopy
  while still in the sky, which is not a thing that happens, so
  `v_y = 1473 / (pi · r² · 24) > 2.0` gives **r < 3.126**. This replaces the
  first draft's `r < 2.8`, which was a judgement about fall damage still
  "feeling" present rather than a derivation — at `r = 2.8` the free-fall
  terminal is still 59.8 m/s and a 7.55 m drop still arrives essentially
  undamped, so that bound bound nothing.

Note what the corrected window does **not** fix: the free-fall run-off of §7.
At `r = 2.354` the free-fall horizontal terminal is still 172 m/s. The radius
is not the lever for that one.

**The viewer flies the parachute at r = 1.8, taken from the first draft's
window. It is UNVERIFIED as the engine's number, and it is now known to be
below the window shipped behaviour forces.** `physics.js` keeps
`SOLDIER_BOUNDING_RADIUS = 0.8` untouched, because every HP-14 figure (no damage
below 3.97 m, lethal at 7.55 m) was measured against it and at the soldier's own
`drag 1.0` the term is inert either way (terminal 733 m/s at 0.8, 145 m/s at
1.8). Only `r² * drag` reaches the integrator, so `parachute.js`'s
`effectiveParachuteDrag(0.8) = 121.5` reproduces the coefficient r = 1.8 with
drag 24 would give, to nine decimal places, without moving a constant another
stream owns.

---

## 5. Landing, and dying under the canopy

`BFSoldier::handleUpdate` closes the chute on `|getPositionalSpeed().y| <= 2.0`,
in both of its parachuting arms (`0x08272f3b`, `0x08273129`). Under a canopy the
descent never falls to 2 m/s in the air, so in practice this fires on the tick
the ground stops you, and `setIsParachuting(false)` then plays
`Lb_/Ub_ParachuteHitGround` (or the `Dead` twins if `+0x245` is set) and restores
`ObjectTemplate.drag`.

A man can be shot in his chute: `Lb_ParachuteDie` / `Ub_ParachuteDie` exist as
states in their own right (template `+0x250` / `+0x254`, reached from
`BFSoldier::handleDamage` `0x08270980`), and `Lb_ParachuteDeadHitGround` is what
his body plays when it arrives.

### Fall damage under a canopy — a deliberate deviation

HP-14's severity carries `Q = max(1, (F - 1) * kitDamping)` and squares it, where
`F = getLastCollisionHeight() - y` is the drop since the last contact. A man who
steps out at 120 m and floats the rest of the way down still arrives with
`F = 120`, and `Q²` alone makes that landing worth **~6,900 HP** against his 30 —
measured, before the fix, through `tests/parachute_harness.mjs`.

The engine's own data says that cannot be what happens (`Lb_ParachuteHitGround`
→ `Lb_Stand`), and `F` is the only term the drop height enters through.

### The engine's writer, found

The first draft of this section said the writer of `Armor+0x28` "was not found",
having hunted for callers of the **virtual** setter. That was the wrong place to
look: `Armor::setLastCollisionHeight` (`0x08174480`, vtable `+0xf8`) is a weak
two-line accessor that nothing in the server calls, and the three `+0xf8` call
sites inside `BFSoldier` are a different class's slot — each of them tests the
return value with `test eax,eax`, so none is the `void(float)` setter.

The field is written **inline**, at the tail of `Armor::update(float)`
(`0x08172f40`), at `0x081730b0`–`0x081730e7`:

```
 81730b0:  mov    eax,DWORD PTR [edi+0x34]     ; the owner IObject
 81730b9:  call   DWORD PTR [edx+0x38]         ; getAbsolutePosition()
 81730bc:  fld    DWORD PTR [edi+0x28]         ; lastCollisionHeight
 81730bf:  fld    DWORD PTR [eax+0x4]          ; pos.y
 81730c5:  fucompp
 81730c9:  test   ah,0x45
 81730cc:  jne    817304c                      ; skip unless pos.y > lastCollisionHeight
 81730e1:  mov    eax,DWORD PTR [eax+0x4]
 81730e4:  mov    DWORD PTR [edi+0x28],eax     ; lastCollisionHeight = pos.y
```

guarded one level up by `Armor+0x129 == 0` — the per-tick "collided" byte that
`Armor::collision()` (`0x08174470`) sets. **So the engine's own rule is: every
tick the object is not in contact, raise `lastCollisionHeight` to its current
`y`.** It is a running maximum of altitude, reset by contact.

That settles what the number is, and it settles that the engine does **not**
neutralise `F` for a parachutist: a man who steps out at 120 m keeps
`lastCollisionHeight = 120` all the way down, and `F = 120` on arrival. The
engine's actual answer to the 6,900 HP is §4's radius — at `r ≥ 2.354` the
canopy touches down at `|v| ≤ 8.0` and `handleCollisionLandOrWater` returns
before it reaches `Q²` at all. At the shipped `r = 1.8` it does not, which is
why this mechanism exists:

So the viewer's mechanism is its own and is marked as such in
`soldier.js#stepParachute`: **re-stamp `lastCollisionHeight` every tick the
canopy is carrying you**, which bills the touchdown for the last tick's descent
and nothing else. It differs from the engine's rule only in direction — the
engine raises the value and never lowers it — and it exists solely to cover a
radius that is below §4's corrected window. Raise `PARACHUTE_DRAG_RADIUS` into
that window and this whole block can go: the outcome then comes out of HP-14's
own 8.0 floor, with nothing invented.

---

## 6. What the viewer now does

- **`viewer/parachute.js`** — new. The state machine, both forces, the sound
  schedule and the clip names. Imports nothing, so
  `tests/parachute_harness.mjs` drives it under node.
- **`viewer/soldier.js`** — `bailOut(x, y, z, yaw, vx, vy, vz)` places a body at
  altitude with a velocity and *without* `spawn()`'s 600 m floor probe;
  `#stepParachute` runs the state machine once per 60 Hz tick, before the body
  step so the acceleration lands in the same accumulator the tick spends;
  `drainParachuteEvents()` hands the caller the sound/animation triggers.
  While falling or gliding the locomotion input is zeroed, because both states
  declare `AnimationStateMachine.setSpeed 0 1 0` and PHY-8 has that forward term
  multiplying the locomotion table.
- **`viewer/physics.js`** — `setParachute(on, drag)` takes the scaled drag; the
  `SOLDIER_BOUNDING_RADIUS` comment no longer cites the refuted coincidence.
- **`viewer/world.js`** — `shapeInput` carries `deploy` and `dead`.
- **`viewer/map.html`** — five small edits, listed in §8.

### Measured, on the page

Wake, 640x400, stepped through `__renderOnce` ([`bailcheck.mjs`](bailcheck.mjs)
beside this file; serve the viewer on your own port first). Out of a plane
120 m above the terrain doing 80 m/s:

```
      t state     fallT      y        x     h   descent  glide   drag  hp  events
  1.000 falling    0.65   225.26   101.20 130.26  17.467  97.469   1.0  30  falling,rcktlp1,luft2
  2.000 falling    1.82   195.14   233.92 100.14  34.050 129.807   1.0  30  fhs1
  2.200 open       1.93   183.03   278.22  88.03  18.843  64.651 121.5  30  ripcord: open
  3.200 open       1.93   171.38   311.79  76.38   6.788  15.382 121.5  30
  5.200 open       1.93   156.61   342.50  61.61   6.032  12.288 121.5  30
 13.200 open       1.93    98.72   460.39   3.72   6.030  12.280 121.5  30
 14.200 none       0.00    95.00   467.97   0.00   0.000   0.000   1.0  30  land, Lb_ParachuteHitGround
```

- free fall arms **0.65 s** after stepping out, which is `8 / 14.73 = 0.543 s`
  plus the tick that crosses it;
- the canopy settles to **6.030 m/s down and 12.280 m/s forward**, against the
  closed forms 6.0297 and 12.2805 — a **2.0367 : 1** glide;
- the landing costs **0 HP of 30**; the same drop with no chute lands at
  **101.9 m/s** and kills outright;
- the sound layers fire at 0, 1.2, 2.3, 3.3 and 11.5 s of fall, within one tick
  of the script's own times.

---

## 7. Not done, and what is open

- **No audio plays yet, but the samples are one command away.**
  `tools/bf1942-models/extract_soldier_sounds.py --out <tree>` writes eleven
  mp3s (251 KB: `rcktlp1`, `luft2`, `fhs1`, `fhs2`, `soprupp`,
  `fallparachute{,2,3}`, `para{1,2,3}`) plus `sounds/soldier.json`, the
  manifest carrying every layer's volume, loop flag and `Time` gate. It was
  run into a scratch tree and checked; it was **not** run into
  `viewer/maps/_shared`, because that tree is the lead's and read-only from a
  worktree. `parachute.js` meanwhile emits each trigger by the engine's own
  name with the sample, the `randomPlay` choices, the volume and the delay,
  and `map.html` collects them — so the remaining work is a player that reads
  `soldier.json` and the event stream, and it has nothing left to discover.
- **No third-person parachute animation.** The extracted soldier glbs carry
  **zero** animation clips — `extract_pose.py` bakes three *static* poses
  (`Lb_Stand`/`Lb_Crouch`/`Lb_Lie` plus `Ub_*<Weapon>`) and nothing animates a
  3P soldier at all; the only clips anywhere in the tree are the six on the
  first-person viewmodel glbs (`idle/walk/run/fire/reload/deploy`). The
  `.baf` data is all present in `animations.rfa` — 18 `3PParachute*.baf` plus
  the canopy's own two — and their frame counts read cleanly through
  `bf42.baf.parse` (`3PParachuteOpenLower` 41, `3PParachuteGlideLower` 12,
  `3PParachuteGroundLower` 6, `3PParachuteFallLower` 12); what is missing is a
  3P clip export, which is a pipeline feature and not this stream's.
  `parachute.js` therefore *names* the clip pair for every state
  (`PARA_CLIPS`), so a renderer that gains one can ask for them by the engine's
  own names.
- **The free-fall look-steering is faithful and does not feel like retail.**
  30 m/s² along the camera axis with only the upward half clamped means a
  soldier who free-falls looking level accelerates horizontally without a
  practical bound: measured above, 97 m/s at t = 1 s becoming 197 m/s at
  t = 3.5 s. No single drag radius reconciles that with HP-14 still existing
  (§4's two bounds are contradictory if the run-off has to be tamed by drag).
  Either retail really does fling a free-falling man, or one of the two reads
  in §4's table is wrong. **The viewer ships the engine's reading unchanged**
  rather than inventing a cap; it is self-correcting in practice because
  opening the canopy multiplies the drag by 24 and bleeds the horizontal off
  with a 0.41 s time constant. This is the one behavioural question a verifier
  should take first: `0x082726b8`–`0x08272764` is the whole of it.

  **Re-derived from raw disassembly by the W5-B review, 2026-09-21: every part
  of that reading is correct and the run-off stands.** Specifically —
  - The axis is the camera's. `soldier+0x3f0` is the sentinel of a
    `std::list<ICameraObject*>` (allocator call at `0x0826c1f1`), and the same
    `handleUpdate` writes that camera's transform from the player's pitch and
    yaw at `0x08271f0d` on.
  - Row 2 is forward, by `setRotateYDeg` (`0x081a24b0`) as well as by the
    `Lb_ExplosionForward` dot.
  - The clamp is `y ≤ 0`, not `y ≥ 0`. `fldz` / `fld [ebp-0xb4]` /
    `fucomp st(1)` / `test ah,0x45` / `jne` at `0x0827274d`–`0x08272764`:
    `test ah,0x45` clears ZF for every x87 result except *greater*, so the
    fallthrough — the one that stores the popped `0.0` over `y` — is taken
    exactly when `y > 0`.
  - The argument order at the call site is `(zero, force)`, and that is right:
    `PointPhysicsNode::addAccelerationAtRelativePosition` (`0x08256650`) reads
    `[ebp+0x10]`, its **second** argument, into the accumulator and never
    touches the first, while `PhysicsNode`'s version (`0x08255230`) uses the
    first as the lever arm. The signature is `(position, acceleration)`.
  - It is applied every tick, gated only on `stateBits & 0x10 == 0` and
    `getCurrentState(lower) == template+0x1e4`, inside `soldier+0x245 == 0`
    (alive) and `flags & 4 == 0`. Nothing upstream throttles it.

  What the review did change is §4's radius window — but not in a way that
  helps here: the corrected `2.354 ≤ r < 3.126` still leaves the free-fall
  horizontal terminal at 172 m/s. The run-off is not a radius problem.
- **The drag radius** (§4). The honest lever if the descent ever needs
  re-tuning; nothing else in the law is free.
- **`c_AsmLockFreeLook` on `Lb_ParachuteOpen` is not modelled.** The engine
  locks the view for the 3.15 s the opening clip plays and releases it for
  `Lb_ParachuteIdle`, which declares no such flag; the viewer leaves the view
  free throughout. Firing under the canopy is already right without any work
  — `Ub_ParachuteOpen`'s `addTransitionWhenDone Ub_StandAim` puts the upper
  body straight back into the ordinary aiming state, and the viewer never took
  the weapon away.
- **The kit-part gate on the falling state.** `handlePlayerInput` skips the
  whole free-fall branch when any active kit part's template carries a non-zero
  byte at `+0x62`. What that byte is was not chased.
- **Multiplayer: confirmed not replicated.** The W5-B review checked it.
  `netcode.js`'s `encodeInput` writes a fixed bit mask — bit 4 walk, 20 prone,
  21 crouch, 22 jump — and `decodeInput` reads exactly those back; neither
  `deploy` nor `dead` is in the codec, so a remote player's canopy does not
  replicate at all. Nothing regresses (the field is simply dropped), but the
  fix is not free: **bit 22 is already spent.** The viewer put jump there as a
  documented departure, and bit 22 is precisely `c_PIMenuSelect9` — the
  engine's own ripcord bit (§3). Whoever wires this up has to move jump or
  find another bit, and should say which in the codec's header.

---

## 8. Exactly what changed in `map.html`

Five edits, all small, because every stream in this wave touches that file:

| where | what |
|---|---|
| the number-key branch in `keydown` (`~2354`) | `keys.add(e.code)` before it returns, so slot 9 reaches the input word as well as `selectKitWeapon` |
| `HUD_FOOT` (`~8078`) | one phrase, `9 chute` |
| `exitVehicle` (`~7633`) | reads the exit height and the hull velocity, and calls `soldier.bailOut(...)` instead of `soldier.spawn(...)` above `BAIL_OUT_HEIGHT` |
| the on-foot input word (`~13270`) | `deploy` and `dead` channels |
| after `world.step` (`~13312`) | drains `soldier.drainParachuteEvents()` into `parachuteLog` |
| the debug hooks (`~13960`) | `__bailOut`, `__parachute()`, `__setDeploy()` |

The exit path itself is otherwise untouched: `leaveVehicle`, `exitPose`,
`exitPoseManned` and `leaveManned` are exactly as they were.

---

## 9. Ledger rows

See the final message of this stream; the lead owns `ledger.md`.
