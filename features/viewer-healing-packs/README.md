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
