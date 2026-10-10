# Vehicle spawner pads

**Status (2026-10-06):** built in the viewer and the headless runner. A pad
spawns the vehicle of the side that holds its flag, and its respawn delay is
the engine's.

This was the Desert Combat parity round's levels package `spawner-pads`. The
census is `~/.cache/dc-sweep/reports/levels.md`, items 22, 24, 25 and 26-Bragg,
root causes A and B.

The engine rules are in the ledger:

- SPAWN-2 and SPAWN-5 were already there.
- SPAWN-9..SPAWN-13 are the spawner's own rows. They were read for this work
  and, at the same time, for the kit pads
  ([dc-mortar-and-kit-pads](../dc-mortar-and-kit-pads/README.md)).
- SPAWN-17..SPAWN-20 and SPAWNGRP-10 are this package's own rows.

Everything was read from `bf1942_lnxded.static`.

## What was wrong

Desert Combat places 364 pads at flags that change hands, on 30 of its 35
levels, and each names a different vehicle per side: a T72 for Iraq and an
M1A1 for the US, a BMP2 and an M2A3, a Mi24 and an AH64. The level bake puts
one vehicle on each pad, the one for the placement's own team. The viewer
hid that vehicle while its flag was neutral and showed it again otherwise. So
Iraq taking a US flag got the US tank. Iraq taking the neutral open base at
Gazala got an M1A1, an M2A3 and US AA guns.

The engine's pad (`ObjectSpawner`) was already decoded in
`viewer/deployables.js` `SpawnerPad`, but only the kit pads used it. Vehicle
pads ran their own respawn. That respawn waited for the wreck to fade, then
drew a uniform random delay between `minSpawnDelay` and `maxSpawnDelay`.
SPAWN-18 refutes that draw: the engine has no random in it.

## What the engine does

- **The join.** A pad belongs to a control point when the level's
  `Object.setOSId` on the pad matches the point's `objectSpawnerId`.
- **Who it spawns for.** At round start a point held by a side sets its
  pads' team to its own and switches them on. A point that opens neutral
  leaves its pads alone: one with its own `Object.setTeam` spawns that side's
  template from the first frame, and one with none has team 0 and spawns
  nothing (SPAWN-19). At every capture the point sets its pads' team to the
  taker's and switches them on; at every loss, team 0 and off (SPAWN-12). The
  pad spawns its `setObjectTemplate` entry for its team (SPAWN-2). A team with
  no entry spawns nothing.
- **What a flag change leaves alone.** No path touches an object the pad has
  already spawned. A tank parked at a flag that falls stays there, and anyone
  can take it.
- **When it respawns.** A slot is freed when its object is gone or destroyed:
  the Armor's `isDestroyed`, so a critically damaged hull that is still
  burning holds its pad (SPAWN-11). The delay then runs from the destruction,
  not from when the wreck clears. At zero, a wreck still within 5 m of the pad
  (`radius`) is removed, and the new vehicle appears.
- **How long the delay is.** `min + (max - min) * (1 - players / maxPlayers)`
  (SPAWN-10, SPAWN-18). An empty server waits `maxSpawnDelay` and a full one
  `minSpawnDelay`. A capture switches the pad on again (`setActive`), and that
  restarts the whole delay.

## What the viewer does now

- **`level-statics.js` `loadPadVariants`.** Before the scene is indexed, this
  loads the other side's template from the models tree, wherever a pad's flag
  can change hands. The page loads it through `vehicle-wrecks.js`
  `modelUrls`: the mod's tree, then vanilla, and the level's own reskin where
  the catalogue lists one. The template's root goes beside the baked vehicle,
  at the same pose. No re-bake is needed. Gazala adds 14 vehicles.
  - A template that fails to load leaves its pad with the baked vehicle and
    logs a warning.
  - A repeated template is cloned with `SkeletonUtils.clone`. A track is a
    skinned mesh, and a plain clone would stay bound to the first copy's bones.
- **`indexScene` pad records.** Each `objectSpawns` entry with a node in the
  spawners group becomes one `SpawnerPad`.
  - The join is `osId` against `objectSpawnerId`. A scene that carries no
    `osId` at all was exported before the exporter wrote it, so it keeps the
    exporter's nearest-flag guess. Today that means the vanilla, XPack1 and
    XPack2 trees.
  - The bake stands for the round's first frame. The pad spawns into its node
    set at once: the holder's template; at a flag that opens neutral, its own
    side's, or nothing when it has none.
  - A pad filed under no point, with no team of its own, keeps the baked
    vehicle. This is SPAWN-2's recorded divergence.
- **`vehicleSpawnActive(node)`.** True when the node stands in the world as
  its pad's object, or as an uncleared wreck of one. Everything that already
  asked this question now follows the pad: the hull's body and collision
  (`hull-bodies.js` `syncVehicleSpawnOwnership`, for every kind of hull now),
  the doors, the bots' candidates, the map marks and the draw.
- **`stepVehiclePads`, ticked from `vehicle-wrecks.js` `stepWrecks`.** It
  follows each pad's flag (`gotControl`/`lostControl`, through neutral), draws
  the delay for the server as it stands, and runs `SpawnerPad.tick` against
  the wreck side's answers: `alive`, `destroyed` (what `SpawnerPad`'s
  `critical` hook asks), `position`, `destroy` and `spawn`.
  - `players` is the world's player count, bots included. `maxPlayers` is the
    page's `ROUND_MAX_PLAYERS`, or the runner's `--max-players`.
  - The first delay is drawn on the round's first tick, once the players are
    in.
- **One node per template.** The engine leaves a wreck it finds away from the
  pad where it is and spawns a fresh vehicle anyway. The viewer waits for that
  wreck to clear first, which takes at most the 12.5 s linger and fade.
- **Old scenes.** A node no pad entry names, from a scene written before
  `objectSpawns`, keeps its old flag gate and its own respawn clock. That
  clock now draws `calcSpawnDelay` too.

Vanilla before and after: the live vanilla trees have no `osId` and no
`templates`, so no other-side vehicle loads. Their pads keep the
nearest-flag join, and the level's own vehicles settle exactly as before (the
loaded ones settle in a world of their own). Three things change, and all
three are engine-correct (a fourth, a pad with its own side at a flag that
opens neutral, is the review's correction below):

- A neutral flag taken stands its pads' vehicles up through the spawn path,
  with a full reset and a `vehicle_respawn` event. Before, they were simply
  un-hidden.
- A hull parked at a flag that is neutralised stays where it is. The old code
  hid it.
- The respawn delay is drawn by SPAWN-10 and runs from the hull's destruction.

Measured on the runner, 6 bots a side, 300 s, seed 1. The branch base
(`70d0b6ea`) is compared with this branch, both over the live vanilla tree.
Each trace is byte-identical up to the first of those three moments:

| Level | First moment | Time |
|---|---|---|
| El Alamein | East_outpost taken | 165.23 s |
| Bocage | the Bridge taken | 49.87 s |
| Wake | a flag neutralised: its Defgun stays and a bot changes to it | 140.63 s |

## How it was checked

- `tests/test_vehicle_pads.py` (`vehicle_pads_harness.mjs`) runs a synthetic
  level with a flag that changes hands, a neutral flag, a base and a pad filed
  under no point, plus the same level without `osId`. It covers:
  - which vehicles stand at load
  - that a capture leaves the parked hull and retargets the pad
  - that the M1A1 burning for 5 s holds the pad, and its destruction brings
    the T72 40 s later, with the wreck on the pad removed first
  - that a neutral flag taken spawns the taker's vehicle at once
  - that a pad with its own side at a neutral flag stands its vehicle from the
    start and keeps it when the flag is taken (added by the review)
  - the bool reading of `spawnDelayAtStart`
- Headless runner on DC Gazala
  (`~/.cache/dc-sweep/spawner-pads/padprobe.mjs`, no bots, the flag decreed):
  - The Allied village falls to Iraq, and its M1A1 is killed at t = 0. The
    wreck clears at 12.5 s, and a T72 stands on the pad at t = 110.1 s, the
    heavy tank's `maxSpawnDelay` on an empty server.
  - Iraq takes the neutral open base, and a BMP2, a T72 and two ZPU-4s stand
    there on the next tick.
- Page, DC Gazala (`~/.cache/dc-sweep/spawner-pads/pads_page.cjs`, two bots
  held still): no page error, 14 vehicles added, the pads as above, the T72,
  BMP2 and ZPU-4 drawn after Iraq's decree, and the bots' candidates listing
  them.
- Seeded runner matches on DC Gazala, with its `spawns` layer re-patched in a
  scratch tree: 8 bots a side, 600 s, seeds 1 to 3, under the sim lock. In
  the trace, Gabr_Saleh is `0PEN_BASE_ROAD` and Capuzzo is `ALLIES_village`.
  - Seed 1. The US take Gabr_Saleh at 276.1 s, and its M2A3, M1A1 and two AA
    guns stand up on that tick. Iraq take it at 507.9 s, and the US hulls
    still parked there stay. The M2A3 is destroyed at 516.7 s, and Iraq's BMP2
    (the loaded node) stands on its pad at 556.7 s: the light tank's 40 s
    `minSpawnDelay` on a full server, from the destruction.
  - Seed 2. Capuzzo's M2A3 is destroyed at 485.7 s while the flag is neutral,
    so the pad is off and its delay waits. Iraq take the flag at 512.9 s,
    which restarts the delay. Iraq's BMP2 stands at 552.9 s, 40 s after the
    capture.

## The abandoned hull's clock

Every one of Desert Combat's 1,529 spawner templates sets `TimeToLive` (1,415
of them at 45 s) and `Distance`, and the viewer had no use for either word.
In the engine, `spawnObject` arms each vehicle a pad places with its
template's `TimeToLive` (SPAWN-11, SPAWN-13). The clock runs in 0.5 s steps:

- It counts down while the hull stands farther than `Distance` from its
  spawner, nobody sits in it, and no live soldier on foot is within its
  bounding radius. Anything else resets it.
- At zero it bills `damageWhenLost` a second until the hull's own critical
  burn finishes it. Desert Combat's tanks set `TimeToLive 45`, `Distance 40`
  and `damageWhenLost 10`.
- The vanilla defaults, for a template that sets none, are 30 s, 100 m and
  1 hit point a second (SPAWN-17).

What changed:

- **The exporter.** `extract_map.py` `_object_spawn_report` now writes
  `timeToLive`, `distance` and `damageWhenLost` on every pad, with the ctor's
  values where the template is silent. This is the `spawns` layer; no re-bake
  is needed.
- **The page.** `vehicle-wrecks.js` `stepAbandoned` runs `deployables.js`
  `AbandonClock` for every hull a pad has out, and gives a far, empty,
  unwatched hull its hit points through its own `DamageableVehicle`. From
  there the critical burn, the wreck and the pad's delay are the ones above.
  - It arms only where the scene carries `timeToLive`, so a tree that has not
    been re-patched keeps hulls that never time out.
  - The out-of-world bill in the same branch (SPAWN-20, a PCO template field
    whose word was not found) is not modelled.
- **`spawnDelayAtStart`.** It is a bool (SPAWN-17). The six Desert Combat lines
  that write 15 or 60 (the SCUD and the AC-130) delay nothing in retail, and
  now in the viewer too. `SpawnerPad` holds back a pad's first vehicle only for
  a `1`.

How it was checked:

- `tests/test_vehicle_wrecks.py` `AbandonedHullTests`
  (`vehicle_wrecks_harness.mjs`): an M1A1 with Desert Combat's words, 60 m
  from its pad. It keeps 100 hit points for 45 s, then loses about
  10 hit points a second. At 30 m, with a man in its seat, with a soldier
  beside it, or in a scene without the words, it keeps all 100.
- `tests/test_object_spawn_report.py`: the template's words, the ctor's
  defaults, and Gazala's tank pads from the shipped archive (45 / 40 / 10).
- Headless runner on DC Gazala with its `spawns` layer re-patched in a scratch
  tree (`~/.cache/dc-sweep/spawner-pads/abandon.mjs`, no bots):
  - The Allied village's M1A1 is moved 60 m off its pad and left. It goes
    from 20 to 9 hit points (critical) between t = 53.3 and 54.4 s, and is
    destroyed at 55.5 s.
  - It stands on its pad again with 100 hit points at 165.5 s: the pad's
    110 s `maxSpawnDelay` on an empty server, counted from the destruction.
  - Moved 20 m instead, inside its 40 m `Distance`, it is untouched for 80 s.
  - On the live, unpatched tree it is untouched too.

The patch, proved on a scratch copy of five DC levels:

```bash
python3 tools/bf1942-models/patch_scene.py --tree <scratch>/desertcombat --mod DesertCombat --layer spawns --all
```

Each level's `objectSpawns` gains only the three words. Gazala's 49 pads come
out at 45 s / 40 m / 10 hp/s (4 of them at 20 hp/s). Weapon Bunkers' three
bunkers come out at 9999 s.

The same patch on a scratch copy of vanilla Gazala gives its 44 pads more
than the words: 40 gain `osId` and 43 gain `templates`, every one of them
naming a different vehicle per side, and all carry 45 s / 40 m / 10 hp/s (one
at 20). Run through the runner, the pads join their points by id and load 14
other-side vehicles. Dabir stands PanzerIVs, a Kubelwagen, a Wespe and a
Flak38, and Capuzzo Shermans, a Willy, a Priest and an AA gun. The neutral
Gabr_Saleh stands nothing until it is taken, and then Sherman or PanzerIV by
its taker. So once the lead re-patches the vanilla, XPack1 and XPack2 trees,
they leave the nearest-flag fallback and play the engine's pads.

## A dead carrier stops being a spawn

Some spawn points ride an object. Iraq's only spawns on Weapon Bunkers are 35
points in three bunkers whose pads never respawn (9999 s). No Fly Zone Day 2
puts its airbases' groups in hangars, a radar dome and a tower. Bragg's
Talil spawns ride the meshless `UST` and `IST`, each on a pad filed under
the neutral oil pump station.

In the engine each such point is inactive while the nearest Armor up its
parent chain is critically damaged (SPAWN-5). A carrier that was never
spawned, or has been removed, carries no points at all. The group's ring
averages only the active points, and a spawn takes one of them at random;
with none left, the spawn is refused (SPAWNGRP-10). The viewer only did this
for floating ships, and flag by flag.

What changed:

- **`hull-bodies.js` `bindCarriers`.** At body setup this gives every carried
  point (`vehicleSoldierSpawns`) a live `inactive`.
  - The carrier is the ship the point was authored on (`deckSpawnHost`), else
    the placed object of the point's template nearest its pad's points.
  - A point is inactive when its carrier is critical, destroyed or cleared,
    or not stood up by its pad. A sinking ship counts as critical.
  - `shipFlagInactive(flag)`, still under its old name, now reads the flag's
    own `inactive`.
- **`spawn-flags.js`.**
  - A carried flag is `inactive` when every point is.
  - `groupSpot` averages only the live points. With none left it keeps the
    average of all of them, where the engine would put (0,0,0).
  - `pickSpawn` never hands out a dead point, and returns nothing rather
    than falling back to one.
- **`world-players.js` `spawnPlayer`.** An inactive flag is refused and never
  picked. A side whose own flags are all down waits rather than going to the
  enemy's.
- **`bot-referee.js` `respawnTick`.** It leaves inactive flags out. A bot with
  nowhere to stand up stays down and asks again the next tick, as the
  engine's bot keeps choosing a group `spawnPlayer` refuses. Before, it stood
  up on its corpse.
- **The human.** `spawnAtFlag` refuses an inactive flag, as it did a burning
  ship. The deploy screen still lists it, as retail lists the group while
  its wrecks stand.

How it was checked:

- `tests/test_carried_spawn_flags.py`, `deadCarriers`: Weapon Bunkers' group
  99 over three bunkers.
  - With the middle bunker down, the ring moves to the other four points'
    average, and its two points leave the pick.
  - With all three down, the flag is inactive, every pick is refused, and
    `spawnPlayer` spawns nobody there. An Iraqi asking with no flag gets
    nothing rather than the US flag.
- Runner, DC Weapon Bunkers (`~/.cache/dc-sweep/spawner-pads/bunkers.mjs`,
  4 bots a side, under the sim lock):
  - All three bunkers destroyed and every Iraqi bot killed at t = 20 s: the
    flag goes inactive, and all four Iraqi bots are still down at 120 s.
  - The control run kills the bots and leaves the bunkers standing: all four
    stand up again on the bunkers' points.
- Runner, DC Operation Bragg (`~/.cache/dc-sweep/spawner-pads/bragg.mjs`):
  - At the start, both Talil groups (7, US, and 8, Iraq) are off. Their
    carriers' pads are under the neutral oil pump station.
  - The US take it: `UST` stands, group 7 is on, and group 8 stays off. Iraq
    take it: `IST`, group 8 on, group 7 off.
  - The station's other pads switch side with it: M1A1 to T72, AH-6 to MH-500,
    A10_B to SU-25. The census's "both Talil spawn sets are live from round
    start" is gone.

## Review correction: a flag that opens neutral (2026-10-07)

The build switched every pad filed under a neutral point off at the round
start, reading `ControlPoint::reset` as the round start. It is not.
`ControlPoint::init` enables a point's pads only for a side, `reset` runs only
in `GameServer::restartMap`, and `restartMap` then runs `ObjectSpawner::reset`
on every spawner, which puts back its own active byte and team (SPAWN-19 as
corrected, with the addresses). So a pad with its own `Object.setTeam` at a
neutral flag stands that side's vehicle from the first frame, and one with
none stands nothing. The lab's recordings show it:

- DC El Alamein (four rounds over two server runs) and El Alamein Day 2 (two)
  have the South outpost's `AAGunSpawner` ZPU-4 (`Object.setTeam 1`, the flag
  neutral) at t = 0. The AA kits at the start number 9: the two bases' 4 and
  1 plus the outpost's 4 `setTeam 1` pads. Switching the outpost off gives 5.
- Vanilla El Alamein starts with 2 flak38s, the Axis base's and the
  outpost's.

`level-statics.js` `followPoint` now leaves such a pad on with its own side
and switches off only a pad with no side of its own (whose baked vehicle
would otherwise stand in for SPAWN-2's team-0 divergence). The kit pads'
copy (`deployables-page.js` `tickPads`) already did this. Pads that change at
the start, by tree (the live trees; the vanilla three by the nearest-flag
guess until re-patched): DC 31 on 8 levels (Desert Shield 8, Midway 12, the
El Alamein ZPU-4s), DC Final 30, vanilla 13 (El Alamein's Flak38, Omaha's 4,
Truk's 3, Kasserine's 2 Willys), XPack1 17, XPack2 43 (Raid on Agheila 24).
Every one of them was hidden at the start before this branch too. The
vanilla runner traces above were taken before the correction, so El Alamein
and Bocage now differ from the first frame, by those pads.

## Open

- A wreck away from its pad delays its pad's next vehicle until it clears
  (see "One node per template").
- The abandoned hull's out-of-world bill (SPAWN-20).
- The kit pads (`deployables-page.js`) follow neither SPAWN-21 (a pre-game
  `setTeam` cancels `spawnDelayAtStart`) nor SPAWN-22 (a point being taken
  switches its pads off).
- `world.js` ticks the Armor of a pad hull that has not stood up yet, so a
  hull born critical (Medina Ridge's `flagkill`) burns down unseen.
- Medina Ridge's rock dropper (`fkspawn`, `flagkillsimple`) is not built.
- `deployables-page.js` (the kit pads) keeps its own copy of the join. It
  already leaves a neutral point's pads alone at the start, which is the
  engine's law (SPAWN-19 as corrected); the two copies now agree.

## Round gaps (2026-10-07)

Package `round-gaps` of the Desert Combat parity round. Ledger rows
SPAWN-21, SPAWN-22, ROUND-10, TKT-5 and TKT-8; SPAWN-4 and SUP-19 gain a
line each.

**A point being taken switches its pads off (SPAWN-22).** A control point
with `disableWhenLosingControl` runs `CPDisable` every frame it is run down:
its spawn groups and every pad filed under it go off, though it keeps its
side and its flag. Its owner standing on it again alone switches them back.
`bot-referee.js` `controlPointStep` writes `flag.spawnsEnabled`;
`spawn-flags.js` holds it and `level-statics.js` `followPoint` switches the
pads. Used on XPack2 Telemark's three bridge points and DC / DC Final
Basrah's Edge's `USspawn`. In a seeded Telemark run (8 a side, seed 1)
`axis_BASE_bridge` went from 7 Axis spawns to 0 at 93.9 s, still Axis, and
back to 7 at 101.1 s when the Axis held it.

**A pre-game `setTeam` cancels `spawnDelayAtStart` (SPAWN-21).** A level
loads in the pre-game, and `ObjectSpawner::setTeam` there sets the delay to
-1. So a pad that says `spawnDelayAtStart 1` and has its own `Object.setTeam`,
or sits under an owned point, stands its vehicle at once on the first round.
DC Final DC_Cornered's six such pads (T-72, BM-21, BMP-2, Scud, two MLRS) are
live at load in a seeded run; after a restart they wait out the delay.

**The restart rebuilds the field (ROUND-10).** `restartVehiclePads` puts
every pad back as `ObjectSpawner::reset` does: slots empty, the pre-game's
team, on as the round opened, delay -1 or `spawnDelayAtStart`'s. The end game
has already cleared every hull (`vehicle-wrecks.js` `clearWorld`), so each pad
stands a fresh one on its own spot.

**A carried spawn point rides any carrier (SPAWN-4).** `hull-bodies.js`
`rebaseRiders` moves the points a carrier holds, not only a floating hull's.
In a runner stage on DC Gazala, the AC-130 moved 600 m east, 250 m up and
turned 0.7 rad, and its point and ring followed. Back on its pad they
returned.

**Two pads on one spot are two nodes.** `extract_map.py`
`union_object_spawns` keyed pads by vehicle and pose, so Medina Ridge's
Outpost Pass `ofk` and `cfk` (a `flagkill` for each side, same spot) became
one node: the live glb has 5 flagkills for 6 pads. A layer's k-th placement
of a pose is now the k-th node there. Only dc_medina_ridge in DC and DC Final
has such a pair. A scratch bake has 6 flagkills and 9 FlagBoxes (5 and 7
live).

**A depot is there only while its object is (SUP-19).** A pad's hull that has
not stood up stays in the scene, hidden, and its depot used to work.
`level-statics.js` `markAbsent` flags each pad node not in the world, and
`world-fields.js` `depotSuspended` skips its depot.

**Medina Ridge and Bragg are pads, not scripts.** Medina Ridge's push is the
level's own pads. Each flag's `flagkill` is keyed to a side by `osId`. It is
born at or under its `criticalDamage`, so it burns down in about 3 s, and its
pad (TTL 0, no delay) stands another: retail's churn. Each one carries the
`fk1` depot, whose `-1000` heal kills an attacker on the flag while his side
does not hold the point before it. Bragg's Talil carriers (`UST`, `IST`) carry
`USS_Kill` / `IS_Kill` (radius 100, -1000) the same way. The Landslide pieces'
`LSP.con` is rem'd in `Objects.con`, so retail never loads it; the 160
`LandslidePieceM` nodes are Landslide's own children. In a directed runner
push (a US soldier on each flag in turn), the opposition base's killer killed
while Outpost Pass was Iraqi. Oasis, the outpost and the base could be stood
on once the point before each was taken, and the `fk1` depots on unspawned
pads read absent.

## The Forklift parks as a car (2026-10-06)

Desert Combat's Forklift is the one `VCSea` hull that drives on land. Its
root is `setVehicleCategory VCSea`, but it carries two `c_ETCar` wheels and
no `c_ETShip`, so `seat-survey.js` `rootDriveKind` already drove it as a car.
`hull-bodies.js` `isSeaHull` read the category alone, though, and gave it no
parked body. It stood where it was authored, one of them 1.16 m in the air
over Al Khafji's docks.

A `VCSea` hull is now a sea hull unless its drive kind is a land one
(`ground` or `tank`). The `adv-conwords` sweep's CW10 found this.

To check it, `~/.cache/dc-sweep/spawner-pads/seahulls.mjs` classified every
`VCSea` placement on every level of the DC, vanilla, XPack1 and XPack2 trees.
Only the Forklift changes: three on Al Khafji Docks and two on Sea Rigs. The
ships (Fletcher, Hatsuzuki, Elco80, Lcvp, Raft and the rest) still classify
as `ship`. The engineless carriers (Nimitz, Hornet, Hiryu) classify as `seat`
and stay sea hulls too. On Al Khafji the three Forklifts now carry parked
bodies and rest at 78.89 m, 0.29 m above the 78.60 m ground. The three Lcvps
are unchanged.

## A crash's fire stayed on the next hull (2026-10-10)

A plane shot down in the air plays its death tier twice: once at the kill and
again where it comes down (`vehicle-wrecks.js` `landWreck`). The second run's
handles were dropped, so nothing stopped them. The pad's delay runs from the
destruction (SPAWN-11), so after a long fall the pad stands its next hull up
on the same node within a tick of the crash, and the crash's fire and smoke
rode back to the pad on it. The hull itself had full hit points. Desert Combat
shows it most because its jets and helicopters die high and their pads are
quick.

`landWreck` now keeps the crash's handles with the wreck's, so `clearWreck`
and the respawn stop them. `tests/test_vehicle_wrecks.py`
`test_a_crash_leaves_nothing_burning_on_the_next_hull` drives a kill in the
air, the crash and the pad's spawn: two runs were left burning before, none
now.
