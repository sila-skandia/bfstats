# When they have the height, on a jet

Lesson `under-the-height`, re-tuned for jets 2026-11-10 (RETUNING.md), and
re-flown 2026-11-11 against a jet ace that respects the top of the sky. Files:
`tools/bf1942-models/viewer/dogfight-jet-under-the-height.js` (the jet block),
`viewer/dogfight-jet-plan-under-the-height.js` (`jetBoomAndZoom`, `jetUhAce`),
`viewer/dogfight-jet-ceiling.js` (the roof, shared with up-and-over),
`tools/bf1942-models/tests/test_dogfight_jet_under_the_height.py` (every number the
words make, and that the ace never climbs over its perch or slows under 80 m/s).

## What was found

On a Spitfire the lesson is: climbing straight under a boom-and-zoomer is fatal
(down to 35 m/s on a straight line, shot down 9 of 9); turning flat is safe and
gains nothing; climbing between their dives wins the height back. On the F-16,
flown as written from the nine starts, **nobody is fired at, in any of the three**.
Why, from the traces (`--trace move --step 1`):

- **The diver cannot catch a jet that climbs.** Nose 30 degrees up at full
  throttle, the F-16 *gains* speed as it climbs, at about 40 m/s upward. The
  ace's dive from 1.1 km out runs 120 to 130 m/s and closes on you at a few tens
  of m/s; it never gets inside 275 m (the ace opens fire at `open: 300`, 384 m
  real), and they pull out without firing. The Spitfire's trap was the speed
  bleeding away in the climb; a jet has the thrust not to bleed.
- **The top of the sky is the trap instead.** The flight law takes every
  surface's lift to zero at 1,000 m (`aircraft.js` `AIR_DENSITY_ZERO_AT_HEIGHT`,
  `medium()`): wing and tail alike, so the nose cannot be held either. The
  lesson's perch is paced to 896 m, 100 m under it, and the straight climb
  reaches 990 m at 21.4 to 21.7 s, tops out at 1,043 to 1,050 m and the nose falls
  through.

## The ace that knows where the top is (2026-11-11)

Flown as written, the ace was the Spitfire's (`boomAndZoom`, `uhAce`): zoom at
35 degrees on the dive's speed until slow. A jet is not slow by then, so the zoom
carried them to 1,052 to 1,145 m, 3 to 10 s above 1,000 m, and they came down at
15 to 34 m/s, ending at 242 to 639 m. Most of the counter's 980 to 1,360 m lead
was that fall. An ace that falls out of the sky is not an ace.

The jet's ace is the same plan with a roof (`dogfight-jet-plan-under-the-height.js`):

- `jetBoomAndZoom` and `jetUhAce` wrap `boomAndZoom` and `uhAce` (`roofed`). Every
  answer the plan gives goes through `underRoof` (`dogfight-jet-ceiling.js`):
  where the plane is climbing (path or nose) more steeply than the roof allows,
  the nose is pushed down onto the allowed climb along the heading, wings level
  (rolling inverted to pull it down is slow in thin air). The climb allowed falls
  with the height left to the roof, `asin(left / 3.5 s / speed)`, so the nose
  comes down to level as it nears and below level above it. `ROOF` is 800 m real,
  a fifth of the lift left.
- The zoom is over once the roof holds it level (`atRoof`, 1.5 s in): over the
  top from there, still fast, in the plan's own wingover.
- **How a plan knows the real ceiling.** A plan sees the fight at the Spitfire's
  size (`pilotView`): heights and speeds divided by the pace, so 1,000 m is 781 in
  the F-16 pilot's numbers and 667 in the MiG-29's. The step context carries no
  pace, the arena is null in the lessons, and the fit (`fitAirframe`) is not
  reachable from a plan. A pilot cannot weigh it off its own flight either: tried
  (the plane's lateral acceleration against gravity), the side force swamps it
  and it reads 0.49 for 1.28. What the pilot *is* handed shrunk by the pace is its
  gun: a jet fights with its own cannon (`ownGun`, one barrel, no convergence) and
  is shown its muzzle speed over the pace. So `paceOf(c)` is `c.pace` where a
  context gives one, else the cannon's real 1,000 m/s (every published Desert
  Combat jet's) over `c.gun.speed`, or the school's 400 m/s wing guns where the
  gun converges. That gives 1.28 and 1.5 exactly. The clean fix is shared: the
  duel, the fight and the live seat could put the pace in the step context
  (`runDuel`, `runFight`, `stepSeat`, one field each); `paceOf` already reads it
  first.

Flown from every start of every demo: off the perch it starts on (896 m), the
ace never climbs higher (its highest from 5 s on is 846 to 892 m) and never flies
slower than 81 m/s. It levels off at 860 to 870 m under a climber, 694 to 743 m over a pilot
turning flat.

## What the jet file says

`note`, `story`, `counterStory`, the notes of all six demos, jet `verdict`s for
the Dip, the Flip and the Ninja, `survival`, `coach`, and the aces (`ace.plan`
`jetBoomAndZoom`; the Dip, the Flip, the Ninja and FLY IT's `flyAce`
`jetUhAce`). The claims, one by one:

- "Climbing straight is fatal": **false** on a jet, and the words say what it
  does: never fired at, their height in 11 s, their energy at 16 s, into the top of
  the sky at 21.5 s and out of it, down to 480 to 590 m and 27 to 33 m/s, while the
  diver levels off under it fast and comes again at 48 to 52 s.
- "Turning flat is safe and buys nothing": **holds**, the jet's numbers.
- "Climbing between their dives wins the height back, never hit": **holds**, by
  less: 240 to 250 m of energy ahead, not 980 to 1,360. The words now say why it
  holds on a jet: once you are over their roof they cannot get above you again
  without climbing into the thin air.
- The coach's "380 m" is the plans' threshold in the Spitfire's units, 486 m
  real: "about 490 m". The zoom tip says they level off under the top.

## The nine starts on the F-16, before and after

"Before" is the lesson's jet version against the Spitfire's ace (2026-11-10);
"after" against the jet ace. Harness starts (sideways -30/0/30 by speed -3/0/+3)
for the first three; the school's L9 starts (`dogfight-measure.js` `STARTS`) for
the moves, each scored by `scoreMove` as `movesOn` scores them.

| Demo | Before (the Spitfire's ace) | After (the jet ace) |
|---|---|---|
| move, climb straight | 0/0 in 9; closest 410-442 m; top at 20.6-20.9 s, falls 332-333 m; ends 683-700 m at 31-44 m/s, -842 to -883 m of energy | 0/0 in 9, never fired at; closest 276-390 m; their height 10.6-10.7 s, their energy 15.8-16.1 s; top at 21.4-21.7 s (1,043-1,050 m), down to 480-587 m at 27-33 m/s; the ace at 865-869 m, never under 104 m/s, dives again at 48.3-51.8 s; ends 772-997 m, -163 to +280 m of energy |
| flat, turn flat | 0/0 in 9; three dives; climbs 126-128 m; ends -407 to -620 m | 0/0 in 9; three dives; climbs 126-128 m; ends 357-358 m at 83 m/s, -391 to -487 m |
| counter, climb between | 0/0 in 9; 2-3 breaks; climbs 681-732 m; the ace over 1,000 m and down at 15-34 m/s; ends +976 to +1,357 m | 0/0 in 9; one dive, broken at 483-486 m; their height at 23.9-24.1 s; climbs 730 m to 961 m at 143 m/s; the ace levels at 860-862 m, 128 m/s; ends +239 to +248 m, 99-108 m above them |
| dip | **9 of 9**: run 26.8-38.1 s, let go 35.6-53.6 s, 3.7-7.5 km at 70 s | **9 of 9**: never fired at; run 32.5-34.2 s; let go 38.2-43.5 s; 8.4-9.4 km apart at 70 s at 129-130 m/s |
| flip | **0 of 9**: the reversal never flown | **0 of 9**: the reversal flown once (29.5 s), 0.2 s of a shot, no hit; never fired at |
| ninja | **0 of 9**: a landing shot in four, 1 and 2 rounds | **0 of 9**: the energy yours in all nine, 35.1-42.0 s; never a shot; never fired at, never on your tail |

## The MiG-29 (pace 1.5), the same jet file

The words are the F-16's. The MiG-29's ace starts at 900 m (the paced perch stops
at `PACE.roof`), climbs no higher than 904 m from 5 s on and never flies slower
than 85 m/s. Nobody is fired at in any of the three. The straight climb is at their
height at 12.3 to 12.6 s, tops out at 1,023 m at 16.5 to 17 s and falls 276 to 285
m, ending 150 to 389 m behind; turning flat climbs 142 to 145 m and ends 333 to 572
m behind; climbing between breaks once at 465 to 525 m, touches the top (995 to
1,003 m) and falls 74 to 103 m, and ends 43 m behind to 312 m ahead. Dip 9 of 9,
Flip 0 of 9 (the reversal flown in three), Ninja 0 of 9.

## Tried and not shipped

- **A climb that levels under the top** for you (a prototype jet plan, 30 degrees
  easing to level by 717, 845 or 922 m; three of the nine starts each), flown
  against the Spitfire's ace: never fired at, no fall, ends 79 to 409 m behind.
  The jet's right answer to "climb straight", but it is not this lesson's trap
  demo, and the lesson has no slot for a fourth main demo without changing
  `lessonFor` (it maps only the lesson's own demos).
- **A roof at 900 m** (`PACE.roof`, where the paced perch stops): at a tenth of the
  lift the ace cannot hold level there and wallows, which is what the roof is for.
  800 m flies level at 105 to 130 m/s.
- **Reading the pace off gravity** (`paceOf`): see above.

## Open

- **The pace in the step context.** `paceOf` reads the cannon (`JET_CANNON`,
  1,000 m/s): true of both published jets, not of an airframe whose cannon is
  another speed. A `pace` in the context (`dogfight-duel.js` `runDuel`,
  `dogfight-fight.js` `runFight`, `dogfight-live.js` `stepSeat`) would make it
  exact for any airframe.
- **The shared guard** (`dogfight-pilot.js` `guard`) noses a pilot down above 880
  m in the pilot's numbers, which is 1,126 m real on the F-16: over the ceiling.
  Every Spitfire plan flown on a jet has it.
- **Near misses.** In the counter, the diver passes 82 to 87 m from you at the
  break. The duel does not model a collision.
- **The Flip and the Ninja** were not re-tuned: the reversal waits for a slow
  overshoot the jet diver almost never gives; the ascendancy's passes are the
  Spitfire's. 0 of 9 is the verdict.
- **The live fight** (FLY IT) flies `jetUhAce` ([live-fight.md](live-fight.md));
  nobody has flown it by hand.
