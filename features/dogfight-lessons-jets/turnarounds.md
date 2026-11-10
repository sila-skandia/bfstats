# The Immelmann and the split-S on a jet (`turnarounds`)

Status: **re-tuned, re-measured under the roof** (2026-11-11).
`viewer/dogfight-jet-turnarounds.js` rewrites the words for the jet and
moves the split-S stage; no plan of its own
(`viewer/dogfight-jet-plan-turnarounds.js` stays `export {};`). On the F-16
the roof changes none of the lesson's own fights' quoted numbers but the
Ninja's ranges and the split-S stage's height gap; it does change what a
lone Immelmann does above 450 m, and the story now says so. On the MiG-29
the roof flattens the lesson's Immelmann and the Dip fails there (below).
Held by `tests/test_dogfight_jet_turnarounds.py` (20 tests, about 75 s).

## What a turnaround costs the F-16

Real metres and m/s. The lesson's demos (the ace, nine starts each) and lone
turnarounds flown by the lesson's own `turnarounds` phases from a level start
(the test's `FLY`; level, full throttle, the move at 0.2 s).

| Move | From | Takes | Comes out | Spitfire, for comparison |
|---|---|---|---|---|
| Flat turn round, full pull | 96 m/s, 384 m | 3.0 s | 79 m/s, same height | about 5 s |
| Immelmann (the lesson's) | 95 m/s, 378 m | 4.8 s, 166 deg | +130 m at 83 m/s; slowest 69; 4 s on +109 m at 89 | 74 -> 37 m/s, +107 m |
| Immelmann, lone, 192 to 448 m | 60 to 97 m/s | 4.4 to 6.3 s | climbs 108 to 149 m, out at 73 to 86 m/s: from 60 m/s it comes out *faster* | |
| Immelmann, lone, 512 m | 61 to 97 m/s | 8.9 to 10.1 s | the roof levels the climb before the top: rolls out 266 to 290 m up, only 92 to 122 deg round | |
| Immelmann, lone, 576 to 768 m | 61 to 98 m/s | never round | the loop is flattened at 816 to 831 m and still not round at 14 s | |
| Split-S (the lesson's, new stage) | 58 m/s, 589 m | 5.3 s, 180 deg | -163 m at 96 m/s | 51 -> 68 m/s, -145 m |
| Split-S, lone, 448 to 635 m, from cruise | 97 m/s | 4.5 to 4.8 s | -139 to -167 m at 91 to 101 m/s | |
| Split-S, lone, 384 m | 60 to 96 m/s | | the floor (`guard`) pulls it out 131 to 139 deg round | |
| Split-S, lone, 320 m / 256 m | | | 103 to 107 deg / 30 to 108 deg round | |

So: **the Immelmann is the jet's turn round after a pass**, as long as it
starts low (the lift dies linearly to 1000 m, `LIFT_CEILING`, and every jet
pilot levels off by 800 m, so on the F-16 a loop started over about 450 m
is flattened before the top); the jet's
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

Commit `8d616bcc2` keeps every jet pilot's answer under 800 m real
(`dogfight-jet-ceiling.js` `underRoof`, from `stepPilot`; a plan going over
the top of a loop can answer `roof: false`, and `PLANS.turnarounds` does
not), and bends paced start heights over from 600 m toward 760
(`pacedHeight`). What it moved here, F-16:

- **The lesson's own Immelmanns are untouched.** They start at 352 to
  378 m and top out at 479 to 535 m; the follow-up, the counter, the Dip
  and the Flip's Immelmann are the same to the decimal (130 m, 4.8 s,
  slowest 69 m/s; Dip 9 of 9 with every quoted number unchanged).
- **A lone Immelmann started high is pushed off its loop.** It used to
  climb 230 to 270 m from 640 m and go 700 m straight up from 768. Now
  from 512 m the roof levels the climb before the top (rolled out 266 to
  290 m up after 8.9 to 10.1 s, only 92 to 122 deg round), and from 576 m
  up the loop is flattened at 816 to 831 m and never round in 14 s. The
  plan file's starts at 500 and 600 (Spitfire size) are now 635 and 704 m
  real, not 640 and 768. Answering `roof: false` through the loop (a
  scratch run, not shipped: the plan is shared) completes it from 512 m
  (+157 to +168 m, 5.4 to 6.7 s) and 576 m (+183 to +199), but from 635 m
  it tops out at 863 to 892 m, over the 860 the school holds, and from
  677 m up it goes 350 to 770 m straight up again. The story now says
  "from 510 m ... only 92 to 122 degrees round" and "from 580 m up they
  never go over the top at all".
- **The split-S stage's you is lower.** Its 600 m start is 704 m real, not
  768: 115 m over them, not 180. The Ninja's dive starts 237 to 298 m from
  them (was 267 to 309) and closes to 148 to 227 m (was 215 to 272);
  still 0 of 9, and diving sooner (wings past 30 to 150 deg rolled) is
  still shot down in nine of nine.
- **The Flip** no longer goes to 1,848 m: its turning fight tops out at
  838 m and ends 124 to 470 m apart (was 1,013 to 1,494 in three). Its
  quoted numbers and its 0 of 9 are unchanged.

No F-16 verdict flipped (Dip 9, Flip 0, Ninja 0) and `survival` stays
"yes". The highest anyone goes in any demo or move is 838 m.

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
| `ninja` | 0 of 9, and no split-S (the Dip every time) | 0 of 9 at the split stage: dive at 3.5-3.7 s from 237-298 m (267-309 before the roof), off them 1.5 s later, closest 148-227 m (215-272), nobody fires | **rewritten**: the one-dive ambush does not work on a jet |

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

Under the roof (2026-11-11):

| Demo | MiG-29 (before the roof) | MiG-29 under the roof |
|---|---|---|
| `immelmann` | Immelmann from 114 m/s at 414 m: +184 m, out at 94; nobody down, 0/0 to 0/1 | +234 m, out at 91, 6.2 s, only 151 deg round; nobody down, 0/0 to 5/1 |
| `immelmann-counter` | from 112 m/s, +194 m at 96; landing fire 0.1-1.3 s, 0/5 to 0/16, nobody down | from 444 m: the roof flattens the loop, +336 m, 9.4 s, slowest 32 m/s, 118 deg round; landing fire 0.1-0.3 s, 0/0 to 0/2, nobody down |
| `split` | split-S from 690 m at 69 m/s: -233 m, out at 118, 5.8 s; nobody fires | from 669 m at 68 m/s: -226 m, out at 117, 5.8 s; nobody fires |
| `dip` / `flip` / `ninja` | 9 / 0 / 0 of 9 | **0** / 0 / 0 of 9 |

**The MiG-29's Dip fails under the roof.** Its Immelmann starts at 455 to
456 m real, and the roof flattens it: the trace (`--trace dip --plane Mig29
--start 4`) has the ace pull up at 457 m and 119 m/s at 5.5 s and, held
under the roof, climb on in a slowing half loop to 791 m at 42 m/s 13 s in,
roll out at 793 m only 117 deg round, then dive 300 m of height into speed
(141 m/s against your 122) and close from 957 m to 507 m, firing from 29 s.
Over the nine `STARTS`: 337 to 338 m up in 9.1 s, slowest 41 m/s; 1 to 5
hits on you in seven of nine, 459 to 544 m apart at 32 s, never gone. A
lone loop flown the same way from 450 m (Spitfire size 300) shows the push:
the nose reaches 79 deg at 2.5 s and is brought back to 36 deg by 6 s
while the plane slows from 113 to 38 m/s. A lone MiG
Immelmann completes under the roof up to 376 m real and not from 450 m in
two of three; with `roof: false` through the loop it completes cleanly from
451 m (+195 to +209 m, 5.2 to 6.8 s, top 646 to 659 m) and from 525 m (top
754 to 777 m), and from 600 m it goes over 900 m. The tests hold these; the
words quote the F-16's. The highest anyone goes on the MiG-29 is 851 m.

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
- **Shared: the harness** prints only each fight's end. The ace's
  turnaround, the moves' `scoreMove` over `STARTS`, and the lone
  turnarounds are flown by an inline module in the test file (`FLY`). A
  `--moves` (`movesOn` with each start's score) and a per-side turnaround
  summary in `dogfight_jet_harness.mjs` would let the next lesson skip that.
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
- **Shared: the Immelmann under the roof.** `PLANS.turnarounds`'
  `immelmann` and `rollout` phases do not answer `roof: false`, so a loop
  started over about 450 m on the F-16 and 400 m on the MiG-29 is
  flattened before the top. On the F-16 no lesson start is there; on the
  MiG-29 the lesson's own Immelmanns (414 to 456 m) are, and its Dip goes
  from 9 of 9 to 0. Answering `roof: false` while the loop is under way and
  it started under about 520 m real would complete every loop that tops
  out under 800 m (F-16 from 576 m: top 759 to 775; MiG-29 from 525 m: 754
  to 777) and leave the higher ones to the roof. Not changed here: the plan
  is shared. A jet plan of this lesson's own wrapping it would do the same
  for this lesson only.
- **Heights.** The lesson's Immelmanns start at 352 to 378 m and the
  split-S at 589 m on the F-16, all inside the band where each completes
  under the roof; on the MiG-29 the Immelmanns start at 414 to 456 m, in
  the band where the roof flattens them, and the split-S at 669 m.
