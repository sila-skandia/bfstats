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

## 6. What is not verified

1. One match a level, unseeded. The page figures are samples, not medians.
2. The page matches run with no person in them: the local player never
   leaves the deploy screen.
3. Why the runner with kits still shows fewer team kills than the page.
4. Why the runner with vehicles shows fewer kills than the page on DICE's
   levels.
5. The page's own team-kill rate on DICE's levels against retail's was not
   measured in the lab.
