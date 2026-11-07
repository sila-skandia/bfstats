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

## Ascendancy (2026-11-07)

The owner: the Ninja is the ascendancy, "coming up with a shot, and how to stay there", and
the Flip must stay on top once it has turned the fight. Measured by the shared
`dogfight_dfn_measure.mjs` (two attacks or a kill, never his shot or your six, the energy
held, never 20 s near him without a shot) under the human eyes (reviews/eyes.md). The
sections above are the first round; where they differ, this one is what flies.

**Who has the advantage and how it is won**: he does, 520 m of it, until his first dive
is broken and his chase after it is broken too; the dive and zoom cost him about 220 m of
energy and the chase about 100 more while your climb adds yours, and after 38-50 s the energy is yours and you are the
boom-and-zoomer.

### What the eyes changed

- After your break he zooms past and loses you under his tail for 11-12 s (clearing
  turns). He no longer dives a second time from height: in the counter demo (`climbBetween`
  against `boomAndZoom`) seven of nine see one dive, two a second one from about 140 m
  that he pulls out of without a shot; you climb 490-600 m and finish 70-330 m above
  him. The counter's words and `test_dogfight_shape_height` say so now.
- Against `uhAce` he comes back after the clear level with you and chases from behind.
  The old climb-and-break broke only dives, so it climbed on in front of him: six 3-33 s
  and his guns 0.9 s in two of nine (old Ninja 0/9, old Dip 7/9). `uhClimbOrBreak` now
  breaks his chase the same way (his nose within 25 deg, inside 380 m, closing, you
  with him more than 60 deg off your nose).
- A prototype plan with no `INTENTS` row runs clearing turns in phases meant to be
  defensive (the run of a Dip): the rig numbers differ (Dip 0/9 instead of 7/9 with the
  same code). The shipped rows are measured with the rows the file ships; the other
  candidates were measured in the rig before them, so read them as a ranking (the shipped
  Ninja and Flip flew the same count both ways).

### The Ninja (`uhNinja`, 90 s): 7 of 9

Climb and break (dives and chases) until the energy is yours: 200 m of it and 35 m over
him, or 50 m with 80 m over him, his nose 45 deg or more off you, inside 600 m. Then
`PLANS.ascend` as it is (called, not copied), every landing shot taken (`aimed: true`:
`ascend` holds its fire off the dive, which the school's "a shot that would land reads as
going for it" test fails).

| start dx/dv | ok | hand-over s | attacks at s | myShot s | hits | killed s | circling s | his shot | six |
|---|---|---|---|---|---|---|---|---|---|
| -30/-3 | yes | 49.8 | 55.5, 75.4, 77 | 2.9 | 26 | 78.8 | 5.9 | 0 | 0 |
| -30/0 | yes | 46.0 | 59.2 | 2.87 | 54 | 61.5 | 0.9 | 0 | 0 |
| -30/+3 | yes | 37.9 | 63.6, 65.4 | 0.7 | 5 | - | 21.1 | 0 | 0 |
| 0/-3 | no | 46.7 | - | 0 | 0 | - | 31.3 | 0 | 0 |
| 0/0 | yes | 45.9 | 59.3, 62.1 | 2.27 | 33 | 62.6 | 2 | 0 | 0 |
| 0/+3 | no | 37.9 | - | 0 | 0 | - | 41.2 | 0 | 0 |
| 30/-3 | yes | 45.9 | 58.6, 61.7 | 2.1 | 22 | 62.4 | 1.7 | 0 | 0 |
| 30/0 | yes | 46.0 | 59.3 | 3 | 50 | 61.8 | 0.9 | 0 | 0 |
| 30/+3 | yes | 37.9 | 74.2-86.4 (4) | 0.67 | 6 | - | 36.3 | 0 | 0 |

"Circling" is time after the hand-over in `ascend`'s climb step inside 600 m: climbing
toward him at about his height while he reflex-breaks, the stalemate of reviews/ascend.md.
**The measure passes two fights that look like that** (-30/+3 and 30/+3: 21 and 36 s of
lockstep circling, the second a descending spiral with four snap shots of 0.67 s in all),
and both failures are that circling with no shot at all. The five kills (four in one pass
at 61-63 s) and 30/-3 are clean. The middle start, the one the theatre shows, is a clean
kill: dive at 47 s (he meets it), up and over, down again at 56 s, two bursts, down at 62.6 s.

Candidates (works of 9, 90-100 s):

| Candidate | works | why it fails |
|---|---|---|
| old `uhNinja`: climb between, then sit on his tail | 0 | his chase from behind: six 3-33 s, his guns 0.9 s in two |
| climb between (dives only), `ascend` at an edge of 0/50/100/150 m | 1/1/0/1 | the same six during the climb, 6-48 s |
| + break his chase, `ascend` at 50/100/150/200 m | 4/0/3/5 | late hand-overs never come against the +3 starts; early ones dive from 700 m and he meets it |
| **+ the early hand-over (50 m, 80 m over, his nose 45+ off, inside 600 m)** | **7** | shipped; 30/40/60 m: 6/6/5, nose 30-50 deg: 7 |
| a grid over the early gate (50-150 m, 35/80 m over, nose 60-120, 600/900 m) | 5-6 | |
| + hit and run after a shot (out past 850-1000 m, back down) | 3 | fewer second attacks: idle 37.5 s in one, one attack in others |
| + back to climb-and-break when below him instead of `ascend`'s climb | 3-4 | no second attack: idle 37-42 s |
| + `ascend`'s climb replaced by an extension to 700-900 m (8 variants) | 3 | the same; the climb toward him is what brings the second shot |
| extend away from a chaser below until he lets go, then hand over | 4-5 | he catches up as you level; six 5-16 s |
| beam across his line against a chaser in the climb | 5 | no shot in three, his six 6.5 s in one |
| random search, 240 configs over 16 knobs (climb, breaks, gates, extend) | best 4 | |
| the Flip's reversal, then this Ninja | 6 (60-70 s), 4 (90 s) | |

### The Flip (`uhFlip`, 60 s): 8 of 9

Climb and break; when he chases from behind at your height, break into him; the moment
he has gone past (opening, inside 250 m, within 3 s of the break, no more than 5 m/s
faster than you, not diving) reverse onto him with `uhAim` (a copy of `ascAim`, the
lead's own swing led 0.7 s: `ascAim` is not exported and `ASC` is declared below this
lesson's plans; the school's `leadPursuit` lands no shot in this reversal). Off it after
12 s, past 450 m or with his nose back on you; then the Ninja above.

Nine runs: the reversal 31.6-44.4 s in, his rear quarter 6.4-12.4 s later, landing shot
0.9-2.83 s, four kills at 55.7-56.2 s; his guns never fire, he is never on your six, never
20 s near him without a shot (idle at most 12.2 s). The ninth (-30/-3) sits 5.2 s in his
quarter with no landing shot. After the flip nothing circles (at most 3.5 s in `ascend`'s
climb).

| Candidate | works | why it fails |
|---|---|---|
| old `uhFlip`: pull up after his zoom | 0 | he goes past at 71-74 m/s to your 42 and zooms away |
| break his chase, reverse with `leadPursuit`, then climb and break | 0 | quarter 2-7.5 s, at most 0.8 s of shot, idle 15-30 s after |
| the same with the 5 m/s gate / throttle back near him / from 400 m / on the second break / after a dive's break too | 3/0/0/0/0 | |
| + the Ninja after the reversal (`leadPursuit`) | 3 | the nose lags him: 0-0.77 s of shot in six |
| **`uhAim` + the Ninja after** | **8** | shipped; off after 20 s: 6; 10 m/s gate: 8; off past 600 m: 8 |
| `uhAim`, no hand-over | 3 | idle 25-27 s after the shot |

### The Dip (`uhDip`, 70 s): 9 of 9

Before this round, under the eyes: 7/9 (hit once in one, never a run in another, his
six up to 21 s). With his chase broken and the run started at 50 m of edge (was 100): 9/9. Two
breaks (his dive, his chase), his guns never fire, the run 37.9-42.5 s in from 390-750 m,
he lets you go 6-21 s into it, at 70 s 1.7-3.2 km apart and opening. In the three +3
starts he sits behind you inside 400 m for up to 8.9 s as the run starts, without
firing. Edges of 30-75 m all fly 9/9 at 70 s (4-6 at 60 s); 100 m 7/9, 150 m 1/9.

### Verdict

Survival **yes**: the Dip 9, the Flip 8, the Ninja 7. Every move waits 38-50 s for the
height; the Ninja demo is 90 s, not the brief's 50, because the energy is only yours
38-50 s in, and the theatre's middle start ends at 62.6 s with him shot down.

### Open

- The circling: two of the Ninja's seven and both failures end in `ascend`'s climb
  toward him at even height; every replacement measured (extension, hit and run, back to
  climb-and-break) loses the second attack (3-4 of 9). Same finding as reviews/ascend.md.
- The Ninja's early hand-over is a knife edge (50 m: 7; 40 m: 6; 60 m: 5).
- In the Flip's +3 starts the landing shot is long (2.8 s) but the hits few (4-9).
- Pictures: `<scratchpad>/asc-uh/final-*.png` (plots), `<scratchpad>/asc-uh/shots/` (theatre).

### After the review (2026-11-07, later)

The independent review (scratch `rev-uh/`) passed the Flip and sent back the Dip and the
Ninja; the shared measure then changed (measured to the kill, an attack is a 0.3 s burst
more than 3 s after the last, IDLE runs from a 50 m energy lead inside 600 m, no hanging
under 35 m/s inside 300 m). Under it the Ninja above flew 5/9: only the five kills.

- **Dip, 9/9, never on your tail.** In the three +3 starts the run went straight down his
  nose line and he sat behind you inside 400 m for 8.6-8.9 s. The run now waits for his
  nose to be more than 90 deg off you or for him to be past 600 m (the reviewer's test):
  it starts 40-45 s in (a third break in those three), he lets you go 6-12 s into it, at
  70 s 2.2-3.2 km apart.
- **Ninja, 5/9, partly.** No variant flies more than the five kills under the new measure:
  20 hand-tried and 160 random configs (hand-over gates, keeping the height in `find`
  instead of `ascend`'s nose-down turn, resets to climb-and-break, going out after a level
  pass, out to 700 or 900 m) all land on 5, or fewer (keeping the height in `find`: 0-1,
  it also kills the four good dives). The four that fail: in the three +3 starts the
  hand-over comes 395 m from him as his nose comes round, `ascend` beams, then its `find`
  turns down onto him and spends 90 m before any dive, leaving you under him; in 0/-3 he
  meets the dive. What changed is what happens next: 4 s level with him inside 400 m and
  `uhNinja` leaves (`out`, away from him, a defending phase, so no clearing turn brings
  you back round), instead of `ascend`'s climb after him. Circling after him at his height
  is now at most 6 s in all nine (was 15-41 s in five); he lets you go 62-74 s in and at
  90 s you are 0.9-1.4 km apart. The survival line says the Ninja is 5 of 9 and why.
- **Flip, 8/9, words.** In five of the eight the turn back slows you to 27-30 m/s and ends
  289-325 m behind him, out of gun range; the first landing shot comes 8-12 s later from a
  dive (the Ninja's), which shoots him down in four. Only in the three +3 starts does the
  reversal itself land the shot (2.77-2.83 s). The verdict line says so; tightening the
  turn was not tried.
- **Captions.** After the hand-over `ascend`'s climb no longer reads "climbing at full
  throttle, keeping him in sight" (the climb-and-break's): it reads "Not above him now:
  climbing toward him". The ace's chase reads "the height spent on speed" only with 20 m or
  more over you; below, "after him, climbing at full throttle".
- The Ninja demo opens at 26 s (`startAt`, the theatre's), his chase coming in; the nine
  starts are still scored from 0.

Pictures: `<scratchpad>/asc-uh/r2-*.png`, `r2d-ninja-0m3.png` (the leave), and
`shots/start-ninja.png`.

### On the L9 starts (2026-11-07, last)

The nine starts are now the shared L9 array (`STARTS`, `nudge`: sideways, along, height
and speed); `dogfight_dfn_uh.mjs` flies them. STARTS[0] is the theatre's fight. The
counts above were on the old x-by-speed grid; on the L9 they are:

- **Dip 9/9.** One to three breaks, the run 30-45 s in, he lets you go 6-20 s into it, at
  70 s 1.5-3.2 km apart; never fired at, never on your tail.
- **Flip 6/9, partly.** Eight reverse onto him (32-45 s in, his quarter 6-12 s later). The
  reversal itself brings the shot in one; in seven it ends at 27-33 m/s, 298-326 m behind
  him, and the first shot comes 8-14 s later from the Ninja's dive: enough in five (two
  kills, STARTS[0] one of them), 0.2 and 0.47 s in two. In STARTS[7] he never comes after
  you again after his first dive: nothing to reverse on.
- **Ninja 1/9, no.** The height is won in all nine (hand-over 35-53 s), never fired at,
  never on your tail, circling at most 10 s. Only STARTS[0] holds (one dive, down at
  62.6 s); four land a burst and are not shot down (a second burst in one; 20 s or more
  near him without one in three), four land nothing. Re-tried on the L9 (11 variants of
  hand-over gates, going out, resets): 1-2/9; the Flip's reversal flown as a Ninja: 2/9
  at 60 s, 3/9 at 90 s. The old grid's five kills sat in a narrow band of starts the L9 no longer repeats.
  Survival stays **yes** on the Dip; the line says holding the upper hand does not follow.
- `test_dogfight_shape_height.mjs` still flies the old grid for the lesson's first three
  demos: its loop is shared with Boom and zoom, so it is left to whoever owns that file.
