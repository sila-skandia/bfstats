# On his tail: the Dip, the Flip and the Ninja (`ot`)

Scored with the shared measure (`tests/dogfight_dfn_measure.mjs`) from the
nine nearby starts (the other seat's x -30/0/+30, speed -3/0/+3), held by
`tests/test_dogfight_dfn_ot.py`.

## Who is in trouble

You, the attacker. You got in behind him, he broke into you at 450 m, and his
circle goes nowhere: you cannot pull the lead on him while he turns, he never
stops turning, and if you sit close he chops and you fly past.

## The ace: `otBreaker`

The lesson's `breaker` plus the answers a sensible defender has that it
lacked. The lesson's `ace.plan` is now `otBreaker`, with coach lines for its
new phases.

- He breaks into anyone sitting on his tail inside 350 m with the nose on
  him, closing or not. The breaker broke only on a closing man, so a pilot
  holding 380 m behind at his speed was never broken into.
- Turned onto a man in front of him, he eases the closure the way the hunter
  does, and if he flies past anyway he runs (`extend`). The breaker went in
  at full throttle.
- A man running away is chased, and given up by the school's one rule
  (`scAce`'s): 6 s in a row past his guns' reach + 30 m without closing
  (closure smoothed over 3 s). Then he turns away and climbs (`letgo`). He
  comes back only to meet you head-on if you turn back at him (`meet`), or
  to break if you get on his tail. The breaker gave up at 400 m whatever the
  speeds. (A first version gave up after 5 s past 400 m without gaining: the
  same 9/0/0, with the let-go at 24-31 s and 1199-1622 m at 40 s.) An ace
  who chases for ever is in "Measure" below.

## Candidates (against `otBreaker`, nine starts)

**Dip** (from his circle, 40 s; the other candidates were scored under the first give-up rule):

| Technique | works/9 | Notes |
|---|---|---|
| **Wings level out of the circle when he is across it going away** (headings 140 degrees apart, a turn and more after the break), full throttle, shallow dive to 140 m | **9** | He comes round and sits 276-329 m behind (outside the 268 m guns), never closes, and gives up 20.6-22.9 s in. 2150-2449 m apart at 40 s, never hit, his guns never on you |
| Run straight away from him at the same moment | 9 | 1016-1217 m (under the first give-up rule) |
| The same run, but leaving at the first crossing (as he comes round) | 0 | 22-48 hits |
| Flat extension directly away from him | 0 to 1 | 293-412 m at 40 s; he stays behind you |
| Zoom 25 degrees out of the circle | 0 | Either 29-48 hits in 3 starts, or no hits but 509-572 m at 40 s (9/9 only by 50 s) |
| Split-S out | 0 to 1 | 0-15 hits; he stays within 200 m |

**Flip** (none reaches a landing shot of 0.5 s):

| Technique | works/9 | Notes |
|---|---|---|
| **High yo-yo** (`otYoyo`: perch 100 m over his circle, dive when over him in his rear quarter, up again before passing) | **0** | Never hit, your guns never on him. Perches of 60-200 m, dive gates 35-90 degrees: 0/9 |
| Vertical reversal (zoom out, he follows up and drops to 28 m/s, wingover back down) | 0 | 2-3 s in his rear quarter in 4 starts, at most 0.37 s of shot, 1 hit taken in 2 starts |
| Bait and chop (leave, let him reverse onto you, turn hard, chop when he is close) | 0 | He eases his closure and never sits inside 100 m, so the chop never comes. Baiting later costs 8-14 hits |
| Co-rotating circle out wide | 0 | He reversed onto your tail at 330 m |

**Ninja** (from the lesson start):

| Technique | works/9 | Notes |
|---|---|---|
| **Out wide** (`otOutWide`: arrive at his speed, turn with him 250-300 m out) | **0** | His guns on you for 0.1 s at most, never hit, never inside 56 m. Never in his rear quarter, your guns on him for 0.13 s at most (2 rounds landed in 2 starts) |
| Arrive slow and go up over his turn (`arriveSlow`) | 0 | Inside 12-27 m of him; 1 hit taken |
| High yo-yo at his break (`patientAttacker`) | 0 | 1 hit taken, no shot |
| Boom and zoom from 300 m above | 0 | Never hit, 0.6-0.8 s in his rear quarter, no shot |
| Hunter / eager chaser | 0 | 2-12 m from him; up to 3 hits taken |

Why nothing gets the shot: he breaks at 450 m, out of your reach. A Spitfire
turning hard turns about 39 degrees a second and holds it with the throttle,
and in this engine diving for speed turns you faster but no tighter. Against
`breaker` too, every technique was 0/9.

## Verdicts

- Dip: works, 9/9. Flip: no, 0/9. Ninja: no, 0/9.
- Survival: **yes**, by leaving.

## Demos

The demos are now: *You rush in*, *He chops, you sit close*, *He chops, you
lag back*, then **dip** (`otDip`, 40 s), **flip** (`otYoyo`, 30 s) and
**ninja** (`otOutWide`, 40 s), all against `otBreaker`. *You arrive slow*
(`counter`) is retired: the yo-yo and out-wide demos say what it said.

## Measure

- An ace who chases a runner for ever: between two Spitfires with the same
  top speed, the gap freezes where his turn left it, 450-650 m, never hit.
  No Dip clears 900 m against him (0-3/9). The 900 m rule therefore depends
  on the ace giving up, which is why `otBreaker` lets go once he stops
  gaining.
- The Ninja's rear-quarter branch is loose: *You rush in* against
  `breakTurn` scores Ninja 9/9 on 25 s of sitting 50 m behind him with no
  lead.
- The coordinator's 1e-6 slack and the 35 m/s rule moved none of these counts.

## Open

- `tests/dogfight_shape_break.mjs` and `test_dogfight_shape_break.py`
  dropped their on-his-tail `counter` checks, each with a one-line reason.
  They measured a `breakTurn` ace and the patient attacker's yo-yo, so they
  did not fit the `flip` demo.


## Ascendancy (2026-11-07)

The owner watched the old Ninja (`otOutWide`) turn in lockstep with the
breaking enemy and asked for the ascendancy: coming up with the shot and
staying there. Measured with the shared measure as it now stands (fights
scored up to the kill), every pilot under the eyes (reviews/eyes.md).

### The ace: `otAce`

`otBreaker` plus the answer a man in a hard turn has to a bounce: a fighter
he sees diving on him (40 m or more above, his nose within 35 degrees of
him, inside 700 m) on the side his turn is carrying his nose away from, he
reverses his break into him, no sooner than 3 s after his last reversal.
`otBreaker` is left as it was (the ascendancy bench uses it). Against the
plain breaker the Ninja below flies 8 of 9; against `otAce` 7. The lesson's
ace and all three demos are `otAce`.

### Who has the advantage, and how

You do, at the start: behind him, 20 m above, 20 m/s faster. Kept by not
spending it in his circle: when he breaks, climb on a line beside his
circle and round it (`otNinja`), about 280 m out, at the best climb (13 m/s
of energy a second, he gains nothing in his level turn), with the nose never
more than 78 degrees off him in 3D inside 460 m, so he never has you in
front of him going away (he reverses onto anyone who is). With 150 m of
energy over him (90 m of it height) turn in as his nose comes round, and the
moment it has swept past you (`otSweep` -10 to -160), go down on him with
the ascendancy's dive (`ascend`, called, not copied). After the pass, 2 s up
and past him (`ninja-off`: without it the climb law flew into him). Then
`ascend` while it is above him, the climb beside him when it is not.

A dive lab (`asc-ot/divelab*.mjs`, `ascend` from rest on a breaking
`otBreaker`) shows why the sweep matters: from 300 m out and 150-180 m above,
behind his sweep, one pass lands 1.5-2.5 s and kills in 6-7 of 12 bearings;
ahead of his sweep (he is turning toward you) 0-1 s and nothing.

### What it flies (`test_dogfight_dfn_ot.py`)

| move | technique | works/9 | attacks | myShot s | hits | sixLost max s | idle max s |
|---|---|---|---|---|---|---|---|
| Dip | leave his circle when he is across it going away (`otDip`) | 9 | 0 | 0 | 0 | 2.8-10.2 (outside his guns) | - |
| Flip | high yo-yo over his circle (`otYoyo`), best try | 0 | 0 | 0 | 0 | 0.97 | - |
| Ninja | climb beside his break, down on him as his nose swings away (`otNinja`) | 7 | 1-2 | 0.9-2.2 | 2-43 | 2.7 | 34.3 |

Ninja, run by run: dive at 7.7-11.7 s, 114-134 m over him, never closer than
249 m (seen from above) before it; first landing shot 11.7-14.9 s; shot him
down in six (15.0-16.9 s); a seventh comes up with the shot twice (2 hits);
two fail: one pass of 4 hits then 34 s without another (the second dive
gets nothing), and two passes of 8 hits with him on your tail 2.7 s after
the second. His guns never have you, he never hits you. The theatre's start
(dx 0, dv 0) is the second failure.

**It hangs on timing.** The nine starts vary x and speed; moving the start
30 m nearer or further along his tail line gives 0 and 2 of 9 (60 m: 0 and
0). The dive's moment is set by when the climb reaches the edge against his
9 s turn. The demo note says so.

### Candidates (works/9 against `otAce` unless noted)

Ninja:

| Candidate | works | why |
|---|---|---|
| climb beside, dive behind his sweep (`otNinja`, shipped) | 7 (8 vs `otBreaker`) | above |
| same, random search of 40 + 80 knob sets | 0-8 | one set in 40 reached 8 vs `otBreaker`; best vs `otAce` 7 |
| `ascend` from the lesson start | 0 | climbs toward him, dives too shallow, circles |
| climbing away to rebuild, then back (v1-v2) | 0-1 | slow; out-leg inside 400 m shows him the tail: six 4-13 s |
| climbing orbit 500 m out, roll in (v3) | 2 | first pass kills 2; the climb-out afterwards hands him the six (8-20 s) |
| orbit, wingover, wait for his sweep, out (v4) | 0 | wingover kills the speed; reversal on the out-leg |
| pass then straight extension on the pass heading (v5-v6) | 0-4 | extension starts ahead of his sweep: he reverses, six 7-18 s |
| ring at slant over 400 m (v7, v11) | 0 | dives from 400 m+ abort on his nose; few dives |
| the same with the near-miss guard on every phase | 0-3 | the guard spends the killing pass |

Flip (from his circle, where the demo starts):

| Candidate | works | why |
|---|---|---|
| high yo-yo (`otYoyo`, kept as best try) | 0 | never hit, never on your six over 1 s, never a shot |
| the Ninja's climb-and-dive from inside his circle | 0 | he reverses onto the climb-out: six 13-28 s |
| out at the Dip's moment (he is across the circle), then the Ninja | 0 | six 5-19 s |
| up and let him chase you; back down when he is slow | 0 | no shot at all; six 6-15 s |

From inside his circle at his speed nothing gets out on top: any climb out
of it shows him the tail inside 400 m, and he turns onto it. The Flip demo
says so and points at the Ninja.

### Under the eyes, the rest of the lesson

- *You rush in* (`breakTurn`, shared): you close from dead astern, in his
  tail cone; he loses you, clears at 4 s and breaks out of the clearing turn
  at 284-298 m, first bank 25-98 degrees, often his clear's way. You land
  0-10 hits (about 5), all in the first 3 s of his break; nobody comes down.
  Story and tests say so (`test_dogfight_shape_break`, `test_dogfight_school`).
  A restaged start 220 m to one side, outside his cone, did not help (he
  loses you again as you line up behind him).
- *He chops, you sit close* and *He chops, you lag back* are **retired**:
  under the eyes the chopper chopped in 4 of 9 and never into a fly-past,
  nobody was hit, and lagging out wide shot nobody down (0 of 9) while
  turning in lockstep with him, the move the owner objected to. Their shape
  tests (`test_dogfight_shape_tail.OnHisTailShapes`) and school test went
  with them; the story keeps one sentence on the chop.

### Pictures

`<SCRATCH>/asc-ot/`: `ninja--30-0.png` (a kill: climb beside, dive at 8 s,
shot from 12 s, down at 16 s), `ninja-0-0.png` (the theatre's start: two
passes, 8 hits, a 2.7 s six at the end), `ninja-0-3.png` (works without a
kill), `ninja-0--3.png` (one pass, then nothing), `flip-0-0.png` (the
yo-yo), `flipF3-0-0.png` (climbing out of his circle: him on your tail),
`top-on-his-tail-ninja.png` and `look-on-his-tail-ninja-wide-12.png` (the
theatre).

### Open

- The Ninja's 7 of 9 depends on the start distance (above). A plan that
  times its climb to his sweep instead of to the energy edge might hold;
  not found here.
- The two failing runs end circling near him after a pass that did not
  kill; `ascend` has no answer to a turner after the first pass (its own
  review).
- The Flip from inside his circle: 0 of 9 across four families.

### After the review: the L9 starts and a stronger ace (2026-11-07, later)

The independent review (`<SCRATCH>/rev-ot/`) and the measure's new nine
starts (an L9 array over sideways, along, height and speed) undid the 7 of
9. Under them the section above flew Dip 6, Flip 0, Ninja 2: the kills came
only in a 15 m band along his tail line; 30 m further back he never broke
and you climbed beside him for 50 s; 30 m nearer he sat behind you for 26 s.

What changed:

- **`otAce` stops waiting to be bounced.** Breaking with nobody on his tail
  and the other seen 50 m or more above him, 250 m or more out and not
  coming at him, for 3 s: out of the turn and away from him, climbing at 15
  degrees (`climb`); back to the break if someone gets on his tail, turning
  to meet him if he comes at him. The coach has a line for it.
- **`otNinja`** hands a man flying straight (out of his break) to `ascend`
  from 35 m over him, crosses his line (`ascend`'s beam) when his nose comes
  onto it, and climbs off the pass at full pull. None of the three moves
  the count: with each on or off it is 2 of 9.
- **The Flip demo** opens at the pull-up (`startAt: 7`) and its captions say
  what is flown ("Trying to get up over his turn: at his speed there is
  little height to be had").
- **Words**: tagline, counter story, coach, every note, verdict and the
  survival line now follow the L9 numbers; the story no longer promises the
  chop's fly-past; the Ninja's caption no longer claims the nose stays on him.

| move | technique | works/9 | key numbers |
|---|---|---|---|
| Dip | leave his circle when he is across it going away | 6 | clear, unhit in 6 (he behind you 252-319 m, gives up 19-25 s, 1942-2530 m apart at 40 s); from 30 m further back he catches you at 110-117 m and shoots you down twice; from 30 m nearer you pass him at 14 m and are 1034 m clear at 40 s |
| Flip | high yo-yo from his circle, shown from the pull-up | 0 | never hit; 0.27 s of shot and 3 rounds at most, in two |
| Ninja | climb beside his break, one pass from above when he climbs away | 2 | kills at 14 and 17 s from 30 m to one side; in the other seven 1-19 rounds and then he on your tail 5-24 s; no second shot in any; his guns never on you |

**Survival: partly.** The honest picture: in this scenario you get one pass
at a good pilot and he is round onto your tail after it unless it kills; the
safe thing is to leave his circle, which works from most starts but not from
further back.

The theatre's run (STARTS[0]) is a Ninja failure and the note says so: one
round lands at 14 s, he turns after you and sits 110-200 m behind you,
climbing with you, for 16 s.

Open: the Dip from 30 m further back (he catches the leaver); a second pass
after a miss against a pilot who climbs away and turns onto you as you come
off him; the Flip from inside his circle.

Pictures (`<SCRATCH>/asc-ot/`): `n3-0-0.png` (the theatre's Ninja run),
`n3-3-0.png` (a kill), `d3-0-0.png` (the Dip clear), `d3-5-0.png` (the Dip
caught from further back), `top-on-his-tail-flip.png` (the Flip in the
theatre at 23 s).

## Retail g and box area (2026-11-12)

Re-pinned on the law's retail gravity and box-drag area
(features/retail-parity-cross-check-2026-11-12); verdicts unchanged (Dip 6/9,
Flip 0/9, Ninja 3/9, survival partly). Dip: from 30 m further back he
catches you at 99-110 m (was 110-117) and shoots you down twice; from 30 m
nearer you are 1,030 m clear at 40 s (was 1,034). Flip: your guns have him
0.27 s at most, 2 and 4 rounds in two of nine (was 3 at most); still never
hit, but one start (dx -30, dz 30, dv -3) has him on your six for 1.17 s,
where all nine were under 1 s: the test's bound is now 1.5 s. Ninja: the
theatre's pass lands ten rounds (was nine), then he is on your tail 16 s.
