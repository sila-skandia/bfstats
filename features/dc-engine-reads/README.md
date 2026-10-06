# Three Desert Combat words, read before building

Status: `blastAmmoCount` built (2026-10-06); the stabilization words need
nothing; `hasCollisionPhysics` built for everything but vehicles, guns and
projectiles, which keep the old rule (section 3).

Package H of the Desert Combat sweep's word census
(`~/.cache/dc-sweep/reports/adv-conwords.md`, findings CW6, CW7 and CW14).
Each word had two plausible readings that differ in what a player sees, so
each was read in the Linux server (`bf1942_lnxded.static`, symbols) and the
client (`BF1942.exe`) before any code. The engine side is in the ledger:
BOMB-4 (corrected), BOMB-13, CON-17, GUN-17 and COL-16..COL-18. The `set`/`get`
strip it relies on is CON-15, recorded by the `con-reader` package.

Two console rules the reads turned up apply to every word, not just these:

- **A `set` or `get` prefix names the same word** (CON-15, con-reader's row).
  `ObjectTemplate.setBlastAmmoCount` is `blastAmmoCount`;
  `setHasCollisionPhysics` is `hasCollisionPhysics`; `setGeometry` is
  `geometry`. The census's CW1 (`setGeometry` meshes missing on the AH-64,
  Mi-24 and AV-8) rests on this.
- **A `bool` argument is `0` or `1`** (CON-17). The server's libstdc++ reads
  `istream >> bool` as an integer and stores it only when it is 0 or 1;
  anything else sets failbit, and the setter then writes whatever that word's
  static argument held from its last good read in the process. `con.py`'s
  `truthy()` calls every non-zero true, which is wrong for 2 and up. The new
  `con.engine_bool()` is the engine's rule; nothing else was switched to it in
  this package.

## 1. `blastAmmoCount`: a salvo that costs one round (BOMB-13)

CW6 asked whether DC's `setBlastAmmoCount 5` on the A-10's GAU-8 means five
rounds used per pull (the 1,350-round drum lasts 13.5 s) or five projectiles
per pull (five times the damage). **Neither.** The word is a bool at
`FireArmsTemplate+0x348`, the flag BOMB-4 had guessed as `fireAllAtOnce`:

- A FireArms with more than one `addFireArmsPosition` barrel and no
  `asynchronyFire` fires every barrel on a pull and is charged one round per
  barrel (BOMB-1), and on its last rounds fires only as many barrels as it has
  rounds (BOMB-5).
- With `blastAmmoCount` set, that salvo is charged **one** round and always
  fires in full.
- On one barrel, or under `asynchronyFire`, the flag is never consulted.

Desert Combat's `5` (A-10 `A10Guns`, SU-25 `SU-25Guns`, `Minigun`) and `2`
(SA-342 `SA342LFFARFirearms_L/_R`) fail the bool read, and every one sits on a
gun that fires no salvo: the A-10 and SU-25 guns have one barrel ("Tan removed
doublegun"), the Minigun none, the SA-342 rocket pods are `setAsynchronyFire
1`. The comment beside the A-10's line, "to make it look like more is being
fired than really is", describes an intent the engine never carried out. So
the A-10 fires one round a pull, 1,350 pulls to a drum, as before.

The word does matter where it is a 1: the shotguns (XPack2's `Shotgun`, DC's
`Remington` and `Saiga12k`, five or eight pellets for one shell) and 111 of
FHSW's canister and shrapnel shells, 20 to 155 barrels each, which without it
would empty a magazine in a pull. Census: `features/bf1942-engine-reference/surveys/blast_ammo_count.py`.

**Built:**

- `bf42/con.py`: `blast_ammo_count`, both spellings, read with
  `engine_bool` (a refused value leaves it None).
- `bf42/assemble.py`: `blastAmmoCount` in the firing extras.
- `viewer/bomb-release.js` `salvo({blastAmmoCount})`, passed by
  `viewer/gunfire.js` `fireShot`; `viewer/fire-state.js`'s charge already takes
  the count `salvo` returns. `sim/stage.mjs` counts a blast salvo's projectiles
  as its barrels.

**Checked:** `tests/test_bomb_release.py` (BOMB-13 group) drives the real
`gunfire.js`: the Remington's eight-round tube is eight pulls of eight pellets
(without the word, one pull of eight empties it); the last round still fires
all eight; one barrel and the SA-342 pods are unchanged; the A-10's drum is
1,350 pulls of one round, first overheating after 146 and dry in 106.4 s on the
30 Hz tick. `tests/test_dc_engine_reads.py` covers the parse and the export.

**Open:**

- The hand path (`viewer/hand-fire.js`, owned by the hand-weapons package)
  charges `hw.rounds - 1` per pull whatever `salvo` says and gives `gunfire.js`
  no `roundsLeft`. That is right for every shotgun above (they declare the
  word) but wrong for the multi-barrel hand weapons that do not: FH 36, FHSW
  73, bf1918 20, FinnWars 2. `HandFireArms` overrides neither `Fire` nor
  `fireFinished`, so they pay one round per barrel in retail. The fix is two
  lines in `hand-fire.js`: charge the `rounds` argument of `onShot`, and have
  `guns.roundsLeft` answer `hw.rounds` for the hand weapon's group.
- `viewer/replay-hud.js` (owned by the replay session) works out a pull's
  rounds itself and does not know the word.
- No asset job is needed for vanilla or DC to behave: the only DC values are
  refused, and every shotgun already fired one shell a pull through the hand
  path. A model re-extract of the shotguns and FHSW's canister guns carries the
  flag into their glbs (section 4).

## 2. `automaticYaw/PitchStabilization`: stored, never read (GUN-17)

CW7 asked whether DC's Humvee, DPV, BRDM-2, EE-9, M1A1/M-109 MG and MH-53
gunners hold their world heading while the hull turns. **They do not.** Both
binaries parse the two words into the RotationalBundle template (`+0x1a5` and
`+0x1a6` on the server, `+0x255`/`+0x256` on the client) and the server prints
them back in `makeScript`, and that is all: no servo, state, input or network
code reads either byte (the image-wide operand scan is in the ledger row). A
"stabilized" gun is a plain bundle whose angle is relative to its parent, so it
turns with the hull.

**Built:** nothing, on purpose. The viewer's rig already composes a bundle's
angle under its hull (`turret-rig.js`), and the words stay unexported.
`tests/test_dc_engine_reads.py` (`StabilizationTests`) pins that nothing is
exported for them.

## 3. `hasCollisionPhysics`: which hulls the engine tests (COL-16..COL-18)

CW14 found that the exporter attached every StandardMesh hull whatever its
object said, and gated only trees (TM-5), and asked what `hasCollisionPhysics
0` does on an ordinary mesh. The read (COL-16..COL-18):

- The word sets bit 1 of the template's `+0x70`; the object's constructor turns
  it into object flag `0x200`, and nothing else ever does. The template default
  is **off** (a projectile's constructor is the one exception: it sets it).
- The broadphase finds a **root** only when it carries `0x200`, so a root that
  does not say 1 is not there for anything that moves, rounds included, and
  nothing under it collides.
- A root that says 1 is tested with its own mesh or, having none, its **LOD-0
  mesh**: its first child's first alternative when that child is a LodObject,
  else the first `DistCompareSelector` LodObject found depth-first. That
  borrowed mesh collides whatever its own template says. This is how every
  house in the game collides: `afr_house1_ste_m1` is a geometry-less `Bundle`
  saying 1, and its mesh is on `afr_house1_steInterior`, which says nothing.
- Every other part is tested only when it says 1 itself, and a LodObject only
  at its first alternative, whichever is drawn.

So CW14's examples mostly turn out the other way round. Sea Rigs' helipad and
its `rig_interior_group*a` groups keep their collision: they are the lent LOD-0
mesh of a root that says 1, which a naive "the part must say 1" gate would have
removed. The `*b`/`*c` interior groups, Basrah's Edge's market-building addons
and its wires do say 0, but their meshes carry no collision layer, so there was
nothing to remove. The Pantsyr's parts sit on a vehicle (below).

**Built** (`bf42/assemble.py`): `collision_scope_for(library, root)` works out
an engine root's rule (`CollisionScope`: whether the root says 1, and which
template lends it its mesh, `lent_lod_template`); `build_node` computes it for
every root it is handed (a level placement, a model export, the object a
spawner holds) and passes it down; `_object_emits_geometry_collision` and
`_collision_only_node` apply it; under a scope a LodObject contributes only its
first alternative's hulls (`_NEVER_TESTED` for the others). A
PlayerControlObject and a projectile, and everything inside one, keep the rule
the exporter always had (`keeps_old_collision_rule`).

**Checked:** `tests/test_dc_engine_reads.py` (`CollisionGateTests`) assembles
walls that say 1, 0 and nothing, a house shaped like `afr_house1_ste`, a
barracks whose far mesh has the bigger hull, a kit rack, a bundle that says 0
over a part that says 1, a crate holding a mine and a jeep, and checks which
hulls ship. `CollisionHarnessTests` hands the exporter's answer for three walls
to `collision_harness.mjs`: a round and a soldier-sized sphere pass the wall
that says 0 and the one that says nothing, and stop at the one that says 1.

**A real bake agrees.** El Alamein baked into scratch with both spellings read
(a wrapper that stands in for con-reader) has 1,377 collision nodes against the
published `scene.glb`'s 1,381, and the four it lacks are the hospital's and the
supply hut's roof lamps, nothing else. The same bake with `con.py` as it is
here has 1,321: 22 ammo boxes, 9 medic lockers, 6 crates, 4 lockers, 4 mess
tables, 2 aircraft engines, the interiors of two supply huts and two hangars,
and all five flag bases, every one of which says 1 the bare way (the merge
guard below). Basrah's Edge, baked the same way, goes from 902 collision nodes
to 828: the 55 fenceposts and 4 treepots that say 0, and the 15 weapons and
helmets in its armory racks, exactly what the census predicts.

**Blast radius**, measured per level with each level's own library (level
scripts first, as a bake reads them), both spellings read, over every placed
static and mode static, by walking each one the way the old build and the new
one do (`~/.cache/dc-sweep/engine-reads/hcp_level_census.py`). A hull that
"stops colliding" is one the old build shipped and the engine never tests:

| Tree | Levels changed | Roots | Placements | What stops colliding |
|---|---|---|---|---|
| vanilla | 12 of 23 | 2 | 43 | `landrep1_supply`'s `rooflamp1_m1` (x31); `hospital_m1`'s `rooflamp1_m1` (x12) |
| XPack1 | 2 of 6 | 1 | 6 | `landrep1_supply_it`'s `rooflamp1_m1` (x6) |
| XPack2 | 6 of 9 | 3 | 14 | `landrep1_supply`'s `rooflamp1_m1` (x9); `hospital_m1`'s `rooflamp1_m1` (x4); `Mimo_Railroad_M1` (says 0, x1) |
| Desert Combat | 24 of 35 | 11 | 146 | `DC_slums_fencepost1_m1` (says 0, x55, Basrah's Edge); `rooflamp1_m1` on `landrep1_supply` (x43) and `hospital_m1` (x22); `mil_barracks_m1`'s `mil_barracksExterior` (x10: the far mesh's hull, which the old export shipped beside the near one's; the barracks still collide, with the near mesh); `DC_sidewalk_treepot1_m1` (says 0, x4); `mil_scud_cart_m1`'s `mil_scud_cart_missile` (x4); the weapons and helmets displayed in the `Armory_*` kit racks (x7); `Mi24DWreck` (says nothing, x1, Operation Bragg) |
| DC Final | 37 of 48 | 13 | 194 | the same kinds: `DC_slums_fencepost1_m1` (x55), `rooflamp1_m1` on four supply and hospital buildings (x81), `mil_barracks_m1`'s far mesh (x15), the `Armory_*` racks' weapons (x34), the treepots (x4), the Scud cart's missile (x4), `Mi24DWreck` (x1) |

Nothing a player stands on or hides behind in vanilla moves: a roof lamp. The
houses, bunkers and hangars all keep the hull they had, through COL-18.

The other installs, out of extraction scope, were measured with a faster
whole-mod census (one library per mod, every level's `Object.create`; a
level's override of a global template is not seen;
`~/.cache/dc-sweep/engine-reads/hcp_mod_census.py`). Their authors use the word
on purpose: FHSW comments out `setHasCollisionPhysics 1` on the church fence's
fence part, and FHSW and bg42 ship meshes named `Bridge_Small_M1nocol`.

| Install | Levels changed | Roots | Placements | Largest |
|---|---|---|---|---|
| FH | 67 of 73 | 219 | 1,572 | debris that says nothing (`lessplank` x291, `concretecrap` x283), `Landscapesmoke1` x209, roof lamps |
| FHSW | 232 of 260 | 511 | 7,677 | the church fence's fence part x2,034, `F_Fern05_M1` x490, smoke, debris, `nocol_Eu_Strtlight_M1` x205, `Bridge_Small_M1nocol` x179 |
| EoD | 198 of 237 | 128 | 7,341 | `F_Fern05_M1` x4,439, the railroad's rail mesh x360, grenade and pack pickups |
| GCMOD | 14 of 30 | 14 | 121 | `tan_grid01` x48 |
| bf1918 | 77 of 133 | 87 | 413 | `BG_Clothesline_m1` x47, `signalpanel_m1` x30, roof lamps |
| Pirates | 4 of 33 | 1 | 60 | `volcanoSmoke01` x60 |
| Interstate | 5 of 13 | 13 | 25 | `pylon` x7 |
| FinnWars | 28 of 70 | 21 | 105 | `signalpanel_m1` x23, `kartta_o` x14 |
| bg42 | 156 of 200 | 74 | 1,062 | `signalpanel_m1` x243, roof lamps x281, `BG_Clothesline_m1` x140, `Bridge_Small_M1nocol` x51 |
| FHSWEurope | 5 of 6 | 12 | 28 | roof lamps, `me262spawnrotator` x6 |

**Depends on the `con-reader` package.** `con.py` parses only the
`setHasCollisionPhysics` spelling; Desert Combat writes the bare
`hasCollisionPhysics` on 1,473 lines, and the console treats both as one word
(CON-15). With this gate and without that spelling, DC objects that say 1 the
bare way would lose their hulls: measured with the `set` spelling only, the
DC tree would lose 18 roots over 899 placements, the `Ammobox` bundles (x489)
and `mediclocker`s (x207) whole, and `landrep1_supply` (x43), the Russian
warehouse `r_ruswh_m1` (x22), both hangars (x13) and two buildings' ladders.
This commit must be merged after con-reader's spelling normalisation, or
together with it, and before any re-bake. `tests/test_dc_engine_reads.py`
`test_the_bare_spelling_reaches_the_word` fails until then, on purpose.

**Open:**

- **Vehicles and guns.** The same rule holds for a PlayerControlObject root: a
  part collides only when it says 1. An earlier, coarser census (first-child
  lending only) found most vanilla vehicles shipping hulls the engine never
  tests: wheels, gun barrels, MGs, cockpit externals, propellers (48 of 55
  vanilla vehicle roots, 129 hulls; Desert Combat's Pantsyr base, launcher and
  radar, the Pickup and Technical windshields and the Ural ramp say 0
  outright). Moving them over touches `vehicle-bodies.js` (a vehicle's body is
  built from its collision nodes), the hull and bullet paths and
  `extract_collision_meshes.py`, so it is its own package with its own
  verification.
- A lent mesh is tested at the root's transform; the export hangs it under the
  alternative's own node. They differ only when the LodObject or the
  alternative carries its own offset.
- The lent template is matched by name, so the same template used elsewhere
  under the same root would be exempted there too.
- `SimpleObject::handleMessage` clears `0x200` on a message when template
  `+0x104` is set (`0x081db9e4`); which word and which message are unread.

## 4. Asset commands

`blastAmmoCount` needs no re-extract to be right in vanilla and DC (section 1).
The collision change is the `scene` layer: a full bake of the levels whose
hulls move, in each tree (`features/level-bake-layers/README.md`), then the
optimise pass that `extract_maps_all.py` runs itself, then the publisher.
**Only after con-reader's spelling change is merged** (section 3). From
`tools/bf1942-models`:

```bash
# vanilla (viewer/maps)
python3 extract_maps_all.py --mod bf1942 --out viewer/maps --levels \
  Aberdeen Battle_of_Britain Battle_of_the_Bulge Bocage El_Alamein Gazala \
  GuadalCanal Iwo_Jima Liberation_of_Caen Midway Tobruk Truk
# Road to Rome
python3 extract_maps_all.py --mod XPack1 --out viewer/maps/mods/xpack1 --levels \
  Santo_Croce salerno
# Secret Weapons
python3 extract_maps_all.py --mod XPack2 --out viewer/maps/mods/xpack2 --levels \
  Eagles_Nest Essen Kbely_Airfield Mimoyecques Raid_on_Agheila Telemark
# Desert Combat
python3 extract_maps_all.py --mod DesertCombat --out viewer/maps/mods/desertcombat --levels \
  Battle_of_the_Bulge Bocage Bocage_Day2 Bocage_Day3 DC_Basrahs_Edge \
  DC_Battle_of_73_Easting DC_DesertShield DC_Medina_Ridge DC_No_Fly_Zone \
  DC_No_Fly_Zone_Day2 DC_Oil_Fields DC_Operation_Bragg DC_Sea_Rigs \
  DC_Urban_Siege DC_Weapon_Bunkers El_Alamein El_Alamein_Day2 \
  El_Alamein_Day3 Gazala GuadalCanal Inshallah_Valley Iwo_Jima Midway Tobruk
# DC Final
python3 extract_maps_all.py --mod DC_Final --out viewer/maps/mods/dc_final --levels \
  Aberdeen Battle_of_Britain Battle_of_the_Bulge Berlin Bocage Bocage_Day2 \
  Bocage_Day3 DC_Al_Nas DC_Al_Nas_Day2 DC_Basrah_Nights DC_Basrahs_Edge \
  DC_Battle_of_73_Easting DC_Coastal_Hammer DC_Cornered DC_DesertShield \
  DC_DustBowl DC_First_Light DC_LostVillage DC_LostVillage_nopara \
  DC_Medina_Ridge DC_No_Fly_Zone DC_No_Fly_Zone_Day2 DC_Oil_Fields \
  DC_Operation_Bragg DC_Sea_Rigs DC_Twin_Rivers DC_Urban_Siege \
  DC_Weapon_Bunkers El_Alamein El_Alamein_Day2 El_Alamein_Day3 Gazala \
  GuadalCanal Iwo_Jima Liberation_of_Caen Midway Tobruk
# then, once per tree
python3 ../../scripts/publish-mesh-delta.py maps
```

A vanilla level's hull change is one roof lamp, so vanilla, XPack1 and XPack2
can wait for the next bake that has another reason to run; Desert Combat's
fenceposts, treepots and barracks are the ones a player meets.

No model tree needs a re-extract for this: vehicles, guns and projectiles keep
their hulls, and the hand weapon and kit models ship none. `collision-meshes.json`
(`extract_collision_meshes.py`, vehicles only) is unchanged.
