Two of the three words turned out to mean something other than either reading on offer, and the third does nothing in retail. All three are read in both binaries, with ledger rows, and built where there was something to build. One thing to act on first: the collision commit must merge after con-reader's spelling change, before any re-bake.

## What the reads found

**`blastAmmoCount`** (CW6, ledger BOMB-13; BOMB-4 corrected)
- It is a bool at `FireArmsTemplate+0x348`. Its setter is at lnxded `0x082d8380`; the client copy is at `+0x544`, setter `0x004d74b0`. It is the flag BOMB-4 had guessed was `fireAllAtOnce`, and that guess is wrong.
- With more than one barrel and no `asynchronyFire`, a pull normally costs one round per barrel. With the flag set it costs one round and every barrel fires, even on the last round (`fireFinished` `0x082884e7`, `Fire` `0x0828a694`).
- It is neither "rounds per pull" nor "projectiles per pull". The argument is read as a bool, which takes only 0 or 1 (ledger CON-16), so DC's `5` and `2` are refused. Every one of those sits on a gun with one barrel or `asynchronyFire`, so the flag never applies. The A-10 stays at 1,350 pulls of one round.
- It does matter where it is a 1: the shotguns (XPack2, DC Remington and Saiga12k) and 111 FHSW canister and shrapnel shells.

**`automaticYaw/PitchStabilization`** (CW7, GUN-17)
- Both binaries store the bytes (`+0x1a5`/`+0x1a6` on the server, `+0x255`/`+0x256` on the client). Nothing reads them except the server's own printout of the template.
- A stabilized gun turns with its hull, which the viewer already does. Nothing was built; a test pins that nothing is exported for them.

**`hasCollisionPhysics`** (CW14, COL-15..17)
- The word becomes object flag `0x200` only in the object's constructor (`0x081da190`), and it defaults off. Projectiles are the exception: their constructor sets it.
- The broadphase needs flag `0x2000200` on a root. So a root that does not say 1 collides with nothing, parts included.
- A root with no mesh of its own borrows its LOD-0 mesh (`findLodGeometry` `0x0818d860`). This is how every house collides: the bundle says 1, the part holding the mesh says nothing.
- Any other part collides only if it says 1 itself, and a LodObject only at its first alternative.
- So CW14's examples mostly don't hold. Sea Rigs' helipad and interior groups keep their collision through the borrowed mesh, and the market addons and wires that say 0 have no collision meshes.

**Two console rules, useful to the con-reader package**
- A `set` or `get` prefix names the same word (CON-15, `0x08359b10`). This settles CW1's open question.
- A bool argument takes only 0 or 1 (CON-16). `con.py`'s `truthy()` treats 2 and above as true, which is wrong.

## What changed

- **`bf42/con.py`**: a new `engine_bool()` and a `blast_ammo_count` field, both spellings.
- **`bf42/assemble.py`**: `blastAmmoCount` in the firing extras. A new collision rule (`collision_scope_for`, `lent_lod_template`) is applied in the build and the hull-only walk. Vehicles, guns and projectiles keep the old rule; vehicles are a separate package because `vehicle-bodies.js` builds bodies from their collision nodes.
- **Viewer and sim**: `salvo()` in `viewer/bomb-release.js` takes `blastAmmoCount`, `viewer/gunfire.js` passes it, and `sim/stage.mjs` counts projectiles right.
- **Docs**: ledger rows BOMB-13, CON-15, CON-16, GUN-17 and COL-15..17, with BOMB-4 and TM-5 corrected. Symbols are recorded. The bombs, manned-guns and collision-response subsystem notes are updated, and there is a new feature folder `features/dc-engine-reads/` with its line in `features/README.md`.

**Commits** (`70d0b6ea..HEAD`): `b9973213` (reads and ledger), `dc3f2531` (blastAmmoCount), `acf5f77c` (collision rule), `eec3fc74` (merge guard), `61734339` (census docs). One slip: the stabilization test went in with the blastAmmoCount commit rather than on its own.

## Tests

- **blastAmmoCount**: the harness drives the real `gunfire.js`. The Remington fires eight pulls of eight pellets from an eight-round tube; without the word one pull empties it. The A-10 fires 1,350 pulls of one round, first overheats at 146 and runs dry in 106.4 s.
- **Collision**: a wall that says 0 or nothing no longer blocks a round or a soldier-sized sphere in `collision_harness.mjs`. Houses keep their borrowed mesh, and DC's barracks keep only the near mesh's hull.
- **Real bakes**: El Alamein baked into scratch with both spellings read loses exactly the 4 roof lamps the census predicted. DC's Basrah's Edge goes from 902 to 828 collision nodes (55 fenceposts, 4 treepots, 15 items in the weapon racks), again matching.
- **Full suite**: 4,616 tests, 1 failure, `test_nav_baked.test_bocage_match_route_failures` (306 against a limit of 100). It fails the same way with main's versions of my files, so it is not mine; I re-ran it after your TMPDIR wipe with the same result.
- **Deliberate failure**: `test_the_bare_spelling_reaches_the_word` fails on purpose, as a merge guard (next section).

## Merge order: collision depends on con-reader

`con.py` reads only `setHasCollisionPhysics`, and DC writes the bare `hasCollisionPhysics` on 1,473 lines. If the collision commit merges without con-reader's spelling change, DC loses 18 roots over 899 placements, including every ammo box (489) and medic locker (207). El Alamein baked with `con.py` as it is drops 60 collision nodes, among them all five flag bases. The guard test fails until the bare spelling is read: merge con-reader first, and bake only once it passes.

## Blast radius and asset commands

The per-level census, with both spellings read, shows what stops colliding:

| Tree | Levels | What stops colliding |
|---|---|---|
| Vanilla | 12 | one roof lamp on two buildings (43 placements) |
| XPack1 | 2 | the same roof lamp (6) |
| XPack2 | 6 | roof lamps, plus Mimoyecques' rail (14) |
| Desert Combat | 24 | 146 placements: Basrah's Edge fenceposts and treepots, the barracks' far-mesh hull, weapons and helmets displayed in the weapon racks, an Mi-24 wreck |
| DC Final | 37 | 194 placements, the same kinds |

A faster whole-mod census of the other installs shows their authors use the word on purpose. FHSW comments out the line on its church-fence parts, and FHSW and bg42 ship meshes named `Bridge_Small_M1nocol`.

Only level bakes are needed; no model tree changes, and `collision-meshes.json` is unchanged. From `tools/bf1942-models`, after con-reader merges:

```bash
python3 extract_maps_all.py --mod bf1942 --out viewer/maps --levels Aberdeen Battle_of_Britain Battle_of_the_Bulge Bocage El_Alamein Gazala GuadalCanal Iwo_Jima Liberation_of_Caen Midway Tobruk Truk
python3 extract_maps_all.py --mod XPack1 --out viewer/maps/mods/xpack1 --levels Santo_Croce salerno
python3 extract_maps_all.py --mod XPack2 --out viewer/maps/mods/xpack2 --levels Eagles_Nest Essen Kbely_Airfield Mimoyecques Raid_on_Agheila Telemark
python3 extract_maps_all.py --mod DesertCombat --out viewer/maps/mods/desertcombat --levels Battle_of_the_Bulge Bocage Bocage_Day2 Bocage_Day3 DC_Basrahs_Edge DC_Battle_of_73_Easting DC_DesertShield DC_Medina_Ridge DC_No_Fly_Zone DC_No_Fly_Zone_Day2 DC_Oil_Fields DC_Operation_Bragg DC_Sea_Rigs DC_Urban_Siege DC_Weapon_Bunkers El_Alamein El_Alamein_Day2 El_Alamein_Day3 Gazala GuadalCanal Inshallah_Valley Iwo_Jima Midway Tobruk
python3 extract_maps_all.py --mod DC_Final --out viewer/maps/mods/dc_final --levels Aberdeen Battle_of_Britain Battle_of_the_Bulge Berlin Bocage Bocage_Day2 Bocage_Day3 DC_Al_Nas DC_Al_Nas_Day2 DC_Basrah_Nights DC_Basrahs_Edge DC_Battle_of_73_Easting DC_Coastal_Hammer DC_Cornered DC_DesertShield DC_DustBowl DC_First_Light DC_LostVillage DC_LostVillage_nopara DC_Medina_Ridge DC_No_Fly_Zone DC_No_Fly_Zone_Day2 DC_Oil_Fields DC_Operation_Bragg DC_Sea_Rigs DC_Twin_Rivers DC_Urban_Siege DC_Weapon_Bunkers El_Alamein El_Alamein_Day2 El_Alamein_Day3 Gazala GuadalCanal Iwo_Jima Liberation_of_Caen Midway Tobruk
python3 ../../scripts/publish-mesh-delta.py maps
```

Vanilla and the expansions only lose a roof lamp, so they can wait for the next bake that has another reason to run.

## Open, and for other packages

- **hand-weapons**: `hand-fire.js` charges one round a pull regardless of what `salvo()` returns, and gives the hand weapon no `roundsLeft`. That is right for every shotgun above, which declare the word, but wrong for multi-barrel hand weapons without it (FH 36, FHSW 73, bf1918 20, FinnWars 2). The fix is two lines.
- **replay session**: `replay-hud.js` works out rounds per pull itself and doesn't know `blastAmmoCount`.
- **Vehicles**: moving vehicle collision onto the same rule is its own package. A coarse census found 48 of 55 vanilla vehicles shipping hulls the engine never tests: wheels, barrels, MGs, cockpit externals.
- **Ledger ID collisions**: sibling branches already use COL-13, COL-14 and GUN-13..16, so I took COL-15..17 and GUN-17. Watch for overlaps at merge.
- **Unread**: what clears flag `0x200` on a message (`0x081db9e4`); the client's MSVCP70 bool read is inferred to follow the same 0-or-1 rule, since it isn't in the image.
- **Parity README rows** for you to update: CW6 → BOMB-13, built; CW7 → GUN-17, nothing to do; CW14 → COL-15..17, built for statics, bakes pending con-reader.
- **Scratch**: large outputs are deleted; scripts and census JSON stay in `~/.cache/dc-sweep/engine-reads/` (14 MB).