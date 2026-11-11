# Page matches: what the runner's verdicts were not seeing

2026-11-11. Part of [bot map generation](README.md), beside its section 19:
this is the page's side of what that section corrects.

The verdicts in sections 14 to 18 come from `sim/run.mjs`, which plays the
page's bot code on stand-ins. Nothing checked that a runner match is what a
player meets on the page. `sim/pagematch.mjs` does: it opens a published
level on play.bfstats.io in a headless browser, leaves the local player on
the deploy screen, and reads the page's own round through its test hooks
(`__bots`, `__round`, `__scoreboard`, installed only with `?shots`).

```bash
cd tools/bf1942-models
node sim/pagematch.mjs --map The_Maze --mod community --seconds 600
node sim/pagematch.mjs --map Berlin --seconds 600
node sim/pagematch.mjs --map Berlin --site http://localhost:5273   # a viewer served locally
```

It prints kills, deaths, team kills, suicides and captures by side, the share
of each side's deaths no enemy caused, the tickets over time, and for every
team kill who fired, with what, and where the victim stood against the line
from the shooter to their target. The page is not seeded: one match is one
sample. Tests of its pure parts: `tests/test_page_match.py`.

Everything below is **measured** on 2026-11-11, one ten-minute match a level
unless it says otherwise, 16 bots (8 a side), bot skill 0.75, Conquest.

## 1. The community levels were judged with a stand-in weapon

The first watch of The_Maze on the page showed team kills in the feed several
times a minute. Three runner matches of the same layer had 0, 1 and 1.

The cause was in the scratch tree the verdicts were run on. Its
`_shared/loadouts.json` was an old copy of the vanilla file: 24 levels,
DICE's own. The published file has 100, the community levels among them.
`sim/level.mjs` `kitFor` returns nothing for a level with no row, and the
runner's bots then fire a stand-in weapon, named `weapon` in the trace, whose
kills stop near 50 m.

| Three seeds, 8 a side, 600 s, on foot | Stand-in weapon | Published kits |
|---|---|---|
| The_Maze, kill distance p50 / p90 | 26 to 28 m / 45 to 47 m | 30 to 34 m / 107 to 115 m |
| The_Maze, team kills a match | 0, 1, 1 | 5, 0, 4 |
| The_Maze, tickets at the end, Axis : Allies | 71:9, 89:0, 83:0 | 62:0, 68:0, 67:0 |
| The_Maze, route failures a match | 56 (seed 1) | 40, 42, 81 |
| shigaisen_B, captures a match | enough to pass the bar (section 15.4) | 0, 0, 1 |
| shigaisen_B, team kills a match | (section 15.4: 0.05 a bot-minute) | 4, 4, 5 |

**So every community-level figure in sections 14 to 18 was measured with
bots that do not carry their kits**, including the two verdicts that put
shigaisen_B and The_Maze live. DICE's baseline was not affected (its levels
have their rows), and neither were the mods: every level in the Desert
Combat, Forgotten Hope, BF1918 and FHSW scratch trees has a row in its own
mod's file. A level with no kit row is now a lint error. Section 5 has what
the two live levels came to when judged again.

## 2. The page against the runner

| Level, on the page | Enemy kills a bot-minute | Team kills a bot-minute | Suicides a bot-minute | Captures | Deaths no enemy caused, worse side |
|---|---|---|---|---|---|
| The_Maze (generated, live) | 0.33 | 0.11 | 0 | 11 | 0.32 |
| shigaisen_B (generated, live) | 0.24 | 0.05 | 0 | 0 | 0.22 |
| Berlin | 0.40 | 0.06 | 0.025 | 6 | 0.26 |
| Stalingrad | 0.31 | 0.013 | 0.038 | 0 | 0.15 |
| Kharkov | 0.34 | 0.019 | 0.044 | 9 | 0.19 |
| Bocage | 0.22 | 0.025 | 0.038 | 8 | 0.40 |

The DICE levels are played as the page plays them, vehicles in. shigaisen_B's
round ended and restarted inside the ten minutes, so its row is the second
round's tally only; an earlier ten-minute match of it had 40 enemy kills, 18
team kills and no capture.

Three things follow.

**shigaisen_B has no captures on the page.** Two ten-minute matches, none.
The runner with the published kits says the same (0, 0, 1). The verdict that
passed its captures was the stand-in weapon's.

**With vehicles, the page fights two to three times as much as the runner's
bar says.** `sim/baselines/vehicles-dice.json` has DICE's four levels at a
median of 0.111 enemy kills a bot-minute at 8 a side (p10 0.062, p90 0.335).
On the page the same four are at 0.22 to 0.40. One unseeded match a level is
a direction, not a bar, but all four sit at or over the runner's 90th
percentile. The runner's vehicle stand-ins are the first suspect, and the
"no-fight" line section 18 drew for a level with vehicles was drawn on them.

**On the mods the page and the runner agree: there is little fight.** As
published, with no generated layer:

| Level, on the page | Enemy kills a bot-minute | Kills by side | Captures | Note |
|---|---|---|---|---|
| BF1918 Mauerfall | 0 | 0 and 0 | 0 | the tickets never move |
| BF1918 lutte_de_honneur | 0.006 | 1 and 0 | 1 | |
| Forgotten Hope Pegasus | 0.006 | 0 and 1 | 7 | tickets 61 to 124 on flags alone |
| Desert Combat Inshallah_Valley | 0.025 | 4 and 0 | 6 | |
| DC_Basrah_Nights | 0.025 | 2 and 2 | 0 | |
| DC_DesertShield, which ships its own bots | 0.044 | 6 and 1 | 3 | 8 of 15 deaths are suicides, 7 on one side |

A level Desert Combat ships with bots has a ninth of Berlin's kill rate on
this page. So what keeps a mod's level from a single player game is mostly
the page's bots with the mod's vehicles, guns and kits, not the missing
layer. That work is under way separately.

## 3. Team kills are bots in file, not a hit-test fault

Every team kill was logged with the weapon fired in a seven-minute match of
The_Maze, shigaisen_B and Berlin, and with its geometry in a five-minute
match of each and in the ten-minute matches above.

* The weapon is a rifle, a submachine gun or a pistol in all but a handful:
  of 82 team kills logged with what the killer fired, 7 were a Bazooka or a
  Panzerschreck and one a hand grenade (on Berlin). It is not the grenades
  and rockets the runner does not fly.
* The victim is in the way. Of 68 victims with a known line on The_Maze and
  shigaisen_B, 64 stood within a metre of the line from the shooter to an
  enemy target, between the two, most of them 1 to 7 m from the muzzle with
  the target 27 to 120 m beyond.
* On DICE's levels it happens less (0.013 to 0.06 a bot-minute against 0.05
  to 0.11 on the two generated ones, and 0.27 in one seven-minute match of
  shigaisen_B), and 14 of 22 victims there were in the way.

The engine has no hold-fire for a teammate (ledger FF-7,
[bot friendly fire](../bot-friendly-fire/README.md)), so a bot behind another
in a corridor shoots through them. The generated levels are corridors with
sight lines of a hundred metres. Even with the published kits the runner
shows a third to a tenth of the page's rate (0.03 a bot-minute): open.

The "is no more" line with a score of -2 that section 17.3 and 18.2 could not
explain is this: the kill feed's line for a team-kill victim, and the
killer's penalty. It is not a redeploy, which prints nothing and costs
nothing.

## 4. The runner was also playing another doctrine

Found the same day by the seat-behaviour work
([seat-behaviour.md](seat-behaviour.md), 2.3): the page plays the garrison
by default (`map.html`, `BOT_DOCTRINE`; [bot garrison](../bot-garrison/README.md))
and the runner, and so every verdict and both bars, played the engine's SAI.
Rebuilt under the garrison, the runner's with-vehicles bar on DICE's four
levels goes from a median of 0.111 enemy kills a bot-minute to 0.304 at 8 a
side, and lands on the page matches of section 2 level by level (Berlin 0.62
against the page's 0.40, Bocage 0.23 and 0.22, Kharkov 0.31 and 0.34,
Stalingrad 0.33 and 0.31). The idle share that failed The_Maze, half a side
guarding a home base, is the SAI's: a player never saw it.

`botbatch` now runs every match under the garrison and records the doctrine
in each row, bar and verdict.

## 5. The two live levels, judged again

Published kits, the garrison, ten seeds, 600 s, 8 and 16 a side, with and
without the layer, against DICE's on-foot bar rebuilt under the garrison.

| Level | Outcome | Fails | What was done |
|---|---|---|---|
| The_Maze | better-than-nothing | route failures alone: 1.39 a bot-minute against 0.54 at 8 a side, 3.20 against 0.51 at 16 | accepted again on this verdict and republished, 2026-11-11 |
| shigaisen_B | no-better-than-nothing | 5 checks at 8 a side, 11 at 16: no capture at either size (the level with no layer gets 2 a match), spawn traps, route failures, and at 16 a side team kills 0.309 against 0.124 | taken off the page, 2026-11-11: its `scene.json` is the published one less the `ai` block, its menu row has no flag |

The_Maze with no layer has no kill in any seed; with it, 7 and 6.5 captures
a match and 0.83 enemy kills a bot-minute at both sizes. shigaisen_B's layer
cuts stuck time, route failures and redeploys five to twenty times and the
fight is fierce (1.8 to 2.0 enemy kills a bot-minute), but nobody takes a
flag, so by the tool's own rule it is not better than nothing. It can go
back on a verdict that says otherwise.

### The_Maze's new layer on the page: one side shooting itself

The same day the generator's version 5 layer (DICE's Kursk template, chosen
because three flags are in play; README 19.5) replaced version 4 on the
page. The runner prefers it: every check passed at 8 a side, route failures
at 16 a side down from 3.20 a bot-minute to 1.49. Four ten-minute matches of
it on the page, against the four of version 4 above:

| The_Maze on the page, 8 a side | Version 4 (four matches, 5 to 10 min) | Version 5 (four matches, 10 min) |
|---|---|---|
| Captures in ten minutes (the two ten-minute matches of version 4) | 21, 11 | 16, 12, 14, 17 |
| Enemy kills a bot-minute (the same two) | 0.24, 0.33 | 0.25, 0.33, 0.29, 0.28 |
| Team kills a bot-minute | 0.09, 0.10, 0.10, 0.11 | 0.15, 0.18, 0.17, 0.12 |
| Team kills by side, Axis and Allies (the same two) | 6 and 9, 7 and 11 | 21 and 3, 21 and 8, 19 and 8, 11 and 8 |
| Deaths no enemy caused, worse side (the same two) | 0.43, 0.32 | 0.53, 0.47, 0.49, 0.30 |
| Victims standing in the shooter's line | 16 of 18 | 93 of 99 |

**On the page the new layer has the Axis side losing about half its deaths
to its own rifles in three matches of four, two team kills a minute.** The
runner's team-kill check passes the same layer (0.057 a bot-minute against a
bar of 0.076 at 8 a side for version 4; version 5 passes too). DICE's four
levels on the same page are at 0 to 0.06. So the runner under-counts team
kills against the page by a factor of two to three on this level, and that
is the difference between passing the check and failing it.

The level was left live on version 5: it is still far better than the level
with no layer (no kill in any seed), it is the only generated level on the
page, and it is tagged EXPERIMENTAL BOTS. Its acceptance names the team
kills. What it shows about the tools is the larger point: **a verdict from
the runner alone is not enough to put a level live.** A page match belongs
in the gate, with a bar from DICE's levels played the same way, and it is
not there yet.

## 6. The page check

`sim/pagematch.mjs` has two more commands since.

```bash
node sim/pagematch.mjs bar                                   # DICE's four levels, three matches each
node sim/pagematch.mjs check --map DC_LostVillage --mod desertcombat --out bot-layers/desertcombat/dc_lostvillage/page.json
```

`bar` plays DICE's own levels on the page and keeps, for each figure, the
worst any one match showed (`sim/baselines/page-dice.json`). `check` plays a
published level three times and holds the median of each figure to that. The
page is unseeded and a match is ten minutes, so the bar is a ceiling, not a
percentile. Twelve matches, 2026-11-11, on the page with the seat fixes in:

| Figure | The bar (DICE's worst match) | DICE's median |
|---|---|---|
| Team kills a bot-minute | at most 0.081 (Berlin) | 0.013 |
| Suicides a bot-minute | at most 0.10 (Kharkov) | 0.028 |
| Deaths no enemy caused, worse side | at most 0.50 (Bocage) | 0.22 |
| Enemy kills a bot-minute | at least 0.11 (Bocage) | 0.31 |

Captures have no bar: Stalingrad's three matches had 2, 1 and 0.

**How a level goes live now** (README 17.1, with two steps added): the
layer is published without its menu flag, so nobody is offered it; the page
check is run; the flag is published only if the check passes or the
acceptance names what it fails. The result is kept beside the verdict as
`page.json`.

| Level | Page check | Medians: team kills, suicides, death share, enemy kills | Tickets at ten minutes, Axis : Allies |
|---|---|---|---|
| The_Maze (generator 5) | **fails team kills** | 0.144, 0, 0.36, 0.36 | 35:67, 68:11, 62:29 |
| The_Maze, with the hold-fire live (2026-11-11) | passes | 0.019, 0, 0.17, 0.27 | 29:88, 19:85, 55:26 |
| Desert Combat DC_LostVillage | passes | 0, 0.056, 0.37, 0.22 | 99:27, 113:50, 71:37 |
| FHSW Tunis-1943 | passes | 0, 0.013, 0.14, 0.17 | 29:91, 74:54, 23:82 |
| Desert Combat DC_Basrah_Nights | passes | 0.075, 0.019, 0.25, 0.61 | 39:52, 49:50, 50:42 |
| Desert Combat Inshallah_Valley | passes | 0.013, 0.025, 0.14, 0.30 | 85:70, 78:86, 87:79 |

DC_LostVillage is the first mod level live (2026-11-11): better than
nothing on Desert Combat's own bar and on DICE's (README section 20), no
fight at all with no layer. What the page shows of it: the Axis side ahead
on tickets in all three matches, as the runner's ten seeds said it would be
(10 of 10), one quiet match of the three (0.05 enemy kills a bot-minute),
and 4, 4 and 9 captures. Its menu tag was published after the check.

FHSW's Tunis-1943 followed the same day, the same way: better than nothing
on DICE's bar (no FHSW bar yet), no fight with no layer, wins split 5:5 and
7:3 in the runner. On the page its three matches had 13, 6 and 6 captures
and 0.09, 0.24 and 0.17 enemy kills a bot-minute, with one team kill in
thirty minutes. The runner had it at 0.066 a bot-minute at 8 a side, under
the page bar's floor; the page has it over.

DC_Basrah_Nights went up on the owner's say (README 19.8), and is the best
of them on the page: 0.53 to 0.65 enemy kills a bot-minute, twice DICE's
median there, 14, 23 and 19 captures in ten minutes, and the tickets level.
The comparison that had called it no better than nothing was the tool's
fault, not the level's; it now counts the bar's checks each arm fails
(`fewerFailed`), and by that this layer and Inshallah_Valley's are better.

BF1918's hindenburg_line also reached better-than-nothing and was **not**
accepted: 95 to 97 % of the worse side's losses in the runner are redeploys
of bots stuck where they stand, and the Axis side wins every seed.

### The hold-fire on the live page

The bots' hold-fire for a teammate in the line ([hold-fire.md](hold-fire.md))
reached the live site on 2026-11-11 at 12:11, and The_Maze was checked
again on it: team kills 0.031, 0.019 and 0.006 a bot-minute against 0.144
before, enemy kills 0.27, 0.23 and 0.41, and 7, 14 and 9 captures. It now
passes the page check; `page.json` holds these three matches. The bar it
was held to is still DICE's from before the hold-fire (at most 0.081 team
kills a bot-minute), which is looser than DICE's levels will show with it:
the page bar is to be rebuilt once the hull steering fix is in too, and the
live levels checked against that.

A first run of this check had a third match in which nothing happened at
all: tickets 106:106 after ten minutes, no kill, no death, no capture. The
round had never begun; the three matches of a check play side by side, and
that browser's READY click landed before the button was drawn. `pageMatch`
now clicks READY until a bot has moved, and plays a match that counted
nothing once more, marked `replayed` (`isVoid`). No earlier check in the
table above had such a match (every one has kills and moved tickets).

### The page bar rebuilt, and the owner's rollout

With the hold-fire and the hull steering both live, DICE's four levels were
played again (twelve matches, 2026-11-11 13:00) and the bar is tighter on
every figure:

| Figure | The bar before | The bar now (DICE's worst match) | DICE's median now |
|---|---|---|---|
| Team kills a bot-minute | at most 0.081 | at most 0.025 | 0.006 |
| Suicides a bot-minute | at most 0.10 | at most 0.056 | 0.025 |
| Deaths no enemy caused, worse side | at most 0.50 | at most 0.31 | 0.16 |
| Enemy kills a bot-minute | at least 0.11 | at least 0.175 | 0.30 |

The same day the owner played Tunis-1943 against its generated bots ("they
rushed to the spawn point, germans counter attacked. I think it's a huge
improvement on what we have. Might as well roll them out"). So the page
check no longer decides whether a level gets its menu flag. A level gets
the flag when the page plays it: a match that is not void (`isVoid`) and
throws no page error. The check against DICE's bar is still run and kept in
`page.json`, as the record of how far a level is from DICE's own.

A level whose bot layer is generated now says so on its briefing screen,
under COMMENTS: "Bot support added by skandia | bfstats.io"
(`briefing-screen.js commentsWithBotCredit`, the owner's wording).

Rollout levels, one match each on the page (the bar is DICE's rebuilt one;
"plays" is the rollout's rule):

| Level | Plays | Against DICE's bar | Team kills, death share, enemy kills | Captures | Tickets, Axis : Allies |
|---|---|---|---|---|---|
| HOP (community) | yes | passes | 0, 0, 0.46 | 0 | 75:64 |
| KoH (community) | yes | passes | 0, 0.22, 0.27 | 11 | 70:83 |
| shigaisen_B (community) | yes | fails enemy kills | 0, 0, 0.06 | 4 | 67:100 |
| Beinbrekkbakken (community) | yes | passes | 0, 0, 0.19 | 6 | 98:84 |
| FH Pegasus | yes | fails suicides and death share | 0.025, 0.50, 0.33 | 3 | 75:75 |
| Desert Combat DC_Battle_of_73_Easting | yes | fails enemy kills | 0, 0, 0.11 | 2 | 93:70 |
| FHSW the_great_pursuit | yes | passes | 0, 0, 0.21 | 3 | 123:109 |
| BF1918 scimitar_hill | yes | fails enemy kills | 0, 0, 0.08 | 3 | 99:100 |
| BF1918 lutte_de_honneur | yes, barely | fails two | 0, 0.33, 0.06 | 1 | 100:100 |
| FHSW Battle_for_ortona-1943 | yes | passes | 0, 0.13, 0.18 | 0 | 103:70 |
| FHSW Moscow_Outskirts-1941 | yes, by the rate | fails two | 0, 0.70, 0.14 | 11 | 138:128 |
| BF1918 Mauerfall | yes | fails enemy kills | 0.013, 0.23, 0.17 | 0 | 89:93 |
| BF1918 hindenburg_line, two matches | yes, on the second | fails enemy kills | 0 and 0.006, 0.25 and 0.50, 0.07 and 0.07 | 0 and 4 | 102:12, 96:13 |
| FHSW Pegasus, two matches | **no**: no capture, little killing | fails two | 0 and 0.006, 0.50 and 0.50, 0.02 and 0.09 | 0 and 0 | 104:104, 102:90 |
| BF1918 roye, one match | **no**: the worse side dies by its own hand | fails two | 0, 1.00, 0.03 | 2 | 96:104 |
| Desert Combat DC_Oil_Fields, two matches | yes, by the rate (see below) | fails two | 0, 0.63 and 0.71, 0.06 and 0.04 | 3 and 8 | 97:55, 99:56 |
| FHSW Stalingrad_RedSquare, two matches | yes, by the rate (see below), barely | fails two | 0, 1.00 and 1.00, 0.05 and 0.04 | 2 and 3 | 88:106, 89:105 |
| BF1918 fht_meuse_argonne_offensive, one match | **no** | fails two | 0, 0.60, 0.05 | 0 | 118:122 |
| FHSW Bizerte-1943, one match | **no** | fails two | 0, 0.64, 0.03 | 0 | 92:63 |
| The_Bridge (community), two matches | **no**: too quiet | fails enemy kills | 0, 0, 0.03 and 0.04 | 2 and 2 | 23:51, 27:48 |
| Aberdeen (vanilla), two matches | **no**: the worse side dies by its own hand | fails three | 0, 0.72 and 0.97, 0.11 and 0.08 | 5 and 6 | 88:77, 94:73 |

**The rollout's page floor** (the coordinator's rule under the owner's
decision; `sim/pagematch.mjs rolloutFloor`, run by the `bf1942-bot-rollout` skill's `pagebatch.sh`): a level keeps its menu flag when a
match on the page shows real killing (at least 0.15 enemy kills a
bot-minute), or flag play with some killing (at least 3 captures and 0.03),
or some of both (0.05 and 1 capture); no more than 0.10 deaths a bot-minute by a bot's own or its
side's hand (suicides and team kills together; DICE's worst match shows
0.056 and 0.025); and no page error.

The cap was first written on the worse side's SHARE of deaths not the
enemy's (at most half), and that was wrong: with few deaths the share is
noise. Red Square read 1.00 on a side that lost one soldier in ten
minutes, and one of DC_Basrah_Nights' three matches (the liveliest level
live: 0.53 enemy kills a bot-minute, 19 captures) reads 0.72. By the rate,
Moscow_Outskirts-1941 (0.044, 11 captures), DC_Oil_Fields (0.050, 3 and 8
captures) and Stalingrad_RedSquare (0.006, 2 and 3 captures) pass on the
matches already played and went live on 2026-11-11; vanilla Aberdeen
(0.21) still fails, and Roye, Bizerte and Meuse-Argonne fail on activity.
The share stays in `page.json` and in DICE's bar as a record. A level that fails is played once more before it is
turned down, and its acceptance is then withdrawn in `verdict.json` with
the reason; its layer stays on the volume, unflagged. The runner no longer
decides: the owner liked Tunis-1943, which the runner calls no-fight at 8
a side (0.038 enemy kills a bot-minute against 0.17 on the page).

### After the outside-map ground was blocked (2026-11-11, 18:12)

[wide-levels.md](wide-levels.md): tanks were burning on the ground outside
the map, which the bots' maps showed as open. With the fix live, the held
levels and every live level were played once more on the page (25 matches,
five at a time).

| Held level | Before | After | Now |
|---|---|---|---|
| Aberdeen (vanilla) | 0.11 and 0.08 enemy kills, 0.21 own-hand deaths a bot-minute | 0.24 enemy kills, 4 captures, 82:84; passes DICE's page bar | live |
| FHSW fht_battle_of_mareth_line-1943 | not played | 0.11 enemy kills, 3 captures, 99:62 | live |
| BF1918 roye | 0.03, 2 captures | 0.03, 1 capture | off (too quiet) |
| BF1918 fht_meuse_argonne_offensive | 0.05, no capture | 0.04, no capture | off |
| FHSW Bizerte-1943 | 0.03, no capture | 0.14, no capture | off (just under the floor) |

The live levels, one match each after the fix (enemy kills a bot-minute,
captures, tickets): The_Maze 0.31, 19, 65:63; shigaisen_B 0.26, 0, 44:49;
HOP 0.59, 0, 55:63; KoH 0.28, 12, 77:83; Beinbrekkbakken 0.15, 13, 92:91;
Inshallah_Valley 0.48, 10, 84:43; DC_Battle_of_73_Easting 0.18, 7, 89:88;
DC_Oil_Fields 0.06, 12, 95:54; Tunis-1943 0.21, 3, 71:69; the_great_pursuit
0.16, 7, 133:107; Battle_for_ortona-1943 0.14, 1, 90:91;
Moscow_Outskirts-1941 0.17, 4, 130:132; Stalingrad_RedSquare 0.05, 3,
88:102; FH Pegasus 0.22, 4, 63:94; hindenburg_line 0.07, 2, 101:12;
scimitar_hill 0.08, 6, 96:103; lutte_de_honneur 0.07, 1, 103:98. All of
these clear the floor. Three did not in this match and were played again
(below): DC_Basrah_Nights, DC_LostVillage and Mauerfall.

| Level | First match after the fix | Played again | Now |
|---|---|---|---|
| DC_Basrah_Nights | no kill, 2 captures, tickets untouched at 106:106 | 0.75 enemy kills, 13 captures, 34:54; passes DICE's page bar | live |
| DC_LostVillage | 0.10 enemy kills, 5 captures, own-hand deaths over 0.10 | 0.26 enemy kills, 8 captures, own-hand deaths 0.094 | live, near the cap |
| BF1918 Mauerfall | 0.03 enemy kills, no capture | 0.13 enemy kills, no capture | taken down (0.17 before the fix; under the floor in two of three) |

Basrah's first match was not the fix's doing: the runner on the fixed code
has it at 0.71 enemy kills a bot-minute with 5 captures in five minutes.
It was a match that never got going, played beside four others, and
`isVoid` now replays any match with no kill and no death in it, captures
or not. Why a page match can stall that way was not found. Mauerfall never
captures a flag and its kill rate sits at the floor; it waits for the
no-live-strategy fallback. DC_LostVillage's suicides (0.088 a bot-minute)
are higher than before the fix (0.056 at the median of three), on two
matches: not explained.

### After the no-live-strategy fallback (2026-11-11, 20:07)

[no-live-strategy.md](no-live-strategy.md): on a generated layer a side
with no strategy scoring and no attack target takes the no-layer order.
Twelve levels that had not been on the page were published without flags
and played once (enemy kills a bot-minute, captures, own-hand deaths a
bot-minute, tickets):

| Level | Figures | Now |
|---|---|---|
| FHSW Aberdeen | 0.31, 6, 0.03, 81:77; passes DICE's page bar | live |
| FHSWEurope aberdeen | 0.17, 14, 0.02, 100:82 | live |
| FHSW Earned_in_Blood | 0.14, 2, 0.01, 80:32 | live |
| FHSW Battle_of_Edson_s_Ridge | 0.10, 1, 0, 100:67 (dead before the fallback) | live |
| FHSW Salerno-1943 | 0.08, 4, 0.07, 108:72 | live |
| Desert Combat DC_Urban_Siege | 0.06, 9, 0, 96:102 | live |
| Liberation_of_Caen (community) | 0.06, 1, 0.05, 85:89 | live, barely |
| _o_Jka__BIG (community) | 0.44, 5, 0.12, 30:5; again 0.26, 9, 0.08, 52:27 | live on the second match |
| FHSW Fall_of_Berlin-1945 | 0, 7, 0.01, 222:170 | off: flags and no fight |
| BF1918 operation_gericht | 0.08, 0, 0.08, 13:89 | off |
| BF1918 sanaga_river | 0.06, 0, 0, 102:101 | off |
| FH Seelow-Heights-1945 | 0, 0, 0.01, 127:126 | off |

Fall of Berlin took 7 flags without one enemy kill, and the floor as
written let that through on captures alone. It now asks for some killing
in every case: 0.15 enemy kills a bot-minute, or 0.03 with 3 captures, or
0.05 with 1.

## 7. What is not verified

1. One match a level in sections 2 to 5, three in section 6, all unseeded:
   samples, not medians of ten seeds.
2. The page matches run with no person in them: the local player never
   leaves the deploy screen.
3. Why the runner with kits still shows fewer team kills than the page.
4. Why the runner with vehicles shows fewer kills than the page on DICE's
   levels.
5. The page's own team-kill rate on DICE's levels against retail's was not
   measured in the lab.
6. DC_LostVillage's row in the Desert Combat menu was read back from the
   volume with its flag set; the menu itself was not looked at.
7. The page check is run by hand. Neither `botbatch accept` nor the bake's
   gate asks for a `page.json` yet.
