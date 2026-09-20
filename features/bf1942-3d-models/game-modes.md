# Game modes

A BF1942 level archive ships **one directory per game mode** it supports, and
the extractor read exactly one of them. `find_gameplay_mode` returned the first
directory that existed — Conquest first, and every stock level ships
`Conquest/` — and `load_gameplay_objects` read only that. The SinglePlayer, Ctf,
Tdm and ObjectiveMode layouts, which have different flags with different
owners, different spawn points and different vehicles, were never opened on any
level in any mod.

This document is the survey that says what is actually in those directories,
the schema that carries them, and what the change costs.

It matters twice over. The site's entry page is the game's Instant Battle
screen (`viewer/play/`), and in the game Instant Battle loads a level's
**SinglePlayer** layout, not its Conquest one. The page launched Conquest for
everything.

---

## 1. The survey

Method: `bf42.level` over every level archive of every installed mod under
`~/.wine/drive_c/EA Games/Battlefield 1942/Mods/`, reading each `<mode>/`
directory and each `GameTypes/*.con`. 1,303 levels enumerated, 1,301 opened;
the two that did not are `DC_Final/DC_No_Fly_Zone` and `FHSW/telemark-1943`,
both truncated archives. Counts below are **live** commands — `rem`,
`beginrem`/`endrem` stripped — not raw `Object.create` greps, which is why they
run a little under the ones in `parity-audit/level-content.md`. (Wake's
`SinglePlayer/SoldierSpawns.con` has 45 `Object.create` lines and 35 live ones;
ten sit inside a `beginrem` block.)

### 1.1 What every mod ships

| mod | levels | Conquest | SinglePlayer | Ctf | Tdm | ObjectiveMode | game types | layer dirs no game type runs |
|---|---|---|---|---|---|---|---|---|
| DC_Final | 47 | 47 | 24 | 36 | 30 | 1 | conquest 47, ctf 36, tdm 24, coop 23, search_and_destroy 5, objectivemode 1 | 7 |
| DesertCombat | 35 | 35 | 23 | 25 | 27 | 0 | conquest 35, ctf 24, tdm 23, coop 22, search_and_destroy 6 | 6 |
| EoD | 237 | 237 | 236 | 95 | 236 | 1 | conquest 237, coop 236, tdm 236, ctf 94, objectivemode 1 | 1 |
| FH | 73 | 73 | 61 | 14 | 18 | 2 | conquest 73, coop 61, ctf 14, tdm 11, objectivemode 1 | 10 |
| FHSW | 260 | 233 | 85 | 18 | 24 | 28 | conquest 233, coop 88, objectivemode 29, ctf 22, tdm 16 | 13 |
| FHSWEurope | 6 | 6 | 6 | 0 | 0 | 0 | coop 5, conquest 4 | 3 |
| FinnWars | 70 | 68 | 1 | 60 | 61 | 2 | conquest 68, ctf 60, tdm 42, objectivemode 2, coop 1 | 19 |
| GCMOD | 30 | 26 | 0 | 3 | 3 | 4 | conquest 26, objectivemode 4 | 6 |
| Pirates | 33 | 32 | 0 | 11 | 2 | 0 | conquest 31, ctf 9 | 5 |
| WarFront | 90 | 90 | 90 | 14 | 18 | 1 | conquest 90, coop 90, ctf 13, tdm 13, objectivemode 1 | 8 |
| XPack1 (Road to Rome) | 6 | 6 | 6 | 6 | 6 | 0 | conquest 6, coop 6, ctf 4, tdm 4 | 4 |
| XPack2 (Secret Weapons) | 9 | 9 | 8 | 7 | 7 | 6 | conquest 9, coop 8, ctf 6, objectivemode 6, tdm 6 | 2 |
| bf1918 | 134 | 131 | 112 | 23 | 37 | 3 | conquest 131, coop 112, tdm 33, ctf 17, objectivemode 3 | 13 |
| **bf1942** | **23** | **23** | **19** | **13** | **17** | **1** | conquest 23, coop 19, tdm 13, ctf 12, objectivemode 1 | **5** |
| bfheroes | 35 | 34 | 33 | 33 | 33 | 0 | conquest 34, coop 33, ctf 33, tdm 33 | 0 |
| bg42 | 200 | 196 | 167 | 18 | 22 | 18 | conquest 196, coop 167, tdm 18, objectivemode 18, ctf 17 | 5 |
| interstate | 13 | 13 | 0 | 6 | 0 | 0 | conquest 13, ctf 7 | 0 |
| **total** | **1301** | **1259** | **871** | **382** | **541** | **67** | conquest 1256, coop 871, tdm 472, ctf 368, objectivemode 67, search_and_destroy 11 | **107** |

What the extractor now reads that it never did:

| scope | levels | extra layers | control points | soldier spawns | vehicle placements |
|---|---|---|---|---|---|
| vanilla `bf1942` | 23 | 50 | +225 | +1,767 | +1,443 |
| all 18 mods | 1,301 | 1,820 | +9,633 | +53,783 | +81,831 |

The default layer alone was 7,646 control points, 41,873 soldier spawns and
81,764 vehicle placements, so this is a little over twice the gameplay data.

### 1.2 `GameTypes/<x>.con` is the index, and the file name is not the directory

The single most load-bearing finding. A level's `GameTypes/` directory holds
one script per game type the menu offers, and the script's `run <dir>/<file>`
lines name the layer directory it loads. Six game-type names exist across all
1,301 archives, and one of them does **not** load a directory of its own name:

| game type | levels | loads |
|---|---|---|
| `Conquest` | 1,256 | `Conquest/` (1,223), `../` shared 32 |
| `CoOp` | 871 | **`SinglePlayer/`** (796), `Conquest`+`SinglePlayer` 37, `ai_tweaks`+`SinglePlayer` 23 |
| `Tdm` | 472 | `Tdm/` (437), `Ctf/` 15, `../` 17 |
| `Ctf` | 368 | `Ctf/` (366) |
| `ObjectiveMode` | 67 | `ObjectiveMode/` (66) |
| `Search_And_Destroy` | 11 | `Conquest/` (DC_Final, DesertCombat) |

There is **no `CoOp/` directory anywhere**. Wake's `GameTypes/CoOp.con`:

```
Game.setNumberOfTickets 1 140
Game.setNumberOfTickets 2 100
Game.setTicketLostPerMin 1 15
Game.setTicketLostPerMin 2 10000

run SinglePlayer/SoldierSpawnTemplates
run SinglePlayer/SoldierSpawns
run SinglePlayer/SpawnpointManagerSettings
...
```

Two consequences:

* **A layer's tickets are in a file that is not named after it.** SinglePlayer's
  tickets are `GameTypes/CoOp.con`'s. `load_tickets(files, "SinglePlayer")`
  looks for `GameTypes/SinglePlayer.con`, which no level has, and finds
  nothing. `tickets_for_mode` goes through the game types instead.
* **`?mode=CoOp` has to resolve to the SinglePlayer layer**, which
  `resolveMode` in `viewer/game-modes.js` does.

`El_Alamein` is the reverse oddity: it ships `Tdm/` *and* a `GameTypes/Tdm.con`
that runs `Ctf/*`. Fifteen levels across the mods do this.

The engine agrees, and says so in the binary. `dice::bf::Setup::setNextLevel`
(`0x080bf160` in `bf1942_lnxded.static`) builds `bf1942/levels/` + the level +
`/gametypes/` + one of `conquest.con` / `ctf.con` / `tdm.con` / `coop.con` /
`objectivemode.con`, chosen through a six-entry jump table at `0x86ba190` on
the `GamePlayMode` in the `CampaignEntry`: 1 is ctf, 3 tdm, 4 coop, 5
objectivemode, and 0, 2 and anything out of range fall to conquest. There is a
`coop.con` and there is no `coop/` anywhere, which is the same finding from the
other end. Reproduce with:

```
objdump -d -M intel --start-address=0x080bf160 --stop-address=0x080bfd00 \
  ~/Downloads/bf1942_lnxded-1.61-patched/bf1942/bf1942_lnxded.static
```

### 1.2.1 `run` is per file, and 35 scripts use that

A game type is **not** a directory, and on 35 of the 3,048 GameTypes scripts
across the installed mods it is not one directory's worth of files either. The
script names a file at a time, and these mix two layers in one game type.
XPack1's Anzio, in full:

```
run SinglePlayer/SoldierSpawnTemplates
run SinglePlayer/SoldierSpawns
run SinglePlayer/SpawnpointManagerSettings
run SinglePlayer/ObjectSpawnTemplates
run Conquest/ControlPointTemplates
if v_arg1 == host
run ai
run SinglePlayer/ObjectSpawns
run Conquest/ControlPoints
...
```

SinglePlayer's spawns and vehicles, **Conquest's flags**. XPack2's Gothic Line
is the mirror: SinglePlayer's soldier spawns under Conquest's vehicles and
flags.

| mod | scripts | which |
|---|---|---|
| XPack1 (Road to Rome) | 6 | every CoOp script |
| XPack2 (Secret Weapons) | 8 of 9 | |
| bf1918 | 12 | |
| FHSW | 6 | |
| FH | 3 | |
| **total** | **35** | **0 in vanilla** |

Most of the 35 straddle two directories whose copies of the file in question
are the same layout, so reading the majority directory happened to give the
right answer anyway. Resolving each composed layer against the majority
directory it would otherwise have used, and comparing what the page would
draw — flags with owner and position, soldier spawns, vehicle pads:

| | scripts |
|---|---|
| straddle two directories | 35 |
| **differ in the flags** | **5** — `FH/Zielona_Gora-1944`, `FHSW/Husky`, `XPack1/cassino`, `bf1918/belgrade`, `bf1918/tanga` |
| differ in flags, spawns or pads | 7 — the five above plus `FH/Liberation_Of_Caen`, `XPack2/Gothic_Line` |

The worst is `FH/Zielona_Gora-1944`, whose CoOp takes `Conquest/ControlPoints`
and whose SinglePlayer directory has no `ControlPoints.con` at all — a
majority-directory reading gives it a layer with **zero flags** where the game
shows five. Reproduce with `check_split_impact.py` in this stream's scratch
directory.

So the fix is worth making for correctness, not for its blast radius: it is
7 levels of 1,301, one of them badly wrong. The reason to carry `GameType.files`
anyway is that "the majority directory is usually right" is not a rule the
engine has, and a mod shipped tomorrow gets no such luck.

So `GameType.files` records the directory of each of the seven layer files,
`GameType.composed` is true when they straddle, and
`compose_game_type_layers` writes a layer keyed by the **game type's own
name** (`modes["CoOp"]`). The directory layers stay exactly what they were and
are still reachable by their own names; on those levels `SinglePlayer` is
correctly a layer no game type runs. Reproduce the survey with
`r3c_split_layers.py` in the reviewer's scratch directory.

This is also why the Instant Battle screen asks for `mode=CoOp` and not
`mode=SinglePlayer` (§4).

Every `run` line counts, in both arms of an `if v_arg1 == host` block. 1,381
of the 1,454 scripts in a six-mod sample have such a block, and the host arm is
the one a single-player launch takes; no script in any installed mod has a live
`run` of a layer file in its `else` arm (the join arms are `rem`-ed out, and
`strip_comments` removes those before the parse).

### 1.3 Dead layer directories

107 levels ship a layer directory that no game type loads — the data is in the
archive and the engine never runs it. Vanilla has five, Wake among them: a
`Tdm/` directory with 5 control points, 17 soldier spawns and 30 vehicle pads,
and no `GameTypes/Tdm.con` and no root `Tdm.con` anywhere in the chain.

The extractor reads them anyway. They are authored layouts, they are correct
data, and the page can show them; `scene.json`'s per-mode `gameTypes` list is
empty for such a layer, which is how a consumer tells the difference.

The mirror case exists too: 21 levels have a game type whose directory is
missing (13 `ctf`, 4 `tdm`, 3 `coop`, 1 `objectivemode`). Those simply yield no
layer.

### 1.4 How different is SinglePlayer from Conquest, really?

Not "a few fewer vehicles". Per vanilla level, control points / soldier spawns
/ vehicle placements:

| level | layers shipped | game types | Conquest | SinglePlayer | Ctf | Tdm |
|---|---|---|---|---|---|---|
| Aberdeen | conquest | conquest | 7/49/33 | - | - | - |
| Battle_of_Britain | conquest, objectivemode, singleplayer | conquest, coop, objectivemode | 2/14/66 | 2/22/66 | - | - |
| Battle_of_the_Bulge | conquest, ctf, singleplayer, tdm | conquest, coop | 6/42/31 | 6/42/24 | 6/60/31 | 6/42/31 |
| Battleaxe | conquest, ctf, singleplayer, tdm | conquest, coop, ctf, tdm | 8/34/31 | 8/70/28 | 6/34/30 | 8/34/30 |
| Berlin | conquest, ctf, singleplayer, tdm | conquest, coop, ctf, tdm | 4/28/10 | 4/28/7 | 2/28/9 | 4/28/11 |
| Bocage | conquest, ctf, singleplayer, tdm | conquest, coop, ctf, tdm | 5/32/24 | 5/34/23 | 3/32/24 | 5/32/24 |
| Coral_Sea | conquest | conquest | 0/0/10 | - | - | - |
| El_Alamein | conquest, ctf, singleplayer, tdm | conquest, coop, ctf, tdm | 5/29/48 | 5/38/45 | 3/29/48 | 5/29/48 |
| Gazala | conquest, ctf, singleplayer, tdm | conquest, coop, ctf, tdm | 6/49/44 | 6/43/43 | 3/49/39 | 6/49/44 |
| GuadalCanal | conquest, ctf, singleplayer, tdm | conquest, coop, ctf, tdm | 6/50/41 | 6/42/33 | 4/50/41 | 6/50/41 |
| Invasion_of_the_Philippines | conquest | conquest | 6/30/50 | - | - | - |
| Iwo_Jima | conquest, singleplayer, tdm | conquest, coop | 5/38/38 | 5/38/33 | - | 5/38/36 |
| Kasserine_Pass | conquest, ctf, singleplayer | conquest, coop, ctf | 5/35/41 | 5/35/42 | 3/35/42 | - |
| Kharkov | conquest, ctf, singleplayer, tdm | conquest, coop, ctf, tdm | 5/35/23 | 5/35/21 | 3/35/23 | 5/35/23 |
| Kursk | conquest, ctf, singleplayer, tdm | conquest, coop, ctf, tdm | 4/15/18 | 4/28/15 | 2/16/18 | 4/15/18 |
| Liberation_of_Caen | conquest | conquest | 6/30/36 | - | - | - |
| Market_Garden | conquest, singleplayer, tdm | conquest, coop | 6/55/26 | 6/55/23 | - | 6/55/26 |
| Midway | conquest, singleplayer, tdm | conquest, coop, tdm | 4/15/22 | 2/14/16 | - | 4/15/22 |
| Omaha_Beach | conquest, singleplayer, tdm | conquest, coop, tdm | 3/28/18 | 3/30/14 | - | 3/28/18 |
| Stalingrad | conquest, ctf, singleplayer, tdm | conquest, coop, ctf, tdm | 5/39/17 | 5/34/12 | 1/20/7 | 5/39/17 |
| Tobruk | conquest, singleplayer, tdm | conquest, coop, tdm | 7/57/26 | 7/57/19 | - | 7/57/27 |
| Truk | conquest, ctf, singleplayer, tdm | conquest, coop, ctf, tdm | 5/28/39 | 5/28/39 | 3/28/33 | 5/28/39 |
| Wake | conquest, ctf, singleplayer, tdm | conquest, coop, ctf | 5/17/32 | 5/35/23 | 1/11/26 | 5/17/30 |

The differences that matter, by kind:

**Vehicles.** SinglePlayer generally strips the fleet and the bomber and adds
armour the bots can use. Wake drops all 7 jeeps, the SBD-T and 3 stationary
Brownings, and adds 2 Chi-Ha; Midway drops both submarines, both destroyers and
both battleships; GuadalCanal drops the subs and destroyers; Bocage and Market
Garden and Gazala each drop the B-17. Kasserine Pass is a rebuild rather than a
trim — Conquest's 4 Shermans become 14, the Tigers, Panzer IVs, Bf 109s,
Stukas, Wespe, Hanomags and Kübelwagen all go, and an SBD appears: it is a
scripted armour assault, not the Conquest map with bots.

**Flag positions and radii.** Wake's `The_beach` moves from
`1144.5/97.7/715.0` to `1162.6/109.9/762.0` and its capture radius halves from
50 to 25. Stalingrad's SinglePlayer flags go the other way — the two base
radii jump from 5 to 50 and the three city points from 5 to 15, and two of the
city points move 12 to 18 m.

**Starting owners.** Wake's Tdm layer opens with `The_beach` **allied**
(team 1) where Conquest opens it Japanese (team 2), and Tdm's other three
flags are neutral where Conquest's start held. That is a different flag mesh
on the pole, which is why the glb cannot share one node between them (§3).

**Spawn groups.** Kasserine Pass's SinglePlayer layer gives both base flags a
`secondSpawnGroupId` (6 and 7) that Conquest does not, and its
`spawnPointManagerSettings.con` binds group 7 to team 2 where Conquest's file
has no group 7 at all. Wake's Ctf layer binds only groups 3 and 4, and to the
opposite sides from Conquest's 1..5.

**Tickets.** CoOp/SinglePlayer runs asymmetric: Wake 140 v 100 with the
Japanese losing 10,000 a minute (the round ends the moment they lose their last
flag), against Conquest's 100 v 100 / 5 v 30. Ctf and Tdm scripts set no ticket
count at all on any vanilla level — CTF is decided on captures.

**Combat area.** No level in any installed mod declares
`game.setActiveCombatArea` inside a layer directory or a GameTypes script —
0 of 1,303 scanned on review, against 1,037 that set one in `Init.con`. It is
`Init.con`'s and level-wide. The schema carries it per mode
anyway so the merge is one rule, and so a mod that does scope one has somewhere
to put it.

### 1.5 AI-only files: named and skipped

`SinglePlayer/` ships more than a layout. These are bot data with no geometry
and no gameplay layer in them, and the extractor does not read them:

| path | levels | what it is |
|---|---|---|
| `SinglePlayer/Bots.con` | 20 | `run bf1942/game/common/<nation>names` — the bot name lists |
| `SinglePlayer/Skirmish.con` | 20 | the same, for the skirmish nation pairing |
| `SinglePlayer/SinglePlayerTweaks.con` | 1 | per-level AI tuning |
| `SinglePlayer/InitPositions.con` | 1 | authored bot start positions |
| `SinglePlayer/ObjectSpawns{Allied,Axis}.con` | 1 | the campaign side variants |
| `AI.con`, `AIPathfinding.con` (root) | 20 each | `run ai`, strategy weights |
| `SinglePlayerAllied.con`, `SinglePlayerAxis.con` (root) | 20 each | the campaign entry points; they run `SinglePlayer/*` with their own tickets |
| `AI/`, `Pathfinding/`, `aiMeshes/`, `ai_tweaks/` | 874 / 871 / 20 / 25 | nav meshes and strategic areas |

`AI/` and `Pathfinding/` are the two big ones — 874 and 871 levels — and they
hold the bot navigation mesh, which is a separate subject from a gameplay
layer. Nothing here is read and nothing here should be until somebody wants
bots.

---

## 2. The schema

`scene.json` gains two keys and changes none.

```jsonc
{
  "level": "Wake",
  "gameplayMode": "Conquest",        // unchanged: the DEFAULT layer's name
  "controlPoints":  [ ... ],         // unchanged: the default layer
  "soldierSpawns":  [ ... ],         // unchanged
  "objectSpawns":   [ ... ],         // unchanged
  "vehicleSoldierSpawns": [ ... ],   // unchanged
  "tickets":        { ... },         // unchanged
  "combatArea":     null,            // unchanged

  "gameTypes": {                     // NEW: what the menu offers
    "Conquest": { "mode": "Conquest",     "tickets": {...} },
    "CoOp":     { "mode": "SinglePlayer", "tickets": {...} },
    "Ctf":      { "mode": "Ctf",          "tickets": null }
  },

  "modes": {                         // NEW: one entry per layer, default first
    "Conquest": {
      "gameTypes": ["Conquest"],     // the game types that load this layer
      "controlPoints":        [ ... ],
      "soldierSpawns":        [ ... ],
      "objectSpawns":         [ ... ],
      "vehicleSoldierSpawns": [ ... ],
      "tickets":              { "mode": "Conquest", "team1": 100, ... },
      "combatArea":           null
    },
    "Ctf":          { ... },
    "Tdm":          { "gameTypes": [], ... },   // shipped, no game type runs it
    "SinglePlayer": { "gameTypes": ["CoOp"], ... }
  }
}
```

Every entry carries the same seven keys. The six that are not `gameTypes` are
exactly the keys the page's mode merge overrides (`MODE_KEYS` in
`viewer/game-modes.js`); the list is an **allowlist**, so a mode entry can
never replace `terrain`, `objects`, `sounds` or anything else describing the
scene itself.

### Backward compatibility

Two rules, both tested:

1. **`modes[<default>]` is the top-level report, again.** So selecting the
   default mode — which is what no `?mode=` does — produces the same object the
   page had before `modes` existed. `test_the_default_entry_is_the_top_level_report`
   and `test_the_default_mode_is_the_top_level_report` pin both halves.
2. **A `scene.json` with no `modes` key is returned untouched** by
   `selectGameMode`, by identity. Every published report predates this; they all
   keep working, and the `?mode=` parameter simply does nothing on them.

The same shape holds in the glb (§3): a node with no `modes` tag is in every
mode, which is how every scene built before this reads.

**One pre-existing key does change**, and it is not in `MODE_KEYS` so no
`?mode=` moves it: `objects`. It is the build report for the glb, and the glb
is now the union, so on Wake `spawners` reads 58 against 32, `controlPoints`
10 against 5, `flagCloths` 7 against 5, `parts` 1800 against 1240,
`triangles` 879,379 against 757,420, and `unresolvedTemplates` gains the Ctf
layer's `ALLIES_BASE`. That is honest — it describes the file — but it is no
longer the count of anything standing in the level, so `map.html` reads the
spawners root for the stats panel and the console band instead. Everything
else in a re-extracted `scene.json` is byte-identical to main's output;
verified by extracting Aberdeen and Wake through both trees
(`r3c_glb_diff.py`).

---

## 3. The glb: vehicles baked for a mode that is not playing

This is the part the audit got wrong. It said "the glb is unaffected (statics
are mode-independent)". The statics are; the **vehicles are not**. Object
spawners are not markers in `scene.json` — `build_scene` places the vehicle
each `ObjectSpawner` yields as a real assembled node under a `spawners` root,
and control points are placed as real flag poles under a `controlPoints` root
with a skinned cloth node at the scene root. A mode that parks a different set
of vehicles needs different nodes.

Three options were on the table:

1. **Bake the default mode only.** Then `?mode=SinglePlayer` shows Conquest's
   vehicles, which is the bug with extra steps.
2. **Bake one glb per mode.** 277 levels times up to five modes of 40 MB each.
   Absurd: the terrain, statics and lightmaps are 95% of those bytes and are
   identical.
3. **Bake the union once, tag each node with the modes it belongs to, and let
   the page drop the rest.** This is what it does.

`union_object_spawns` collapses every layer's pads into one ordered list keyed
on `(vehicle, position, rotation)` rounded to a centimetre, default mode first
and in its own file order — so a scene loaded with no `?mode=` holds the nodes
it always held, in the order it always held them. `union_control_points` does
the same for flags, but keys on the **starting owner** too: Wake's `The_beach`
is Japanese in Conquest and American in Tdm, `setTeamGeometry` picks the cloth
from the team, and one node cannot fly two flags. Only one of the pair is ever
in the scene.

A node that is **not** in every layer gets `extras.modes` — a list of layer
names. A node in all of them gets nothing, because an untagged node already
reads as "every mode": that is the rule the viewer applies to pre-modes glbs
and it costs a single-layer level nothing to obey. Aberdeen without it was
gaining 42 redundant tags and 17,464 bytes, and its node array stopped being
byte-identical to main's for no gain at all; with it, a single-layer level's
node array, BIN chunk, accessors, meshes and materials are byte-for-byte what
they were, and only the embedded report grows (+16.6 KB, +0.057%).

The page's `pruneToMode` detaches everything the active mode does not list,
before anything indexes the scene, so the vehicle list, the occupancy roots,
the respawn timers, the cull set and the minimap markers never see a vehicle
that is not in this mode. Verified on the merged tree: `indexScene`
(`spawnersRoot`, `freezeStatics`), `collectTerrain`, `buildCollider`,
`setupVehicleBodies`, `bindLightmaps`, `placeSpawnSoldiers` and
`new CombatArea(extras)` all run after it, and nothing between the loader and
the prune walks `gltf.scene`.

Detaching rather than hiding for exactly that reason; nothing is disposed,
because glTF geometries are shared between placements and a pruned Sherman's
buffers usually belong to a kept one. The cost of that is a bounded CPU-side
leak for the session's level — a hull only one layer parks (Wake's Chi-Ha)
has geometry no kept node shares, and `dispose(currentRoot)` on the next
level switch cannot reach it. Nothing is uploaded to the GPU and nothing is
raycast, so it is a megabyte-scale leak, not a correctness one; disposing
safely would need a reference count across the kept set.

**Animation clips follow the prune.** The glb bakes a cloth clip per pole,
so the clips for a pruned pole's bones bind to nothing and three logs
`PropertyBinding: No target node found` once per track — 88 of them on Wake's
*default* Conquest load and 292 on its Ctf. `show()` drops the dead tracks
before building the actions, using three's own `PropertyBinding.findNode`.

Flag cloths carry the tag in their own right, because the cloth mesh node sits
at the scene root (glTF ignores a skinned mesh node's own transform) while its
skeleton hangs under the pole. Without the tag, switching mode would leave a
flag flying over a pole that is no longer there.

**Respawn windows.** A pad two modes share can still be timed differently:
1,674 pads across the installed mods disagree, 32 of them in vanilla
(307 in bf1918, 276 in FinnWars, 168 in Interstate 82; re-counted on review by
sweeping every archive through `union_object_spawns` -- 2,123 does not
reproduce, 32 in vanilla does)
(DC_Final's Berlin parks a humvee on one slab with a 40-80 s window in Conquest
and 70-110 s in Tdm). When the modes disagree the node's stamp gains
`spawner.byMode`, and `spawnerWindow` in `game-modes.js` reads the active
mode's. When they agree — nearly always — the plain `minSpawnDelay` /
`maxSpawnDelay` stands, unchanged.

Union sizes, measured over all 1,301 archives:

| | default layer only | union of all layers | growth |
|---|---|---|---|
| vehicle pads (nodes) | 81,263 | 89,128 | +7,865 (+9.7%) |
| flag poles (nodes) | 7,509 | 8,335 | +826 (+11.0%) |

Re-run on review over all 1,301 openable archives: the pad union comes back
**89,128**, exactly; the flag union **8,529** against a default-layer 7,646,
which is the same +11.5% over a count taken before the invisible-template
filter rather than after it. 35 levels carry a composed game type.

---

## 4. The page

`map.html?map=<level>&mode=<mode>`:

* **No `mode`** — the default layer, which is the top-level report. Identical
  to the page's behaviour before this existed.
* **`mode=SinglePlayer`** (a layer name, any case) — that layer.
* **`mode=CoOp`** (a game type) — the layer that game type loads, including a
  composed one (§1.2.1).
* **`mode=` something this level does not have** — the default layer, plus a
  message naming what the level does have. A mistyped URL must not leave the
  page with no flags.
* **`mode=` a game type the level's menu offers with no directory behind it**
  — 21 levels across the mods are like this — the default layer, and the
  message says specifically that. This case used to be silent:
  `isUnknownMode` called it fine because the game type existed, and the page
  rendered a different layer without a word. `modeProblem` separates the two.
* **`mode=` with no `map=`** — still goes to the Instant Battle menu. The
  bare-page guard is unchanged and keys on `map`/`replay`/`shots`/`dev` only.

The message goes to `console.warn` **and** to the game's own console band
(`logToConsole`), because the dev panel is hidden for everyone but a
developer and a browser console is not somewhere a player looks.
`window.__gameMode().note` carries it for a headless check.

The hook in `map.html` is five places plus an import: `selectGameMode` and
`modeProblem` where `extras = report` used to be, `pruneToMode` right after
`currentRoot = gltf.scene`, the animation-clip filter just below it,
`spawnerWindow` inside `spawnDelayForNode`, and the spawners-root count in the
stats panel. Everything else — the deploy screen's spawn-point list, the full
map's flags, the minimap's control-point strip, the ticket HUD, the decorative
3P soldiers at the spawn points — reads the module-level `extras`, so it
follows the mode with no change at all. `report` is a local in `show()` and
nothing outside those five reads it.

The ticket HUD hides itself when either count is missing (`feedTicketVars`),
so Ctf and Tdm — which set no tickets on any vanilla level — draw no counter
rather than a NaN or the layout's own "300"/"500" sample literal.

`window.__gameMode()` reports the active layer, what was requested, what the
level offers, the flags with their owners, the spawn counts per side, the
tickets and the vehicles actually in the scene. (`available` lists the active
layer first, then the rest in archive order — `modeNames` puts
`extras.gameplayMode` at the head, and after the merge that is the active one.)

### Verified on the page

Served from this worktree on `:5353` with `wake`, `berlin` and `kursk`
overridden by scratch extracts and every other level still the published one.
Playwright, `window.__gameMode()` and `window.__deploy`, zero page errors on
every load:

| URL | layer | flags | soldier spawns | vehicles in scene | tickets | deploy screen |
|---|---|---|---|---|---|---|
| `map=wake` | Conquest | 5 | 17 | 32 | 100/100, 5/30 | 5 flags + Hatsuzuki + Shokaku |
| `map=wake&mode=Conquest` | Conquest | 5 | 17 | 32 | 100/100, 5/30 | identical to the above |
| `map=wake&mode=SinglePlayer` | SinglePlayer | 5 | 35 | 23 | 140/100, 15/10000 | same 7 rows, 7 spawns each |
| `map=wake&mode=Tdm` | Tdm | 5 | 17 | 30 | none | beach team 1, three flags neutral |
| `map=berlin` | Conquest | 4 | 28 | 10 | 80/100, 30/5 | 4 flags |
| `map=berlin&mode=Ctf` | Ctf | 2 | 28 | 9 | none | 2 flags |
| `map=berlin&mode=CoOp` | **SinglePlayer** | 4 | 28 | 7 | 100/100, 10000/15 | 4 flags |
| `map=berlin&mode=ObjectiveMode` | Conquest | 4 | 28 | 10 | 80/100 | warns `no "ObjectiveMode" layer on Berlin; showing Conquest. Has: Conquest, Ctf, Tdm, SinglePlayer` |
| `map=tobruk` (published glb + report, no `modes`) | Conquest | 7 | 57 | 26 | 100/80 | unchanged |
| `map=tobruk&mode=SinglePlayer` | Conquest | 7 | 57 | 26 | 100/80 | unchanged; `?mode=` is inert on an old report |

The vehicle counts are the **nodes left in the scene graph** after
`pruneToMode`, and they match each layer's `objectSpawns` count exactly, so the
prune is neither over- nor under-reaching. Wake's Conquest scene holds seven
Willys and no Chi-Ha; its SinglePlayer scene holds two Chi-Ha and no Willy at
all. Wake's `The_beach` sits at `1144.5/97.7/-715.0` in Conquest and
`1162.6/109.9/-762.0` in SinglePlayer, and reads team 2 in Conquest against
team 1 in Tdm with the other three flags neutral.

The two Tobruk rows are the backward-compatibility proof against real published
data, not a fixture: that `scene.json` and that `scene.glb` were written before
any of this existed.

And the Instant Battle screen, driven through `window.__menu` over all 23
levels: **19 launch `mode=CoOp`, 4 launch `mode=Conquest`** — Coral Sea,
Invasion of the Philippines, Liberation of Caen and Aberdeen, which are
exactly the four with `singlePlayer: false` and exactly the four the game does
not list under Instant Battle. `map.html?mode=SinglePlayer` with no `map=`
still lands on `play/index.html`: the bare-page guard is untouched.

Re-driven on review over the merged tree, with the mod picker on main: 23
vanilla levels 19/4, `?mod=xpack1` 6 levels all `mode=CoOp&mod=xpack1`,
`?mod=xpack2` 8/1, `?mod=eod` 238/1, zero page errors on each. And the pages
themselves, over the reviewer's own re-extracts, **zero warnings and zero
errors on every mode of Wake**: no `?mode=` 32 vehicles / Conquest,
`SinglePlayer` 23, `CoOp` 23 (the SinglePlayer layer), `Tdm` 30, `Ctf` 26 with
one flag, `Nonsense` 32 with the one warning that says so; Aberdeen 33 with
and without `?mode=`; `xpack1/Anzio` `?mode=CoOp` resolving to the **composed
CoOp layer** with Conquest's six flags and SinglePlayer's 29 vehicles.

### Instant Battle

`viewer/play/index.html` launches `mode=CoOp` where the level ships that
layout and `mode=Conquest` where it does not. **The game type, not the
directory**: Instant Battle is the CoOp game type, `gametypes/coop.con`, and
on Road to Rome and Secret Weapons that script's layout is no directory's
(§1.2.1). Asking for `SinglePlayer` by name is the right layer on most of
them by luck and the wrong one on `XPack1/cassino` and `XPack2/Gothic_Line`,
both published; asking for the game type is right on all of them by
construction. On every vanilla level `CoOp` resolves to the SinglePlayer layer
and nothing changes.

`menu-levels.json` records which levels have that layout as `singlePlayer`
(19 of 23 vanilla levels; the four without are Aberdeen, Coral Sea, Invasion
of the Philippines and Liberation of Caen). A mod with no menu pack of its own
lists `maps.json` outright and those records carry no `singlePlayer` at all —
`undefined`, not `false` — so no `mode=` is sent and the level plays its own
default layer. Naming Conquest there would be a guess, and wrong on the 27
FHSW levels that ship no Conquest layer. All three published mods (EoD, Road
to Rome, Secret Weapons) do have packs, so this is a guard, not a live path.

The launch URL is built in one place, used by both `start()` and the
`__menu.launchUrl()` harness hook, and carries `map`, `team`, `mode` and
`mod`.

### Publish ordering

**The code must reach production before the re-extracted levels do.** Main's
`map.html` has no `pruneToMode`, so on a new multi-layer glb it renders the
union: served main's page against a re-extracted Wake, `window.__vehicles()`
returns **58** where the same page on the old glb returns 32, and the glb
carries 10 flag poles and 7 cloths against 5 and 5 — two flags on the beach
position, one Japanese and one American. A single-layer level is safe either
way (Aberdeen: 33 both times), which is 309 of the 1,301 installed levels.

The other direction is safe and is proven against real published data: the
new page on the published pre-modes `tobruk` renders 26 vehicles and 7 deploy
rows with and without `?mode=`, zero warnings, zero errors. So the order is
**deploy the viewer first, then upload the levels**; and if levels land first,
every multi-layer level shows every mode's vehicles until the deploy catches
up.

---

## 5. What a full re-extract costs

Measured A/B through the real CLI on five levels — `extract_map.py <level>`
run twice, once as it now behaves and once with `info.modes` trimmed to the
default layer, which is exactly the old behaviour. Script: `cost.py` in this
stream's scratch directory; it wraps `extract_map.load_level` and runs
`extract_map.main()` otherwise unmodified, so both halves go through the real
CLI. Run in both orderings; the byte counts were identical in both.

### Bytes

| level | layers | `scene.glb` | `scene.json` | level directory |
|---|---|---|---|---|
| Wake | 4 | 38.99 -> 41.95 MB (+7.6%) | 325.1 -> 395.5 KB (+21.7%) | 41.39 -> 44.43 MB (+7.3%) |
| Berlin | 4 | 24.84 -> 25.65 MB (+3.3%) | 223.4 -> 270.3 KB (+21.0%) | 29.78 -> 30.64 MB (+2.9%) |
| Kursk | 4 | 30.71 -> 31.09 MB (+1.2%) | 440.2 -> 487.5 KB (+10.8%) | 32.28 -> 32.70 MB (+1.3%) |
| El_Alamein | 4 | 74.89 -> 75.44 MB (+0.7%) | 558.3 -> 656.2 KB (+17.5%) | 78.04 -> 78.68 MB (+0.8%) |
| Aberdeen | 1 | 28.87 -> 28.87 MB (0.0%) | 384.7 -> 384.7 KB (0.0%) | 30.86 -> 30.86 MB (0.0%) |
| **total** | 17 | **198.30 -> 203.00 MB (+2.4%)** | **1,931.6 -> 2,194.2 KB (+13.6%)** | **212.36 -> 217.32 MB (+2.3%)** |

Aberdeen is the control: one layer, so the layer-reading code path costs it
nothing. Measured again on review against **main's extractor** rather than
against a trimmed `info.modes`, its `scene.glb` is *not* byte-identical: the
node array, the BIN chunk, the accessors, meshes and materials are, and the
glb grows by 16,584 bytes (+0.057%) because the embedded report carries
`modes` and `gameTypes`. Before the untagged-in-every-mode rule (§3) it was
+17,464 with 42 redundant node tags. Wake's numbers below stand as measured
(38.99 -> 41.95 MB, +7.6%).

**+2.3% on disk.** The published tree is about 15 GB over 277 levels, so a full
re-extract with this change is roughly **350 MB more**, and the glb is where
almost all of it goes — the `modes` block is 47 KB on Wake against a 42 MB
scene. The growth is not proportional to the number of layers: it is
proportional to how many *vehicle templates* the other layers introduce that
the default one did not have, because the meshes are shared in the glb buffer
and an extra placement of a template already present costs only a node. Wake is
the worst of the five (+7.6%) because SinglePlayer's Chi-Ha is a hull the
Conquest layer never places; El Alamein is +0.7% because its four layers park
the same vehicles in different arrangements.

### Time

Wall clock on a whole extract cannot resolve this, on this machine. El Alamein
with byte-identical output ran in 293.8 s and 374.1 s on two passes, and
Aberdeen — one layer, identical output either way — came out 10.5% "faster" on
one of its runs and 2.6% on another. That is a ±30% envelope on work that did
not change, from OS page cache on the `.rfa` files and from the other extracts
sharing the box.

So the added CPU is timed directly instead, in one warm process, alternating
and repeated, median of three (`cost_time.py` in the scratch directory):

| level | layers | parse default layer | parse all layers | scene build, default | scene build, all | delta |
|---|---|---|---|---|---|---|
| Wake | 4 | 3.4 ms | 14.6 ms | 50.03 s | 55.50 s | **+10.9%** |
| Berlin | 4 | 2.8 ms | 12.5 ms | 13.98 s | 14.34 s | **+2.6%** |
| Kursk | 4 | 2.9 ms | 13.0 ms | 48.73 s | 49.58 s | **+1.8%** |

Reading three extra mode directories costs about **11 ms per level** — under
three seconds across the whole 277-level tree, and nothing at all next to
opening the archives.

The real cost is assembling the extra vehicle and flag nodes, and it tracks the
glb growth for the same reason: Wake pays 10.9% because SinglePlayer brings a
hull no other layer has, Kursk pays 1.8% because its layers rearrange vehicles
the Conquest layer already placed. Single-digit percent of the object-assembly
phase, zero on the rest of an extract — terrain, lightmaps, textures and sounds
are byte-identical either way and take exactly as long as they did. A
single-layer level — Aberdeen, and 309 of the 1,301 across the mods — pays
nothing at all.

---

## 6. Where the code is

| what | where |
|---|---|
| `find_gameplay_modes`, `GameType`, `parse_game_type`, `load_game_types`, `compose_game_type_layers`, `tickets_for_mode` | `tools/bf1942-models/bf42/level.py` |
| `GameplayObjects.object_spawns` / `.object_spawn_templates` | `bf42/level.py` |
| `LevelInfo.modes` / `.game_types`, filled in `load_level` | `bf42/level.py`, `extract_map.py` |
| `union_object_spawns`, `union_control_points`, `_tag_modes` | `extract_map.py` |
| `_modes_report`, `_tickets_report` | `extract_map.py` |
| `selectGameMode`, `resolveMode`, `pruneToMode`, `spawnerWindow`, `modeProblem` | `viewer/game-modes.js` |
| the three hooks | `viewer/map.html` |
| the launch URL | `viewer/play/index.html` |
| tests | `tests/test_game_modes.py`, `tests/test_game_modes_js.py`, `tests/game_modes_harness.mjs` |

## 7. Not done

* **ObjectiveMode's own objects.** `ObjectiveMode/` ships
  `ObjectiveCommon.con`, `ObjectiveSpawners.con` and
  `ObjectiveSpawnerTemplates.con` alongside the usual files, and
  `objectiveManager.registerObjectSpawner` binds a spawner to an objective.
  The layer's control points, soldier spawns and vehicles are extracted like
  any other; the objective bindings are not parsed, so Battle of Britain's
  ObjectiveMode reads as a flag layout rather than a bombing run. 67 levels
  ship it (28 in FHSW, 18 in bg42, 6 in XPack2, 1 vanilla).
* **`Ctf.con`'s flag bases.** A CTF level's root `Ctf.con` creates `usbase` /
  `jpbase` objects (or `FlagPole` on a join) outside any layer directory. Those
  are the capturable flags of the mode and nothing places them.
* **No mode picker in the UI.** `?mode=` is a URL parameter; the page does not
  offer a control for it. `scene.json.modes` and `window.__gameMode()` carry
  everything a picker would need.
* **`search_and_destroy`** is recognised as a game type (11 levels, DC_Final
  and DesertCombat) and loads the Conquest layer, which is what its script
  says. Whether the mode does anything else with that layer is unexamined.
* **Pruned nodes are never disposed.** A hull only one layer parks has
  geometry no kept node shares, and the next level switch's
  `dispose(currentRoot)` cannot reach it. Bounded and CPU-side only (§3).
* **Whether Instant Battle is the right default at all** is the owner's call,
  not a defect. CoOp is what the game runs, and it is also the layout authored
  for bots: Wake loses all seven jeeps and gains two Chi-Ha, Midway loses both
  submarines, both destroyers and both battleships, and Kasserine Pass is a
  different battle. On a page with no bots that is emptier than Conquest and
  arguably a worse first impression; it is also the honest answer to "this is
  the game's Instant Battle screen". Changing it is one ternary in
  `launchUrl()`.
