# When they have the height, on a jet

Lesson `under-the-height`, re-tuned for jets 2026-11-10 (RETUNING.md), and
re-flown 2026-11-11 against a jet ace that respects the top of the sky, then
again once every pilot's ceiling guard was read over the pace. Files:
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
- **The top of the sky was the trap instead, until the guard.** The flight law
  takes every surface's lift to zero at 1,000 m (`aircraft.js`
  `AIR_DENSITY_ZERO_AT_HEIGHT`, `medium()`): wing and tail alike. The lesson's
  perch is paced to 896 m, 100 m under it. While the pilots' guard waited for
  1,126 m real, the straight climb reached 990 m at 21.5 s, topped out at 1,050 m
  and fell out of it. With the guard read over the pace it levels off at 950 m
  and keeps the height (below).

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
  the F-16 pilot's numbers and 667 in the MiG-29's. Since `726b12eb6` the step
  context carries the pace (`c.pace`: `runDuel`, `runFight`, the live
  `stepSeat`), and `paceOf(c)` reads it, 1 where a context gives none. The only
  caller left without it is the school harness's own Spitfire steps
  (`tests/dogfight_school_harness.mjs`), where 1 is right, so the first cut's
  fallback (the pace read off the cannon's 1,000 m/s over the speed the pilot is
  shown) is gone. Reading it off gravity was tried and does not work (the side
  force swamps it: 0.49 for 1.28).

## The guard, and what the roof still does (2026-11-11)

The shared `guard` (`dogfight-pilot.js`) now reads its 880 m over `c.pace`:
every pilot on a jet, the ace and your seat alike, puts the nose on the horizon
past 880 m real while climbing (it was 1,126 m on the F-16). The roof was flown
with the guard alone (`ROOF` out of reach): the ace's zooms run on to 963 to 984
m (1,156 m in one Ninja) before the guard catches them, in a quarter of the lift.
With the roof they level off at 850 to 870 m. So all of `dogfight-jet-ceiling.js`
stays except the gun fallback: `underRoof` and `atRoof` level the ace off before
the guard has to, and the guard is the last word.

From every start of every demo: off the perch it starts on (896 m), the ace never
climbs higher (from 5 s on, 871 m at most) and never flies slower
than 81 m/s. It levels off at 860 to 870 m under a climber, 694 to 743 m over a
pilot turning flat.

## What the jet file says

`note`, `story`, `counterStory`, the notes of all six demos, jet `verdict`s for
the Dip, the Flip and the Ninja, `survival`, `coach`, and the aces (`ace.plan`
`jetBoomAndZoom`; the Dip, the Flip, the Ninja and FLY IT's `flyAce`
`jetUhAce`). The claims, one by one:

- "Climbing straight is fatal": **false** on a jet. With the guard your own climb
  levels off at 946 to 949 m, short of the top, and never falls out of it: never
  fired at, their height in 11 s, their energy at 16 s, and 99 to 179 m of energy
  ahead at 55 s. Before the guard (the first cut of this page) the climb went on to
  1,050 m and fell to 480 to 590 m at 27 to 33 m/s; that claim is gone.
- "Turning flat is safe and buys nothing": **holds**, the jet's numbers.
- "Climbing between their dives wins the height back, never hit": **holds**, and
  the straight climb does about as well: 120 to 130 m ahead. On a jet the lesson
  is: climb, either way, and level off under the top; only turning flat loses.
- The coach's "380 m" is the plans' threshold in the Spitfire's units, 486 m
  real: "about 490 m". The zoom tip says they level off under the top.

## The nine starts on the F-16

"The Spitfire's ace" is the lesson's jet version of 2026-11-10; "jet ace" the
first cut of this page; "with the guard" now. Harness starts (sideways -30/0/30 by
speed -3/0/+3) for the first three; the school's L9 starts (`dogfight-measure.js`
`STARTS`) for the moves, each scored by `scoreMove` as `movesOn` scores them.

| Demo | The Spitfire's ace | Jet ace, no guard | Jet ace with the guard |
|---|---|---|---|
| move, climb straight | 0/0 in 9; falls 332 m from the top; ends -842 to -883 m | 0/0; top 1,043-1,050 m at 21.5 s, down to 480-587 m at 27-33 m/s; ace dives again at 48-52 s; ends -163 to +280 m | 0/0; closest 281-321 m; their height 10.6-10.7 s, their energy 15.8-16.1 s; you level at 946-949 m, end 908-948 m at 132-138 m/s; the ace at 869-871 m, dives once; ends +99 to +179 m |
| flat, turn flat | three dives; ends -407 to -620 m | three dives; ends -391 to -487 m | the same: climbs 126-128 m, ends 357-358 m at 83 m/s, -391 to -487 m |
| counter, climb between | 2-3 breaks; ends +976 to +1,357 m (the ace's fall) | one break at 483-486 m; you to 961 m at 143 m/s; ends +239 to +248 m | one break at 483-486 m; their height at 23.9-24.1 s; climbs 681-685 m to 912-915 m at 135-136 m/s; the ace at 861-864 m; ends +120 to +130 m, 50-56 m above them |
| dip | **9 of 9** | **9 of 9** | **9 of 9**: never fired at; run 32.5-35.3 s; let go 38.2-43.5 s; 8.3-9.4 km apart at 70 s, 128-129 m/s |
| flip | **0 of 9** | **0 of 9** | **0 of 9**: the reversal flown once (29.5 s), no shot |
| ninja | **0 of 9** | **0 of 9** | **0 of 9**: the energy yours in all nine, 36.2-40.5 s; never a shot; never fired at, never on your tail |

## The MiG-29 (pace 1.5), the same jet file

The words are the F-16's. The MiG-29's ace starts at 900 m (the paced perch stops
at `PACE.roof`), climbs no higher than 915 m from 5 s on and never flies slower
than 106 m/s. Nobody is fired at in any of the three. The straight climb is at
their height at 12.3 to 12.6 s and levels off at 975 m, ending 67 m behind to 105
m ahead; turning flat climbs 142 to 145 m and ends 333 to 572 m behind; climbing
between breaks once at 465 to 525 m, levels at 938 to 945 m and ends 89 to 357 m
ahead. Dip 9 of 9, Flip 0 of 9 (the reversal flown in two), Ninja 0 of 9.

## Tried and not shipped

- **The guard alone**, no roof: see above.
- **A roof at 900 m** (`PACE.roof`, where the paced perch stops): at a tenth of the
  lift the ace cannot hold level there and wallows, which is what the roof is for.
  800 m flies level at 105 to 130 m/s.
- **Reading the pace off gravity**: see above.

## Open

- **Near misses.** In the counter, the diver passes 82 to 87 m from you at the
  break. The duel does not model a collision.
- **The Flip and the Ninja** were not re-tuned: the reversal waits for a slow
  overshoot the jet diver almost never gives; the ascendancy's passes are the
  Spitfire's. 0 of 9 is the verdict.
- **The live fight** (FLY IT) flies `jetUhAce` ([live-fight.md](live-fight.md));
  nobody has flown it by hand.
