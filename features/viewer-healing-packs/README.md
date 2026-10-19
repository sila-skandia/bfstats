# Viewer medic pack heal and the wrench's repairs

## Problem

Firing the medic bag did nothing. The MedPack is a `HandFireArms` with no
projectile, so its viewmodel glb carries an empty `fireArms` block, `guns.collect`
builds no gun group for it, and every trigger branch in `footFire` is gated on
`hw.group`. Holding the trigger played no report and healed nobody, in any kit,
on any team. The engineer's wrench was the same-shaped hole: it repaired no
vehicle and no stationary weapon.

The bots were never affected: their heals and repairs run through
`bot-referee.js` (`resolveHeal` + `applyHeal`), which never touches the gun
groups.

## Engine evidence

`BFSoldier::useMedPack()` (`lnxded` `0x082768d0`, disassembled 2026-09-25 for
this round; the class-level reading was already in
`features/bf1942-engine-reference/subsystems/supply-depots.md` §6):

- It runs from `BFSoldier::handleMessage` (`0x08277796`, message 6, Fire)
  behind the magazine's ammo test, so it runs once per round of the held
  trigger, at the weapon's `roundOfFire` (vanilla 10/s).
- The sweep is `objectManager->vtable[0x30](getPos(), healDistance, predicator)`
  (`0x08276949`), the same spatial query `handleExplosion` uses. Each
  candidate passes a soldier-template-class test (`0x0827697b`), the squared
  distance against `healDistance²` (`0x08276bd0`), an `isDestroyed` test
  (`0x08276c1a`) and a full-health one (`0x08276c45`), then heals by
  `healFactor` through the negative argument into `Armor::heal`
  (`0x08276c6f`).
- **There is no team gate in the function.** The class test selects soldiers,
  not sides. A wounded enemy soldier in reach is healed like a friend. That
  is retail behaviour, and this round keeps it.
- The holder himself is skipped inside the sweep (`0x08276962`) and healed by
  a separate branch that runs after the loop exits (`0x0827698f`), at the
  lower `selfHealFactor`.

`BFSoldier::useRepairPack()` (`0x08276100`, disassembled for the wrench in the
same pass): the same `objectManager` sweep with different gates
(`0x082764d0`). The template class test skips `BFSoldier` (`cmp 0x86c2b88`),
so the wrench never targets a man — not even the holder. It keeps placed
armour whose template the AI weapon's `strength` table rates (the class
tables at `+0x2a0`/`+0x2b4`), measures
`distanceSqr <= (target.getRadius() + repairDistance)²` to the object's
origin (`0x08276743`, `+0x2ec`), keeps the wounded and undestroyed, and after
the loop heals the closest of them by `repairFactor` (`0x08276210`), also
through `Armor::heal`. Not every vehicle in reach — the nearest one.

The amounts are registered properties (vanilla values in
`CommonSoldierData.inc`; accessors in supply-depots.md §6): the medic bag
heals `healFactor` 0.25 and `selfHealFactor` 0.15 within `healDistance` 10.0;
the wrench repairs `repairFactor` 0.15 within a hull's `getRadius() +
repairDistance` 2.0. At the packs' shared `roundOfFire` of 10/s that is 2.5
HP/s to every wounded soldier in reach, 1.5 HP/s to the holder, and 1.5 HP/s
to the one vehicle the wrench reaches. The viewer does not extract these
properties yet, so `kit-loadout.js`'s `MEDIC_PACK`/`REPAIR_PACK` freeze the
vanilla numbers, the same stand-in `FALLBACK_PRIMARIES` is.

The split between the two packs is the game's own, not ours: both weapons
declare `weaponTemplate.healing 1` in `Ai/Weapons.con`, and the `strength`
table picks the target type — the MedPack rates `Infantry` alone, the
RepairPack rates only the armour classes (`loadouts.json`'s `aiWeapons`).
The engine arrives at the same split with the template class test each
sweep applies.

## What changed

- `viewer/kit-loadout.js`: `localAiWeapon()` looks the hand weapon's AI entry
  up in `_shared/loadouts.json`; `healingPack()` returns the use parameters
  whenever a healing pack is in hand, `kind: 'medic'` when the entry's
  `strength` table rates Infantry, `kind: 'repair'` when it rates only the
  armour classes. `localWeaponSoundRadius()` shares the lookup.
- `viewer/hand-fire.js`: `useMedPack(pack)` walks `world.players`, heals
  every damaged soldier within `pack.radius` by `pack.allyHeal`, then the
  holder by `pack.selfHeal`. `useRepairPack(pack)` walks the placed armour —
  `page.damageVisuals` joined to `page.vehicleDamage`, the same pair the
  splash pass walks — and heals the closest wounded one within its bounding
  sphere plus `pack.radius`. The viewer has no `getRadius` per object, so
  the gate stands in with the node's bounding-sphere radius, memoised on the
  damage-visual entry. `footFire` grew one branch beside the detonator's,
  shared by both packs: while the trigger is held and the pack has rounds,
  it pays one round of `cool`, spends one round of ammo, starts the fire
  report (`beginHandFire`) and runs its sweep. Both packs' `.ssc` scripts
  mark the fire patch `loop` (`slot fireLoop`, `loop true` — the medic's
  Medkit loop, the wrench's ratchet), so the report follows the trigger and
  the branch hands the loop voice back on release, exactly the way the group
  path's `releaseHandFireLoop` does.
- `viewer/hand-weapon.js`: publishes `healingPack`, and the hand-fire bag
  carries `applyHeal`, `damageVisuals` and `vehicleDamage`.
- `viewer/map.html`: the referee binding now includes `applyHeal`, the same
  plumbing the bots' heals use.

The packs' ammo is their budget: `magType 1` ("healing type", per the
weapons' own `Objects.con` — the MedPack 1800, the RepairPack 3000), one
spent per round, refilled by a supply depot like every kit item.
`setHasMag 0`, so the spare box stays empty.

## Non-goals

- The soldier ammo panel's heat bar (`ATIconAndHeatBar`) is still unfed, so
  the packs draw their icons but not their bars. Pre-existing gap, not
  touched here.
- The engine's pose branch adds `+0x2f0` instead of `+0x2ec` in the wrench's
  reach; vanilla registers both at 2.0, so the viewer keeps one constant.

## Verification

`node --check` on every touched module, the viewer suites, and the live page
(see `features/level-bake-layers/README.md` for why a green suite says
nothing about a path that never draws under test):

- `map.html`, medic kit, hold fire: the health bar climbs about 15 HP in 10 s
  at full damage, and the medkit loop plays until release.
- `map.html`, medic next to a wounded bot (or wait for a hurt one): the bot's
  health climbs while the trigger is held, within 10 m, ally or enemy.
- `map.html`, engineer next to a wounded vehicle: the hull's health climbs at
  1.5 HP/s while the trigger is held, and the ratchet loop plays until
  release. Full-health hulls stay untouched.
- `map.html`, engineer, any nation: slot 4 shows the demokit art in the
  weapon bar, and holding the ExpPack or the plunger shows the demokit icon
  in the ammo panel, not the medkit one.

## Supply depots (2026-10-06)

The packs above are a soldier's own tools. A `SupplyDepot` does the same jobs
on its own clock. Desert Combat has 102 repair points whose only job is to
repair vehicles, and none of them did anything in the viewer. Vanilla's
`repairpoint`, `AirplaneRepairpoint` and `dockrepairpoint` did nothing either:
they author only `addVehicleType` rows, and the viewer read `setHealth` alone.

What the engine does is ledger SUP-18 to SUP-20, read from lnxded for this
round:

- **One cycle serves everyone in reach.** Every 0.5 s of world time
  (`SUP-4`) a depot runs once, against every soldier and every root hull it
  reaches. In the same cycle it reloads the guns when an ammo type fired and
  heals. The old reading, that ammo starves the heal, is refuted (SUP-18),
  so Wake's `M3A1SupplyDepot` heals its riders as well.
- **A hull is repaired by its own template's row.** That is the first
  `addVehicleType` row naming it, matched without regard to case. The row's
  rate is hit points per cycle, as written, crewed or not. All vanilla and DC
  rows are `-1 4 0`, so 4 HP a cycle, a little under 8 HP/s. A finite reserve
  pays at most what the hull was missing and regenerates. `setHealth` never
  reaches a hull. A negative rate kills: Medina Ridge's `fk1` takes 1000 HP a
  cycle from the 19 vehicles it lists, and from soldiers by its `setHealth`.
- **A seated soldier is served only by a depot on his own hull** (SUP-20):
  the half-track's locker, not the medical locker he drives past.
- A depot riding a hull is measured from where the hull is now. It stops
  while that hull is destroyed.

Built:

- `viewer/supply.js`: `SupplyDepot.step` (the clock, the ammo bucket and the
  reserve regen), `serveSoldier`, `serveVehicle`, `repair`, and
  `SupplyField.update`, the pass over every target. `tick(dt, target)` stays
  for a caller with one target.
- `viewer/world-fields.js`: `supplyFieldTick` replaces the per-player
  `supplyTick`. It builds the soldier list and the hull list only on a tick
  in which some cycle comes due. A hull is each registered root
  PlayerControlObject, at its body's position, on its crew's side (0 empty),
  named by its root template (`world.js` `addDamageable` stamps `isPco` and
  `template`). The old pass ran once per player on one shared clock. With
  bots in the world, each cycle served whichever player was ticked when it
  came due, and an empty hull was never served.
- `viewer/level-load.js` `collectSupplyDepots`: each depot knows its placed
  root. A depot on a PlayerControlObject reads its node again each cycle.
  `show()` hands the world its depots once the collider is built, so they
  work from the level's first tick, on bots and on empty hulls. Before, the
  world had none until the local player first stood on foot
  (`soldier-view.js`, which still collects them again then).

Checked: `tests/supply_harness.mjs` and `test_supply.py` (20 cases). These
cover the carrier pad repairing an empty F-14 at 4 HP a cycle and leaving an
unlisted M1A1 alone, `fk1` destroying a listed tank and a soldier inside 2 m,
`setHealth` not reaching a hull, the finite reserve, and the seated and
suspended rules. `world_harness.mjs` scenario 10 (`test_world.py`): two
soldiers at one locker heal alike over three cycles, and an empty F-14 on
the pad gains 12 HP in 2 s.

In the page (`depot_page.cjs` in the session scratch, vanilla El Alamein,
headless, port 5624): a Willy driven onto a `repairpoint` and knocked from
50 to 40 HP is back to 48 a second later and 50 the next. Left empty on the
pad and knocked to 40 again, it is at 50 within a second. The level has two
repair points and they stack (SUP-6). The page threw nothing; the only
console errors are the tree's existing 404s for three `_shared/hud` side
files.

Open:

- An empty hull's guns are not rearmed. The world knows a seat's guns only
  while someone holds the seat.
- The engine seeds each depot's clock at a random phase (SUP-4). The viewer
  starts them all at 0, so they cycle on the same tick.
- The headless match runner (`sim/stage.mjs`) never gives its world any
  depots, so bots in `sim/run.mjs` neither heal at lockers nor repair at
  pads. The page does both.
- `ShowRepairIcon` is not drawn. `SupplyField.canHeal` answers it for a hull.
- `repairVehicle` skips a hull whose unused-hull countdown
  (`PlayerControlObject+0x17c`, `setTimeToLiveUnused`) has run out (SUP-19).
  The viewer has no such countdown, so it is not built.

## A depot rearms spare magazines, not the loaded one (2026-10-19)

Reported in the sidecar playtest (`features/udp-sidecar/pairing-playtest.md`):
on El Alamein a B17's bomb counter went from 8 down as it dropped, then was
back at 8 at once. Retail takes its `reloadtime 15`. The B17 spawns 3.2 m
from one of the 13 `AlliedAirplaneSupplyDepot`s on the Allied airfield
(radius 20), and the hull rearm above called `FireState.reset()` on every gun
of the crew whenever an ammo row fired. That gave a full loaded magazine
every 0.5 s cycle. The bug was in the viewer's depot, not in the sidecar:
standalone `map.html` runs the same depot pass.

The engine (SUP-8, closed this round from lnxded `FireArms::reloadAmmo`
0x0828cfd0 and `ReloadFinished` 0x08289e70): each ammo row hands its whole
units of the cycle to the guns of its type (SUP-2). A one-magazine gun (the
B17's 900-round guns) is topped up in place. Any other gun gets whole
magazines back behind the loaded one, never the loaded one itself, and an
empty `autoReload` gun given a spare starts its reload.

Built: `fire-state.js` `FireState.rearm(units)` is that function, with the
leftover pile in `rearmPool`. `supply.js` `step` keeps each row's `units`, and
`serveVehicle` passes the rows to the hull's `refillAmmo`. `world-fields.js`
gives each of the crew's guns (once each) its row's units, picked by
`rearmTypeFor`.

Checked: `tests/depot_rearm_harness.mjs`, `test_depot_rearm.py` (6 cases),
driving `supplyFieldTick` with the real depot and guns. A rack dropped beside
the depot is still empty at 2 s and full at 15.2 s, the same as one dropped
away from it. The depot then returns the spare rack the reload took. A bomber
that lands with every rack spent gets one rack per 2 s (row 9, 4 a second),
and the first starts a 15 s reload. A gun 600 rounds down is full in about 6 s.
The same harness on the old `world-fields.js` shows 8 bombs at 2 s.

Open:

- The exporter does not carry a gun's `AmmoType` word, so `rearmTypeFor`
  serves an untagged gun from the first row that gave units this cycle. On the
  airfield depot that is row 10 at 100 a second, so the bomb racks come back
  faster than retail (all 9 within a cycle or two). The loaded rack still
  waits its reload. Carrying the word means a model re-extract in every tree.
- ~~A soldier's kit refill (`hand-weapon.js` `supplyTarget.refillAmmo`,
  `kit-ammo.js` `refill`) still fills the magazine in hand in full.~~ Closed
  the same day, below.

## A soldier at an ammo box goes by the same law (2026-10-19)

The kit refill put every item back to its spawn loadout each cycle an ammo
row fired: the magazine in hand full at once, a magazine change in progress
cancelled. `SupplyDepot::reloadAmmo` walks a soldier's items through the same
`FireArms::reloadAmmo` a hull's guns go through (SUP-8). In a sidecar round the
server runs that law and sends no ammo counts, so the page was showing, and
letting him fire, rounds the server never gave.

Built: the fill is one function, `fire-state.js` `reloadAmmo(mag, magSize,
numOfMag, units)`, which `FireState.rearm` and `kit-ammo.js` `AmmoEntry.rearm`
both call; `rearmTypeFor` moved beside it (re-exported from `world-fields.js`).
`supply.js` `serveSoldier` passes the depot's rows to `refillAmmo(types)` as
`serveVehicle` does, and `hand-weapon.js` hands them to `KitAmmo.rearm(types)`.
A one-magazine item (the grenade pouch, `magSize 3 numOfMag 1`) is topped up
in place; a Thompson gets whole 30-round spares behind its loaded magazine,
which the box never fills. A reload in progress runs on. A dry `autoReload`
item (the Bazooka) given a spare reloads through `hand-fire.js`
`stepDryMagazine`, as any dry magazine does; a dry Thompson waits for R. The
give sound plays only when an item's rounds rise, so units piling up short of
a magazine are silent. `KitAmmo.refill` stays as the whole refill a harness or
the replay HUD uses; no depot calls it.

Checked: `tests/foot_rearm_harness.mjs`, `test_foot_rearm.py` (6 cases),
`supplyFieldTick` over vanilla's `AmmoboxSupplyDepot` (rows 1 at 15/s, 2 and 3
at 1.2/s) and vanilla's magazine words. A dry Thompson with no spare holds 8
units after one cycle, one spare at 2.2 s, all four at 12 s, the loaded
magazine still at 0, and the give sounds four times. A half-spent magazine with
every spare gets nothing and no sound. A dry Bazooka gets a rocket a cycle or
so (row 3); the pouch fills a grenade at a time (row 2).

Open:

- The items carry no `AmmoType` either (vanilla writes 1 on the guns, 2 on the
  grenades, packs and mines, 3 on the launchers), so an untagged item takes
  the box's first row that gave units, the guns' 15 a second: the pouch is
  full in one cycle, not one grenade per 0.83 s. `AmmoEntry` reads
  `magazine.ammoType` once the exporter writes it (`bf42/con.py`'s magazine
  block), which means re-extracting every tree's models.
- The engine sends an empty `autoReload` item the reload message even when it
  is not in hand; here a holstered Bazooka starts its reload when raised.
