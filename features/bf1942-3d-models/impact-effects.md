# Impact effects: the game's own bursts, holes and trails

Closes the "play" half of gap **M-1**, gap **M-3** (decals), and the trail half
of the projectile picture from
[`projectile-collision.md`](projectile-collision.md), for the Thompson and the
Bazooka first. Before this a hit was *named* — `RichoStoneDecal`,
`BazookaCascadesStone` — and a tinted disc marked it. Now the named bundle
plays: the ricochet burst, the dirt or grit, the bullet hole that stays and
fades, the rocket's smoke line and the explosion.

Engine reading, with every address:
[`../bf1942-engine-reference/subsystems/projectiles-and-impacts.md`](../bf1942-engine-reference/subsystems/projectiles-and-impacts.md);
ledger rows IMP-1..7, CRD-1, EMT-1..5.

Code: [`bf42/effects.py`](../../tools/bf1942-models/bf42/effects.py) (spec),
[`extract_effects.py`](../../tools/bf1942-models/extract_effects.py) (bake),
[`viewer/effects-core.js`](../../tools/bf1942-models/viewer/effects-core.js)
(arithmetic, no three.js), [`viewer/effects.js`](../../tools/bf1942-models/viewer/effects.js)
(player), hooks in `gunfire.js` and `map.html`. Tests: `tests/test_effects.py`
(+ `effects_harness.mjs`).

---

## What the game does, in one paragraph each

**The hit picks a bundle.** `MaterialManager.setEffectTemplate` per (attacker
material, defender material); the attacker is the *projectile's* `material`
(216 for every SMG round, 226 for the bazooka), the defender the struck face's
byte or the terrain id. A Thompson round into the Wake bunker (material 93,
reinforced concrete) is `RichoStoneDecal`; onto sand `e_richoGround`; into
water `e_RichoWater`. The bazooka gets `BazookaCascadesStone` — the explosion
plus concrete debris.

**The bundle stands on the normal.** `Game::playCollisionEffect` writes the
surface normal into the new object's Up axis and derives the other two from
world +Z. Everything in the bundle is authored in that frame: "up" is off the
surface, "right"/"dof" lie in it.

**Emitters spawn on a clock.** Each emitter names one payload and spawns it
every `|1/intensity|` seconds for `timeToLive` seconds after `delay`, from an
offset in the frame with an initial speed in the frame, optionally adding the
emitter's own velocity. Every number is a CRD random variable, resampled per
spawn.

**The bullet hole is a mesh particle.** `Fx_RichoStoneDecal`: a 0.2 m quad
(`Decal_Stone_m1.sm`), placed 1 mm off the surface, alive 1–15 s (uniform),
alpha held for 70% of that life then ramped to zero — and cut off at 50% by the
mesh's own `alphaTestRef 0.5`, which is why an in-game hole vanishes rather
than fades out. Dark because its shader says `materialDiffuse 0.388`.

**The rocket's trail is a bundle riding the round.** `e_rocketFume`: smoke
at 100 puffs/s for 7 s, each puff born at the rocket's 50 m/s and dragged
(`drag 20`) to a halt within a tenth of a second, growing 0.5 → 0.9 m over
2.5 s; and a motor flame that burns for exactly one second. The rocket itself
falls at 0.2 g (`gravityModifier 0.2`) and detonates on contact.

**Damage decays over distance.** `Projectile::getDamage`: full `materialDamage`
out to `distToStartLoseDamage`, linear to `minDamage` × full at
`distToMinDamage`, flat beyond. Thompson: 5 → 2.5 between 40 and 80 m.

**A round has two explosions, and only one of them is on contact.** Added
2026-09-20, ledger **HP-9d**. `damageType` alone does not say which a round
gets:

```
impact explosion, at the collision:   damageType == 1 && hasCollisionEffect
end-of-life explosion, on the fuse:   damageType == 1 || damageType == 4
```

`hasCollisionEffect` is the **impact-versus-fuse discriminator**, not a
"can this round splash" flag, and the difference is the whole grenade. Exactly
three vanilla `damageType 1` projectiles omit it — `ExpPackProjectile`,
`GrenadeAlliesProjectile`, `GrenadeAxisProjectile` — and `LandmineProjectile`
is `damageType 4`; those four are the game's fuse weapons, and requiring the
flag for splash generally (an earlier recommendation, refuted against the
binary) would have deleted every point of damage they deal. `damageType 4`
never takes the impact path even with the flag set. Surveyed over every
installed mod's `objects*.rfa`: 3,161 `damageType 1` templates, 2,935 with the
flag, 46 `damageType 4`.

Do **not** read the last sentence as "so a flak shell bursts on its fuse rather
than on the aircraft it grazes". Whether a round survives the contact to reach
its fuse is a third question with a third answer — see
[Surviving the contact](#surviving-the-contact-the-third-question-2026-09-20)
below. Vanilla's three flak shells set `hasCollisionEffect`, and on contact the
engine deletes them without either explosion.

**The blast measures to the victim's origin.** `t = clamp((radius − d)/radius,
0, 1)` times `materialDamage(material2)` times `damageMod(material2,
victim.material)`, with a strict `radius > d` cutoff — the distance to the
victim's **transform origin**, not a bounding box and not the nearest surface,
with only the **Y** term scaled (by `YModOnExplosion`, default 1.0, authored
2.0 on 629 of the 642 declarations surveyed and every one of them a bomb).
There is **no occlusion at all** for a victim that is not a soldier. For a
soldier the engine multiplies in an exposure term from `checkForHitOnSoldier`
and short-circuits on 0; the viewer has no per-limb volumes to sample, so it
passes 1 and names the gap rather than hiding it.

**The radius is an integer.** `ProjectileTemplate.radius` is a console `int`,
truncated toward zero at parse, so a fractional radius below 1 is **no splash
at all** — DC's `50calSniper_Projectile radius 0.25` becomes 0, and the strict
`radius > d` gate then reaches nothing. 384 templates across the installed mods
author a fractional radius. When the `.con` omits `radius` entirely the
constructor's own 10.0 applies, which six vanilla tank rounds rely on.

## What was built

- `con.py` now keeps every raw property on EffectBundle / Emitter / Particle
  templates (`effect_props`) and parses the projectile's damage falloff,
  `radius`, `material2` and `endEffectTemplate`. `crd4()` reads a CRD as
  `[dist, a, b, mirror]`.
- `bf42/effects.py` turns those into the viewer's spec (emitter + particle
  dictionaries; nested bundles keep their placement).
- `extract_effects.py` bakes every bundle the material table can name, plus
  projectile trails and end effects, into **`_shared/effects.glb`**: 59
  bundles, 300 emitters, 497 KB for vanilla. The ten it cannot bake are
  sound-only collision bundles and one undefined name.
- `effects-core.js` is the engine's arithmetic — CRD sampling, the frame from
  the normal, the emitter clock, spawn placement, gravity/drag integration,
  size/colour/alpha evaluation, damage falloff — with no imports, so
  `tests/effects_harness.mjs` runs it under node (17 tests).
- `effects.js` plays a bundle: sprites billboarded with their ramps, mesh
  particles oriented by the frame and faded through opacity under the
  authored alpha test, pooled, 1200 particles and 128 decals at most (the
  engine's own decal ring is 127). Bundles can attach to a moving object.
- `gunfire.js` plays the resolved bundle at every hit, hangs the trail
  bundle on a shell that declares one, plays `endEffectTemplate` on a
  `timeToLive` expiry, and stamps `damage` / `damageFactor` and the exact
  distance to the surface on the hit record.
- `map.html` loads the library beside `damage.json`, lights mesh particles
  through `bindDynamicShading` (the engine's MODULATE2X combine), advances
  the player each frame, and exposes `__effects()` and `__teleport()` for
  headless checks. `?effects=off` leaves it out.

## Measured

Wake, on foot, `?shots`, frames stepped with `__renderOnce`:

| | |
|---|---|
| Thompson, 7 rounds at 4.0 m into the supply bunker's west wall (material 93) | 7 hits, all `RichoStoneDecal`, all played; 7 decals live 1 s later, each at 1.0 mm off the wall (x 1337.805 vs face 1337.804), unoccluded, 0.2 m, `alphaTest 0.5`, base colour 0.388 |
| rendered hole vs wall (16×16 px means, 1600×1000 render) | holes 52–72, lit wall beside them 124–150 |
| damage on the record | 5 at 4 m (factor 1); the 40→80 m line is in the JS test |
| Bazooka, one round from 36 m | trail run alive in flight (32 particles at 0.3 s); hit at 36.0 m on material 93, `BazookaCascadesStone` played, damage 10; explosion cloud still drifting 1.2 s later |
| library | 59 bundles, 300 emitters loaded; 0 dropped spawns in every run |

## The two-path rule on the page (2026-09-20)

Aberdeen, re-extracted by the same worktree that made the change, served on
5332 and driven with Playwright. `models/damage.json` is the arithmetic's own
source, so the closed forms below are checkable without the page.

| what | measured |
|---|---|
| **A tank shell's splash hurts a nearby vehicle on impact.** A Priest's round struck a static object at `[921.6, 93.3, -865.7]`: record `blast: "impact"`, `splashMaterial2 201`, `splashRadius 15`, `splashYMod 1`, direct damage 0 (the thing it hit has no Armor) | the **M10 7.86 m away, never touched by the round, fell 100 → 76.18 HP**. Closed form `materialDamage(201) 10 × damageMod(201→50) 5.0 × (1 − 7.86/15) = 23.81` against 23.82 measured |
| **A grenade does nothing where it lands.** `GrenadeAxisProjectile`, `damageType 1`, `hasCollisionEffect 0`, thrown at a Sherman from 8.5 m | it met the ground at age **0.25 s** and rested there. Over the **130 frames** between landing and the fuse, the tank's HP did not move by one hundredth and **no impact record was ever created** |
| **…and everything when its fuse ends.** `timeToLive CRD_NONE/3/0/0` | at 3 s a single record appeared, `kind: "endOfLife"`, `blast: "endOfLife"`, `splashMaterial2 205`, `splashRadius 15`, **direct damage `null`** — splash and nothing else. The Sherman fell 100 → 84.06 HP in that same frame. Closed form `10 × 2.0 × (1 − 3.03/15) = 15.95` against 15.94 measured |

The gun in the first row is a Priest's and not a Sherman's, and that is a
finding rather than a convenience: **`damageMod(206, 50)` has no cell in
vanilla's tables**, and by DMG-1 an unlisted pair means no damage — so a
Sherman's or PanzerIV's HE round does nothing at all to a tank's armour.
Artillery material 201 carries 5.0 against armour, material 205 (the grenades)
2.0, material 204 (the explosives pack) 3.5, and the landmine's 232 carries
**100.0**, which is what makes an anti-tank mine an anti-tank mine.

### What the 206/207 rows actually say (corrected 2026-09-20)

The paragraph above said a tank's HE round "splashes soldiers only". It does
not. Reading the real tables — `extract_models.load_damage_tables` over
vanilla's `Game.rfa`, through `attGroup`/`defGroup` rather than raw ids —
gives 206 and 207 the same eleven def-groups and no others:

| att | `materialDamage` | cells |
|---|---|---|
| **206** | 10.0 | `0: 0, 1: 0, 40/41/42: 8.0, 43/44: 2.0, 60/61/62: 15.0, 73: 3.5` |
| **207** | 4.0 | `0: 0, 1: 0, 40/41/42: 8.0, 43/44: 0.7, 60/61/62: 5.0, 73: 4.5` |

Neither has a cell for **any** of def-groups 45–59 or 72 — which is every
ground vehicle, gun, artillery piece, ship and PT boat in vanilla (Sherman,
Tiger, PanzerIV, T34, M10, Chi-ha and the Defgun are material **50**; Priest,
Wespe, Willy, Kubelwagen, Hanomag, Flak38 and the AA guns are **45**; Yamato is
**55**; the PT boat is **72**). So against armour on the ground the claim
holds.

But 60/61/62 is what every vanilla **aircraft** carries — B17, Corsair, Zero
and Spitfire are all material 60 — and it is the largest cell in both rows.
A Sherman, PanzerIV, T34-85 or Chi-ha shell bursting at a parked plane's origin
is `10 × 15.0 = 150 HP` before falloff, more than any of them has. "Splashes
soldiers only" is wrong, and so is lumping the six tank guns together: **206**
is Sherman, PanzerIV, T34-85 and Chi-ha; **207** is Tiger, T34 and the M10, at
0.4× the base damage.

The `attGroup`/`defGroup` indirection changes nothing here, and that is worth
recording once: in vanilla exactly two materials are not their own group —
**120 → 119** and **166 → 165** — and neither is a splash attacker or any kind
of armour.

## Sound: the other half of a bundle (2026-09-20)

An effect bundle in this engine is a picture **and** a sound, and until this
round the viewer played only the picture. It now plays both. Full survey,
byte cost and the playback rules are in
[`map-sounds.md`](map-sounds.md#2026-09-20-an-effect-that-plays-also-sounds);
what belongs here is what it means for the impact table.

| | |
|---|---|
| impact bundles in `damage.json`'s effects matrix | **73**, of which **70** carry an `ObjectTemplate.loadSoundScript` |
| …whose script is on a **nested child**, not the named bundle | **22** — `RichoStoneDecal` defers to the `e_richoStone` it wraps |
| …whose tree carries **two** scripts, neither on the parent | **10** across the whole named set — `MajorImpact_Sand` is `e_Explani02` (the blast) + `e_ExplDrySand` (the rain of sand) |
| distinct `.ssc` behind those 70 | **38** |
| the three with no script anywhere in their tree | `e_ExplWater01`, `e_RichoPHeavy`, `e_richoPHeavy` |

The nesting is the finding. `bf42.effects.bundle_sound_scripts` walks the
`addTemplate` tree depth-first and resolves each path against the **owner's**
own `.con`; reading only the named template's `sound_script` finds 48 of the
70 and silences every ricochet-that-leaves-a-decal, every cascade and both
water explosions. The composites are exactly the bundles the material table
names most often — and a composite can be composite twice over: the six
`*Cascades*` bundles, the three `MajorImpact_*` and `WaterExplosionTorpedo`
each hang two sounding children off one parent, and the engine, which
instantiates both, plays both. Stopping at the first was a blast with its
debris rain missing (corrected 2026-09-20).

The thirteen bundles `extract_effects.py` reports as **missing** are not all
missing. Nine of them are pure-sound bundles that bake no geometry because
they have none: `e_collision_Soldier` (a round hitting a man — 2 patches,
12 alternates), the four `e_Collision_Granade_*` (a grenade bouncing off
concrete, metal, sand or wood), the two `e_Collision_Debrie_*` (falling
rubble landing), `e_Collision_ship` (two hulls grinding) and
`e_waterBoatSink`. The bake's "missing" list should be read as "no geometry",
not "not found".

Two shipped authoring bugs, both left as they are rather than guessed at:
`e_RichoGrass` binds `Sounds/richoSand.ssc` and ships `Richograss.ssc`;
`e_waterBoatSinkSmall` binds `Sounds/e_waterBoatSinkef.ssc` and the file is
in a **sibling** directory (`e_waterBoatSinkEf/Sounds/`). Both resolve to
nothing, in this reader and — **UNVERIFIED** — presumably in the engine, which
would make `e_RichoGrass` (22 references in the damage tables) silent in the
real game too. A third, `e_ExplWindow`, resolves its script and finds no
sample: every `load` in it is inside a `/* */` block, which by SSC-1..SSC-5 is
a skipped region, so it is correctly silent.

## Still missing

- **A soldier's exposure.** `splashDamage` takes the term and every caller
  passes 1, so a man in cover takes full splash here where the engine would
  give him some or all of it back. It needs per-limb soldier volumes and a ray
  budget to sample them, neither of which exists.
- **Nothing splashes a soldier at all yet.** `applySplash` walks registered
  *vehicles*; the on-foot player is not among them, so a grenade at his own
  feet costs him nothing.
- **A fuse round rests where it lands instead of bouncing.** The engine's
  grenade is a rigid body (`setHasCollisionPhysics 1`,
  `setHasResponsePhysics 1`) and genuinely bounces; the contact solver that
  would bounce it belongs to the collision round (COL-2..COL-12). Rather than
  invent a restitution coefficient the round stops on the surface it met and
  runs its fuse down there — the damage rule is exact, the trajectory after
  first contact is not.

  **What a player sees.** A grenade thrown at a wall drops straight down that
  wall instead of kicking off it; one thrown at a slope sticks where it lands
  rather than rolling to the bottom; one thrown hard at flat ground stops dead
  on the spot instead of skipping on a metre or two. The blast is then exactly
  right, at a place that is a little short of where the game would have put it
  — for a 15 m radius, a bounce the game would carry two or three metres moves
  the falloff by 13 to 20 percent for someone at the edge of it, and not at all
  for someone near the centre. Measured on the page (wake, port 5342): flat
  ground rest at age 0.13 s, a rising bank at 0.78 s, water at 0.53 s, every
  one of them detonating once at age 3.000 s at the resting point.

  `dieAfterColl` is **no longer** the unread word this list called it —
  see the section below. It is read, it is now extracted, and it is what
  decides whether a round is entitled to rest at all.
- **The end-of-life blast is not reached from the tracer path.** A round only
  detonates on its fuse if it flies as a projectile (`kind` `shell`/`rocket`
  with a baked body). A `damageType 4` round whose body did not bake would fly
  as a tracer and expire silently. No vanilla case does, but a mod's could.
- **`SpriteParticleNew`** payloads (a handful of newer effects) are treated
  as plain sprites; their extra properties are ignored.
- **Debris does not rest.** The cascade bundles' concrete chunks fall through
  the ground after 3–5 s instead of landing; particles have no collision.
- **Emitter `lodDistance`** is applied at play time from the camera; the
  engine re-evaluates it per frame.
- The emitter clock's t = 0 first spawn is inferred from data, not read
  (ledger EMT-2).

## Surviving the contact: the third question (2026-09-20)

`splashSpec` answers two questions — does this round get an impact explosion,
does it get an end-of-life one. There is a third, and it is answered somewhere
else entirely: **does the round still exist after it touches something.**

`Projectile::handleCollision` (lnxded `0x0831ee80`) is the whole of it. After
handing the contact up to `SimpleObject::handleCollision` (`0x081ef01`, which
is the chain that reaches `handleCollisionForProjectile` and the impact
explosion), it asks:

```
831ef4b:  cmp BYTE PTR [ecx+0x1a7],0x0   ; dieAfterColl        -> jne kill
831ef52:  jne 831ef5d
831ef54:  cmp BYTE PTR [ecx+0x1a4],0x0   ; hasCollisionEffect  -> jne kill
831ef5b:  je  831ef6d                    ; neither: the round lives on
831ef5d:  cmp BYTE PTR [esi+0x10d],0x0   ; already detonated?
831ef67:  je  831f006                    ; no -> resetProjectile
...
831f006:  push esi
831f009:  call 831e720 <Projectile::resetProjectile>
```

`resetProjectile` (`0x0831e720`) sets the round's detonate latch
`Projectile+0x10d` and despawns it. It **never calls `startEndEffect`** — so a
round killed this way explodes neither way, and a later `detonate()` finds the
latch set and returns immediately.

`dieAfterColl` is `ProjectileTemplate+0x1a7`, a console bool: `ConsoleClass385`
at instance `0x087a4fc0`, name string `0x086d50f6`, accessor `0x082de400`.
Three neighbours in the same chain, named here so the next reader does not
have to re-derive them: **`dieAtObjectHit`** `+0x1a8` (tested `0x0831ef3c`,
only when the struck thing is an object), **`isSticky`** `+0x1ab` (tested
`0x0831ef16` — it attaches the round to what it struck and disables its
physics, which is a real bounce-free rest the engine itself does), and
**`detonateOnWaterCollision`** `+0x1ac` (tested `0x0831f3ae`: without it
`handleCollision` returns immediately on a water contact). No vanilla
projectile sets any of the three.

### Why this matters: the three flak shells

Vanilla has four `damageType 4` templates, not one:

| template | `hasCollisionEffect` | `dieAfterColl` | radius | material2 | `timeToLive` |
|---|---|---|---|---|---|
| `LandmineProjectile` | 0 | 0 | 4 | 232 | `CRD_NONE/360` |
| `AA_Allies_Projectile` | **1** | **1** | 20 | 199 | `CRD_UNIFORM/0.8/1.4` |
| `Carrier_AA_Projectile` | **1** | **1** | 20 | 199 | `CRD_UNIFORM/0.8/1.4` |
| `Flak38_Projectile` | **1** | – | 20 | 199 | `CRD_UNIFORM/0.8/1.2` |

On `splashSpec` alone all four look identical: end-of-life blast, no impact
blast. The flag on the three flak rounds looks dead, because `damageType 4`
never consults it for the explosion. It is not dead — it is consulted at
`0x0831ef54`, and it is what makes a flak shell that touches an aircraft, the
ground or a wall **vanish**: direct hit, collision effect (played earlier, at
`0x08153e5b`, before the explosion gate), gone. Which is exactly what a timed
airburst should do.

Measured on the page, an `AA_Allies` on wake with the barrel laid on terrain
5.04 m in front of the muzzle:

| | record |
|---|---|
| reading the flag as dead | `kind: "endOfLife"`, `blast: "endOfLife"`, `e_FlakBig`, `splashRadius 20` — the shell rested **on the terrain it hit** (`resting: true` on the first frame after contact) and burst there |
| reading it (now) | one `kind: "terrain"` record, `blast: null`, `splashRadius: null`, effect `e_richoPHeavy`, `damage 0`, and the round is gone |

So the rule the viewer needs is three-termed, and `isFuseRound` in
`effects-core.js` is it: an end-of-life blast, **no** impact blast, **and**
`diesOnContact` false. Only the four fuse weapons pass all three.

### The fuse is the authored one, not the viewer's ceiling

`gunfire.js` holds a round to 20 s (`FLIGHT_TTL_CEILING`), a recycling guard
for something still flying. That was harmless while `timeToLive` only recycled
a mesh. It is not harmless now the fuse fires a blast: `ExpPackProjectile`
authors 240 s and `LandmineProjectile` 360 s, and clamping them detonates 12 m
and 4 m of real splash under the player twenty seconds after he puts the charge
down. The engine's clock is `Projectile::handleUpdate` (`0x0831e940`) calling
`detonate` (`0x0831e680`) at the authored fuse; the other way one goes off is
the Detonator, `FireArms::detonateProjectiles` (`0x08287f80`), which is not
modelled. `roundTimeToLive` keeps the ceiling for a flying round and gives a
fuse round its own number — a rested round has stopped sweeping, so the
ceiling's reason does not apply to it.

### The impact blast is not centred on the hit point

`handleCollisionForProjectile` explodes at `hitPos + 0.1 * normal`: the 0.1f is
loaded at `0x08153f5e` from `ds:0x086b1ca0` (`cdcccc3d`), multiplied into all
three components of the normal at `0x08153f6b`–`0x08153f73`, added to the hit
position at `0x08153f82`–`0x08153f8f` and pushed as the blast centre at
`0x08154026`/`0x08154030`/`0x08154037`. The same shape appears in the
function's other two collision blocks (`0x0815434e`, `0x081546f2`).

Two things it is not. It is **not** where the collision effect goes — that is
played at `0x08153e5b`, before any of this, on the raw hit point; the record
carries the hit point as `point` and the blast centre as `splashPoint`. And it
is **not** applied at end of life: `startEndEffect` stands on the projectile's
own `getPos()` with no offset (`0x0831f747`), so a fuse round's record has no
`splashPoint` and `applySplash` falls back to `point`.

It is worth about 1% of the falloff on a 10–30 m radius, and it always points
*away* from whatever was struck, so the victim it shades is the one that took
the direct hit.

## The radius really is truncated at parse (settled 2026-09-20)

The open question was whether a fractional `radius` is truncated or **rejected**
— if the console treated the leftover `.5` as a parse error and skipped the
property, 340 mod templates would be riding the 10.0 constructor default
instead of getting 0, which is a completely different answer.

It is truncated, and nothing can reject it. `ConsoleClass390::setArgFromString`
(`0x082df7b0`) builds a `basic_stringbuf` over the argument, calls
`std::istream::operator>>(int&)` (`0x082df83f`) into a function-local static
int at `0x087debbc`, stores `this+0x20 = &that int`, and **returns void having
never read the stream state** — no `fail()`, no `rdstate()`, no branch on the
result anywhere in the function. `ConsoleObjectBaseImpl::execute`
(`0x08359460`) is the only caller: it loops the arguments calling
`setArgFromString` through vtable `+0x54`, ignores it (it returns void), and
then unconditionally calls `executeObjectMethod` through `+0x4c`.
`ConsoleClass390::executeObjectMethod` (`0x082df8b0`) dereferences `this+0x20`,
`fild`s it and `fstp`s it into `ProjectileTemplate+0x190`
(`0x082df8ef`/`0x082df8f5`).

`>> int` consumes the `0` of `0.25`, stops at the `.`, sets no failbit, and 0 is
what gets written. So `radius 0.25` is **0** — no splash at all, given the
strict `radius > d` gate — and not the 10.0 default. `radius 7.5` is 7.
(A genuinely non-numeric radius would leave the function-static at its previous
value and write *that*, which is a fine piece of trivia and something no
template does.)

## HP-15 on the page, and where the 0.2 stops being 0.2 (2026-09-20)

wake, port 5342, Playwright, frames batched inside one `page.evaluate` so the
tab's own rAF loop cannot advance the sim between round trips.

**The wreck.** An `AA_Allies` killed with `__damageVehicle`: `__inputGate()`
reads `blocked: true`, `rotationalScale: 0`, `turretInputScale: 0`; 60 frames
of a held 40 px/frame traverse and a held trigger swept **0.000°** and fired
**0 rounds** — HP-13's `0x15` strips `IID_IWeapon` off a destroyed object, and
the trigger is gated on the same answer.

**The aircraft.** A Corsair, every input zeroed first, then 40 frames of held
W + ArrowRight + Space:

| state | blocked | `c_PIThrottle` | `c_PIRoll` | `c_PIFire` |
|---|---|---|---|---|
| healthy | false | 0.667 | 1 | 1 |
| critical | false | 0.667 | 1 | 1 |
| **destroyed** | **true** | **0** | **0** | **0** |

`PlayerControlObject::handlePlayerInput`'s early return (`0x08318920`, epilogue
`0x08318952`) is per PlayerControlObject; nothing in it knows whether the
object has wheels or wings. `frame()` forks to `pilot()` or `drive()` on which
drivetrain the root carries, so the rule has to be on both sides of that fork.

**Repair lifts the traverse penalty, a heal does not lift the wreck.** The AA
gun at 100 → 8 HP → +50 → 100: `rotationalScale` 1 → 0.2 → 1 → 1. A destroyed
hull healed to full stays `destroyed: true` and stays blocked, which is
correct — HP-15's two bytes clear only when the wreck-respawn timer expires
(six conditions inside `SimpleObject::handleUpdate` `0x081db2e0` ending in
`setHitPoints(getMaxHitPoints())`), and the viewer's equivalent is the pad
respawn, unit-tested in `test_the_gate_lifts_when_the_wreck_respawns`.

### The measurement the seam turns on

The same 12-frame traverse on the same AA gun, healthy against critical, at a
range of hand speeds:

| px/frame | healthy | critical | ratio |
|---|---|---|---|
| 4 | 6.0504° | 1.2101° | **0.2000** |
| 10 | 15.1261° | 3.0252° | **0.2000** |
| 20 | 30.2522° | 6.0504° | **0.2000** |
| 40 | 60.5043° | 12.1009° | **0.2000** |
| 120 | 63.3333° | 36.3026° | 0.5732 |
| 400 | 63.3333° | 63.3333° | **1.0000** |

The penalty is exact up to the point where the *healthy* axis saturates its own
`maxSpeed * TURRET_SPEED_SCALE` cap, and then decays to nothing. At 400 px in a
frame — an ordinary hard flick — a burning vehicle traverses exactly as fast as
a healthy one.

The cause is placement, not arithmetic. `TurretRig.inputScale` is spent in
`aim()`, on the raw pointer delta, and `TurretAxis.step` then clamps
`pending / dt` to the cap; once the healthy side is clamped, scaling the input
underneath it is invisible. On main's displacement-accumulating servo this is
still the better of the two available placements — scaling the *rate* after the
clamp would leave the total travel unchanged and merely arrive later, because
the axis consumes its whole `pending` bank either way — so it is a limitation
of the servo, not a bug to fix in place.

It is, however, a positive reason to prefer the shape wave-2 stream C is
building. That servo turns the pointer delta into a normalised `unit =
clamp(asked / cap, -1, 1)` and then applies `inputScale` to `unit`, which is
where the engine applies it too: `RotationalBundle::handlePlayerInput`
(`0x081d834f`) multiplies the three **decoded** input axes by the double at
`ds:0x86c8678`, not the raw mouse counts. Under that servo the ratio is 0.2 at
every hand speed, and this table would read 0.2000 all the way down.
