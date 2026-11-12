# Up and over, on a jet

Status: **re-tuned** (2026-11-10), **re-flown against a jet ace**
(2026-11-11), and **re-measured under the roof** (2026-11-11, twice: the
first shared roof, then the reworked one): every jet pilot flies under the
top of the sky, the ace keeps its pull, its loop and its recovery out of that
roof, its loop tops out under 800 m on both jets, and the words say what the
nine starts fly now. Following them up, it is you who ends up slow at the
top. Dip 9 of 9 on both jets, Flip 0, Ninja 0. Files:
`tools/bf1942-models/viewer/dogfight-lessons/jets/up-and-over.js`,
`viewer/dogfight-lessons/jets/plan-up-and-over.js` (`jetUoDip`, `jetUpAndOver`,
`jetUoAce`, `jetUoAceSharp`), `viewer/dogfight-jet-ceiling.js` (the roof,
every jet pilot's since 2026-11-11), `tests/test_dogfight_jet_up_and_over.py`.
The Spitfire's version: [vertical.md](../dogfight-school/reviews/vertical.md),
[loop.md](../dogfight-school/reviews/loop.md),
[dfn-uo.md](../dogfight-school/reviews/dfn-uo.md).

## What a jet does going up

The Spitfire lesson rests on the follower running out of speed first:
straight up, a Spitfire loses 10 to 14 m/s a second, the leader goes over
the top at 46 m/s and the follower hangs at 13 m/s under them. A jet does
not run out of speed. Flown on the F-16 from the lesson's start (paced 1.28:
the ace at 100 m/s, you at 64, 358 m up), the ace pulls at 1.5 s and with
its nose over 60 degrees never drops below 71 m/s.

What stops a jet is the air. `aircraft.js` `medium`: every surface's lift is
multiplied by `1 - clamp(y / 1000, 0, 1)`, so half at 500 m and nothing at
1,000 m.

## The ace (2026-11-11)

Flown as written, the ace was the Spitfire's `upAndOver`, which waits for
`OVER_SPEED` (46 m/s at the Spitfire's size, 59 real) before going over the
top. That never comes on a jet: its pull timed out at 10 s, at about 1,000 m,
it topped out at 1,182 m 14.7 s in, took 11 s to fall back under 700 m and
wallowed at 15 to 60 m/s for 20 s or more (full aft stick at low speed, `over`
and `zoom` cycling under `OVER_SPEED`), even down at 300 m. An ace that falls
out of the sky is not an ace.

The jet's ace (`jetUp` in `dogfight-lessons/jets/plan-up-and-over.js`, wrapping
`upAndOver`, `uoAce` and `uoAceSharp` as `jetUpAndOver`, `jetUoAce`,
`jetUoAceSharp`):

- **Over the top at 550 m.** The pull goes `over` at `OVER_AT` real metres
  (`mem.overAt`), a loop while the air still turns the nose. Measured from the
  lesson's start: over at 650 m the F-16 cannot pull its nose over in the
  thin air and goes on up to 1,190 m; at 600, to 965 m; at 550 it loops, the
  top at 725 m.
- **Under the roof like everyone, but not in the loop.** Every jet pilot's
  answer is put under the roof in `stepPilot` (below). The ace opts out
  (`roof: false`) for its pull, its loop (from `over`) and its recovery. A
  zoom the roof has levelled goes `over` as a turn back to them, level or
  nose down (`turnToward`, the roof on it), not a loop: a loop from level at
  the roof went up to 1,330 m.
- **The zoom back up off a pounce climbs at 35 degrees at most** (`ZOOM_MAX`).
- **Never hangs.** In `over`, `pounce` or `zoom`, slower than 45 m/s (the
  Spitfire's size, 58 real) and not diving, the nose goes 35 degrees down
  until the speed is back over 60.
- How it knows the ceiling for the airframe it is on: `paceOf` reads the pace
  the step context carries (`c.pace`); see
  [under-the-height.md](under-the-height.md), "The ace that knows where the
  top is" and "The guard, and what the roof still does".

From every start of every demo and move: the F-16's ace tops its loop at
725 m, never goes over 770 m, and never flies slower than 44 m/s after its
first top (the recovery catches it). The MiG-29's tops its loop at 773 to
775 m, never goes over 809 m, never slower than 63 m/s.

## What the follower should do

Against the jet ace, nine starts each, under the roof as it is now:

| follower | what happens |
|---|---|
| follow them up (`followStraightUp`, the lesson's `move`) | you are 55 to 62 m under them as they go over, then climb on into the thin air at 773 to 786 m while they come back down, and slow there to 18 to 27 m/s; in four of the nine they come round and hit you about 31 s in (1, 4, 5 and 5 times); you land a round in two, before they pull; nobody shot down. On the MiG-29 you hang in seven and are shot down in four |
| follow shallow at 25 degrees (`shallowFollow`, `counter`) | the shot as their nose comes up through 62 to 65 degrees, 388 to 426 m out, 4.8 to 5.7 s in: 6 to 12 hits in seven, none in two (30 m right, as fast or 3 m/s faster); climbing on you go up to 714 to 804 m; they never hit you |
| the shot at 25, then past them as they come down, then away | 9 of 9, never hit: `jetUoDip` |

So the Dip is the shot as they pull, then the pass, then the run (`jetUoDip`,
four phases, unchanged): chase; when their nose comes up, climb after them at
25 degrees on their bearing, never into their climb, and take the shot as
they pull (`dip-shot`); when they come back over the top at you, or their
nose has come down past 30 degrees, past them, 80 m beside and 30 m under
their dive (`dip-pass`); then full throttle straight away from them, the nose
6 degrees down to level between 240 and 180 m at the Spitfire's size
(`dip-run`). `tests/test_dogfight_jets.py` `JetStepsTests` holds the four
phases, each timed (chase 0, dip-shot 3.1, dip-pass 8.7, dip-run 10.2 s from
the lesson's start).

## The nine starts, before and after (F-16)

`move` and `counter` from the harness's nine (`--text`: your x -30/0/+30 m
by speed -3/0/+3 m/s; hits theirs/yours). The moves from the school's own
nine (`dogfight-measure.js` `STARTS`), scored with `scoreMove` and `movesOn`
exactly as the theatre counts them. "No shared roof" is the jet ace of
2026-11-11 with only its own roof; "first roof" is `8d616bcc2`; "now" is the
roof of `868247883` with this plan.

| demo | no shared roof | first roof | now |
|---|---|---|---|
| move | 0/2, 0/0, 0/2, 0/0, 0/0, 0/0, 0/0, 0/1, 0/2; you never under 60 m/s | 1/0, 1/0, 0/0, 0/0, 0/0, 1/0, 1/0, 2/1, 0/1; you level off at 785 to 835 m, 30 to 53 m/s | 0/0, 0/0, 1/0, 0/0, 0/0, 0/0, 4/0, 5/1, 5/1; you climb into the thin air at 773 to 786 m and slow to 18 to 27 m/s; nobody shot down |
| counter | 0/12, 0/8, 0/8, 0/7, 0/7, 0/7, 1/6, 3/1, 0/1; you on up to 1,151 to 1,316 m | 0/13, 0/8, 0/8, 0/7, 0/7, 0/7, 1/8, 0/1, 3/1; you level off at 827 to 833 m | 0/12, 0/8, 0/8, 0/7, 0/7, 0/7, 0/6, 0/1, 0/1: the shot as they pull, and their guns never touch you; you go up to 714 to 804 m |
| dip | 9 of 9; they let go at 24 to 27 s; 2.3 to 2.9 km apart | 9 of 9; you held nose up at about 780 m, slowed to 24 to 34 m/s; they let go at 17 to 18 s; 1.85 to 1.96 km | **9 of 9**, never hit; the shot lands 0 to 10; you go no higher than 755 m, never under 55 m/s; they chase you 7 to 12 s and let go at 24.5 to 29.4 s (one breaks round at you and lets go at 18.2 s); 1.3 to 3.8 km apart at 35 s, opening |
| flip | 0 of 9, never started | 0 of 9; started at 690 to 700 m; behind them in two, 23 and 26 s later | **0 of 9**: started at 667 to 707 m, 8.6 to 9.7 s in; the nose comes down so slowly in the thin air that you fall to 10 to 19 m/s; behind them in two, 8.5 and 17.4 s later, never firing |
| ninja | 0 of 9; you on up to 1,289 to 1,584 m; hit in four | 0 of 9; you level off at 827 to 829 m, 25 to 60 m/s | **0 of 9**: no `ninja-shoot`; you level off at 754 to 772 m, never under 55 m/s; you land nothing; hit in two, 2 and 3 times |

Claims, one by one:

- "Following them up gets nothing": **now worse than nothing**, the
  Spitfire's lesson come back by another road: the follower, not the leader,
  ends up slow at the top (the thin air, and the roof taking the throttle off
  a nose that is too high), and the ace comes round onto them. On the F-16
  they hit you in four of nine; on the MiG-29 they shoot you down in four.
- "Following shallow gets the hits": **holds, about half**: the shot is the
  pull, not the top; one burst, no kill, no second; never hit back.
- "They hang slow at the top inside your guns": **false** on a jet.
- Survival: **yes**, the Dip 9 of 9, never hit, on both jets.

## On the MiG-29 (pace 1.5)

The same lesson. The ace climbs at 91 to 103 m/s, its nose to 53 degrees,
goes over at 551 m 3 s after the pull and tops its loop at 773 to 775 m 7.7 s
in, from every start of every demo and move; the highest it goes is 809 m,
never slower than 63 m/s. Following them up you hang (the follower's own
`hang`) in seven of the nine at 20 to 27 m/s, and they shoot you down in four
(harness starts). Following shallow lands 8, 8, 11, 3, 3, 1, 1, 0, 1, and they
shoot you down in one, 36 s in. Dip 9 of 9, never hit, 3.3 to 6.1 km apart at
the end, never under 90 m/s. Flip 0, Ninja 0. Nobody, in any demo or move,
goes over 830 m. The words' numbers are the F-16's.

## Under the roof (2026-11-11)

Every jet pilot's answer goes through `underRoof` in `stepPilot`
(`dogfight-pilot.js`), unless it says `roof: false`. The roof as it is now
(`868247883`) does not put the nose anywhere itself: it caps how hard the
plan may pull toward the sky, in the plane's own pitch plane, less the pitch
rate already under way, and flies the plan's own pull wherever that asks for
less sky; roll, rudder and trigger stay the plan's. A pull that is taking the
plane over a loop that fits under the roof is left alone, and an inverted
plane may pull through. The throttle comes off while the nose is more than
15 degrees over the climb the roof allows.

The first shared roof (`8d616bcc2`) put the nose on the allowed climb itself,
and that held a nose up that the plan wanted down: in the Dip's run it held
your nose at 43 degrees with the throttle off, and you slowed to 24 to 34 m/s
at about 780 m. That is gone: the run now goes no higher than 755 m and never
under 55 m/s.

What the plan does with the roof as it is now, each tried out and in:

- **Its own roof is gone.** The plan used to put every non-loop answer
  through `underRoof` itself; with `stepPilot` doing it, the plan's calls
  were removed, and the wingover's climb cap is `maxUp: 25` with the shared
  roof over it.
- **The pull stays out of the roof.** Capped, the MiG-29's pull reaches 44
  degrees and its Dip works 3 of 9 (the ace's loop tops out at 738 to 802 m
  and its descent finds you); out of it, 53 degrees, the loop at 775 m and
  the Dip 9 of 9. The F-16's pull reaches 72 degrees either way.
- **The recovery stays out of the roof.** Roofed, its throttle comes off and
  the F-16 ace falls to 33 m/s; out of it, never under 44.
- **The loop through `pounce` while inverted is no longer opted out.** The
  roof lets an inverted plane pull through, so the opt-out was a workaround
  for the first roof: without it the F-16 flies identically, and on the
  MiG-29 only the follow-them-up demo moves (shot down in four of nine, six
  with it).
- **New: the zoom back up off a pounce climbs at 35 degrees at most.** In one
  Dip start the ace's pounce went up at you and its zoom pitched to 74
  degrees at 600 m at 84 m/s. In thin air the nose would not come back:
  out of the roof (the recovery at full throttle) it climbed on to 1,154 m,
  over the top of the sky; with the throttle off it hung at 9 m/s at 775 m.
  The zoom's climb capped at 35 degrees keeps both under: the F-16's ace
  never over 770 m, the Dip 9 of 9 (8 of 9 without it). A cap led by the
  roof (`roofClimb`, tau 3.5 s) also fixed the F-16, but the MiG-29's ace
  then kept its speed, sat 600 m behind your run and hit you, Dip 8 of 9;
  at tau 2 or 2.5 the F-16 ace went to 1,145 m again.
- **The Dip's words.** Its four phases are unchanged; "Level off, then full
  throttle" is back to "Full throttle (W), straight away from them, nose 6°
  down", which is what the run now flies.

The first roof's own record (it moved 10 of 21 tests: your seat stopped
coasting up to 1,150 to 1,590 m; the MiG-29's loop under it went to 880 to
884 m until the pull was opted out; a lower `OVER_AT` for the MiG-29 only made
the pull shallower, 38 degrees and Dip 0 of 9 at 500 m) is in this file's
history.

## Open

- **A nose already well over the allowed climb is not brought down.** The
  roof now only caps the pull toward the sky; a plane nose high and slow in
  thin air with the throttle off stays nose high while its speed bleeds
  away. Following them up on the F-16 (lesson start), the follower's reflex
  break at 9.5 s, 698 m: nose 58, 57, 55, 50, 42, 34, 26 degrees over 3 s,
  speed 54, 50, 44, 38, 31, 27, 24 m/s, to 776 m. The Flip's push down off
  their line falls to 10 to 19 m/s the same way, and the MiG-29's follower
  hangs and is shot down. Whether that is the thin air or the roof's throttle
  is not separated: a human would keep the throttle on.
- **The live fight** (FLY IT, `flyAce: 'jetUoAce'`) is fitted to a jet
  ([live-fight.md](live-fight.md)); nobody has flown this lesson in it by hand.
- **The Flip and the Ninja** are 0 of 9 and not re-tuned: both wait for a
  slow moment over the top that a jet never gives the leader.
- **Sensitivity.** The fights move with the ace's numbers: with `OVER_AT` 450
  the old Dip worked 8 of 9; at 500 it failed in all nine. 550 keeps
  following shallow's shot as it was and is the highest the F-16's loop
  still comes round from.
