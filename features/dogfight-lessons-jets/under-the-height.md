# When they have the height, on a jet

Lesson `under-the-height`, re-tuned for jets 2026-11-10 (RETUNING.md). Files:
`tools/bf1942-models/viewer/dogfight-jet-under-the-height.js` (the jet block),
`tools/bf1942-models/tests/test_dogfight_jet_under_the_height.py` (every number the
words make). No jet plan: `dogfight-jet-plan-under-the-height.js` stays `export {};`.

## What was found

On a Spitfire the lesson is: climbing straight under a boom-and-zoomer is fatal
(down to 35 m/s on a straight line, shot down 9 of 9); turning flat is safe and
gains nothing; climbing between their dives wins the height back. On the F-16,
flown as written from the nine starts, **nobody is fired at, in any of the three**.
Why, from the traces (`--trace move --step 1`):

- **The diver cannot catch a jet that climbs.** Nose 30 degrees up at full
  throttle, the F-16 *gains* speed as it climbs, 72 to over 120 m/s, at about
  40 m/s upward. The ace's dive from 1.1 km out runs 120 to 130 m/s and closes on
  you at a few tens of m/s; it never gets inside 410 to 442 m (the ace opens
  fire at `open: 300`, 384 m real), and at 11 s you are above its predicted
  pull-out, so it zooms away without firing. The Spitfire's trap was the speed
  bleeding away in the climb; a jet has the thrust not to bleed.
- **The top of the sky is the trap instead.** The flight law takes every
  surface's lift to zero at 1,000 m (`aircraft.js` `AIR_DENSITY_ZERO_AT_HEIGHT`,
  `medium()`): wing and tail alike, so the nose cannot be held either. The
  lesson's perch is paced to 896 m, 100 m under it, and the straight climb
  reaches 990 m at 20.6 to 20.9 s; the nose falls through (pitch to -74
  degrees on the lesson's own start), the jet drops 332 to 333 m in 5 s, climbs
  back, reaches 1,028 to 1,035 m at 38.5 s and hangs there, the nose bobbing
  between -48 and +76 degrees, the speed bleeding to 31 to 44 m/s by 55 s.
- **The diver falls over the top too.** In the counter the ace's zoom (35
  degrees on the dive's speed, `boomAndZoom`) carries them to 1,052 to 1,145 m,
  3 to 10 s above 1,000 m, and they come down at 15 to 34 m/s, ending at 242 to
  639 m. Much of the counter's final lead is this.

So the claim "climbing straight is fatal" is false on a jet, in a way that is
itself the lesson (RETUNING case b): the words are rewritten to say what the jet
does. "Turning flat is safe and buys nothing" and "climbing between their dives
wins the height back, never hit" are true of the jet as flown, and kept, with the
jet's numbers. No fight was changed: the ace, starts, seats and 55 s are the
lesson's.

## What the jet file changes

`note`, `story`, `counterStory`, the notes of all six demos, jet `verdict`s for
the Dip, the Flip and the Ninja, `survival`, and `coach` (the 380 m of the
Spitfire's words is the plans' own threshold in the Spitfire's units, 486 m real:
"about 490 m"; two tips add "level off / stay under 1,000 m"). The Dip's note
drops "running at once, they dive after you and catch you" (not flown on the
jet); the Flip's says "if they come after you level" (they do not); the Ninja's
drops "the fight shown is the one in nine where this holds" (none holds).

## The nine starts on the F-16, before and after

The fights are identical before and after (no fight was changed), so "before" is
the words' claim and "after" is what the jet words now say. Harness starts
(sideways -30/0/30 by speed -3/0/+3) for the first three; the school's L9 starts
(`dogfight-measure.js` `STARTS`) for the moves, each scored by `scoreMove` as
`movesOn` scores them (works = `ok`; counted over the nine).

| Demo | Spitfire words | F-16, as flown (before = after) |
|---|---|---|
| move, climb straight | shot down every time, one pass | 0/0 hits in 9; never fired at; closest 410-442 m; at their height 10.7-10.8 s, their energy 21.2-21.5 s, +626 to +632 m of energy at 35 s; top at 20.6-20.9 s, falls 332-333 m; ends 683-700 m at 31-44 m/s, 277-303 m under them, -842 to -883 m of energy |
| flat, turn flat | never hit, ends where it started | 0/0 in 9; three dives, never fired at; climbs 126-128 m; ends 357-358 m at 83 m/s, -407 to -620 m |
| counter, climb between | never hit, climbs 490-600 m, ends 70-330 m above them | 0/0 in 9; never fired at; 2-3 breaks, the first at 479-490 m; climbs 681-732 m to 912-962 m at 130-143 m/s, peak under 970 m; ends +976 to +1,357 m of energy, the ace at 242-639 m |
| dip | 9 of 9 | **9 of 9**: never fired at; run starts 26.8-38.1 s; they let you go 35.6-53.6 s; at 70 s 3.7-7.5 km apart at 127-131 m/s |
| flip | 6 of 9 | **0 of 9**: the reversal is never flown (no `flip-reverse` phase): they never go past you slow after a break; in five your climb takes you behind them and they break away (`evade`, 29.8-38.2 s); never fired at |
| ninja | 1 of 9 | **0 of 9**: never fired at; the energy is yours in eight (`find`, 29.3-58.2 s); a landing shot in four, 0.07-0.5 s, 2 rounds in one and 1 in another; on your tail 1.0-10.6 s in four, without firing |

## The MiG-29 (pace 1.5), the same jet file

The words are the F-16's. On the MiG-29 the shape holds and the numbers move:
nobody is fired at in any of the three; the straight climb is at their height at
12.7-13 s, reaches the top at 16.5-17 s and falls 263-287 m, and ends -568 to
+253 m of energy (it varies with where the bobbing at the top leaves it); turning
flat climbs 142-145 m and ends 488-643 m behind; climbing between breaks once,
touches the top at 43 s (falls about 100 m) and ends 165 to 185 m *behind*: the
MiG-29's ace dives only once and keeps its energy. Dip 9 of 9, Flip 0 of 9, Ninja
1 of 9 (in six of the harness's ninja fights the ace flies into the ground at 88-89
s). So "climbing between their dives finishes 980 to 1,360 m ahead" is an F-16
number; on the MiG-29 the counter is safe but not a win.

## Tried and not shipped

- **A climb that levels under the top** (a prototype jet plan, 30 degrees easing
  to level by 717, 845 or 922 m; three of the nine starts each): never fired at,
  no fall, ends 385-409, 347-358 and 79-163 m of energy behind instead of 840 to
  880. The jet's right answer to "climb straight",
  but it is not this lesson's trap demo and the lesson has no slot for a fourth
  main demo without changing `lessonFor` (it maps only the lesson's own demos).
- **A diver that respects the top** (`boomAndZoom` with its zoom and climb levelled
  under 900 m): climbing straight is still never fired at (closest 88 to 307 m) and
  bounces off the top (at 22 and 40 s on the lesson's own start), ending +34 to +493 m; climbing between ends +88 to
  +146 m (one start +1,075). The counter's thousand-metre lead is mostly the
  as-written ace falling over the top.

## Open

- **The ace is the Spitfire's.** `boomAndZoom` and `uhAce` (shared, in
  `dogfight-pilot.js`) zoom over 1,000 m on a jet and fall out of it. A
  jet-aware zoom (level the zoom and the climb under about 900 m real, 700 in the
  Spitfire's units) would be a shared change, for whoever re-tunes the ace; it
  would shrink the counter's margin to about +100 m and leave the words' "their
  zoom carries them over the top" untrue.
- **Near misses.** In the counter, the three starts 30 m to the right pass 7 to 13
  m from the diver at the break. The duel does not model a collision; in a real
  game that is close.
- **The Flip and the Ninja** were not re-tuned: no small change in the lesson's
  data makes them work (the reversal waits for a slow overshoot the jet diver never
  gives; the ascendancy's passes are the Spitfire's). 0 of 9 is the verdict.
- **The live fight** (FLY IT) is not fitted, so the coach's jet tips are read
  against the Spitfire-handed ace there.
