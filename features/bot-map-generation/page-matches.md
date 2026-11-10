# Page matches: what the runner's verdicts were not seeing

2026-11-11. Part of [bot map generation](README.md); it will be folded into
that file as section 20 once section 19 is in.

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
mod's file. The two live levels are being judged again with the published
kits; a level with no kit row is to be a lint error.

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

## 4. What is not verified

1. One match a level, unseeded. The page figures are samples, not medians.
2. The page matches run with no person in them: the local player never
   leaves the deploy screen.
3. Why the runner with kits still shows fewer team kills than the page.
4. Why the runner with vehicles shows fewer kills than the page on DICE's
   levels.
5. The page's own team-kill rate on DICE's levels against retail's was not
   measured in the lab.
