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

