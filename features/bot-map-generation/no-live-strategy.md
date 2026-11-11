# A side with no live strategy, 2026-11-11

Generated layers copy DICE's strategy templates unchanged (`few` is Kursk's,
`symmetric` Kharkov's; README sections 5, 14 and 19.5). Both were written for
a start where each side holds its base alone. On a level that starts some
other way, no strategy may qualify for a side: every prerequisite scores 0.
Battle of Edson's Ridge (FHSW) is the case that showed it. The Axis start on
two fixed bases and the Allies hold all three capturable flags. Under Kursk's
template no strategy qualifies for either side, and the level is dead: 0
kills and 0 captures, every bot ordered to its own base for the whole match.

This note measures how far that goes across the 64 generated layers, sets
out the rule now in the page's strategic AI, and gives the before and after.

## 1. What the engine does, and what was really holding Edson's Ridge

**Retail.** `SAI::chooseStrategy` 0x08631cd0 (ledger AI-38;
`bf1942-ai-research-2026-09-21/bot-behaviours.md` section 7;
`bf1942-ai-spec/strategic.md` section 3) runs a roulette over the strategies
with a positive score. When none is positive it keeps the strategy it already
has. It has no fallback order. The page does the same: `StrategicAI` starts
each side on its first strategy and keeps it. El Alamein's own layer lives
like this all match (strategic.md).

**Edson's Ridge.** On Edson's Ridge the Axis keep Kursk's `breakOut` (one
attack, aggression 1), and `breakOut` still attacks whatever the area values
offer. Holding at base needs a second fault on top of the empty roulette: the
side must also have **no attack target**. On Edson's Ridge neither side has
one, because of how the flags are bound to areas:

- Each Allied flag (`allied_flag`, `allied_flag2`) owns no soldier spawn, so
  the page makes it a capture-only flag (`spawn-flags.js captureZone`).
- The Allies' spawn groups that no control point claims (`sbsoldierspawn66`
  to `79`) become standalone flags, uncapturable, listed ahead of the
  capture-only ones.
- `StrategicLayer.bindFlags` binds the standalone flags first, by nearest
  area. A capture-only flag is then bound the engine's way
  (`controlPointAreaAt`: only into an area that holds no point yet). Each
  flag area already holds a stand-in, so neither real flag lands in any area.
- Both flag areas then hold only uncapturable stand-ins. `takeableBy` is
  false for both, and `_attackValue` is 0 everywhere.

The engine binds an area only to a control point (`BFEnvironment::
findControlPoint` 0x085e53a0). A standalone spawn-group flag is the page's
own idea. Section 5 says what is left of this.

The same counting inflates `ControlPoint`. The page counts every world flag,
standalone ones included, plus each owned area typed `ControlPoint`, so the
Allies "hold 14". That alone would keep Kursk's `single` and `double` dead on
this level.

## 2. The measurement (step 1)

One garrison match per layer, run from the committed `bot-layers/` and
applied with `patch_scene.py --layer ai --no-archives` to a scratch copy of
each tree. Settings: 8 a side, 300 s, seed 1, the level's vehicles in.
`measure.mjs` (scratch, `bots/n1/scripts`) samples each side at every
strategic pass (every 2 s):

- whether any strategy scores above 0 (a **live** strategy);
- whether the SAI found any attack target;
- whether the new fallback held the side.

"Before" is origin/main at 78d4d592e, frozen as a copy of the viewer. "After"
is this change.

Headline, 64 layers:

- **22** start with at least one side that has no live strategy, and **13**
  start with both sides in that state.
- **25** have a side with no live strategy at some point in the match.
- **18** have a side with no live strategy for the whole match.
- **7** sides on 6 levels start with no live strategy **and** nothing to
  attack. On these the template leaves bots holding: Saint Quentin Canal
  (Axis), The Fortress (Axis), DC_Urban_Siege (Allies), Edson's Ridge (both),
  Fall of Berlin (Allies) and Kohima (Axis, which holds every capturable flag
  and is defending).
- **26** sides on 21 levels have a **live** strategy and still nothing to
  attack at the start, a different fault (section 5).
- **14** levels end the match with a capture-only flag bound to no area
  (section 1's binding), The_Maze and Tunis among them.

On most of the 18 levels a side has no live strategy all match, yet it still
fights: the kept strategy attacks. Examples are Mauerfall, hop,
beinbrekkbakken, the_bridge, DC_Operation_Bragg and Ural Mountains. On these
the empty roulette is not what keeps the level quiet.

Columns: whether each side has a live strategy at the first pass; the share of passes with none; the share with no attack target; kills (both sides' totals as Axis / Allies) and captures, before; then after this change, the share of passes the fallback held each side, kills and captures. One seed, so a level's kills move with chance. The fallback fires on 7 levels; on the other 57, and on Koh (held for 8 % of the Axis' passes, no figure moved), every measured figure is the same before and after.

| mod | level | template | live at start, Axis / Allies | no live strategy, share of passes, Axis / Allies | no attack target, Axis / Allies | kills | captures | fallback share after, Axis / Allies | after: kills | after: captures |
|---|---|---|---|---|---|---|---|---|---|---|
| bf1918 | battle_of_cambrai | symmetric | yes / yes | 0.00 / 0.00 | 0.00 / 0.00 | 0 / 0 | 0 | 0.00 / 0.00 | 0 / 0 | 0 |
| bf1918 | chemin_des_dames | symmetric | yes / yes | 0.00 / 0.00 | 0.00 / 0.00 | 0 / 1 | 0 | 0.00 / 0.00 | 0 / 1 | 0 |
| bf1918 | dawnville | symmetric | yes / yes | 0.00 / 0.00 | 0.00 / 0.00 | 3 / 0 | 0 | 0.00 / 0.00 | 3 / 0 | 0 |
| bf1918 | fht_meuse_argonne_offensive | symmetric | yes / yes | 0.00 / 0.00 | 0.00 / 0.00 | 0 / 1 | 0 | 0.00 / 0.00 | 0 / 1 | 0 |
| bf1918 | hindenburg_line | symmetric | yes / yes | 0.00 / 0.00 | 0.00 / 0.00 | 4 / 3 | 4 | 0.00 / 0.00 | 4 / 3 | 4 |
| bf1918 | lutte_de_honneur | symmetric | yes / yes | 0.00 / 0.00 | 0.00 / 0.00 | 2 / 2 | 0 | 0.00 / 0.00 | 2 / 2 | 0 |
| bf1918 | mauerfall | few | **no** / **no** | 1.00 / 1.00 | 0.00 / 0.00 | 3 / 19 | 1 | 0.00 / 0.00 | 3 / 19 | 1 |
| bf1918 | operation_gericht | symmetric | yes / yes | 0.00 / 0.00 | 0.00 / 0.00 | 1 / 0 | 0 | 0.00 / 0.00 | 1 / 0 | 0 |
| bf1918 | roye | few | **no** / **no** | 1.00 / 1.00 | 0.19 / 0.00 | 4 / 1 | 1 | 0.19 / 0.00 | 6 / 0 | 3 |
| bf1918 | saint_quentin_canal | few | **no** / yes | 1.00 / 0.00 | 0.74 / 0.00 | 0 / 0 | 0 | 0.00 / 0.00 | 0 / 0 | 0 |
| bf1918 | sanaga_river | symmetric | yes / yes | 0.00 / 0.00 | 0.00 / 0.00 | 2 / 3 | 0 | 0.00 / 0.00 | 2 / 3 | 0 |
| bf1918 | scimitar_hill | symmetric | yes / yes | 0.00 / 0.00 | 0.00 / 0.00 | 2 / 2 | 4 | 0.00 / 0.00 | 2 / 2 | 4 |
| bf1942 | _o_jka__ | symmetric | yes / yes | 0.00 / 0.00 | 0.00 / 0.00 | 0 / 1 | 0 | 0.00 / 0.00 | 0 / 1 | 0 |
| bf1942 | _o_jka__big | symmetric | yes / yes | 0.00 / 0.00 | 0.07 / 0.52 | 26 / 15 | 3 | 0.00 / 0.00 | 26 / 15 | 3 |
| bf1942 | aberdeen | symmetric | **no** / **no** | 0.26 / 0.60 | 0.00 / 0.00 | 2 / 7 | 2 | 0.00 / 0.00 | 2 / 7 | 2 |
| bf1942 | beinbrekkbakken | few | **no** / **no** | 1.00 / 1.00 | 0.00 / 0.00 | 16 / 11 | 2 | 0.00 / 0.00 | 16 / 11 | 2 |
| bf1942 | hop | few | **no** / **no** | 1.00 / 1.00 | 0.00 / 0.00 | 54 / 40 | 0 | 0.00 / 0.00 | 54 / 40 | 0 |
| bf1942 | knife_championship | symmetric | yes / yes | 0.00 / 0.00 | 1.00 / 0.00 | 19 / 26 | 0 | 0.00 / 0.00 | 19 / 26 | 0 |
| bf1942 | koh | few | yes / yes | 0.73 / 0.67 | 0.08 / 0.00 | 10 / 6 | 4 | 0.08 / 0.00 | 10 / 6 | 4 |
| bf1942 | liberation_of_caen | symmetric | yes / yes | 0.00 / 0.00 | 0.41 / 0.00 | 2 / 2 | 1 | 0.00 / 0.00 | 2 / 2 | 1 |
| bf1942 | omaturi_channel_cannon | symmetric | yes / yes | 0.00 / 0.00 | 1.00 / 1.00 | 0 / 0 | 0 | 0.00 / 0.00 | 0 / 0 | 0 |
| bf1942 | omaturi_channel_sniper | symmetric | yes / yes | 0.00 / 0.00 | 0.00 / 0.00 | 63 / 99 | 0 | 0.00 / 0.00 | 63 / 99 | 0 |
| bf1942 | omaturi_channel_sniper_day2 | symmetric | yes / yes | 0.00 / 0.00 | 1.00 / 1.00 | 8 / 0 | 0 | 0.00 / 0.00 | 8 / 0 | 0 |
| bf1942 | shigaisen_a | symmetric | yes / yes | 0.00 / 0.00 | 0.17 / 0.00 | 5 / 4 | 2 | 0.00 / 0.00 | 5 / 4 | 2 |
| bf1942 | shigaisen_b | symmetric | yes / yes | 0.00 / 0.00 | 0.00 / 0.00 | 58 / 37 | 1 | 0.00 / 0.00 | 58 / 37 | 1 |
| bf1942 | shigaisen_c | symmetric | yes / yes | 0.00 / 0.00 | 1.00 / 1.00 | 0 / 0 | 0 | 0.00 / 0.00 | 0 / 0 | 0 |
| bf1942 | shigaisen_d | symmetric | yes / yes | 0.00 / 0.00 | 0.00 / 0.00 | 0 / 0 | 1 | 0.00 / 0.00 | 0 / 0 | 1 |
| bf1942 | shigaisen_g | symmetric | yes / yes | 0.00 / 0.00 | 0.00 / 0.00 | 27 / 17 | 0 | 0.00 / 0.00 | 27 / 17 | 0 |
| bf1942 | the_bridge | few | **no** / **no** | 1.00 / 1.00 | 0.00 / 0.00 | 3 / 8 | 1 | 0.00 / 0.00 | 3 / 8 | 1 |
| bf1942 | the_corridor | symmetric | yes / yes | 0.00 / 0.00 | 1.00 / 0.85 | 0 / 0 | 2 | 0.00 / 0.00 | 0 / 0 | 2 |
| bf1942 | the_dungeon | symmetric | yes / yes | 0.00 / 0.00 | 0.00 / 0.00 | 0 / 0 | 0 | 0.00 / 0.00 | 0 / 0 | 0 |
| bf1942 | the_fortress | symmetric | **no** / yes | 0.82 / 0.00 | 0.82 / 0.18 | 0 / 6 | 2 | 0.39 / 0.00 | 3 / 8 | 1 |
| bf1942 | the_maze | few | yes / yes | 0.56 / 0.78 | 0.00 / 0.00 | 34 / 34 | 8 | 0.00 / 0.00 | 34 / 34 | 8 |
| bf1942 | the_room | symmetric | yes / yes | 0.00 / 0.00 | 0.00 / 1.00 | 0 / 0 | 0 | 0.00 / 0.00 | 0 / 0 | 0 |
| bf1942 | the_street | symmetric | yes / yes | 0.00 / 0.00 | 1.00 / 1.00 | 0 / 0 | 0 | 0.00 / 0.00 | 0 / 0 | 0 |
| bf1942 | the_street_day2 | symmetric | yes / yes | 0.00 / 0.00 | 1.00 / 1.00 | 0 / 0 | 0 | 0.00 / 0.00 | 0 / 0 | 0 |
| bf1942 | the_street_g | symmetric | yes / yes | 0.00 / 0.00 | 1.00 / 1.00 | 17 / 48 | 0 | 0.00 / 0.00 | 17 / 48 | 0 |
| desertcombat | dc_basrah_nights | symmetric | **no** / **no** | 0.81 / 0.62 | 0.00 / 0.00 | 21 / 31 | 5 | 0.00 / 0.00 | 21 / 31 | 5 |
| desertcombat | dc_battle_of_73_easting | few | yes / **no** | 0.26 / 1.00 | 0.66 / 0.00 | 3 / 9 | 2 | 0.00 / 0.00 | 3 / 9 | 2 |
| desertcombat | dc_lostvillage | symmetric | yes / yes | 0.00 / 0.00 | 0.80 / 0.00 | 8 / 6 | 2 | 0.00 / 0.00 | 8 / 6 | 2 |
| desertcombat | dc_medina_ridge | few | yes / **no** | 0.00 / 1.00 | 1.00 / 0.00 | 1 / 1 | 0 | 0.00 / 0.00 | 1 / 1 | 0 |
| desertcombat | dc_oil_fields | symmetric | yes / yes | 0.00 / 0.00 | 0.00 / 0.00 | 1 / 0 | 2 | 0.00 / 0.00 | 1 / 0 | 2 |
| desertcombat | dc_operation_bragg | few | **no** / **no** | 1.00 / 1.00 | 0.00 / 0.00 | 3 / 0 | 1 | 0.00 / 0.00 | 3 / 0 | 1 |
| desertcombat | dc_urban_siege | few | **no** / **no** | 1.00 / 1.00 | 0.00 / 1.00 | 0 / 0 | 0 | 0.00 / 0.26 | 3 / 2 | 1 |
| desertcombat | inshallah_valley | symmetric | yes / **no** | 0.00 / 0.38 | 0.00 / 0.00 | 15 / 12 | 2 | 0.00 / 0.00 | 15 / 12 | 2 |
| fh | pegasus | few | yes / **no** | 0.67 / 1.00 | 0.48 / 0.48 | 19 / 7 | 2 | 0.15 / 0.05 | 18 / 6 | 4 |
| fh | seelow-heights-1945 | symmetric | yes / yes | 0.00 / 0.00 | 1.00 / 0.00 | 0 / 1 | 0 | 0.00 / 0.00 | 0 / 1 | 0 |
| fhsw | battle_for_ortona-1943 | symmetric | yes / yes | 0.00 / 0.00 | 0.00 / 0.00 | 5 / 4 | 0 | 0.00 / 0.00 | 5 / 4 | 0 |
| fhsw | battle_of_edson_s_ridge | few | **no** / **no** | 1.00 / 1.00 | 1.00 / 1.00 | 0 / 0 | 0 | 1.00 / 0.85 | 37 / 79 | 1 |
| fhsw | berlin-1945-streets | few | yes / **no** | 0.00 / 1.00 | 1.00 / 0.00 | 0 / 0 | 0 | 0.00 / 0.00 | 0 / 0 | 0 |
| fhsw | bizerte-1943 | symmetric | yes / yes | 0.00 / 0.00 | 0.00 / 0.00 | 3 / 2 | 0 | 0.00 / 0.00 | 3 / 2 | 0 |
| fhsw | fall_of_berlin-1945 | few | **no** / **no** | 1.00 / 1.00 | 0.00 / 1.00 | 0 / 0 | 0 | 0.00 / 1.00 | 0 / 0 | 1 |
| fhsw | fht_battle_of_kohima-1944 | few | **no** / **no** | 1.00 / 1.00 | 1.00 / 0.00 | 0 / 0 | 0 | 0.00 / 0.00 | 0 / 0 | 0 |
| fhsw | fht_battle_of_mareth_line-1943 | symmetric | yes / yes | 0.00 / 0.00 | 0.00 / 0.00 | 4 / 4 | 1 | 0.00 / 0.00 | 4 / 4 | 1 |
| fhsw | monte_cassino-1944 | symmetric | yes / yes | 0.00 / 0.00 | 1.00 / 0.00 | 0 / 1 | 1 | 0.00 / 0.00 | 0 / 1 | 1 |
| fhsw | moscow_outskirts-1941 | symmetric | yes / yes | 0.00 / 0.00 | 0.00 / 0.00 | 11 / 4 | 1 | 0.00 / 0.00 | 11 / 4 | 1 |
| fhsw | pegasus | few | yes / **no** | 0.00 / 1.00 | 1.00 / 0.00 | 67 / 2 | 0 | 0.00 / 0.00 | 67 / 2 | 0 |
| fhsw | stalingrad_redsquare | symmetric | yes / yes | 0.00 / 0.00 | 1.00 / 0.00 | 12 / 1 | 0 | 0.00 / 0.00 | 12 / 1 | 0 |
| fhsw | stalingrad_urban_area-1942 | symmetric | yes / yes | 0.00 / 0.00 | 0.00 / 0.00 | 0 / 0 | 0 | 0.00 / 0.00 | 0 / 0 | 0 |
| fhsw | the_great_pursuit | symmetric | yes / yes | 0.00 / 0.00 | 0.00 / 0.00 | 7 / 17 | 1 | 0.00 / 0.00 | 7 / 17 | 1 |
| fhsw | tunis-1943 | symmetric | yes / yes | 0.00 / 0.25 | 0.23 / 0.00 | 7 / 7 | 4 | 0.00 / 0.00 | 7 / 7 | 4 |
| fhsw | ural_mountains-1947 | few | **no** / **no** | 1.00 / 1.00 | 0.00 / 0.00 | 0 / 0 | 0 | 0.00 / 0.00 | 0 / 0 | 0 |
| fhsw | warsaw_uprising | symmetric | **no** / yes | 1.00 / 0.00 | 0.00 / 1.00 | 0 / 0 | 0 | 0.00 / 0.00 | 0 / 0 | 0 |
| fhsweurope | aberdeen | symmetric | yes / yes | 0.00 / 0.00 | 0.00 / 0.00 | 15 / 6 | 5 | 0.00 / 0.00 | 15 / 6 | 5 |

## 3. The rule

INVENTION, labelled in `viewer/strategic-ai.js` `_noLiveStrategyFallback`
and in `bf1942-ai-spec/KNOBS.md` ("no live strategy").

The rule applies on a generated layer only (`ai.generated`, the marker the
bake copies from `generated.json`). At a strategic pass, a side falls back
when all three of these hold:

- none of its strategies scores above 0;
- the strategy it keeps finds no attack target above `SAI.candidateMin`, or
  has NumberOfAttacks 0;
- a capturable flag the side does not hold still stands.

When it falls back, every bot of the side is released: no order, no
assignment, and a garrison post is given up to `lastPost`. `StrategicCommand`
drops the side's orders whatever its doctrine, and its gun rule is off
(`noLayerOrder`, `gunsRuleOf`). The referee copies the flag onto the bot
(`bot.noLayerOrder`, one line in `bot-referee.js`). `bot-decision.js
fallbackWaypoint` then gives the bot the order a level with no layer gives:
the nearest flag its side does not hold. The first pass where any clause
fails hands the side back to the SAI.

A layer DICE or a mod team wrote is never touched. Retail has no such rule,
so the gate stays.

**Why the attack-target clause.** The rule was first built as asked: no live
strategy, so the no-layer order. Run over all 64 layers (seed 1, 8 a side,
300 s), it took over The_Maze for 56 % of the Axis' passes and 78 % of the
Allies'. The Maze's kills fell from 68 to 29 and its captures from 8 to 3.
DC_Basrah_Nights' kills fell from 52 to 36, and FH Pegasus' from 26 to 0.
These levels fight on the kept strategy. What was broken on Edson's Ridge is
a side ordered only to hold, and that is what the clause catches. The
capturable-flag clause leaves a side that already holds everything to the
SAI. With nothing to take, the no-layer order would stand it idle anyway.

## 4. Before and after

All runs: the runner (`sim/run.mjs` through scratch `measure.mjs`), the
garrison doctrine, with the level's vehicles. "Before" is the frozen viewer
of 78d4d592e; "after" this change.

### 4.1 Edson's Ridge and five other levels the fallback touches

600 s a match, seeds 1 to 3. The five others were chosen from section 2's
levels where the fallback fires, and run at 8 a side only; the machine was
shared and slow. "Ordered to own area" is the share of alive bot samples
holding an order into an area their side holds. "Heading at an enemy flag"
is the share whose order is into an area the side does not hold, or (no
order, fallback on) whose no-layer flag exists. Kills are both sides', all
causes.

| level | a side | seeds | kills before / after | captures before / after | kills a bot-minute before / after | no live strategy (Axis, Allies) | fallback share after (Axis, Allies) | ordered to own area before / after (Axis, Allies) | heading at an enemy flag before / after (Axis, Allies) |
|---|---|---|---|---|---|---|---|---|---|
| bf1918/roye | 8 | 3 | 29 / 17 | 3 / 6 | 0.06 / 0.04 | 1.00, 1.00 | 0.12, 0.07 | 0.08, 0.00 / 0.00, 0.00 | 0.92, 1.00 / 1.00, 1.00 |
| bf1918/roye | 16 | 3 | 59 / 60 | 4 / 4 | 0.06 / 0.06 | 1.00, 1.00 | 0.34, 0.00 | 0.11, 0.00 / 0.00, 0.00 | 0.87, 1.00 / 1.00, 1.00 |
| bf1942/the_fortress | 8 | 3 | 46 / 63 | 9 / 10 | 0.10 / 0.13 | 0.54, 0.00 | 0.33, 0.00 | 0.28, 0.32 / 0.01, 0.42 | 0.67, 0.65 / 0.98, 0.51 |
| desertcombat/dc_urban_siege | 8 | 3 | 6 / 15 | 1 / 4 | 0.01 / 0.03 | 1.00, 1.00 | 0.00, 0.27 | 0.13, 0.78 / 0.12, 0.09 | 0.87, 0.18 / 0.88, 0.91 |
| fh/pegasus | 8 | 3 | 66 / 78 | 4 / 9 | 0.14 / 0.16 | 0.86, 1.00 | 0.40, 0.01 | 0.66, 0.18 / 0.11, 0.33 | 0.29, 0.74 / 0.86, 0.60 |
| fhsw/battle_of_edson_s_ridge | 8 | 3 | 0 / 344 | 0 / 3 | 0.00 / 1.73 | 1.00, 1.00 | 1.00, 0.83 | 1.00, 0.99 / 0.00, 0.15 | 0.00, 0.00 / 1.00, 0.80 |
| fhsw/battle_of_edson_s_ridge | 16 | 3 | 0 / 798 | 2 / 3 | 0.00 / 1.93 | 1.00, 1.00 | 1.00, 0.83 | 0.93, 0.99 / 0.00, 0.15 | 0.07, 0.00 / 1.00, 0.80 |
| fhsw/fall_of_berlin-1945 | 8 | 3 | 0 / 3 | 0 / 3 | 0.00 / 0.01 | 1.00, 1.00 | 0.00, 1.00 | 0.12, 0.99 / 0.12, 0.00 | 0.88, 0.01 / 0.87, 1.00 |

- **Edson's Ridge: from no fight to a fight.** Before: 0 kills in six
  matches. Both sides were ordered into their own areas 93 to 100 % of the
  time; the 2 captures at 16 a side (one each in seeds 1 and 2) were the Axis', with no kill in any match.
  After: 344 kills at 8 a side and 798 at 16, which is 1.73 and 1.93 kills a
  bot-minute (the census match with no layer: 1.36). There were 3 captures
  at each size. The fallback holds the Axis all match and the Allies for 83 %
  of it; the Allies return to the SAI once the Axis take a flag and give
  them a target. Captures stay few: the Allies' flags are 3 m capture rings
  on a ridge, and kills outnumber captures heavily.
- **DC_Urban_Siege** (Allies held 27 %): kills went from 6 to 15 and
  captures from 1 to 4.
- **Fall of Berlin** (Allies held all match): kills went from 0 to 3 and
  captures from 0 to 3. Its fault is mostly elsewhere. The Reichstag's two
  flags are the binding of section 1, and the level stays near dead.
- **FH Pegasus** (Axis held 40 %): kills went from 66 to 78 and captures
  from 4 to 9.
- **The Fortress** (Axis held 33 %): kills went from 46 to 63 and captures
  from 9 to 10.
- **Roye** (Axis held 12 % at 8 a side, 34 % at 16) is mixed. At 8 a side
  kills fell from 29 to 17 while captures rose from 3 to 6. At 16 a side
  kills went from 59 to 60, with 4 captures both times. Both sides there
  keep Kursk's first strategy all match and mostly attack. The fallback
  takes the Axis only when their areas give no target, and then sends them
  at the nearest flag, which is not always where the fight is.

### 4.2 The four live levels

The_Maze, DC_LostVillage, Tunis-1943 and DC_Basrah_Nights, with vehicles,
8 and 16 a side, seeds 1 to 3, 600 s (`--trace-every 10`): **24 of 24
traces byte-identical** before and after. The fallback never fires on them.
On The_Maze and DC_Basrah_Nights a side spends much of the match with no
live strategy (section 2), but the kept strategy always has a target. These
are the matches that the first version of the rule, without the
attack-target clause, made worse (section 3).

### 4.3 DICE's four levels

Berlin, Stalingrad, Kharkov and Bocage, on foot and with vehicles, 8 and 16
a side, seeds 1 to 3, 300 s (`--trace-every 10`): **48 of 48 traces
byte-identical** before and after (sha256 of `trace.jsonl`). The rule is
gated on `ai.generated`, and these layers are DICE's.

### 4.4 Tests

`tools/bf1942-models/tests/test_bot_no_live_strategy.py` runs the harness
`bot_no_live_strategy_harness.mjs`. It covers four cases: a generated
layer's side with no live strategy and nothing to attack (Edson's shape)
takes the fallback, and the SAI takes it back when a target appears; a side
with no live strategy and a target (The Maze's case) keeps the SAI; a
shipped layer of Edson's shape keeps the engine's rule; and the bot takes
the no-layer order only when told. It also tests the lint's warnings.
`./scripts/verify.sh --skip-e2e` passes.

## 5. What is left

- **A live strategy with nothing to attack.** 26 sides on 21 levels start in
  this state, outside this rule's gate, among them every `the_street*`,
  shigaisen_C and both omaturi levels at 1.00 for both sides. Several of them
  are the binding below.
- **The binding.** In `StrategicLayer.bindFlags`, a standalone (spawn-group)
  flag can take a capture-only control point's area. 14 levels end the census
  match with a capture-only flag bound to no area. The engine-faithful
  binding would bind control points first and keep standalone flags out of
  any area that holds one. Separately, the page counts standalone flags in
  `ControlPoint` where the engine counts only control points. Neither is
  changed here. Both move every level that has such flags, The_Maze and Tunis
  among them, so each needs its own before and after.
- **Edson's Ridge after the fallback** is the no-layer level for most of the
  match. Its Allies get a target back once the Axis take a flag. It is no
  judged verdict: the matrix and the page match were not rerun, and its
  `verdict.json` still says fail.

## 6. A generator-side fix, and whether it is still worth it

The generator could write a template whose strategy set always holds one live
attack strategy. One example: a strategy with no prerequisite (it scores 1),
aggression 1 and one or two attacks, beside the template's own. Then the
roulette would never be empty. README 19.4 tried a one-strategy template of
that kind on shigaisen_B: no capture in twenty matches, the same as Kursk's.
The template was not that level's cause.

It would not have fixed Edson's Ridge either. A live strategy there still
finds no attack target, because of the binding in section 1. Worse, with the
fallback in place it would undo it: a strategy that always scores keeps the
fallback off, and Edson's Ridge's sides would stand at their bases again.
Everywhere else it would only change the levels where the kept strategy
already attacks, which are the ones that play.

So it is worth doing only as part of a template chosen for the level's
start: which side holds what when the round opens. That is not as a cure for
dead levels, and only after the binding is made the engine's. The lint's new
warning (section 7) names every level where it would matter.

## 7. The lint

`sim/botlint.mjs` warns (`check: 'strategy'`, never an error) for each side
with no live strategy at the start. The warning names what the kept strategy
attacks, or says it finds nothing and, on a generated layer, that the side
takes the no-layer order (`liveStrategiesAtStart`). On Edson's Ridge it
warns for both sides. The census and the generator's reports carry it
through `lintLevel`.

## 8. Not verified

- **In the page.** Nothing was played in a browser. The page and the runner
  share `strategic-ai.js`, `doctrine.js`, `bot-decision.js` and
  `bot-referee.js`, but a page match (`pagematch.mjs`) was not run.
- **The size of the evidence.** Section 2 is one seed a level. The five
  other affected levels were run at 8 a side only (3 seeds, 600 s), not at
  16. No affected level was taken through the 10-seed matrix or judged, so
  no `verdict.json` moves.
- **Captures.** On Edson's Ridge, kills rose a lot but captures did not
  (3 in three matches at each size). Whether that is the 3 m rings or
  something else was not looked into.
- **Retail.** What retail does with no strategy scoring is the repo's
  reading of `chooseStrategy` (AI-38), not a lab round. No retail level was
  checked for a side whose kept strategy finds no target.
- **The binding and `ControlPoint` counting** (section 5) were found, not
  fixed.
- **The trees.** The scratch trees were patched from the committed layers
  with `--no-archives`. Three layers that had no generated block in their
  scratch scene took no cover values: bf1942 aberdeen, fhsw fall_of_berlin
  and fhsweurope aberdeen. Their bots take cover on low ground rather than
  behind objects, the same before and after.
