# The Immelmann and the split-S on a jet (`turnarounds`)

Status: **re-tuned** (2026-11-11). `viewer/dogfight-jet-turnarounds.js`
rewrites the words for the jet and moves the split-S stage; no plan of its
own (`viewer/dogfight-jet-plan-turnarounds.js` stays `export {};`). Held by
`tests/test_dogfight_jet_turnarounds.py` (15 tests, about 15 s).

## What a turnaround costs the F-16

Real metres and m/s. The lesson's demos (the ace, nine starts each) and lone
turnarounds flown by the lesson's own `turnarounds` phases from a level start
(the test's `FLY`; level, full throttle, the move at 0.2 s).

| Move | From | Takes | Comes out | Spitfire, for comparison |
|---|---|---|---|---|
| Flat turn round, full pull | 96 m/s, 384 m | 3.0 s | 79 m/s, same height | about 5 s |
| Immelmann (the lesson's) | 95 m/s, 378 m | 4.8 s, 166 deg | +130 m at 83 m/s; slowest 69; 4 s on +109 m at 89 | 74 -> 37 m/s, +107 m |
| Immelmann, lone, 192 to 576 m | 60 to 97 m/s | 4.4 to 7.3 s | +63 to +172 m at 73 to 94 m/s: from 60 m/s it comes out *faster* | |
| Immelmann, lone, 640 m | 61 to 97 m/s | 6.9 to 8.2 s | climbs 232 to 272 m | |
| Immelmann, lone, 768 m | 62 or 98 m/s | never round | 721 to 769 m straight up, slowest 31 to 39 m/s, 91 to 138 deg round at 14 s | |
| Split-S (the lesson's, new stage) | 58 m/s, 589 m | 5.3 s, 180 deg | -163 m at 96 m/s | 51 -> 68 m/s, -145 m |
| Split-S, lone, 448 to 640 m, from cruise | 97 m/s | 4.5 to 4.8 s | -139 to -168 m at 91 to 101 m/s | |
| Split-S, lone, 384 m | 60 to 96 m/s | | the floor (`guard`) pulls it out 131 to 139 deg round | |
| Split-S, lone, 320 m / 256 m | | | 103 to 107 deg / 30 to 108 deg round | |

So: **the Immelmann is the jet's turn round after a pass**, as long as it
starts low (the lift dies linearly to 1000 m, `LIFT_CEILING`); the jet's
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
| `flip` | 0 of 9 | 0 of 9 (same fight): round at 9.7-10.2 s, 114-193 m from them, under their roll-out not their tail; they break or turn on you within 3.3 s; landing fire 0-0.1 s; 0-2 hits either way to 45 s | **rewritten** note and verdict |
| `ninja` | 0 of 9, and no split-S (the Dip every time) | 0 of 9 at the split stage: dive at 3.5-3.7 s from 267-309 m, off them 1.5 s later, closest 215-272 m, nobody fires | **rewritten**: the one-dive ambush does not work on a jet |

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

| Demo | MiG-29 |
|---|---|
| `immelmann` | Immelmann from 114 m/s at 414 m: +184 m, out at 94; nobody down, 0/0 to 0/1 |
| `immelmann-counter` | from 112 m/s, +194 m at 96; landing fire 0.1-1.3 s, 0/5 to 0/16, nobody down: the head-on snap lands more on the MiG |
| `split` | split-S from 690 m at 69 m/s: -233 m, out at 118, 5.8 s; nobody fires |
| `dip` / `flip` / `ninja` | 9 / 0 / 0 of 9 (unchanged by the ceiling guard; the lone Immelmanns from 750 m now go 908 to 1,107 m up, slowest 60 to 62 m/s, where they went 563 to 674 m) |

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
- **Heights.** The lesson's Immelmanns start at 352 to 378 m and the
  split-S at 589 m, all inside the band where each completes on the F-16;
  on the MiG-29 the split-S starts at 690 m.
