# On their tail, on a jet

Status: **re-tuned on the F-16** (2026-11-10), **re-measured under the roof**
(2026-11-11). The lesson's first claim holds (rushing in is nobody's kill).
Its way out does not: on a jet, leaving their circle the Spitfire's way gets
you shot down from all nine starts, so the Dip now flies the jet's way out
(never go in), and the words say why. The Flip and the Ninja get no shot on
a jet either, and say so. Re-measured on the reworked roof (commit
`868247883`): every F-16 count holds (Dip 9 of 9, Flip and Ninja 0 of 9,
survival "yes"); on the MiG-29 the Dip fell to 5 of 9. Nobody in any demo or
move goes over 766 m on the F-16 (805 m on the MiG-29).

**2026-11-11, the ceiling guard.** Every pilot noses over above 880 m; on a
jet that guard waited for 1,126 m real until commit `726b12eb6` read the
880 m over the airframe's pace. Re-flown with it in, only the Ninja moved
(below): the rush, the Dip, the old exit and the Flip are the same fights to
the metre, and every verdict holds (the Dip 9 of 9, Flip and Ninja 0 of 9).

Files: `viewer/dogfight-lessons/jets/on-his-tail.js` (the words, the Dip's seat, the
verdicts, survival, coach), `viewer/dogfight-lessons/jets/plan-on-his-tail.js`
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
  second round a circle 123 to 126 m across (the Spitfire 39 a second, about
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
| `ninja` climb beside | `- 0/0` in all nine; L9 0 of 9 | unchanged plan, jet verdict 0 of 9, label and note rewritten. Under the roof (2026-11-11, reworked): `- 0/0` in eight, `- 2/0` in one, tops 749 to 766 m; L9 0 of 9 |

### You rush in (claim held, numbers rewritten)

They break 436 to 543 m out (the three slower starts later and nearer,
7.3-7.5 s; the rest at 3.3-3.8 s). Your burst opens at 527-532 m and lands 0
to 3 rounds (at 178 to 507 m), all between 2.2 s before the break and 4 s
after it. You come past their tail 49 to 60 m from them 3.8-5.3 s into the
break and then sit 104 to 110 m behind them, your nose 51 to 54 degrees off
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
across it going away. On the F-16 they come round in behind you 70 to 352 m
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
phases are watch, break, chop), and at 40 s you are 2601 to 3361 m apart and
opening, never hit, their guns never on you. L9: 9 of 9.

Sensitivity, L9 (measured before the roof): leaving 1 or 2 s after the break 9 and 7 of 9, 4 s after it
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
260 m. Unlike the Spitfire you keep your speed over the top (80 to 88 m/s at
the end), but you get no higher than them in any of the nine.

### The Ninja (claim false on a jet: 0 of 9)

On the Spitfire the climb beside their break gave one pass from above (3 of
9 kills). On the F-16 they come up too (`otAce`'s climb, or turning after
you), and under the roof both level off between 749 and 766 m, fast (you
125 m/s at the end of the default start), with nobody in a place to shoot:
`- 0/0` in all nine (re-flown 2026-11-12 on retail g and box area; before it,
one start had them land 2 rounds on you). Up there they
come round onto your tail (in the default start 364 m back at 18 s, closing
to 274 m by 48 s at your speed, their nose 4 to 12 degrees off you, firing
at 42 s without a hit). L9: no kill, 2
rounds landed (in one), 0.17 s of landing shot; on your tail for 4.7 to 38 s
in 8 of 9, their landing shot 0.93 s at most, 1 round on you once.

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
are the F-16's.

On the reworked roof (2026-11-11): `jetOtLeave` is **5 of 9** on the L9,
"partly" on the MiG-29 (the F-16's survival "yes" is unchanged). Two are
the same shot-downs as before (17.8 and 18.3 s after the break); in two more
they come after you and are still closing at 40 s, though 2,866 and 3,084 m
back, so the measure's "opening" fails. The Ninja is 0 of 9 and on the
MiG-29 it is dangerous: level under the roof you fly on at 158 m/s with them
behind you inside their cannon's 600 m, and they land rounds in 6 of the
nine starts and shoot you down in 2 (for example dx -30, dv +3: 450 m back,
nose 0.4 degrees off, 51 and 60 rounds fired at 42-46 s, down at 44.9 s).
The highest anyone goes is 805 m (the breaker in the Dip; the Ninja 784).

## Under the roof (2026-11-11)

Every jet pilot's plan goes through `underRoof` (`dogfight-jet-ceiling.js`,
from `dogfight-pilot.js` `stepPilot`). The roof as it is now (commit
`868247883`, which replaced the first roof of `8d616bcc2`) takes one thing
from a plan: how hard it may pull the nose toward the sky. The pull that
would put the path on the allowed climb (which falls to level by 800 m real)
is worked out in the plane's own pitch plane over the share of its lift that
points up, less the pitch rate under way; the plan's own pull is flown
wherever it asks for less. Roll, rudder and trigger stay the plan's; a loop
that fits under the roof is left alone; the throttle comes off while the
nose is more than 15 degrees over the allowed climb. It starts to act once
the allowed climb is under 60 degrees, about 270 m under the roof on the
F-16. This lesson's starts are all under 600 m real, so `pacedHeight` leaves
them where they were.

The first roof, above 800 m, took every answer over and held whatever bank
the plane had: the Ninja's both-at-805-to-836-m, no-shot fight was flown
inside that, and is gone.

F-16, nine starts (`--tops`, ace / you):

| Demo | Before any roof | First roof | Reworked roof |
|---|---|---|---|
| `move` | 504 / 490 m | unchanged | unchanged |
| `dip` | 739 / 410 m | unchanged | 733 / 410 m |
| `flip` | 640 / 598 m | unchanged | 640 / 591 m |
| `ninja` | 1,688 / 1,574 m; `- 0/0` x8, `- 2/0` x1 | 833 / 836 m; `- 0/0` x9 | 764 / 766 m; `- 0/0` x9 (`- 0/0` x8, `- 2/0` x1 before retail g) |

Moves, L9, F-16:

| Move | Before any roof | First roof | Reworked roof |
|---|---|---|---|
| Dip | 9 of 9, 2603-3193 m apart at 40 s | the same | 9 of 9, 2601-3361 m apart |
| Flip | 0 of 9, end 80-83 m/s | the same | 0 of 9, end 80-88 m/s |
| Ninja | 0 of 9; their shot 0.23 s, 1 round on you, your six 7.4 s at most | 0 of 9; no shot, no round, your six 13-38 s in 7 of 9 | 0 of 9; their shot 0.93 s, 1 round on you once, your six 4.7-38 s in 8 of 9 |

The rush did not move. The Dip and the Flip are the same fights to within a
few metres (the breaker's climb after their break now feels the roof, so the
Dip ends a little further apart and the Flip a little faster); their counts
hold. The Ninja's count holds too; its shape is what moved: both level off
under the roof, at 749 to 766 m, and the breaker comes round onto your tail
there, with a short shot now and then. Survival stays "yes", by the Dip.
Nothing was tuned: the Ninja's part in the lesson is to show that the
Spitfire's way on top does not work on a jet, and it still does not. The
words for the Ninja (note, verdict, counter-story sentence) and the Dip's
and Flip's verdict numbers are rewritten for what they now do.

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
- The tuning is the F-16's; on the MiG-29 the Dip is 5 of 9 on the reworked
  roof (7 before), and its Ninja is shot down in 2 of the nine starts.
- A breaker that chased a man who goes straight past it would make the jet
  Dip a race (both jets top out alike); `otBreaker`'s chase rule, keyed on
  the gun's reach, is what lets the leaver go.
