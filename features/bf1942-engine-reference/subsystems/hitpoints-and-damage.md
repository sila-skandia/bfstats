# Hit points and damage: Armor, and how it dies

Settled 2026-09-16 for the map viewer's `armor.js` and the soldier's HUD
health bar ([ingame-hud.md](ingame-hud.md) HUD-9); extended 2026-09-17 with
what a collision does (§3 — nothing, to hit points) and what makes a vehicle
burn (§8). All addresses
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

## 3. A collision never costs hit points

Settled 2026-09-17 (HP-6, HP-6b, HP-6c, HP-6d), researched and then
independently re-derived by a verifier. This section previously said the
fall-damage formula "is somewhere else entirely". It is nowhere: **there is no
such formula, for a soldier or for a vehicle.**

`SimpleObject::handleCollision` (`0x081dab40`) walks the composite chain for
the nearest Armor, calls its `collision()` (vtable `+0xe8`) and
`setLastCollisionHeight` (vtable `+0xf8`), and then dispatches on the
`dice::bf::game` global's own vtable — `+0x30`/`+0x34` on the stored vptr —
choosing the projectile variant when `this`'s `+0x4c` class is
`CID_ProjectileTemplate` (`0x86c2b90`). The singleton is a `GameServer`, whose
vtable (`0x0871b0e0`) overrides both slots, so a physical contact lands in
`GameServer::handleCollision` (`0x08156020`). That is a 101-byte tail-call
dispatcher: `otherObject != NULL` goes to `handleCollisionObjectVsObject`
(`0x081551c0`), and `NULL` — which is how **terrain and water** arrive, written
in as `mov [ebp+0xc],0x0` — goes to `handleCollisionLandOrWater`
(`0x08154960`). There is no separate physics-only terrain path.

Both of those functions compute a real impact-severity number: the magnitude of
a velocity-like vector, the absolute cosine between it and the surface normal,
`MaterialManager` damage and effect lookups, `Armor::getSpeedMod()`, and — only
for `CID_BFSoldierTemplate` — a fall-height term, `getLastCollisionHeight()`
minus current Y, clamped against 1.0/2.0/20.0 and scaled by
`BFSoldier::getDamageDampingFromActiveKitParts()` (`0x0827ec00`).

**And then they spend all of it on `Game::playCollisionEffect`
(`0x0805de20`)** — the dust and the thud. Both functions were read in full
(673 and 1127 lines). Every direct call resolves by symbol to something that is
not an HP mutator; every indirect call-site offset was enumerated. Armor's
`damage`/`heal` slots (`+0x20`/`+0x24`) never appear at all. The three
`+0x18`/`+0x1c` sites inside ObjectVsObject resolve by data flow to the
`playerManager` singleton and to an `IPlayerControlObject` from the gate chain
— offset collisions, not Armor. Neither function tail-calls out, and
`SimpleObject::handleDamage` sits at vtable `+0xd8`, which never occurs in
either. `playCollisionEffect` itself is a 352-byte leaf with no HP mutator in
it.

So the only path that damages anything is `handleCollisionForProjectile`
(`0x08153ba0`) — a shot — through `Projectile::getDamage` and the
`MaterialManager` tables. A plane that flies into a hill loses no hit points
for the impact. What kills it afterwards is §2's once-per-second tick, once it
comes to rest upside down or in water.

**The gate at `0x81dae30` is self-collision suppression, not a type test
(HP-6b).** It walks `getRootParent(this)` for `IID_ICompositeObject`
(`0x86c2a58`) toward the nearest `IID_IPlayerControlObject` (`0x86d3c50`)
ancestor — the `vtable+0x90` call is on *that* object, not on `otherObject` —
then makes two chained comparisons: `ObjectSpawner::getHoldObjectId()`
(`0x08314a50`) against **self's** own root (`edi+0x48`), and only if that
matches, an `ICompositeObject`-identity compare against
`getRootParent(otherObject)`. Both must pass before the Armor-recording block
is bypassed. A shell does not record a collision against the gun that fired it.

**`setLastCollisionHeight` stores a raw world Y (HP-6d)**, not a fall distance:
written at `0x81dae83`–`0x81dae98` from `this->vtable[0x38]()`'s Pos3 `+0x4`,
the only such call site in the binary, and read back once, at `0x08154d37`.

Two smaller corrections from the same pass. `Spring::handleCollision`
(`0x0824f9b0`) — springs are wheels and suspension — sets two fields and
tail-forwards every argument to the base, so a wheel's contact reaches the same
dead end as anything else. `Obstacle::handleCollision` (`0x08315e10`) never
calls the base: when `otherObject`'s class **is** `CID_BFSoldierTemplate` it
returns true immediately, and when it is not, it calls its own
`vtable+0x9c(0,0)` and returns false. Neither touches an Armor.

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
`handlePlayerInput`. A critically damaged vehicle therefore drives and traverses
exactly as a healthy one; what ends it is §2's once-per-second tick. If a player
remembers a burning tank as sluggish or stiff, that is not this engine doing it.

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
- **HP-13**: what the client does on receipt of `0x13`/`0x14`/`0x15`. Still
  unread after two rounds; the client budget went to the Armor class and the
  entry gates.
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
- **HP-9**: the exact within-radius falloff shape for vehicle/gun splash —
  `[ebp+0x1c]` vs `[ebp+0x20]`'s roles inside `handleExplosion`'s forwarding
  call, not yet re-derived by anyone.
- **HP-4**: the console property case-insensitive compare routine, not
  isolated.
- [supply-depots.md](supply-depots.md) SUP-15: `healDistance`/`healFactor`/
  `selfHealFactor`/`repairDistance`/`repairFactor`'s consumer is not this
  subsystem's code either — still nowhere.
