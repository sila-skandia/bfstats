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
- **Who it spawns for.** At round start, and at every capture and loss, the
  point sets the pad's team to its own and switches the pad on for a side, off
  for neutral (SPAWN-12, SPAWN-19). The pad spawns its `setObjectTemplate`
  entry for that team (SPAWN-2). A team with no entry spawns nothing.
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
    set at once: the holder's template, or nothing at a neutral flag.
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
nearest-flag join. Two things change, and both are engine-correct:

- The respawn delay is drawn by SPAWN-10 and runs from the hull's destruction.
- A hull parked at a flag that is neutralised stays where it is. The old code
  hid it.

## How it was checked

- `tests/test_vehicle_pads.py` (`vehicle_pads_harness.mjs`) runs a synthetic
  level with a flag that changes hands, a neutral flag, a base and a pad filed
  under no point, plus the same level without `osId`. It covers:
  - which vehicles stand at load
  - that a capture leaves the parked hull and retargets the pad
  - that the M1A1 burning for 5 s holds the pad, and its destruction brings
    the T72 40 s later, with the wreck on the pad removed first
  - that a neutral flag taken spawns the taker's vehicle at once
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

## Open

- A wreck away from its pad delays its pad's next vehicle until it clears
  (see "One node per template").
- `deployables-page.js` (the kit pads) keeps its own copy of the join. That
  copy does not switch a neutral flag's pad off at the start, as
  `ControlPoint::reset` does.
