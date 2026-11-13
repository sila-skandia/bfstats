# When they have the height, on a jet

Status: **re-measured on the reworked roof** (2026-11-11). Every jet pilot's
pull toward the sky is capped by 800 m and the ace starts at 735 m on the
F-16; nobody climbs over 780 m. Climbing between their dives is never fired
at and ends level with them, a kilometre apart; climbing straight is never
fired at but ends with them sitting behind you and you 11 to 86 m of energy
behind; turning flat is the one demo they fire in. Dip 9 of 9 (the lesson's
own `uhDip`), Flip 0, Ninja 0. Files:
`tools/bf1942-models/viewer/dogfight-lessons/jets/under-the-height.js` (the jet block),
`viewer/dogfight-lessons/jets/plan-under-the-height.js` (`jetBoomAndZoom`, `jetUhAce`),
`viewer/dogfight-jet-ceiling.js` (the roof, shared),
`tools/bf1942-models/tests/test_dogfight_jet_under_the_height.py` (every number the
words make, the ace's roof and slowest speed, and the tops of both planes).

History: re-tuned for jets 2026-11-10 (RETUNING.md); re-flown 2026-11-11
against a jet ace that levelled off under the top of the sky, then with every
pilot's ceiling guard read over the pace; re-measured the same day on the
first shared roof, and again on the reworked one (below).

## What was found

On a Spitfire the lesson is: climbing straight under a boom-and-zoomer is fatal
(down to 35 m/s on a straight line, shot down 9 of 9); turning flat is safe and
gains nothing; climbing between their dives wins the height back. On the F-16,
flown as written from the nine starts, **nobody is fired at, in any of the three**.
The diver cannot catch a jet that climbs: nose 30 degrees up at full throttle,
the F-16 *gains* speed as it climbs. The Spitfire's trap was the speed bleeding
away in the climb; a jet has the thrust not to bleed. That still holds under
the roof, but the roof changes how the climbs end.

## Under the roof (2026-11-11)

The roof (`dogfight-jet-ceiling.js` `underRoof`, applied in `stepPilot` to
every pilot of an airframe paced as a jet, `868247883`) caps how hard a plan
may pull toward the sky: in the plane's own pitch plane, over the share of the
lift that points up, less the pitch rate already under way, so the climb
allowed comes down to level by 800 m real. Wherever the plan asks for less it
is flown as asked; roll, rudder and trigger are always the plan's. A pull
taking the plane over a loop that fits under the roof is left alone, an
inverted plane may pull through, and the throttle comes off while the nose is
more than 15 degrees over the allowed climb. Paced start heights are bent over
toward 760 m (`pacedHeight`), so the ace starts at 735 m on the F-16 (750 on
the MiG-29), 505 m over you, 1.04 to 1.05 km out.

What is flown now, on the F-16:

- **No trap in the climb.** Climbing straight you are at their height 13.4 to
  13.7 s in. Their one dive starts at 10 s; at 13.6 to 13.8 s they pull out of
  it 411 to 449 m behind you and 2 to 5 m under you, without firing.
- **But the straight climb ends with them behind you.** You have the energy
  for a moment, 70 to 92 m of it at 25 s; then, flying straight on in front of
  them, they come up behind: for 8 to 38 s of the fight they sit inside 450 m
  with their nose on you. The boom-and-zoomer with no height to dive from never
  fires, and you, turning to look for them, end 11 to 86 m of energy behind, at
  752 to 768 m and 118 to 127 m/s.
- **Climbing between their dives ends level and apart.** One break, at 436 to
  484 m; their height at 24.4 to 26.0 s; 42 to 90 m of energy ahead for a moment
  at 26 to 28 s; at 55 s both at 767 to 768 m and 127 m/s, you 1 to 2 m ahead,
  1.05 to 1.11 km apart. They are never behind you.
- **Turning flat is the one they fire in.** Three dives (four in five); in
  three of the nine the third dive, 40 to 41 s in, gets a burst off from 300 to
  360 m and one round lands in each of the three (in two before the retail g of
  2026-11-12). You climb 126 to 128 m and end at
  357 to 358 m at 83 m/s, 340 to 416 m of energy behind.

So the lesson on a jet: their height is worth seconds against a full-throttle
climb, and under the top of the sky neither of you gets above the other. Climb
between their dives and break the one that commits; that is the climb that
ends level and clear of them.

### What moved from the first roof

The first shared roof (`8d616bcc2`) put the nose on the allowed climb itself
and, in a bank, turned it 35 degrees round the turn, replacing the plan's
roll. Above 800 m any level flight set it off, so a plane up there could not
roll out: both planes ended circling at 828 m, dead even in every climb, and
the lesson's Dip could not run straight (0 of 9: the plan commanded full roll,
the bank stayed at -44 to -47 degrees for 10 s). This page then carried a jet
Dip (`jetUhDip`) that ran once even and opted out of the roof (`roof: false`)
over 780 m. On the reworked roof the lesson's own `uhDip` runs straight and
gets clear 9 of 9, so `jetUhDip` is gone, and with it the `roof: false`.

### The Dip

`uhDip` as written: climb between their dives, break their dive and their
chase, and once their height is spent and you have 50 m of energy on them (in
the Spitfire's units, about 65 m real), run, the nose 2 degrees down. Never
fired at, never on your tail; the run starts 35.5 to 61.9 s in; in seven they
let you go 39.9 to 64.2 s in; at 70 s you are 1.05 to 8.71 km apart and
opening, at 116 to 124 m/s. Turned onto them on the way (they fly in front of
you), you land 1 to 3 rounds in six. **9 of 9.** The jet file gives it its own
step list (climb, break inside about 490 m, run), each step coming in order.

### The aces

`jetBoomAndZoom` and `jetUhAce` are the Spitfire's aces with one change: the
zoom is over once the roof holds it level (`atRoof`), and they go over the top
from there. On the F-16 that hand-over never fires (every number of all six
demos is the same without it); on the MiG-29 it does: without it the straight
climb ends 85 to 155 m behind instead of 5 to 6 m ahead. It stays. The aces no
longer call `underRoof` themselves; `stepPilot` does.

## What the jet file says

`note`, `story`, `counterStory`, the notes of all six demos, jet `verdict`s for
the Dip, the Flip and the Ninja, the Dip's `steps`, `survival`, `coach`, and the
aces (`ace.plan` `jetBoomAndZoom`; the Dip, the Flip, the Ninja and FLY IT's
`flyAce` `jetUhAce`). The claims, one by one:

- "Climbing straight is fatal": **false** on a jet, never fired at; but it ends
  with them behind you and a little ahead on energy.
- "Turning flat is safe and buys nothing": **buys nothing holds; safe does
  not quite**: shots in three of nine, a round landing in each.
- "Climbing between their dives wins the height back, never hit": **holds**: it
  ends level with them, apart, never with them behind you.
- The coach's "380 m" is the plans' threshold in the Spitfire's units, 486 m
  real: "about 490 m". The climb and zoom tips say level off under 800 m.

## The nine starts on the F-16

"First roof" is this page's previous measure (`8d616bcc2`, with `jetUhDip`);
"now" is the reworked roof. Harness starts (sideways -30/0/30 by speed
-3/0/+3) for the first three; the school's L9 starts (`dogfight-measure.js`
`STARTS`) for the moves, each scored by `scoreMove` as `movesOn` scores them.

| Demo | First roof | Now |
|---|---|---|
| move, climb straight | never fired at; their height 13.3-13.5 s; both circle at 828-829 m, 125 m/s; 0 to +2 m | never fired at; their height 13.4-13.7 s; +70 to +92 m at 24.9 to 25.7 s; they sit behind you inside 450 m for 8-38 s; ends 752-768 m at 118-127 m/s, -11 to -86 m |
| flat, turn flat | three dives (four in one), never fired at; ends 357 m at 83 m/s, -345 to -571 m | three or four dives; fired at in three (40-41 s, 300-360 m), one round in each; ends 357 m at 83 m/s, -340 to -416 m |
| counter, climb between | one break at 436-484 m; their height 24.0-25.0 s; ends 828 m at 125 m/s, 0 to +1 m | one break at 436-484 m; their height 24.4-26.0 s; ends 767-768 m at 127 m/s, +1 to +2 m, 1.05-1.11 km apart, never behind you |
| dip | `uhDip` 0 of 9; `jetUhDip` 9 of 9 | `uhDip` **9 of 9**, never fired at; run 35.5-61.9 s; let go in seven, 39.9-64.2 s; 1.05-8.71 km apart at 70 s, 116-124 m/s; 1 to 3 rounds of yours land in six |
| flip | **0 of 9**: the reversal flown in two, no shot | **0 of 9**: the reversal never flown |
| ninja | **0 of 9**: never the energy edge | **0 of 9**: the energy edge once, at 43.9 s in the sixth start, after they let you go 2.3 km off, and no dive; 1 to 3 rounds of yours land in six; never fired at; their paths cross at 21 m at the end of the third (on your six 0.13 s) |

The ace from 5 s on, every start of every demo: never over 778 m, never slower
than 83 m/s. `jet_tops`: nobody tops 780 m in any demo or move; the test also
holds the 860 m the school asks.

## The MiG-29 (pace 1.5), the same jet file

The words are the F-16's. The ace starts at 750 m, 480 m over you at 270 m
and 1.17 to 1.19 km out, climbs no higher than 785 m and never flies slower
than 103 m/s. Nobody is hit in the three demos; the ace fires in one flat turn
of nine and misses. The straight climb ends 5 to 6 m ahead, both at 784 to 785
m and 161 to 162 m/s, with them behind you for 3.7 to 5.7 s; climbing between
ends 3 to 4 m ahead (31 m behind in one; 28 before the retail g of 2026-11-12), at least 2.4 km apart, never behind
you; turning flat ends 442 to 551 m behind. Dip 8 of 9, Flip 0, Ninja 0. From
the lesson's own start (the fifth of the school's nine) they get onto your
tail in all three moves: six rounds land in the Dip, and in the Ninja you are shot
down. The other eight Dips are never hit and end 9.0 to 10.3 km apart.
The highest either plane goes is 777 to 785 m in every demo and move.

## Tried and not shipped

- **The guard alone**, no roof (before the shared roof): the ace's zooms ran on
  to 963 to 984 m before the guard caught them.
- **A roof at 900 m**: at a tenth of the lift the ace cannot hold level there
  and wallows. 800 m flies level.
- **Reading the pace off gravity**: the side force swamps it (0.49 for 1.28).
- **The jet Dip `jetUhDip`** (run once even, down off the roof first with
  `roof: false`): needed on the first roof, not on the reworked one, where the
  lesson's own Dip works 9 of 9.

## Open

- **The ace behind you does not shoot.** In the straight climb they sit inside
  450 m with their nose on you for up to 38 s and never fire: `jetBoomAndZoom`'s
  climb phase holds its fire, waiting for 150 m of height that the roof never
  gives it. A boom-and-zoomer who would take that shot makes the straight climb
  the trap again; it would be a new ace, not a re-measure.
- **The MiG-29 from the lesson's own start** loses the moves to the ace's
  guns (the Ninja shot down); the F-16 is never hit in any move.
- **Near misses.** In the counter the diver passes 56 to 80 m from you. The
  duel does not model a collision.
- **The Flip and the Ninja** were not re-tuned: the reversal waits for a slow
  overshoot the jet diver never gives; the ascendancy waits for an energy edge
  the roof never allows. 0 of 9 is the verdict.
- **The live fight** (FLY IT) flies `jetUhAce` ([live-fight.md](live-fight.md));
  nobody has flown it by hand.
