# The flat scissors on a jet

Status: **re-tuned** (2026-11-11), **re-measured under the reworked roof**
(2026-11-11, commit `868247883`): only the Ninja moved, and it is still 0 of
9; no way out works, survival stays "no". Nobody in any demo or move goes
over 765 m on the F-16 (770 m on the MiG-29). Files: `viewer/dogfight-lessons/jets/scissors.js`,
`viewer/dogfight-lessons/jets/plan-scissors.js`, `tests/test_dogfight_jet_scissors.py`.

What a scissors is on a jet, in one line: the same braid, flown on the
brakes with every reversal started early, nobody's kill, and no way out of
it. The slower pilot still gets the only shots, but they are a tenth of a
second; the pilot who leaves is shot down from every start.

## What was found

Flown as written on the F-16 (the jet harness's nine starts, sideways by
speed), the lesson was nobody's kill (0 to 3 hits by the ace) but not a
scissors. Two things came apart, and each needs its own fix:

- **The nose answers late.** `PLANS.scissors` reverses when the paths cross
  and rolls out of its hard turn 12 degrees short of its 60 degree weave. The
  F-16's pitch lag is 0.83 s (2.5 times the Spitfire's), so the turn runs on
  after the stick has let go: the widest swing, 104 to 106 degrees off the
  line, comes 3.6 to 4 s in, just after the first crossing. The 100 degree
  cap in the plan is what stops it at all. With the throttle fixed (below)
  but the reversals not led, the swing is still 95 to 107 degrees and the
  passes come as close as 3 m, with snaps both ways (up to 10 hits by you).
- **A jet's full throttle is not "a little faster".** In a hard turn at full
  throttle the F-16 accelerates: from 30 m/s it is at 69 in 4 s and climbing,
  turning 50 to 69 degrees a second (a probe of `hardTurn` at 72 degrees of
  bank on the fixture's F-16, outside the harness; not on screen). So the full-throttle
  pilot weaves at 73 to 78 m/s against the ace's 46 to 48, and is 261 to 503
  m out in front at 45 s, 294 to 524 m apart. The Spitfire's lesson rests on
  45 against 40.

Throttled back from 75 m/s level the F-16 is at 55 in 2 s and 43 in 4 s
(same probe): the brake bites at once, not after the Spitfire's 3 to 4 s.
Not on screen: the coach line no longer says it takes seconds.

**Who wins it.** Nobody, while it lasts. The slower pilot gets the only
shots in the classic demo (the ace, in 5 of 9, 0.03 to 0.13 s, one hit in
3 of 9) and in the Flip (you, slower, 0.2 to 0.27 s in 2 of 9). Nobody ever
sits in the other's rear quarter. What decides it on a jet is leaving: an
equal jet with a 1,000 m/s cannon turns after you and holds 250 to 440 m
behind you, which is inside its reach (the Spitfire's guns stop at 298 m),
and shoots you down 15 to 17 s after you leave, from all nine starts.

## What was changed

Claim by claim:

| Claim | Kind | What holds it |
|---|---|---|
| They braid along one line | (a) tuned | both pilots fly `jetScissors`: the scissors with each reversal and roll-out flown on where the heading will be `lead` (0.8) s on; and both on the brakes, you holding 42-46 to their 38-42 (Spitfire m/s: 53 against 47 real, the Spitfire's 45 against 40) |
| The faster one drifts forward | (a) | 139 to 154 m ahead at 45 s |
| The slower one gets snap shots | (b) rewritten | true, but a tenth of a second or less (Spitfire: 0.2 to 0.4 s) |
| Nobody's kill | holds | 0 to 1 hits in 45 s |
| The throttle is a brake that takes 3-4 s; below 30 m/s a Spitfire barely turns; the ace at 40, you at full throttle a little faster | (b) rewritten | the third story paragraph now says what the lag and the jet's throttle do, with the as-written numbers |
| Leave at the second crossing (the Dip) | (b) rewritten | 0 of 9: the cannon reaches |
| Survival | (b) | "No way out" (`verdict: 'no'`) |

The plans (`dogfight-lessons/jets/plan-scissors.js`), each the school's own with its
scissors swapped for `jetScissors`:

- `jetScissors`: `PLANS.scissors` with memory `lead` (seconds the heading is
  predicted on from its smoothed rate, for both the reversal cap and the
  hard-turn-to-fine-aim switch), `band` (the throttle's speed band), `swing`
  and `cap` (default 60 and 100, as the Spitfire's). With `lead` 0 and no
  band it flies `PLANS.scissors` to the last decimal.
- `jetScAce`, `jetScClimber`: `scAce` and `scClimber` over `jetScissors`.
- `jetScDip`: `scDip` over `jetScissors`, the crossing (`dipAt`, 2) and the
  dive (`dipDive`, -6) in memory.
- `jetScFlip`: `scFlip` over `jetScissors`, holding `brake` (33) by setting
  the band at the first crossing.

The jet file: the ace flies `jetScissors` (lead 0.8), you the same plus
`fast: false, band: [42, 46]` for every demo; the Dip `jetScDip` against
`jetScAce`, the Flip `jetScFlip` and the Ninja `scNinja` against
`jetScClimber`. Labels: the Dip is now "out at a crossing, tried". New
`note`, `story`, `counterStory`, `survival`, `coach`, and every demo's note
and verdict.

Lead 0.8 is the measured lag, not a search result. Others flown on the way:
0.4 (full throttle) left 85 to 88 degrees; 1.0 (band 44-48) 67 to 68; 1.2
(full throttle) 60 to 63, the heights swinging 273 m.
The band is the Spitfire's ratio; 40-44 is tighter still (171 to 232 m) and
44-48 looser (260 to 307 m); all three are nobody's kill.

## The nine starts, before and after (F-16)

The jet harness's nine (sideways -30/0/+30 by speed -3/0/+3), `ace hits /
your hits`, a kill marked with its second:

| Demo | Before (as written) | After |
|---|---|---|
| Scissoring | 0/0 1/0 3/0 1/0 0/0 1/0 1/0 1/0 0/0 | 0/0 0/0 0/0 0/0 0/0 0/0 1/0 1/0 1/0 |
| Dip | 0/0 1/0 2/0 ACE@25 ACE@23 ACE@23 ACE@24 ACE@24 ACE@23 | ACE@23-26 in all nine |
| Flip | 0/0 1/0 2/0 3/0 1/0 3/0 1/0 3/0 2/0 | 0/0 0/0 0/0 3/0 0/0 0/0 3/0 9/0 1/0 |
| Ninja | 0/0 0/0 1/0 0/0 0/0 0/0 0/0 0/0 0/0 | 0/0 in all nine |

The braid (Scissoring), before and after: crossings 8-9 and 8-9, 3.8-7.4 s
and 4.5-6.1 s apart; widest swing 106 and 74 degrees; most apart 401-572
and 238-264 m; heights within 130 and 62 m; slowest 29.5 and 34.4 m/s (the
ace, braking in his shot); you ahead at the end 261-503 and 139-154 m.

The moves, counted as the school counts them: `scoreMove` from
`dogfight-measure.js` over its L9 `STARTS`, the way `movesOn` does, on the
F-16 (the test's `_measure`, not the jet harness):

| Move | Before | After | Line |
|---|---|---|---|
| Dip | 2/9 (shot down in 7) | 0/9 | out 8-9 s in, shot down 15-17 s later in 9 of 9, 250-440 m behind; leaving at crossing 1, 3 or 4, or diving 15 degrees: 0/9 each |
| Flip | 0/9 | 0/9 | 39-42 m/s to their 48-49, three crossings, never in their rear quarter; your snaps 0.2-0.27 s in 2 of 9 (1 and 5 hits); you sink 60-71 m to end 30-53 m under them; theirs 0.07-0.27 s in 2, no hits; 9 m closest |
| Ninja | 0/9 | 0/9 | on the reworked roof (2026-11-11): climb 357-395 m in 20 s, levelled off at about 765 m, and they climb after you: 20-40 m over them at 20 s, level (within 10 m) at 40 and 60 s; no attack, and flown on they come in behind you: rounds on you in 5 of 9 by 40 s, 8 of 9 by 60 s, nobody shot down. Before the roof: climb 460-810 m, 250-410 m over them in 7 of 9 |

Small changes tried on the moves: the Ninja flown 40 and 60 s (0/9, no
attack of yours), the Flip 40 s (0/9). None made a move work, so none is shipped.

## The MiG-29 (pace 1.5)

The same jet file holds: crossings 8, swing 69 degrees, at most 280-303 m
apart, ace's snaps in 6 of 9 (0 to 1 hits), nobody's kill. As written it
swung 98 degrees and was 515-874 m apart. Dip 0/9 (shot down in 8 of 9 L9,
9 of 9 on the harness), Flip 0/9, Ninja 0/9. On the reworked roof the Ninja
tops 770 m (you) and 763 m (the ace), where it went to 1,223 and 995 m
before any roof (843 and 845 on the first roof); the moves are still 0 of 9
each. As on the F-16, its Ninja flown on is caught from behind: rounds on
you in 7 of 9 by 40 s and in all nine by 60 s (3 to 19), nobody shot down.

## Under the roof (2026-11-11)

Every jet pilot's plan goes through `underRoof` (`dogfight-jet-ceiling.js`,
from `dogfight-pilot.js` `stepPilot`). The roof as it is now (commit
`868247883`, replacing the first roof of `8d616bcc2`) only caps how hard a
plan may pull the nose toward the sky: the pull that would put the path on
the allowed climb (falling to level by 800 m real), worked out in the
plane's pitch plane over the share of its lift that points up, less the
pitch rate under way. The plan's own pull is flown wherever it asks for
less; roll, rudder and trigger stay the plan's; the throttle comes off
while the nose is more than 15 degrees over the allowed climb. The first
roof instead took every answer over above 800 m and held whatever bank the
plane had, and climbed a plan that wanted less at the steepest rate
allowed: the first Ninja numbers below were flown inside that. The scissors
starts at 384 m real on the F-16, under 600, so `pacedHeight` leaves it
where it was.

F-16, nine starts (`--tops`, ace / you):

| Demo | Before any roof | First roof | Reworked roof |
|---|---|---|---|
| Scissoring | 386 / 394 m | unchanged | unchanged |
| Dip | 386 / 394 m | unchanged | unchanged |
| Flip | 386 / 393 m | unchanged | unchanged |
| Ninja | 789 / 1,144 m | 773 / 827 m | 727 / 765 m |

The Ninja on the L9, F-16:

| | Before any roof | First roof | Reworked roof |
|---|---|---|---|
| Climbed in 20 s | 460-810 m | 396-456 m | 357-395 m |
| Over them at 20 s | 250-410 m in 7 of 9 | -2 to 101 m | 20-40 m |
| At 40 and 60 s | still over them, no attack | level within 2 m, no shot from them | level within 10 m; their rounds on you in 5 of 9 by 40 s, 8 of 9 by 60 s (3 to 19), nobody down |
| Count | 0 of 9 | 0 of 9 | 0 of 9 |

The braid, the Dip (shot down in 9 of 9) and the Flip are the same fights
on all three; their tests did not move. The Ninja (`scNinja` against
`jetScClimber`) is still 0 of 9. Your plan wants to climb on (`ninja-up`,
then `clear`, over and over), the roof holds it level at about 765 m, and
the climber, who climbs while you are more than 50 m above them, comes up
after you and then chases: in the default start flown 60 s they are 419 m
behind at 20 s, nose 3 degrees off you, both at 120 to 126 m/s, and close
to 262 m by 60 s, firing from 28 s on. The note, verdict line, counter-story
sentence and survival line say so: the height lasts a few seconds, then
they are level with you and in behind you.

Nothing was tuned. The Ninja's job in the jet lesson is to show that going
up out of a scissors is no way out on a jet, and it still is not. FLY IT's
guide stays `jetScissors`: no way out works (Dip, Flip and Ninja 0 of 9 on
both jets).

## Needed in shared files

- Done at the merge: `tests/test_dogfight_jets.py` asserted that scissors
  had no jet file ("a lesson with no jet file is flown as written"); it now
  reads the falling leaf, which has none.

## Open

- FLY IT is fitted to a jet ([live-fight.md](live-fight.md)) and its ace
  here is `jetScAce` (`flyAce` in the jet file), so the scissors you fly
  against is the led one. Nobody has flown it by hand.
- The Dip, Flip and Ninja are all 0 of 9. Whether any way out exists on a
  jet: it would need 550 m or more before the ace is round (`scAce` lets go
  past its gun range plus 30 m, 430 m in the Spitfire's units), which a
  scissors 250 m wide does not give.
- The Ninja's height is never spent: the pendulum's dive rules are the
  Spitfire's speeds (`SC`), so `scNinja` on a jet keeps asking to climb,
  and under the roof the climber catches you up before any dive comes
  (level by 40 s, then behind you). A jet Ninja would need its own dive,
  early, which is a new move, not a re-tune.
- The ace's slowest is 34 m/s: the shot's brake (`throttle -0.4` when
  closing) bites at once on a jet. The F-16 still turns and climbs from 30.
