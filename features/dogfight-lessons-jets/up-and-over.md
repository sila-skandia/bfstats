# Up and over, on a jet

Status: **re-tuned** (2026-11-10), **re-flown against a jet ace**
(2026-11-11), and **re-measured under the roof** (2026-11-11): every jet
pilot now levels off under the top of the sky, the ace keeps its loop out of
that roof, its loop tops out under 800 m on both jets, and the words say what
the nine starts fly now. Dip 9 of 9 on both jets, Flip 0, Ninja 0. Files:
`tools/bf1942-models/viewer/dogfight-jet-up-and-over.js`,
`viewer/dogfight-jet-plan-up-and-over.js` (`jetUoDip`, `jetUpAndOver`,
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

The jet's ace (`jetUp` in `dogfight-jet-plan-up-and-over.js`, wrapping
`upAndOver`, `uoAce` and `uoAceSharp` as `jetUpAndOver`, `jetUoAce`,
`jetUoAceSharp`):

- **Over the top at 550 m.** The pull goes `over` at `OVER_AT` real metres
  (`mem.overAt`), a loop while the air still turns the nose. Measured from the
  lesson's start: over at 650 m the F-16 cannot pull its nose over in the
  thin air and goes on up to 1,190 m; at 600, to 965 m; at 550 it loops, the
  top at 725 m.
- **Under the roof like everyone, but not in the loop.** Since 2026-11-11
  every jet pilot's answer is put under the roof in `stepPilot` (below). The
  ace opts out (`roof: false`) for its pull, its loop (from `over` until it is
  off its back in `pounce`) and its recovery. A zoom the roof has levelled
  goes `over` as a turn back to them, level or nose down (`turnToward`, the
  roof on it), not a loop: a loop from level at the roof went up to 1,330 m.
- **Never hangs.** In `over`, `pounce` or `zoom`, slower than 45 m/s (the
  Spitfire's size, 58 real) and not diving, the nose goes 35 degrees down
  until the speed is back over 60.
- How it knows the ceiling for the airframe it is on: `paceOf` reads the pace
  the step context carries (`c.pace`); see
  [under-the-height.md](under-the-height.md), "The ace that knows where the
  top is" and "The guard, and what the roof still does".

From every start of every demo and move: the F-16's ace tops its loop at
725 m, never goes over 838 m (a later zoom, levelled by the roof), and never
flies slower than 76 m/s after its first top except in one Dip start (45 m/s,
then the recovery) and one Flip start (65 m/s). The MiG-29's tops its loop at
773 to 775 m, never goes over 851 m, never slower than 58 m/s.

## What the follower should do

Against the jet ace, nine starts each, under the roof:

| follower | what happens |
|---|---|
| follow them up (`followStraightUp`, the lesson's `move`) | you are 49 to 58 m under them as they go over, then level off under the top of the sky at 785 to 835 m, slowed to 30 to 53 m/s; they come back down past you and hit you once 9 s in from five of the nine (one of them once more at 33 s); you land a round in two, before they pull; nobody shot down |
| follow shallow at 25 degrees (`shallowFollow`, `counter`) | the shot as their nose comes up through 62 to 65 degrees, 387 to 426 m out, 4.8 to 5.7 s in: 6 to 12 hits in seven, none in two (30 m right, as fast or 3 m/s faster); climbing on after them, you level off at 827 to 833 m, slow; their guns find you twice, 3 hits at 13 s and 1 at 45 s |
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
nine (`dogfight-measure.js` `STARTS`, the L9 over x, z, height and speed),
scored with `scoreMove` and `movesOn` exactly as the theatre counts them.
"Before the roof" is the jet ace of 2026-11-11 with only its own roof; "under
the roof" is every jet pilot under it, this plan as it is now.

| demo | before the roof | under the roof |
|---|---|---|
| move | 0/2, 0/0, 0/2, 0/0, 0/0, 0/0, 0/0, 0/1, 0/2; you never under 60 m/s, 38 to 53 m under them as they go over | 1/0, 1/0, 0/0, 0/0, 0/0, 1/0, 1/0, 2/1, 0/1; nobody shot down; you level off at 785 to 835 m, slowed to 30 to 53 m/s; the ace over at 552 m, top 725 m at 8.8 s |
| counter | 0/12, 0/8, 0/8, 0/7, 0/7, 0/7, 1/6, 3/1, 0/1; you on up alone to 1,151 to 1,316 m | 0/13, 0/8, 0/8, 0/7, 0/7, 0/7, 1/8, 0/1, 3/1: the same shot as they pull (6 to 12 hits in seven; two later hits from one start, one from another); you level off at 827 to 833 m |
| dip | **9 of 9**, never hit; the shot lands 0 to 10; you pass them at 8.7 s; they chase 6.0 to 7.3 s and let go 23.8 to 26.8 s; 2.3 to 2.9 km apart at 35 s | **9 of 9**, never hit; the shot lands 0 to 10; you pass them at 8.7 s and the pass carries you up to 779 to 784 m, where you level off at 24 to 34 m/s; they break round at you and let go 17.1 to 17.8 s (in one, after a 7 s chase, 25.6 s); 1.85 to 1.96 km apart at 35 s, opening |
| flip | **0 of 9**: never started (following them up you were never slow) | **0 of 9**: started in all nine, levelling off slows you to 54 m/s at 690 to 700 m, 9.2 to 9.4 s in; in their rear quarter in only two, 23 and 26 s later, and never a burst in time |
| ninja | **0 of 9**: no `ninja-shoot`; you on up alone to 1,289 to 1,584 m, slowing to 22 to 37 m/s; hit in four, 1, 1, 11 and 2 times | **0 of 9**: no `ninja-shoot`; you level off at 827 to 829 m, slowing to 25 to 60 m/s; you land a round in two; never hit |

Claims, one by one:

- "Following them up gets nothing": **holds**, and now costs a round: you do
  not hang under them, but you level off slow under the top of the sky while
  they come back over, and they hit you once in five of the nine.
- "Following shallow gets the hits": **holds, about half**, as before: the
  shot is the pull, not the top; one burst, no kill, no second.
- "They hang slow at the top inside your guns": **false** on a jet, and still
  rewritten.
- Survival: **yes**, the Dip 9 of 9, never hit.
- The coach's `over`, `pounce` and `zoom` lines say they come straight back
  down, and to go past them and away.

## On the MiG-29 (pace 1.5)

The same lesson. The ace climbs at 91 to 103 m/s, its nose to 53 degrees,
goes over at 551 m 3 s after the pull and tops its loop at 773 to 775 m 7.7 s
in, from every start of every demo and move; the highest it goes is 851 m, in
a later climb the roof levels off. Following them up, they hit you once in two
of the nine and you land nothing. Following shallow lands 8, 8, 11, 3, 3, 1,
1, 0, 1; they hit you in one. Dip 9 of 9, never hit, 2.07 to 3.74 km apart at
the end, your seat never under 60 m/s in it. Flip 0, Ninja 0. Nobody, in any
demo or move, goes over 852 m. The words' numbers are the F-16's.

## Under the roof (2026-11-11)

Commit `8d616bcc2` put every jet pilot under the roof: whatever a jet
pilot's plan answers goes through `underRoof` in `stepPilot`
(`dogfight-pilot.js`), unless it says `roof: false`. Flown with it and this
lesson's files as they were, 10 of the 21 tests failed. What moved, and why:

- **Your seat no longer coasts up alone.** Following shallow, climbing on, you
  used to go up to 1,151 to 1,316 m; in the Ninja to 1,289 to 1,584 m. Under
  the roof you level off at 827 to 833 m. Following them up you level off at
  785 to 835 m, and the levelling (the throttle comes off while the nose is
  well over the climb the roof allows) slows you to 30 to 53 m/s, where you
  had never been under 60: you are slow under them as they come over, and
  they get a round into you in five of the nine. The Flip, which waits for
  you to be down to 54 m/s, now starts in all nine (it used to never start)
  and still fails. These are different fights, and the words now say what
  they do.
- **The ace's own roof was redundant.** The plan put every non-loop answer
  through `underRoof` itself, and `stepPilot` then did it again: the second
  pass changes nothing, so the plan's calls were removed and every flight
  stayed the same to the last decimal (checked on the F-16, the measure's
  output byte for byte). The roof's cap on the wingover's climb
  (`maxUp: roofClimb(c, 25)`) went the same way: `maxUp: 25`, with the shared
  roof over it, flies identically.
- **What the plan keeps, and why.** The over-the-top height (`OVER_AT` 550 m),
  the loop opted out of the roof (pushing a nose past the vertical back down
  is the long way round), and the slow recovery, now also opted out: under
  the shared roof the recovery's 35 degrees nose down was replaced by the
  roof's allowed climb with the throttle off, and the ace fell to 27 m/s in
  one Dip start; out of the roof it falls only to 45 m/s and recovers.
- **The MiG-29's loop, under 800 m.** Under the shared roof the MiG-29's pull
  was held to 46 degrees (the roof leads by the rate the nose is rising at),
  and a loop from that shallow a climb topped out at 880 to 884 m in all nine
  starts of every demo. The pull now opts out too: it ends at 550 m, under
  the roof anyway. The MiG-29 pulls to 53 degrees and loops over at 773 to
  775 m. The F-16's pull already reached 72 degrees and flies identically.
  A loop opted out until it leaves `over` was not enough: on the MiG-29 the
  ace goes `pounce` still on its back at the top when you followed them up,
  the roof rolled it upright, and it never came back down, flying on level at
  850 m for 30 s. So the loop's opt-out lasts through `pounce` while the ace
  is inverted. On the F-16 that changes the move (they now hit you once 9 s
  in from five starts, where before they hit you in only one, at 24 and
  33 s) and the Flip's details (still 0 of 9); the counter, the Dip and the
  Ninja fly identically.
- **An over-the-top height that falls with the pace was tried and dropped.**
  With the roof leading the pull, a lower `OVER_AT` on the MiG-29 only made
  the pull shallower: at 500 m it reached 38 degrees, no loop, and the Dip
  went to 0 of 9; at 460 m, 23 degrees, Dip 7 of 9.
- **The Dip, re-measured, not re-tuned.** Still 9 of 9 on both jets, never
  hit, its four phases unchanged. What changed is how it gets away: the pass
  carries you up steeply, the roof levels you off at about 780 m at 24 to
  34 m/s, and the ace breaks round at you and lets you go 17 to 18 s in
  (it used to chase 6 to 7 s and let go at 24 to 27 s); you end 1.85 to
  1.96 km apart instead of 2.3 to 2.9. Three ways of keeping your speed in
  the run were flown and are worse: the run out of the roof coasted up to
  1,291 m in one start (8 of 9); out of the roof with the throttle off while
  over the allowed climb, 6 of 9, the ace chasing; the pass's climb capped at
  25 degrees, 7 of 9 on the F-16 and 3 of 9 on the MiG-29 (at 35 degrees,
  9 and 6). The step "Full throttle (W)" now reads "Level off, then full
  throttle (W)".

## Open

- **The roof holds a nose up that the plan wants down.** `underRoof` replaces
  a plan's answer with the climb the roof allows whenever the plane is
  climbing more steeply than that, even when the plan asks for less: the
  Dip's run asks for 6 degrees down, and the roof holds the nose at the
  allowed climb (43 degrees at 632 m in one start) with the throttle off, so
  the seat slows to 24 to 34 m/s at 780 m. A human pushing the nose down at
  full throttle would not. This is shared (`dogfight-jet-ceiling.js`); a fix
  there (the smaller of the plan's climb and the allowed one) moves every
  jet lesson.
- **The live fight** (FLY IT, `flyAce: 'jetUoAce'`) is fitted to a jet
  ([live-fight.md](live-fight.md)); nobody has flown this lesson in it by hand.
- **The Flip and the Ninja** are 0 of 9 and not re-tuned: both wait for a
  slow moment over the top that a jet never gives. A jet Ninja would be built
  on the pull's shot and the ace's descent.
- **Sensitivity.** The fights move with the ace's numbers: with `OVER_AT` 450
  the old Dip (before the pass) worked 8 of 9; at 500 it failed in all nine,
  and under the roof 500 m costs the new Dip two of nine on the F-16. 550
  keeps following shallow's shot as it was and is the highest the F-16's
  loop still comes round from.
