# The Immelmann and the split-S on a jet (`turnarounds`)

Status: **re-tuned, re-measured under the roof, and the aces' Immelmann
fitted to it** (2026-11-11, the roof as reworked in `868247883`).
`viewer/dogfight-lessons/jets/turnarounds.js` rewrites the words for the jet, moves
the split-S stage, and flies the lesson's two aces as jet copies
(`viewer/dogfight-lessons/jets/plan-turnarounds.js`, `jetTurnarounds` and
`jetTaAce`) that loop only from under 530 m real, where the loop tops out
under the roof on both jets, and turn round flat from higher. On the F-16
every demo and move is the same fight to the decimal as without them; on the
MiG-29 they make its Dip's ace actually turn round (below). Held by
`tests/test_dogfight_jet_turnarounds.py` (23 tests, about 55 s).

## What a turnaround costs the F-16

Real metres and m/s. The lesson's demos (the ace, nine starts each) and lone
turnarounds flown by the lesson's own `turnarounds` phases from a level start
(the test's `FLY`; level, full throttle, the move at 0.2 s).

| Move | From | Takes | Comes out | Spitfire, for comparison |
|---|---|---|---|---|
| Flat turn round, full pull | 96 m/s, 384 m | 3.0 s | 79 m/s, same height | about 5 s |
| Immelmann (the lesson's) | 95 m/s, 378 m | 4.8 s, 166 deg | +130 m at 83 m/s; slowest 69; 4 s on +109 m at 89 | 74 -> 37 m/s, +107 m |
| Immelmann, lone, 192 to 448 m | 60 to 97 m/s | 4.4 to 6.3 s | climbs 108 to 149 m, out at 73 to 86 m/s: from 60 m/s it comes out *faster* | |
| Immelmann, lone, 512 m (the jet ace) | 61 to 97 m/s | 5.4 to 6.7 s | climbs 157 to 168 m, tops out at 670 to 680 m, 176 to 179 deg round, out at 88 to 89 m/s | |
| Over 530 m, 576 to 745 m (the jet ace) | 61 to 98 m/s | 3.4 to 6.0 s | no loop: a flat turn round toward the other plane, ending -22 to +4 m from where it began, at 87 to 108 m/s | |
| Split-S (the lesson's, new stage) | 58 m/s, 589 m | 5.3 s, 180 deg | -163 m at 96 m/s | 51 -> 68 m/s, -145 m |
| Split-S, lone, 448 to 635 m, from cruise | 97 m/s | 4.5 to 4.8 s | -139 to -167 m at 91 to 101 m/s | |
| Split-S, lone, 384 m | 60 to 96 m/s | | the floor (`guard`) pulls it out 131 to 139 deg round | |
| Split-S, lone, 320 m / 256 m | | | 103 to 107 deg / 30 to 108 deg round | |

So: **the Immelmann is the jet's turn round after a pass**, as long as it
starts low (the lift dies linearly to 1000 m, `LIFT_CEILING`, and every jet
pilot keeps under 800 m, so the jet aces loop only from under 530 m and
turn round flat from higher); the jet's
engine out-pulls its weight, so it climbs and keeps its speed, and its loop
is tight (it ends 19 to 54 m *behind* where it pulled up). **The split-S is
for the moment a jet is slow and high**: it still trades height for speed
(163 m for 38 m/s), but from cruise it buys nothing, and it needs about
500 m under it.

### The ceiling guard (2026-11-11)

Commit `726b12eb6` reads every pilot's 880 m ceiling guard over the
airframe's pace, so on the F-16 it noses over at 880 m real, not 1,126.
It moved only the lone high Immelmanns: from 640 m the loop climbs 232 to
272 m in 6.9 to 8.2 s (was 232 to 264 m in 6.9 to 8.6 s); from 768 m the
guard takes the stick above 880 m but cannot bring a near-vertical jet's
nose down in that air, and the plan's own loop is no longer flown there, so
it goes 721 to 769 m up (was 522 to 562), slowest 31 to 39 m/s (was 19 to
24), and is 91 to 138 deg round at 14 s. The story now says "230 to 270 m,
7 to 8 seconds" and "more than 700 m straight up ... hangs there at 30 to
40 m/s, still not round 14 seconds later". Every demo and every move is
the same fight to the decimal except the Flip, whose nine starts end
further apart in three (1013 to 1494 m, was 147 to 415) with the same
verdict, 0 of 9, and the same quoted numbers; its harness demo's slowest
is now 19 to 67 m/s (was 29 to 67), which no words quote. No verdict
flipped: Dip 9, Flip 0, Ninja 0.

The roof (next section) supersedes the high-Immelmann numbers here: no lone
Immelmann climbs 230 to 270 m from 640 m or goes 700 m straight up any more,
and the story no longer says so.

## Under the roof (2026-11-11)

Every jet pilot flies under a roof at 800 m real (`dogfight-jet-ceiling.js`
`underRoof`, from `stepPilot`), and paced start heights are bent over from
600 m toward 760 (`pacedHeight`, `8d616bcc2`). As reworked in `868247883`
the roof no longer flies the nose itself: it caps how hard the plan may
pull toward the sky in the plane's own pitch plane, less the pitch rate
already under way, and leaves roll, rudder and trigger to the plan. A pull
taking the plane over a loop whose top it predicts under 800 m (speed over
pitch rate, times 1.3) is left alone; an inverted plane may pull through;
the throttle comes off while the nose is more than 15 deg over the allowed
climb. `PLANS.turnarounds` does not answer `roof: false`. What it does
here, F-16:

- **The lesson's own Immelmanns are untouched.** They start at 352 to
  378 m and top out at 479 to 535 m; the follow-up, the counter, the Dip
  and the Flip's Immelmann are the same to the decimal (130 m, 4.8 s,
  slowest 69 m/s; Dip 9 of 9 with every quoted number unchanged).
- **A lone Immelmann started high is not flown.** From 192 to 448 m it is
  as it was (4.4 to 6.3 s, +108 to +149 m). From 512 m it still goes over
  from 61 or 79 m/s (6.2 to 6.7 s, +155 to +165 m, 178 to 179 deg round),
  but from 97 m/s the cap holds the pull back from the start (trace below)
  and the loop never begins: the nose comes up to 41 to 42 deg at 2 to
  2.5 s, then is let down, and they climb straight ahead to 768 m and fly
  on level at 125 m/s. From 576, 635, 704 and 745 m (the highest a paced
  start gets now: 768 at the Spitfire's size is 745 m real since
  `4a526cfea`) every one does the same, levelled at 768 or 769 m, 0 or 1
  deg off their heading at 14 s. The jet aces (next section) fly these
  instead, and the story quotes them.
- **The first roof** (`8d616bcc2` as it was) pushed the same loops over
  instead: from 512 m they rolled out 266 to 290 m up only 92 to 122 deg
  round, and from 576 m up the loop was flattened at 816 to 831 m. Before
  any roof, from 640 m the loop climbed 230 to 270 m, and from 768 m it went
  700 m straight up.
- **The split-S stage's you is lower.** Its 600 m start is 704 m real, not
  768: 115 m over them, not 180. The Ninja's dive starts 237 to 298 m from
  them (was 267 to 309) and closes to 145 to 227 m (was 215 to 272);
  still 0 of 9, and diving sooner (wings past 30 to 150 deg rolled) is
  still shot down in nine of nine.
- **The Flip** no longer goes to 1,848 m: its turning fight tops out at
  780 m (838 under the first roof) and ends 124 to 357 m apart (was 1,013
  to 1,494 in three before any roof). Its quoted numbers and its 0 of 9 are
  unchanged.

No F-16 verdict flipped (Dip 9, Flip 0, Ninja 0) and `survival` stays
"yes". The highest anyone goes in any demo or move is 780 m.

The rest of this section is the lesson's plans as the shared roof flies
them; the next section is what the jet aces do instead.

The trace of the uncapped loop that never starts (F-16, 512 m, 97 m/s,
the lesson's own phases, `taJetSolo`): at 1 s pitch 7 deg, 1.5 s 27, 2 s
41, 2.5 s 42 at 586 m and 92 m/s, then 38, 32, 26 ... 0 deg by 9.5 s, the
phase `immelmann` throughout, heading unchanged, 768 m at 13 s, 125 m/s at
14 s. Slower, the same height goes over: the loop's top is predicted from
the speed over the pitch rate under way, so at the start of a pull, before
an airframe with a 0.83 s pitch lag has built its rate, a fast loop's top
reads high, the cap keeps the rate from building, and the prediction never
comes down.

## The jet aces' Immelmann (2026-11-11)

The shared roof's loop rule cannot start a fast loop (above), and it is not
changed again: every lesson was re-measured on it twice. So this lesson's
aces say for themselves whether their loop fits. `jetTurnarounds` (the
demos' ace) and `jetTaAce` (the Dip's, Flip's and Ninja's, and FLY IT's)
are `turnarounds` and `taAce` with one change: when the plan starts an
Immelmann, the height decides.

- **Pulled up under `LOOP_UNDER`, 530 m real**, the half loop and the roll
  out on top (`immelmann`, `rollout`) answer `roof: false`, and the roof
  leaves them alone.
- **Higher**, the loop is not started. The plan's own alternative, the
  split-S, needs them slow (under 52 m/s at the Spitfire's size), and a
  pilot fast enough to Immelmann never is, so they turn round flat instead
  (`turn`: `hardTurn` toward the other plane, full throttle, until the nose
  is within 30 deg of them or the heading has come round 170 deg), then go
  back at them (`attack`).

**The cut-off, measured.** The lesson's Immelmann flown with no roof from a
level start at full throttle, from 61 to 105 m/s on the F-16 and 70 to
123 m/s on the MiG-29 (the slowest entry tops out highest):

| From | F-16 top | MiG-29 top |
|---|---|---|
| 525 m | 685 to 698 m | 752 to 777 m |
| 540 m | 706 to 720 m | 776 to 805 m |
| 589 m | 776 to 796 m | |
| 614 m | 817 to 842 m | |

The F-16 alone could loop from up to about 590 m; the MiG-29 goes over
800 m from 540 m at 70 m/s. One height for both jets is under 540: 530 m,
with every loop from 525 m under 800 m on both. The test holds the 525 and
540 m rows.

**What it changes.**

- **F-16:** nothing in the lesson. Its Immelmanns start at 352 to 378 m;
  every demo and every move over the nine starts is the same fight to the
  decimal as with the shared plans (compared field by field). A lone
  Immelmann from 512 m now goes over from every entry speed (5.4 to 6.7 s,
  +157 to +168 m, top 670 to 680 m, 176 to 179 deg round), where the
  shared roof held the 97 m/s one straight ahead; from 576 to 745 m they
  turn round flat in 3.4 to 6.0 s, ending -22 to +4 m from where they
  began. The story says so: "they only loop from under 530 m ... From 510 m
  the loop is round in 5 to 7 seconds and tops out at 670 to 680 m. From
  higher they do not start one: they turn round flat instead".
- **MiG-29:** the Dip's and the Flip's ace, from 455 to 456 m at 119 m/s,
  now loops: +195 m in 5.1 s, slowest 90 m/s, 170 deg round. The Dip is a
  real 9 of 9: they roll out 388 to 510 m from you at 8.7 to 9.2 s, chase,
  let you go at 755 to 801 m at 17.3 to 18.1 s, and you are 3,502 to
  3,719 m apart at 32 s, never fired at. Flip 0, Ninja 0.
- **No ace ends a fight in a loop.** In every start of every demo and move
  on both jets the ace's last phase is none of `immelmann`, `rollout`,
  `turn`, `split` or `pullthrough`, and every Immelmann begun reaches `top`.
- **Tops:** 780 m on the F-16 (the Flip's turning fight), 782 m on the
  MiG-29 (the same).

## What the nine F-16 flights showed, before and after

Nine starts: the harness's (you x -30/0/+30 m by speed -3/0/+3) for the
demos; the school's `STARTS` (L9) for the Dip, Flip and Ninja, scored with
`scoreMove` exactly as `movesOn` does (the demo's `seconds`, `groundAt` 0).
Hits are "ace/you", rounds each side landed.

| Demo | As written (before) | Jet file (after) | Claim |
|---|---|---|---|
| `immelmann` follow them up | nobody down, 0/0 to 0/3; your slowest 66-68, landing fire 0-0.1 s, closest 50-54 m | same fight | Spitfire's "you hang under their top" is false: **rewritten** (you keep your speed, still no shot) |
| `immelmann-counter` meet the top | nobody down, 0/0 to 0/5; landing fire 0.2-0.7 s, closest 23-43 m, they fire nothing | same fight; tab "You meet them coming back" | "shoot as they hang there" is false (slowest 69 m/s; `turnaroundsMeetTop`'s `shoot` needs them under 45 Spitfire units and never opens): **rewritten** as a head-on snap |
| `split` let them go | **no split-S at all**: the ace is at 105 m/s by 650 m and Immelmanns at 5.2-5.3 s; 0/0 | ace staged 120 m closer (`[40, 460, -640]`): split-S in all nine at 0.0-0.4 s, -163 m, 58 -> 96 m/s, 5.3 s; 0/0, nobody fires | **tuned** to hold (a): the split-S is real for a slow jet, the stage just has to catch it slow |
| `dip` | 9 of 9 | 9 of 9 (same fight): roll out 277-342 m from you, chase from 257-263, let go at 634-704 m at 17.5-17.9 s, 2937-3081 m apart at 32 s, never fired | holds; verdict line in jet numbers |
| `flip` | 0 of 9 | 0 of 9 (same fight): round at 9.7-10.2 s, 114-193 m from them, under their roll-out not their tail; they break or turn on you within 3.5 s; landing fire 0-0.1 s; 0-2 hits either way to 45 s | **rewritten** note and verdict |
| `ninja` | 0 of 9, and no split-S (the Dip every time) | 0 of 9 at the split stage: dive at 3.5-3.7 s from 237-298 m (267-309 before the roof), off them 1.5 s later, closest 145-227 m (215-272), nobody fires | **rewritten**: the one-dive ambush does not work on a jet |

`survival` stays "yes", on the Dip alone.

### What was tried on the Ninja and the counter (not shipped)

- **The Ninja, from the lesson's stage with you further back** (you at z
  150 to 600): the range the ace splits at is 650 (Spitfire units) from
  *you*, so further back he is fast by then and Immelmanns: 0 of 9 each.
- **The Ninja holding its speed while it waits** (`holdSpeed` 45, 52, 60,
  units, the shipped stage): 0 of 9 each; at 45 you are shot down in two and hit 11 to 35
  times in six, at 52 shot down in one.
- **The Ninja diving sooner**, once their wings are past 30, 60, 90, 120 or
  150 deg rolled: 0 of 9 each, and you are hit 34 to 57 times (shot down in
  all nine): you arrive in front of them as they come out. Waiting for the
  nose to be 25 deg down (the lesson's) is 0 of 9 with nobody hit. Why: the
  jet's split-S pulls through in about 2 s once the nose is down, and the
  jet's nose lags 0.83 s (`pitchLag`), so the dive either arrives after
  them or in front of them.
- **Meet-the-top with no speed gate on the shot** (`shoot` once in range
  and the nose within 25 deg): worse, 0 to 1 hit, because it leaves `aim`
  for `extend` sooner.

## The MiG-29 (pace 1.5), the same jet file

Under the roof (2026-11-11): the first roof (`8d616bcc2`), the roof as
reworked (`868247883`), and the jet aces on it.

| Demo | MiG-29 before the roof | first roof | reworked roof, shared plans | jet aces |
|---|---|---|---|---|
| `immelmann` | from 114 m/s at 414 m: +184 m, out at 94; 0/0 to 0/1 | +234 m, out at 91, 6.2 s, 151 deg round | +183 m, out at 94, 168 deg | +184 m, out at 94, 168 deg; nobody down |
| `immelmann-counter` | +194 m at 96; 0/5 to 0/16 | flattened, +336 m, 9.4 s | +190 m, 172 deg; 0/4 to 0/13 | +194 m, 5.2 s, 170 deg; you land 5 to 16; nobody down |
| `split` | from 690 m at 69 m/s: -233 m, out at 118 | from 669 m at 68 m/s: -226 m, out at 117 | the same | the same |
| `dip` / `flip` / `ninja` | 9 / 0 / 0 | 0 / 0 / 0 | 9 / 0 / 0, the ace never turning round | **9** / 0 / 0, the ace looping |

Under the reworked roof with the shared plans, the Dip's 9 of 9 came from
an ace that never turned round: its Immelmann from 456 m at 119 m/s was
capped before it began, and it climbed 323 to 329 m straight ahead and was
still in `immelmann` 26 s later (`--trace dip --plane Mig29 --start 4`:
457 m and 119 m/s at 5.5 s, 767 m at 14 s, 775 to 780 m to the end, the
separation opening from 186 m to 2,218). With the jet aces it loops (above).
A lone MiG Immelmann goes over from 225 to 525 m (top 777 m at most) and
turns round flat from 600 m up (3.5 to 6.6 s). The highest anyone goes on
the MiG-29 is 782 m.

As written (no jet file) the MiG-29's `split` demo shows the high
Immelmann's failure for real: too fast to split-S, the ace pulls up at 670 m
and 124 m/s, goes 763 m straight up to 1433 m and hangs there at 8 m/s
(nine of nine). The words quote the F-16's numbers.

## Open

- **Shared: `turnaroundsMeetTop`** (`dogfight-pilot.js`) gates its `shoot`
  phase on `g.hisSpeed < 45`; a jet's Immelmann never goes under 54
  Spitfire units (69 m/s), so on a jet that phase never opens. The fire in
  the counter is what `aim` gets on the way. Not changed: the counter on a
  jet is a head-on pass whichever phase fires.
- **The harness** now scores the moves over `STARTS` (`--moves`,
  `jet_school.jet_moves`, `807800fbc`). The ace's turnaround and the lone
  turnarounds are still flown by the test's inline module (`FLY`).
- **Shared: the split-S decision** (`PLANS.turnarounds` `pass`) is a speed
  gate at the moment the range falls under 650: any airframe that
  accelerates quickly from a slow start passes the gate before the range.
  The jet file moves the stage; FLY IT and the free fight still meet it.
- **The Ninja on a jet** has no working answer here (above). A dive started
  from further back and lower, with the lead on where they come out, is
  untried.
- **FLY IT** is fitted to a jet ([live-fight.md](live-fight.md)) and reads
  this file, the split-S demo's nearer start with it; nobody has flown this
  lesson in it by hand.
- **Shared: the roof's loop prediction at the start of a pull.** The
  reworked roof leaves a loop alone when its predicted top (speed over the
  pitch rate under way, times 1.3) is under 800 m, but at the start of a
  pull the rate has not built yet, so a fast loop's top reads high and the
  cap stops the rate from ever building. This lesson's jet aces step round
  it (`roof: false` under 530 m); any other plan that loops on a jet meets
  it as it is. Not changed: shared.
- **One cut-off for two jets.** 530 m is the MiG-29's limit; the F-16
  alone could loop from about 590 m. A cut-off read from the airframe (its
  pace, or a loop's measured top) would let the F-16 loop higher; no
  lesson start is between 530 and 590 m, so it is not done.
- **Heights.** The lesson's Immelmanns start at 352 to 378 m and the
  split-S at 589 m on the F-16; on the MiG-29 the Immelmanns start at 414
  to 456 m and the split-S at 669 m. Every Immelmann start is under the
  530 m cut-off, so no lesson fight shows the flat turn round; only FLY IT
  and the lone flights reach it.
