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
