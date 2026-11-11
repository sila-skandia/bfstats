# Wide levels: why the bots died with no enemy near them (2026-11-11)

The wide vehicle levels were held back by one figure: most of the worse
side's losses were not the enemy's doing. On the live page vanilla Aberdeen
showed 0.72 and 0.97 of them in two matches; the runner showed 0.83 at 8 a
side and 0.69 at 16. Nobody knew what the deaths were. This note measures
them, fixes the cause, and gives the figures before and after.

**In short.** On Aberdeen 95 % of those removals at 8 a side, and 86 % at
16, were hulls burnt out by the combat area: Allied tanks driving from the
British base to the East outpost across a tongue of terrain material 7, the
"Reserved (Outside map)" ground the combat area damages (ledger CA-5), and
dying 10 s plus about 10 s later. The engine's own search-map painter blocks
that material (AI-27, AI-93: "one designated material"; DICE's baked maps
block every metre of material 7 on all three DICE levels that paint it). The
page's painter, which every generated layer runs on, did not. It does now,
for the bots' maps. On Aberdeen the deaths no enemy caused, worse side, fell
from 0.80 to 0.12 at 8 a side and from 0.72 to 0.15 at 16 (ten seeds each),
self deaths from 0.21 to 0.02 a bot-minute, and enemy kills rose from 0.11
to 0.26 and from 0.15 to 0.27. DICE's four levels, which ship their own maps,
are byte for byte the same matches.

## 1. How it was measured

Tools, scratch, not in the repo:

* `probe.mjs`: a seeded match exactly as `sim/run.mjs` plays it (the same
  `Match`, the garrison doctrine, the level's vehicles), with
  `Armor.prototype.damage` wrapped so every hit point a soldier or a hull
  loses is logged with its call site (the stack's viewer frames:
  `combatTick`, `collideBodies`, `applyVehicleHit`, `VehicleDamageSet.update`
  and so on), and every kill or redeploy recorded with the bot's seat,
  behaviour, order and its last 20 s of positions.
* `breakdown.py`: every removal no enemy caused (a kill with no killer or by
  the victim, a team kill, a redeploy) classed by the site that took the most
  hit points in the 20 s before it, from the victim's own Armor on foot and
  from their hull's when they died in one (`weapon: "hull <template>"`).
* `detail7.py`: the combat-area deaths in detail (seat, behaviour, order,
  place, seconds mounted, seconds on the material, distance moved).
* `check7.mjs`: on a level that ships baked search maps, the share of its
  material-7 terrain each map blocks, against the rest.
* `map7.mjs`, `navcmp.mjs`, `navdraw.mjs`, `hullroute.mjs`, `statat.mjs`: the
  material map drawn, the painted maps' free cells with and without the
  rule, the page's own hull map and its routes, the statics at a point.
* `drive.mjs`, `table.py`, `bar.mjs`, `shacmp.py`: the seed matrices (`sim/
  run.mjs`, `--doctrine garrison`, 600 s, `sim/detect.mjs` on each), the
  before/after tables, DICE's vehicle bar (`sim/baselines/vehicles-dice.json`
  through `judge.mjs judge`), and the trace hashes of two runs compared.

"Before" is the viewer at `b55ee75f5`; "after" the same with the fix. The
trees: vanilla Aberdeen with its generated layer (generator 5,
`bot-layers/bf1942/aberdeen`, the City flag excluded), FHSW's Mareth Line and
The Great Pursuit with their scratch census layers, DICE's four levels from
the published tree.

## 2. What the deaths were

### 2.1 Aberdeen, before

Seeds 1 to 3 at each size, 600 s:

| Cause | 8 a side | share | 16 a side | share | Axis : Allies |
|---|---|---|---|---|---|
| a hull burnt out by the combat area (material 7) | 105 | 95.5 % | 178 | 86.4 % | 18 : 265 |
| a hull hit to critical by the enemy, then burnt down (no killer, AI-76) | 1 | 0.9 % | 13 | 6.3 % | 12 : 2 |
| the no-progress redeploy | 1 | 0.9 % | 11 | 5.3 % | 1 : 11 |
| team kill | 1 | 0.9 % | 4 | 1.9 % | 0 : 5 |
| a hull's own damage clock (tilt, water) | 2 | 1.8 % | 0 | | 0 : 2 |
| all removals no enemy caused | 110 | | 206 | | |
| for scale: enemy kills | 58 | | 151 | | |

The combat-area deaths, all six matches (292 bot deaths in 6 matches;
`detail7.py`):

| | |
|---|---|
| side | Allies 267, Axis 25 |
| seat | driver 202, crew 90 (a hull's death kills its whole crew) |
| hull | Sherman 224, M10 42, Priest 13, PanzerIV 8, Wespe 4, Tiger 1 |
| behaviour at death | MoveTo 138, Scout 86, Fire 47 |
| order | East_Village (the East outpost) 252, the own base 25 |
| place | within 60 m of (830, -700): the tongue of material 7 that cuts into the playable ground 200 m north-west of the British base |
| seconds in the seat before death | median 39 (p10 2, p90 67) |
| seconds on the material before death | median 20: the 10 s grace, then 5 HP a second (CA-2) |
| moving in the last 6 s | median 20 m: most were driving across, not parked |

Aberdeen's terrain is a third material 7 (`map7.mjs`): a clean surround
round one pocket, with a notch of it between z -640 and -750 east of x 720.
The straight line from the British base (897, -914) to the East outpost
(647, -558) crosses it, and the painted maps the bots route on showed it as
open desert, so the Allied hulls' routes ran across it. Axis hulls, whose
base is on the far side of the map, rarely met it. On foot the bots walked
across it too, but a soldier crosses 100 m of it in under 16 s; a tank
taking the long way round a crest or stopping to fire does not.

None of the other candidates was large: the no-progress redeploy was 1 % and
5 % of the removals; aircraft into the ground, hulls into water, bail-outs
and damage from the bot's own hull did not appear at all on Aberdeen.

### 2.2 FHSW, before

FHSW's wide levels in the scratch tree (`bots/tree-mods/fhsw`) with their
census layers (section 21's re-census). Two were run, chosen for being
wide and open: `fht_battle_of_mareth_line-1943` (2 km, desert, its pocket a
rectangle with nothing of material 7 inside) and `the_great_pursuit` (92 %
of its terrain is material 7).

| Level, side size, seeds | removals no enemy caused | the redeploy | combat area | other | enemy kills |
|---|---|---|---|---|---|
| Mareth Line, 8, seeds 1-3 | 22 | 21 (95 %) | 0 | 1 Spitfire into the ground | 52 |
| The Great Pursuit, 8, seed 1 | 10 | 9 (90 %) | 0 | 1 team kill | 60 |
| Tunis-1943 (live), 16, seed 1 | 55 | 50 (91 %), 31 of them one bot | 0 | 5 team kills | 46 |

So the FHSW levels do not share Aberdeen's cause: their bots never died on
the material, and their removals no enemy caused are almost all the
no-progress redeploy, which the page does not count as a death (section
4.4 has the shares; Tunis is 0.14 on the page). On Mareth they are one bot, over and
over: a soldier walking a dock in Sidra (a drivable deck, material 92, at
96.3 to 98.9 m, the terrain 93.4 under it) is held at x 901.4 against the
deck's edge, which the painted map shows as open ground on both sides
(`navdraw.mjs`: free cells across it; `statat.mjs`: the deck alone there),
redeployed after 12 s, and walks the same route back into the same edge.
Four times a match in seed 1.

## 3. The fix: the bots' painted maps block the ground outside the map

Two commits: `e467bcfb7` (painted maps) and `3382d8ad9` (loaded maps).

`viewer/nav-map.js buildNavMap` takes `impassableMaterial`; on a painted land
map (a level with no baked map of its own) every terrain cell of that
material is blocked (`CELL_MATERIAL`, code 7), after the deck pass and before
the brush, so the brush grows it as it grows every terrain cell and a deck
over it frees nothing. A water map has no such test (the engine's water
branch has none, AI-93). `OUTSIDE_MAP_MATERIAL` is 7. The bots' builders pass
it: the soldiers' map (`bot-referee.js referee.spawn`) and the hulls' maps
(`bot-units.js vehicleNav` and `typeNav`).

**What the engine does.** The rule is the engine's: `LocalMap::update`
0x085fe090's terrain pass blocks a land pixel "of one designated material"
(AI-27, AI-93; game object 0x1d4c1 +0x2c0), and the binary reading left the
id open (`bf1942-ai-research-2026-09-21/bot-movement-and-pathfinding.md`,
"Still open"). It was measured instead, on the levels' own maps
(`check7.mjs`, one sample every 4 m):

| Level | material-7 samples | blocked by Tank0 / Infantry1 / Car4 | the rest of the ground blocked |
|---|---|---|---|
| Kharkov | 24,020 | 100 % / 100 % / 100 % | 64 % / 55 % / 72 % |
| Berlin | 259,537 | 100 % / 100 % / 100 % | 77 % / 53 % / 79 % |
| Stalingrad | 60,888 | 100 % / 100 % / 100 % | 54 % / 26 % / 59 % |
| Bocage | none painted | | |

Not one metre of material 7 is free on any of DICE's maps, so the designated
material is 7, the one the combat area burns on (CA-5). The research had
noted Market Garden's and Omaha's maps "block everything outside an oval
around the play area (INFERRED the combat area)"; this is that.

**What is INVENTION.** The id is measured, not read. The pass runs after the
deck pass (the engine's order of the material test against its object pass
was not read; after it, a deck over the ground outside the map frees
nothing, which is what the combat area's damage says a player meets). The
generator's walk test (`sim/botgen.mjs`, `walkflood.mjs`, not mine to
change) does not pass the option and paints as before; see section 6. Listed
in `features/bf1942-ai-spec/KNOBS.md` ("impassable material").

**A loaded map too.** The same pass runs over a map the level loads
(`nav-baked.js`), on its free cells only and with no brush. On DICE's maps
it changes no cell (they block all of it already: the table above, and
section 4.3's matches replay byte for byte). It is there for the generated
layers that carry a `pathfinding/` of their own: those maps are the
generator's (`walkMap.source` "walk test" and a Tank0 "from the page
painter", `sim/botgen.mjs`), painted without the rule, and the bots load
them as if the engine had. Tunis-1943's, live since today, leaves 18 % of its
material 7 free on Infantry1 and 77 % on Tank0 (`check7.mjs`; 81 % of the
level is material 7). INVENTION: that a loaded map which leaves the
material free was not the engine's.

**What it changes.** A level that ships its own maps from the engine is
unchanged: DICE's four levels replay byte for byte (section 4.3). On Aberdeen the soldiers' map loses
296,000 of its 928,000 free cells and the tanks' 277,000 of 873,000, all of
it outside the pocket (`navcmp.mjs`); on The Great Pursuit, 3.16 M of 3.44 M.
No soldier spawn and one object spawn of 123 stand on the material on those
two levels.

**Why not a softer rule.** The redeploy and the combat area's damage could
have been taught to turn a bot round when the "leaving the combat area"
countdown starts. That is what a player does, and it may still be wanted for
the bots' own steering off the route (Scout, TakeCover, a fire approach),
but no such death was left to fix after the map change (section 4.1: none
on six matches), and the map is where the engine draws the line.

**Unit tests** (`tests/test_bot_outside_map.py` with
`tests/bot_outside_map_harness.mjs`): on a toy level with a tongue of
material 7, the painted map blocks it with the option and not without; the
brush grows it one metre; a water map ignores it; a deck over it stays
blocked; a loaded map that leaves it free has it blocked, and one that
blocks it already (as DICE's do) is unchanged cell for cell; a route between two points either
side of the tongue's tip crosses it without the option and goes round with
it; and both builders in `bot-referee.js` and `bot-units.js` pass it.

## 4. Before and after

### 4.1 What the deaths are after

Aberdeen, the same seeds 1 to 3 (`probe.mjs` on the fixed viewer):

| Cause | 8 a side | 16 a side |
|---|---|---|
| combat area | 105 -> **0** | 178 -> **0** |
| a hull hit to critical by the enemy, then burnt down (no killer) | 1 -> 6 | 13 -> 22 |
| the no-progress redeploy | 1 -> 3 | 11 -> 6 |
| team kill | 1 -> 3 | 4 -> 5 |
| a hull's own damage clock, or its own splash | 2 -> 0 | 0 -> 2 |
| all removals no enemy caused | 110 -> **12** | 206 -> **35** |
| enemy kills | 58 -> **133** | 151 -> **224** |

The largest that is left, the hull burnt down after the enemy brought it to
its critical hit points, is the engine's own scoring: the bleed has no
attacker, so nobody is credited (AI-76, confirmed), and the crew's death is
a suicide there too. It grows because there are more fights.

### 4.2 Aberdeen, ten seeds at each size

`sim/run.mjs`, 600 s, the garrison, with vehicles, seeds 1 to 10; mean over
the seeds (min to max):

| Figure | 8 a side before | after | 16 a side before | after |
|---|---|---|---|---|
| deaths no enemy caused, Axis | 0.23 (0-0.57) | 0.08 (0-0.19) | 0.26 (0.08-0.41) | 0.13 (0.05-0.20) |
| deaths no enemy caused, Allies | 0.80 (0.63-0.92) | **0.07** (0-0.20) | 0.72 (0.62-0.84) | **0.10** (0.03-0.17) |
| deaths no enemy caused, worse side | 0.80 (0.63-0.92) | **0.12** (0-0.20) | 0.72 (0.62-0.84) | **0.15** (0.07-0.20) |
| self deaths a bot-minute | 0.215 (0.13-0.31) | **0.016** (0-0.026) | 0.212 (0.18-0.25) | **0.025** (0.006-0.046) |
| redeploys a bot-minute | 0.001 | 0.003 | 0.014 | 0.006 |
| team kills a bot-minute | 0.001 | 0.003 | 0.004 | 0.004 |
| enemy kills a bot-minute | 0.105 (0.05-0.16) | **0.256** (0.10-0.35) | 0.145 (0.09-0.20) | **0.273** (0.10-0.37) |
| captures a match | 2.4 | 2.4 | 2.0 | 2.3 |
| route failures a bot-minute | 0.43 | 0.39 | 0.37 | 0.17 |
| hull stuck s a driving minute | 7.6 (4.5-12.8) | 7.0 (4.4-11.0) | 0.28 | 0.42 |

Against DICE's vehicle bar (`judge.mjs`, medians):

| | before fails | after fails |
|---|---|---|
| 8 a side | self deaths 0.222 (bar 0.065), route failures 0.42 (0.25) and worse side, enemy kills 0.110 (at least 0.240), flag coverage 0.29 (0.33), deaths no enemy caused 0.83 (0.36), hull stuck 6.8 (2.2) and worse side, units never used 0.36 (0.29), a tank silent 0.33 (0.26) | route failures 0.40 and worse side, flag coverage 0.29, hull stuck 6.2 and worse side, units never used 0.36 |
| 16 a side | self deaths 0.197 (0.067), enemy kills 0.142 (0.397), flag coverage, both sides capture, deaths no enemy caused 0.72 (0.41), units never used 0.27 (0.22), a tank silent 0.33 (0.15) | enemy kills 0.286, flag coverage, units never used 0.32, a tank silent 0.19 |

By the owner's rollout rule (README, "The owner's rollout") Aberdeen no
longer has over 0.6 of the worse side's deaths not the enemy's at either
size, and its enemy kills are over 0.05 at both.

### 4.3 DICE's four levels

Berlin, Stalingrad, Kharkov and Bocage ship their own search maps, so the
option is never read on them. Seeds 1 to 3 at 8 and 16 a side, on foot and
with vehicles, before and after: **all 48 matches are the same match**, the
trace's sha256 identical, on each of the two commits (`shacmp.py`, 48 of 48
and 48 of 48). No figure moves, so there is no spread to compare against.
The matches' figures, for the record (mean of the three seeds, both arms):

| Level | on foot 8 / 16: deaths no enemy caused, worse side | enemy kills a bot-minute | with vehicles 8 / 16: worse side | enemy kills |
|---|---|---|---|---|
| Berlin | 0.16 / 0.14 | 1.27 / 1.52 | 0.14 / 0.11 | 0.78 / 1.04 |
| Stalingrad | 0.35 / 0.25 | 0.51 / 1.00 | 0.33 / 0.46 | 0.32 / 0.41 |
| Kharkov | 0.25 / 0.12 | 0.73 / 0.85 | 0.23 / 0.21 | 0.35 / 0.49 |
| Bocage | 0.09 / 0.13 | 1.03 / 1.02 | 0.22 / 0.20 | 0.24 / 0.44 |

Aberdeen after the fix (0.12 and 0.15) sits with DICE's own levels.

### 4.4 FHSW

Six seeds at 8 a side, 600 s, mean (min to max). On Mareth Line and The
Great Pursuit the fix only takes away ground outside the pocket; on
Tunis-1943 (live, its maps from the generator) it blocks the material on
the loaded maps.

| Figure | Mareth before | after | Great Pursuit before | after | Tunis before | after |
|---|---|---|---|---|---|---|
| deaths no enemy caused, worse side | 0.46 (0.36-0.64) | 0.55 (0.42-0.69) | 0.13 (0-0.31) | 0.12 (0-0.21) | 0.55 (0.30-0.85) | 0.68 (0.50-0.95) |
| self deaths a bot-minute | 0.006 | 0.001 | 0.001 | 0 | 0.011 | 0.006 |
| redeploys a bot-minute | 0.041 (0.03-0.06) | 0.054 (0.03-0.07) | 0.026 | 0.023 | 0.070 (0.02-0.16) | 0.122 (0.06-0.22) |
| enemy kills a bot-minute | 0.104 (0.08-0.13) | 0.078 (0.04-0.12) | 0.280 (0.17-0.40) | 0.235 (0.09-0.34) | 0.101 (0.01-0.17) | 0.101 (0.01-0.18) |
| captures | 1.3 | 1.0 | 2.5 | 2.5 | 4.3 | 3.7 |
| route failures a bot-minute | 4.85 | 3.67 | 4.59 | 5.82 | 1.31 | 1.63 |
| hull stuck s a driving minute | 0.78 | 0.43 | 2.30 | 1.96 | 3.64 | 2.50 |

Nothing here is made better by the fix, and nothing moves outside the seed
spread, since none of these levels had the Aberdeen problem: their bots
never reached the material in the runner (no combat-area death in any
before-match broken down). Their non-enemy removals are redeploys, which
the page does not count as deaths (`page-matches.md` section 6: Tunis has
0.14 there against the runner's 0.55 to 0.74). Tunis's are one Axis bot
redeployed 31 times in a 16-a-side match: spawned at the Axis base, its
route to the `tunisia4` order fails from the first tick
(`route_failed` with goal (455.9, -243.6), on both viewers) while Change
holds it walking at a Crusader 13.5 m away it never boards, then the 12 s
redeploy puts it on the next base spawn and it starts again. Before and
after alike; whether the order position is reachable from the base on the
generator's map is the generator's question (section 6).

## 5. Page matches on the fixed viewer

`node sim/pagematch.mjs --map <level> --seconds 600 --site
http://localhost:5391`, the worktree's viewer served by `serve_viewer.py`
(Aberdeen's published layer and Kharkov's scene fetched from the volume
through its cache), 16 bots, one match each, unseeded. The "before" column
for Aberdeen is the two live matches of the morning (play.bfstats.io, the
viewer without the fix); DICE's page bar is today's
`sim/baselines/page-dice.json` (the worst of DICE's twelve page matches; its
median in brackets).

| Figure | DICE's page bar | Aberdeen live, before | Aberdeen, fixed viewer | Kharkov, fixed viewer |
|---|---|---|---|---|
| deaths no enemy caused, worse side | at most 0.308 (0.158) | 0.72, 0.97 | **0.143** (Axis 0.031, Allies 0.143) | 0.231 (Axis 0.231, Allies 0.074) |
| suicides a bot-minute | at most 0.056 (0.025) | over it in match 1 | **0.025** | 0.044 |
| team kills a bot-minute | at most 0.025 (0.006) | | 0 | 0.006 |
| enemy kills a bot-minute | at least 0.175 (0.303) | 0.11, 0.075 | **0.31** | 0.28 |
| captures | | 5, 6 | 5 | 6 |
| tickets at ten minutes, Axis : Allies | | | 74 : 85 | 80 : 79 |

Both pass every figure of DICE's page bar in their match. Kharkov is one of
the four levels the bar is built from and ships its own maps, which the fix
leaves cell for cell as they were (section 4.3), so it is the control: its
figures sit inside the bar as before. One match is one sample.

## 6. What is left

1. **The generator's walk test does not know the material.** `sim/botgen.mjs`
   and `walkflood.mjs` paint with `buildNavMap(..., { baked: false })` and no
   `impassableMaterial`, so the walk test, the route probe and the template
   choice still see the ground outside the map as walkable: a flag or a route
   that only exists across material 7 is called reachable. On Aberdeen the
   layer's facts did not depend on it (the bots route round the tongue, and
   no flag stands on it). The layers that carry their own `pathfinding/`
   (Tunis-1943 and the other "walk test" layers of the FHSW census) were
   painted by the generator the same way; the bots now block the material on
   them when they load them (section 3), but the generator's own facts about
   them were made without it. Passing `impassableMaterial:
   OUTSIDE_MAP_MATERIAL` in `botgen.mjs` and `walkflood.mjs` is a one-line
   change in files I was asked not to touch; it moves generated output, so it
   wants the generator's owner.
2. **Mareth's dock edge.** The redeploy loop on FHSW's Mareth Line (95 % of
   its few non-enemy removals) is a soldier held against a deck's edge over a
   4.7 m drop that the painted map shows as open on both sides. A wedge memory
   (the redeployed bot's place kept as a 2.5 m obstacle for three minutes) was
   tried and taken out: the route went round the circle and met the same edge
   a metre further along, the same four redeploys. The fix belongs to the
   painter's deck pass (a height step between a deck cell and the ground cell
   beside it), not to the redeploy, and was not built.
3. **Aberdeen's other figures.** Only the West and East outposts change hands
   (flag coverage 0.29; South, North and the City never do), units never used
   0.32 to 0.36, and at 8 a side hull stuck 6 to 7 s a driving minute and
   route failures 0.4 a bot-minute, all over DICE's bar before and after.
4. **The burnt-down hull** (a hull the enemy brought to critical, then the
   bleed finished) has no killer, as in the engine (AI-76). It is now the
   largest non-enemy cause on Aberdeen and is counted as a suicide on the page
   and in the runner alike. Not a bug.
5. **The Great Pursuit** routes its hulls from two base pads that have no
   route on the Tank map before or after the fix (`hullroute.mjs`: the same
   three routes fail on both viewers); see 4.4.

## 7. Not verified

1. The id 7 is measured from DICE's baked maps, not read in the binary
   (game object 0x1d4c1 +0x2c0 was not resolved).
2. Only Aberdeen and three FHSW levels were broken down; the other wide
   levels of the census (Desert Combat's, FH's, the rest of FHSW's) were not
   run, and liberation_of_caen (0.90 to 0.96 in the runner) was not looked at.
3. Section 5's page matches are one match each, unseeded. Tunis-1943, which
   the second commit changes and which is live, was not played on the page
   after the fix; nor was Aberdeen on the live site (nothing was published).
4. The FHSW figures in 4.4 are six seeds at 8 a side only.
5. The trees were scratch copies: Aberdeen's from the census tree
   (`bots/d1/tree`), FHSW's from `bots/tree-mods/fhsw` with the census
   layers; DICE's from the published tree in the local cache.
