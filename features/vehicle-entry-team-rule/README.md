# A crewed hull is its crew's: the vehicle entry team rule

Owner's report: an enemy bot jumped into the T-34 he was driving. Branch
`fix/seats`; ledger SEAT-26..SEAT-29 (SEAT-4 corrected by SEAT-28). All
addresses `bf1942_lnxded.static` 1.61.

## The engine

- **Rule** (SEAT-26): a seat may be taken only if the vehicle's ROOT
  `PlayerControlObject` team (IPCO vt+0x74) is 0 or the player's
  (`BFPlayer+0x7c`). `GameServer::toggleEntryPoint` 0x0814ee70 re-checks it
  after any finder (0x0814f142..0x0814f15e, silent refusal);
  `BFfindEntryPoint` 0x0831d770 already skips such doors (0x0831da58..0x0831da71).
  `enterVehicle` 0x0814e860 tests nothing; the seat switch needs no rule.
- **Hull team** (SEAT-27): `PCO+0x170`, refcount `+0x174`. Every occupant of any
  seat stamps the root (`enter` 0x0831714d -> `setTeam` 0x0831a5f0); every exit
  takes it back (`exit` 0x08318233 / `exitPlayer` 0x083185fa -> `clearTeam`
  0x0831a610), team 0 at count 0 unless template `+0x190`
  (`dontClearTeamOnExit`, bool, ConsoleClass511 0x082f4d60). A `teamOnVehicle`
  spawn (`spawnObject` 0x083143a8) is stamped with nobody aboard and never
  released. So: empty = nobody's (steal allowed), crewed = the crew's.
- **SEAT-4 corrected** (SEAT-28): the finders' `queryComponent(0xc4a4)` +
  vt+0xc8 gate is `Armor::isDestroyed` 0x08174300 (wreck test), not a team test.
- **Bots** (SEAT-29): `BBChange::isMannedByEnemy` 0x0855fcb0 (called
  0x0855ea07) skips any unit whose hull is occupied by another side; the side
  is set on entry (`enter` -> root AI object `+0x58` `setSide`, 0x08317082).
- **Data** (vanilla+XPack1+XPack2 archives): Berlin has no `teamOnVehicle`;
  `dontClearTeamOnExit 1` is only on 12 ships; Kasserine Pass stamps its whole
  fleet.

## What changed

- `viewer/vehicle-instance.js`: `mayEnterHull`; `VehicleInstance.team` stamped on
  entry; `VehicleRegistry.enter` refuses an other-side hull (before touching the
  entrant's seat); `teamOf`, `playerTeam`.
- `viewer/bot-vehicle.js` `mannedByEnemy`; `bot-mount.js` (both Change loops),
  `bot-units.js` (`hullTeam` on candidates), `doctrine.js` (`WPBoard`),
  `test-hooks-bots.js` (`hullTeam`).
- `viewer/vehicle-entry.js` door scan skips other-side hulls, refusal clears the
  pilot box; `local-player.js mayEnterHull`, `net-room.js remoteCrewTeam`,
  `map.html` (two bag names).
- `server/room-control.mjs`: the room refuses an enter into an other-side hull.
- `sim/vehicles.mjs` (synthetic stand-in): same field and refusal.

## Verification

- `tests/test_vehicle_instance.py` (HullTeamTests, 9 new) and
  `tests/test_vehicle_team.py` (Berlin headless runner, 8): pass.
- Berlin runner, HEAD viewer vs this branch: an Axis bot told to take the free
  MG seat of an Allied-driven T34-85: seated -> refused; left 9 m from it: mounted
  it at 6.7 s -> never weighed it (took the empty Allied Browning).
- `sim/run.mjs --map berlin --bots 8`, trace checked for mounts into a hull the
  other side sat in: seed 3 60 s 1 -> 0; seed 1 300 s 1 -> 0; seed 2 300 s
  2 -> 0 (all an Allied bot into the Axis-crewed Hanomag).
- Live page (Berlin, `botCount=4`, human Allies in the T34-85): Axis
  `__botMount` into its MG -> false, hull unchanged; Axis bot left alone ->
  never targeted it (closest 8.0 m, went to the Browning); Axis steals the
  empty T34 -> true (team 1); Allied bot into the human's MG -> true; human at
  the Axis-crewed T34-85 -> not offered, `__enterSeat` false, still on foot,
  pilot box off; once emptied the human takes it. No page errors.

## Open

- Not modelled: `dontClearTeamOnExit` (ships keep the last crew's side) and
  the `teamOnVehicle` stamp (Kasserine Pass, naval spawners). The extract
  carries neither word (`con.py`, `scene.json` objectSpawns); needs parsing,
  re-extraction and a per-root team that outlives the instance.
- `teamOnVehicle 2`'s bool parse is unread. With a stamp modelled, the engine's
  bots would walk to an empty locked enemy hull and be refused (its own stall).
- `remoteCrewTeam` (client, rooms) was not exercised live; the room server
  still does not check a held seat (older gap).
