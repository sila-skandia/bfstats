# `teamOnVehicle` is a bool, and reading it as a team gave Midway two Japanese fleets

Stream W6-F of the parity round. The owner's report: on Midway the Allied fleet
spawns Japanese ships. It did, on four vanilla levels and in seven other mods.

## The bug

`Conquest/ObjectSpawnTemplates.con` gives a ship spawner both hulls and a flag:

```
ObjectTemplate.create ObjectSpawner carrierSpawner
ObjectTemplate.setObjectTemplate 2 enterprise
ObjectTemplate.setObjectTemplate 1 shokaku
ObjectTemplate.teamOnVehicle 1
```

`ObjectSpawns.con` then gives each *instance* its own side — `Object.setteam 2`
for the American fleet at x ~ 3400, `Object.setteam 1` for the Japanese at
x ~ 700. `parse_spawn_templates` read `teamonvehicle` into
`SpawnTemplate.owner_team` and `spawn_vehicle` let it override the instance:

```python
if spec.owner_team is not None:
    team = spec.owner_team        # forces 1 -- the Japanese hull, for both fleets
```

## What `teamOnVehicle` actually is

A **bool**: does this spawner stamp its own team onto the thing it spawns. It
plays no part in choosing which hull comes out. Four independent readings, all
of the 1.61 Linux dedicated server
(`/home/dylan/projects/public/bf42plus/bf1942_lnxded.static`):

| Evidence | Where | What it shows |
| --- | --- | --- |
| Storage | `ObjectSpawnerTemplate + 0x185` | a single `char`, not an int |
| Declared type | descriptor `0x87a70c0`, type-string pointer written at `0x082a8946` -> `0x086b1e97` = `"bool"` | registered as `bool`, exactly like `holdObject` and `spawnDelayAtStart`; `nrOfObjectToSpawn` is `"int"`, `maxNrOfObjectSpawned` `"U32"`, the delays `"float"` |
| Round-trip | `ObjectSpawnerTemplate::makeScript` `0x08314f70`, ref at `0x0831539f` | emits the literal line `ObjectTemplate.teamOnVehicle 1` (string `0x086e15e0`) with **no value appended** when the byte is non-zero, so the engine can never write anything but `1` |
| Use | `ObjectSpawner::spawnObject` `0x083140a0` | the hull is `map<u32, IObjectTemplate*>::find(this->team)` on the **instance's** team (`ObjectSpawner + 0x134`, set by `ObjectSpawner::setTeam` `0x08313810`); only afterwards, `if (template+0x185)`, does it call the spawned object's `setTeam` with that same team |

Reproduce the type table with
`/tmp/.../W6-F/proptypes.py` (kept in scratch; it is 50 lines of ELF offset
arithmetic over the `mov [descr+0x4c], <type string>` in
`__static_initialization_and_destruction_0`), and the decompilations with
`features/bf1942-engine-reference/lnxded/decompile.sh <out> 'ObjectSpawner'`.

The shipped data says the same thing without any disassembly: sweeping every
level archive of the installed mods, `teamOnVehicle` takes the value **0** on
9,307 spawners. 0 is not a team.

## The survey

One row per (level, mode, spawner), read through the same archive overlay the
extractor uses (`_level_archives_in` + `LevelFiles`).

| Mod | `teamOnVehicle 0` | `1` | `2` |
| --- | --- | --- | --- |
| bf1942 | 33 | 88 | 8 |
| XPack1 | 0 | 16 | 0 |
| XPack2 | 0 | 8 | 7 |
| EoD | 9,274 | 62 | 0 |

Of those, the ones that declare **both** teams' templates — the only ones where
the old override could change a hull: bf1942 33 zeros + 68 ones, XPack2 6 twos,
EoD 8,846 zeros + most of its ones.

Two corrections to the numbers in the stream brief. Vanilla's 33 zeros are all
in **Truk**, so Truk was never affected — `0` failed the old `team in (1, 2)`
guard and no override happened. And vanilla's `teamOnVehicle 2` spawners all
declare a single team, so the `2` value never changed a hull in vanilla either;
XPack2's six are Mimoyecques' `destroyerspawner` and `cruiserspawner`, which
give *both* teams the same hull (`fletcher`, `fletcher2`).

## What changes, per level

Counted by placing every instance of every mode through the old and the new
`spawn_vehicle` and keeping the disagreements (`delta.py` in scratch). Rows are
deduped over modes; the instance count is per placed spawner per mode.

### Vanilla — 4 levels, 12 (level, spawner) pairs, 30 placed instances

| Level | Spawner | instance team | before | after |
| --- | --- | --- | --- | --- |
| GuadalCanal | DestroyerSpawner | 2 | hatsuzuki | fletcher |
| GuadalCanal | DestroyerSpawner2 | 2 | hatsuzuki2 | fletcher2 |
| GuadalCanal | submarineSpawner | 2 | Sub7c | Gato |
| Iwo_Jima | battleshipSpawner | 2 | yamato | princeow |
| Iwo_Jima | carrierSpawner | 2 | shokaku | enterprise |
| Midway | Battleshipspawner | 2 | yamato | princeow |
| Midway | Destroyerspawner | 2 | hatsuzuki | fletcher |
| Midway | Destroyerspawner2 | 2 | hatsuzuki2 | fletcher2 |
| Midway | SubmarineSpawner | 2 | Sub7c | Gato |
| Midway | carrierSpawner | 2 | shokaku | enterprise |
| Omaha_Beach | DestroyerSpawner | 2 | hatsuzuki | fletcher2 |

The five other vanilla levels that carry a both-teams + `teamOnVehicle 1`
spawner do not change, and each for a reason:

- **Battle_of_Britain** — the two halves are the same radar tower.
- **Wake** — `destroyerspawner` is `hatsuzuki`/`hatsuzuki` and
  `carrierspawner` `shokaku`/`shokaku`; the Japanese fleet is both halves.
- **Coral_Sea** — `destroyerspawner` is declared but never placed.
- **Invasion_of_the_Philippines** — only a team-1 instance is placed.
- **Truk** — all 33 of its spawners carry `teamOnVehicle 0`.

### Mods

| Mod | levels | (level, spawner) pairs | placed instances |
| --- | --- | --- | --- |
| FHSW | 118 | 506 | 1,652 |
| bg42 | 45 | 121 | 330 |
| bf1918 | 37 | 112 | 699 |
| FinnWars | 21 | 35 | 118 |
| FH | 14 | 40 | 105 |
| WarFront | 8 | 20 | 53 |
| DC_Final | 5 | 12 | 24 |
| EoD | 5 | 7 | 37 |
| DesertCombat | 4 | 11 | 23 |
| GCMOD | 4 | 4 | 11 |
| bfheroes | 3 | 5 | 26 |
| FHSWEurope | 1 | 1 | 3 |
| XPack1 | 1 | 1 | 4 |
| XPack2 | 0 | 0 | 0 |
| interstate, Pirates | 0 | 0 | 0 |

XPack1's single change is `husky`'s `Destroyerspawner`, hatsuzuki -> fletcher.
EoD's five are Green_Hell (usmortar -> vcmortar), Operation_Forager
(mi4t -> ch-47), Operation_Hastings (mig-17 -> f4usaf, eod_mig-21 ->
eod_skyraider), Run_Through_The_Jungle (m113-x -> m113-y) and Two_Bridges
(mig-17r -> eod_skyraider, mig-17 -> f105).

## The deck spawns were the same bug, one step downstream

Midway's shipped `scene.json` carried a deck spawn at
`[3194.183, 32.437, -2243.676]` with `team: 1` sitting on a ship spawner
instance whose own team is 2. Not a second bug: `_vehicle_soldier_spawn_report`
resolves the pad's hull with `spawn_vehicle`, then reads *that ship's*
`Objects.con` for its `SpawnPoint` children and takes each point's side from its
spawn group. With the wrong hull it read the wrong ship's groups —
`hatsuzuki` owns 70/71/82/83, which `Bf1942/Game/GlobalSpawnGroups.con` binds to
team 1, where `fletcher` owns 68/69/80/81, bound to team 2. Verified by
extracting Midway into a scratch directory after the fix: all 17 American deck
points now read `team: 2` and all 16 Japanese `team: 1`. No separate fix needed.

## The fix

- `tools/bf1942-models/bf42/level.py` — `SpawnTemplate.owner_team: int | None`
  becomes `team_on_vehicle: bool`, parsed as `int(token) != 0`; `spawn_vehicle`
  no longer overrides the instance's team.
- `tools/bf1942-models/extract_map.py` — `spawned_vehicle_templates` no longer
  drops the other team's half for such a spawner. On Midway `sounds.vehicles`
  goes from 16 entries to 21, gaining `fletcher`, `fletcher2`, `enterprise`,
  `princeow` and `Gato` — every American hull had been shipping with no engine
  or gun sound.
- `bf42/roster.py` needed nothing: it already iterates both halves of
  `spec.vehicles`.

Tests: `tests/test_level.py` gains Midway's real spawner block (both fleets) and
a `teamOnVehicle` 0/1/2 case; its old `test_team_picks_the_vehicle` asserted the
bug (`Willy` for a team-1 instance of a `teamOnVehicle 2` spawner) and now
asserts `Kubelwagen`. `tests/test_map_sounds.py`'s
`test_an_owner_team_spawner_contributes_only_its_own_team` likewise encoded the
wrong model and is now
`test_a_team_on_vehicle_spawner_still_contributes_both_teams`.

## Still open

- **The extractor's team-`None` and team-`0` fallback.** `spawn_vehicle` still
  answers `vehicles.get(2) or vehicles.get(1)` for an instance with no
  `Object.setteam`. The engine spawns *nothing* there — `spawnObject`'s
  `map.find(this->team)` misses and it returns `0xffffffff` — so a pad like
  EoD/Green_Hell's `Mortar_spawner` at `Object.setteam 0` is arguably an empty
  pad rather than a team-2 one. Left alone: it is pre-existing behaviour, it
  keeps a node in the scene rather than a hole, and proving the engine's miss
  path needs a live server, not a decompilation.
- **How the console parses `teamOnVehicle 2` into a bool.** The property is a
  bool, so `2` is either truthy or a parse failure leaving it false; the setter
  goes through a generated anonymous-namespace `ConsoleClass` and was not
  chased. UNVERIFIED. It is moot for the data: every `teamOnVehicle 2` spawner
  in the installed mods either declares one team or gives both teams the same
  hull.
- `features/bf1942-3d-models/parity-audit/vehicle-physics.md:609` still names
  the field `owner_team`. Not edited — it belongs to another round.

## Re-extraction owed

Every level in the per-level tables above, in vanilla and in each named mod —
their `scene.json` `objectSpawns`, `vehicleSoldierSpawns` and
`sounds.vehicles` are all wrong today, and the `scene.glb` holds the wrong hull
mesh on those pads.

For vanilla that is:

```
cd tools/bf1942-models
for level in GuadalCanal Iwo_Jima Midway Omaha_Beach; do
  python3 extract_map.py "$level" --mod bf1942 --out <the shared viewer/maps>
done
```

and the same per mod with `--mod XPack1 husky`, `--mod EoD Green_Hell
Operation_Forager Operation_Hastings Run_Through_The_Jungle Two_Bridges`, and
the level lists in `delta_<mod>.json`. Nothing was published and nothing was
written into the shared `viewer/maps` tree from this stream; the scratch
extraction used to verify went to its own `--out`.
