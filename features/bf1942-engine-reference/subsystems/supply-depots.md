# Supply depots: one class behind ammo boxes, medical lockers and repair pads

Settled 2026-09-16 for the map viewer's `supply.js`/`armor.js`. All addresses
`bf1942_lnxded.static` (`nm -C`/`objdump`) unless marked client — a
`SupplyDepot` has no renderer-side work, so the dedicated server's named code
is the primary reading. Ammo boxes, medical lockers, land and airplane repair
pads, and the mobile depots riding the Hanomag/Ho-Ha/M3A1/carriers are all one
engine class, `SupplyDepot`/`SupplyDepotTemplate` — and at least one mod
(Forgotten Hope) reuses the same class as a scripted-trap area-damage source,
which matters for anyone tempted to assume every instance heals.

## 1. The template: twelve vectors, not seven

`SupplyDepotTemplate`'s two constructors (`0x08324fa0`/`0x08325190`) lay out
twelve parallel vectors, not the seven a first read of `addAmmoType`/
`addVehicleType`'s argument lists suggests (SUP-1). Six fields per
`ammoType` row (id, two duplicate amount fields, rate, `1/rate`, and a
regen-rate read from `+0x144`), mirrored for `vehicleType` from `+0x1a0`.
The "two duplicate amount fields" are not actually duplicates: one is the
live budget, the other is a **cap/regen ceiling that is a real runtime
clamp**, confirmed for both `ammoType` (`+0x15c`) and `vehicleType`
(`+0x1b8`) — see §4. Defaults: `radius=2.0f` (`+0x138`), `team=0` (`+0x13c`),
`workOnVehicles=0`/`workOnSoldiers=1` (`+0x140`/`+0x141`, both bytes);
`+0x198` is left uninitialized by the constructor.

**The ammo id is not the client's `AmmoType` enum (SUP-2).** `addAmmoType`'s
int argument (`0x08325380`) is not `setHudAmmoType`'s enum
([ingame-hud.md](ingame-hud.md) HUD-10, VHUD-3) — it matches an unnamed tag
read back by `FireArms::getAmmoType()` (`0x0828d4c0`), and no registered
setter for that tag was found. So a depot's `ammoType` id is an opaque
per-weapon-family key, not a HUD enum value; do not try to render a depot's
ammo type through the HUD's own `AmmoType` art.

**`addVehicleType`'s name resolves once, at construction (SUP-3).** A
`SupplyDepot`'s constructor (`0x08322cf0`) looks the vehicle type name up
through `objectTemplateManager` (`0x0871dc28`, vtable `+0x1c` =
`getTemplate(std::string const&) const`, `0x081d5f10`) and stores the
resulting numeric template id via that template's own `getId()`
(`0x0816af60`) — both confirmed by a static vtable dump. An unresolved name
becomes `0xFFFFFFFF` silently, with no warning logged anywhere in this path.

## 2. Self-throttled, not driven by its own arguments

`SupplyDepot::handleUpdate(float dt, unsigned)` (`0x083240f0`) **ignores
both of its parameters** (SUP-4). Instead it compares
`dice::ref2::WorldPref::mWorldTime` (`0x087435a0`) against a per-instance
timestamp at `+0x154`, re-evaluating only once that difference clears a
threshold at `+0x1e8` (default 0.5 s — no console word in any installed mod
overrides it). `+0x154` is seeded to `(rand() % 30) / 30.0` at both
construction and `reset()`, phase-randomising which depots re-evaluate on
which real-world tick — and, only inside the constructor, that
randomisation is itself gated behind an always-true-on-a-dedicated-server
`dice::bf::game->queryInterface(IID_IGameServer)` check
(`0x0870d918`/`0x086b1cf8`).

**Depots never look at other depots (SUP-6).** A full read of `update`,
`workOnSoldiers`, `workOnVehicles`, `reloadAmmo`, `healSoldier` and
`repairVehicle` finds zero references to the global depot map
(`ObjectManager::getSupplyDepotMap`, `0x081a3440`) or any other cross-depot
state. Two depots with overlapping radii simply both fire — depots stack,
there is no priority or exclusion rule to reproduce.

## 3. Eligibility is one rule, reused everywhere

The give/heal/repair action and the three `show*IconInMenu` menu predicates
all gate on the identical rule (SUP-5): alive with a body, not the depot's
own root parent, `team == <the depot instance's own cached team> OR that
value == 0`, inclusive 3-D distance `≤ radius`. Team is read from the
**instance**'s own `+0x108`, not the template — confirmed directly inside
`showRepairIconInMenu` (`0x083245d0`).

**Team convention (SUP-16):** across every installed mod,
`AlliedAirplaneSupplyDepot` is always `team=2` and `AxisAirplaneSupplyDepot`
is always `team=1`. Combined with the exact-match-or-zero rule above:
**0 = both teams/neutral, 1 = Axis, 2 = Allied.** The Axis↔1/Allied↔2
mapping itself is convention read off the data, not a labelled engine
constant — nowhere does the binary print "Axis" or "Allied" next to a 1 or
2.

## 4. The ammo leaky bucket

Ammo is not simply "add N, cap at max." `update()` (`0x08324150`, fully
instruction-traced) runs a per-type leaky bucket (SUP-7): a countdown
decrements by real `dt` each evaluation; once it goes negative, the whole
units due are `trunc(-countdown × rate[i])`, and the countdown then tops
back up by `units / rate[i]`. Independently, the reserve regenerates
`+= dt × regenRate[i]` (unless pinned at the sentinel `-1.0`, meaning
unlimited) and is clamped at the authored cap — the second of the two
"amount" fields from §1.

**The actual reload interaction is deeper than "give N magazines"
(SUP-8).** `SupplyDepot::reloadAmmo(IPlayerObject*)` (`0x08323770`) computes
`reserve[i] -= (wholeUnits[i] − FireArms::reloadAmmo's return value)` — the
return value is genuinely consumed, not discarded. `FireArms::reloadAmmo`
itself (`0x0828cfd0`) has real per-magazine behaviour: magazine 0 (the
active one) is excluded from the top-up, overflow cascades into the next
magazine, and there is a concrete path that returns zero. The reserve
genuinely depletes in real play; the exact per-magazine fill formula was
traced further than before but not fully closed out — open.

**Refill-sound triggering is two unrelated mechanisms (SUP-9).**
`FireArms::checkIfToTriggerRefillSound()` (`0x0828fb40`) and its
`HandFireArms` override (`0x08294480`) both gate on "current ammo increased
since last check," but only the override resolves a `BFPlayer` and, if
`dice::bf::game->queryInterface(IID_IGameServer)` succeeds, broadcasts
through that interface's vtable `+0x2d4`. `BFSoldier::triggerRefillAmmoSound()`
(`0x0827ebc0`) is a third, unrelated path with no `IGameServer` reference at
all — it requires an emitter (`+0xf8`) and a per-weapon handle (`+0x4f8`)
both non-null, with no fallback, dispatched through the handle's own vtable
`+0xc`.

## 5. Healing and repairing

`healSoldier(IPlayerObject*)` (`0x083239d0`), unlimited case
(`this+0x130 == -1`, an exact equality test): every call heals or damages
by precisely `-(this+0x14c)` — the per-cycle `dt × rate` — dispatched
through a generic vtable `+0xd8` **on the target player**, not the depot
(SUP-10). A finite shared per-cycle budget path exists (`this+0x130`
consulted and decremented) but is moot in shipped content: no vanilla or
mod template this round found uses a finite positive heal budget.

**Sign selects heal vs. damage identically for soldiers and vehicles
(SUP-11).** Vanilla mediclocker-style templates author a positive rate
(healing). Forgotten Hope's `AlliesKiller<n>m`/`AxisKiller<n>m` traps invert
it: `setHealth -1 -4.0 0`, team-gated `workOnSoldiers 1 workOnVehicles 1` —
continuous damage through the exact same code path a heal uses, just with a
negative rate. Each carries roughly 224–227 `addVehicleType <vehicle> -1
-10 0` lines. Similar unremarked kill-traps exist in DC_Final/DesertCombat
(`flagboxKill`, `IS_Kill`, `USS_Kill`) and Forgotten Hope
(`PushCageKillInside`, `PushCage2KillInside`).

**Two distinct capability queries, not transient state (SUP-12, SUP-13).**
`isHealing()` (`0x08324540`) is a strict `rate > 0.0` test — narrower than
the coarser "heal enabled this cycle" transient flag at `+0x152` (which
fires on any nonzero rate, either sign). `isRepairing()`/`isReloading()`
(`0x08324570`/`0x083245a0`) report *static template capability* —
`count(vehicleTypes) != 0` / `count(ammoTypes) != 0`, computed fresh both in
the constructor and in `reset()` — not whether the depot is currently doing
anything.

**Vehicle repair/rearm has no per-type pacing timer (SUP-14).** Grepping
`repairVehicle`/`workOnVehicles` for any countdown vector: zero hits.
`repairVehicle` (`0x08323ba0`) applies its rate directly, every call, when
the reserve is the unlimited sentinel — which is almost every shipped
template, but not universally: FHSW's `LST-1_MovableRampKiller`/
`LST-1_StaticRampKiller` (`a2=-100000`, single-shot ramp traps) and
`R-11FM_Rocket_Selfrepair`/`Selfkiller` (`a2=50`/`25`) genuinely reach the
finite-reserve clamp branch. Do not assume every `addVehicleType` reserve is
`-1` once a mod's content is in play.

## 6. What is not consumed, and what was not re-examined

`healDistance`, `healFactor`, `selfHealFactor`, `repairDistance` and
`repairFactor` (`Objects/Soldiers/Common/CommonSoldierData.inc`) are real,
registered console properties — but **no consuming method exists anywhere
in `SupplyDepot` or `SupplyDepotTemplate`** (SUP-15), confirmed both by
reading every core `SupplyDepot` function and by an exhaustive `nm`
symbol-table search for all five names. Whatever consumes them — most
likely self-heal or a repair-tool item, a different subsystem entirely — is
unfound.

The client-side draw path that lights an ammo/heal/repair icon in the 3-D
world (as opposed to the menu-prompt eligibility test of §3) was not
located this round (SUP-17) — it needs client-binary work, not more time on
the server copy.

## Open

- **SUP-8**: `FireArms::reloadAmmo`'s exact per-magazine fill formula.
- **SUP-10**: the finite shared heal-budget clamp's exact arithmetic (moot
  in shipped content, but present in the code).
- **SUP-17**: the client HUD draw path for the in-world ammo/heal/repair
  icon.
- From the R3 verifier, not yet promoted to a row: whether
  `workOnSoldiers()`'s player-collection walk is the same container type as
  `workOnVehicles()`'s PCO map (it shows no `_M_increment` call, unlike the
  PCO map, which does) — worth a dedicated pass once
  `PlayerManager::getPlayers()`'s return type is known; and a full
  mod-by-mod audit for `addVehicleType` rows with `a2 != -1` or `a4 != 0`
  beyond the five found here.
