# On their tail, on a jet

Status: **re-tuned on the F-16** (2026-11-10), **re-measured under the roof**
(2026-11-11). The lesson's first claim holds (rushing in is nobody's kill).
Its way out does not: on a jet, leaving their circle the Spitfire's way gets
you shot down from all nine starts, so the Dip now flies the jet's way out
(never go in), and the words say why. The Flip and the Ninja get no shot on
a jet either, and say so. Nobody in any demo or move goes over 836 m on the
F-16 (852 m on the MiG-29).

**2026-11-11, the ceiling guard.** Every pilot noses over above 880 m; on a
jet that guard waited for 1,126 m real until commit `726b12eb6` read the
880 m over the airframe's pace. Re-flown with it in, only the Ninja moved
(below): the rush, the Dip, the old exit and the Flip are the same fights to
the metre, and every verdict holds (the Dip 9 of 9, Flip and Ninja 0 of 9).

Files: `viewer/dogfight-jet-on-his-tail.js` (the words, the Dip's seat, the
verdicts, survival, coach), `viewer/dogfight-jet-plan-on-his-tail.js`
(`jetOtLeave`), `tests/test_dogfight_jet_on_his_tail.py` (every number the
words give).

## What a jet changes here

- **The gun's reach.** A jet's own cannon (`ownGun`) is one barrel on the
  nose, `converge: 0`, so `gunOf` gives it no crossing point and its pilot's
  range is the cap, 400 m at the Spitfire's size: 512 m real on the F-16,
  where the Spitfire's wing guns open at 268. On the harness the rusher's
  first round goes at 527 to 532 m. Everything in this lesson keyed on the
  guns' reach moves out with it: `breakTurn` breaks at the reach + 30
  (436 to 543 m real, the Spitfire's 284 to 298), `otBreaker` chases and
  gives up by it.
- **The circle.** The F-16 breaking at 75 m/s turns 68 to 70 degrees a
  second round a circle 123 to 127 m across (the Spitfire 39 a second, about
  120 m). A faster jet still turns faster, not wider.
- **The vertical.** A jet does not run out of speed climbing, so the breaker
  climbs after you (or away to take the height back) as well as you climb.

## The fights, before and after (F-16, nine starts)

Lines are the jet harness's nine starts (x -30/0/+30 by speed -3/0/+3:
`node tests/dogfight_jet_harness.mjs on-his-tail --text`, `-` nobody down,
`ACE@t` you shot down, hits ace/you). Verdicts are the measure's nine
(`dogfight-measure.js` STARTS, the L9 array over x, along, height and speed),
each fight scored with `scoreMove` exactly as the theatre's `movesOn` scores
a lesson on the airframe on stage.

| Demo | As written (`--base`) | Re-tuned |
|---|---|---|
| `move` You rush in | `- 0/2 - 0/2 - 0/2 - 0/1 - 0/0 - 0/0 - 0/3 - 0/1 - 0/0` | unchanged fight, words rewritten |
| `dip` | `otDip`, leave across their circle: `ACE@30-32 22/0-2` in all nine; L9 0 of 9, shot down in all nine | `jetOtLeave`: `- 0/0` in all nine; L9 **9 of 9** |
| `flip` high yo-yo | `- 0/0-2` in all nine; L9 0 of 9 | unchanged fight, jet verdict 0 of 9 |
| `ninja` climb beside | `- 0/0` in all nine; L9 0 of 9 | unchanged plan, jet verdict 0 of 9, label and note rewritten. Under the roof (2026-11-11): `- 0/0` in all nine, tops 805 to 836 m; L9 0 of 9 |

### You rush in (claim held, numbers rewritten)

They break 436 to 543 m out (the three slower starts later and nearer,
7.3-7.5 s; the rest at 3.3-3.8 s). Your burst opens at 527-532 m and lands 0
to 3 rounds (at 178 to 507 m), all between 2.2 s before the break and 4 s
after it. You come past their tail 49 to 60 m from them 3.8-5.3 s into the
break and then sit 104 to 110 m behind them, your nose 51 to 53 degrees off
them, for the rest of the minute: neither side ever has a shot that would
land there. Nobody comes down in any of the nine.

Tried in the rusher's seat against the same break, nine starts each, to see
what staying on a jet's tail takes: `hunter`, `otOutWide`, `lagBack`,
`patientAttacker`, `otYoyo`, `otNinja` and `chaser` against `otAce`. None
shot anyone down; the most any landed was 3 rounds. Staying on a jet's tail
in its break is possible (you are never thrown out in front) and useless: no
lead follows a 68-degree-a-second turn.

### The Dip (claim false on a jet; the jet's way out flown instead)

As written (`otDip`): round their circle after them, then out when they are
across it going away. On the F-16 they come round in behind you 73 to 353 m
back at the closest (the steady chase sits at about 310 m, both at 104-105
m/s), well inside 512 m, and shoot you down 13 to 16 s after you leave, all
nine (L9). Variants of the same exit, all 0 of 9 or worse: diving out at 15
degrees (shot down in nine), at 30 (not shot down, 4 to 13 rounds taken in
each), leaving 4 s after the break (shot down in nine).

The jet's way out (`jetOtLeave`, the decision (b) plus (a)): `otDip`'s run-in
(at their speed plus a little, so 15 to 18 m/s faster than them as they
break) and, at their break, straight on: wings level, full throttle, nose 6
degrees down to 140 m. You pass them 80 to 91 m off while they turn into you
(75 to 97 m on the L9), they are never round in time, never chase (their
phases are watch, break, chop), and at 40 s you are 2603 to 3193 m apart and
opening, never hit, their guns never on you. L9: 9 of 9.

Sensitivity, L9: leaving 1 or 2 s after the break 9 and 7 of 9, 4 s after it
0 of 9; nose 0 or 3 degrees down 9 of 9, 10 degrees down 5 of 9; running
opposite their heading instead of straight on 1 of 9.

Why the breaker never chases: `otBreaker` turns onto a man in front of it
only inside 400 m at the Spitfire's size (512 real), and by the time its
break has brought its nose round you are past that and 25 m/s faster. That
is `otBreaker` as written for every airframe, not something tuned here.

### The Flip (holds: 0 of 9)

From the pull-up on you are never hit and your guns never have them; in
their rear quarter with your nose on them 1.33 s at most (the measure asks
2 s). The 0 to 2 rounds you land come in their circle before it, at 242 to
260 m. Unlike the Spitfire you keep your speed over the top (80 to 83 m/s at
the end), but you get no higher than them in any of the nine.

### The Ninja (claim false on a jet: 0 of 9)

On the Spitfire the climb beside their break gave one pass from above (3 of
9 kills). On the F-16 they come up too (`otAce`'s climb, or turning after
you), and under the roof both level off between 805 and 836 m, fast (you
125 m/s at the end of the default start), with nobody in a place to shoot:
`- 0/0` in all nine. Up there they come round onto your tail (in the default
start 350 m back at 12 s, closing to 208 m by 48 s at your speed, their nose
about 18 degrees off you), never with a shot that would land. L9: no kill, 2 rounds landed (in one), 0.17 s of
landing shot; their shot never, no round on you, on your tail for 13 to 38 s
in 7 of 9.

Tried and dropped before the roof (L9, 0 of 9 each): leaving at the break
for 6 to 12 s, flat or climbing 10 to 20 degrees, then `ascend` or `otNinja`
back onto them.

### Survival

Yes (the Dip works): never go in. The words say that leaving once you are in
is fatal and that nothing gets you on top.

## The MiG-29 (pace 1.5)

The same file: the rush 0 to 5 rounds, nobody down; the old exit shot down
from all nine; `jetOtLeave` 7 of 9 on the L9 (the two it loses, they chase
and shoot you down 18 s after the break). Flip and Ninja 0 of 9. The words
are the F-16's. Under the roof (2026-11-11) all of that holds; the Ninja
tops 852 m (was 887 to 1,995 m with the guard alone), nobody hit in the nine
starts, still 0 of 9. The highest anyone goes in any demo or move is 852 m.

## Under the roof (2026-11-11)

Commit `8d616bcc2` puts every jet pilot's plan through `underRoof`
(`dogfight-jet-ceiling.js`, from `dogfight-pilot.js` `stepPilot`): the climb
is levelled off by 800 m real. This lesson's starts are all under 600 m real,
so `pacedHeight` leaves them where they were.

What moved, F-16, nine starts (`--tops`):

| Demo | Highest, ace / you, before | Under the roof |
|---|---|---|
| `move` | 504 / 490 m | unchanged |
| `dip` | 739 / 410 m | unchanged |
| `flip` | 640 / 598 m | unchanged |
| `ninja` | 1,688 / 1,574 m; `- 0/0` in eight, `- 2/0` in one | 833 / 836 m; `- 0/0` in all nine |

The rush, the Dip, the old exit and the Flip are the same fights to the
metre, and their verdicts hold (the Dip 9 of 9, the Flip 0 of 9). Only the
Ninja moved, and its count did not: 0 of 9, as before. What changed in it is
the shape: instead of both going on up through the top of the sky, slow, the
two level off under the roof and the breaker sits on your tail, fast,
without a shot (before: their shot 0.23 s at most, 1 round on you once, on
your tail 7.4 s at most; now no shot, no round, on your tail 13 to 38 s in
7 of 9). Survival stays "yes", by the Dip. Nothing was tuned: the Ninja's
part in the lesson is to show that the Spitfire's way on top does not work
on a jet, and it still does not. The words for the Ninja (its note and
verdict line, and the counter-story's sentence that quoted 910 to 1,690 m)
are rewritten for what it now does.

## Shared files (not changed here)

- `viewer/dogfight-steps.js` `on-his-tail/dip`, `/flip`, `/ninja`: the
  step lists are the Spitfire's ("Roll out early and their nose is on you
  before you are clear"), and a jet lesson has no way to give its own. The
  jet Dip's steps would be: arrive a little faster than them; when they
  break, do not turn after them; wings level, full throttle, nose a little
  down; keep going. Done since: a jet demo carries its own `steps`
  (`dogfight-steps.js` `stepsOf`), the jet Dip has these, and a jet lesson
  shows no Spitfire list for a move it did not re-fly.
- The doctrine cards that point at `['on-his-tail', 'move']`
  (`dogfight-doctrine.js`, `dogfight-doctrine-1991.js` "Lead to shoot, lag
  to stay") are untouched; on a jet the move still shows what they say.

## Open

- The live fight (FLY IT) is fitted to a jet ([live-fight.md](live-fight.md)) and reads this file; nobody has flown this lesson in it by hand.
- The tuning is the F-16's; on the MiG-29 the Dip is 7 of 9, not 9.
- A breaker that chased a man who goes straight past it would make the jet
  Dip a race (both jets top out alike); `otBreaker`'s chase rule, keyed on
  the gun's reach, is what lets the leaver go.
