# Up and over, on a jet

Status: **re-tuned** (2026-11-10). The fight is flown as written and its
words rewritten for the jet; the Dip is re-flown with a jet plan of its own.
Files: `tools/bf1942-models/viewer/dogfight-jet-up-and-over.js`,
`viewer/dogfight-jet-plan-up-and-over.js` (`jetUoDip`),
`tests/test_dogfight_jet_up_and_over.py`. The Spitfire's version:
[vertical.md](../dogfight-school/reviews/vertical.md),
[loop.md](../dogfight-school/reviews/loop.md),
[dfn-uo.md](../dogfight-school/reviews/dfn-uo.md).

## What a jet does going up

The Spitfire lesson rests on the follower running out of speed first:
straight up, a Spitfire loses 10 to 14 m/s a second, the leader goes over
the top at 46 m/s and the follower hangs at 13 m/s under them. A jet does
not run out of speed. Flown on the F-16 from the lesson's start (paced 1.28:
the ace at 100 m/s, you at 64, 358 m up):

- The ace pulls at 1.5 s, nose to 76 degrees, and never drops below 77 m/s;
  it reaches 1,000 m 10 s after the pull at 88 m/s, and is faster at the top
  of the climb than in the middle of it (77 to 90 m/s with the nose over 60
  degrees).
- What stops it is the air. `aircraft.js` `medium`: every surface's lift is
  multiplied by `1 - clamp(y / 1000, 0, 1)`, so half at 500 m and nothing
  at 1,000 m. `upAndOver` waits for `OVER_SPEED` (46 m/s at the Spitfire's
  size, 59 real) before going over the top, which never comes; its pull
  times out at 10 s, at about 1,000 m, and it tops out at 1,182 m 14.7 s in, 11.4 s
  above 900 m, back under 700 m only at 25.8 s.
- A loop is not the problem: flown from level at 100 m/s with full aft
  stick (a scratch plan, not kept), the F-16 goes round in about 5 s, the top
  only 120 m above the bottom, 71 to 75 m/s over it. A jet pilot who goes
  over the top below the thin air is never slow there either. Tried as an
  ace (`upAndOver` sent over the top after 1 to 6 s or above a height): the
  loop came out at the ace's height plus the climb, but its pounce, flown
  with the Spitfire's numbers, landed 0 to 22 hits even on a pilot flying
  straight and level, and following them up or shallow still landed 0 to 13
  either way. Not kept: the lesson's ace is the one who pulls straight up,
  and on a jet that pilot goes to the ceiling.

So (b) of RETUNING.md: the jet makes the claim false in a way that is itself
the lesson. The fight is kept, the words say what it does.

## What the follower should do

Tried on the F-16 against the as-written ace, scratch plans:

| follower | hits on them, nine starts | why |
|---|---|---|
| follow them up (`followStraightUp`, the lesson's `move`) | 0 (1 in two, in the opening chase) | you keep your speed, 93 to 110 m under them as they top out; nobody's nose bears |
| follow shallow at 25 degrees (`shallowFollow`, `counter`) | 6 to 12 in seven, 1 in two | not at the top: as their nose comes up through 62 to 65 degrees they cross your sight 388 to 426 m out, 4.7 to 5.7 s in |
| the same line at 10, 15, 20 degrees | 0 to 1 | they never cross the nose |
| at 30, 35, 40 degrees | 1 to 7 | a shorter crossing |
| lead pursuit on the pull, nose capped at 30 to 60 | 0 to 13, mostly 0 to 2 | the F-16's nose answers in 0.83 s; chasing the climb with it lands nothing |
| shallow, then stay under 350 to 550 m (at the Spitfire's size) and wait | as shallow, plus 1 to 5 late hits in two of nine | the second shot hardly comes |

What works is the snap shot on the 25 degree line, then not following them
into the thin air at all. `jetUoDip`: chase; when their nose comes up, hold
25 degrees on their bearing for 2.5 s (the shot), then roll out on the
heading you had and go on under them, full throttle, the nose 6 degrees
down to level between 240 and 180 m at the Spitfire's size (307 and 230
real). 9 of 9 clear, never hit.

Not relied on anywhere: after the top, the ace flown as written wallows at
15 to 60 m/s for 20 s or more (the Spitfire plan's full aft stick at low
speed, `over` and `zoom` cycling under `OVER_SPEED`). A jet pilot falling
out of the ceiling would put the nose down and be fast again in seconds, so
no word on screen says they come down slow.

## The nine starts, before and after (F-16)

`move` and `counter` from the harness's nine (`--text`: your x -30/0/+30 m
by speed -3/0/+3 m/s; hits theirs/yours). The moves from the school's own
nine (`dogfight-measure.js` `STARTS`, the L9 over x, z, height and speed),
scored with `scoreMove` and `movesOn` exactly as the theatre counts them.

| demo | before (as written) | after |
|---|---|---|
| move | 0/0 x7, 0/1 x2 | the same (words only) |
| counter | 0/12, 0/8, 0/8, 0/7, 0/7, 0/7, 0/6, 0/1, 0/1 | the same (words only) |
| dip | 0/1 to 0/7, never hit; **1 of 9** works (the run is slow and short: you climbed after them to 30 degrees for 11 s into the thin air, 28 to 73 m/s at 35 s, 567 to 1,463 m apart) | `jetUoDip`: **9 of 9**, never hit; the pull's shot lands 0 to 10; they top out 14.7 s in, chase for 6 s, let go at 20.7 s; 1,919 to 2,053 m apart at 35 s, opening |
| flip | 0/0, 0/1 x2; **0 of 9** | the same, **0 of 9** (words and verdict) |
| ninja | 0/0, 0/1 once; **0 of 9** | the same, **0 of 9** (words and verdict) |

The Flip on the jet: following them up you never slow to `UO.upOff` (42 at
the Spitfire's size, 54 real) until 16.8 to 22.3 s in, 1,084 to 1,288 m
up; best 0.93 s in their rear quarter; nobody lands a round after the climb.
The Ninja: its shot "as they slow over the top" never comes (no
`ninja-shoot` phase in any of the nine); a burst (0.3 s of landing shot) in
two, 3 hits in one at 48.7 s; never hit; in eight they turn in and you
leave.

Claims, one by one:

- "Following them up gets nothing": **holds**, for another reason. Rewritten:
  you do not hang, you go up with them, and nobody lands a round.
- "Following shallow gets the hits": **holds, about half** (6 to 12 in seven
  against the Spitfire's 12 a fight). Rewritten: the shot is the pull, not
  the top; one burst, no kill (22 hits needed), no second.
- "They hang slow at the top inside your guns", "the trick buys them the
  height and four seconds of you helpless": **false** on a jet. Rewritten.
- Survival: **yes**, more easily: the Dip 9 of 9.
- The coach's `over` and `zoom` lines ("they are slow up there") were false;
  the jet coach says where the air runs out and to stay low and fast.

## On the MiG-29 (pace 1.5)

The same lesson. The ace climbs at 98 to 104 m/s, reaches 1,000 m 9.2 s in
and tops out at 1,268 m; following them up lands nothing either way (0/0 in
all nine), and the follower goes on to 1,780 to 1,895 m and is above 900 m
for 32 to 35 of the 45 s. Following shallow lands 1 to 11 (10, 6, 11, 1, 5,
1, 2, 4, 1), always 4.8 to 5.7 s in, 460 to 521 m out. Dip 9 of 9, Flip 0,
Ninja 0. The words' numbers are the F-16's.

## Open

- **The ace's recovery** from the ceiling is the Spitfire plan's: full aft
  stick at low speed keeps it wallowing for 20 s or more. A jet version of
  `upAndOver` (`over` that unloads and dives once out of the air) would make
  the second half of every fight more honest. It needs a change to the ace
  the Range's other demos share (`upAndOver`, `uoAce`, `uoAceSharp` in
  `dogfight-pilot.js`), or jet copies of all three; not done.
- **The live fight** (FLY IT, `flyAce: 'uoAce'`) is not fitted, as for every
  lesson (README, "Open").
- **The Flip and the Ninja** are 0 of 9 and not re-tuned: both wait for a
  slow moment over the top that a jet never gives. A jet Ninja would have to
  be built on the pull's shot and the ace's descent; with the ace's recovery
  as it is, anything that worked would be working on the wallow.
- **Shared files.** None changed. The harness prints only end states, so the
  test flies the same fights itself (`MEASURE` in the test, the harness's
  setup and the school's `scoreMove` / `movesOn`); a `--measure` in
  `tests/dogfight_jet_harness.mjs` that printed tops, hit times and move
  scores would let every lesson's test share it.
