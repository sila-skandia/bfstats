# The Immelmann and the split-S: the Dip, the Flip and the Ninja (investigator `ta`, 2026-11-07)

Brief: DFN (the owner's "Dip, Flip, Ninja"). Scored with
`tests/dogfight_dfn_measure.mjs` from the nine nearby starts (your start x
-30/0/+30 m, speed -3/0/+3 m/s). Held by `tests/test_dogfight_dfn_ta.py`.

## Who is in trouble

You: the ace has just passed you and turns round in the vertical, up (an
Immelmann, with his speed) to come back down on you, or down (a split-S, with
his height) to get away from you and come back fast.

## The ace who plays to win (`PLANS.taAce`)

The lesson's `turnarounds` plan never chased a runner hard (it held its
height 3 s, then dived no steeper than 30 degrees) and never defended. The
three demos fly `taAce`: the same Immelmann and split-S, plus

- **chase**: a target going away from him (aspect < 70, > 200 m) is chased at
  once, lead pursuit, a dive up to 45 degrees while he is above;
- **let-go**: the school's one give-up rule (as `scAce`): 6 s into the
  chase, beyond his guns' reach + 30 m and not closing (closure smoothed over
  3 s under 0.5 m/s), he turns away, and stays away unless you turn back at
  him (`meet`) or get on his tail. (First version: past 600 m, height spent,
  nothing gained in two 3 s looks; replaced 2026-11-07, counts unchanged.)
- **the reflex**: he breaks into you once you sit on his tail inside 330 m
  with your nose on him, except while he is in a half loop or half roll.

## Candidates, nine starts each

| Move | Technique | Works/9 | Why |
|---|---|---|---|
| Dip | **Turn back flat (60 bank) under his Immelmann, run the way he came** | **9** | He tops out at 37 m/s, 200-255 m off, facing away; has to turn round slow; lets go at 19-20 s, 570-600 m behind and not closing; 1730-1780 m at 32 s. Never fired. |
| Dip | Same, 70 bank / 82 bank | 9 / 0 (at 40 s) | 82 bank bleeds the speed: 665-696 m, stalls |
| Dip | Climbing reversal (chandelle) | 9 (at 40 s) | 905-1018 m, slower to open than the flat 60 |
| Dip | Run straight on at full throttle | 0, now 9 | under the first give-up rule he sat 450-480 m behind, still gaining slowly; under the shared rule (not closing at 0.5 m/s) he lets go: 1916-1964 m at 32 s |
| Dip | Split-S out under his loop | 0, now 9 | first rule: 290-340 m behind, closing; shared rule: 1507-1690 m at 32 s |
| Dip | 90 degree turn out of his loop's plane | 0 | 460-520 m, he still gains |
| Flip | **Dive after his split-S onto his run, sit behind closing slowly** | **3** | on his tail 3.9-6.1 s, he never fires; but he breaks as he comes out, shot 0-0.73 s |
| Flip | Same, other sit ranges/yo-yo distances (36 settings) | 0-3 (5 once at 25 s) | sensitive; the shot is the 0.3 s as he comes out of his half loop |
| Flip | Vertical reversal: your own half loop under his Immelmann top | 0-1 | puts you behind him (2-7 s in his rear quarter) at 31 m/s; he breaks, no shot (0-0.13 s) |
| Flip | Fly on, turn when he commits behind, chop (out-of-the-lock's move) | 0 | he lands 4-10 hits as he comes down, or no shot |
| Ninja | **Pass high; dive on his split-S the moment he rolls over, zoom back up** (`turnaroundsBoom`) | **9** | never in his guns; his rear quarter inside 400 m 3.9-4.3 s; never closer than 50 m; your fire 0-0.43 s |
| Ninja | Meet his Immelmann at the top (`turnaroundsMeetTop`) | 2 | you pass him at 2-18 m and he fires back in 3 |
| Ninja | Same, break off out of his loop's plane at 130-220 m | 0-3 | he still fires in 3+; breaking off later he chases you down |
| Ninja | Offset pass (200-300 m abeam), meet the top from the side | 0 | no shot for you; at 200 m abeam he gets 5-6 s on you |

Against the old `turnarounds` ace (no reflex) the split-S follow is a kill
9/9 and the dip's reversal reaches 810-840 m by 30 s and opens; those were not
used, since he did not defend or chase.

## Survival

**Yes.** Turn back under his Immelmann and run (9/9); meet a split-S from
above and dive on him at once (9/9, never shot at). Getting onto his tail
with a shot that lands is partly (3/9).

## What the measure gets wrong here

- The Dip's 900 m: between two equal Spitfires a runner keeps the gap he had
  when the chase settled. Against an ace who chases forever, the best Dip
  (the reversal) holds at 650-800 m and he never closes into reach (never a
  shot in 50 s), but never reaches 900 m. It passes only because the ace
  stops a chase he cannot win, which is in his plan and in the words. Under
  the shared give-up rule any extension at full throttle gets out (run
  straight, split-S out, the reversal: 9/9 each); the reversal leaves him
  furthest behind.
- The Ninja passes on the rear-quarter clause, not the shot: a defending
  Spitfire breaks the moment your nose is on him inside 330 m, so the fire is
  0-0.43 s. The words say so.

## Changes

- `viewer/dogfight-pilot.js`: `PLANS.taAce`, `PLANS.taDip`, `PLANS.taFlip`,
  INTENTS for each. Nothing shared edited.
- `viewer/dogfight-lessons.js` (turnarounds): `survival`; demos `dip`,
  `flip`, `ninja`; `split-counter` retired (the Ninja is the same move
  against an ace who defends); counterStory's split-S paragraph rewritten to
  the defending ace's numbers, a Dip paragraph added; coach lines `chase`,
  `home`.
- Tests: new `test_dogfight_dfn_ta.py` + `dogfight_dfn_ta.mjs` (5 tests,
  <1 s). `test_dogfight_school.py`: the turnarounds no-kill test lists the
  new demo ids. `test_dogfight_shape_loop.py`: `SPLITS` uses `ninja` for the
  retired `split-counter`, and its counter test now holds what the defending
  ace allows (no fire back, your fire under 0.5 s, you stay above him; his
  break climbs, so 0-32 m, not the old 15 m).

## Open

- The Flip is partly: a hard-breaking Spitfire cannot be hit, so the only
  shot is the fraction of a second as he comes out of the split-S, committed.
  A human with the mouse may do better than the bot's 0.3 s; untested.
- FLY IT still flies the lesson's `turnarounds` ace, who neither chases a
  runner hard nor breaks.

## Ascendancy (2026-11-07)

Brief: the ascendancy rollout (the Ninja won and held, the Flip that stays
on top), under the stricter measure and the human eyes. Pictures in
`<SCRATCH>/asc-ta/` (`plot.mjs`: top-down and side-on, 2 s marks, landing
shots thick, grey where the other pilot does not see that plane).

### Who has the advantage

Against the split-S you do: you meet him 140 m above, he gives you his height
on top of yours, and the advantage is won in the first dive or not at all.
Against the Immelmann he does: he turns round over you to come back down.

### The ace now fights on (`taAce`)

Bounced out of a split-S, the old `taAce` broke, then resumed his run: 20 s
straight and level with the man who had just shot at him overhead (each
break restarted the run's clock). Every Ninja and Flip that worked against
him lived off that. A sensible ace turns to fight, so `taAce` now does:
once he has broken out of his run (`mem.resume === 'run'`), he goes to
`attack`. Counts against the old ace and the new, same starts:

| Candidate | old ace | fighting ace |
|---|---|---|
| bounce: dive to 200 m behind his exit, press, then `ascend` | 9 (7 kills) | 0-2 |
| dive after him onto his tail (old `taFlip`) then `ascend` | 5-8 | 0-1 |
| `ascend` from the start | 6 | 5 |
| `ascend` from the start, every landing shot taken (shipped) | - | 6, 9 at the new stage |

The Dip is unchanged by it (9 of 9).

### The eyes in this lesson

- In his split-S pull-through he cannot see you (5.0-6.5 s): that is free.
  But he comes out 220-260 m from you, you 100-150 m above him, pitched up
  13 degrees as he levels, so his tail cone points below you and he sees
  you at once. Diving to reach the cone at his exit (`cone.mjs`, the exit
  point 140 m toward you, 100-200 m behind, 0-30 m up) fails: from 600 m you
  cannot lose the height in the 5 s he takes (2-8 of 9, the shots unseen
  but 0.0-0.5 s).
- After his Immelmann you can get under his tail, where he cannot see you,
  in every start (the Flip below): the eyes give you the position, the
  speed is what is missing.
- Above him he never loses you: nothing above his wings is hidden, at any
  range.

### The Ninja: every candidate (works of 9, against the fighting ace)

| Technique | works | why |
|---|---|---|
| the old Ninja (`turnaroundsBoom`: dive at his split, zoom, watch) | 0 | 0.03-0.73 s of fire; idle up to 44 s |
| boom, then `ascend` once the zoom is done / as it starts | 0 / 0-5 (old ace) | the boom's dive is the wrong one: no hits |
| bounce: dive to a point 200 m behind his exit, press, `ascend` | 0-2 (36 settings) | he breaks at 280 m, out of reach; then turns to fight |
| into his tail cone at the exit (`cone.mjs`) | 0-6 (old ace) | cannot get down there in time (above) |
| bounce, then extend 500-900 m and climb | 0 (old ace) | he chases: six 1.3-14 s |
| `ascend` from the start | 5 | shot down 6; the misses end circling (idle 20.6-38 s) |
| `ascend` from the start, leave after each pass (forced) | 4 | the leave hands him the six (up to 14 s) |
| **`ascend` from the start, every landing shot taken (`taNinja`)** | **9** | shot down on the first dive in all nine, 11.0-12.2 s |

`taNinja` is `ascend` with `aimed: true` on every step: `ascend` holds its
fire in the zoom and the wingover, and a third of its landing shots there
were not taken (the school test "a shot that would land reads as going for
it" failed on 27-35 % of them). Taken, the first dive brings him down.

The stage moved 15 m: `youStart` x 0 to 15. From x 0 the same pilot flies 6
of 9 (shot down 6, the others circle); from x 15, 9 of 9. Round x 0, 25
starts (x -30..30 by 15, speed -3..3 by 1.5): 21 of 25. The verdict hangs on
the first dive, and the words say so.

The nine at the stage: shot down at 11.0-12.2 s, his landing shot 0, hits
on you 0, six 0, your landing shot 1.6-2.3 s, 22-40 hits; you are 6-18 m
above him at the lowest before the kill. One thing the measure does: the
closest pass is after the kill (the duel runs 2.5 s on and you pass the
falling plane at 11-17 m); with `ascend`'s own trigger one run failed the 15
m rule only there (16 m before the kill, 11 m after).

### The Flip: every candidate (against the fighting ace unless noted)

| Technique | works | why |
|---|---|---|
| dive after his split-S onto his tail, sit (old `taFlip`), 22 s / 45 s | 0 / 0 | he breaks, shot 0-0.43 s, then idle 37 s |
| the same, then `ascend` after 0.5-3 s | 0-1 (5-8 against the old ace) | he turns to fight: six up to 18 s |
| `ascend` with its first dive named the Flip | 5 | the Ninja's fight; not a flip: you were never chased |
| Immelmann start: full flat circle at 60 bank into his low six (I5) | 0 | on his tail in 9, unseen 3 s, at 41-44 m/s; shot 0-0.4 s |
| the same, 45-82 bank either half, climbing early or late (36) | 0-1 | the faster the circle, the later the nose; shot under 1 s |
| **Immelmann start: circle down a little at 60, round at 65, under his tail (`taFlip`)** | **1** | in his rear quarter in all nine, 15 s in, unseen; at 41-43 m/s the nose reaches his lead (4-5 deg) only as he turns back to attack and sees you; shot 0-0.9 s |

The Flip demo is 19 s: it ends as he turns back on you. Flown on to 45 s
it is a turning circle with him in all nine (0 of 9, idle 27-30 s): no
pointless circling on screen, and the words say what comes after. The one
that counts (start +30 m, +3 m/s) counts only because 19 s is too short for
the idle rule to bite.

### Verdicts

| Move | Technique | works | attacks | my shot | hits | six max | idle max |
|---|---|---|---|---|---|---|---|
| Dip | back under his loop, run | 9 | 0 | 0 | 0 | 0 | 0 |
| Flip | round under his loop onto his tail | 1 | 0-2 | 0-0.9 s | 0-8 | 0 | 1.7-4.0 |
| Ninja | `ascend`, every shot taken, from above | 9 | 1-3 | 1.6-2.3 s | 22-40 | 0 | 1.4-4.5 |

Survival: yes (the Dip, and the Ninja).

### Changes

- `viewer/dogfight-pilot.js`: `taAce` fights on once bounced out of a
  split-S; `taFlip` rewritten (the circle under his loop, then `ascend`);
  new `taNinja` (`ascend`, every landing shot taken); INTENTS for both.
  `PLANS.ascend` untouched.
- `viewer/dogfight-lessons.js` (turnarounds): the Flip moved to the
  Immelmann start, 19 s; the Ninja is `taNinja`, 50 s, stage x 15; survival
  line, the split-S counter paragraph.
- Tests: `test_dogfight_dfn_ta.py` + `.mjs` (the Flip under his tail and too
  slow; the Ninja at least 45 s, shot down, above him to the kill; the Dip's
  let-go range 450 m, one start is now 498 m); `test_dogfight_shape_loop.py`
  (the Ninja's dive lands a second or more; the no-kill rule for the
  turnarounds only); `test_dogfight_school.py` (the Ninja may shoot him
  down, nobody shoots you down).

### Open

- The Ninja is one dive deep. If the dive misses he turns to fight and
  neither `ascend` nor anything tried here keeps the upper hand: it ends
  circling (pictured, `final-ninja-x0-0-0.png`). Staying there, as opposed
  to winning there, is not shown in this lesson.
- The Flip is no: under his tail unseen in every start, but 41-43 m/s is too
  slow to pull the lead before he turns back. A faster way round (a descending
  first half, then a climbing one) moved it 0 to 1.
- `ascend`'s held fire in the zoom and wingover: other lessons handing over
  to it may meet the same school-test failure.

### After the review (2026-11-07, round two)

The independent review (`<SCRATCH>/rev-ta/`): the Ninja's 9 of 9 was a moved
start; 5 m higher it was 0 of 21, and every miss became 35-40 s of flat
circling. The shared measure and starts changed the same day: the nine are
now `STARTS`, an L9 over sideways, along, height and speed (STARTS[0] the
start the theatre plays); a fight is measured to the kill.

**The Ninja is rebuilt as a one-dive ambush (`taNinja`), back at the `split`
demo's start (x 0).** Hold the height while he rolls over; dive when his
nose is 25 degrees down through his half loop (committed, and he cannot see
you); the lead led (`taAim`, a copy of `ascAim`); every shot taken; off him
before the pass; then straight away at full throttle (`dip-out`), never
round with him. Too fast to split-S (he goes up past you instead), the
lesson's Dip (`taDip`).

When to dive, over 45 starts (the old nine at five offsets: base, height
+-10 m, 30 m closer, 15 m further; works / shot down):

| Dive | base | +10 m | -10 m | 30 m closer | 15 m further | of 45 |
|---|---|---|---|---|---|---|
| `ascend` from the start (round one's Ninja) | 6 | 0 | 7 | 6 | 2 | 21 |
| the moment he rolls over (bank 60) | 4 | 6 | 3 | 3 | 3 | 17-19 |
| as he starts down (his sink 8 m/s), at once | 7 | 1 | 8 | 8 | 1 | 25 |
| the same, 0.1-1.4 s later | 0-5 | 0-3 | 0-5 | 0-2 | 0-2 | 0-12 |
| the same, 1.6-1.9 s later | 8-9 | 6-7 | 8-9 | 7-9 | 3-5 | 34-39 |
| rolled, 1.8-2.0 s later | 8-9 | 7-8 | 8-9 | 8-9 | 4-5 | 37-38 |
| **his nose 25 deg down (shipped); 20 / 30 / 35 deg** | **9** | **7** | **9** | **9** | **5** | **39**; 36 / 37 / 33 |

Aim gains (lead 0.55-0.9, pull 0.8-1) and holding the closure down with the
throttle moved nothing or made it worse; the kill needs about 45 ticks of
landing shot, and the dive gives 26-71. The timing is the whole of it: a dive
started as he rolls over arrives while he can still turn, one started once
he is out arrives behind his break.

**Under `STARTS`: 6 of 9 (partly).** All six starts where he split-Ses: shot
down on the one dive at 10.6-11.0 s, your landing fire 1.07-1.27 s (27-45
hits), 20-50 m above him to the kill, his guns never on you, no six. The
three starts 30 m further out: he reaches 650 m too fast to split-S (52 m/s
and over) and Immelmanns past you; you take the Dip, he chases to 220-290 m,
lets go at 518-580 m, and you are 3700 m apart at 50 s. They count as fails
(no attack, and 20.3-22.9 s near him with the height edge before he lets go).

A wider sweep (sideways -45/-15/15/45/75, along -30/-15/0/15/30, height
-15..15 by 5; 175 starts): 117 work. Along -30 to 0: 99 of 105 (height
-15..15 barely matters now). 15 m further: 18 of 35 (he barely split-Ses).
30 m further: 0 of 35 (no split-S: the Immelmann, where the Ninja is not the
move). So it is robust to height and sideways and decided by whether he
split-Ses at all. Pictures: `r2-ninja-0.png` (the kill, 10.7 s),
`r2-ninja-dz30.png` (no split-S, the Dip), `r2-ninja-dz15.png`.

**The Flip** is scored over 45 s (`scoreSeconds: 45`) and shown for 23 s:
0 of 9 under `STARTS`. Under his tail unseen in all nine at 15 s, 39-45 m/s,
fire 0-0.43 s; then the circle, nobody shooting (idle 29-30 s). The demo
ends as the circle begins. The caption changes to "He saw me and turned
back: no shot. Even now, take the Dip" the moment his nose starts to come
round onto you (my bearing off his nose falls 4 degrees from its widest):
15.8 s at STARTS[0], 0.4 s after his break (it was on until 18.9 s).
Pictures: `r2-flip-23.png`, `r2-flip-45.png`.

**The Dip** under `STARTS`: 9 of 9; he rolls out 232-281 m from you, chases
from 198-232 m, lets go at 487-566 m at 18.7-19.5 s, and you are 1700-1813 m
apart at 32 s.

| Move | Technique | works (STARTS) | attacks | my shot | hits | six max | idle max |
|---|---|---|---|---|---|---|---|
| Dip | back under his loop, run | 9 | 0 | 0 | 0 | 0 | 0 |
| Flip | round under his loop onto his tail (45 s) | 0 | 0-1 | 0-0.43 s | 0-2 | 0 | 29-30 |
| Ninja | one dive as his nose goes down, then away | 6 | 1 (kill) | 1.07-1.27 s | 27-45 | 0 | 7.1-7.3 (kills), 20-23 (no split-S) |

Survival: yes (the Dip). Tests (`test_dogfight_dfn_ta.py`, `.mjs`): the
runner flies `STARTS`; the Flip is scored at `scoreSeconds` and shown at 25
s or less; the Ninja works at STARTS[0], every split-S start is a kill under
12 s from 20 m or more above him, and every start without a split-S is the
Dip (30 m further out, he lets go, past 3000 m).

Still open: the Ninja is one dive, and it is on only when he split-Ses; the
staying-on-top the owner asked for is not shown in this lesson (after the
dive he is down, or you leave). The Flip is no.
