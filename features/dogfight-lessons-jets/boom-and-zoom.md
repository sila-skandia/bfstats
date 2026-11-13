# Boom and zoom on a jet

Status: **re-tuned on the F-16 under the roof** (2026-11-11). Both claims at
the lesson's heart hold from all nine starts: the pilot who never looks up
is shot down (9 of 9, 13 to 52 s in), and the one who meets the dive is never
hit (and once it is met the ace never gets above them again). The jet has a
way out, and it is the opposite of the Spitfire's: **up, not down**. Meet
the dive, then straight on at full throttle climbing 3 degrees to the top of
the sky, where a jet is fastest: clear in 9 of 9, never hit. The Flip and the
Ninja get no shot (0 of 9 each). Survival "yes". The Spitfire's verdict lines
(72 m/s, 732 m, "9 of 9" running low) were never true on a jet and are gone.

Every number here was measured on the roof as reworked in `868247883`
(`underRoof` caps only the pull toward the sky and leaves the plan its roll),
with `4a526cfea`. A first pass was made on the first roof (`8d616bcc2`) and
is not quoted; what it changed is in "On the first roof" below.

Files: `viewer/dogfight-lessons/jets/boom-and-zoom.js` (the words, the burst and the
fight's length, the moves' seats and ace, verdicts, survival),
`viewer/dogfight-lessons/jets/plan-boom-and-zoom.js` (`jetBzDip`, `jetBzAceMeet`),
`tests/test_dogfight_jet_boom_and_zoom.py` (every number the words give; 16
tests, about 70 s). `tests/test_dogfight_jets.py` keeps only the check that a
jet file is laid over its lesson (`JetFileTests`).

## What the pass costs on the F-16

Real metres and m/s, the harness's nine starts (x -30/0/+30 by speed
-3/0/+3).

- **The perch.** The ace starts at 730 m (paced heights are bent over toward
  760, `pacedHeight`), you at 358 m: 372 m under them, where before the roof
  it was 512.
- **The first pass.** They dive 35 degrees down to you from 338 to 356 m
  above, 589 to 621 m out, and one 1.1 s burst lands 15 to 23 rounds. Twice in
  nine that is the kill (12.7 and 13.8 s).
- **The second pass.** In the other seven the wingover brings them round 832
  to 964 m out and 290 to 318 m up, and the dive lands 9 to 20 rounds: down at
  42.1 to 51.8 s.
- **The lesson's own 0.6 s burst** brings down 1 of 9 in 60 s (the rest hit 11
  to 21 times): the jet file keeps 1.1 s and 60 s.

## The fights, before and after (F-16, nine starts)

Demo lines are the harness's nine (`node tests/dogfight_jet_harness.mjs
boom-and-zoom --text`, `--demo move`; `-` nobody down, `ACE@t` you shot down).
Moves are the measure's nine (`dogfight-measure.js` STARTS, `--moves`),
scored with `scoreMove` as the theatre's `movesOn` scores them. "Before" is
the previous jet file (burst 1.1 s, 60 s, nothing else) on this roof; "as
written" is the lesson with no jet file on this roof.

| Demo | As written | Before | After |
|---|---|---|---|
| `move` never looks up | 1 of 9 down (43 s), the rest 15 to 21 hits | 9 of 9 down, 13 to 52 s | the same fight: **9 of 9**, 12.7 to 51.8 s, one pass (2) or two (7); words rewritten |
| `counter` meet the dive | nobody hit | nobody hit | the same fight: nobody hit, the ace fires no round; one dive each, then both level at 764 to 770 m |
| `dip` (90 s) | 0 of 9: never hit, closing at the end in six; never flown in three (starts 4, 6, 7) | the same | **9 of 9**: `jetBzDip` against `jetBzAceMeet` (below) |
| `flip` (22 s) | 0 of 9: flown in eight, no shot | the same | the same fight, words rewritten |
| `ninja` (25 s) | 0 of 9: no shot either way | the same | the same fight, words rewritten |

On this roof the lesson's own ace needed nothing: the burst and the fight's
length the jet file already had make the pilot who never looks up go down in
all nine.

### Why the ace stopped diving in three starts of the Dip

Not the ace and not the roof: your climb. `meetTheDive` (and `bzDip` until
its run) climbs at up to 20 degrees, about 30 m/s up at a jet's speed. The
ace's perch flies level toward you until you are 35 degrees under them, or
10 s. From a perch only 372 m over you, in starts 4, 6 and 7 (you 10 m higher
or 3 m/s faster) your climb takes you up to them first: you are 60 m under
them at 10 s, the perch times out, the dive pulls out at once, and with no
dive coming `meetTheDive` never turns to face one, so the Dip never starts.
The same happens in two of the nine `counter` fights (their one dive comes
from 67 m above you), harmlessly. On the first roof both planes then circled
at 837 m to the end; on this one they climb on and fly level near 770 m, but
the Dip is still never flown.

The moves' ace on a jet is `jetBzAceMeet`: `bzAceMeet` that, with
`perchDown: 30` in its memory (the Dip's `aceMemory`), dives as soon as you
are 30 degrees under its horizon. You are 30 to 35 degrees under them from
the start, so they dive at once in all nine and you meet the dive 4.9 to 5.4 s
in. It is only the moves' ace: the same rule on the lesson's ace (`move`)
makes the first dive come from further out and land less (first roof: 4 of 9
down).

### The Dip: up, not down (9 of 9)

The flight law thins the air with height, and the drag with it, so a jet is
fastest at the top of the sky: the F-16 levels at 128 m/s at 770 m, and at 93
m/s at 215 m. The Spitfire's Dip (`bzDip`) runs low, nose 6 degrees down to
150 m at its size and level there; on a jet the ace dives after it again and
again from its height and closes (`dipLow` in the test: never hit, never away,
still closing at 90 s; 0 of 9).

`jetBzDip`: meet the first dive head on (`meetTheDive`), then straight on out
of the pass the way it left you, full throttle, the nose 3 degrees up. Out in
all nine and never hit; their guns never bear. They dive after you once more,
16 s in, from 1.7 to 1.8 km back and only 153 to 189 m above you (you have
climbed toward them), never get within 798 m from 10 s on, and let you go
19.6 to 20.4 s in (`bzAce`'s rule: beyond their guns' reach and not closing
for 6 s). At 90 s you are 16.8 to 17.3 km apart, you at 770 m and 128 m/s.

Sensitivity (the measure's nine): climbing 2, 3 or 4 degrees, 9 of 9, all let
go; 5 degrees, 9 of 9 by the score but in four they follow you level at the
top of the sky 1.6 km back at your own speed (the range not opening); 8
degrees, all nine of that kind; level (0 degrees), 4 of 9. The 3 degrees is
the middle of the band that gets let go.

`jetBzDip` carries no step list: `test_dogfight_jets.py` `JetStepsTests`
holds that boom and zoom has none on a jet (below, "Shared").

### The Flip and the Ninja (0 of 9 each)

Both open where the Spitfire's lesson has their height spent: both climbing,
the ace at 575 m, you at 609 m. On a jet nobody's height is spent there: the
ace turns to face you 1.3 to 3.3 s in (`meet`), and both climb on toward the
top of the sky.

- **Flip.** They face you again 12.2 to 13.4 s in. In eight you go in behind
  them at 9.6 to 10.9 s and come within 32 to 59 m of them, but your guns
  never bear; in the ninth you never go in. Nobody is hit.
- **Ninja.** You get over them 4.5 to 8.6 s in (`ninja-perch`), never far
  enough over for the dive's gate, and run 7.9 to 10.1 s in. Nobody fires a
  shot that bears; at 25 s you are 1.7 to 3.2 km apart.

### Survival and FLY IT

"Yes", on the Dip. FLY IT's guide should fly `jetBzDip` against
`jetBzAceMeet` (with `perchDown: 30`) for the lesson's way out; the counter
(`meetTheDive`) is unchanged. The lesson's `flyAce` is `bzAce`, which flies
the jet as it is (nothing in this lesson needed a jet copy of it).

## Tried and not shipped

On the first roof, all since superseded by the rework:

- **A jet copy of the lesson's ace** (`jetBzZoomer`, with `jetBzAce` and a
  copied `bzAceMeet` over it) that did not start a dive more than 50 degrees
  down, and flew its perch, dive and nose-down wingover with `roof: false`.
  It made the pilot who never looks up go down in 9 of 9 by 55 s, mending
  two starts whose wingover came out 340 m straight over the target and one
  whose ace sat at 829 m in its "dive" for 25 s while the range opened from
  1.7 to 3.4 km: both were the first roof taking over every answer above
  800 m. On the reworked roof the plain `boomAndZoom` does it (9 of 9 by 52 s)
  and the copy was removed.
- **Your start lower** (218 to 307 m), to give the ace its old 512 m over you:
  the Dip was flown in all nine, but the first dive came from 735 to 804 m out
  and the pilot who never looks up went down in only 4 to 6 of 9.
- **A longer burst** (1.2 to 1.4 s) or opening fire further out: the count
  swung from 0 to 9 with each small step; at 1.4 s most kills came on the
  first pass, a one-pass lesson.
- **A Dip up to the roof** gave 9 of 9 there too, but only because the ace
  could not turn after you at 828 m; with a level chase written for it at the
  roof, it went up to 882 m. Not shipped then; on the reworked roof the same
  run is honest (the ace turns, and lets you go).

## The MiG-29 (pace 1.5)

The same file, the F-16's tuning. At the MiG's pace the perch is 748 m and
you start at 420 m: 219 m apart at the Spitfire's size, not 290. The first
dive (520 to 532 m out, 298 to 306 m up) lands nothing in all nine; the pilot
who never looks up is shot down in 2 of 9 (53 to 54 s), the rest hit 8 to
20 times. Meeting the dive: nobody hits you; their one dive comes at their
perch's end, 10 s in, from about your height (your climb has brought you up
to them). The Dip is never flown (no dive to meet, even diving at 30
degrees), the Flip and the Ninja get nothing: 0 of 9 each. Every plane in
every demo and move tops out at 771 to 787 m.

## Shared (not changed here)

- **`JetStepsTests`** in `test_dogfight_jets.py` asserts
  `jet_steps("boom-and-zoom")["steps"] == {}`. The re-flown jet Dip should
  carry its own steps (face their dive, the nose no more than 15 degrees up;
  they zoomed: straight on, full throttle, the nose 3 degrees up); adding them
  needs that line changed.
- **`boomAndZoom`'s perch** times out after 10 s and dives from whatever height
  it has: on a jet against a climbing target, a dive from level. Mended only
  for the moves (`perchDown`); FLY IT's `bzAce` still does it.
- **README row** for Boom and zoom ("Where the lessons stand") still gives the
  old line; the caller owns the README, `guide` and `flyAce`.

## Open

- Nobody has flown this lesson by hand in FLY IT on a jet.
- The tuning is the F-16's. On the MiG-29 the perch is too low for the dive to
  bear: the pilot who never looks up mostly lives, and no Dip is flown.
- The Dip's 3 degrees sits in a band (2 to 4) that gets let go; steeper and
  they follow you level at the top of the sky, never closing.
