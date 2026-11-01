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

Tests: `tests/test_replay_shotlines.py`; the muzzle in
`tests/test_relay_hand_rounds.py`.

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

`tools/bf1942-models/tests/test_replay_accuracy.py` (`replay_accuracy_harness.mjs`).

## Open

- Hits by what was hit (soldier, armour, aircraft) and accuracy over the round:
  the rebuild knows both per round; the board shows neither yet.
- The crosshair's hit marks (`replay-hitmarks.js`) still mark one hit a drop;
  the rebuild's per-round rule would serve them too.
- The barrel counts come from loaded hull models. Adding `muzzles` to
  `damage.json`'s weapons would give them without the models.
