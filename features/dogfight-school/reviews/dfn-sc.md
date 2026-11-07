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

## Ascendancy (2026-11-07)

The owner: the Ninja is the ascendancy, "coming up with a shot, and how to
stay there"; the Flip must stay on top once it has turned the fight. Scored
with the stricter measure (`dogfight_dfn_measure.mjs`: two attacks a second
apart, 0.5 s of shot and a hit, or a kill; never on your six for a second;
the energy or his tail 60% of the time after the first shot; never 20 s
inside 600 m without a shot) and under the human eyes (reviews/eyes.md).
Every count is the nine starts against `scAce`, unchanged. Lab scripts and
pictures in `<SCRATCH>/asc-sc/`.

Who has the advantage and how: you do, on speed, at the overshoot (52 m/s
to his 44, an energy edge of 26 m that grows past 100 m in 8 s while he
brakes to 40 m/s); you keep it by going up before the scissors starts and
coming down on him from 70 m or more above, again and again, because his
chase climbs no steeper than 20 degrees and he sinks 70-210 m in 50 s
turning after you.

### Under the eyes, before any change

The Dip: 9/9 (unchanged). The old Flip: 0/9. The old Ninja: 0/9 under the
new measure (it was 7/9): one attack at most (0-0.6 s), then sitting 100 m
behind a breaking man for the rest of the fight, idle 16 s in 30 s and 36 s
in 50 s, the lockstep the owner named. Under the eyes our own pilot also
loses him under the tail in the 65 degree hang and makes a clearing turn at
7 s.

### The Ninja (50 s): candidates

| Candidate | works/9 | why it fails |
|---|---|---|
| The old Ninja: hang 65 deg throttle back, drop in behind, sit there | 0 | one attack, then circling behind him: idle 36 s |
| The old hang and first pass, then `ascend` | 0 | `ascend` zooms only while it has 62 m/s; it never gets there here: idle 36 s |
| Full-throttle zoom at the overshoot (60-80 deg, to 22-38 m/s), then `ascend` | 0 | dives through him (3-4 m), then circles under him: idle 41 s |
| Leave straight from the overshoot, full throttle (level, 10, 20, 30 deg, best climb) | 0 | the edge is 145-165 m in 8 s, but you are in front of him: on your six 5-27 s |
| Zoom, then extend away from him | 0 | he chases: on your six 1-27 s, his shot up to 2.8 s |
| Perch round him 300 m out, 120 m over, dive only from 18-45 deg below, 180-420 m, his nose away | 0 | never dives: he chases onto your six (1-27 s) |
| Hang (throttle back), first pass with the lead, then the scissors pendulum | 0-2 | the pass rarely lands; on your six up to 4.6 s |
| The pendulum, diving only from his rear quarter (aspect under 90 / 120) | 3 / 3 | fewer dives |
| The pendulum, the wingover rolled toward his heading | 0 | dives from beside him miss; six 3.5 s |
| **Full-throttle zoom 80 deg to 35 m/s at the overshoot, then the scissors pendulum (`scNinja`, `scPendulum`)** | **5** | |

The pendulum is `ascend`'s, cut to the scissors' speeds (the zoom runs on
down to 30 m/s, the pull-off at 60 m, 1.5 s from the merge or 25 m over
him, the dive only from 70 m over him), and it calls `ascAim` and
`ascOffLine` unchanged. The knobs were searched (184 configurations, 14
knobs): 0-5, best 5. The shipped one is a narrow peak: the entry pull at
75 or 85 degrees instead of 80 flies 0; ending it at 33 or 37 m/s, 2 and 0;
the zoom at 62 or 68 degrees, 3 and 0; the pull-off floor at 20 or 30 m, 2
and 4; a harder pull-off, 2.

The dive lab (119 dives from five pendulum settings): a dive that lands 0.3
s or more starts 20-30 degrees below the horizon (12 of 23) or from 250-500
m (12 of 22) or with his nose away (12 of 28); from directly over him (60-90
degrees) 12 of 46, from 40-60 degrees 2 of 34, from inside 200 m 9 of 77.
Getting out to 250-300 m to dive from there is what the perch tried: he
chases you onto your six. So the dives are from over him, and most miss.

What it flies (exact, from `test_dogfight_dfn_sc.py`):

- Three dives in 50 s, at 12-13, 26-27 and 41-46 s. The first never lands.
  The second does in 6 of 9, at 28-30 s.
- Works in 5: two or three attacks, 1.07-1.5 s of shot, 1-12 hits, never a
  kill; never on your six, never shot at; your energy 85-200 m over his at
  the end (he sinks 70-210 m).
- Fails: the dives bring one 0.17 s snap at most (-30/-3, +30/-3); after
  the first dive's pull-out, under his height, he is on your six 1.4 s
  (0/+3); he meets the last dive head-on, a 0.23 s snap and one hit
  (+30/0).
- The tops of the zooms are at 8-9 m/s, 140 m or more over him; the
  pull-outs bottom out at his height or as much as 57 m under it, fast.
  Neither is hanging under him, but both are on screen.

### The Flip (40 s): candidates

| Candidate | works/9 | why it fails |
|---|---|---|
| The old Flip: up 75 deg throttle back at the first crossing, drop in behind | 0 | his rear quarter 1.9 s at best, shot 0.43 s at most; six 2.7 s; 6 m passes |
| **Up 65 deg at full throttle at the first crossing, over the top, then the pendulum (`scFlip`)** | **0** | |
| The same at the second crossing | 0 | on your six 1-3.5 s in all nine; 3 m passes |
| Up 75 deg with the throttle back, then the pendulum | 0 | his rear quarter 2.7 s at best, after the 20 s |
| Up 80 deg to 25 m/s / 50 deg to 38 m/s, then the pendulum | 0 / 0 | six up to 6.3 / 1.2 s |
| Up, then the pendulum diving only from his rear quarter | 0 | quarter 0.9 s at best |
| Hang, drop in behind with the lead, then the pendulum (9 variants: 55-75 deg, throttle -1 to 1, 100-200 m behind, the second crossing, rolled toward him) | 0 | six up to 8.6 s, his snaps 0.2 s with up to 5 hits |

What it flies: up at 3-4 s; the first dive at 12 s goes 47-58 m under him
without a shot; nobody sits in his rear quarter for 2 s (1.77 s at best);
the only shots (0.5-0.6 s, 9 hits, in 2 of 9) come on the second dive at
28 s, past the Flip's 20 s; his snaps 0.13-0.17 s in 2 (one hit); never on
your six for a second (0.67 s at most).

### The verdicts

- Dip: works (9/9). The words now say he sits on your tail 4-7 s, 210-250 m
  back or more once round, never with a shot.
- Flip: no (0/9). Ninja: partly (5/9).
- Survival: **yes** (the Dip), the line now naming the Ninja's 5 of 9.

### What changed

- `viewer/dogfight-pilot.js`: `SC`, `scOver`, `scPendulum`; `scNinja` and
  `scFlip` rewritten to fly them (and their `INTENTS`); `scClimbOut` and
  `scInBehind` removed (only the old Flip and Ninja used them). The zoom
  and the wingover keep the guns live, so a snap on the pull-off is taken.
  `ascend` and its helpers untouched (called, not copied).
- `viewer/dogfight-lessons.js` (scissors only): the Flip and Ninja demos
  (labels, 40 s and 50 s, notes, verdicts), the Dip's verdict line, the
  survival line, the counterStory's last line.
- `tests/test_dogfight_dfn_sc.py`, `tests/dogfight_dfn_sc.mjs`: the Flip
  and Ninja tests rewritten to what flies; the Ninja demo flies 45 s or
  more.

### The ace

Unchanged. `scAce` breaks into a dive he sees (the reflex), meets a man
coming back at him, and chases a man who leaves; his chase climbs 20
degrees at most. Not given a zoom after you: at 35-45 m/s a Spitfire
pulling up 60 degrees after a man 150 m over him sheds 10-14 m/s a second
(README, "What the airframe does") and hangs under your guns, which is no
answer.

### Pictures

In `<SCRATCH>/asc-sc/` (top-down and side-on, 2 s marks, landing shots
thick, grey where the other pilot does not see that plane, orange where he
is on your six):

- `ninja-0-0.png` (the demo): works; zoom to 430 m, three dives, shots on
  the second and third, he sinks from 300 to 120 m.
- `ninja-0-3.png`: fails; the first pull-out bottoms under him and he is on
  your six 1.4 s at 16-18 s.
- `ninja-30-0.png`: fails; the third dive meets him head-on.
- `ninja-m30-m3.png`: fails; no dive lands.
- `flip-0-0.png`, `flip-30-m3.png`: the Flip; the first dive far under him,
  the shot only at 28 s.
- `probe/top-scissors-ninja.png`, `probe/look-scissors-ninja-wide-29.5.png`,
  `probe/look-scissors-flip-wide-28.3.png`: the theatre.

### What stays open

- The Ninja is a narrow setting (neighbours 0-5) and never kills. The
  first dive, from directly over a 40 m/s man reversing under you, never
  lands; diving from 250-300 m out lands far more often but getting there
  gives him your six.
- The Flip asks for 2 s in his rear quarter inside 350 m; in a flat
  scissors at 40 m/s nobody flown ever sits there (the first round's
  finding, again under the eyes). From above, the passes are snaps.
- The measure's 15 m rule counts the scissors' own crossings, which pass
  15-24 m apart; some Flip candidates failed on that alone.
- The eyes: nothing wrong found for this scenario. Our pilot loses him under
  the tail in a steep zoom and makes clearing turns; he loses us during the
  hang at 3-7 s; both are what a pilot in those seats would see.

### Round two (the review, 2026-11-07): the ace keeps his height

The independent review found the 5 of 9 above was an ace giving his
height away: `scAce` turned hard and flat under a man 140 m over him that
he could not reach, his energy falling 366 to 177 m. It also found the
Ninja hung at 8-9 m/s for 12-13 s of the 50, and its first "dive" was a
fall in front of his nose. The Flip flew the Ninja's pattern 3 s later.
The measure changed under it as well: a fight is measured up to the kill;
an attack is a 0.3 s burst more than 3 s after the last; the IDLE clock
starts at a 50 m energy lead inside 600 m; the Ninja and the Flip may not
spend more than 3 s under 35 m/s inside 300 m of him. And the nine starts
are now the L9 array over sideways, along, height and speed (`STARTS`).
Under all of that the shipped Ninja flew 0/9 (hang 10 s, idle 24-48 s).

**The ace: `scClimber`** (the Flip and the Ninja; the Dip, the classic
demo and the ascendancy bench keep `scAce`). It is `scAce` plus three
rules. With the other plane 50 m or more over him he climbs at 20 degrees
at full throttle, drifting toward him. A dive he sees coming inside 600 m
he turns to face. A man hanging under 22 m/s over him inside 300 m he
snaps up at, for 4 s at most. The round-one Ninja flies 0/9 against him:
no attack, his snaps up to 0.5 s and 6 hits, on your six 7 s.

**The Ninja against him: 0/9 in every family.**

| Candidate | works/9 | why it fails |
|---|---|---|
| Round one's pendulum (80 deg to 35 m/s, zoom to 30) | 0 | hangs 9-10 s; he climbs, no shot |
| The pendulum, 112 random settings, entry 25-60 deg, over the top at 40-48 m/s, zoom 30-60 deg to 38-50 m/s | 0 (all) | 1007 of 1008 fights without two bursts; he climbs to meet every dive |
| **Up 45 deg to 48 m/s, over the top, dive, zoom to 50 m/s (shipped as the try)** | **0** | the dive misses and leaves you under him; then level |
| The same, then one pass and out (leave at 8 or 12 s) | 0 | he follows: 2-37 hits, on your six 8-35 s |
| Sit high behind him (150-300 m back, 40-100 m up), dive when his nose is away | 0 | he turns toward you: on your six up to 17 s, his shots up to 1.3 s |

What the shipped try flies (L9): 40-100 m over him at 4 s with a 30-70 m
energy lead. He climbs at 20 degrees and turns toward you. Your dive
misses and leaves you 30-80 m under him at 8 s. From there it is level,
within 30 m of his energy at 20 s in all nine, and you never get a shot.
He has one 0.2 s snap and one hit (1 of 9). You hang 1.1-3.1 s. The demo
ends at 20 s, so the viewer sees the try and its failure, not 30 s of
circling at even energy. The note says what the viewer is watching.

**The Flip: 0/9, the move a player tries first.** From the first crossing
you throttle back to fly the scissors slower than him. The throttle holds
33 m/s, and the brake's lag takes you to 27-30 m/s against his 37-43. You
cross him four times in 20 s and are never in his rear quarter at all.
Your guns get one 0.37 s snap (1 of 9). You sink 135-170 m and end as much
as 80 m under him. He snaps you as you cross: 0.23-0.4 s, 2 hits, in 2 of
9. Passes come as close as 7 m. The demo ends at the Flip's 20 s.

Other ways to make him drift out in front (old aces, x by speed): out-slow
at 30, 36 or 38 m/s, or start at the second crossing. All 0: never in his
quarter, his snaps up to 1.3 s and 18 hits. Round one's up-and-down Flip
flies 0 against `scClimber` too, on your six 1.8-6.8 s.

**The Dip under the L9 starts: 6/9.** Nothing in the flight changed. It is
never hit in any of the nine, and he never has a shot. He gives up 7-13 s
after you leave, 300-330 m back, and you are 900 m clear at 24-28 s. The
three that fail are the scissors' own crossing at about 8 s, the one you
leave from, passing 6, 11 and 15 m from him. The measure fails any pass
inside 15 m. I tried four changes:

| Change | works/9 |
|---|---|
| Leave at the first crossing | 4 |
| Lift the nose 25-40 deg inside 30-80 m of a crossing | 6 |
| Push it 10-30 deg down inside 40-100 m | 3-5 |
| Leave at crossing two with a bigger gap | 4 |

He steers into you as he reverses. The Dip's verdict is partly, and so is
the survival verdict: "Partly: leave at the second crossing ... 6 of 9
clean. Against a man who climbs with you, nothing flown turns the
scissors round or keeps you over him (0 of 9 each)."

A note for whoever builds on `scDip`: its `dip-run` intent is `defend`,
which keeps the clearing turn off while running. A copy without that
intent turns back to look and flies 1/9.

**Words fixed (the review's points).** The `over` caption now plays while
there is speed to turn over the top. `find` says the nose is going down
toward him. `climb` says "level with him or under him: pulling up". The
ace's scissors captions play only while he is still scissoring: he is in
`climb` from about 3 s. Every count above is L9.

**Pictures** (`<SCRATCH>/asc-sc/`):
- `r2-ninja-0-0.png`, `r2-ninja-0-3.png`, `r2-ninja-0-0-50s.png`: the
  Ninja try, and what 50 s of it would look like.
- `r2-flip-0-0.png`, `r2-flip-30-3.png`: the slower scissors.
- `cl-yoyo-0-0.png`, `cl-stalk-0-0.png`: two of the failed families.
- `probe/look-scissors-ninja-wide-7.png`, `probe/top-scissors-flip.png`:
  the theatre.

**Open.**
- Whether any Ninja exists against a pilot who climbs with you from an
  8 m/s edge. Nothing flown here found one. The bounce from his tail cone
  would need to be below his climb path, and he only climbs while you are
  above him.
- The Dip's three fails are the 15 m rule on a pass the scissors force on
  you. They are not the Dip.
