# Out of their lock, on a jet

Lesson `out-of-the-lock` ("Out of their lock: breaking the tail"), re-tuned
for the F-16 (2026-11-10), re-measured under the roof (2026-11-11): the hard
turn ends levelled off and faster, every count holds (Dip, Flip and Ninja 0
of 9, survival "no"), and nobody in any demo or move goes over 812 m on the
F-16 (855 m on the MiG-29). Files: `viewer/dogfight-jet-out-of-the-lock.js`
(the jet block), `viewer/dogfight-jet-plan-out-of-the-lock.js` (two jet
watchers), `tests/test_dogfight_jet_out_of_the_lock.py`.

## What broke a jet's lock

Not the cannon. As written, the turn (`flat`) and the turn-then-chop
(`counter`) were each shot down in one start of nine, the same start (dx +30,
dv +3), 26.5 s in, 22 hits. Traced, the pilot never turned at all:

- Both watchers wait for the hunter with `olLooking`'s look turn, a level
  turn at a fixed 20 degrees of bank (`OL_LOOK`) that keeps the hunter over
  the shoulder and out of the cone the headrest hides (`EYES.tail`, 20
  degrees astern) until they are committed behind (`committedBehind`:
  inside 180 m, Spitfire units).
- A turn's rate is g tan(bank) / v. The jet flies the Spitfire's start at
  1.28 times the speed, so 20 degrees turns it at 1 / 1.28 of the
  Spitfire's rate. The hunter, coming in from slightly wide, slides into the
  cone (from 3 s in), and in that start reaches 180.5 m, not 180, when the
  four seconds of carrying them forward unseen run out (`EYES.lose`).
- Lost, the pilot flies a clearing turn (`clearTurn`, 6 s) that does not
  find a hunter sitting dead astern, then flies straight on: shot down.

The fix is (a): the jet watchers (`jetOlHardTurn`, `jetOlChop`) hold the
Spitfire's look-turn **rate** rather than its bank: the rate 20 degrees
gives at the start's Spitfire-sized speed, the bank eased toward it from a
second in (20 to 45 degrees). On the F-16 that is 26 to 39 degrees, on the
MiG-29 28 to 44. A fixed bank was swept first: 22 failed, 25 held on the
F-16 (tan 25 = 1.28 tan 20, as the rule says) but failed on the MiG-29,
where 30 was needed (pace 1.5). The rate fits both without knowing the pace.
After the watch, both are the Spitfire's own plans, unchanged.

## Nine starts on the F-16, before and after

The harness's nine starts (`dogfight_jet_harness.mjs`, winner@s hits on you
/ hits on them):

| Demo | As written | Jet version |
|---|---|---|
| without (retired, quoted) | ACE@10-12 22/0 in all nine | unchanged (`cruiser`): 9 of 9, 10.2 to 11.5 s |
| flat | 8 x `- 0/0`, ACE@27 22/0 | 9 x `- 0/0` |
| counter | 6 x `- 0/0`, 2 x `- 0/1`, ACE@27 22/0 | 9 x `- 0/0`, the chop never flown |
| dip | 9 x `- 0/0` | 9 x `- 0/0` (not changed) |
| flip | 7 x `- 0/0`, `- 3/4`, `- 1/2` | the same (not changed) |
| ninja | 7 x `- 0/0`, `- 3/4`, `- 1/2` | the same (not changed) |

The Dip, the Flip and the Ninja scored as `movesOn` scores them (the
measure's nine L9 `STARTS`, `scoreMove`, `ok` per start): 0 of 9 each, as
written and in the jet version alike. Scored in real metres and m/s, as the
measure has no pace: on a jet its 900 m `GONE` and 350 m quarter are a
little easier than on the Spitfire, and still nothing passes.

## Claim by claim

- **Flying straight is fatal** (true): 9 of 9, 10 to 12 s in (12 to 19 on the
  Spitfire).
- **Turning hard keeps you alive** (true, tuned to hold): no hit either way in
  nine, they follow you round in `lag`, never closer than 64 to 68 m, and
  their landing shot is only the lock before the turn bites (1.7 s at most;
  2.1 as written).
  Rewritten: the turn does not hold its height on a jet. `levelHardTurn`
  caps the bank at 65 degrees plus its sink term, and at full throttle the
  F-16 has the lift and thrust to climb in it: both go up 359 to 364 m in 45
  s, until the roof levels the turn off at 805 to 812 m in the last seconds,
  ending at 105 to 111 m/s (97 to 98 before the roof, still climbing). The
  words say so instead of "holding your height".
- **The chop** (rewritten): never flown in nine. `lockChop` chops only when
  they sit close behind (inside 90 m Spitfire, 115 m real), behind the wing
  line and still closing. Measured from 4 s into the turn: they are inside
  115 m and within 50 degrees of the tail for 4.0 to 4.8 s a fight, at 64 to
  69 m, but never while closing. They swing in and out.
- **Seen far back, go under them and run on** (the Dip; rewritten, 0 of 9):
  never hit, never out. They turn round and sit 301 to 338 m behind,
  landing-shot solution on you for 23.4 to 23.8 s, holding their fire to
  `HUNTER_FIRE` (150 m Spitfire, 192 real). Both at about 100 m/s, nobody
  gains; at 40 s 306 to 323 m apart, closing 3 to 4 m. They never give up:
  `olHunter`'s give-up is "past the guns' range + 30 m and not closing for 6
  s", and a jet cannon's range is `gunOf`'s 400 (Spitfire units, 512 real;
  the Spitfire's is its 268 m crossing), so 300 m behind is inside it.
- **The Flip and the Ninja** (rewritten, 0 of 9 each): the jet ace never slows
  over the top. After the move they stay at 60 to 67 m/s (35 to 44 on the
  Spitfire when the burst landed), follow you up, and no dive comes from
  behind: no attack counted, best time in their quarter under 2 s, 5 hits in
  one fight of nine and none in the rest, never hit yourself. Several
  head-on passes come within 2 to 6 m.
- **Survival**: `no` (all three moves `no`), with a line that says turning
  hard keeps you alive and nothing gets you out.

Flown but not in the words (the story's retired dive and early turn,
`olDiveOut` and `olMeetHim` wrapped with the jet look turn in a scratch
plan, not committed): diving away was never shot down in nine but took 0 to
10 hits with them on your tail 9 to 33 s after; turning into them early
took no hit, but its pass came within 6 to 7 m. The jet story leaves both
out rather than quote numbers no test holds.

## The MiG-29

`--plane Mig29`: as written, flat and counter are shot down once in nine
(start 7, 37 s) and hit 8 times in start 8. With the jet watchers: no hit
either way in nine for both; flying straight is shot down in nine of nine,
11 to 12 s. The moves: 0 of 9 each, as on the F-16. The test holds the
MiG-29's flat, counter and without.

Under the roof (2026-11-11) nobody is shot down and no round strikes you in
flat or counter; the turn ends at 847 to 849 m at 151 to 152 m/s (it went
to 874 to 905 m before). On the MiG-29 the chop is flown, in all nine, as it
was before the roof, and now lands 1 round on them in one start. The chop
topped out at 1,427 m before and the Ninja at 1,664 m; now the highest
anyone goes is 855 m. The moves are still 0 of 9 each.

## Under the roof (2026-11-11)

Commit `8d616bcc2` puts every jet pilot's plan through `underRoof`
(`dogfight-jet-ceiling.js`, from `dogfight-pilot.js` `stepPilot`): the climb
is levelled off by 800 m real, and a banked turn goes on level. The lesson's
starts (480 and 448 m real on the F-16) are under 600, so `pacedHeight`
leaves them where they were.

What moved, F-16, nine starts (`--tops`, ace / you):

| Demo | Highest before | Under the roof |
|---|---|---|
| flat | 810 / 812 m, ending 97-98 m/s still climbing | 811 / 812 m, levelled off, ending 105-111 m/s |
| counter | the same as flat (the chop never flown) | the same as flat |
| dip | 487 / 465 m | unchanged |
| flip | 626 / 753 m | 626 / 708 m |
| ninja | 636 / 912 m (you over 880 m in 4 of 9) | 632 / 758 m |

The hard turn is the only fight whose words moved: it climbs 359 to 364 m in
45 s as before, but reaches the roof in its last seconds and goes on level
there, so the end speed is 105 to 111 m/s, not 97 to 99 (the test now also holds
the hunter's landing shot before the turn to the 1.7 s it was, not the
as-written 2.1). Hits, closest pass (64 to
68 m) and the phases are unchanged, and the chop is still never flown on the
F-16. The Flip and the Ninja are the same fights from the nine starts (`-
3/4` and `- 1/2` in the same two); on the L9 their end ranges move but every
number the words quote holds (the ace at 60 to 67 m/s, 5 hits in one fight,
never hit yourself). The Dip did not move. Nothing was tuned; the story
sentence and the flat demo's note now say the circle climbs to the roof.

## Shared files (not changed)

## Shared files (not changed)

- `olLooking` and `OL_LOOK` in `dogfight-pilot.js` could take the rate rule
  for every airframe (on the Spitfire it gives 20 degrees, as now). The jet
  file copies `olLookTurn` instead (`jetLookTurn`) because neither is
  exported.
- `olHunter`'s give-up rule reads `c.gun.range`, which for a jet is
  `gunOf`'s 400 m cap, not the crossing distance it is on the Spitfire. If
  the school wants a jet hunter to give a chase up, it needs a reach of its
  own for that rule; as it stands, the Dip's words say they never give up.

## Open

- The live fight (FLY IT, `flyAce: 'olAce'`) is fitted to a jet ([live-fight.md](live-fight.md)); nobody has flown this lesson in it by hand.
- The step guides `out-of-the-lock/dip|flip|ninja` in `dogfight-steps.js`
  are the Spitfire's. A jet lesson no longer shows them (`stepsOf`): a move
  the jet file re-flew carries its own `steps`, and these three have none.
- No jet version of the Dip, Flip or Ninja was attempted: against an equal
  jet that holds its speed, a small change does not make any of them work.
