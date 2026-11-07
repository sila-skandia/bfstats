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

## Ascendancy (2026-11-07)

The owner on the On his tail Ninja: "I'm looking to watch dogfighting and see
how to get ascendancy (meaning coming up with a shot) and how to stay there."
The shared measure now asks the Ninja for two attacks with a landing shot (or
a kill), his guns never on you, never on your six for a second (inside 400 m,
within 60 degrees of your tail, his nose on you), the energy or his tail held
60% of the time after the first shot, and never 20 s inside 600 m without a
shot; and a Flip to stay on top once flipped. Every pilot now has human eyes
(`reviews/eyes.md`).

**Who has the advantage, and how it is won:** the attacker has it (100 m more
energy, and he is behind you); the only thing you can take from him is his
speed, by making him haul his hard turn after a gentle circle of yours, and
he never takes his nose off you, so every dive you win meets him nose to
nose.

### Under the eyes, before anything else

- The lesson's own demos broke: from 502 m the breaking defender (`breakTurn`,
  seat 0 in He breaks / You stay patient) lost the attacker behind his
  headrest at 4 s, cleared his tail and broke late and flat (228-298 m, no
  overshoot, no reversal: 13 shape errors). The attacker now starts 360 m
  out on the same bearing (`you.start` [172, 320, -124]); he breaks at
  290-298 m in all nine, the attacker comes past and he reverses (1.7-2.2
  s), and the patient attacker stays 71-73 m above, never inside 75 m (the
  counter story said 80; now 75). Flying straight is still shot down 9 of 9.
  The shape tests' break-turn parts all pass; `breakTurn` is shared with On
  his tail and was not touched.
- The Dip (unchanged plan) went 7 to 8 of 9: in the two starts 30 m to the
  right the defender loses the hunter in the tail cone as he closes and
  breaks at 272 and 286 m; the run still works in both.

### The Ninja: every candidate (`<scratch>/asc-bt/`, against `btHunter`, 50 s)

| Candidate | works/9 | why it fails |
|---|---|---|
| the old Ninja: break 360 m, circle, zoom, chase | 0 | he sits on your six 4.5-5.3 s in the circle in all nine (it is the break turn), and the chase follows his break |
| `ascend` from the start (its beam) | 0 | the beam makes him haul his lead: +73-93 m of energy and 35 m over him by 10 s, but he sits 135-160 m behind 2.8-4.7 s; then circling, no shot (c1) |
| break at once (hard 8 s), then `ascend` | 1 | six 0.63 s at most and no shot for him in all nine; `ascend`'s climb toward a man behind it hangs at 5-14 m/s 140 m over him, then circling (c4) |
| break at once, climbing reversal over him, then `ascend` (24 settings) | 0 | the reversal hangs at 19-26 m/s; a dive with no lead goes under him (nA) |
| the beam to bleed him, then zoom (48) | 0 | six 2-15 s: the beam is a circle with him 160 m behind (nB) |
| break at once, two circles, up off a crossing (16) | 0 | the zoom hands him the six: he follows it, nose on you (nC) |
| two circles, then onto his tail at a crossing (18) | 0 | the flat two-circle fight is symmetric: nobody gets round first (e3) |
| break at once, gentle climbing circle (bank 45), lead dive, zoom (12) | 0 | the circle works (+131-154 energy, +111-131 m over him by 40 s, no six), the turn-in from his beam dives under him (nF) |
| break at once, controlled climb, `ascend` without the hang (64) | 2 | spirals down 300 m in circles; the 2 are luck (nD) |
| **break at once, 45 degree circle to +60 m / +60 m energy, up at 75 to 60 m/s, over, lead dive, up again (shipped)** | **4** | (3 holding fire in the zoom; about 190 neighbouring settings, 0-3) |

The shipped Ninja (`btNinja`), from the nine starts: his guns never have
you (0 s) and he never sits on your six (0 s) in all nine; 8 come down on
him, 5 twice, rounds land in 7 (3-14), shots 0.4-1.5 s, longest idle 14.8
s. Fails: the dive passes him inside 15 m in four (8-12 m), no attack in
one. What it is not: from behind. Every dive meets him nose to nose (rear
quarter 0 s in all nine): the hunter, a pure pursuer, follows the zoom and
hangs with his nose up, and the dive comes down his nose; his guns cannot
come up to it. It is the vertical fight the owner asked for, not the bounce.

### The Flip: every candidate (50 s)

| Candidate | works/9 | why it fails |
|---|---|---|
| the old Flip: zoom out of the circle at 59 to 30 m/s, then chase | 1 | behind him 17-27 s after the zoom; the chase follows his break in the flat |
| the zoom to 30/38/45 m/s, lead dive, the vertical after (72 settings: break 360/300 m, zoom range, angle, end speed, gun time) | 0-1 | the dives come from his front |
| **zoom at 70 to 45 m/s (no hang), lead dive, up again to 58 m/s (shipped)** | **2** | rear quarter with the shot 14 and 18 s after the zoom in 2; 27-36 s in 3 (one shoots him down but passes at 13 m); never in 4; hit 4 times in one |
| the same with at least 2 s of climb after every pass | 1 | |
| first round: throttle chop, flat reversals, zoom from 298 m | 0 | |

In the run that works best (-30/+3: 3 attacks, 13 hits, never on your six),
the fight walks down from 600 to 170 m: each pass ends below the zoom's 58
m/s, so "up again" is skipped and the next dive follows him down. The
measure passes it; it is not the vertical the plan's words describe, and the
2 s minimum climb that fixes it costs a start (1 of 9).

### Verdicts

- Dip **8/9** (works), Flip **2/9** (no), Ninja **4/9** (partly).
- Survival **yes**, by leaving: "Yes, by leaving: ... he gives up a chase he
  cannot win (8 of 9). The upper hand is another matter: turn into him at
  once and he never gets behind you, but the dives you win meet him nose to
  nose (4 of 9 hold it), and turning the circle into a shot from his tail
  works in 2 of 9."

### What changed

- `dogfight-pilot.js`: `PLANS.btNinja` and `PLANS.btFlip` rewritten (their
  INTENTS too), `btOnto`; `btOutOfTheCircle` now flies only the Dip. They
  call `ascAim` (not edited); no `ascend` copy was needed.
- `dogfight-lessons.js` (break-turn only): the attacker's start, the Flip and
  Ninja demos (labels, notes, verdicts, the Ninja 50 s, no `breakAt`), the
  Dip's verdict, the survival line, a story paragraph on the upper hand, the
  counter story's 75 m.
- Tests: `test_dogfight_dfn_bt.py` (+ `.mjs`: `flown`): the counts and words
  above, the Ninja at least 45 s.

### Pictures (`<scratch>/asc-bt/`)

`final-ninja-{0,2,3,4}.png`, `final-flip-{0,2,3,4}.png`,
`final-dip-{0,2,3,4}.png` (the demos, starts -30/-3, -30/+3, 0/-3, 0/0);
`nG2-*.png` (the Ninja's family), `fA-8-70-*.png`, `f3-2.png` (the Flip's),
`c4-m30p3.png`, `asc0.png`, `e4.png`, `nD-1-*.png` (rejected candidates);
the theatre: `top-break-turn-ninja.png`, `look-break-turn-ninja-wide-36.png`.

### Open

- The bounce from his blind sky never comes: the hunter keeps his nose on
  you, and the defender starts seen and seen through. A Ninja from behind
  needs him to look away (the eyes' bounce on a man who has not seen you),
  which this lesson's geometry does not give.
- The Ninja's misses are passes inside 15 m: the dive's off rule (1.2 s
  before the merge) meets a man climbing into the dive.
- The Flip's best run walks the fight down 430 m (above).

### After the review (2026-11-07, later)

The independent review (`<scratch>/rev-bt/`): Dip ship with two fixes, Flip
and Ninja fix first. The measure changed meanwhile (attacks are 0.3 s
bursts 3 s apart, the IDLE clock starts at a 50 m energy lead, no hanging
over 3 s under 35 m/s inside 300 m, measured up to the kill) and the nine
starts are now the L9 array over sideways, along, height and speed
(`STARTS`, `nudge`); everything below is under both. The section above is
superseded where it disagrees.

**The Ninja's circle was the stalemate the owner rejected** (8-21 s, both
turning the same way, nobody shooting, his energy flat, my gain pure
climb), and it left the circle at 48 m/s, under the zoom's 60, so the next
phase dived me 70 m under him. Without it, every way tried hands him the
six or nothing:

| Ninja without the circle | works/9 | why |
|---|---|---|
| break at once, then climb straight away, dive only with his nose 60 off, off 2.5 s out (11 settings) | 0 | he follows the climb: six 6.6-30 s |
| break at once, zoom off the pass, over, `find`-style turn onto him, lead dive (11) | 0 | six 0-4.5 s, and the find circles under him (picture `r2-4.png`) |
| the same, diving only with his nose 60 off, otherwise leaving after 3-8 s over the top (9) | 0 | with 8 s: never on your six, never hit, no dive ever comes |
| **shipped: that last one** | **0** | the hunter never takes his nose off you |

So the Ninja is **no**, and the demo says so: break at once (500 m), up once
he is past, wait 8 s over the top for his nose to come off you; it never
does, so leave while he is slow. L9: never on your six (0.8 s at most), his
guns never fire, you never fire, he gives up 27-28 s in (41 s in one),
1.4-2.9 km apart at 50 s.

**The Dip is now that same flight**, with the run as `dip-run`: **9 of 9**
(L9, 50 s), never hit, his guns never on you, no hang, he gives up 27-28 s
in (41 in one), 1.4-2.9 km apart and opening. It beats the circle Dip, which
the review's two fixes did not settle: stopping its zoom at 33-40 m/s and
starting the run only past 250 m or opening flew 6-8 of 9 with a 61-hit
failure. The old `btDip` / `btOutOfTheCircle` are retired. It answers the
owner's question better too: the way out of the endless circle is not to let
it start.

**The Flip** (still out of the lesson's circle): the zoom ends at 52 m/s
(it tops near 40: hang 1.1-3.3 s, one at 3.27), "over the top" ends once the
nose is 20 degrees down or I am under him, and when he breaks with me inside
120 m it is a high yo-yo, not a follow. Under L9: **0 of 9**. Rounds on him
in 6 (up to 20), but 2 s in his rear quarter only twice, 20 and 27 s after
the zoom; five passes inside 15 m, hit in three (1-3 rounds), and in one
start he never sits close enough behind to zoom from. The yo-yo variants:
yo-yo 0/120/160 m, zoom end 45/52/56, the 2 s minimum climb, "over" to any
depth: 0-1 of 9 (the 1 needs "over" to run on to -63 degrees, which the
review rejected as words that do not match the flight).

Verdicts: Dip **9/9**, Flip **0/9**, Ninja **0/9**; survival **yes**: "Yes,
and early: turn into him before he is in reach (500 m), go up once he is
past, and leave from the top while he is slow: he gives up the chase 27 to
41 s in (9 of 9). The upper hand is not to be had ..."

Changed: `PLANS.btNinja` (rewritten), `btUpAndAway`, `PLANS.btDip`
(rewritten on it), `PLANS.btFlip` (zoom end, over, yo-yo), INTENTS;
lessons: the three demos, the survival line, the story's two paragraphs and
the move's note; `test_dogfight_dfn_bt` on `STARTS`.

Pictures (`<scratch>/asc-bt/`): `v2-{dip,flip,ninja}-{0,7}.png` (L9
start 0, the one the theatre plays, and start 7), `r2-4.png`, `r4-4.png`;
theatre `top-break-turn-dip.png`.

Open: the Ninja and the Dip fly the same opening, so the Ninja tab is the Dip
with a wait; the Flip at the theatre's start fails (the note says so).
