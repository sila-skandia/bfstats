# The Immelmann and the split-S: the fix (fixer `loop`, 2026-11-07)

Review this answers: the adversarial review of `turnarounds` (one demo; the
Immelmann started by a timer before the merge, came out 145 degrees round and
then dived its height away; no split-S, no counter, false demo note).

## The tactics

- **Immelmann**: an offensive reversal after a pass. From good speed, half a
  loop up in the vertical plane of the entry heading, and on top, upside
  down with the nose back on the horizon, a half roll upright. Going back the
  other way, higher and slow. Counter: do not follow him up from close in;
  hold off, keep your speed, put the nose on where the loop tops out and shoot
  as he hangs there (research.md "Immelmann").
- **Split-S**: from high and slow, a half roll with the nose on the horizon,
  then half a loop down in the plane. Going back the way he came, lower and
  faster. Counter: he gave you his height; use it on him.

## What is flown now (nine starts each, `tests/test_dogfight_shape_loop.py`)

The demos stage their own starts (`aceStart` / `youStart`, see below).

| Demo | Seat | Staging | Measured |
|---|---|---|---|
| *You follow him up* (`immelmann`) | `turnaroundsFollow` | he went by 170 m in front, 76 m/s | Immelmann: starts 0.3 s in, the seat 167-172 deg off his nose; wings level (bank 0) to the vertical, 5 m sideways drift; roll starts at nose +14.8, U.y -1; heading turned 172; +106 m, 39 m/s on top; still +70 m 4 s after upright. Seat: up to 71-90 deg, slows to 16-28 m/s 53-86 m under his top, 0-0.2 s of fire, he none. Nobody shot down. |
| *You meet him at the top* (`immelmann-counter`, also FLY IT's start) | `turnaroundsMeetTop` | he went by 420 m in front, 74 m/s | Same Immelmann (+107 m, 37.5 m/s, heading 171.7, +69 m after). Seat: 261-279 m from the top as he tops out, nose within 0-2.4 deg of it, climbs 18-20 deg, never below 44.9 m/s; landing fire 0.6-3.3 s in 7 of 9 (0 in 2); he gets 0.9-1.2 s back in the 3 starts where they pass close. |
| *You let him go* (`split`) | `turnaroundsLetGo` | head on, he at 460 m 45 m/s, you at 600 m 52 m/s, 760 m apart | Split-S: decided at 650 m; roll with the nose level, pull starts at bank 175-176, nose -10.8; nose to -89; heading turned 179.8; -145 m; 51 -> 68.5 m/s (+17); 2 m drift. Seat stays 249-252 m above him; nobody fires. |
| *You dive on him* (`split-counter`) | `turnaroundsBoom` | same | Same split-S. Seat dives the moment he rolls over, closes on his run from behind and above, zooms back up 28-40 m above his height: landing fire 0.2-2.2 s in all 9 (>= 1.1 s in 8); he fires nothing. |

Before (review): one demo, 0.0 s of counter fire, reversal 145 deg, height
thrown away, split-S never flown.

## Changes

- `viewer/dogfight-pilot.js`
  - `PLANS.turnarounds` rewritten. `pass` (level, height held) starts the
    Immelmann only when fast (>58 m/s) and he is behind the wing or the range
    is opening past him; starts the split-S when slow (<52 m/s), high
    (>420 m) and he is coming head on inside `TURNAROUND_SPLIT_RANGE` (650 m).
    `immelmann` / `pullthrough` fly the loop in the entry heading's vertical
    plane (`loopCentre`/`loopAngle`, the ring courses' method); no roll until
    the nose is within 15 deg of the horizon upside down. `rollout` and
    `split` are a half roll with no pull, elevator and rudder holding the nose
    on the horizon (`rollNoseLevel`). New `top` (holds the loop's height 3 s)
    and `run` (straight out of the split-S until 1100 m clear). `attack` dives
    or climbs no steeper than 30 deg. INTENTS updated.
  - New seat plans: `turnaroundsFollow` (the mistake: straight up after him),
    `turnaroundsMeetTop` (hold off, climb 20 deg at the predicted top, shoot),
    `turnaroundsLetGo`, `turnaroundsBoom`. INTENTS for each.
- `viewer/dogfight-lessons.js`: the lesson's story, counterStory, coach
  (new `top`, `run`), four demos with notes, FLY IT start = the counter's
  staging. **Shared change**: `demoSides` now honours a demo's `aceStart`,
  `youStart`, `aceMemory`, `youMemory` (falls back to the lesson's; nothing
  else changes). The theatre and the tests both go through `demoSides`.
- Tests: new `tests/test_dogfight_shape_loop.py` + `dogfight_shape_loop.mjs`
  (10 tests, ~0.6 s). In `test_dogfight_school.py` only
  `test_the_immelmann_turns_him_round_without_being_shot_down` (now over the
  four demo ids; `move` is gone).

## Thresholds: what was relaxed and why

None of the reviewer's Immelmann or split-S thresholds were relaxed. Two
counter thresholds were changed in kind, with the reason:

- Split-S counter: the reviewer asked for "stay high, then dive on him after
  the bottom". Flown, that never lands: a Spitfire diving 30-35 deg at
  65 m/s gains about 1 m/s a second, and his run out of the bottom is as fast
  (from four stagings, nine starts each: 0 s of fire, or fire only later when
  he turned back). The dive has to start the moment he rolls over. The words
  say so, and the test holds the dive that works (fire in 9/9, >= 0.8 s in
  >= 7/9, none back, seat stays above him) and the let-him-go that does not.
- Immelmann counter range: met at 261-279 m, inside the reviewer's 250-450.
  The staging matters: from a head-on pass, a flat turn round (150 deg at
  ~35 deg/s) cannot get the nose onto the top in the 3.9 s the loop takes, so
  the Immelmann is staged as it was historically used, after his pass has
  carried him through and in front of you.

## Open

- The theatre's wide camera is still angled; a half loop reads as a hook, not
  a side-on loop (coordinator's file). From above both moves are a straight
  line, which is right for a loop in one vertical plane.
- After the moves the fights drift: in *You follow him up* the two circle for
  30 s with no shots (`chase` / `attack`); in the counter the seat extends
  away and he follows at 800 m. Honest, but long; per-demo `seconds` would let
  these end sooner.
- FLY IT starts the player 420 m behind him and he goes up 0.3 s in: little
  time to read the coach before the move.
- `TURNAROUND_SPLIT_RANGE` (650 m) also governs the free fight's head-on
  passes for this plan.
