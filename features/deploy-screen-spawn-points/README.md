# Deploy screen spawn points

The spawn interface (`map.html`, Caps Lock and the round-open default) had four
problems, reported against Wake: rings often missing until the screen had been
closed and reopened a few times, clicking a ring feeling unreliable, the
debug-only sidebar options sitting in the way of normal play, and the Axis tab
on Wake showing nothing at all where the real game offers the fleet.

## 1. Rings missing until the screen is cycled

Two causes, both fixed:

- **`flags` survived a level switch.** `openDeploy` only rebuilt the flag list
  when it was empty, so after switching maps the deploy screen drew the
  *previous* level's spawn points — off the current map's art, i.e. invisible —
  and a click could pick a flag that did not exist. `openDeploy` now calls
  `buildSpawnFlags()` on every open (the kept choice rides the select through
  the rebuild), and the full-map surface key includes `flags.length` so a
  rebuild always invalidates the cached paint.
- **Late-arriving art and sprites never forced a repaint.** `mapArt.onload`
  only stored the image and the HUD sprite pack's onload repainted the chrome
  canvas only; both now force `drawFullMap(true)` while the deploy screen is
  up, so a screen opened while the level's map art or ring sprites were still
  decoding repaints the moment they land instead of waiting on the 250 ms
  staleness gate.

Selection semantics were already right and stay right: a click on a ring (or a
number key, or `__deploy.select`) only *selects*; Enter or the commit button
spawns.

## 2. The DONE button was click-dead on a fresh join

The flattened spawn layout draws different footer buttons per
`Kit/IsAlive`: with a life behind the screen it draws SUICIDE (330px) / SCORE
BOARD / RESUME (630px); a fresh join draws CLOSE (330px) / SCORE BOARD / DONE
(630px). Only the SUICIDE and RESUME rectangles had invisible `.fm-hit`
buttons wired, so on a fresh join the DONE plate you could see was not
clickable — Enter was the only commit. The hit regions are now placed for all
four ids (they share two rectangles), the left region acts as SUICIDE (commit)
with a life behind the screen and CLOSE (cancel) without, the right region as
RESUME (cancel) with a life and DONE (commit) without, and `syncDeployReady`
disables whichever of the two is the commit while the scene still streams
(LOADING), leaving the cancel button live.

## 3. The sidebar is debug gear

The `#side` panel (level picker, fog, wireframe, vehicles, entire-map, pilot,
spawn-on-foot, sound) now starts collapsed on every screen size; the
`Maps` fab pulls it back up. Previously the collapse styles only existed
inside the touch media query, so desktop always showed the panel. The
on-foot checkbox itself is untouched — the deploy screen is the real join
path — it is just out of the way now.

## 4. Wake: the Axis tab had no spawn points

Root cause, read off the installed archives:

- The engine's binding for which side of the spawn screen a spawn group lists
  under is `spawnPointManager.groupTeam` (`<mode>/spawnPointManagerSettings.con`),
  not the control point that declares `spawnGroupId`. Wake's group 1 is the
  landing beach, `groupTeam 1` — the Japanese landing — while `The_Beach`
  starts `team 2`. The extractor derived each spawn's team from the flag
  alone, which put the beach spawn on the wrong side and left the Axis tab
  empty.

  **Corrected 2026-09-27 (ledger SPAWNGRP-3):** `groupTeam` is only the
  group's first value. `ControlPoints.con` runs after the manager settings and
  each placed point writes its own team into the group it claims, at load and
  at every round start, unless the group says `groupEnableToChangeTeam 0`. So
  Wake's beach group 1 starts American (The_Beach, team 2); the Axis tab is
  filled by the fleet's deck spawns, not by the beach.
- The fleet ships carry deck spawn points *inside the vehicle templates*
  (`Objects/Vehicles/Sea/<ship>/Objects.con` adds `SpawnPoint` children with
  `setGroup` 64+), and `Game/GlobalSpawnGroups.con` binds those groups to a
  side. No control point ever claims them, so `spawnFlags` dropped them
  entirely (the known gap recorded in `features/bf1942-3d-models/
  kit-loadouts.md`). Wake's fleet is one Shokaku carrier and one Hatsuzuki
  destroyer: **3 deck points on the carrier, 2 on the destroyer** — the
  spawn options the real game shows.

Changes:

- `bf42/level.py`: `parse_spawn_point_manager()` reads the manager settings;
  `GameplayObjects.spawn_group_teams`; `team_of_group` prefers `groupTeam`
  (the engine's own rule) and falls back to the declaring control point.
  `SoldierSpawnTemplate` also records `setEnterOnSpawn` so a seat-entry point
  is never mistaken for a standing one.
- `extract_map.py`: `_vehicle_soldier_spawn_report()` walks the level's
  object spawners, reads each sea vehicle's `Objects.con` for its deck
  `SpawnPoint`s, and emits them as `scene.json`'s new `vehicleSoldierSpawns`
  (vehicle, group, side, world position at the spawner pad). A live
  `setEnterOnSpawn 1` template is skipped; the helm points the fleet ships
  leave remmed are kept, which is exactly why the carrier shows three points.
- Wake was re-extracted and its `scene.json` republished to
  `mesh.bfstats.io` (the glb is unchanged).

The viewer (`viewer/soldier.js`):

- `spawnFlags` derives a flag's side from its spawns' `team` (the manager
  data, once re-extracted) with the control point as fallback, and turns each
  ship instance into one flag named after the vehicle (`Shokaku`,
  `Hatsuzuki`) with all of its deck points as spawns. On Wake the Axis tab
  now lists Landing Beach, Hatsuzuki and Shokaku; the Allied tab the four
  island flags.
- `pickSpawn` lifts a ship flag's spawn `DECK_LIFT` (10 m) above the data's
  vehicle-origin position, so the soldier drops the last metres onto the deck
  instead of into the bilge; the ground clamp runs against the lifted height.

## Survey of the other levels

The `groupTeam` rule changes only Wake among the 22 extracted vanilla levels.
Battleaxe (groups 9/10), Gazala (15/16) and GuadalCanal (9/10) gain a side on
otherwise-unclaimed airfield spawn groups — no control point declares those
groups, so they still produce no flag and stay invisible, as before.

## Follow-ups

- The other levels were not re-extracted. Their `scene.json` carries the old
  CP-derived spawn teams, which the viewer's fallback reproduces exactly, so
  nothing regresses; the next full extract pass will pick up `groupTeam`
  (and `vehicleSoldierSpawns` — Coral Sea's and Midway's carriers would gain
  their deck spawns) everywhere.
- Whether unclaimed *land* spawn groups (Gazala's airfield knut/bernt sets)
  are selectable in the real game is unverified; left alone.
