# Up and over, on a jet

Status: **re-tuned** (2026-11-10), and **re-flown against a jet ace**
(2026-11-11): the ace goes over the top while the air still holds it, the
words say what that fight does, and the Dip is re-flown for it. Files:
`tools/bf1942-models/viewer/dogfight-jet-up-and-over.js`,
`viewer/dogfight-jet-plan-up-and-over.js` (`jetUoDip`, `jetUpAndOver`,
`jetUoAce`, `jetUoAceSharp`), `viewer/dogfight-jet-ceiling.js` (the roof,
shared with under-the-height), `tests/test_dogfight_jet_up_and_over.py`. The
Spitfire's version: [vertical.md](../dogfight-school/reviews/vertical.md),
[loop.md](../dogfight-school/reviews/loop.md),
[dfn-uo.md](../dogfight-school/reviews/dfn-uo.md).

## What a jet does going up

The Spitfire lesson rests on the follower running out of speed first:
straight up, a Spitfire loses 10 to 14 m/s a second, the leader goes over
the top at 46 m/s and the follower hangs at 13 m/s under them. A jet does
not run out of speed. Flown on the F-16 from the lesson's start (paced 1.28:
the ace at 100 m/s, you at 64, 358 m up), the ace pulls at 1.5 s and with
its nose over 60 degrees never drops below 71 m/s.

What stops a jet is the air. `aircraft.js` `medium`: every surface's lift is
multiplied by `1 - clamp(y / 1000, 0, 1)`, so half at 500 m and nothing at
1,000 m.

## The ace (2026-11-11)

Flown as written, the ace was the Spitfire's `upAndOver`, which waits for
`OVER_SPEED` (46 m/s at the Spitfire's size, 59 real) before going over the
top. That never comes on a jet: its pull timed out at 10 s, at about 1,000 m,
it topped out at 1,182 m 14.7 s in, took 11 s to fall back under 700 m and
wallowed at 15 to 60 m/s for 20 s or more (full aft stick at low speed, `over`
and `zoom` cycling under `OVER_SPEED`), even down at 300 m. An ace that falls
out of the sky is not an ace.

The jet's ace (`jetUp` in `dogfight-jet-plan-up-and-over.js`, wrapping
`upAndOver`, `uoAce` and `uoAceSharp` as `jetUpAndOver`, `jetUoAce`,
`jetUoAceSharp`):

- **Over the top at 550 m.** The pull goes `over` at `OVER_AT` real metres
  (`mem.overAt`), a loop while the air still turns the nose. Measured from the
  lesson's start: over at 650 m the F-16 cannot pull its nose over in the
  thin air and goes on up to 1,190 m; at 600, to 965 m; at 550 it loops, the
  top at 725 m.
- **Every other climb under the roof** (`underRoof`, `ROOF` 800 m, the same
  as under-the-height's ace), and a zoom the roof has levelled goes `over` as
  a turn back to them, level or nose down (`turnToward` capped by the roof),
  not a loop: a loop from level at the roof went up to 1,330 m.
- **Never hangs.** In `over`, `pounce` or `zoom`, slower than 45 m/s (the
  Spitfire's size, 58 real) and not diving, the nose goes 35 degrees down
  until the speed is back over 60.
- How it knows the ceiling for the airframe it is on: `paceOf` reads the pace
  the step context now carries (`c.pace`); see
  [under-the-height.md](under-the-height.md), "The ace that knows where the
  top is" and "The guard, and what the roof still does".
- **The guard is not enough on its own.** Every pilot on a jet now noses over
  at 880 m real (`guard`, read over the pace). Flown with the guard and no roof,
  this ace's zooms carry it to 1,440 to 1,640 m (1,016 m in one Dip start) and
  it comes down at 31 to 49 m/s: the guard only puts the nose on the horizon once past 880 m,
  and a loop is past it going straight up. The over-the-top height and the roof
  stay.

From every start of every demo, with the guard: the F-16's ace never goes above
877 m and never flies slower than 68 m/s after its first top; the MiG-29's never
above 989 m, never slower than 83 m/s.

## What the follower should do

Against the jet ace, nine starts each:

| follower | what happens |
|---|---|
| follow them up (`followStraightUp`, the lesson's `move`) | you keep your speed (never under 60 m/s), 38 to 53 m under them as they go over; they come straight back down past you, 78 to 86 m at the closest; nobody shot down, they land nothing, you 2 rounds at most |
| follow shallow at 25 degrees (`shallowFollow`, `counter`) | the shot as their nose comes up through 62 to 65 degrees, 387 to 426 m out, 4.8 to 5.7 s in: 6 to 12 hits in seven, none in two; then, climbing on at 25 degrees, you go up alone to 1,151 to 1,316 m (your guard levels you, but slowly at 25 degrees) |
| the old jet Dip: the shot, then straight on under them | 0 of 9: their loop brings them back down behind you at 400 m and they chase at your speed, firing (shot down in three) |
| the Spitfire's Dip (`uoDip`: follow at 30, pass, run) | 9 of 9 |
| the shot at 25, then past them as they come down, then away | 9 of 9: `jetUoDip` |

So the Dip is re-flown with its steps (`jetUoDip`, four phases): chase; when
their nose comes up, climb after them at 25 degrees on their bearing, never
into their climb, and take the shot as they pull (`dip-shot`); when they come
back over the top at you, or their nose has come down past 30 degrees, past
them, 80 m beside and 30 m under their dive (`dip-pass`); then full throttle
straight away from them, the nose 6 degrees down to level between 240 and 180 m
at the Spitfire's size (`dip-run`). `tests/test_dogfight_jets.py`
`JetStepsTests` holds the four phases, each timed.

## The nine starts, before and after (F-16)

`move` and `counter` from the harness's nine (`--text`: your x -30/0/+30 m
by speed -3/0/+3 m/s; hits theirs/yours). The moves from the school's own
nine (`dogfight-measure.js` `STARTS`, the L9 over x, z, height and speed),
scored with `scoreMove` and `movesOn` exactly as the theatre counts them.
"Before" is the jet file of 2026-11-10 against the Spitfire's ace.

| demo | before (the Spitfire's ace) | after (the jet ace) |
|---|---|---|
| move | 0/0 x7, 0/1 x2; the ace to 1,182 m | 0/2, 0/0, 0/2, 0/0, 0/0, 0/0, 0/0, 0/1, 0/2; nobody shot down; the ace over at 552 m, top 725 m at 8.9 s |
| counter | 0/12, 0/8, 0/8, 0/7, 0/7, 0/7, 0/6, 0/1, 0/1 | 0/12, 0/8, 0/8, 0/7, 0/7, 0/7, 1/6, 3/1, 0/1: the same shot; they hit you twice in the nine, 3 at 18.5 s (30 m right, as fast) and 1 at 41.5 s (30 m right, 3 m/s slower) |
| dip | `jetUoDip` (shot, then on under them): **9 of 9**; they top out at 1,180 m, let go at 20.7 s, 1.9 to 2.1 km at 35 s | the old `jetUoDip`: 0 of 9. The new one: **9 of 9**, never hit; the shot lands 0 to 10; you pass them at 8.7 s; they chase 6.0 to 7.3 s and let go 23.8 to 26.8 s; 2.3 to 2.9 km apart at 35 s, opening |
| flip | **0 of 9**: you slow to 54 m/s only at 17 to 22 s, 1,084 to 1,288 m up | **0 of 9**: following them up you top out at 755 to 786 m, never slow; the move's 54 m/s never comes, so it is never flown |
| ninja | **0 of 9**: no `ninja-shoot`; 3 hits in one | **0 of 9**: no `ninja-shoot`; you climb on alone at 24 degrees to 1,289 to 1,584 m and slow there to 22 to 37 m/s; you land nothing; hit in four, 1, 1, 11 and 2 times |

Claims, one by one:

- "Following them up gets nothing": **holds**, for the jet's reason: you do not
  hang, and they are over the top and back down before you are slow.
- "Following shallow gets the hits": **holds, about half**, as before: the
  shot is the pull, not the top; one burst, no kill, no second.
- "They hang slow at the top inside your guns": **false** on a jet, and still
  rewritten. The 2026-11-10 words ("they go on up to 1,180 m ... take 11 s to
  fall back") were the Spitfire ace's fall and are gone.
- Survival: **yes**, the new Dip 9 of 9.
- The coach's `over`, `pounce` and `zoom` lines say they come straight back
  down, and to go past them and away.

## On the MiG-29 (pace 1.5)

The same lesson. The ace climbs at 91 to 103 m/s, its nose to 52 degrees, goes
over at 551 m 3 s after the pull and tops out at 808 to 818 m 8.2 to 9.2 s in.
Following them up, nobody lands a round on anyone (you go on to 950 to 1,883 m).
Following shallow lands 9, 7, 9, 2, 6, 3, 3, 1, 1; they hit you once in one.
Dip 9 of 9, Flip 0, Ninja 0. The words' numbers are the F-16's.

## Open

- **The live fight** (FLY IT, `flyAce: 'jetUoAce'`) is fitted to a jet
  ([live-fight.md](live-fight.md)); nobody has flown this lesson in it by hand.
- **The Flip and the Ninja** are 0 of 9 and not re-tuned: both wait for a
  slow moment over the top that a jet never gives. A jet Ninja would be built
  on the pull's shot and the ace's descent.
- **The MiG-29's ace tops out at 989 m** in one Dip start, under the ceiling but
  close: its zoom carries more. Stretching the roof's lead time by the pace
  holds it to 905 m but drops the MiG-29's Dip to 4 of 9 and lets the F-16's ace
  hit you more following shallow, so it was not shipped.
- **Sensitivity.** The fights move with the ace's numbers: with `OVER_AT` 450 the
  old Dip worked 8 of 9 and following shallow landed 8, 7, 9, 2, 6, 2, 4, 1, 1;
  at 500 the old Dip failed in all nine. 550 keeps following shallow's shot as it
  was and is the highest the F-16's loop still comes round from.
