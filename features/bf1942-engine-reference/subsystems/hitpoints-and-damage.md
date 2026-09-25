# Hit points and damage: Armor, and how it dies

Settled 2026-09-16 for the map viewer's `armor.js` and the soldier's HUD
health bar ([ingame-hud.md](ingame-hud.md) HUD-9); extended 2026-09-17 with
what makes a vehicle burn (§8); §3 (what a collision costs) was rewritten
2026-09-19. All addresses
`bf1942_lnxded.static` unless marked client. Every Armor-bearing thing —
soldier, vehicle, stationary gun — shares one component and one death rule:
death is a threshold crossing evaluated inside the mutator that causes it,
not a per-frame poll of a "is dead" flag. Armor's vtable (`0x0871d220`) was
read in full, 82 slots, and every `call [reg+N]` cited below is checked
against that dump rather than slot arithmetic guessed from a decompile.

## 1. The component: clamps, ceilings, and one hard-coded field

`setHitPoints` (`0x081726c0`) snaps the value to exactly `0.0` once it drops
below an epsilon of `0.0010000000474974513`; `setMaxHitPoints`
(`0x08173680`) ceilings at `128.0` and never touches the current
`hitPoints`; `setHitPoints` itself can raise `maxHitPoints` but never lowers
it; `heal` clamps its result to the current max; `damage` has no upper
reference at all (HP-1). Both `damage` and `heal` (`0x08172730`/
`0x081727a0`) are gated by `dice::bf::game->queryInterface(IID_IGameServer)`
and by `isDestroyed`, unless `canBeRepairedAndDestroyed` (`+0x12a`) is set —
except that `damage()` ignores that override flag entirely: a destroyed
object can still be told to take more damage even when it is flagged
repairable.

**Death is decided inside `Armor::status(float)` (`0x081739e0`), called by
all three mutators before they commit (HP-2).** At `pendingHP ≤ 0.001` it
sets both `isDestroyed` and `isCriticalDamaged`, resolves `lastHitPlayer`
(`+0x14`) to a live `BFPlayer*` (`0x0871dc2c` vtable `+0x18` →
`dice::bf::getBFPlayer`, `0x08052ac0`), and — only when the dying template
is **not** `CID_BFSoldierTemplate` — calls
`BFPlayer::addVehicleDestroyed(unsigned)` (`0x08054770`) on the killer. It
then fires the dying object's own on-death explosion if `explosionDamage >
0.001` (§4).

**Spawn-time construction is a fixed 23-call sequence, not a distinct
template class (HP-3).** `SimpleObjectTemplate::setArmorComponent`
(`0x081ddae0`) copies exactly 23 setter calls, in a fixed order, into a
freshly pooled `Armor` (pool `0x0871d210`, 464 bytes/instance;
`setMaxHitPoints` always runs strictly before `setHitPoints`). **`material`
is not among the copied fields** — an Armor's material is always the
constructor's hardcoded `0` (`0x08172280`, `+0x40 = 0`), regardless of
whatever per-template `material` value a `.con` file specifies. Anything
that reads an Armor's material for damage routing is reading a constant,
not authored data.

**Console property names are case-insensitive in practice (HP-4).**
Vanilla ships both `hitPoints`/`maxHitPoints` (camelCase) and
`Stationary_Browning`'s `HasArmor`/`HitPoints`/`MaxHitPoints`
(PascalCase) in the same archive as `Sherman`/`Defgun`'s lowercase, and both
work — a `working` finding, since the exact compare routine
(approximately `0x081b2ce0`) was not isolated.

## 2. Update cadence: most of it is per-second, none of it is per-tick

`Armor::update(float dt)` (`0x08172f40`, HP-5) recomputes water contact
every call, but critical-damage and upside-down loss are gated behind a
`+=dt` accumulator (`+0xe8`) that only fires once it reaches 1.0 s — and
that path is **skipped entirely for soldiers**. Water and deep-water damage
use their own independent countdowns (`+0xe4`/`+0x13c` live,
`+0xec`/`+0x140` configured): the first application honours the configured
delay, and every application after that is a flat 1.0 s apart. The HP loss
itself (`hpLostWhileCriticalDamage`, `hpLostWhileUpSideDown`,
`hpLostWhileDamageFromWater`, `hpLostWhileDamageFromDeepWater`) is a flat
amount per firing, **not scaled by `dt`** — a longer frame does not lose
more HP per water tick, it just checks in less often.

## 3. A collision costs hit points

Settled 2026-09-19; full narrative, formulas and the material data in
[collision-response.md](collision-response.md) §9. This section has been wrong
twice, and the history is worth a paragraph because both errors were the same
error.

On 2026-09-17 HP-6 was closed in the negative - "a collision never costs hit
points" - after a researcher and a verifier both found no Armor `damage`/`heal`
call in either collision handler and took `Game::playCollisionEffect` for the
severity number's only consumer. On 2026-09-18 that was refuted for a falling
soldier: the handlers also make a `*0x15c` virtual call. But that pass
identified the receiver as the colliding object and the slot as
`BFSoldier::handleDamage`, and so kept the claim alive for vehicles.

**The receiver is the GameServer.** At `0x08155875`-`0x081558d6`
(`handleCollisionObjectVsObject`) the code loads `this` (`0x8(%ebp)`), takes its
vtable and calls `*0x15c`; slot `+0x15c` of GameServer's vtable (`0x0871b0e0`,
vptr = symbol + 8) is `GameServer::giveDamage(IObject*, float, int, int, int,
Pos3, int, bool, bool)` `0x0814b2e0`, which damages whatever object it is
handed. Whatever sits at `+0x15c` of a BFSoldier sub-vtable is beside the
point: the call is not made on the soldier. Re-derived independently from
`objdump` (V0).

What is true, in short:

- `SimpleObject::handleCollision` `0x081dab40` finds the struck object's nearest
  Armor and, unless that Armor's 1-second collision list already holds the other
  object (`isInColList` `+0x12c`, `addColObject` `+0x120`), dispatches
  `game->handleCollision(other, self, ...)` - the other object is the attacker.
- Object vs object: `damage = attackerArmor.damageMod x (angleMod + (1 -
  angleMod) sin(|cos| pi/2)) x speedMod x |v|^2 x getDamageMod(matAttacker,
  matVictim) x getDamageForMaterial(matAttacker)`, applied when `> 1.0`.
  `speedMod` and `angleMod` are the victim's. Vehicles included.
- Terrain (`other == NULL`): `cos^3 x speedMod x |v|^2 x getDamageMod(matTerrain,
  matSelf) x getDamageForMaterial(matTerrain)`, applied when `> 1.0`; water uses
  `cos^2`, needs `damageFromWater`, and has no threshold. Vehicles included: a
  plane that flies into a hill takes this.
- A soldier victim subtracts 8 m/s first and multiplies by a fall-height term
  and the kit damping, squared - the formula the fall-damage groundwork was
  reaching for, with its branch polarities now settled.
- Material 99 on the other side is an instant kill (1e10 damage); material 37 on
  either side suppresses the damage dispatch.

What the earlier pass had right stands: neither handler calls Armor `+0x20` or
`+0x24` directly, `playCollisionEffect` is a harmless leaf, terrain and water
arrive through the same dispatcher with `otherObject = NULL`
(`GameServer::handleCollision` `0x08156020`), and `Spring::handleCollision`
`0x0824f9b0` forwards to the base, so a wheel's contact takes the same path.

## 4. `handleDamage`: find-nearest-Armor, then dispatch by sign

`SimpleObject::handleDamage(float amt)` (`0x081db230`, HP-7) is **not** a
parent-escalation dispatcher, correcting an earlier reading. It walks the
composite chain — self, then `+0x50` repeatedly — for the nearest ancestor
that exposes an Armor component (`getComponent(0xc4a4, 0xc4a4)`), and
dispatches purely on the sign of `amt` against the literal `0.0`: `amt >
0.0` calls that Armor's `damage(amt)` (vtable `+0x20`); `amt ≤ 0.0` calls
the **same** Armor's `heal(-amt)` (vtable `+0x24`) — the negation is a bit
flip on the sign of the float parameter itself, not a read of some
"collision flags" byte as a previous pass assumed. There is no per-body-part
or per-material scaling anywhere in this function.

## 5. Splash damage: vehicles get a radius, soldiers get sampled rays

`GameServer::handleExplosion` (`0x08156ef0`) sweeps a spatial index and
calls `handleExplosionOnObject` (`0x08156500`) per candidate target, always
using the **exploding/dying object's own** `explosion*` fields (HP-8) — a
dying Sherman splashes with its own `radius 8, damage 5`, not the target's.
Self-exclusion is by Armor-pointer identity, but an object's own on-death
explosion (fired from `status()`) passes `sourceArmor = NULL` into that
call, so this specific exclusion mechanism is inert on exactly the path
that most needs it — how a dying Sherman avoids re-damaging its own wreck is
unresolved.

**Vehicle and gun explosion falloff (HP-9) — closed 2026-09-19. It is
linear.** `handleExplosionOnObject` computes

```
d = sqrt(dx^2 + (YModOnExplosion*dy)^2 + dz^2)      // to the victim's getPos() ORIGIN
if (!(radius > d)) return 0;                        // strict, 0x08156655
t = clamp((radius - d) * A, 0, 1)                   // A = 1/radius, from the caller
damage = t * explosionDamage
       * getDamageMod(explosionMaterial, victim.material)
       * exposure                                   // 1.0 unless the victim is a soldier
       -> calcDamage(...)                           // friendly fire only
```

and `GameServer::handleExplosion` computes `A = 1.0f / radius` once
(`0x08156f5c`, the 1.0f at `0x086ba8d4`) and passes it at **both** call sites,
so `t = 1 − d/radius` exactly and both clamps are dead given the strict gate.
The Mod Development Toolkit's linear formula, which our code already shipped,
is the engine's.

Three things about that which are easy to get wrong. The distance is to the
victim's **transform origin**, not to a bounding box or the nearest surface
point, and **only the Y term is scaled**, by `YModOnExplosion` (a projectile's
own; a vehicle's on-death explosion pushes a hard 1.0). There is **no occlusion
at all** for anything that is not a soldier — `edi` is seeded `1.0f` at function
entry and nothing on the non-soldier path touches it. And a soldier gets
**both**: HP-10's line-of-sight exposure *multiplies* the distance falloff
(`fmulp` at `0x081566b4`), with an exposure of exactly 0.0 short-circuiting to
no damage. HP-10's "not distance falloff" is true of the exposure term alone.

**The force path is separate, and reads the victim's Armor.**
`getExplosionForceMod` (vtable `+0xb4`, `0x081742c0`) is read at `0x081569cb`
and clamped to `getExplosionForceMax` (vtable `+0xbc`, `0x081742f0`). Below a
separation of 0.001 the impulse direction is the **terrain normal** at the
explosion point rather than the separation vector, and a soldier's impulse is
additionally scaled by `0.1` and by `finalDamage/rawDamage`.

`handleExplosionOnObject` does not apply the damage: it appends
`{objectId, damage, …, Pos3}` to six parallel double-buffered vectors on the
GameServer (HP-9b) and returns a bool that only gates a shot-accuracy stat. Who
drains that queue is unread. `calcDamage` (`0x0814b520`) is **friendly-fire
scaling only** — no material, no distance (HP-9c).

**The impact explosion is centred at `hitPos + 0.1 · normal`** (HP-9, added
2026-09-19), not at the hit point: `0.1f` at `ds:0x086b1ca0` loaded
`0x08153f5e`, multiplied into the normal `0x08153f6b`–`0x08153f73`, added
`0x08153f82`–`0x08153f8f`, pushed `0x08154026`/`0x08154030`/`0x08154037`, with
the same shape at `0x0815434e` and `0x081546f2`. The collision **effect** is
played earlier, at `0x08153e5b`, on the raw unoffset point, and the end-of-life
explosion has no offset at all (`startEndEffect` pushes `getPos()` at
`0x0831f747`). Worth about 1% of the falloff — free to model, and read rather
than guessed.

**What explodes, and when (HP-9d).** `damageType == 1` **and**
`ObjectTemplate.hasCollisionEffect` gives the explosion on impact;
`damageType ∈ {1,4}` gives the explosion at end of life, through
`Projectile::startEndEffect` (`0x0831f590`), which tests neither
`hasCollisionEffect` nor the impact path's radius truncation and passes
`sourceArmor = NULL`.

### The contact recycle: which rounds ever reach their fuse (HP-9e, HP-9f)

Read 2026-09-20, and it changes which projectiles are fuse weapons at all.

`Projectile::handleCollision` (`0x0831ee80`) **recycles a round when
`dieAfterColl` OR `hasCollisionEffect` is set** — `dieAfterColl` is
`ProjectileTemplate+0x1a7` (bool, `ConsoleClass385`, instance `0x087a4fc0`,
accessor `0x082de400`), tested at `0x0831ef4b`, and `hasCollisionEffect`
(`+0x1a4`) at `0x0831ef54`. The kill branch `0x0831ef5d` → `0x0831f006` calls
`resetProjectile` (`0x0831e720`), which sets the detonate latch
`Projectile+0x10d` (`0x0831e753`) and despawns **without** calling
`startEndEffect`. So such a round explodes **neither way**, and a later
`detonate()` returns on the latch.

`Projectile::detonate` (`0x0831e680`) is the **only** caller of
`startEndEffect`, and its five call sites — `handleUpdate` (timeToLive),
`handleMessage`, `FireArms::detonateProjectiles`,
`FireArms::placeScoutCamera`, `ProjectileNetworkable::setNetUpdate` — are all
timers or messages. **None is a collision path.**

`SimpleObject::handleCollision` runs first (`0x081ef01`), so the direct hit and
any impact explosion still land before the recycle.

**Only a round with neither word survives contact to reach its fuse.** In
vanilla that is exactly `GrenadeAlliesProjectile`, `GrenadeAxisProjectile`,
`ExpPackProjectile` and `LandmineProjectile`.

`dieAfterColl` is **not** a restatement of `hasCollisionEffect`: 2,311
declarations across 18 installs (values 0 and 1 only), and **1,676 templates
carry `damageType 1` + `hasCollisionEffect 1` + `dieAfterColl 0`**, including
every vanilla bomb. Named in the same chain and not consumed: `dieAtObjectHit`
`+0x1a8` (`0x0831ef3c`), `isSticky` `+0x1ab` (`0x0831ef16`, attaches to the
struck object and disables physics) and `detonateOnWaterCollision` `+0x1ac`
(`0x0831f3ae`; without it `handleCollision` returns immediately on water) — no
vanilla projectile sets any of the three.

**Vanilla has four `damageType 4` templates, not one** (HP-9f):
`LandmineProjectile` (flag 0, `dieAfterColl 0`, radius 4, material2 232, ttl
360) plus `AA_Allies_Projectile` and `Carrier_AA_Projectile` (flag 1,
`dieAfterColl 1`) and `Flak38_Projectile` (flag 1, `dieAfterColl` unset) — the
three flak shells, all radius 20, material2 199, ttl `CRD_UNIFORM/0.8/1.4`.

A type-4 round gets no impact explosion — the gate at `0x08153e79`
(`cmp [eax+0x160],1; je`) sends anything but 1 to the no-explosion tail at
`0x08153e82` — **but the flag on the flak shells is not dead**, which a first
reading claimed. It is consulted by the recycle above and deletes the round on
contact: a flak shell that touches an aircraft, the ground or a wall takes its
direct hit, plays its collision effect and vanishes. **The flag is what makes a
timed airburst behave like one**, and a reconstruction that read it as dead
burst flak shells where they landed. **`hasCollisionEffect` is the impact-versus-fuse
discriminator, not a splash capability flag**, and treating it as one deletes
the most-used splash in the game: in vanilla, 25 of the 28 `damageType 1`
projectiles set it and the three that do not are exactly `ExpPackProjectile`,
`GrenadeAlliesProjectile` and `GrenadeAxisProjectile`, with
`LandmineProjectile` sitting at `damageType 4`. Across 16 installed mods: 3,267
`damageType 1` (3,016 with the flag) and 49 `damageType 4`.

`ProjectileTemplate.radius` is an **`int`** console property — of the six
registrations of the name `radius`, only the projectile one is typed int — so
it is parsed by `istream >> int` and a `.con` cannot give a projectile a
fractional radius at all. **And there is no rejection path** (read
2026-09-20): `ConsoleClass390::setArgFromString` (`0x082df7b0`) builds a
`basic_stringbuf` over the argument, runs `std::istream::operator>>(int&)`
(`0x082df83f`) into the function-local static at `0x087debbc`, and **returns
void having never consulted the stream state** — no `fail()`, no `rdstate()`,
no branch on the result. `ConsoleObjectBaseImpl::execute` (`0x08359460`)
ignores the return and unconditionally calls `executeObjectMethod`
(`0x082df8b0`), which `fild`s that int into `ProjectileTemplate+0x190`. `>> int`
takes the `0`, stops at the `.`, sets no failbit. `0.25` really is 0, and `7.5`
is 7, silently. 340 mod templates try: FH's `BismarckFatProjectile
17.63` becomes 17, and DC's `50calSniper_Projectile 0.25` becomes **0**, which
with the strict `radius > d` gate means that round has no splash whatever. The
impact path's own truncation code is therefore real but a no-op. Six vanilla
tank rounds set no radius at all and ride the constructor's **10.0**, so that
default is load-bearing.

### What a tank's HE round actually splashes (DMG-2, 2026-09-20)

A consequence of DMG-1 worth stating with numbers, because both halves of it
are counter-intuitive and the first reading got the second half backwards.

`damageMod(206, 50)` and `damageMod(207, 50)` have **no cell**, and neither
attacker row has a cell for **any** of def-groups **45–59 or 72** — every
vanilla ground vehicle, gun, artillery piece, ship and PT boat. So by DMG-1 a
tank's HE round does **nothing** to armour on the ground: it kills another tank
by direct hit alone. (Reproduced on a rebuilt scene: a Sherman round took
exactly its direct damage off a Priest and no splash.)

**But "it splashes soldiers only" is false.** Both rows' *largest* cell is
def-group **60/61/62**, which every vanilla aircraft carries (B17, Corsair,
Zero, Spitfire = material 60), at **15.0** for 206 and **5.0** for 207; with
`materialDamage(206) = 10` that is 150 HP at a plane's origin before falloff.

The split is also not the one a first pass gave: **206 = Sherman, PanzerIV,
T34-85, Chi-ha** and **207 = Tiger, T34, M10** (base 4.0).

Other attackers against def-group 50: artillery 201 → 5.0, bombs 202/203 → 6.0,
explosives pack 204 → 3.5, grenades 205 → 2.0, naval 208 → 6.0, and the
landmine's 232 → **100.0**. The `attGroup`/`defGroup` indirection changes
nothing here: only two vanilla materials are non-identity (120→119, 166→165),
and neither is a splash attacker or armour.

**`defaultDamageMod` is 0.0 and unreachable (DMG-1).** `getDamageMod` does fall
back to `MaterialManager+0x24` when a pair has no cell or a material id is
unknown — but both constructors write 0 there, the setter (`0x08176190`) is a
vtable slot nothing calls, and the complete registered MaterialManager console
name block contains no word for it, so no mod can set it either. **An unlisted
material pair really does mean no damage**, and a viewer that returns 0 for a
missing pair is already right. This refutes the research pass's recommendation
to return the field instead.

**Soldier explosion exposure is multi-point sampling, not distance falloff
(HP-10) — and it is a deliberately asymmetric mechanism, not a bug.**
`checkForHitOnSoldier` (`0x08156090`, sample tables at `0x0871ba00`/
`0x0871ba40`/`0x0871bac0`) and `checkIfRayHitsSoldier` (`0x0815b5e0`)
line-of-sight-test a fixed number of points on the soldier's model: **3
points prone, 9 crouching, 9 standing.** Exposure is `hits / tableSize` —
but standing's own divisor is **18, not 9**, so a fully-exposed standing
soldier can score at most **0.5**, exactly half of prone or crouch's
possible 1.0. This is the complete mechanism (one sample loop, confirmed —
there is no missing second loop to find), and the 0.5 cap is a deliberate
design choice baked into the divisor, not an open question.

### A soldier's fall, with a worked example (HP-14, 2026-09-19)

Not splash, but the same Damage-System product, and this is where the number
the fall-damage groundwork was hunting turns out to live. Inside
`handleCollisionLandOrWater` (`0x08154960`), for a `CID_BFSoldierTemplate`
victim:

```
|v| -= 8.0 ;  if (|v| < 0) return                  // 0x08155189, constant 0x086c08c0
A    = |cos(theta)|^3                              // land;  |cos|^2 in water (material 1)
F    = Armor::getLastCollisionHeight() - pos.y
X    = (F < 2) ? 1 : F - 1
Q    = max(1, X * kitDamping)
A   -> 1 linearly over 2 <= F < 3, saturated at F >= 3
A   -> 1 linearly over 10 < |v| <= 30, saturated above 30
severity = Q^2 * A * (Armor.speedMod * |v|^2) * damageMod(att, def) * materialDamage(att)
if (severity > 1.0) giveDamage(...)                // 0x08154c6b
```

Two of those lines are the corrections that matter. **The 8.0 subtraction comes
first, with an early return** — the research pass read the branch from
`0x08154d20` onward and never saw it, and its worked example was consequently
about 8× too severe. And every later use of `|v|` — the kinetic term, the 30.0
saturation, the 10/20 lerp — uses the **reduced** value. The `Q²` is real: it is
`d8 ca` then `de ca` at `0x08154dbb`/`0x08154dbd` with `Q` in `st(2)`, traced
twice by different agents.

The water path is a **duplicate of the whole function** entered at `0x08154e4f`
when the collision material is 1, differing only in a single `fmul st,st(0)`
that makes `A = |cos|²` instead of `|cos|³`. The 8.0 subtraction precedes the
split, so it applies to both.

The per-surface scalars are the ordinary MaterialManager tables our
`bf42/damage.py` already extracts. Extracted from vanilla's `Game.rfa`, for
**every** terrain material 0–15, `damageMod(ground, 40) = 0.001` and
`materialDamage(ground) = 30`, so `M1·M2 = 0.030` — water is the outlier at
`1.5e-05`, i.e. `M1·M2 = 0.00045`, making a fall into water about 67× gentler.

**Worked example.** A vanilla soldier (`HitPoints 30`, `SpeedMod 0.5`,
`Material 40`), landing flat (`|cosθ| = 1`, so `A = 1` throughout) with no kit
damping, at the engine's own `g = −14.73` so `|v| = sqrt(29.46·h)`:

| h (m) | \|v\| | \|v\| − 8 | Q | severity | applied? |
|---|---|---|---|---|---|
| 2.5 | 8.58 | 0.58 | 1.5 | 0.01 | no |
| 3 | 9.40 | 1.40 | 2 | 0.12 | no |
| 4 | 10.86 | 2.86 | 3 | **1.1** | yes, barely |
| 5 | 12.14 | 4.14 | 4 | **4.1** | yes |
| 6 | 13.30 | 5.30 | 5 | **10.5** | yes |
| 7 | 14.36 | 6.36 | 6 | **21.8** | yes |
| 7.5 | 14.87 | 6.87 | 6.5 | **29.9** | lethal |
| 10 | 17.16 | 9.16 | 9 | **102** | lethal |

So: nothing at all below about 3.5 m, first damage at about 4 m, and death at
about 7.5 m. Two things remain unverified — whether `Armor+0x28` really tracks
the apex of a fall rather than the last contact height, and which material index
the physics layer supplies as the attacker (`collision-response.md` §9.4 answers
the second for the general case: the vertex side brings the u16 on the collision
vertex, the face side the material of the face it hit).

The vehicle case, the object-versus-object twin and the full material tables are
[collision-response.md](collision-response.md) §9.3–9.5 and ledger COL-3/COL-4.

## 6. Numbers worth shipping as data

**Soldier base HP (HP-11)**, surveyed across every mod with its own
`Objects.rfa` (13 of 18 installed): 30/30 across eight vanilla-family mods
(vanilla, DC, DC_Final, FH, FHSW, FinnWars, WarFront, bf1918, bg42), 35/35
GCMOD, 125/125 bfheroes. No kit anywhere checked modifies a soldier's own
Armor, with two Easter-egg-shaped exceptions: bf1918's `brust_panzer`
backpack prop (its own separate 100/100 Armor, not the soldier's), and
bfheroes' `MikuSpawner_WithLeek`/`NoLeek` (10/10 HP spawner templates, a
reference joke, not a kit rewriting the soldier). This survey only became
possible after the extraction pipeline's `include`-dropping bug was fixed
(ledger CON-1) — before that fix, `CommonSoldierData.inc`'s `HitPoints 30`
never reached an extracted soldier at all.

**Vanilla reference values (HP-12):** Sherman 100/100 (`criticalDamage 12`,
`hpLostWhileCriticalDamage 1.5`, `hpLostWhileUpSideDown 10`,
`hpLostWhileDamageFromWater 10`, `explosionRadius 8`, `explosionDamage 5`,
`explosionForceMod 13`); Defgun 50/50 (`criticalDamage 12`);
Stationary_Browning 45/45 (no critical state at all). The vehicle HUD's
`VehicleHitPoints`/`VehicleMaxHitPoints` resolve through
`BFPlayer::getVehicleHp`/`setVehicleHp` (`0x08054720`/`0x080546d0`) straight
to the occupied vehicle's own **root-object** Armor — sentinel `-1.0`
(`0x086b05ec`) when the player is not in a vehicle at all. This is
independent confirmation of [ingame-hud.md](ingame-hud.md) VHUD-8: Armor is
not per-seat.

## 7. The three Armor status messages, and what they actually do

`Armor::status()`'s non-death branches send one of three message ids to the
player through `IPlayerObject`'s vtable `+0x9c` (HP-13, all three call sites
address-confirmed inside `0x081739e0`). **Corrected 2026-09-19 on two counts,
and they turn out to be load-bearing for driving.**

First, they are not network or HUD messages. `IPlayerObject` vtable `+0x9c` is
`BPlayerObject<IPlayerObject>::handleMessage(TemplateMessage, IPlayer*)`
(`0x081935c0`, read out of the vtable at `0x0871fa40+8+0x9c`; the IID the call
site queries, `0x086c2a60`, is `IID_IPlayerObject`), so these are
**TemplateMessages on the object's own in-process bus**, delivered on whichever
host is running `Armor::status`.

Second, `0x15` is **destruction**, not "entering critical from safe". Read with
the side effects around each call site:

| id | site | what `status()` does around it | meaning |
|---|---|---|---|
| `0x14` | `0x08173ad6` | then `+0x110 = 0`, `+0x111 = 1`, `+0x128 = 0` | revived from destroyed **into critical** |
| `0x13` | `0x08173bfd` | then `+0x110 = 0`, `+0x111 = 0` | recovered **to safe** |
| `0x15` | `0x08173d62` | reached **after** `+0x110 = 1, +0x111 = 1`, immediately before the on-death explosion | **destroyed** |

`SimpleObject::handleMessage` (`0x081db820`) receives them, each gated on
finding an Armor up the composite chain and on `Armor::isSendingMessage()`
(vtable `+0x94`):

- `0x13` → `+0xee = 0`, `+0xed = 0`.
- `0x14` → `+0xee = 1`, then falls into `+0xed = 0`.
- `0x15` → `setComponent(IID_IWeapon, NULL)` and
  `setComponent(IID_IAIObject, NULL)` — a wreck loses its weapons and its AI —
  then `+0xed = 1`, leaving `+0xee` alone.

Both bytes are seeded at construction from `SimpleObjectTemplate+0x105`, which
the console registers as **`ObjectTemplate.destroyed`** (bool, default false).
`Wing`, `FloatingBundle` and `Spring`'s own `handleMessage` write the same two
bytes, and the messages reach child bundles because
`PlayerControlObject::handleMessage` tail-calls `Bundle::handleMessage`
(`0x081a74b0`), which invokes `+0x9c` on each child.

**Closed 2026-09-25: there is no client HUD/sound/camera handler for these
ids, on either binary, because a remote client never receives them.** The
client's own `Armor::status` (`0x004bbad0`) is byte-identical to the server's
— same field offsets, same `getComponent(IID_IPlayerObject)` dispatch of
`0x13`/`0x14`/`0x15` (client vtable slot `+0x98`, one slot earlier than
lnxded's `+0x9c`, a GCC/MSVC layout difference, not a different mechanism) —
which extends ARM-4's "field-for-field port" finding to the message-send side.
Neither binary ever puts `0x13`/`0x14`/`0x15` on a network path; the only
consumer of the id is `IPlayerObject::handleMessage`, the local in-process bus.
So a remote client's view of another object's damage state comes entirely from
ordinary field replication of the *receiver's* resulting state — `+0xed`/`+0xee`
through `EngineNetworkable::updateStateMask` (HP-15) — never from the message
itself. A search of the client binary for a handler keyed on these ids (every
function checked for a `CMP`/switch on `0x13`/`0x14`/`0x15`, and independently
every function touching offsets `+0xed`/`+0xee`) found none beyond the mirrored
`Armor::status`/`SimpleObject::handleMessage` pair.

One receiver-side effect not previously recorded here: the `0x15` branch
(`0x081db9d9`–`0x081db9e7`) also calls
`SimpleObject`'s own vtable `+0x2c` — `BCompositeObject<IPlayerObject>::updateFlags`
(`0x08164570`, base vtable `0x08725028`, slot `0x08725054`) — with
`updateFlags(0, 0x200)`, clearing object flag `0x200`, gated on `Armor+0x104`
being non-zero. That is the same flag `collision-response.md` §5.2 names as the
collidability gate (`shouldCheckCollision` requires flag `0x200`): a destroyed
object can be made non-collidable, conditionally — a second writer of that bit,
partially answering that doc's own open item on how flag `0x200` relates to
`hasCollisionPhysics`. Which console property drives `Armor+0x104` is not
pinned down (the literal string `noCollisionsAsDestroyed` is not present in
`bf1942_lnxded.static`).

The player-visible "critical" smoke/fire is unrelated to these messages: it is
the independent per-tick `Armor::playEffect()` (ARM-1, confirmed identical on
the client at `0x004bc3d0`), and the death flash/sound is `status()`'s own
on-death explosion call right after `0x15` — both run unconditionally, not
gated on whether `isSendingMessage()` lets `0x15` through.

### `+0xed` and `+0xee`: persistent wreck state (HP-15)

These two bytes are what §9's ARM-6 could not see, and they are **not**
per-frame edge flags:

| state | `+0xed` | `+0xee` | effect |
|---|---|---|---|
| healthy | 0 | 0 | full control |
| critical (`0x14`) | 0 | 1 | drives, but **every rotational bundle traverses at 0.2× input** |
| destroyed (`0x15`) | 1 | unchanged | **no player input reaches any child at all**; weapons and AI stripped |

`PlayerControlObject::handlePlayerInput` returns at `0x08318927` before
forwarding anything when `+0xed` is set. `RotationalBundle::handlePlayerInput`
selects between **two near-identical duplicated blocks** (`0x081d835c`,
`0x081d8487`) that both decode the input and write `this+0x11c`; the one taken
when `+0xee` is set additionally multiplies all three axes by the double `0.2`
at `ds:0x86c8678`. So `+0xee` means *traverse at one fifth*, not *no input* —
an earlier reading had the block running only when the flag was set, with the
two readers at opposite polarity, and concluded nothing could be built on it.

They are cleared only by the **wreck-respawn timer**:
`SimpleObject::handleUpdate` (`0x081db2e0`) clears both behind six conditions —
`+0xed != 0`, `template+0x107 == 0`, `+0x100` already latched, a countdown
`[this+0xfc] -= dt` falling below zero, `template+0xd0 != 0`, and an Armor
present — and then calls `Armor::setHitPoints(Armor::getMaxHitPoints())` and
reloads the timer from `template+0xc4`. So the state lasts the whole wrecked
lifetime. `EngineNetworkable::updateStateMask` reads `+0xee`, so it is
replicated.

What a client HUD does on receipt of the three ids is still unread.

### Client: local-player death opens the deploy screen synchronously (2026-09-18)

Researched in `BF1942.exe` (sha `60c9452d...` MATCH, Ghidra bridge) to recreate
the death→respawn flow in the browser viewer. The client's kill/death message
dispatcher `FUN_004933d0` (`0x004933d0`), message `0x2a` sub-switch `+0x3`, on
`DEATH`: formats the kill banner, clears the player's alive byte at
`BFPlayer+0xa9`, and — when the dying player **is** the local player
(`[edi+0x170]`, comparison at `0x4946b2`–`0x4946c5`) — calls
**`SpawnScreenStuff::setVisible(true)`** (`FUN_006cce20`, `0x6cce20`) directly
(`0x4946c5`–`0x4946d4`): the spawn/deploy screen opens **immediately and
synchronously** on the local player's death in this vanilla build — no
client-side death-cam timer, camera dolly or delay constant precedes it. The
`game.serverDeathCameraType` setting (`0x008d2fe8`, registrar `FUN_00425690`
`0x00425690`, default table `0x008c596c`) is server-informed; its integer mode
values and any per-mode client *camera* behavior (the floating-above-corpse
death cam the user sees) were **not** decoded within budget — likely
server-orchestrated / spectator surface rather than a client-timed beat before
deploy. Viewer consequence: on `soldierArmor.destroyed` → open deploy. The
brief camera-holds-over-the-corpse the user observes is reproduced as a short
fade/hold beat before `openDeploy()`, not as a decoded client animation.

## 8. `addArmorEffect`: the smoke and fire tiers, and the tick that drives them

Settled 2026-09-17 (ARM-1, ARM-2, ARM-4). This is the mechanism behind a
burning tank, and it is authored data the extraction pipeline does not yet
parse.

`ObjectTemplate.addArmorEffect <hp> <effectTemplate> <x/y/z>` — 430 uses in
vanilla, 2,271 templates across all installed mods. A Sherman declares five:
`e_PanzDamage` at 50, `e_PanzFire` at 12, `e_ExplGas` and two scrapmetal
bundles at 0, and `WaterWaterExplosion` at -1.

`SimpleObjectTemplate::addArmorEffect` (`0x081dded0`, 89 lines) appends to
three parallel vectors on the template — `+0x98` `vector<string>` for the
effect name, `+0xa4` `vector<Vec3>` for the attach offset, `+0xb0`
`vector<int>` for the threshold — confirmed by the mangled `_M_insert_aux`
callees. It is not one of §1's 23 copied setters, which is why HP-3 never saw
it. At construction the three fold into an `std::map<int,DamageEffects*>` at
`Armor+0x148`, and `Armor::getEffect(int)` (`0x08172820`) reads it as a
nearest-threshold-below lookup (`_Rb_tree::find` plus `_M_decrement`).

**The `+0x128` byte is a death latch, not a first-run latch.** This was read
backwards once (the first pass called it "set on the first non-dead run", which
made the tier look single-shot); corrected 2026-09-17 and re-derived a third
time straight from `objdump`. `Armor::playEffect()` (`0x08172960`, 1385 bytes)
compares the applicable tier against the last-shown field at `Armor+0x50` and
rebuilds the live effect instances, and its only call site is inside
`Armor::update()` at `0x08173100` — but its own branch test is

    flds  0x38(%edx)        ; hitPoints
    flds  0x86c0308         ; 0.001
    fxch  %st(1)
    fucom %st(1)
    fnstsw %ax
    test  $0x45,%ah
    je    8172e6d

and `test $0x45,%ah` clears ZF for every x87 result except *greater*, so the
jump is taken exactly when `hp > 0.001`. That target, `0x8172e6d`–`0x8172ec7`,
is the **alive** path: `fnstcw`, `or $0x800` to force round-up, `frndint`,
`fistpl`, then a jump into the same single `getEffect` call. **It never writes
`+0x128`.** The `movb $0x1,0x128(%edx)` at `0x81729a2` sits on the fallthrough
— the death path — next to the `push $0xffffffff` that makes the call
`getEffect(-1)`.

Every literal write to `+0x128` inside Armor's range (`0x08172000`–`0x08178000`)
is accounted for: `0x8172231` and `0x8172381`, the two constructors, writing 0;
`0x81729a2`, writing 1, on death; and `0x8173aed`, writing 0, inside
`Armor::status()` immediately after `push $0x14` — the revived-into-critical
message. So `status()` clears the latch on a critical-state transition, and a
repaired vehicle resumes evaluating its tier.

**Which means the cadence is simply the tick.** A living vehicle re-checks its
smoke/fire tier at 30 Hz, takes the nearest authored threshold at or below
`ceil(hitPoints)`, and swaps the visible effect only when that tier changes.
The latch's one externally visible effect is freezing whatever was showing when
the object died. A viewer gets that for free by stopping the check at
`hitPoints <= 0.001`; it does not need to port the latch.

The client's `Armor` is a field-for-field port of the server's — same offsets,
same 82-slot vtable, no GCC RTTI header, CID `0xc4a5` instead of `0xc4a4`
(ARM-4) — and `playEffect` (`0x004bc3d0`), its latch write (`0x004bc419`),
`update` (`0x004bc650`) and `status` (`0x004bbad0`) all behave the same way. So
there is no client-only per-frame mechanism to find: there never needed to be
one.

`Armor+0x38` is current `hitPoints` — both `setHitPoints` and `getHitPoints`
touch it — which is what `playEffect` tests against §1's 0.001 epsilon before
doing anything.

**The thresholds themselves (ARM-2).** A vehicle's fire tier is authored at
exactly its own `criticalDamage`, on 10 of 10 sampled vanilla land and air
vehicles: Sherman, PanzerIV and Tiger 12, Willy 6, Hanomag 16, Wespe 12,
Spitfire, bf109 and Zero 20, B17 60. Boats do not burn at all — Elco80 and
Type38 (500/500, `criticalDamage 350`) run a sink sequence instead:
`em_LcvpDamage` at 200, `waterBoatSink` at 125, scrapmetal at 0, a `-1` water
tier. The first word is therefore a plain HP threshold, not a critical-state
flag; `criticalDamage` and the fire tier agree by authoring convention, not by
the engine tying them together.

**And vegetation (ARM-3).** No vanilla tree carries an Armor at all — 0 of 230
tree, foliage and vegetation templates declare `hasArmor` — which with §3 makes
a vanilla tree indestructible by any collision. FHSW is the exception: 76
templates under its own `objects/Vegetation/BreakableTree/` do declare one, as
do FH's `EU_pine6_M1_nosway` and DC_Final's `SniperBush_deploy`. Destructible
vegetation is a mod feature built on exactly this component.

## 9. What else in the engine reads an Armor

Settled 2026-09-17 (ARM-6, ARM-7), by mapping every `push $0xc4a4` — the
argument pair of `getComponent(0xc4a4, 0xc4a4)` — to its enclosing symbol.
145 call sites across 56 functions, swept twice at different widths.

**Nothing in the drivetrain or the turret path is among them (ARM-6).** Not
`PhysicsEngine::updatePhysics`, not `getCurrentDifferentialRPM` or
`getCurrentRatio`, not `RotationalBundle::calculateAndClipAngle`, `setState` or
`handlePlayerInput`.

> **ARM-6's conclusion is retired as false (2026-09-19).** The sweep above is
> sound and its literal finding still holds — no drivetrain or `RotationalBundle`
> function queries the Armor *component*. But the conclusion drawn from it, "a
> critically damaged vehicle drives and traverses exactly as a healthy one", is
> wrong, and so is the advice that a player's memory of a sluggish burning tank
> is not the engine. **A destroyed vehicle accepts no player input at all and a
> critically damaged one traverses at 0.2× input.** The Armor's state reaches
> the input path not as a component query but as two bytes on the object,
> `SimpleObject+0xed` and `+0xee`, written by the `0x14`/`0x15` messages of §7 —
> which a `getComponent(0xc4a4)` sweep cannot see by construction. See §7 and
> ledger HP-15.

What ends a burning vehicle on its own is still §2's once-per-second tick.

Five physics subnodes do query an Armor and look, at first glance, like where
such a rule would live — `Engine`, `Wing`, `Spring`, `Bundle` and
`FloatingBundle`, all inside `handleMessage`. They are not: in both
`Engine::handleMessage` (`0x0823e730`) and `Wing::handleMessage`
(`0x08250bf0`) the call after `getComponent` is vtable `+0x94`, which the
82-slot dump resolves to `Armor::isSendingMessage()` (`0x081741c0`). Message
plumbing, not a damage gate.

**What does read an Armor's state (ARM-7).** `isDestroyed()` (call `+0xc8`,
`0x08174300`) gates entry-point validation: `validateBFEntryPoint`
(`0x0831d5f0`, call at `0x831d68f`) and `BFfindEntryPoint` (`0x0831d770`, call
at `0x831d911`) each resolve the Armor and reject the candidate when it returns
true — you cannot spawn into or select a wrecked vehicle's entry point. That
closes [seats-and-entry-points.md](seats-and-entry-points.md)'s own open item,
which had the check's existence but not what it tested.

`PlayerControlObject::enter()` queries `isCriticalDamaged()` (call `+0xcc`,
`0x08174320`) at `0x8317095`, and on true calls
`getHpLostWhileCriticalDamage()` (call `+0xd4`, `0x08174390`) at `0x83172b9`
before rejoining the normal entry flow. What consumes that float is untraced, so
the consequence of entering a burning vehicle is open — do not build a "cannot
enter" rule on it. `exit(bool)` also resolves an Armor (`0x83180b7`) but only to
call `setLastCollisionHeight` (`+0xf8`).

## Open

- **ARM-7**: what `PlayerControlObject::enter()` does with
  `getHpLostWhileCriticalDamage()`'s return value, and an independent check of
  `[this+0x60]`'s dynamic type there. Until both are settled, the consequence
  of entering a critically damaged vehicle is unknown — the call is real, the
  effect is not established.
- **PCO-1**: `PlayerControlObject::handleFrameUpdate` (`0x08318d20`) calls
  `damageAllAttachedSoldiers` at `0x8318eae`, gated by per-frame accumulators
  `+0x19c`/`+0x17c` and a template threshold at `+0x22c`, independent of Armor.
  What that gate measures — G-force, roll angle, something else — is unread.
  It is the best remaining candidate for why a burning vehicle *feels*
  undriveable: its crew keeps taking damage and the player bails.
- ~~**HP-13**: what the client does on receipt of `0x13`/`0x14`/`0x15`.~~
  **Closed 2026-09-25 (§7):** nothing — a remote client never receives these
  ids (they never leave the process that runs `Armor::status`, confirmed
  identical on the client at `0x004bbad0`), and there is no HUD/sound/camera
  handler for them on either binary. The receiver-side effects are input
  gating (`+0xed`/`+0xee`, HP-15), weapon/AI removal, and — newly found —
  a conditional clear of collidability flag `0x200` on death. The visible
  smoke/fire and death effects are unrelated, driven by ARM-1's `playEffect()`
  and `status()`'s own explosion call.
- **HP-9b**: who drains the six-vector deferred damage queue
  `handleExplosionOnObject` appends to (`GameServer + [this+0x2b4]*12 +
  0x224/…`). Next step: find readers of `GameServer+0x224`.
- **The wreck**: what `status()` does past setting `isDestroyed` — whether the
  wreck is a configuration swap on the same object, a separately spawned
  template, or a flag-selected alternative; how long it lives; whether it stays
  collidable (`noCollisionsAsDestroyed`). The extraction pipeline's own
  `"wreck" in name` substring rule is a convention, not a traced mechanism.
- **HP-8**: how a dying object avoids re-damaging its own wreck, given that
  its on-death explosion passes `sourceArmor = NULL` and so bypasses the
  pointer-identity self-exclusion that would otherwise apply. Candidate:
  `handleExplosion`'s own spatial-query step filters the source object
  before per-target processing even starts, using a `sourceObj` parameter
  not examined this round.
- ~~**HP-9**: the exact within-radius falloff shape~~ — **closed 2026-09-19**
  (§5): it is linear, `1 − d/radius`, with `A = 1/radius` computed once in
  `handleExplosion` and passed at both call sites.
- **HP-4**: the console property case-insensitive compare routine, not
  isolated.
- ~~[supply-depots.md](supply-depots.md) SUP-15~~ — **found 2026-09-19**:
  `healDistance`/`healFactor`/`selfHealFactor`/`repairDistance`/`repairFactor`
  are `BFSoldierTemplate` properties consumed by `BFSoldier::useMedPack()` and
  `useRepairPack()`, the medic pack and the wrench. See
  [supply-depots.md](supply-depots.md) §6.
