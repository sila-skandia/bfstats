# When he has the height: the Dip, the Flip and the Ninja (investigator `uh`, 2026-11-07)

Lesson `under-the-height`. Tests: `tools/bf1942-models/tests/test_dogfight_dfn_uh.py` with
`dogfight_dfn_uh.mjs` (5 tests, about 1 s), scored by the shared `dogfight_dfn_measure.mjs`.

## Who is in trouble

You (seat 1) are 520 m under a boom-and-zoomer who keeps diving on you; he has the height
and the energy, and you want out or the upper hand.

## The ace: `uhAce`

`boomAndZoom` let a runner go: its climb past 700 m pointed the nose at a target behind it and
looped itself up to 30 m/s, and it had no answer to being bounced from above. `uhAce` is a copy
(the same climb, perch, dive, zoom and wingover, the lesson's `burst: 1.8, open: 300`) with:

- `chase`: a target flying away past 550 m (`hisAta > 110`, not facing him) is chased, pure
  pursuit at full throttle, his height spent in a shallow dive (up to 20 degrees); inside 450 m
  a dive pass if he has 80 m over you, else the guns' lead from behind.
- `meet`: dived on from above (you 60 m over him, nose on him, closing), he turns to face you.
- the climb turns level first when the heading to you is more than 50 degrees off the nose.

The three new demos fly against `uhAce`; the first three keep `boomAndZoom` (their shape tests
belong to `test_dogfight_shape_height.py`).

## Candidates (nine starts each, prototyped in the node rig)

| Move | Technique | Works | Why it fails |
|---|---|---|---|
| Dip | Run at once, 6 degrees down, flat out | 0/9 | he dives after you, 1.8-2 s of shot, 6-19 hits, 340-400 m behind at 40-70 s |
| Dip | Break his first dive, run as he zooms (away from him / opposite his heading / fixed) | 0/9 | 300 m of height over you: he closes to 360-620 m by 45-80 s; the steeper run is shot down |
| Dip | Break two dives, then run | 0/9 | still 100 m of energy behind; 460-640 m at 45 s, closing |
| **Dip** | **Climb between his dives until you have 100 m of energy on him, then run 2 degrees down** | **9/9** | (works) |
| Flip | Break, then pull up after his zoom (lead, full pull; or turnToward) | 0/9 (8 variants) | he leaves at 71-74 m/s to your 42; you hang at 14-15 m/s, quarter 0 s |
| Flip | Catch him at the top of the second zoom | 0/9 | behind him 100 m below at 45-70 degrees elevation; nose never within 30 degrees |
| Flip | Follow him once his height is spent (energy/geometry gated) | 0-2/9 | he out-climbs you, or breaks into you (reflex at 328 m) before your guns' 268 m |
| Flip | Break and chop the throttle, then after him | 0/9 | quarter 0 s in all |
| Flip | Win the height, then dive or sit on his tail (scored as a flip) | 0/9 | rear quarter in 6/9 but 0-0.4 s of landing shot: he breaks or meets, a hard-turning Spitfire is not hittable |
| Ninja | Climb between his dives (the counter) | 0/9 | never a shot for him, but no offensive at all |
| Ninja | Climb between, then bounce him from above (boom and zoom on him) | 0-5/9 | he meets the dive; 2-6 degrees off the lead, no shot |
| **Ninja** | **Climb between, then sit behind him once the energy is yours and he flies away** | **6/9** | three starts: he chases you instead of flying away, you finish 280-310 m above him |

## The three demos (as tested)

- **Dip, 9/9 works** (`uhDip`, 80 s, was 95): three dives broken, never hit, the run starts
  53-57 s in from 470-530 m. Under the school's give-up rule (`scAce`'s, added to `uhAce`'s
  chase: 6 s in a row past his reach + 30 m and not closing) he lets you go 10-11 s into the run
  and climbs away; at 80 s you are 1.9-2.7 km apart. Before the rule he followed for good at
  940-1250 m, unable to close.
- **Flip, 0/9 no** (`uhFlip`, 32 s): the textbook reversal onto his zoom. He passes 110-120 m
  away at 71-74 m/s to your 42; you are at 14-15 m/s within 8 s; one run takes 2 hits.
- **Ninja, 6/9 partly** (`uhNinja`, 85 s): his guns never on you in any start; you climb
  420-570 m; in six you sit in his rear quarter 6.7-9.1 s (above 35 m/s) with at most 0.4 s of
  landing shot, and chasing him costs the height (he ends 20-110 m of energy ahead); in three
  you end 280-310 m above him. The middle start, the one the theatre shows, is one of the three.

Survival: **yes**, but not at once. The existing demos (climb straight, turn flat, climb between)
are kept unchanged.

## Open

- Everything waits 53-57 s for his height to run out; the Dip and Ninja demos are 95 and 85 s.
- No landing shot is reachable from behind a Spitfire that knows you are there: his reflex
  breaks at 328 m (gun range + 60), before the guns' 268 m. That is why the Flip is `no`.
- Screenshots: `<scratchpad>/dfn-uh/shots/` (top of all three, wide of all three).
