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

Second pass (2026-11-06, the owner's notes on the first): the bots fought
back, and they must not hurt anyone here; the vehicles were all parked but
not easy to get at, and the brief was the Matrix's construct, racks of
everything to try against everything, a faction first and then a kit; the
tag that popped up on a vehicle at every hit was obnoxious, and belongs in a
pane on the right that lists each thing hit and where; and the collision
mesh's toggle was a key nobody could find. All four are in: "Harmless",
"The arsenal", "The hit log" and the mesh button below. Third pass, the same
day: a hit should show the model with the hit region on it, and getting
about the range meant walking or driving. "The hit card" and "Stations".


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
| Stations | the player's own locked points at 50, 90 and 240 m down range, 4 spawns each, so the spawn map offers them (`PG.STATIONS`) |
| Far end | the enemy's base at 600 m, locked, 12 spawns |
| Silhouette range | plywood men on posts at 25 to 500 m down a lane 90 m right of the centre, named TOTO and FUCKFACE in turn on their boards (The Pacific's recruits), with a spawn point of their own at the line (`proving-targets.js`) |
| Enemy airfield | the battle's aircraft again at the far end, the enemy's, nose toward the line: the enemy's soldiers are put in them and fly; a pad stands one again six seconds after it falls |

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
they fire. Tickets are 999 and never bleed, so the round does not end.

### Harmless

The bots shoot blanks. Their rays still fire, flash, sound and fly past
(`passing-rounds.js`), but map.html's `damageTarget` hook returns true for the
local player before billing him when `PROVING` is set, and the page's
`guns.onImpact` prices a round only when `provingLocalRound(record.firerGroup)`
says it is the player's (his hand weapon's group, or a seat he holds). That
second gate covers everything a bot flies through the guns rather than casts
as a ray: a rocket launcher's round, a grenade, a tank a bot has boarded, and
their splash. The player's own rounds are priced as ever, including on
himself. Nothing changes for the bots' side of the ledger: a bot the player
shoots still dies.

### The instruments (`viewer/proving-ground-page.js`)

- **Paths and the hit log.** Every round of the player's (`isLocalGroup`: the
  hand weapon's group or a seat he holds) is found new on `guns.projectiles` /
  `guns.tracers`, sampled every frame into a line, and finished by
  `guns.onImpact` (chained after the page's own pricing). Where it stops, a
  small dot and a row in the hit log, the pane on the right under the
  minimap, newest first (`logRow`): what it met and where (the vehicle and
  the face, or the soldier and the bone), the hit points taken and what is
  left, the angle's share, the range, the flight time and the fall below the
  launch line. A round that leaves the lists with no impact ran out its fuse
  in the air, and its row says so: that is the weapon's reach, measured. A
  round that met the floor says "floor" and how far it fell, which is the
  Panzerfaust's lesson. Rows that hurt something are red, the floor and the
  fuse muted. There is no text in the world any more: the first pass hung a
  tag sprite at every impact point, and on a vehicle at 25 m it covered the
  target.
- **The hit card.** A hit on a vehicle draws it at the top of the log: the
  hull's collision parts, copied once per hull into the hull's own frame
  (`cardModelFor`), in a second small WebGL scene on the card's canvas
  (`cardRenderer`, made the first time it is needed). Every part is coloured
  by the band this round's attacker material puts it in (`headOn`, the same
  price as the collision mesh's), the struck part is the one of the impact's
  material nearest the point and glows red, a dot marks the point and a line
  the round's last metres in (the trace's last sample to the stop). The camera
  stands on the round's side, a little above, looking at the hull's middle,
  and swings slowly so the model reads as a solid. Under it: the part, the
  cost and what is left, and the weakest part for this weapon
  (`weakestPart`), which is the intelligence asked for: "Weakest for this
  weapon: rear armour, 1 hit". A soldier hit shows its words only.
- **Spawn anywhere.** The owner, after the first teleport pass: "I can
  still only spawn at the one location". The spawn screen's map had one
  point of his, and the keys were not where he looked. The range's stations
  are now spawn points of his own on that map (`Range50`, `Range90`,
  `Range240`: locked, his team, spawn groups 10 to 12), as well as the
  arsenal's STAND AT and X below.
- **Straight in.** The owner again: choosing a spawn and then opening the
  map to move was two steps too many, and the firing range's point could
  not be told from the line's on the map. So: the PROVING GROUND tab has
  START AT (firing line, firing range, 10 m short of the targets, the far
  targets, `START_POINTS`), carried as `?spawn=<point>`, and map.html's
  `SPAWN_AT` watcher accepts the briefing the moment it is up, selects that
  point on the spawn screen and commits it (`selectDeployFlag`,
  `deploySpawn`), so the man is standing there as the level comes in; ON THE
  RANGE does the same at the line, into its machine. And the map art names
  its places now (FIRING LINE, FIRING RANGE, GARAGE, AIRFIELD, the stations,
  TARGETS, ENEMY AIRFIELD, FAR END: `provingGroundMinimap`), so the spawn
  screen's rings and the big map read without a legend.
- **Paths off (T).** On the firing line the dots of the last rounds sat
  between the shooter and the plywood, and the follow-up shots were hard to
  see past them. T, or PATHS on the log's head and the arsenal's foot, puts
  the paths and dots away (remembered in `localStorage`); the log and the
  spotter keep working off the same traces, and the spotter's look keeps
  the last round's dot either way.
- **Getting about, comically simple.** The owner, once the stations were in:
  the planes sit on the flank and take a minute to reach; moving about must
  be comically simple. So: M. On the proving ground the map key opens the
  big map with the pointer free (`page-input.js` `mapKey` asks `mapPicks`)
  instead of growing the HUD widget under a captured one, and a click on the
  art stands the man there (`map-surfaces.js` `artToWorld`, the inverse of
  the minimap's `worldToImage`, into `teleportTo`) and closes the map. The
  arsenal's vehicle column is now headed STRAIGHT INTO THE SEAT, because it
  always was: a click on the Spitfire there is the seat, no walk.
- **The silhouettes.** The owner asked for a training field with targets at
  various ranges that fall when shot, named for The Pacific's boot-camp
  scene. `proving-targets.js` hangs nine plywood men (`silhouetteTargets`:
  an E-type outline drawn on a canvas, rings on the chest, on a half-metre
  post) at 25, 50, 75, 100, 150, 200, 300, 400 and 500 m down a lane 90 m
  right of the centre, each with a board naming it TOTO or FUCKFACE in turn
  and its range. They are the page's, not the world's: a round's step from
  one sample to the next is tested against each standing man's upright
  rectangle (`segmentHit`), and the first it crosses is knocked (it stands
  for 0.9 s so the spotter's look finds the dot on it, then the hinge turns
  it flat in a quarter second, it lies four seconds and rises in half a
  second, `knockState`), the path ends there with a dot, and the log
  says "TOTO · 100 m · down". The round itself flies on into the floor. The
  lane has its own spawn point (Silhouettes, group 13) and station.
- **The kit bench.** The owner, of the firing range: a table or something
  to pick kits up from. A plank table stands a step behind the range's
  firing point (`BENCH`, `benchSlots`), and on it every kit of both sides,
  each laid the way an ObjectSpawner lays a kit (`kit-drops-page.js`
  `placeKit`: the game's own pickup bag, no clock on it). Walk up and take
  one with the pickup key, and the kit you wore lies where you stood, as it
  does in the game; a slot taken is laid again within a couple of seconds
  (`stockBench`, each lay its own object id), so the table is never bare.
  First laid 0.48 m apart, which the owner found "so close to each other":
  a kit bag is over a metre long, so they are 1.6 m apart now on a table 15
  m long, and on the proving ground the pickup key takes the kit under the
  crosshair within 3.5 m first (`kit-drops-page.js` `pickupAimed`, a ray
  from the view's centre at the kit meshes), falling back to the game's own
  nearest-at-the-feet (`pickup`), which could not tell ten kits apart.
- **The spotter.** The owner: when firing down the range, a zoomed look at
  the target to show how close you were. After a round lands, a frame at
  the bottom of the view shows a second look at what it landed on: the
  page's own renderer draws the world again into the frame's rectangle
  (`renderInset`, a scissored render after the main one and the arms, with
  the depth cleared), from a few metres in front of the mark on the
  shooter's side, so the impact dot sits on the plywood or the hull. The
  label says what and how far off: a silhouette by its rings ("TOTO 100 m ·
  31 cm right · 12 cm high", `spotWords`, right being +x for a man facing
  down the range), a hull by its part and the cost, and a round on the floor
  within 12 m of a mark by how far it missed ("missed by 1.3 m right · 60 cm
  short", `missWords`). It holds four and a half seconds and fades.
- **Stations and X.** The arsenal's first rack also has STAND AT: so many
  metres short of the first target row down the lane's centre (10 to 400,
  the firing line among them) and the far end looking back (`standStations`,
  nothing past the floor's edge). X stands the man where the crosshair
  points: the floor there, or 2.5 m short of a hull there (`aimPoint`, the
  rangefinder's ray). Both go through `teleportTo`: out of a seat first, then
  `soldier.spawn` on the floor with his heading kept.
- **The arsenal (B).** A dialog over the view: FACTION, then KIT, and
  VEHICLE beside them. The factions are the battle's two sides from
  `_shared/loadouts.json` (`arsenalFactions`: `levels[dir][team].slots` in
  row order, each kit's `kitName.text`, class and the items it carries, the
  primary bold, a `Random*` entry marked as rolled; the side's nation from
  its kits' `nation`, else the page's `teamNation`). A kit is put in the
  man's hands at once through `equipKit`, the kit-pickup path
  (`hand-weapon.js`): no spawn, and the other faction's kit is carried the
  way a dropped enemy kit is, the player staying on his side. A vehicle is
  one of the garage's or the airfield's (`userData.provingGround`): the man
  is stood beside it (`soldier.spawn`, the firing line's side of its bounds),
  the nearest door found (`spawnSeat`, the human's 3 m reach, then the 15 m
  one) and taken (`enterVehicle`). Either pick first leaves a seat he holds
  (`exitSeat`), and runs on the frame he is on foot again (`queued`). The
  dialog releases the pointer lock and takes it back on close; its search
  box holds the keyboard (`uiFocused`), and its own keydown stops at the
  dialog, so Enter picks the first match instead of opening the spawn menu.
  B's own keypress would land in the box, so the box is cleared a tick after
  it opens.
- **The collision mesh (H).** Each vehicle's collision meshes are copied,
  coloured by how many head-on hits of the weapon in hand destroy the
  vehicle. The price is `materialDamage(att) x damageMod(attGroup, defGroup)`
  from `damage.json`, the same terms `round-impact.js` prices a hit with.
  Bands: 1, 2, 3-4, 5-9, 10+, none. The part under the crosshair is named in
  the readout. Faces are named by vanilla's tank convention (50 rear, 51
  side, 52 front, features/bf1942-3d-models), else by armour range. The
  toggle is a button with a lamp on the hit log's head and on the arsenal's
  foot, as well as the key, so it can be found.
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
- OPTIONS > CONTROLS, the preview (`controls-preview.js`,
  `controls-screen.js`). First pass: TRY IT FULL SCREEN launched the proving
  ground on the battle fielding the previewed machine. The owner's note
  (2026-11-06, the third pass): the button should just go full screen with
  the soldier view, the soldier should wear a kit, and changing faction and
  kit to try the weapons should be easy, all inside the same minimal
  interface. So now:
  - **FULL SCREEN** puts the preview's own box (`controls-preview-box`: the
    canvas, the kit bar and the button) into the browser's full screen
    (`requestFullscreen`), sized to the window by `placePreview` on
    `fullscreenchange`; the keys keep driving the figure, Escape or the
    button comes back. A host that refuses the request, grants it and does
    nothing, or never answers (the desktop app's browser pane did the last)
    gets the box filling the window instead, over everything, and Escape
    brings it back the same way. The front end passes `fullScreen: true`;
    the in-game Escape menu's copy of the screen has no button, as before.
    Nothing is loaded: it is the same scene, bigger. The keys: the front end
    hands the OPTIONS screen its keys through the menu canvas's own
    listeners, so the first full screen took every input away the moment the
    button was clicked (the owner saw the soldier and could do nothing with
    him). The preview box is focusable now, listens for the keys itself, and
    takes the focus whenever it goes full screen, a select has been used, or
    its view is clicked. Checked in the pane:
    the filled window, the US rifleman in his helmet with the BAR, FACTION
    set to German re-dresses him as the Afrika Korps anti-tank man with the
    Panzerschreck, helmet and hip pack (`worn: 2`).
  - **A kit on him.** The soldier is dressed from `models/kits.json`
    (extract_kits.py): the kit's worn parts (helmet, packs) grafted onto his
    bones through `kit-graft.js` `wornGrafts`, the way the kit inspector and
    the seated occupant wear them, and in his hands the kit's primary where
    the pose matrix has that pair, else the first of its items it has
    (`pickPosedPair`). The first kit is the American Assault (`KIT_PICKS`),
    else the first kit any pair is posed for; a tree with no `kits.json`
    falls back to the bare US rifleman as before.
  - **The kit bar.** Two selects on the preview's top-left corner, FACTION
    (the nations of `kits.json`, a theatre as its own wardrobe, the Axis
    first: `kitFactions`) and KIT (that faction's kits, each with its
    primary). Shown on the soldier tabs (COMMON and INFANTRY), hidden on AIR
    and LAND & SEA. A change re-poses and re-dresses the figure
    (`preview.setKit`); the selects blur after, so the keys go back to the
    rows and the figure. The screen's `state.kitBar` and
    `state.preview.kit/soldier/weapon/worn` say what is shown.
  - **COMMON moves him too.** The owner's fourth note: on COMMON the soldier
    stood still, because that tab's map has no walk, crouch or fire. There
    the screen probes the infantry map as well (`mergeProbes`), so W, A, S,
    D, crouch, prone, jump and fire drive him as on INFANTRY, and COMMON's
    own camera keys do what they do in the game: F9 INSIDE (close over his
    shoulder), F10 CHASE REAR (the default), F11 CHASE FRONT, F12 FLY BY (a
    slow circle), C stepping through them (`cameraModeFrom`,
    `soldierCamera`). The camera glides between views. Checked in the pane:
    on COMMON, W runs him, F11 cuts to CHASE FRONT and C steps to FLY BY; on
    AIR the Spitfire comes up and W raises its throttle; on LAND & SEA the
    Sherman comes up and D turns it. (While the kit code was being split
    out, the vehicle table went with it for a few minutes and every tab
    showed the soldier; the owner saw that, and it is back where it was.)
  - **ON THE RANGE.** The owner's fifth note asked to fly the plane in full
    screen, with an enemy plane to shoot down that comes straight back, and
    things to bomb. That is the proving ground's job, not the preview's (the
    preview has no world), so the button is back beside FULL SCREEN, on every
    tab, as ON THE RANGE: `launchFor(kind, { vehicle })` opens the construct
    on the battle that fields the machine the preview shows, with
    `?vehicle=<template>`, which seats the man in it the first time he
    stands (`proving-ground-page.js`, `wantVehicle`), and for AIR with two
    enemy soldiers, who are put in the enemy airfield's aircraft and fly
    (below). The targets down range are the things to bomb; the pads stand
    everything again in six seconds.
  - **The machine itself.** On AIR and LAND & SEA the bar is one select,
    the tab's machines from `models.json` (`tabVehicles`: AIR its 14
    aircraft, LAND & SEA its tanks), kept per tab; a change reloads the
    stage (`setVehicle`). The first list offered every land row, gun and
    ship, and the owner found the towed guns and radar towers silly driven
    about, so LAND & SEA is tanks only: `isTank` keeps a land row with a
    main gun (a GunBarrel or Cannon) on a hull of twenty parts or more and
    none of the names of what stands still, which on vanilla is the Sherman,
    Chi-ha, Panzer IV, M10, Tiger, T34, T34-85 and the Priest, Sexton and
    Wespe on their tank chassis.
  - **Fire from the muzzle.** The guns on stage, the soldier's or the
    machine's, are every FireArms node the glb bakes with its Muzzle nodes
    (`collectGuns`): a pose glb carries the weapon's own `HandFireArms`, so
    the rifle's flash and tracer now leave its barrel wherever the stance
    and gait put it, instead of a light flickering at a guessed point. A
    bullet draws a tracer, a shell (the Sherman's 75 mm, which drew nothing
    before) a heavier, slower round, a bomb a body that falls off its rack.
    The Sherman's own guns are the driver's (`control` Sherman): the 75 on
    FIRE and the coaxial on the alternate fire; the hull Browning is the
    other seat's and stays quiet.
  - **The right button.** In full screen the box takes the clicks, and it
    now tracks the mouse the way the menu canvas does over its frame: MOUSE
    1 and MOUSE 2 reach the probe (the plane's bombs and the Sherman's
    coaxial on the alternate fire), the browser's menu is blocked, and on a
    rifle with nothing on the alternate fire it is the zoom: the camera
    comes in over his shoulder while it is held.

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
- `tests/test_proving_ground.py` (45 tests, node harness): templates, layout,
  report, the abandon clock, floor lattice, scene, the landing point against
  closed forms, the hit bands, the names, the catalogue, the address, the
  arsenal's racks, the hit log's words, the stations and the weakest part.
- Second pass, Aberdeen in the page: B opens the arsenal with GERMAN and
  BRITISH, the British kits (Scout, Assault, Anti-tank, Medic, Engineer) and
  eighteen parked machines. GERMAN then ANTI-TANK puts the Panzerschreck in
  hand without a spawn. One round fired level writes "floor · Panzershreck ·
  54 m · 1.07 s · fell 1.6 m" in the log. H lights the button's lamp and
  colours 596 collision parts. "sherman" in the search and Enter puts the
  man in the Sherman's driver's seat.

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
- Soldiers as static targets (dummies) would need a bot that holds still.
  Today the choice is none, or bots that walk and shoot blanks.
- Changing battle or side means going back to the tab: Escape, then the menu.
  The arsenal changes the kit, not the side.
- The arsenal's racks are text. The kits' and weapons' icons are in the HUD
  pack (`kitIcon.icon`, `weaponIcons`), drawn on canvas by the spawn screen;
  the dialog could draw them too.
