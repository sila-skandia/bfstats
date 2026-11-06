# Proving ground

A front-end tab, PROVING GROUND, that drops the player into an empty white
floor (the "construct") with a chosen battle's kits and vehicles. They can fly,
drive or walk anything that battle fields, in any camera, and fire at the same
vehicles parked down range. Every round they fire draws its path and says how
far it flew, for how long, how far it fell and what it did. The owner's brief
(2026-11-06), in short:

- the OPTIONS > CONTROLS preview should get a full-screen button, so players
  can fly, drive and walk what they are testing their inputs on;
- a menu tab of its own, a matrix-style simulation instead of a full map, to
  try every vehicle and weapon against vehicles and soldiers;
- show where to hit a vehicle for the most damage (the imported hit zones are
  "very fuzzy" as they are drawn today);
- teach a weapon like FHSW's Panzerfaust: see how far a round goes, and its
  maximum range.

Status: **built**, vanilla checked in the page (see "Checked"). Not published,
because no asset is involved (see "Nothing baked").

## How it is built

### Nothing baked

The construct is not a level on the assets volume. `viewer/proving-ground.js`
builds it in the page, the shape `level-load.js` already reads:

- **The report** is the battle's own `scene.json`, reduced. It keeps what the
  vehicles and weapons need (`damage`, `materialDiffuse`, `alphaBlend`,
  `depthWriteOff`, `alphaLodDistance`, `meshCull`, `collisionGroups`, the env
  map, the vehicles' engine sounds). It drops the ground, sky, sea, statics,
  flags and AI, and writes in the construct's points, soldier spawns and pads.
  The `heightmap` must be null: `level-terrain.js` `loadHeightmap` would
  otherwise stand the collider on the battle's real hills.
- **The scene** is what `GLTFLoader` would have handed back: sixteen
  `kind: terrain` tiles on a 32 m lattice (`heightfield.js` snaps them),
  flagged `unlitTerrain` so `unlightTerrain` keeps their grid shader; a
  `spawners` group; an empty `controlPoints` group.
- **The vehicles** come from the models tree, through the level load's own
  `loadPadModel`. That loader picks the battle's level variant and paint
  (`padSkin`), because the entry keeps the battle's folder and the report its
  `level`. Each placement is a pad (`objectSpawns`, templates `{1: T, 2: T}`,
  6 s respawn), so every vehicle on the floor is an ordinary pad vehicle:
  enterable, damageable, wrecked and stood again.
- **The kits** follow the folder: `_shared/loadouts.json` is keyed by level
  directory (`levels[dir]`), and the entry's `glb` path keeps the battle's.
  FHSW's Kursk deals Kursk's German AT kit here, as it does on Kursk.

`level-load.js` takes `entry.synthetic`: the report first, then the scene,
built once `level.extras` is set (the model loader picks variants off it) and
before `loadPadVariants`, so every later pass treats it as baked. map.html
builds the entry for `?proving=1&map=<battle>` and skips the scene prefetch.
`map-surfaces.js` takes a report's `minimap.url` before a file, so the
construct draws its own map (grid, range lines, a mark per vehicle).

### Which vehicles

`battleTemplates(report)` reads both sides' entry of every pad, in every game
type. That misses what a carrier launches: Coral Sea's pads are guns and ships,
and its aircraft come off the Enterprise's own spawners. So
`catalogueTemplates` adds the land, air and gun rows of the models catalogue
(`models.json`, every tree the page draws from, mod first) whose `levels`
name the battle. Ships are left out: the floor has no water.

### Layout (glb frame, down range is -z)

| What | Where |
|---|---|
| Firing line | z = -320, x = 1024; the player's base, locked, 8 spawns |
| Garage | every land vehicle and gun, 18 m past the line, facing down range |
| Airfield | the aircraft, right of the line, nose down range; 2 km of floor to take off over, and the floor wraps |
| Target rows | every land vehicle again at 100 m and 250 m, turned to face the line, the other side's |
| Contest | a neutral, capturable flag at 200 m with no spawns |
| Far end | the enemy's base at 600 m, locked, 12 spawns |

Yaw: the glb's yaw about +y is the negated BF yaw, and yaw 0 faces -z
(measured on Aberdeen's baked PanzerIV, -150.98 against `rotation[0]` 150.98).

The abandon clock (`deployables.js` `AbandonClock`) bills `damageWhenLost` a
second once a hull is `distance` from its pad. At `distance 0` it wrecked
every target 4.5 s after load. Targets carry `damageWhenLost 0` and an
unreachable distance. A garage vehicle left 25 m out goes home after 30 s.

Bots: `?botCount=` puts them all on the construct's other side
(`spawnBotsForLevel`, keyed off `extras.provingGround.team`, because the spawn
screen's tab is not settled when the level loads). With only locked bases they
stood still. The neutral Contest flag is what walks them up the range, and
they fire back. Tickets are 999 and never bleed, so the round does not end.

### The instruments (`viewer/proving-ground-page.js`)

- **Paths and tags.** Every round of the player's (`isLocalGroup`: the hand
  weapon's group or a seat he holds) is found new on `guns.projectiles` /
  `guns.tracers`, sampled every frame into a line, and finished by
  `guns.onImpact` (chained after the page's own pricing). A round that leaves
  the lists with no impact ran out its fuse in the air, and its tag says so:
  that is the weapon's reach, measured. A tag carries the range, the flight
  time, the fall below the launch line, and on a hull the hit points taken,
  the face, the angle's share and what is left. The last round is repeated in
  the panel.
- **Hit zones (H).** Each vehicle's collision meshes are copied, coloured by
  how many head-on hits of the weapon in hand destroy the vehicle. The price
  is `materialDamage(att) x damageMod(attGroup, defGroup)` from
  `damage.json`, the same terms `round-impact.js` prices a hit with. Bands: 1,
  2, 3-4, 5-9, 10+, none. The part under the crosshair is named in the panel.
  Faces are named by vanilla's tank convention (50 rear, 51 side, 52 front,
  features/bf1942-3d-models), else by armour range.
- **Landing point (U).** After one round of a weapon, the marker shows where
  the next lands from the camera's aim: point physics with that round's own
  launch speed, fall and fuse, against the floor. A rocket's motor and drag
  are not modelled, and the panel says so for a round that has them.
- **Rangefinder.** The distance to the hull or the floor under the crosshair.
- **Range boards** every 50 m to 1500 m on the floor, in the floor's green.

Two traps, both found in the page:

- A parked hull's parts are frozen, so three skips their world matrices. A
  zone hung on one kept the identity it was born with and drew at the world's
  origin. Zones compose their world matrix from their host's every frame.
- A collision mesh hangs under a hidden collision node, so a copy hung beside
  it inherited the hiding. Copies go on the nearest drawn ancestor.

### Front end

- `play/proving-ground-screen.js`: the tab on CREDITS' plate, drawn as REPLAY
  draws its feed (menu background and strip on canvas, an HTML panel in the
  page box). Battles are SINGLEPLAY's list (`skirmish.js` `levelRows`), each
  with its vehicles from the catalogue. Also: side, enemy soldiers (0, 4, 8,
  16), the keys, and ENTER. `?tab=proving&battle=<map>&side=<1|2>` opens it
  with a battle picked.
- OPTIONS > CONTROLS: TRY IT FULL SCREEN on the preview's corner
  (`controls-screen.js` `onTryIt`, only where the host passes one, so not in
  the in-game Escape menu). It launches straight into the battle that fields
  the previewed machine (Spitfire on AIR, Sherman on LAND & SEA) and the most
  of its kind, on the Allied side. The full-window game is map.html's match
  shell (`?team=` takes the site's bar down); a browser's own full screen does
  not survive a page load.

## Checked (vanilla, 2026-11-06, in the page)

- Aberdeen: the construct loads in 21 MB. The spawn screen deals Aberdeen's
  kits on the construct's map. The PanzerIV target takes a Panzerschreck
  rocket from 25 m: -17 hp, front armour, angle x0.66, 83/100 left, tag and
  panel agree. From 50 m the rocket falls 1.4 m and passes under the hull's
  collision (its lowest face is 0.6 m off the floor): the tag reads
  "54 m 1.00 s fell 1.4 m", which is the lesson.
- Hit zones on the PanzerIV for the Panzerschreck: the front reads "26 hp
  head-on, 4 to destroy", matching the table in features/bf1942-3d-models (the
  bazooka does 26 to the Sherman's front).
- Landing point after one shot: 65 m, 1.30 s from a level aim.
- Coral Sea: the B17, BF109, Mustang, Spitfire and Stuka come from the
  catalogue. The Spitfire taxis to 53 m/s, lifts on the stick, loops and
  meets the floor.
- 6 bots spawn at the far end and walk up toward the Contest flag. They shot
  the player down to 30 hp from about 350 m.
- FHSW Arnhem 1944: the construct fields Arnhem's Puma, Panzer III and IV,
  JagdPanther, StuG, Panther, half-tracks, 6-pounder and MGs. Arnhem's own
  German AT kit (`3German_ATPanzerfaust100`) holds the Panzerfaust 100. Fired
  level at a JagdPanther 60 m off, the round flies 27 m in 0.4 s and falls
  0.84 m into the floor; a second, a little higher, 52 m in 0.8 s, falling
  4.3 m. That is the lesson the owner asked for: it is a lob, not a shot. The
  zone reads "JagdPanther 150mm: 70 hp head-on, 2 to destroy" (FHSW labels
  its armour by thickness). The landing marker then reads 64 m at 3.6
  degrees, 130 m at 9.6 and 197 m at 15.7. A K98 round fired at 15.7 degrees
  runs out its fuse at 933 m, 1.3 s.
- FHSW's `ArtyEffectPCOMortar8cm` (a pad's body with no mesh) was parked as a
  vehicle; anything that draws nothing is now left out (`drawsMesh`).
- `tests/test_proving_ground.py` (32 tests, node harness): templates, layout,
  report, the abandon clock, floor lattice, scene, the landing point against
  closed forms, the hit bands, the names, the catalogue and the address.

## Open

- Mods other than vanilla and FHSW are untested in the page.
- The landing marker for a one-shot launcher is checked against one round
  only: the kit holds one Panzerfaust, so the second shot to compare with
  needs a respawn.
- Ships: no water, so they are left out. A lake strip at the far side would
  let a destroyer's guns be tried.
- The landing point leaves out a rocket's motor and drag. The drawn path of
  the last round is the truth.
- Hit zones price head-on hits. The angle term is on the tag of a real hit
  only.
- Soldiers as static targets (dummies that do not fire back) would need a bot
  that holds still. Today the choice is none, or bots that fight.
- Changing battle or side means going back to the tab: Escape, then the menu.
