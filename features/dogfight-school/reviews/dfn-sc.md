# The flat scissors: the Dip, the Flip and the Ninja

Who is in trouble: you, the full-throttle pilot who drifts out in front at
every crossing while the ace, braking to hold about 40 m/s, gets the snap
shots (the lesson's *Scissoring*: 1-6 hits on you in 45 s, 0.2-0.4 s of his
shot, none of yours).

Every number below is from the lesson's nine starts (your start x -30/0/+30 m,
speed -3/0/+3 m/s), scored with `tests/dogfight_dfn_measure.mjs`, against
`scAce`. Held by `tests/test_dogfight_dfn_sc.py`.

## The ace: `scAce`

`PLANS.scissors` does not answer a pilot who leaves: it keeps weaving along
its axis. `scAce` is the same scissors plus what a sensible ace does:

- **chase**: you have left (past 230 m, or turned more than 110 degrees off
  the axis going away, or diving away past 120 m): full throttle, nose on the
  lead (`turnToward`, up to 50 degrees down).
- **let-go**: after 6 s of chase, 30 m past his guns' reach (298 m) and his
  closure, smoothed over 3 s, under 0.5 m/s: he cannot catch an equal
  fighter, so he climbs away home (15 degrees, back the way he came).
- **meet**: let go, a pilot who comes back at him (nose within 40 degrees,
  inside 800 m, closing) is faced, then chased.
- **reflex**: breaks into a pilot on his tail.

The Dip's verdict does not hang on the give-up margin: 0, 30, 50, 80 and
120 m past his reach all give 9/9. An ace who never gives up holds 412-476 m
behind you at 35 s, never closer than 199 m once the turn is done, and never
has a shot; at full throttle both Spitfires top out at 74-76 m/s, so the gap
he lost in his turn never closes. The measure calls that 0/9 (not 900 m
apart): that is the one place where its definition and "out of the fight
alive" differ here.

## The Dip: out at a crossing (`scDip`), 9/9

At the second crossing (8.0-8.5 s) you do not reverse: you hold the heading
the crossing left you on, which points away from him while he is turning
the other way, full throttle, a 6 degree dive to 110 m. He has to come about
150 degrees round to follow and starts some 5 s behind. Once the crossing is
past he comes no nearer than 150-165 m, never has a shot, gives up 7.4-9.8 s
after the move 299-311 m back, and you are 900 m clear at 23.5-25.4 s,
2.0-2.2 km at 35 s. Never hit.

| Candidate | works/9 | Why it fails |
|---|---|---|
| **Hold the crossing heading, 2nd crossing, 6 deg dive** | **9** | |
| same, 3 deg dive / turned 20 deg further away | 9 / 9 | |
| same, turned 40 deg further away | 8 | the turn costs speed, 1 hit |
| same at the 1st crossing | 7 | at -30 m he is still close and lands 2-7 |
| same at the 3rd crossing | 7-8 | slower and lower by then; one start shot down to 25 hits |
| same at the 4th crossing | 0-2 | not enough of the 35 s left to get 900 m out |
| leave once already reversing (both noses past 120 deg off) | 7-8 | later: he is already coming round |
| reverse 180 and run back down the axis | 0 | he cuts across the turn: 36-79 hits |
| run straight along the axis, in front of him | 0 | he is right behind you: up to 16 hits |
| turn away from him, then dive | 0 | the turn bleeds the speed: 2-11 hits |
| steeper dives (20-40 deg) | 0 | he follows down the pursuit curve and gains (up to 80 hits) |

## The Flip: up at the crossing (`scFlip`), 0/9

Nothing flown turns the scissors. Even the pilot who wins it never sits in
the other's rear quarter: the scissors ace in *Scissoring* has a best quarter
of 0.03 s and 0.17-0.43 s of shot in 45 s. A flat scissors at 40 m/s is a
fight of snap shots, and a Spitfire breaking at 40 m/s cannot be held in a
sight (README, "a hard-turning Spitfire cannot be hit from a flat chase").

The demo: at the first crossing pull up 75 degrees, wings level, throttle
back, let him slide out in front (you hang at about 18 m/s some 40 m above),
then nose over and down at him. You get into his rear quarter for 2 s in 3 of
9 (2 inside 20 s), but he breaks into you and your shot never lasts more
than 0.23 s. He never has a shot either.

| Candidate | works/9 | Why it fails |
|---|---|---|
| Throttle chop at crossing 1 or 2, then scissor at 28-38 m/s | 0 | never a rear quarter; his crossing snaps go on (0.1-1.9 s, up to 24 hits) |
| Yo-yo 30-70 deg at crossing 1-2, then nose on him | 0-1 | at 40 m/s the climb buys 15-40 m and leaves you at 25 m/s |
| **Steep yo-yo 55-75 deg at crossings 1-3** | **0** | behind him in up to 5 of 9, shot at most 0.77 s in one; he breaks |
| Run out (6-14 s) and come back at him | 0 | he turns to face you: head-on passes, up to 9 hits |
| same, with an ace who does not turn to face | 0 | rear quarter for 2 s in several, but no 0.5 s shot |

## The Ninja: up before it starts (`scNinja`), 7/9

Never fly the scissors. At the overshoot, with the 8 m/s he does not have,
pull up 65 degrees, wings level, throttle back. You hang 103-122 m above him
at 11.6-12.5 m/s while he slides out in front, nose over and come down at
him, and sit in his rear quarter, nose on him, while he breaks. He never has
a shot and you are never hit in any of the nine. Counting only the time you
are back in control (35 m/s or more, the measure's `IN_CONTROL`), you sit
there 2.5-4.1 s: 3 s or more in 6 of 9, and a 0.6 s shot in one more, so 7/9.
(Before `IN_CONTROL` the quarter was 3.6-4.4 s and 9/9: part of it was flown
under 35 m/s.) Your landing shot is 0-0.6 s. It is the upper hand, not a
kill.

Opening the throttle sooner behind him (below 37 or 43 m/s instead of 34)
makes it 8/9; not taken, as that is tuning to the threshold, not a different
move.

It is a narrow setting: under `IN_CONTROL`, 60 degrees holds in 4 of 9
(before it: 60 in 7, 70 in 4-5, 75 in 4, coming over at 34 m/s in 1). Hanging at 12 m/s is safe only
because he is a slow scissors pilot 100 m under you who cannot pull up to it;
anyone else above would shoot you there.

| Candidate | works/9 | Why it fails |
|---|---|---|
| Fly the scissors slower than him (hold 31-40 m/s) | 0 | every crossing gives him a snap: 0.2-1.4 s, 1-16 hits; 4-14 m passes |
| Yo-yo 20-50 deg at the overshoot | 0-4 | not high enough: he turns under you and snaps |
| Run out and come back | 0 | he faces you: head-on passes, up to 17 hits |
| **Yo-yo 65 deg, wings level, then sit 150 m behind, 20 m above** | **7** | two starts sit behind him only 2.5-2.7 s in control |

## The verdicts

- Dip: works (9/9). Flip: no (0/9). Ninja: works (7/9, narrow).
- Survival: **yes**. "Leave at the second crossing without reversing, at full
  throttle, and he never catches you (9 of 9); going up before it starts
  keeps you out of his guns too, but nothing flown turns the scissors into a
  kill."

## What changed

- `viewer/dogfight-pilot.js`: `PLANS.scAce`, `scDip`, `scFlip`, `scNinja`,
  their `INTENTS`, the helpers `scClimbOut` and `scInBehind`. Nothing shared
  was edited.
- `viewer/dogfight-lessons.js` (scissors only): `survival`, the three demos
  after *Scissoring* (kept: it is the threat, and `scissorsShape` in the
  school harness reads `demos[0]`), and the counterStory's last line, which
  said "come back from above" and now says what the nine runs showed.
- `tests/test_dogfight_dfn_sc.py`, `tests/dogfight_dfn_sc.mjs`.

## Open

- The lesson's story still says "the slower one ends up behind him with his
  nose coming onto him". The nine runs say he never sits behind: he gets snap
  shots as you drift out in front. Worth softening (not mine to rewrite
  beyond the counter).
- The coach has no lines for `scAce`'s `chase`, `let-go` and `meet`; FLY IT
  still flies `scissors`, which never chases.
- The Ninja's hang at 12 m/s is the flight law (no stall below it); a human
  with the mouse may not get the 65 degree pull this exact.
