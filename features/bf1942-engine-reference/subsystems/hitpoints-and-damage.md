# Hit points and damage: Armor, and how it dies

Settled 2026-09-16 for the map viewer's `armor.js` and the soldier's HUD
health bar ([ingame-hud.md](ingame-hud.md) HUD-9). All addresses
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

## 3. Collision recording is not fall damage

`SimpleObject::handleCollision` (`0x081dab40`, HP-6) walks the composite
chain for the nearest Armor and calls its `collision()` (vtable `+0xe8`) and
`setLastCollisionHeight` (vtable `+0xf8`) on physical contact — but a gate
at `0x81dae30` (`call [otherObject_vtable+0x90]`) can bypass the whole block,
and was not traced past that call. Critically: **no fall-damage formula
exists anywhere `handleCollision`, Armor's own code, or `handleDamage`
reach.** Whatever converts a hard landing into HP loss — if it exists at all
as a general rule rather than per-vehicle scripting — is somewhere else
entirely; do not assume this function is where it would be.

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

**Vehicle and gun explosion falloff (HP-9):** a hard cutoff at the
configured `explosionRadius`, combined with a material-pair multiplier from
`MaterialManager::getDamageMod` (`0x08175040`) feeding `calcDamage`
(`0x0814b520`). The cutoff, the multiply, and the overall dispatch are
confirmed twice now (independently, by two passes); the exact within-radius
falloff shape is not — it may be linear, it may not be, and nobody has
walked `handleExplosionOnObject`'s own arithmetic far enough to say.

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

## 7. Status messages the client is told about

`Armor::status()`'s non-death branches send one of three message ids to the
player through `IPlayerObject`'s vtable `+0x9c` (HP-13, all three call
sites address-confirmed inside `0x081739e0`): `0x14` on reviving into
critical, `0x13` on recovering out of critical, `0x15` on newly entering
critical from a safe state. What a client HUD actually does on receipt of
each id was not read — this is a server-side finding about *when* a signal
fires, not what it looks like.

## Open

- **HP-6**: the fall-damage formula itself — still unfound anywhere Armor,
  `SimpleObject`, or `handleDamage` reach. Leads worth trying next:
  `ResponsePhysics::addFriction` (`0825b6e0`) and `PhysicsNode::updatePhysics`
  (`082543d0`) — see [physics.md](physics.md).
- **HP-6**: `handleCollision`'s pre-gate at `0x81dae30` — whether it
  routinely skips the collision-recording block, not traced past
  `0x81daf32`.
- **HP-8**: how a dying object avoids re-damaging its own wreck, given that
  its on-death explosion passes `sourceArmor = NULL` and so bypasses the
  pointer-identity self-exclusion that would otherwise apply. Candidate:
  `handleExplosion`'s own spatial-query step filters the source object
  before per-target processing even starts, using a `sourceObj` parameter
  not examined this round.
- **HP-9**: the exact within-radius falloff shape for vehicle/gun splash —
  `[ebp+0x1c]` vs `[ebp+0x20]`'s roles inside `handleExplosion`'s forwarding
  call, not yet re-derived by anyone.
- **HP-4**: the console property case-insensitive compare routine, not
  isolated.
- [supply-depots.md](supply-depots.md) SUP-15: `healDistance`/`healFactor`/
  `selfHealFactor`/`repairDistance`/`repairFactor`'s consumer is not this
  subsystem's code either — still nowhere.
