# Flag binding, the `ControlPoint` count and the hold-only side, 2026-11-11

Follow-up to [no-live-strategy.md](no-live-strategy.md). That note found two
page faults under the "no live strategy" symptom; this one fixes them and
re-measures every generated layer.

1. **The binding.** `StrategicLayer.bindFlags` bound the page's stand-in flags
   ahead of the level's real control points. A stand-in is either a spawn
   group no control point claims, or a ship's deck groups. In some levels a
   real control point owns no spawn, so the page makes it capture-only and
   lists it last. There the stand-ins took its area first and the real flag
   lay in no area: nothing to attack there.
2. **The count.** The `ControlPoint` state that the strategies' conditions
   read counted every flag, stand-ins included: Edson's Ridge's Allies "held
   fourteen". It also adds each owned area typed `ControlPoint` a second
   time. The engine does neither. Moving the count to the engine's moved
   every generated template's strategy choice, and two liked levels lost
   captures, so it stays the page's for now, measured and labelled (section 5).
3. **What else leaves a side with nothing to attack** once the binding is
   right: the hold-only side, and the change to the fallback that follows
   from it.

## 1. What the engine does

**Binding.** `AIStrategicArea::update` 0x0863d6d0 binds an area to a control
point only. It does so when the area is typed `ControlPoint` and its centre
box holds the point (`BFEnvironment::findControlPoint` 0x085e53a0, over the
control point vector). Ledger AI-38 and SPAWNGRP-7 record this, and the page
already did it for capture-only points (`controlPointAreaAt`). The engine has
no stand-in: a spawn group is not a strategic object. An area holding no
control point is held by presence (`updatePresenceOwner`, AI-70).

**`ControlPoint`.** The repo had not settled this; `tests/test_strategic.py`
pinned the page's sum without a source. Read from the third-party decompile
(`features/bf1942-engine-reference/recorpus.py`, the Mac client and the 1.61
Linux server) this time:

- `operator>>(istream, Conditional)` maps `ControlPoint` to state slot 0x12,
  with `Ticket` 0x11, `Time` 0x13 and `StartTime` 0x14.
- `SAI::updateStates` fills slot 0x12 from `IAIEnvironment` vt+0x94 for the
  side (`param_1[0x12]`) and for the other side (`param_2[0x12]`).
- The engine's `getNumberOfControlPoints(team)` (lnxded 0x085e4f80, 0x085ebff0
  in the 1.61 server) counts the control points in the object manager's
  vector whose team (+0x174, SPAWNGRP-7's team field) is the one asked.
- `updateStates`' loop over the strategic objects adds the area type flags
  through `hasObjectTypeFlag` (`1 << type` against +0x144). It counts types
  1 to 5 (Flank, Centre, Base, Close, Remote, into slots 0x1a to 0x1e, with
  `Front*` slots 0x25 to 0x29), 0xc (Bridge), 0xf (Route) and 0x11 to 0x14
  (North to East). `StrategicObjectType` `ControlPoint` is 0x10
  (`operator>>(istream, StrategicObjectType)`). It is in no slot.

So the engine's `ControlPoint` is the side's control points, and nothing
else. It includes a base that cannot change hands and a capture-only point.
It excludes a stand-in, and an owned area typed `ControlPoint` adds nothing.

That vt+0x94 is `getNumberOfControlPoints` is inferred from its argument and
its neighbour slot: Ticket's vt+0x90 is called the same way. It was not read
in our own binary in Ghidra. KNOBS.md marks it INFERRED, and nothing was
added to the ledger.

## 2. The change

- `strategic-layer.js bindFlags`: control points first, then the stand-ins
  (`isStandIn`: `standalone` or `vehicle`). A stand-in binds only into its
  nearest area, and only when that area holds no control point. An area with
  no point keeps its stand-in as before (INVENTION, kept). This is the
  engine's binding, for every layer. DICE's four levels place no stand-in,
  so they cannot move (section 6). A shipped level with ship decks can:
  Midway, Wake and Coral Sea are named but were not run.
- `strategic-ai.js _updateStates`: no change to the count. The comment now
  gives the engine's reading and the measured reason it is kept (section 5).
- `strategic-ai.js _holdOnlyFallback`, which was `_noLiveStrategyFallback`:
  on a generated layer, a side whose strategy has no attack target, while
  there is a flag for it to take, gets the no-layer order. With no strategy
  scoring, any capturable flag it does not hold counts, unchanged. With a
  live strategy, only a flag in play counts, in an area the side may take:
  counting the flags out of play there too took The Maze's sides when they
  held every flag in play, and its own-hand deaths went from 12 to 22 over
  three seeds. INVENTION, gated to generated layers (KNOBS.md "hold-only
  side").
- `sim/botlint.mjs`: the `strategy` warning reads the new binding and count.
  A new `target` warning names a side with a live strategy that has nothing
  to attack while a flag in play stands.

**Why the fallback's clause changed.** Knife Championship's Axis, Omaturi
Channel Cannon's Allies and The Corridor's Axis start with a live strategy
and nothing to attack: their own areas link to no area they could take.
They stood at home all match under the old rule, which asked for no strategy
to score. (The Fortress's Axis, whose base links to no area either, have no
live strategy at the start and already took the old rule; with the engine's
count they would not have, which is how this was found.) The fault was
always "ordered only to hold while there is something to take", and the
rule now says that.

## 3. The step-1 table, before and after

"Before" is origin/main with the no-live-strategy fallback (591df3968).
"After" is this change. The start columns are the strategic picture at the
first pass, with no bot counted (`static.mjs`, scratch `bots/n1/scripts`).
The match columns come from one garrison match per layer: 8 a side, 300 s,
seed 1, vehicles in.

Headline, 64 layers:

- **A flag in play bound to no area at the start: 4 levels before, 0
  after.** They were Edson's Ridge (both Allied flags), FHSW Pegasus (Cafe
  Gondree), Monte Cassino (the second line of defence) and The Great Pursuit
  (the third base).
  - Eleven levels still have a capture-only flag in no area. Every one of
    those is a flag the generator took out of play
    (`generated.unreachable`; no area is written for it), as designed.
  - They are Roye, both Omaturi Channel levels, shigaisen_C, The Dungeon,
    The_Maze, Fall of Berlin, Mareth Line, Monte Cassino, Red Square and
    Tunis.
- **A side with nothing to attack while a flag in play stands for it to
  take, at the start: 7 sides on 7 levels before, 6 after.** Edson's Ridge's
  Axis are no longer one. The six left, which the fallback now takes, are:
  - Knife Championship's Axis
  - Omaturi Channel Cannon's Allies
  - The Corridor's Axis
  - The Fortress's Axis
  - DC_Urban_Siege's Allies
  - Fall of Berlin's Allies

  The first three have a live strategy, so under the old rule they stood at
  home all match. In the census match each of the six spends 25 to 100 % of
  the match on the no-layer order.
- **"26 sides with a live strategy and no target"**, which
  no-live-strategy.md counted, were mostly sides with no flag in play to
  take. In every `the_street*`, shigaisen_C and Omaturi Channel Sniper Day 2,
  the generator took all the flags out of play. Elsewhere the side already
  holds every flag it can take. Only three of those sides were stuck
  (Knife Championship, Omaturi Channel Cannon, The Corridor). Sides with no
  target and nothing in play to take went from 26 to 31 (counted as
  defending): those are the sides the binding no longer sends at their own
  flag (section 4).
- **A side with no live strategy at the start:** 22 levels, before and
  after. The count is unchanged, so this is the template mismatch of
  no-live-strategy.md.
- **One match each:** 54 of 64 levels keep both their kills and their
  captures. The fallback fires on 9 levels.

| level | a flag in play bound to no area, before -> after | side with nothing to attack and a flag to take, at the start, before -> after | ControlPoint at the start, Axis / Allies, before -> after | live strategy at the start, before -> after | fallback share of the match, Axis / Allies, before -> after | kills, one match, before / after | captures, before / after |
|---|---|---|---|---|---|---|---|
| bf1918/battle_of_cambrai | - -> - | - -> - | 6 / 1 -> 6 / 1 | yes / yes -> yes / yes | 0.00 / 0.00 -> 0.00 / 0.00 | 0 / 0 | 0 / 0 |
| bf1918/chemin_des_dames | - -> - | - -> - | 1 / 4 -> 1 / 4 | yes / yes -> yes / yes | 0.00 / 0.00 -> 0.00 / 0.00 | 1 / 1 | 0 / 0 |
| bf1918/dawnville | - -> - | - -> - | 7 / 5 -> 7 / 5 | yes / yes -> yes / yes | 0.00 / 0.00 -> 0.00 / 0.00 | 3 / 3 | 0 / 0 |
| bf1918/fht_meuse_argonne_offensive | - -> - | - -> - | 5 / 5 -> 5 / 5 | yes / yes -> yes / yes | 0.00 / 0.00 -> 0.00 / 0.00 | 1 / 1 | 0 / 0 |
| bf1918/hindenburg_line | - -> - | - -> - | 9 / 4 -> 9 / 4 | yes / yes -> yes / yes | 0.00 / 0.00 -> 0.00 / 0.00 | 7 / 7 | 4 / 4 |
| bf1918/lutte_de_honneur | - -> - | - -> - | 5 / 7 -> 5 / 7 | yes / yes -> yes / yes | 0.00 / 0.00 -> 0.00 / 0.00 | 4 / 4 | 0 / 0 |
| bf1918/mauerfall | - -> - | - -> - | 3 / 3 -> 3 / 3 | **no** / **no** -> **no** / **no** | 0.00 / 0.00 -> 0.00 / 0.00 | 22 / 22 | 1 / 1 |
| bf1918/operation_gericht | - -> - | - -> - | 3 / 8 -> 3 / 8 | yes / yes -> yes / yes | 0.00 / 0.00 -> 0.00 / 0.00 | 1 / 1 | 0 / 0 |
| bf1918/roye | - -> - | - -> - | 3 / 3 -> 3 / 3 | **no** / **no** -> **no** / **no** | 0.19 / 0.00 -> 0.77 / 0.00 | 6 / 5 | 3 / 1 |
| bf1918/saint_quentin_canal | - -> - | - -> - | 10 / 2 -> 10 / 2 | **no** / yes -> **no** / yes | 0.00 / 0.00 -> 0.00 / 0.00 | 0 / 0 | 0 / 0 |
| bf1918/sanaga_river | - -> - | - -> - | 7 / 4 -> 7 / 4 | yes / yes -> yes / yes | 0.00 / 0.00 -> 0.00 / 0.00 | 5 / 5 | 0 / 0 |
| bf1918/scimitar_hill | - -> - | - -> - | 5 / 5 -> 5 / 5 | yes / yes -> yes / yes | 0.00 / 0.00 -> 0.00 / 0.00 | 4 / 4 | 4 / 4 |
| bf1942/_o_jka__ | - -> - | - -> - | 1 / 1 -> 1 / 1 | yes / yes -> yes / yes | 0.00 / 0.00 -> 0.00 / 0.00 | 1 / 1 | 0 / 0 |
| bf1942/_o_jka__big | - -> - | - -> - | 1 / 1 -> 1 / 1 | yes / yes -> yes / yes | 0.00 / 0.00 -> 0.00 / 0.00 | 41 / 41 | 3 / 3 |
| bf1942/aberdeen | - -> - | - -> - | 2 / 2 -> 2 / 2 | **no** / **no** -> **no** / **no** | 0.00 / 0.00 -> 0.00 / 0.00 | 9 / 9 | 2 / 2 |
| bf1942/beinbrekkbakken | - -> - | - -> - | 2 / 2 -> 2 / 2 | **no** / **no** -> **no** / **no** | 0.00 / 0.00 -> 0.00 / 0.00 | 27 / 27 | 2 / 2 |
| bf1942/hop | - -> - | - -> - | 2 / 2 -> 2 / 2 | **no** / **no** -> **no** / **no** | 0.00 / 0.00 -> 0.00 / 0.00 | 94 / 94 | 0 / 0 |
| bf1942/knife_championship | - -> - | Axis -> Axis | 3 / 3 -> 3 / 3 | yes / yes -> yes / yes | 0.00 / 0.00 -> 1.00 / 0.00 | 45 / 50 | 0 / 0 |
| bf1942/koh | - -> - | - -> - | 1 / 1 -> 1 / 1 | yes / yes -> yes / yes | 0.08 / 0.00 -> 0.08 / 0.00 | 16 / 16 | 4 / 4 |
| bf1942/liberation_of_caen | - -> - | - -> - | 9 / 1 -> 9 / 1 | yes / yes -> yes / yes | 0.00 / 0.00 -> 0.00 / 0.00 | 4 / 4 | 1 / 1 |
| bf1942/omaturi_channel_cannon | - -> - | Allies -> Allies | 5 / 3 -> 5 / 3 | yes / yes -> yes / yes | 0.00 / 0.00 -> 0.00 / 1.00 | 0 / 0 | 0 / 0 |
| bf1942/omaturi_channel_sniper | - -> - | - -> - | 1 / 1 -> 1 / 1 | yes / yes -> yes / yes | 0.00 / 0.00 -> 0.00 / 0.00 | 162 / 162 | 0 / 0 |
| bf1942/omaturi_channel_sniper_day2 | - -> - | - -> - | 1 / 1 -> 1 / 1 | yes / yes -> yes / yes | 0.00 / 0.00 -> 0.00 / 0.00 | 8 / 8 | 0 / 0 |
| bf1942/shigaisen_a | - -> - | - -> - | 1 / 1 -> 1 / 1 | yes / yes -> yes / yes | 0.00 / 0.00 -> 0.00 / 0.00 | 9 / 9 | 2 / 2 |
| bf1942/shigaisen_b | - -> - | - -> - | 6 / 7 -> 6 / 7 | yes / yes -> yes / yes | 0.00 / 0.00 -> 0.00 / 0.00 | 95 / 95 | 1 / 1 |
| bf1942/shigaisen_c | - -> - | - -> - | 1 / 1 -> 1 / 1 | yes / yes -> yes / yes | 0.00 / 0.00 -> 0.00 / 0.00 | 0 / 0 | 0 / 0 |
| bf1942/shigaisen_d | - -> - | - -> - | 1 / 1 -> 1 / 1 | yes / yes -> yes / yes | 0.00 / 0.00 -> 0.00 / 0.00 | 0 / 0 | 1 / 1 |
| bf1942/shigaisen_g | - -> - | - -> - | 1 / 1 -> 1 / 1 | yes / yes -> yes / yes | 0.00 / 0.00 -> 0.00 / 0.00 | 44 / 44 | 0 / 0 |
| bf1942/the_bridge | - -> - | - -> - | 2 / 2 -> 2 / 2 | **no** / **no** -> **no** / **no** | 0.00 / 0.00 -> 0.00 / 0.00 | 11 / 11 | 1 / 1 |
| bf1942/the_corridor | - -> - | Axis -> Axis | 1 / 1 -> 1 / 1 | yes / yes -> yes / yes | 0.00 / 0.00 -> 1.00 / 0.00 | 0 / 0 | 2 / 2 |
| bf1942/the_dungeon | - -> - | - -> - | 4 / 4 -> 4 / 4 | yes / yes -> yes / yes | 0.00 / 0.00 -> 0.00 / 0.00 | 0 / 0 | 0 / 0 |
| bf1942/the_fortress | - -> - | Axis -> Axis | 2 / 5 -> 2 / 5 | **no** / yes -> **no** / yes | 0.39 / 0.00 -> 0.74 / 0.00 | 11 / 10 | 1 / 5 |
| bf1942/the_maze | - -> - | - -> - | 1 / 1 -> 1 / 1 | yes / yes -> yes / yes | 0.00 / 0.00 -> 0.00 / 0.00 | 68 / 68 | 8 / 8 |
| bf1942/the_room | - -> - | - -> - | 1 / 4 -> 1 / 4 | yes / yes -> yes / yes | 0.00 / 0.00 -> 0.00 / 0.00 | 0 / 0 | 0 / 0 |
| bf1942/the_street | - -> - | - -> - | 1 / 1 -> 1 / 1 | yes / yes -> yes / yes | 0.00 / 0.00 -> 0.00 / 0.00 | 0 / 0 | 0 / 0 |
| bf1942/the_street_day2 | - -> - | - -> - | 1 / 1 -> 1 / 1 | yes / yes -> yes / yes | 0.00 / 0.00 -> 0.00 / 0.00 | 0 / 0 | 0 / 0 |
| bf1942/the_street_g | - -> - | - -> - | 1 / 1 -> 1 / 1 | yes / yes -> yes / yes | 0.00 / 0.00 -> 0.00 / 0.00 | 65 / 65 | 0 / 0 |
| desertcombat/dc_basrah_nights | - -> - | - -> - | 2 / 2 -> 2 / 2 | **no** / **no** -> **no** / **no** | 0.00 / 0.00 -> 0.00 / 0.00 | 52 / 52 | 5 / 5 |
| desertcombat/dc_battle_of_73_easting | - -> - | - -> - | 5 / 1 -> 5 / 1 | yes / **no** -> yes / **no** | 0.00 / 0.00 -> 0.00 / 0.00 | 12 / 12 | 2 / 2 |
| desertcombat/dc_lostvillage | - -> - | - -> - | 11 / 1 -> 11 / 1 | yes / yes -> yes / yes | 0.00 / 0.00 -> 0.00 / 0.00 | 14 / 14 | 2 / 2 |
| desertcombat/dc_medina_ridge | - -> - | - -> - | 4 / 1 -> 4 / 1 | yes / **no** -> yes / **no** | 0.00 / 0.00 -> 0.00 / 0.00 | 2 / 2 | 0 / 0 |
| desertcombat/dc_oil_fields | - -> - | - -> - | 9 / 1 -> 9 / 1 | yes / yes -> yes / yes | 0.00 / 0.00 -> 0.00 / 0.00 | 1 / 1 | 2 / 2 |
| desertcombat/dc_operation_bragg | - -> - | - -> - | 2 / 3 -> 2 / 3 | **no** / **no** -> **no** / **no** | 0.00 / 0.00 -> 0.00 / 0.00 | 3 / 3 | 1 / 1 |
| desertcombat/dc_urban_siege | - -> - | Allies -> Allies | 4 / 3 -> 4 / 3 | **no** / **no** -> **no** / **no** | 0.00 / 0.26 -> 0.00 / 0.26 | 5 / 5 | 1 / 1 |
| desertcombat/inshallah_valley | - -> - | - -> - | 4 / 2 -> 4 / 2 | yes / **no** -> yes / **no** | 0.00 / 0.00 -> 0.00 / 0.00 | 27 / 27 | 2 / 2 |
| fh/pegasus | - -> - | - -> - | 5 / 1 -> 5 / 1 | yes / **no** -> yes / **no** | 0.15 / 0.05 -> 0.15 / 0.05 | 24 / 24 | 4 / 4 |
| fh/seelow-heights-1945 | - -> - | - -> - | 9 / 1 -> 9 / 1 | yes / yes -> yes / yes | 0.00 / 0.00 -> 0.00 / 0.00 | 1 / 1 | 0 / 0 |
| fhsw/battle_for_ortona-1943 | - -> - | - -> - | 9 / 3 -> 9 / 3 | yes / yes -> yes / yes | 0.00 / 0.00 -> 0.00 / 0.00 | 9 / 9 | 0 / 0 |
| fhsw/battle_of_edson_s_ridge | allied_flag2, allied_flag -> - | Axis -> - | 2 / 14 -> 2 / 14 | **no** / **no** -> **no** / **no** | 1.00 / 0.85 -> 0.00 / 0.00 | 116 / 113 | 1 / 2 |
| fhsw/berlin-1945-streets | - -> - | - -> - | 5 / 1 -> 5 / 1 | yes / **no** -> yes / **no** | 0.00 / 0.00 -> 0.00 / 0.00 | 0 / 0 | 0 / 0 |
| fhsw/bizerte-1943 | - -> - | - -> - | 8 / 1 -> 8 / 1 | yes / yes -> yes / yes | 0.00 / 0.00 -> 0.00 / 0.00 | 5 / 5 | 0 / 0 |
| fhsw/fall_of_berlin-1945 | - -> - | Allies -> Allies | 12 / 7 -> 13 / 7 | **no** / **no** -> **no** / **no** | 0.00 / 1.00 -> 0.84 / 1.00 | 0 / 5 | 1 / 1 |
| fhsw/fht_battle_of_kohima-1944 | - -> - | - -> - | 11 / 5 -> 11 / 5 | **no** / **no** -> **no** / **no** | 0.00 / 0.00 -> 0.00 / 0.00 | 0 / 0 | 0 / 0 |
| fhsw/fht_battle_of_mareth_line-1943 | - -> - | - -> - | 12 / 4 -> 14 / 4 | yes / yes -> yes / yes | 0.00 / 0.00 -> 0.00 / 0.00 | 8 / 8 | 1 / 1 |
| fhsw/monte_cassino-1944 | SECOND_LINE_OF_DEFENSE -> - | - -> - | 7 / 4 -> 9 / 3 | yes / yes -> yes / yes | 0.00 / 0.00 -> 0.00 / 0.00 | 1 / 3 | 1 / 0 |
| fhsw/moscow_outskirts-1941 | - -> - | - -> - | 4 / 11 -> 4 / 12 | yes / yes -> yes / yes | 0.00 / 0.00 -> 0.00 / 0.00 | 15 / 16 | 1 / 2 |
| fhsw/pegasus | Cafe_Gondree -> - | - -> - | 7 / 1 -> 7 / 1 | yes / **no** -> yes / **no** | 0.00 / 0.00 -> 0.00 / 0.00 | 69 / 29 | 0 / 0 |
| fhsw/stalingrad_redsquare | - -> - | - -> - | 12 / 1 -> 12 / 1 | yes / yes -> yes / yes | 0.00 / 0.00 -> 0.00 / 0.00 | 13 / 13 | 0 / 0 |
| fhsw/stalingrad_urban_area-1942 | - -> - | - -> - | 4 / 4 -> 4 / 4 | yes / yes -> yes / yes | 0.00 / 0.00 -> 0.00 / 0.00 | 0 / 0 | 0 / 0 |
| fhsw/the_great_pursuit | 3rd_base -> - | - -> - | 14 / 3 -> 15 / 3 | yes / yes -> yes / yes | 0.00 / 0.00 -> 0.00 / 0.00 | 24 / 12 | 1 / 1 |
| fhsw/tunis-1943 | - -> - | - -> - | 7 / 6 -> 7 / 6 | yes / yes -> yes / yes | 0.00 / 0.00 -> 0.00 / 0.00 | 14 / 14 | 4 / 4 |
| fhsw/ural_mountains-1947 | - -> - | - -> - | 3 / 8 -> 3 / 9 | **no** / **no** -> **no** / **no** | 0.00 / 0.00 -> 0.00 / 0.00 | 0 / 0 | 0 / 0 |
| fhsw/warsaw_uprising | - -> - | - -> - | 2 / 15 -> 2 / 15 | **no** / yes -> **no** / yes | 0.00 / 0.00 -> 0.00 / 0.00 | 0 / 0 | 0 / 0 |
| fhsweurope/aberdeen | - -> - | - -> - | 1 / 1 -> 1 / 1 | yes / yes -> yes / yes | 0.00 / 0.00 -> 0.00 / 0.00 | 21 / 21 | 5 / 5 |

## 4. Before and after, over seeds

All runs: `sim/run.mjs` through scratch `measure.mjs`, the garrison
doctrine, the level's vehicles in, 600 s. "Own-hand deaths" are a side's
deaths less the enemy's kills. "Hold-only share" is the share of strategic
passes where the side had no attack target while a flag in play stood for it
to take.

### 4.1 The live levels (3 seeds, 8 and 16 a side)

| level | a side | seeds | kills before / after | captures before / after | own-hand deaths before / after | hold-only share before -> after (Axis, Allies) | fallback share before -> after | no live strategy before -> after | every figure the same |
|---|---|---|---|---|---|---|---|---|---|
| bf1918/hindenburg_line | 8 | 3 | 35 / 35 | 8 / 8 | 2 / 2 | 0.00, 0.00 -> 0.00, 0.00 | 0.00, 0.00 -> 0.00, 0.00 | 0.00, 0.00 -> 0.00, 0.00 | yes |
| bf1918/hindenburg_line | 16 | 3 | 85 / 85 | 2 / 2 | 7 / 7 | 0.00, 0.00 -> 0.00, 0.00 | 0.00, 0.00 -> 0.00, 0.00 | 0.00, 0.01 -> 0.00, 0.01 | yes |
| bf1918/lutte_de_honneur | 8 | 3 | 25 / 25 | 2 / 2 | 0 / 0 | 0.00, 0.00 -> 0.00, 0.00 | 0.00, 0.00 -> 0.00, 0.00 | 0.00, 0.00 -> 0.00, 0.00 | yes |
| bf1918/lutte_de_honneur | 16 | 3 | 53 / 53 | 3 / 3 | 2 / 2 | 0.00, 0.00 -> 0.00, 0.00 | 0.00, 0.00 -> 0.00, 0.00 | 0.00, 0.00 -> 0.00, 0.00 | yes |
| bf1918/scimitar_hill | 8 | 3 | 32 / 32 | 14 / 14 | 3 / 3 | 0.00, 0.00 -> 0.00, 0.00 | 0.00, 0.00 -> 0.00, 0.00 | 0.00, 0.00 -> 0.00, 0.00 | yes |
| bf1918/scimitar_hill | 16 | 3 | 100 / 100 | 13 / 13 | 4 / 4 | 0.00, 0.00 -> 0.00, 0.00 | 0.00, 0.00 -> 0.00, 0.00 | 0.00, 0.00 -> 0.00, 0.00 | yes |
| bf1942/aberdeen | 8 | 3 | 111 / 111 | 7 / 7 | 5 / 5 | 0.00, 0.00 -> 0.00, 0.00 | 0.00, 0.00 -> 0.00, 0.00 | 0.20, 0.25 -> 0.20, 0.25 | yes |
| bf1942/aberdeen | 16 | 3 | 246 / 246 | 7 / 7 | 11 / 11 | 0.00, 0.00 -> 0.00, 0.00 | 0.00, 0.00 -> 0.00, 0.00 | 0.19, 0.21 -> 0.19, 0.21 | yes |
| bf1942/beinbrekkbakken | 8 | 3 | 126 / 126 | 10 / 10 | 9 / 9 | 0.00, 0.00 -> 0.00, 0.00 | 0.00, 0.00 -> 0.00, 0.00 | 1.00, 1.00 -> 1.00, 1.00 | yes |
| bf1942/beinbrekkbakken | 16 | 3 | 707 / 707 | 13 / 13 | 36 / 36 | 0.00, 0.00 -> 0.00, 0.00 | 0.00, 0.00 -> 0.00, 0.00 | 1.00, 1.00 -> 1.00, 1.00 | yes |
| bf1942/hop | 8 | 3 | 523 / 523 | 0 / 0 | 10 / 10 | 0.00, 0.00 -> 0.00, 0.00 | 0.00, 0.00 -> 0.00, 0.00 | 1.00, 1.00 -> 1.00, 1.00 | yes |
| bf1942/hop | 16 | 3 | 848 / 848 | 0 / 0 | 19 / 19 | 0.00, 0.00 -> 0.00, 0.00 | 0.00, 0.00 -> 0.00, 0.00 | 1.00, 1.00 -> 1.00, 1.00 | yes |
| bf1942/koh | 8 | 3 | 92 / 92 | 19 / 19 | 13 / 13 | 0.00, 0.00 -> 0.00, 0.00 | 0.25, 0.00 -> 0.25, 0.00 | 0.87, 0.64 -> 0.87, 0.64 | yes |
| bf1942/koh | 16 | 3 | 241 / 241 | 18 / 18 | 37 / 37 | 0.00, 0.00 -> 0.00, 0.00 | 0.11, 0.00 -> 0.11, 0.00 | 0.87, 0.68 -> 0.87, 0.68 | yes |
| bf1942/shigaisen_b | 8 | 3 | 281 / 281 | 2 / 2 | 11 / 11 | 0.00, 0.00 -> 0.00, 0.00 | 0.00, 0.00 -> 0.00, 0.00 | 0.00, 0.00 -> 0.00, 0.00 | yes |
| bf1942/shigaisen_b | 16 | 3 | 612 / 612 | 0 / 0 | 39 / 39 | 0.00, 0.00 -> 0.00, 0.00 | 0.00, 0.00 -> 0.00, 0.00 | 0.00, 0.00 -> 0.00, 0.00 | yes |
| bf1942/the_maze | 8 | 3 | 364 / 364 | 32 / 32 | 12 / 12 | 0.00, 0.00 -> 0.00, 0.00 | 0.00, 0.00 -> 0.00, 0.00 | 0.62, 0.75 -> 0.62, 0.75 | yes |
| bf1942/the_maze | 16 | 3 | 754 / 754 | 26 / 26 | 32 / 32 | 0.00, 0.00 -> 0.00, 0.00 | 0.00, 0.00 -> 0.00, 0.00 | 0.91, 0.52 -> 0.91, 0.52 | yes |
| desertcombat/dc_basrah_nights | 8 | 3 | 95 / 121 | 18 / 24 | 11 / 19 | 0.29, 0.39 -> 0.26, 0.29 | 0.00, 0.00 -> 0.26, 0.29 | 0.26, 0.22 -> 0.29, 0.29 | **no** |
| desertcombat/dc_basrah_nights | 16 | 3 | 328 / 286 | 21 / 21 | 93 / 103 | 0.24, 0.40 -> 0.24, 0.32 | 0.00, 0.00 -> 0.24, 0.32 | 0.18, 0.27 -> 0.18, 0.34 | **no** |
| desertcombat/dc_battle_of_73_easting | 8 | 3 | 87 / 87 | 14 / 14 | 5 / 5 | 0.00, 0.00 -> 0.00, 0.00 | 0.00, 0.00 -> 0.00, 0.00 | 0.31, 0.94 -> 0.31, 0.94 | yes |
| desertcombat/dc_battle_of_73_easting | 16 | 3 | 202 / 202 | 11 / 11 | 15 / 15 | 0.00, 0.00 -> 0.00, 0.00 | 0.00, 0.00 -> 0.00, 0.00 | 0.29, 1.00 -> 0.29, 1.00 | yes |
| desertcombat/dc_lostvillage | 8 | 3 | 119 / 119 | 24 / 24 | 36 / 36 | 0.00, 0.00 -> 0.00, 0.00 | 0.00, 0.00 -> 0.00, 0.00 | 0.00, 0.00 -> 0.00, 0.00 | yes |
| desertcombat/dc_lostvillage | 16 | 3 | 289 / 289 | 10 / 10 | 125 / 125 | 0.00, 0.00 -> 0.00, 0.00 | 0.00, 0.00 -> 0.00, 0.00 | 0.00, 0.00 -> 0.00, 0.00 | yes |
| desertcombat/dc_oil_fields | 8 | 3 | 17 / 17 | 10 / 10 | 19 / 19 | 0.00, 0.00 -> 0.00, 0.00 | 0.00, 0.00 -> 0.00, 0.00 | 0.00, 0.00 -> 0.00, 0.00 | yes |
| desertcombat/dc_oil_fields | 16 | 3 | 67 / 67 | 9 / 9 | 39 / 39 | 0.00, 0.00 -> 0.00, 0.00 | 0.00, 0.00 -> 0.00, 0.00 | 0.00, 0.00 -> 0.00, 0.00 | yes |
| desertcombat/inshallah_valley | 8 | 3 | 169 / 169 | 8 / 8 | 6 / 6 | 0.00, 0.00 -> 0.00, 0.00 | 0.00, 0.00 -> 0.00, 0.00 | 0.00, 0.49 -> 0.00, 0.49 | yes |
| desertcombat/inshallah_valley | 16 | 3 | 420 / 420 | 5 / 5 | 44 / 44 | 0.00, 0.00 -> 0.00, 0.00 | 0.00, 0.00 -> 0.00, 0.00 | 0.00, 0.40 -> 0.00, 0.40 | yes |
| fh/pegasus | 8 | 3 | 78 / 78 | 9 / 9 | 2 / 2 | 0.00, 0.00 -> 0.00, 0.00 | 0.40, 0.01 -> 0.40, 0.01 | 0.86, 1.00 -> 0.86, 1.00 | yes |
| fh/pegasus | 16 | 3 | 201 / 201 | 9 / 9 | 27 / 27 | 0.00, 0.00 -> 0.00, 0.00 | 0.04, 0.15 -> 0.04, 0.15 | 0.56, 1.00 -> 0.56, 1.00 | yes |
| fhsw/battle_for_ortona-1943 | 8 | 3 | 58 / 58 | 3 / 3 | 4 / 4 | 0.00, 0.00 -> 0.00, 0.00 | 0.00, 0.00 -> 0.00, 0.00 | 0.00, 0.00 -> 0.00, 0.00 | yes |
| fhsw/battle_for_ortona-1943 | 16 | 3 | 118 / 110 | 3 / 4 | 27 / 21 | 0.00, 0.00 -> 0.00, 0.00 | 0.00, 0.00 -> 0.00, 0.00 | 0.00, 0.00 -> 0.00, 0.00 | **no** |
| fhsw/fht_battle_of_mareth_line-1943 | 8 | 3 | 50 / 41 | 3 / 3 | 7 / 6 | 0.00, 0.00 -> 0.00, 0.00 | 0.00, 0.00 -> 0.00, 0.00 | 0.00, 0.00 -> 0.00, 0.00 | **no** |
| fhsw/fht_battle_of_mareth_line-1943 | 16 | 3 | 120 / 101 | 4 / 3 | 10 / 9 | 0.00, 0.00 -> 0.00, 0.00 | 0.00, 0.00 -> 0.00, 0.00 | 0.00, 0.00 -> 0.00, 0.00 | **no** |
| fhsw/moscow_outskirts-1941 | 8 | 3 | 72 / 65 | 7 / 12 | 14 / 20 | 0.00, 0.00 -> 0.00, 0.00 | 0.00, 0.00 -> 0.00, 0.00 | 0.00, 0.00 -> 0.00, 0.00 | **no** |
| fhsw/moscow_outskirts-1941 | 16 | 3 | 198 / 148 | 9 / 13 | 32 / 36 | 0.00, 0.00 -> 0.00, 0.00 | 0.00, 0.00 -> 0.00, 0.00 | 0.00, 0.00 -> 0.00, 0.00 | **no** |
| fhsw/stalingrad_redsquare | 8 | 3 | 60 / 60 | 7 / 7 | 1 / 1 | 0.00, 0.00 -> 0.00, 0.00 | 0.00, 0.00 -> 0.00, 0.00 | 0.00, 0.00 -> 0.00, 0.00 | yes |
| fhsw/stalingrad_redsquare | 16 | 3 | 174 / 174 | 19 / 19 | 5 / 5 | 0.00, 0.00 -> 0.00, 0.00 | 0.00, 0.00 -> 0.00, 0.00 | 0.00, 0.00 -> 0.00, 0.00 | yes |
| fhsw/the_great_pursuit | 8 | 3 | 69 / 91 | 6 / 3 | 0 / 1 | 0.00, 0.00 -> 0.00, 0.00 | 0.00, 0.00 -> 0.00, 0.00 | 0.00, 0.00 -> 0.00, 0.00 | **no** |
| fhsw/the_great_pursuit | 16 | 3 | 182 / 273 | 4 / 3 | 2 / 1 | 0.00, 0.00 -> 0.00, 0.00 | 0.00, 0.00 -> 0.00, 0.00 | 0.00, 0.00 -> 0.00, 0.00 | **no** |
| fhsw/tunis-1943 | 8 | 3 | 47 / 47 | 18 / 18 | 7 / 7 | 0.00, 0.00 -> 0.00, 0.00 | 0.00, 0.00 -> 0.00, 0.00 | 0.00, 0.05 -> 0.00, 0.05 | yes |
| fhsw/tunis-1943 | 16 | 3 | 151 / 151 | 6 / 6 | 24 / 24 | 0.00, 0.00 -> 0.00, 0.00 | 0.00, 0.00 -> 0.00, 0.00 | 0.00, 0.00 -> 0.00, 0.00 | yes |

**The Maze and Tunis-1943, the two the owner has played and liked: every
measured figure is the same at both sizes, on all three seeds.** So are 14
of the other 19 live levels.

The binding moves no flag on either of them, the count is unchanged, and the
fallback never fires on them. The Maze's out-of-play flags `3` and `4` are
not sent at while a strategy is live (section 2). Counting them took The
Maze's sides 5 to 7 % of the match and nearly doubled its own-hand deaths,
before that clause was narrowed.

**Changed, worse first:**

- **Mareth Line**: kills fell from 50 to 41 at 8 a side and from 120 to 101
  at 16; captures went from 3 to 3 and from 4 to 3.
- **Moscow Outskirts**: kills fell from 72 to 65 and from 198 to 148, but
  captures rose from 7 to 12 and from 9 to 13.
- **DC_Basrah_Nights** is mixed:
  - At 8 a side it is better: kills 95 to 121, captures 18 to 24, own-hand
    deaths 11 to 19.
  - At 16 a side kills fell from 328 to 286, with captures 21 both times and
    own-hand deaths 93 to 103.
  - The seeds spread widely. One 16-a-side seed alone goes from 155 to 118;
    the other two are within 6.
  - The Axis or the Allies spend 32 to 79 % of a match on the no-layer
    order. Their own areas then touch no flag they could take while flags
    in play stand: the fallback's second clause.
- **Battle for Ortona**, 16 a side: kills 118 to 110, captures 3 to 4,
  own-hand deaths 27 to 21. It is the same at 8.
- **The Great Pursuit** is better on kills, worse on captures: kills 69 to
  91 and 182 to 273, captures 6 to 3 and 4 to 3.

**Why Mareth, Moscow and The Great Pursuit move: the binding, on the side
that defends.** In each, one side starts holding every flag the other must
take: Mareth's Axis, Moscow's Allies, The Great Pursuit's Axis. Before, a
stand-in beside one of those flags shared its area. The area then read
neither side's, so the defending side's strategy "attacked" its own flag. Bound as the engine binds, those areas
are the defender's. The defender now has no attack target: the SAI keeps its
bots where they stand (`retainBot`), the garrison guards each flag, and they
fight where the attacker comes to them. That is the engine's play for a
defending side. On Mareth and Moscow fewer of those fights happen. On The
Great Pursuit more happen. The Great Pursuit's third base, which lay in no
area before, is now one the Allies attack.

### 4.2 The dead and quiet levels (3 seeds, 8 a side)

| level | a side | seeds | kills before / after | captures before / after | own-hand deaths before / after | hold-only share before -> after (Axis, Allies) | fallback share before -> after | no live strategy before -> after | every figure the same |
|---|---|---|---|---|---|---|---|---|---|
| bf1918/fht_meuse_argonne_offensive | 8 | 3 | 23 / 23 | 0 / 0 | 15 / 15 | 0.00, 0.00 -> 0.00, 0.00 | 0.00, 0.00 -> 0.00, 0.00 | 0.00, 0.00 -> 0.00, 0.00 | yes |
| bf1918/mauerfall | 8 | 3 | 112 / 112 | 2 / 2 | 8 / 8 | 0.00, 0.00 -> 0.00, 0.00 | 0.00, 0.00 -> 0.00, 0.00 | 1.00, 1.00 -> 1.00, 1.00 | yes |
| bf1918/roye | 8 | 3 | 17 / 27 | 6 / 5 | 15 / 25 | 0.06, 0.00 -> 0.00, 0.00 | 0.12, 0.07 -> 0.71, 0.06 | 1.00, 1.00 -> 1.00, 1.00 | **no** |
| bf1942/shigaisen_c | 8 | 3 | 0 / 0 | 0 / 0 | 0 / 0 | 0.00, 0.00 -> 0.00, 0.00 | 0.00, 0.00 -> 0.00, 0.00 | 0.00, 0.00 -> 0.00, 0.00 | yes |
| bf1942/the_bridge | 8 | 3 | 62 / 62 | 5 / 5 | 0 / 0 | 0.00, 0.00 -> 0.00, 0.00 | 0.00, 0.00 -> 0.00, 0.00 | 1.00, 1.00 -> 1.00, 1.00 | yes |
| bf1942/the_fortress | 8 | 3 | 63 / 77 | 10 / 21 | 9 / 11 | 0.33, 0.00 -> 0.68, 0.00 | 0.33, 0.00 -> 0.68, 0.00 | 0.33, 0.00 -> 0.68, 0.00 | **no** |
| bf1942/the_street | 8 | 3 | 0 / 0 | 0 / 0 | 0 / 0 | 0.00, 0.00 -> 0.00, 0.00 | 0.00, 0.00 -> 0.00, 0.00 | 0.00, 0.00 -> 0.00, 0.00 | yes |
| desertcombat/dc_medina_ridge | 8 | 3 | 34 / 34 | 0 / 0 | 1 / 1 | 0.00, 0.00 -> 0.00, 0.00 | 0.00, 0.00 -> 0.00, 0.00 | 0.00, 1.00 -> 0.00, 1.00 | yes |
| desertcombat/dc_urban_siege | 8 | 3 | 15 / 18 | 4 / 4 | 17 / 10 | 0.00, 0.27 -> 0.00, 0.13 | 0.00, 0.27 -> 0.00, 0.13 | 1.00, 1.00 -> 1.00, 1.00 | **no** |
| fhsw/battle_of_edson_s_ridge | 8 | 3 | 344 / 366 | 3 / 6 | 18 / 3 | 1.00, 0.00 -> 0.00, 0.00 | 1.00, 0.83 -> 0.00, 0.00 | 1.00, 1.00 -> 1.00, 1.00 | **no** |
| fhsw/berlin-1945-streets | 8 | 3 | 0 / 0 | 2 / 2 | 0 / 0 | 0.56, 0.00 -> 0.56, 0.00 | 0.56, 0.56 -> 0.56, 0.56 | 0.56, 1.00 -> 0.56, 1.00 | yes |
| fhsw/bizerte-1943 | 8 | 3 | 32 / 32 | 0 / 0 | 6 / 6 | 0.00, 0.00 -> 0.00, 0.00 | 0.00, 0.00 -> 0.00, 0.00 | 0.00, 0.00 -> 0.00, 0.00 | yes |
| fhsw/fall_of_berlin-1945 | 8 | 3 | 3 / 20 | 3 / 3 | 1 / 2 | 0.00, 1.00 -> 0.00, 1.00 | 0.00, 1.00 -> 0.92, 1.00 | 1.00, 1.00 -> 1.00, 1.00 | **no** |
| fhsw/pegasus | 8 | 3 | 98 / 76 | 0 / 0 | 1 / 5 | 0.00, 0.00 -> 0.00, 0.00 | 0.00, 0.00 -> 0.00, 0.00 | 0.00, 1.00 -> 0.00, 1.00 | **no** |
| fhsw/warsaw_uprising | 8 | 3 | 4 / 0 | 0 / 0 | 4 / 4 | 0.00, 0.00 -> 0.00, 0.00 | 0.00, 0.00 -> 0.00, 0.00 | 1.00, 0.00 -> 1.00, 0.00 | **no** |

"Before" here already has the no-live-strategy fallback, so Edson's Ridge
fought before too. Now it fights on the SAI.

- **Better.**
  - **Edson's Ridge.** The fallback no longer holds the Axis: the binding
    gives them both Allied flags to attack, and they take them. Kills went
    from 344 to 366, captures doubled (3 to 6), and own-hand deaths fell
    from 18 to 3.
  - **The Fortress.** Kills went from 63 to 77 and captures from 10 to 21.
    The Axis base links to no area, so they are held 68 % of the match and
    walk to the flags.
  - **DC_Urban_Siege.** Kills went from 15 to 18, and own-hand deaths fell
    from 17 to 10.
  - **Fall of Berlin.** Kills went from 3 to 20, still near dead. Its two
    sides now both take the no-layer order most of the match. Every flag but
    two is out of play, and those two are not reached on the area graph.
- **Mixed.**
  - **Roye.** Kills went from 17 to 27 and captures from 6 to 5, but
    own-hand deaths went from 15 to 25: the Axis spend 71 % of the match on
    the no-layer order now.
- **Worse.**
  - **FHSW Pegasus.** Kills fell from 98 to 76 and own-hand deaths rose
    from 1 to 5, with no captures either way. The binding put Cafe Gondree
    back in its area, so the Axis' strategy attacks it, where before it
    attacked elsewhere.
  - **Warsaw Uprising.** Kills fell from 4 to 0; it was dead before.
- **Unchanged and still dead or quiet.** the_street, shigaisen_C,
  Berlin-1945-Streets, DC_Medina_Ridge, Bizerte, Meuse-Argonne, the_bridge
  and Mauerfall, every figure the same. Their sides either have a target, or
  have no flag in play to take with a strategy live: the generator took
  every flag of the_street and shigaisen_C out of play (stacked floors).
  What keeps the others quiet is not the strategic layer (section 8).

## 5. The engine's `ControlPoint` count, measured and not made

Section 1 gives the engine's count: control points only. The page's count
adds two things, the stand-ins and each owned area typed `ControlPoint`
again. Both were tried, against the same "before" (origin/main) and on the
same live levels: 3 seeds, 8 a side, 600 s. The binding and the hold-only
fallback were in both.

**The engine's count in full (both terms out):**

| level | a side | seeds | kills before / after | captures before / after | own-hand deaths before / after |
|---|---|---|---|---|--- |
| bf1942/aberdeen | 8 | 3 | 111 / 66 | 7 / 10 | 5 / 7 |
| bf1942/beinbrekkbakken | 8 | 3 | 126 / 126 | 10 / 10 | 9 / 9 |
| bf1942/hop | 8 | 3 | 523 / 497 | 0 / 0 | 10 / 7 |
| bf1942/koh | 8 | 3 | 92 / 86 | 19 / 19 | 13 / 12 |
| bf1942/shigaisen_b | 8 | 3 | 281 / 281 | 2 / 2 | 11 / 11 |
| bf1942/the_maze | 8 | 3 | 364 / 364 | 32 / 32 | 12 / 12 |
| bf1942/the_maze | 16 | 3 | 754 / 754 | 26 / 26 | 32 / 32 |
| desertcombat/dc_basrah_nights | 8 | 3 | 95 / 209 | 18 / 24 | 11 / 14 |
| desertcombat/dc_battle_of_73_easting | 8 | 1 | 30 / 30 | 5 / 5 | 4 / 4 |
| desertcombat/dc_lostvillage | 8 | 3 | 119 / 86 | 24 / 15 | 36 / 28 |
| desertcombat/inshallah_valley | 8 | 3 | 169 / 143 | 8 / 20 | 6 / 11 |
| fhsw/tunis-1943 | 8 | 3 | 47 / 43 | 18 / 11 | 7 / 5 |

DC_LostVillage lost 28 % of its kills and 37 % of its captures, and Tunis
39 % of its captures. Aberdeen lost 40 % of its kills, though its captures
went from 7 to 10. DC_Basrah_Nights and Inshallah_Valley got better, but
part of that is the fallback: Basrah's Axis are hold-only for a quarter of
the match.

**The stand-ins out, the area term kept:**

| level | a side | seeds | kills before / after | captures before / after | own-hand deaths before / after |
|---|---|---|---|---|--- |
| bf1918/hindenburg_line | 8 | 1 | 7 / 7 | 5 / 5 | 1 / 1 |
| bf1942/aberdeen | 8 | 3 | 111 / 111 | 7 / 7 | 5 / 5 |
| bf1942/beinbrekkbakken | 8 | 3 | 126 / 126 | 10 / 10 | 9 / 9 |
| bf1942/hop | 8 | 3 | 523 / 523 | 0 / 0 | 10 / 10 |
| bf1942/koh | 8 | 3 | 92 / 86 | 19 / 19 | 13 / 12 |
| bf1942/shigaisen_b | 8 | 3 | 281 / 281 | 2 / 2 | 11 / 11 |
| bf1942/the_maze | 8 | 3 | 364 / 364 | 32 / 32 | 12 / 12 |
| desertcombat/dc_basrah_nights | 8 | 3 | 95 / 121 | 18 / 24 | 11 / 19 |
| desertcombat/dc_battle_of_73_easting | 8 | 3 | 87 / 87 | 14 / 14 | 5 / 5 |
| desertcombat/dc_lostvillage | 8 | 3 | 119 / 119 | 24 / 24 | 36 / 36 |
| desertcombat/dc_oil_fields | 8 | 3 | 17 / 17 | 10 / 10 | 19 / 19 |
| desertcombat/inshallah_valley | 8 | 3 | 169 / 169 | 8 / 8 | 6 / 6 |
| fh/pegasus | 8 | 2 | 55 / 51 | 6 / 3 | 0 / 1 |
| fhsw/battle_for_ortona-1943 | 8 | 3 | 58 / 31 | 3 / 1 | 4 / 2 |
| fhsw/fht_battle_of_mareth_line-1943 | 8 | 3 | 50 / 40 | 3 / 4 | 7 / 4 |
| fhsw/moscow_outskirts-1941 | 8 | 3 | 72 / 60 | 7 / 9 | 14 / 15 |
| fhsw/stalingrad_redsquare | 8 | 3 | 60 / 60 | 7 / 7 | 1 / 1 |
| fhsw/the_great_pursuit | 8 | 3 | 69 / 74 | 6 / 8 | 0 / 3 |
| fhsw/tunis-1943 | 8 | 3 | 47 / 48 | 18 / 17 | 7 / 5 |

Most levels are unchanged. Battle for Ortona lost half its kills (58 to 31)
and Mareth Line a fifth. Ortona's Allies hold their base alone and two
stand-ins. Without the stand-ins they count 1, so Kharkov's `bridge`
qualifies (aggression 0.5, one defence) and `finalPush` does not.

**Why neither is made here.** The generated layers' templates are DICE's,
written for the engine's count. They were chosen, tuned and judged under the
page's count: `templateFor`, every verdict and both bars. With the engine's
count a strategy comes alive at a different number of flags than the one
each level's template was picked for. Two live levels the owner likes lost
captures, and the area term also moves DICE's four levels and so every bar.
The count should change together with the generator's template choice
(`botgen.mjs templateFor`, out of scope here) and a rebuilt bar. Until then
it stays the page's, labelled in `_updateStates` and in KNOBS.md as
INVENTION, with the engine's reading beside it.

A lead for that change. Kharkov's condition names do not match their
values: `max2CPCond` is `Equal 1`, `min4CpCond` is `EqualGreater 3`, and
`oneCPOrLessCond` is `Equal 0`. Each name's number is its value plus one.
Retail's DICE may have counted something besides the control points, or the
names may simply be stale. Not settled.

## 6. DICE's four levels

Berlin, Stalingrad, Kharkov and Bocage, on foot and with vehicles, 8 and 16
a side, seeds 1 to 3, 300 s, garrison, sampling every 10th tick: **48 of 48
traces byte-identical** before and after (sha256 of `trace.jsonl`). Every
tick sampled, with vehicles, 8 a side, seed 1, 300 s: **4 of 4
identical.**

The binding moves only a level that places a stand-in, and DICE's four place
none. The fallback is gated on `ai.generated`. The `ControlPoint` count is
unchanged. The levels that could move are DICE's with ship decks (Midway,
Wake, Coral Sea, Iwo Jima, Guadalcanal's airfield groups). There a stand-in
no longer joins an area that holds a control point. They were not run.

## 7. The page

The_Maze is not in this machine's local maps tree: its folder in the mesh
cache is empty. So the page match was played on a DICE level instead.

The page was served from this branch's viewer, by a static server over a
scratch folder linking the viewer's files and the local mesh cache's maps,
models and textures. The match was Berlin, Conquest, 16 bots, 120 s, played
headless with `sim/pagematch.mjs --url`.

The page loaded and played: 23 kills (10 Axis, 13 Allies), 3 Axis team
kills, no page errors. That says only that the page runs with the change.
Berlin's strategic play is the same code path before and after
(section 6).

## 8. What is left

- **The `ControlPoint` count** is still the page's (section 5). The engine's
  count is known, from the decompile only. Making it needs the generator's
  template choice redone for it (`botgen.mjs templateFor`), and DICE's bars
  rebuilt, because the area term moves DICE's own levels.
- **Six sides with nothing to attack while a flag in play stands**, held by
  the fallback now:
  - Knife Championship's Axis
  - Omaturi Channel Cannon's Allies
  - The Corridor's Axis
  - The Fortress's Axis
  - DC_Urban_Siege's Allies
  - Fall of Berlin's Allies

  The cause is the generated area graph: the side's own areas neighbour no
  area it may take, because the walk test's route links skip them. The page
  covers it; the generator's neighbour links are the fix.
- **Levels that stay dead with every strategic figure the same.** For
  the_street, its two day variants and shigaisen_C, every flag is out of
  play (stacked floors). For Berlin-1945-Streets, DC_Medina_Ridge, Bizerte
  and Meuse-Argonne, the sides have targets, so the strategic layer is not
  what keeps them quiet. Their causes are the earlier sections of the README
  (routes, walls, vehicles).
- **Changes to explain or decide on.** FHSW Pegasus lost a fifth of its
  kills when Cafe Gondree came back into its area. Mareth Line lost 18 % of
  its kills, and The Great Pursuit traded captures for kills (6 to 3, 69 to
  91), both from the binding. Roye's own-hand deaths rose under the
  fallback.
- **Ship decks on DICE's levels** (section 6): not run.

## 9. Not verified

- **The engine's `ControlPoint` count** is read from the third-party
  decompile, not from our own binary in Ghidra. That vt+0x94 is
  `getNumberOfControlPoints` is inferred. No ledger row was added.
- **The dead and quiet levels** were run at 8 a side only (3 seeds, 600 s).
  The live levels were run at 8 and 16.
- **No level was taken through the 10-seed matrix or judged.** No
  `verdict.json` moves, and no page match was played on a generated level:
  The_Maze is not in the local maps tree, and the page match was Berlin.
- **The scratch trees** are the committed layers of 591df3968's day,
  applied with `--no-archives`. main has since added and removed layers
  (other sessions' work), and those were not measured.
- **"Every figure the same"** compares the measured match figures (kills,
  deaths, captures, tickets, strategy changes), not the traces, for the
  generated levels. Only DICE's four were compared trace by trace.
