# Forgotten Hope (FH): getting the mod into the viewer, rules first

Status: the rules side is audited and fixed for the six first levels
(2026-10-10). The six levels are baked into
`tools/bf1942-models/viewer/maps/mods/fh/` by the levels agent; the models agent
owns FH's model and kit tree. Nothing here is published.

## The owner's request

* Get FH's maps into the map viewer, **push maps first**: the maps where the game
  system differs from plain Conquest, notably the ones where a captured flag
  cannot be recaptured (Gold Beach).
* The owner will play-test the viewer and send feedback, so the rules have to be
  right before the first test.
* FHSW was built on FH and inherits its levels, so the FH tree is self-contained
  and **FHSW needs no rebuild** for it. The one exception this work found is the
  `spawns` layer of some FHSW levels (see "Changes", FHR-2).
* Install: `~/.wine/drive_c/EA Games/Battlefield 1942/Mods/FH`, tree id `fh`, 80
  level archives. Game rules are read from the **root** `<mode>.con` the server
  runs (ledger TKT-3), not `GameTypes/`.

## The six levels and why each

| Level | The rule it exercises |
|---|---|
| Gold_Beach-1944 | The reference push map: a neutral frontline only the British can take, a permanent beach, German points that take `timeToGetControl 0` |
| Omaha_Charlie-Sector-1944 | A neutral beach flag only the Allies take and need two soldiers for; the Allies spawn only on landing craft that bind their own groups (found a data-reading gap, FHR-2) |
| Road_To_Ramelle | Six German points with `get 0` and `enemyClose 0` on a 5 m radius, one of them `onlyTakeableByTeam 2`; a CoOp-only barn spawn group |
| Tarawa-1943 | Every flag Japanese at the start, one-way `pier`, `minNrToTakeControl 3` on two points, the Allies spawn only on ships |
| Iwo_Jima | A neutral landing beach with 2 s timers that only the Marines take; a root `Ctf.con` and `tdm.con` no menu offers |
| Prokhorovka-1943 | Two `unableToChangeTeam` bases and a third unable point with finite timers (FHR-4), no `onlyTakeableByTeam` anywhere |

## What "no recapture" is in the data

`ControlPoint::handleFrameUpdate` is already ported and verified (AI-100,
AI-115, AI-142; `bot-referee.js controlPointStep`). The only words in it that
make a point final are `onlyTakeableByTeam` (`+0x214`) and a 9999 s timer.
`unableToChangeTeam` does not stop the law: it only makes `setTeam` a no-op
(FHR-4). So the push is the data of each map, and it is narrower than the
phrase suggests:

* `onlyTakeableByTeam N`: every transition of the law (`gettingControl`,
  `gotControl`, `losingControl`, `lostControl`) returns at once for any other
  team. Neutral, only side N can take it; once N owns it nobody can run it down,
  not alone and not against a defender. **That is the one-way ratchet.**
* `timeToGetControl 0` (AI-142): a point is taken on the frame one side alone
  stands on it; it turns a run-down point into a swap.
* `loseControlWhenEnemyClose 0`: a defender inside the radius holds the point
  against any number of attackers (`control(0)` every frame). Without a defender
  the attackers run it down over `timeToLoseControl`.
* `timeToGetControl` / `timeToLoseControl` 9999 with `loseControlWhenEnemyClose
  0`: a base nobody can move in a round.

Spawns follow the point: the flag's group is enabled for its holder, and the
`ObjectSpawner`s with its `objectSpawnerId` take its team (SPAWNGRP-4, SPAWN-22).
Tickets bleed by weight, not by flag count: a side loses tickets while the
**enemy** holds more than 99 `areaValue` (TKT-4, TKT-5), which is what makes a
push a push.

## Per map

Settings below are per placed control point in the Conquest layer (the root
`Conquest.con` runs `Conquest/*`); `get` / `lose` are `timeToGetControl` /
`timeToLoseControl` in seconds, `r` is the radius in metres, `ec` is
`loseControlWhenEnemyClose`, `area` is `areaValue`, `grp` the spawn group. Team 1
is the defender (German or Japanese), team 2 the attacker. The scene.json in
`viewer/maps/mods/fh/` was read back and matches the archive on every field for
Gold Beach and Omaha (and the others by the same exporter).

### Gold_Beach-1944

Tickets 95 (Germans) / 120 (British), bleed 4 / 5 a minute.

| Point | Start | r | get | lose | ec | only | unable | area | grp |
|---|---|---|---|---|---|---|---|---|---|
| beach | 2 | 5 | 9999 | 9999 | 0 | - | yes | 0 | 1 |
| axis_bunkers | 1 | 5 | 0 | 15 | 0 | - | no | 0 | 6 |
| radarbunker | 1 | 6 | 0 | 10 | 0 | - | no | 35 | 5 |
| house | 1 | 6 | 0 | 5 | 0 | - | no | 35 | 4 |
| 2nd_line | 1 | 6 | 0 | 5 | 0 | - | no | 35 | 3 |
| front | 0 | 50 | 10 | 10 | 1 | **2** | no | 25 | 2 |

The only recapture block is `front` (`onlyTakeableByTeam 2`): neutral, the
British take it with 10 s alone on a 50 m radius, and from then on no German
presence can touch it (checked: Germans alone, Germans against a British
defender, nobody). The beach is the British start point and is final by its
9999 s timers (the `unableToChangeTeam` there is cosmetic, FHR-4). The four
German points are **not** one-way: a German on a 5 to 6 m radius holds one
against any number of British, the British alone run it down in 5 to 15 s and
own it the next frame (`get 0`), and the Germans do the same back. Driving the
real scene.json through `controlPointStep` shows exactly that (British alone:
lost at 5.07 s, got at 5.10 s; Germans alone afterwards: lost at 5.07 s, got at
5.10 s). The push is the bleed: the Germans hold 35 + 35 + 35 + 0 = 105 (> 99),
so the British bleed 5 a minute from the first frame until they take one German
point; the Germans bleed 4 a minute only once the British hold more than 99,
which is `front` 25 plus all three 35-point bunkers (130; two give 95). If the
owner means "the Germans cannot take a bunker back", that is not in the data.

Spawn groups: 1 British (5 points) on the beach, 2 (10 points, `groupTeam 0`)
neutral until `front` falls, 3 to 6 German; two landing craft (groups 67 and 74,
from the global file) carry the British.

### Omaha_Charlie-Sector-1944

Tickets 120 (Germans) / 275 (Allies), bleed 8 / 8 a minute.

| Point | Start | r | get | lose | ec | only | min | area | grp / spawner |
|---|---|---|---|---|---|---|---|---|---|
| beach | 0 | 41 | 15 | 99 | 1 | **2** | 2 | 0 | 4 / 4 |
| commandpost | 1 | 23 | 14 | 13 | 1 | - | - | 50 | 2 / 2 |
| german_base | 1 | 24 | 15 | 15 | 1 | - | 2 | 50 | 1 / 1 |
| west_bunker | 1 | 9 | 9 | 9 | 1 | - | - | 25 | -1 / 3 |
| east_bunker | 1 | 8 | 9 | 9 | 1 | - | - | 25 | -1 / 5 |

`beach` is a ratchet like Gold Beach's `front`: neutral, takeable only by team
2, `minNrToTakeControl 2`, 15 s, and no German force can move it afterwards.
Everything else is plain Conquest (`enemyClose 1`, 9 to 15 s), including the two
bunkers, which own no soldier spawn (`spawnGroupId -1`) and still change hands
and carry weight. The Germans hold 150 weight, so the Allies bleed from the first
frame. At the start the Allies have **no flag spawn at all**: group 4 is neutral
and the beach spawn points (11) are unusable until the beach falls. Their round
opens on four-point landing craft (`westallied`, `eastallied`, groups 8 and 9)
whose `Objects.con` binds `groupTeam 2` itself. The exporter did not read that
(FHR-2: a spawn whose group only an object script binds had no side and was
dropped), so the Omaha tree had `vehicleSoldierSpawns: []` and no Allied spawn
at the start. Fixed; the tree's `spawns` layer was re-patched (19 carried points,
groups 5 to 9).

### Road_To_Ramelle

Tickets 100 (Germans) / 175 (Allies), bleed 8 / 6 a minute.

| Point | Start | r | get | lose | ec | only | unable | area |
|---|---|---|---|---|---|---|---|---|
| town_square | 1 | 5 | 0 | 5 | 0 | - | no | 30 |
| alliedbase | 2 | 5 | 9999 | 9999 | 0 | - | yes | 20 |
| the_alamo | 1 | 5 | 0 | 5 | 0 | - | no | 15 |
| ramelle_park | 1 | 5 | 0 | 5 | 0 | - | no | 30 |
| mg_nest | 1 | 7 | 0 | 5 | 0 | **2** | no | 10 |
| out_skirts | 1 | 5 | 0 | 5 | 0 | - | no | 25 |
| rail_yard | 1 | 5 | 0 | 5 | 0 | - | no | 20 |

Same shape as Gold Beach's German points: 5 m radii, instant take, 5 s run-down,
a defender holds. `mg_nest` is the one-way point (an Allied-only flag that
starts German: run down by Allied presence, taken at once, and then final). The
CoOp layer is different (radii 15 to 20, 10 s timers, `ec 0` kept) and adds a
barn spawn group 8 (`OnlyForAI`, `groupEnableToChangeTeam 0`) bound by the
level's `Objects/BarnSpawn`; it is in the CoOp layer only. Weights: Germans 130,
Allies 20 (the Allies bleed 6 a minute from the start).

### Tarawa-1943

Tickets 100 / 100, bleed 5 / 5 a minute. All five flags start Japanese and
none is neutral.

| Point | r | get | lose | ec | only | min | area | grp |
|---|---|---|---|---|---|---|---|---|
| pier | 15 | 10 | 10 | 1 | **2** | - | 20 | 2 |
| the_pocket | 25 | 10 | 10 | 1 | - | 3 | 40 | 3 |
| command_bunker | 5 | 10 | 10 | 1 | - | 3 | 50 | 4 |
| red_beach | 20 | 10 | 10 | 1 | - | - | 30 | 5 |
| beach_red3 | 11 | 10 | 10 | 1 | - | - | 0 | 1 |

`pier` is the ratchet: run down by the Allies (10 s) and then taken (10 s), and
nothing the Japanese do moves it. The other four swap in both directions;
the pocket and the command bunker need three attackers alone. The Allies spawn
on two destroyers and an LCT (groups 68, 69, 80, from the global file); the
Japanese hold 140 weight, the Allies bleed from the first frame.

### Iwo_Jima

Tickets 100 / 100, bleed 30 (Japan) / 5 (Marines) a minute.

| Point | Start | r | get | lose | ec | only | area | grp |
|---|---|---|---|---|---|---|---|---|
| topbase (Mount Suribachi) | 1 | 25 | 10 | 10 | 1 | - | 25 | 1 |
| bigbase (Airfield) | 1 | 25 | 10 | 10 | 1 | - | 25 | 4 |
| bunkers | 1 | 20 | 10 | 10 | 1 | - | 25 | 5 |
| midbase (Suribachi bottom) | 1 | 20 | 10 | 10 | 1 | - | 25 | 12 |
| sandbase (Landing Beach) | 0 | 25 | 2 | 2 | 1 | **2** | 0 | 6 |

The landing beach is taken by the Marines in 2 s and is then final. The four
Japanese points swap normally. Japan holds 100 weight (> 99), so the Marines
bleed from the start; Japan's 30 a minute rate starts only when the Marines hold
100, which is all four. The Marines spawn on `bunker_hill`, an LCT and an LCI(R)
(groups 72, 73, 80, 81). `Ctf.con` and `tdm.con` sit in the root but no
`GameTypes/` file offers them, so the menu never starts them (FHR-5).

### Prokhorovka-1943

Tickets 140 (Germans) / 110 (Russians), bleed 7 / 7 a minute.

| Point | Start | r | get | lose | ec | unable | area |
|---|---|---|---|---|---|---|---|
| 1_st_ss_division_main | 1 | 5 | 9999 | 9999 | 0 | yes | 50 |
| 29_th_tank_corps_main | 2 | 5 | 9999 | 9999 | 1 | yes | 50 |
| 3rd_sstemplate (3rd_ss) | 1 | 20 | 15 | 15 | 1 | yes | 0 |
| 18th_tank_corps (Town_north) | 2 | 20 | 15 | 15 | 1 | no | 10 |
| sawmill | 2 | 20 | 15 | 15 | 1 | no | 20 |
| hill_317 | 2 | 17 | 15 | 15 | 1 | no | 30 |
| 2nd_tank_corps (Farmhouse) | 2 | 20 | 15 | 15 | 1 | no | 10 |
| windmill | 2 | 20 | 10 | 10 | 1 | no | 0 |

No `onlyTakeableByTeam` and no `get 0`: this is ordinary Conquest with two
9999 s mains and one more German point (`3rd_ss`) marked unable but with 15 s
timers. By the binary an unable point still runs the law and only its team is
frozen, so a Russian alone on `3rd_ss` for 15 s switches its German spawn
group off until he leaves (FHR-4); the viewer used to freeze it with its spawns
on. The Russians hold 120 weight and the Germans 50, so the Germans bleed from
the first frame. `GameTypes/Ctf.con` runs a `Ctf/` directory the archive does
not hold (FHR-5).

## Survey of all 80 FH levels

Scripts: `features/bf1942-engine-reference/surveys/fh_mode_rules.py`
(`--levels L ...` per-point dump, `--census`, `--gametypes`).

* Game types offered by `GameTypes/`: Conquest 80, CoOp 68, CTF 20, TDM 17,
  ObjectiveMode 1 (Battle_Of_Britain). 9 root scripts have no `GameTypes/` file
  and are never started; 2 `GameTypes/` files have no root script; 15 `run`
  lines name a layer file the archive lacks (FHR-5).
* Conquest layers: 453 placed control points. `onlyTakeableByTeam` on 26 points
  in 17 levels (one more written `onlyTakableByTeam` in Fall_Gelb, ignored by
  the engine and by the exporter, FHR-6); `timeToGetControl 0` on 52 points in
  13; `minNrToTakeControl > 1` on 38 in 20; `loseControlWhenEnemyClose 0` on 84
  in 31; `unableToChangeTeam` on 112 in 64, 20 of them with finite timers in 14
  levels (FHR-4); `loseControlWhenNotClose` and `disableWhenLosingControl`
  almost unused (`disableIfEnemyInsideRadius` only The_Storm,
  `secondSpawnGroupId` only Battle_Of_Britain); 117 points start neutral in 43
  levels.
* Tickets: 297 `Game.setNumberOfTickets` and 298 `Game.setTicketLostPerMin`
  lines in the mode scripts; none sets a time limit, `setTicketLostAtEndPerMin`,
  `setTicketLosePerDeath`, `defenderLoseTicketsOnDeath` or
  `attackerLoseTicketsOnDeath`; `game.maxNrOfPlayers` only in the
  single-player launch scripts (FHR-7).
* `Game.setActiveCombatArea` in 42 levels (modelled, CA-1..CA-9; origin and
  size, read correctly for Gold Beach and Omaha).
* `Game.setKit`: 800 lines; 729 names start with a slot digit
  (`1German_CloseQuartersMp40`) and resolve as written; 15 names in 6 levels do
  not resolve against the mod library (FHR-8).
* Conditionals other than `v_arg1 == host`: `v_is_coop` in 6 level `Init.con`s
  (Alpenfestung, Cretan_Village, Crete, Desert_Rose, Soletschnogorsk,
  Supercharge) and about 30 object scripts in 10 levels (FHR-3, FHR-9), `v_maxplayers == 2` in four
  single-player skirmish scripts, `v_modname` and `v_playmode` in a few object
  scripts, `v_exists` only inside `rem`.
* Words the server does not register and so ignores: FHR-6.
* Spawn-group bindings in object scripts: 29 scripts in 12 levels (FHR-2).

## Changes made (2026-10-10)

| Change | Where | Ledger | Pinned by |
|---|---|---|---|
| A level's object scripts' `spawnPointManager.group/groupTeam` sit under the mode layer's | `bf42/level.py`, `extract_map.py load_level` | FHR-2 | `tests/test_level.py`; Omaha `scene.json` spawns layer re-patched |
| `v_is_coop` decided as a Conquest host does in object scripts, `Init.con` and kit loadouts | `bf42/con.py`, `bf42/level.py`, `bf42/kit.py` | FHR-3 | `tests/test_coop_conditionals.py` |
| An `unableToChangeTeam` point runs the law with its team frozen and its spawns switched | `viewer/bot-referee.js` | FHR-4 | `tests/test_control_point_law.py` |
| A point with `onlyTakeableByTeam` is not run down by `loseControlWhenNotClose` | `viewer/bot-referee.js` | FHR-1 | `tests/test_control_point_law.py` |
| Gold Beach, Omaha and Tarawa/Iwo/Ramelle push cases as law tests | `tests/control_point_harness.mjs` | AI-100 | `tests/test_control_point_law.py` |

What the other agents must do after this:

* **Models:** FHR-3 changes 69 templates of the FH mod pool (and some level-private
  ones). Re-extract the vehicles and projectiles named in the FHR-3 row (the
  Pak40, the passenger seat families, the carriers' spawners) in the FH tree
  before the glbs are published; everything else is unaffected. The kit
  loadouts were already resolved to the Conquest arm for the six levels
  (none of them tests `v_is_coop`).
* **Levels:** `patch_scene.py --layer spawns --mod FH --all` after any new
  bake with an old checkout (it is a no-op on a fresh one). FHSW's levels that
  bind groups in object scripts move too: `patch_scene.py --layer spawns --mod
  FHSW --all`, then `scripts/publish-mesh-delta.py maps --hash`.

## Open

* Whether the strategic AI treats an `unableToChangeTeam` point as a target
  (`bot-decision.js`, `strategic-layer.js` skip every `uncapturable` flag):
  the server's AI side of `+0x200` was not traced (FHR-4).
* A CoOp round's `v_is_coop` (FHR-9): the shared glb shows the Conquest arm.
* Omaha's landing craft (`westallied`, `eastallied`) are `PlayerControlObject`s
  built on a Sexton; whether the viewer draws and moves them the way retail
  does, and that a soldier can spawn on them, was not looked at.
* The Allies' neutral beach spawn group 4 on Omaha and 2 on Gold Beach: the
  rule (a team-0 group lists under no side until its flag falls, SPAWNGRP-2/3)
  is applied; the owner should confirm the opening feels right.
* The 15 unresolved kit names (FHR-8) are in six levels not yet extracted.

## Status

| Level | Baked | Rules checked against the archive | Notes |
|---|---|---|---|
| Gold_Beach-1944 | yes | control points, groups, tickets, combat area | `front` is the only ratchet |
| Omaha_Charlie-Sector-1944 | yes | same | spawns layer re-patched for FHR-2 |
| Road_To_Ramelle | yes | archive read; scene not re-read field by field | `mg_nest` ratchet |
| Tarawa-1943 | yes | archive read; scene not re-read field by field | `pier` ratchet |
| Iwo_Jima | yes | archive read; scene not re-read field by field | `sounds` layer differs from a fresh patch, not rules |
| Prokhorovka-1943 | yes | archive read; scene not re-read field by field | `3rd_ss` unable with timers |
| Assets (models, kits, poses, effects, deployables) | yes, 2026-10-11 | `audit_mod.py --mod fh` clean (exit 0); render smoke 711 models and 18 level frames, none flagged | 63 orphan worn-part glbs removed, `deployables.json` added; see AUDIT.md |

Published: none. Add the models and levels agents' results to the table above.

## Audit

`tools/bf1942-models/audit_mod.py --mod fh` is the standing check for the simple
defects (missing textures, floating objects, silent vehicles, missing rigs and
icons, data that resolves nowhere) and `audit_render.mjs` the rendered smoke.
Method, how to run, what it found and what it fixed: [AUDIT.md](AUDIT.md).
