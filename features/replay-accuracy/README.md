# Replay accuracy

Each player's rounds fired, hits and accuracy for a recorded round, on the
replay's board (Tab, or the Players button): the **Accuracy** tab beside the
scores.

Asked 2026-11-01: accuracy stats for the recorder, broken down overall and by
kit, vehicle and class, "ordered by most hits / most fired". Then: "it doesn't
have to be perfect, just use what data we have ... use the server table,
falling back to the recorded values being rebuilt."

## Status

Built 2026-11-01 (`viewer/replay-accuracy.js`, the board in `viewer/replay-ui.js`,
`ReplayPlayer.accuracy` in `viewer/replay.js`). Live on play.bfstats.io from
`c849ebdf` (2026-11-01; checked on the Kharkov recording `272wb7fjbj`: 67 players,
47 from the server's tally).

## The dashboard

Asked 2026-11-02: "it'd be nice to see it calculated as a moving value as the
round plays ... if we know what their final accuracy will be ... plot it on a
graph", and "rather than present it as a regular score board we develop it as a
rich 'dashboard' ... accuracy, bullets fired, and whatever hard core data we can
capture. Some fun stuff too like how many bullets were shot at them."

The Accuracy tab's player view is a dashboard (it opens from a row of the comparison table, below) (`viewer/replay-accuracy-dash.js`). The
players are down the left, sortable by rounds fired, hits or accuracy, with
the board filters (All, Infantry, Vehicles, Air) and **So far / Whole round**:
so far follows the replay's clock, second by second. Clicking a player shows
his dashboard. With nobody picked it shows the man followed, else the top row:

- **Tiles:** accuracy (with points above or below the round's average, and a
  bar against the round's best), rounds fired, hits, rounds a kill, rounds
  fired at him (and how many hit him), longest bullet hit.
- **Accuracy through the round:** his running accuracy, bright up to the
  playhead and faint after it, with dashed lines at his final accuracy and the
  round's average. It is not drawn before his tenth round, where it is only
  noise. Beneath it is the fire band: his rounds out (hits in gold) above the
  line, enemy rounds at him (hits on him in red) below, in 5 s to 5 min
  buckets. His kills and deaths are ticks between the two. Hover reads out
  the moment, and a click seeks the replay there.
- **Panels (whole round):** his weapons (accuracy, hits / fired); hits by range
  (0-25, 25-50, 50-100, 100-200, 200+ m, bullets only) and what they hit
  (soldiers, armour, aircraft); who they fired at (the enemies his rounds hit
  or passed near, most rounds first, with the hits, the share of his rounds
  that went near an enemy, whom he hit most and his closest miss); under fire
  (the men who fired most at him, rounds at him, hits taken, the closest
  miss); trigger
  (bursts, rounds a burst, the longest burst, hits in a row, rounds a hit, hits
  a kill).
- **WATCH** follows him and closes the board.

How "so far" is worked out (`totalsAt`): his rounds and hits as the recording
saw them, as running counts. Where the whole round's numbers are the server's
tally, the recording saw only part of his firing. The counts are scaled so
they finish on the server's numbers: the curve has the recording's shape and
ends on his true accuracy, and the numbers carry a `~`. With no hit seen at
all, his hits follow his firing. A rebuilt player's counts are his own,
unscaled. Hit times come from the recording's own credits where it has them
(`hg`, his `hm` marks plus his rebuilt blasts), else from the rebuild.

"Fired at him" (`playerDetail`) counts every enemy round that hit him (the
rebuild's verdict) or passed within 3 m of him on foot, or 8 m of the origin of
the hull he rode. A blast counts when its arc came within its radius plus 3 m.
Like everything the rebuild sees, it is a sample: a client is told only about
rounds near it.

"Who they fired at" (asked 2026-11-09: "who they fired at the most?") is the
same test run the other way (`aimedAt`): each of his rounds that hit is its
victim's, and it and each miss count for every other enemy it passed within
those distances, as their under fire counts it. So a player's row in his
victim's under fire and the victim's row in his fired at are the same numbers
(on Kharkov `272wb7fjbj`, all 794 pairs whose names are on one board row), and
a burst sprayed across a group is in each of their rows. Checking that found
under fire counting a teammate's hit (a teamkill, a hit as he changed sides)
as a hit but not a round, "0 rounds, 2 hit": a round that hit him is now one
at him whatever its side. "Rounds near an enemy" counts each round once; a round near
no enemy is in no one's row. One player's detail, both ways, takes 9 ms
(median, 29 ms the slowest) on that round.

The game's chat strip (`#comms-canvas`) is drawn above the replay's layer. It
is hidden while the board is open: it scrawled over the rows of every view.

Measured on Kharkov (`272wb7fjbj`, 39 min, 14,427 rounds): the board takes
0.3 s and one player's detail 40-80 ms, worked out when he is first picked.

## Every player side by side

Asked 2026-11-09: the tab is popular, but "it does show it per player. What
some users are asking for is to see a full comparison between players ... in a
list. The click in could show the current view ... at a glance people would
like to see how each player stacked up against each other".

The Accuracy tab now opens on a comparison table of every player
(`compareBoard` and `sortCompare` in `viewer/replay-accuracy.js`, drawn by
`renderTable` in `viewer/replay-accuracy-dash.js`). Clicking a row opens the
dashboard above for that player; **All players** goes back, with the row last
opened marked.

- **Axis against Allied** over the table: each side's accuracy, rounds, hits
  and kills, and the side ahead by how many points.
- **The columns:** accuracy as a bar, every row on one scale with the
  table's average as a dashed mark; points above or below that average; rounds
  fired; hits; kills; rounds a kill; the accuracy trend through the round (one
  scale for everyone, bright up to the clock); the weapon fired most with its
  accuracy; and the role, the share of their rounds fired on foot, from
  vehicles and from the air.
- Every number column sorts (rounds a kill fewest first, no kills last).
  Accuracy is the default, and a player under 20 rounds is faded and sorts
  last on it, as in the list beside the dashboard.
- **Whole round** is the default (owner, 2026-11-09: "show whole round by
  default and make it clear how to toggle to so far"). The toggle reads
  **SHOW Whole round | So far**, So far carrying a dot that pulses while it
  follows the clock; the pill between the two sides says which is showing
  (`WHOLE ROUND`, or `SO FAR · 8:24`) and switches to the other; the footer
  says the same in words.
- **Both / Axis / Allied** narrows the table and the dashboard's list. It,
  the Whole round / So far toggle and the board filters drive both views.
- Kills are counted from the kill feed, which names each kill's weapon as the
  same stat template as the rows (the vehicle, else the hand weapon; a seat's
  `inferredWeapon` where it names none): a board filter or a weapon counts
  only its own kills, and rounds a kill follows. A reused pid's kills go to
  whoever held the name. The trend, the weapon and the role are the whole
  round's; the rest follows the clock in "so far".
- Narrower than 1060 px the trend and role go; on a phone the table keeps
  rank, name, accuracy, fired, hits and kills.

### One weapon

Asked 2026-11-09: "filter the accuracy all players by the vehicle or player
type. It needs to be intuitive, but it'd be great to compare players using a
particular weapon."

- **Weapon** beside All / Infantry / Vehicles / Air opens a list of every
  weapon and vehicle fired this round, under Infantry, Vehicles and Air, with
  how many players used it and its accuracy, most players first. Typing
  narrows it; Enter takes the first. Picked, the button carries its name and
  a cross back to All.
- Clicking a player's **main weapon** in the table does the same: the
  quickest way from "who's good with the Thompson" to the answer.
- The table is then that weapon alone: its rounds, hits, kills and rounds a
  kill, the trend of its accuracy, and in place of the main weapon **of their
  rounds**, how much of their firing it was. The two sides compare on it, the
  pill between them names it, and a player's dashboard opens on it too.
- Weapons the game gives one name are one entry and one filter
  (`weaponsOn`'s `nameOf`, the lexicon): each side's grenade is "Grenade",
  each side's knife "Knife". A filter is `row:<template>|<template>`
  (`weaponFilter`, `filterWeapons`, `rowIn`).
- Too few to judge is twenty rounds on All and the boards. For one weapon it
  is a fifth of the most anyone fired of it, three at least: nobody throws
  twenty grenades, and on Bocage every grenade row was faded at twenty.
- Kit classes (medic, assault, scout...) are not a filter: which kit a weapon
  belongs to is the mod's, and a player's kit changes through the round. The
  weapon is what a class is compared on in practice (the Bazooka is the
  anti-tank kit's, the K98 sniper the scout's).

Tests: `test_every_player_side_by_side`,
`test_the_comparison_by_board_side_and_clock`, `test_everyone_on_one_weapon`,
`test_too_few_scales_with_the_weapon` and `test_weapons_of_one_name_are_one` in
`tests/test_replay_accuracy.py`.

## Where the numbers come from

The server counts both numbers itself (ledger IMP-11): `BFPlayer::addBulletsFired`
once per barrel, `addBulletsGivingDamage` once per damaging round and once per
explosion that hurt an enemy. At the round's end it sends every client each
player's tally by weapon (`roundStats`, events 0x30..0x32;
`features/round-replay-capture` §11.3). The weapon is the engine's stat template:
the vehicle when he is in one, the hand weapon on foot (XHIT-4).

- **A player the tally names** shows the server's numbers, for the whole round.
- **Anyone else** (he left before the end, or the file stops before it) is
  rebuilt from what the recording saw, and the row says `rebuilt`:
  - fired: his `f` rounds, times the gun's barrels when it fires them all at
    once (the FireArms' `muzzles` and `asynchronyFire`, off the hull models the
    replay loaded; 1 where none is loaded);
  - a bullet hit: a round that passed through a victim (1 m of a soldier, 4 m of
    a crewed hull's origin) whose next change of hit points is a drop within
    0.3 s of the round's arrival (plus the trip back: 0.06 s remote, 0.24 s for
    the recording player);
  - a blast hit (anything `damage.json` gives a `radius`, and the thrown
    rounds): one per round, when an enemy within that radius of the round's arc
    lost hit points while it flew. A blast on a teammate is not a hit, as in
    `handleExplosion`.

A file with no tally at all is rebuilt throughout, and the board's footnote says so.

## How close the rebuild is

Measured against the server's tally, on the eleven public vanilla rounds from the
shared feed that the recorder saw whole (2026-11-01):

| weapon kind | rounds fired | hits | accuracy, server -> rebuilt |
|---|---|---|---|
| infantry | 90% | 92% | 24.4% -> 25.1% |
| ground vehicles | 92% | 71% | 13.3% -> 10.3% |
| aircraft | 79% | 42% | 7.8% -> 4.1% |

Players ranked by rebuilt hits against the server's: Spearman 0.73 to 0.97 a round;
the top five share four names on average. Kharkov came out at 2562 hits against
the server's 2555; Battle of Britain, nearly all air, at 32%.

What it cannot see:

- A player out of the recording client's reach: the server never sends his
  rounds. Aircraft cross the map and suffer most.
- Several rounds landing inside one 10 Hz hit-point sample are one drop.
- A bot far from any human fires "fake" rounds the server never counts
  (AI-134), but the client still sees them fired, so on a bot server a bot's
  rebuilt fired is higher than the server's. The lab's bot rounds are no use
  for checking the rebuild for the same reason.

When checking the rebuild against a tally, take the round's start from
`roundClock(rec, statsT)`, not `simStart` (that is the client's, and a late
joiner has one too), and only files that cover the round from its start.

## Shot lines

Asked 2026-11-01: "players just want to see a round firing with its tracer in
any particular battle", then "we're not talking about tracers are we, but more
of a debug style that draws these lines", and "lets try our best to originate
the traces from the muzzle of the weapon". It is the engine's `game.drawDebug`
(IMP-9, IMP-10) for every player of a replay: the menu's (`...`) **Shot
lines**, off by default, remembered in the browser (`localStorage`
`bf42-replay-shot-lines`). `viewer/replay-shotlines.js`.

A line runs from where a round left to where it stopped, green for a hit and
red for a miss, and fades over its last two of four seconds of replay:

- a server recording with the server's collisions (`i`, below) draws those:
  the round's fire origin to the contact point, green when the server credited
  damage during the collision;
- any other recording draws each recorded round (`f`). Its verdict is the
  Accuracy rebuild's (`rebuildTallies` `verdicts`): a hit ends where the round
  met its victim; a miss ends where the page's own replayed round struck
  (round-impact.js records, matched by launch point within 6 m and line within
  3 degrees). The page's round does not stop on a replayed soldier, so it is
  never the hit test. A miss whose round struck nothing has no line, as in the
  game.

The line starts at the drawn gun's muzzle as it fired (`shotMuzzles`). A soldier
whose weapon is not drawn now holds the replay's own copy of the gun at the
row's `p` (his eye, XHIT-18) down the recorded aim, and its barrel tip is the
flash emitter `e_Muzz<gun>`: a hand weapon's `<Weapon> muzzle 1` node sits at
its grip. A Bar1918's line starts 0.68 m out along the aim, and its flash goes
up there rather than over a prone man's back (`replay-bodies.js` `flash`).

A first try drew every round as a tracer streak ("Trace every round",
`330cc860`): a 2 cm stand-in widened on screen, which read as rounds leaving
from behind the shooter. It is gone.

Tests: `tests/test_replay_shotlines.py`.

## What the recorders now write

So the server's own count is in more files (owner, 2026-11-01: "you can make
changes to the server and bf42 plus recording to capture more data"):

- **The server recorder** (`features/server-replay-recorder`, `a95c257`): `hg`,
  one line per damaging round the server credits (`addBulletsGivingDamage`,
  IMP-11, blasts included), and `i`, one per projectile collision, where
  `drawDebug` keeps its lines (IMP-9, IMP-12). `recordHits` and `recordImpacts`
  in `recorder.con`, both on by default. A server file's board takes its hits
  from `hg` and its rounds from `f` as they stand (one per barrel already, a
  bot's fake round left out).
- **The bf42plus client recorder** (`3d55e35`): `hm`, the recording player's
  own crosshair hit mark as the server raised it (XHIT-6). The board gives his
  bullet hits to the weapon he last fired (a blast raises no mark, XHIT-4, so
  his blast hits stay rebuilt), and the crosshair marks use them as they are.

## Also fixed

The scoreboard's status cell was classed `st`, which the creator studio's root
rule (`replay-studio.js`, `.st { position: fixed; inset: 0 }`) also matched: every
row's names and columns were shifted one cell left. It is `rp-bst` now.

## Tests

`tools/bf1942-models/tests/test_replay_accuracy.py` (`replay_accuracy_harness.mjs`): the
tallies, the running totals and their scaling to the tally, the fire buckets, the
rounds fired at a player, whom a player fired at (the mirror of the first) and
one player's detail.

## Open

- The weapons, range, fired-at and under-fire panels are whole-round only. The range and
  target panels count all weapons under a filter. Per-kind detail would need
  `playerDetail` per kind.
- The crosshair's hit marks (`replay-hitmarks.js`) still mark one hit a drop;
  the rebuild's per-round rule would serve them too.
- The barrel counts come from loaded hull models. Adding `muzzles` to
  `damage.json`'s weapons would give them without the models.
