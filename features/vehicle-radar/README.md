# Vehicle radar: the sonar scope on jets and anti-air hulls

**Status:** built 2026-10-10 for the scope (sweep and dots on the minimap and
the full map), in vanilla, Road to Rome, Secret Weapons, Desert Combat and DC
Final. The warning ping (SONAR-7) is read and not built. Ledger rows
SONAR-1..SONAR-8.

Desert Combat's radar is not new engine code. It is vanilla's destroyer sonar:
a `SonarObject` under the hull and `sonarPos 1` on the seat that reads it. DC
hangs vanilla's own `DestroyerSonar` on its jets and SonarObjects with
`enableRadarMode 1` on its anti-air hulls.

## How it works

1. **The seat.** A PlayerControlObject with `sonarPos 1` shows the scope on
   its map (SONAR-1). The scope reads the first SonarObject under the hull.
2. **What is sensed.** Every root object with an Armor within
   `detectionRadius` horizontally: hulls crewed or empty, wrecks, men on foot,
   either team. A sonar takes what is level with or below the carrier, a radar
   (`enableRadarMode 1`) what is level with or above it (SONAR-3). A jet's
   scope therefore shows the ground under it; a Shilka's shows the sky.
3. **The sweep.** `Submarine/sonar.tga`, a quarter wedge, centred on the
   carrier on the map and turned clockwise from due west by the mod's
   `Game.setSonarRotationSpeed` per map update: 0.025 rad in vanilla, 0.1 in
   Desert Combat and DC Final, so their sweep turns four times as fast, about
   once a second at 60 updates (SONAR-4, SONAR-5).
4. **The dots.** When the sweep passes a sensed object's bearing it leaves a
   `map_dot` there, grey whoever it is. The dot follows the object and fades
   over half a turn; the next pass lights it again (SONAR-6).

## What is built

| Piece | Where |
|---|---|
| The four con words | `bf42/con.py` (`sonar_pos`, `detection_radius`, `scan_for_enemy_sonars`, `enable_radar_mode`) |
| Which hulls and seats, and the sweep speed, per mod | `extract_vehicle_sonar.py` -> `<maps tree>/_shared/vehicle-sonar.json`; `extract_maps_all.py` writes it after its levels |
| The sweep art | `extract_hud_pack.py` adds `Submarine/sonar` to the sprite pack |
| The rules | `viewer/sonar.js` (pure): `sensedObjects`, `sonarBearing`, `SonarScope`, `seatSonar` |
| The page's side | `viewer/map-sonar.js`, called from `map-surfaces.js` `paintMap` |
| Test hook | `window.__sonar()`: the seat's entry, the sweep and the lit dots |

The table is a JSON beside `vehicle-sounds.json` and not a glb field: the words
are con data no mesh depends on, and a level's `scene.glb` holds a baked copy
of every hull, so a glb field would have needed every level re-baked.

A mod's sprite pack is the difference from vanilla's (`extract_hud_mods.py`).
The sweep is vanilla's, so a mod needs only the `sonar` entry in its own
`hud.json`. Run `extract_hud_mods.py` into a scratch `--out` and copy
`hud.json` across: run in place it prunes the level thumbnails another step
writes into the pack.

## Who has it

| Tree | Hulls | Radar mode |
|---|---|---|
| bf1942, XPack1 | Fletcher, Fletcher2, Hatsuzuki, Hatsuzuki2 | none |
| XPack2 | the four destroyers; Wasserfall (`wasserfallSonar`, 410 m) | 1, the Wasserfall |
| DesertCombat | 17: DC Final's less the F117A, Patriot and Pantsyr | 3: M163, Shilka, SA-3 |
| DC_Final | 20: AV-8A, F-14A/B, F-15C, F117A, F16, Mig29, Mirage, OSA, OSA2, the four destroyers (sonar); M163, Shilka, SA-19_Pantsyr (700 m), SA-3, Patriot (400 m) (radar) | 5 |

Only the AV-8A of the Harriers writes the words. The AC-130 writes
`sonarPos 1` and has no SonarObject, so it has no scope. The submarines carry
`SubmarineSonar` and write `subPos`, not `sonarPos`: they hear pings
(SONAR-7) and draw no scope. The scope seat is the hull's own driver seat in
every hull but the Pantsyr, where it is the gunner (`Pantsyr_C3PCO`).

## How it was checked

- `tests/test_sonar.py`: the sensing rule both ways, the bearing, the sweep's
  timing and a dot's life, the seat lookup, the con words and the table.
- DC Final, No Fly Zone, in the viewer (`window.__sonar()`): from a Shilka at
  y 39.75 the radar lit the eleven hulls at or above it within 700 m (the
  MiGs, Mirages and Su-25s parked at 40.0 to 40.8, a SA-3 on a hill at 77) and
  none of the ZPU-4s, BRDMs and SA-3s at 39. From a MiG-29 at 40.79 the sonar
  lit the 22 hulls at or below it within 400 m and not the SA-3 on the hill.

## Open

- **The ping** (SONAR-7). Only a SonarObject with a sound script can ping, and
  among scanning sonars only vanilla's `SubmarineSonar` has one: the Gato
  hearing a destroyer. DC's scanning radars load no script and are silent.
- **Destroyable statics.** They carry an Armor and are roots, so the engine
  senses them; `map-sonar.js` lists hulls and men only.
- **The sweep's size when the map is zoomed.** The client draws it 128 units
  square, or `BfMap +0x48` x 128 in a state not read (SONAR-4). The viewer
  draws the art at its own size on every surface.
- **Frame rate.** The client steps the sweep once per map update with no frame
  time. The viewer pins it to 60 updates a second.
- **Other mods.** EoD, FH, FHSW and the rest have no table and no `sonar`
  sprite entry in their packs; a seat there shows no scope until
  `extract_vehicle_sonar.py --mod <M>` and the pack step are run for it.
- **Replays.** The scope is not drawn while a replay plays.
