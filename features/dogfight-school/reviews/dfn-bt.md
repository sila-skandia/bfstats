# The break turn: the Dip, the Flip and the Ninja (2026-11-07)

The owner on the break turn: "It just goes on and on. Are you proposing the
only way out of the fight is to wait infinite time?"

**Who is in trouble:** the pilot who broke. The break spoils the attacker's
shot, but it leaves both in a circle neither wins; he wants out of it, or on
top of it. In the three new demos he is the other seat (you), and the ace is
the attacker.

## The threat

The ace is the school's `hunter`, unchanged: he holds his height in the
circle, follows a climb shallow, runs when flown past, breaks when you get
on his tail, and turns back after anyone who runs. No variant was needed:
every move below got the answer a sensible attacker gives. The lesson's
`chaser` at skill 1 was flown too: in the circle he sits 48 m behind on your
tail, and a throttle chop against him gave him 0.4-0.6 s of shot and 4-8
hits (he chops with you and pulls lead).

Staging: the lesson's attack geometry, raised to 600 m (a vertical way out
needs room; at 300 m the floor guard takes it): ace at [240, 620, 0]
heading -25 at 72 m/s, you at [0, 600, -440] heading 0 at 52 m/s. You
(`btDip`, `btFlip`, `btNinja`, all `btOutOfTheCircle` in
`dogfight-pilot.js`) cruise, break into him, hold the hardest turn 5 s, then
the hardest turn that holds the height (75 deg bank). Holding the height
matters: the lesson's `breakTurn` circle sinks 5 m/s, and the hunter, who
holds his, ends up 60-80 m above with the energy.

## What the nine starts showed

Scored with `dogfight_dfn_measure.mjs`, the other seat's start nudged 30 m
and 3 m/s (`tests/test_dogfight_dfn_bt.py`). Candidates were flown in the
node rig (`<scratch>/dfn-bt/`); all against the hunter unless noted.

| Move | Candidate | Works /9 | What happened |
|---|---|---|---|
| Dip | roll out on your heading and run, nose 8 down | 0 | he follows 170-320 m back with his sights on you for 24-26 s (he holds fire to 150 m); from the lesson's 298 m break, 0-2 hits |
| Dip | turn directly away and run | 0 | from a 298 m break: 49-56 hits, shot down; from 360 m: 180-220 m behind, sights on you 27 s |
| Dip | split-S out of the circle, then run | 0 | he stays high and dives after you with the height: 147-328 m at 50 s, 18-20 s of his sights in five, 63 hits in one. (Against the `chaser` it reached 750-825 m: he followed it down and the floor guard pulled him up slow.) |
| Dip | zoom up out of the circle, then dive away | 0 | he follows the zoom and sits behind you: 15-17 s of shot, 3-38 hits in seven |
| Dip | **zoom, then run once he is in front going the other way** (demo) | 0 | no hit after the run starts in 8 of 8 flown; 45 s in he is 218-703 m behind and following; in one start he sat close enough to zoom from only 36 s in |
| Flip | throttle chop and pull up in the circle (`lockChop`'s) | 0 | from the sinking circle, near-collisions at 1-10 m; level, he passes and runs but you are too slow to follow: rear quarter 0-7 s, shot 0-0.5 s |
| Flip | flat reversals, throttle back (a scissors) | 0 | 1-4 hits taken each start, never behind him |
| Flip | zoom out of the circle from the lesson's 298 m break | 0 | rear quarter 3.5 s in one start, 0 in the rest |
| Flip | **break at 360 m, zoom out of the circle** (demo) | 1 | rear quarter 3.3-9.4 s in 7, but 17-27 s after the zoom, and he breaks the moment you are there: shot 0-0.67 s, 0.5 s in one. 2/9 at 55 s |
| Ninja | break at 298 m, then the zoom | 0 | his guns have you 1.2-1.3 s while your wings roll over, in all nine |
| Ninja | break at 330 m | 0 | 0.5-0.9 s of his shot |
| Ninja | break at 360 m, level circle, no zoom | 0 | he never shoots, you are never behind him |
| Ninja | break at 360 m, then the chop | 0 | |
| Ninja | break at 450 m (head on), level circle | 0 | |
| Ninja | **break at 360 m, zoom when he sits dead astern inside 120 m** (demo) | 5 | 5: his guns never have you, rear quarter 3.8-9.4 s. Fails: behind him only 0.3 and 2.2 s; he catches you slow at the top of the zoom (0.9 s, 4 hits); he sits close enough only 36 s in. 6/9 at 55 s, 4/9 breaking at 400 m |

Other tunings of the zoom (40-70 deg, a twist toward him, trigger range
90-170 m, angle 130-150, wait 0-6 s, three chase aims) were all worse or
equal. 62+ deg climbs pass within 9-13 m of him.

## Re-scored against `btHunter` (the school's give-up rule)

The coordinator's rule for every ace: he gives up a chase he cannot win
once he has been past his guns' reach + 30 m and not closing for 6 s in a
row, then climbs away on the way he came and stays out unless you turn back
at him (he faces you) or get on his tail (he breaks). `PLANS.btHunter` is
`hunter` with exactly that added; it is now the three demos' ace.

| Move | `hunter` | `btHunter` |
|---|---|---|
| Dip (zoom, then run; now 60 s, so his giving up shows) | 0/9 (45 s) | **7/9**: never hit after the run; he gives up 37-52 s in; 1.2-3 km apart at 60 s. Fails: 305 and 379 m behind at the end |
| Flip (50 s) | 1/9 | 1/9 (he never goes past his reach) |
| Ninja (45 s) | 5/9 | 5/9 (the same; 7/9 for either ace at 60 s) |

Survival is now **yes**, by leaving. The table below and "The verdicts"
are the first pass, against the plain hunter.

## The verdicts (first pass, plain `hunter`)

- Dip: **no** (0/9). Between equal Spitfires the one behind can always
  follow; the best you get is out of his reach (218-703 m), never out of the
  fight. Escaping needs a time lead of about 12 s at top speed.
- Flip: **no** (1/9). You get behind him, but a Spitfire that keeps breaking
  cannot be hit (the school's old finding, again).
- Ninja: **partly** (5/9).
- Survival: **partly**: "you cannot fly away from an equal fighter who
  follows, and the circle never gives you a shot, but break early (360 m),
  hold your height, and zoom out of the circle when he sits close behind: in
  5 of 9 he follows you up, slows, and you end up behind him without his guns
  ever having had you."

A finding for the lesson itself: its break at 300 m (`gun.range + 30`) is
late against the hunter, whose guns have you for 1.2 s as the wings roll;
360 m leaves him nothing.

## What changed

- `dogfight-pilot.js`: `btOutOfTheCircle` and `PLANS.btDip`, `btFlip`,
  `btNinja`, their `INTENTS`. No shared plan touched.
- `dogfight-lessons.js` (break-turn only): `dip`, `flip`, `ninja` demos with
  verdicts, `survival`, a story paragraph on the way out; `move` ends at 22 s
  (the break, the pass and the reversal) and `counter` (the patient attacker,
  an endless circle 70 m up) at 16 s. `counter` is not retired only because
  `test_dogfight_shape_break.py` (not mine) flies it.
- Tests: `tests/test_dogfight_dfn_bt.py` + `tests/dogfight_dfn_bt.mjs` (6
  tests, under a second).

## Open

- The measure's Dip needs 900 m; against an equal pursuer that never gives
  up that is a time lead no move here makes. Nothing wrong with the measure;
  it is why the answer is no.
- `test_dogfight_shape_break.py` now errors: on-his-tail's `counter` demo was
  retired by its investigator. Not this lesson.
- The Flip and the Ninja fly the same flight; they differ in what they ask of
  it (a shot within 20 s, against no shot for him).
