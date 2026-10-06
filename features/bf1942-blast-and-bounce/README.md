# The blast, the bounce and the painted ground

Wave-3 stream B of the 2026-09-19 parity round, closing items 5, 6 and 7 of
[`viewer-changes.md`](../bf1942-parity-round-2026-09-19/viewer-changes.md)'s
"Open after wave 2".

Three things the viewer did not do: a grenade at a man's feet cost him nothing,
a fuse round stopped dead where it first touched, and the combat area only
tested its rectangle. All three are now the engine's own arithmetic, and the
research that got there changed two of the three answers the brief expected.

A fourth was added on 2026-10-06 for the Desert Combat parity round (section
4): the same blast now throws the soldier it prices.

Every address is `bf1942_lnxded-1.61-patched/bf1942/bf1942_lnxded.static`.

---

## 1. The soldier's exposure (HP-9, HP-10)

### What `checkForHitOnSoldier` actually is

`GameServer::checkForHitOnSoldier(Pos3 blast, float, BFSoldier*, IObject*)`
(`0x08156090`), read end to end. It is three copies of one loop, chosen by
`BFSoldier::getPose()` (`0x0827ddc0` — `1` for state flag `0x20`, `2` for
`0x40`, else `0`), and each copy adds a table of `Vec3` offsets to the
soldier's `getPos()` (IObject vtable `+0x38`, called at `0x0815612d`) and asks
`checkIfRayHitsSoldier(blast, sample − blast, soldier, source)`
(`0x0815b5e0`) whether the segment is clear. The clear count is `fild`ed and
divided.

| pose | table | samples | loop | divisor |
|---|---|---|---|---|
| 0 standing | `0x0871bac0` | 9 | `mov edi,0x8` + `dec edi; jns` | 18.0 (`0x86c08d0`) |
| 1 crouching | `0x0871ba40` | 9 | same | 9.0 (`0x86c08cc`) |
| 2 prone | `0x0871ba00` | 3 | `mov edi,0x2` | 3.0 (`0x86c08c8`) |
| anything else | — | — | a `dice::ref2::Debug` line at `0x0815624f` | `fldz`, `0x08156298` |

The tables, verbatim (offsets from the soldier's **object origin**, which
`setCharacterHeight -1.00` puts 1.0 m above his feet):

```
standing / crouching   x in {0, -0.2, +0.2}  y in {-0.1, -0.3, -0.7}  z = 0
prone                  x in {0, -0.5, +0.5}  y = -0.7                 z = 0
```

Three things a reconstruction gets wrong, and all three are pinned by tests:

1. **The standing and crouching tables are byte-identical** — all 108 bytes.
   The only difference between the two poses is the divisor, so a fully
   exposed standing soldier scores exactly **0.5** and a crouching one
   **1.0**. *Crouching in the open takes double the splash standing does.*
2. **The offsets are never rotated.** No basis change appears anywhere in the
   function, so the lateral spread is always along **world X** whichever way
   the man faces.
3. Prone's single row at y = −0.7 is exactly the prone camera height
   (`setPoseCameraPos c_BfSoldierLying 0/-0.7/0`), i.e. 0.3 m off the ground.

### What the ray is cast against

`checkIfRayHitsSoldier` does two casts and both must come back clear:

* **world objects** — the ray query on `ds:0x871dc24` vtable `+0x48`
  (`0x0815b677`) with a filter holding the root parent of the source object
  (`0x0815b616`) and mask `0x200`. A hit that is **not the soldier himself**
  returns false (`0x0815b689`).
* **the terrain** — `dice::ref2::geom::terrainBase` (`ds:0x87435f0`, the same
  global the combat area reads), a collision interface off vtable `+0x8` and a
  segment test at `+0xc` (`0x0815b811`). A hit returns false; **no terrain
  collision interface at all returns true** (`0x0815b821`).

### One engine slip, read and deliberately not reproduced

When a sample sits **below** the blast (`dir.y < 0`, the `fucom` at
`0x0815b6f6` and `test ah,0x45` at `0x0815b70c`) the terrain cast is flipped to
point upward — the standard trick — but the origin is computed as `from − dir`
(`fsub st,st(3)` at `0x0815b723`, and again at `0x0815b72a` / `0x0815b72e`).
Flipping the segment `[A, A+d]` correctly gives `[A+d, −d]`; `from − dir` is the
sample **mirrored through the blast**, so for any sample below the explosion
the terrain half runs on a segment that never touches the real path. The object
half is unaffected — it always uses the true `from`/`dir`, so a wall still
blocks.

`soldier-exposure.js` casts the real segment. Reproducing the slip would let a
grenade on a roof kill a man on the floor below *through the roof*, which is a
worse lie than the one it fixes. Following the collision round's own precedent
for the `shareB = +1.0` sign slip: named with its addresses, not ported.

### What it is worth in hit points

A grenade: `material2 205`, `radius 15`, `materialDamage(205)` 30,
`damageMod(205, 40)` 2.0 against a soldier's material 40 and his 30 HP.

| where | falloff | standing (0.5) | crouching (1.0) |
|---|---|---|---|
| at his feet | 1.00 | 30 HP — **dead** | 60 HP — dead |
| 7.5 m (half radius) | 0.50 | **15 HP, alive on 15** | **30 HP — dead** |
| 7.5 m, two samples through | 0.50 | 3.33 HP | — |
| in cover | — | 0 (short-circuit, `0x08156ede`) | 0 |

---

## 2. The bounce (COL-2, and what elasticity 2.0 is for)

### The path

`Projectile::handleCollision` (`0x0831ee80`) was read in full and **it changes
no velocity at all**. Its whole body is the sticky attachment (`+0x1ab`,
`0x0831ef16`), `BFSoldier::projectileHit`, the recycle (`dieAfterColl` `+0x1a7`
and `hasCollisionEffect` `+0x1a4` at `0x0831ef4b` / `0x0831ef54`) and a
**bool**. That bool is its whole say in the response — `checkObjectVsObject`
skips the impulse for a handler that returns 0 — and the only `return 0` path
is a water contact without `detonateOnWaterCollision` (`+0x1ac`, `0x0831f3ae`).

So the bounce is the generic contact response. The reason a fuse round reaches
it, which the collision round's section 10 says projectiles do not:

```
GrenadeAlliesProjectile   setHasCollisionPhysics 1  setHasResponsePhysics 1  setHasPointPhysics 0
GrenadeAxisProjectile     same
ExpPackProjectile         same
LandmineProjectile        same
```

`ProjectileTemplate`'s constructor sets `hasPointPhysics`, and a point body's
`PointResponsePhysics::impulseOn` and `::addFriction` are **empty**. All four
vanilla fuse rounds opt out; a shell does not. So a shell gets no response and
a grenade gets the real one.

### The arithmetic, per 30 Hz tick

```
impulseOn      0x08258900
  speedAdjust += -(v . n / n . n) * n                       0x08258c47-0x08258c63
  posAdjust   += -depth * n                                 0x08258981-0x08258990
  friction   (+0xa8) = 0.5 * (f(mat1) + f(mat2))            0x08258b76-0x08258ba0
  elasticity (+0xac) = 0.5 * (e(mat1) + e(mat2))            0x08258bac-0x08258bd6
  resistance (+0xb0) = 0.5 * (r(mat1) + r(mat2))            0x08258be2-0x08258c06
      the 0.5 is ds:0x86b05e8 (0000003f)

solveImpulse   0x08258d30
  a = speedAdjust * 30 * (1 + elasticity) * 0.5
      fld1; fadd [edx+0xac] at 0x08258ed4/0x08258ed6
      30.0 at ds:0x8716b5c (0000f041), the same 0.5 at 0x08258ee2
```

The integrator applies an accumulated acceleration for one tick and zeroes it,
so the velocity change is `speedAdjust · (1 + e) / 2` **once**, and the normal
component that survives is

> **`v_n' = v_n · (1 − e) / 2`**

### What the data puts in it

`materialManagerdefine.con`, surveyed across all 18 installed mods:
**elasticity is 0 for every vanilla material except id 70 "Grenades", which is
2.0** (with friction 2.0 and resistance 2.0). GCMOD adds 543, interstate adds
11 (0.1) and 45 (−1.0), bfheroes adds 2011 (15.0) and 2012 (1.5); every other
install that declares the word declares 70 alone. FinnWars declares the three
words with elasticity 0 throughout.

And a contact brings the **collision-vertex** material, not
`ObjectTemplate.material` — the u16 in the low half of each `.sm` collision
vertex's fourth float:

| mesh | col0 | vertex material | `ObjectTemplate.material` |
|---|---|---|---|
| `gran_al_Base_m1.sm` | 6 | **70** | 70 |
| `granade_axis_m1.sm` | 6 | **70** | 70 |
| `demokit_m1.sm` | 6 | **195** | 70 |
| `landmine_m1.sm` | 12 | **232** | 230 |

195 and 232 are **declared** in `materialManagerdefine.con` — each carries a
`materialDamage` and none of the three physical words — so `getMaterialPtr`
does not miss on them and neither falls through to material 0. Each is a real
`Material` holding the constructor's friction 1.0, elasticity 0 and resistance
**0.01**, which is what `bf42/damage.py` now writes for every declared id. The
fall-through is real but it is for the *gaps*: the file declares 155 ids, and
16–38, 71, 73–78, 99 and the rest of the holes are what reach
`getMaterialPtr(0)` and material 0's authored 0.02. The accessors `0x081751b0`
/ `0x081751f0` / `0x08175230` read `Material+0x0c` / `+0x10` / `+0x14` and
share that chain, with `fld1` if material 0 is missing too.

### The answer, and it is not the one the brief expected

* A **grenade** against any vanilla surface: `e = (2.0 + 0)/2 = 1.0`, so
  `v_n · (1 − 1)/2` is **zero**. **A grenade does not rebound.** It cancels its
  into-surface velocity exactly and keeps all of its along-surface velocity,
  then sheds that against the largest friction and resistance in the game.
  Elasticity 2.0 is precisely the value that produces that, and reading it as a
  restitution coefficient of 2 (a round leaving faster than it arrived) is the
  obvious mistake.
* An **explosives pack** or a **landmine**: `e = 0`, so `v_n/2` — half the
  closing speed removed per tick while the positional push-out separates it. It
  settles where it is put, which is the whole point of both.

The visible change is therefore not a rebound. It is that a grenade thrown
along the ground now **skids**, and one thrown at a wall **slides down it** — a
vertical face has `N.y = 0` and `addFriction`'s Coulomb budget is
`μ · N.y · 14.73/30`, so a wall applies no friction at all and only the viscous
`−resistance · Vt` term slows it.

### Measured, on a synthetic flat world (`tests/test_contact_response.py`)

The same throw — 18 m/s forward, 4 m/s up, from 1.6 m — under the old "stop
dead at first contact" rule and under the contact solver:

| | rest | note |
|---|---|---|
| before | **14.38 m** | frozen at the crossing |
| grenade | **18.75 m** | μ 1.4, resistance 1.04 |
| landmine | **25.58 m** | μ 0.9, resistance 0.045 |
| explosives pack | **25.58 m** | μ 0.9, resistance 0.045 |

The landmine and the pack are identical to the millimetre, and they should be:
195 and 232 are two bare declarations of the same three constructor values, so
the pair against any one surface is the same pair.

Against a wall 6 m out, all of them end at its **foot** (y = 0) rather than
hanging where they touched; the grenade takes two contacts to kill its
into-wall speed, the landmine fourteen.

Dropped from rest on a slope, `tan θ > μ` decides:

| slope | grenade (μ 1.4) | landmine (μ 0.9) |
|---|---|---|
| 20 % (11°) | stays (5 mm) | stays (17 mm) |
| 100 % (45°) | slides 0.39 m, sticks | **rolls away**, still 4.7 m/s at 3 s |

Identical at 30, 60 and 144 Hz: every budget in the solver is a per-tick
velocity change, so the step is fixed at 1/30 with a carried remainder.

### Measured on the page (Berlin, `?mod=bf1942&map=berlin`)

A `GrenadeAxis` thrown from the spawn:

```
first contact   22.39 m out, 22.96 m/s, surface material 14 (Dirt road)
                pair { friction 1.5, elasticity 1.0, resistance 1.01 }
rest            29.35 m out, velocity 0, 1 contact, surface material 4
skid                       6.96 m
```

Those 6.96 m are exactly what the round used to lose.

---

## 3. The combat area's painted half (CA-5)

`GameServer::gameStatusPlaying`'s in-bounds branch (`0x08152525`, reached by
`jne` from the last rectangle test) asks the terrain for the material under the
player and compares it with `materialToGiveDamage`:

```
0x08152535  call [edx+0x4c]       ; PatchTerrain::getMaterial(this, pos.x, pos.z)
0x0815253b  xor  edx,edx
0x08152540  mov  dl,[ecx+0x474]
0x08152546  cmp  eax,edx
0x08152548  je   0x08152414       ; MATCH -> the same accumulate path
0x0815254e  eax = 0
0x08152553  [esi+0x178] = 0       ; mismatch -> zero the accumulator
```

The byte defaults to **7** (`mov BYTE PTR [edi+0x474],0x7` at `0x0812f287` and
`0x0812f7c7`), and those two plus `setMaterialToGiveDamage` (`0x0813dff9`) are
the only writers of `+0x474` in the whole binary. `materialToGiveDamage` **is**
a registered console word (`.rodata 0x66a389` — the earlier reading listed
three words and missed it), but no `.con` in any of the 18 installed mods sets
it. So 7 stands everywhere.

`PatchTerrain::getMaterial` (`0x083d6800`) returns a **nibble**: the buffer at
`PatchTerrain+0x140` is allocated at `fileSize / 2` (`shr eax,1` at
`0x83d5d96`) and the index is `(ix>>1) + iz·(dim/2)` with the high nibble for
even `ix` and the low for odd (`0x083d68d8`–`0x083d68ec`). So the ids it can
return are 0–15 and they are exactly the bytes in `Materialmap.raw`, which is
what `terrain/materials.png` already ships.

### What material 7 turns out to be

`materialManagerdefine.con` heads it **"Reserved (Outside map)"**, and the
extracted material maps say that is exactly what it is — the out-of-map
surround of a single playable pocket, with no patches inside the pocket. What
makes it worth modelling is that the pocket is usually far smaller than the
rectangle the level declares. Eleven of the 23 vanilla levels paint it, and
several paint it over most of their own rectangle:

| level | mat-7 samples | inside its own combat area |
|---|---|---|
| berlin | 99.0 % | **84.1 %** of the 512 m box |
| tobruk | 92.0 % | 68.1 % |
| liberation_of_caen | 88.0 % | 66.9 % |
| battle_of_the_bulge | 84.8 % | 61.2 % |
| stalingrad | 92.9 % | 57.8 % |
| omaha_beach | 82.4 % | 50.1 % |
| market_garden | 59.7 % | 47.4 % |
| battle_of_britain | 21.1 % | 21.1 % |
| aberdeen / kharkov / kursk | 33–37 % | *no rectangle at all* |

Taken as "most of Berlin's box", that reads as though the ground between the
streets were lethal. It is not what the channel says. Berlin's 2,607 non-7
samples form **one connected pocket** of about 200 x 270 m in the south-east of
the 2048 m world, and inside it there is no material 7 at all — the streets,
the courtyards and the ground under the buildings are all 4 "Dry dirt",
8 "Gravel" and 14 "Dirt road", and 7 starts where the level does. Rendered
coarsely, aberdeen, battle_of_britain, berlin, stalingrad, omaha_beach,
liberation_of_caen and market_garden are all the same picture: a clean ring of
7 around clean non-7 ground.

What the level's own data adds is that the pocket is the playable area. Across
all 23 extracted vanilla levels, **0 of 749 soldier spawns, 0 of 115 control
points and 0 of 724 object spawns stand on material 7** — the only two "on 7"
object spawns are battle_of_britain rows whose position is literally `0,0,0`.
Straight lines between neighbouring control points are 0 % material 7 on 19 of
the 23; the four exceptions are single pairs whose straight line leaves the
pocket and comes back (berlin 30 m, stalingrad 59 m, caen 9 m, aberdeen 174 m),
which is not a route a player walks in the real game either, and at 5 HP/s
after a 10 s grace only aberdeen's is long enough to cost a man on foot
anything.

So material 7 is a **second, painted, non-rectangular combat boundary** — the
map edge, painted rather than declared. It is worth modelling because it is
**tighter than the rectangle**: Berlin's pocket is a fifth of its 512 m box,
Market Garden declares the whole map, and aberdeen, kharkov and kursk paint 7
while declaring no rectangle at all. A viewer that models the rectangle alone
lets a player walk hundreds of metres past the edge of the level.

### Wired

`viewer/collision.js` already samples each level's `terrain/materials.png` —
`map.html`'s `surfaceFriction(x, z)` reads it per wheel — so `stepCombatArea`
now reads the same lookup at the same position the rectangle is tested at, and
`combat-area.js` compares it. A level that paints no 7 is bit-identical to
before; a level with no `terrain/materials.png` feeds `null`, which can never
match. `active` now means "either half could fire", because three of the twelve
levels with `combatArea: null` paint 7; the old meaning is `hasRect`.

**Measured on the page.** On Berlin the man spawns on material 4 (Dry dirt)
with `onDamagingMaterial` false. Told that 4 is the damaging material, the same
frame reports `inside: false`, `inRect: true`, and he bleeds
`dt × 5 HP/s` — 0.0833 HP a frame — from 30 down. Switching the painted half
off makes the same ground safe again.

---

## 4. The push: a blast throws a soldier (KNOCK-4..KNOCK-9, 2026-10-06)

Desert Combat parity round, package `soldier-blast` (census item S7). Until
this the page's blasts priced a soldier and nothing else; only a replay played
the explosion states, because only a recording names them. Desert Combat raises
its soldiers' `explosionForceMod` from 75 to 150, so the gap was most visible
there, but it was every mod's.

### What the engine does

`handleExplosionOnObject` pushes every victim it prices above zero (ledger
KNOCK-4, KNOCK-5) and stamps a soldier for the flight (KNOCK-1):

| Term | Value | Row |
|---|---|---|
| size | `explosionForceMod * forceOnExplosion / radius * exposure`, x0.1 in water, x friendly fire's cut, held under `explosionForceMax` | KNOCK-4 |
| falloff with distance | none, but no push at all past `d/r = 0.5` | KNOCK-5, KNOCK-9 |
| direction | normalise(separation, its rise replaced by `(1 - d/r) * 5`, plus his nearest axis) | KNOCK-5 |
| speed it leaves | `F / 30` m/s (one 1/30 s tick in the accumulator), mass-independent | KNOCK-6 |
| soldier words | vanilla, XPack1, XPack2: 75 / 600; Desert Combat: 150 / 600; template defaults 1 / 300 | KNOCK-7 |
| round word | `forceOnExplosion`, a projectile's alone, default 150; vanilla's grenades never set theirs | KNOCK-7 |
| landing | a bot: the survive landing (1 s) and the get-up (2 s); a human: straight to `Lb_Stand`; dead: `LandFront` / `LandBack`, held | KNOCK-2, KNOCK-8 |

So "a Desert Combat soldier is thrown twice as far" is true only under the
600 ceiling. A grenade (radius 15, force 150) 5 m off leaves a standing man
(exposure at most 0.5, HP-10) at 12.5 m/s in vanilla and at 20 m/s in DC,
where the ceiling already holds; a crouched man (exposure up to 1) at 20 m/s in
both. Twice the push shows where the blast is weak: a quarter-seen man, a round
with a small `forceOnExplosion` (DC's RPG and SMAW write 20), or a wide radius.

### What the page does

- `vehicle-hits.js` `throwSoldier`, from the splash pass, for every soldier it
  priced (the human on foot, the bots on foot): `knockback.js`
  `soldierBlastAcceleration` with the round's `splashForce` (`damage.json`'s
  projectile row, then the baked block, then 150), his template's
  `explosionForceMod` / `explosionForceMax` (`gaits.json` `soldierBody`,
  `soldier-death.js` `soldierTemplateValue` by his side's template; vanilla's
  75 / 600 where the manifest predates them), the splash's own distance and
  exposure, `calcDamage`'s ratio (`applySplash` now returns `raw`) and his
  body's water. The body gets its `Knockback` on that first push, as it gets
  its `swim`.
- `walking-body.js` `SoldierBody.blast` banks `a / 30` m/s and hands it to the
  next body tick's accumulator as `dv / dt`, the jump's arrangement, so the
  60 Hz body leaves at the engine's speed; it sets `sliding`, so a man shoved
  along the ground bleeds the speed off at PHY-2's kinetic budget. At the
  bottom of each tick `Knockback.update` runs the throw (KNOCK-1), the landing
  off the tick's most upward contact (KNOCK-2, KNOCK-8) and the clip clocks
  (period `1 / rate`, ANIM-1). Every explosion state's legs declare
  `setSpeed 0 0 0`, so while one holds them he has no command (PHY-8).
- `world-soldier-tick.js` steps a dead man's body with `dead` set from his
  Armor (a bot's input never says so), which is what lets the blast that kills
  him throw him by the dead arm.
- Drawn: `foot-body.js` plays the human's states, and as his corpse the dead
  flight and the landing; `bot-visuals.js` holds a live bot in them through
  `heldPairOf`, and a dead one's corpse follows his body (`followThrow`) until
  his respawn resets the machine.
- The landing is the ordinary fall (HP-14, `world-soldier-tick.js`): on flat
  dirt a 12.3 m/s landing costs nothing and a 19.4 m/s one 1.3 HP.

### How it was checked

`tests/test_knockback.py` (17, over `tests/knockback_harness.mjs`):

| Case | Result |
|---|---|
| a quarter-seen man, grenade 5 m behind: vanilla / DC | 187.5 / 375 force, 6.25 / 12.5 m/s, same line |
| fully seen | 600 both (the ceiling), 20 m/s |
| past half the radius; in water; friendly fire off / half | 0; a tenth; 0 / half |
| a real `Soldier` on flat ground, the quarter-seen push | vanilla: shoved, 0.93 m up, down 2.3 m away, never thrown; DC: thrown forward, 3.78 m up, 1.43 s in the air, lands 9.2 m away |
| the same as a bot | `flyForward`, `landFrontSurvive` 1.0 s, `getUpFront` 2.0 s, his own legs |
| dead | `flyForward`, then `landFront` held |
| holding W in the air; a respawn; a wall face first, back first, a slope; after 0.2 s; under a canopy | no steer; reset; `bounceFront` then `flyBackward`, flies on, flies on; not thrown; not thrown |
| the page's splash pass, `forceOnExplosion 30`, vanilla vs DC `soldierBody` | 5.0 / 10.0 m/s for the human and the bot; the bot marked a bot; a manifest without the words is vanilla's; an undeclared round 150 |

The data: `bf42/con.py` reads the three words (the projectile's only on a
projectile, `tests/test_con.py`); `extract_map.py` `projectile_materials` puts
a declared `forceOnExplosion` in `damage.json`'s projectile table;
`extract_pose.py` writes the soldier's words into `soldierBody`, the tree's
first soldier at the top level and each template under `templates`
(`tests/test_die_assets.py`). Extracted into scratch for vanilla and Desert
Combat: `soldierBody` gains `explosionForceMod` 75 / 150 and
`explosionForceMax` 600 for all 8 and 9 soldier templates, the capsules,
the corpse time and the template name are unchanged, and `die.gait.glb` comes
out byte-identical to the published one.

### The soldier template's other words (census item S8)

The same `soldierBody` carries the medic bag's and the wrench's words
(`healDistance`, `healFactor`, `selfHealFactor`, `repairDistance`,
`repairFactor`; supply-depots.md section 6). `kit-loadout.js` `healingPack`
used to hard-code vanilla's 10 / 0.25 / 0.15 and 2 / 0.15; it now reads the
holder's soldier template, keeping those numbers only where the manifest
predates the words. Every soldier of the four trees surveyed shares its mod's
`CommonSoldierData.inc`, so vanilla, XPack1 and XPack2 read exactly what was
hard-coded and Desert Combat's wrench heals 0.20 a round (2.0 HP/s at 10
rounds/s) instead of 0.15. Checked by `tests/test_kit_level_js.py` (an old
manifest, vanilla's, Desert Combat's, a template's own row) and
`tests/test_die_assets.py`.

---

## Where the code lives

| file | what |
|---|---|
| `viewer/soldier-exposure.js` | the three tables, the divisors, the LOS callback, `worldBlocker` |
| `viewer/contact-response.js` | `materialProperty`, `contactPair`, `applyContact`, `FuseRoundBody`, `CONTACT_MATERIALS` |
| `viewer/combat-area.js` | `isDamagingMaterial`, `materialToGiveDamage`, `step(dt, x, z, material)` |
| `viewer/vehicle-damage.js` | `applySplash` takes `armor`-carrying targets and an `exposure` callback |
| `viewer/gunfire.js` | `#stepFuseRound` runs the contact solver instead of freezing the round |
| `bf42/damage.py` | `Material.elasticity` / `.resistance`, `materialElasticity` / `materialResistance` |
| `viewer/map.html` | `combatMaterial`, `soldierExposureFor`, soldier splash targets, `__soldiers` |
| `viewer/knockback.js` | `soldierBlastAcceleration` (the push), `Knockback` (the flight and the landing), the constants |
| `viewer/walking-body.js` | `SoldierBody.blast`, the banked speed, `knockback` stepped each tick, `locked` |
| `viewer/vehicle-hits.js` | `throwSoldier`, called from the splash pass |
| `viewer/foot-body.js`, `viewer/bot-visuals.js` | the human's and the bots' explosion states; `followThrow` for a thrown corpse |
| `viewer/world-soldier-tick.js` | a dead man's body knows it is dead |
| `bf42/con.py`, `extract_map.py`, `extract_pose.py` | the three words; `damage.json` `forceOnExplosion`; `soldierBody` |

Tests: `tests/test_soldier_exposure.py` (9), `tests/test_contact_response.py`
(12), `tests/test_combat_area.py` (+7), `tests/test_vehicle_damage.py` (+6),
`tests/test_damage.py` (+1); for section 4 `tests/test_knockback.py` (17),
`tests/test_con.py` (+1), `tests/test_die_assets.py` (+1).

---

## Open

* **The contact material wants an extractor word.** `CONTACT_MATERIALS` is four
  rows of `.sm` collision-vertex materials read by hand, because the projectile
  spec carries `material` and `material2` but not the collision material. A mod
  fuse round falls back to its `ObjectTemplate.material`, which is right for the
  grenades and wrong for anything shaped like the explosives pack.
* **The engine pitches and rolls a mesh projectile up to 10° toward the contact
  normal** (collision-response.md §6.4 — it is how a bomb lies down). Not
  modelled; a resting grenade keeps the attitude it landed with.
* **Sleeping is not the engine's.** `REST_MOVE` (2 mm a tick with a latched
  contact) stands in for the `|acc|²` thresholds of §4.3. A speed test cannot
  be used, because `addFriction` cancels *next* tick's gravity in advance and a
  body held on a 45° slope therefore carries a standing 0.36 m/s while sitting
  within a tenth of a millimetre of the same spot.
* **A blast below the terrain reads as unoccluded.** `WorldCollider.#terrain`
  only detects a crossing from above (`if (!(oy − height > 0)) return -1`), so a
  sample point above ground and a blast under it come back clear. No real blast
  is under the terrain, and the object cast is unaffected.
* **The decorative spawn figures do not fall over.** They get an Armor and are
  hidden when it empties; there is no death animation to play.
* **`Projectile::handleCollision`'s return value gates the whole response** and
  a fuse round returns true on everything but an un-flagged water contact. The
  viewer runs the contact unconditionally; the water case (a grenade in the
  sea, which should pass straight through) is not reproduced.
