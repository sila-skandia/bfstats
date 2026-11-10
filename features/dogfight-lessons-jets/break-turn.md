# The break turn on a jet

Status: **re-tuned on the F-16** (2026-11-10). Files:
`tools/bf1942-models/viewer/dogfight-jet-break-turn.js` (the jet block),
`tools/bf1942-models/tests/test_dogfight_jet_break_turn.py`. No jet plan:
`viewer/dogfight-jet-plan-break-turn.js` stays `export {};`.

Which seat is which: in `without`, `move` and `counter` the harness's ACE
(side 0) is the pilot under attack (`cruiser` or `breakTurn`) and YOU
(side 1) the attacker (`chaser`, `patientAttacker`); the harness nudges the
attacker's start. In the Dip, the Flip and the Ninja ACE is the school's
`btHunter` and YOU the pilot who flies the move. Hits are written ACE/YOU:
rounds each landed.

## What was found

1. **The break comes at once on a jet.** `breakTurn` breaks when the
   attacker is inside `c.gun.range + 30`. `gunOf` caps the range at 400
   (the Spitfire's is 268, where its two streams cross), so on the jet it
   is 430 in the pilot's view, 550 m real. The lesson's start puts the
   attacker 444 to 481 m back, so the defender breaks at 0 s, not at
   300 m. That is the jet's truth, not a fault: the attacker opens fire at
   once and its first rounds land 1.1 to 1.2 s in, from 480 m. The words
   say so ("their cannon has you from 500 m, so there is no waiting").
2. **Flying straight was not fatal, because the attacker flew through the
   target.** As written the target cruises at the Spitfire's 52 m/s (67 on
   the F-16). The `chaser` runs at full throttle to 101 m/s and closes at
   about 17 m/s; its throttle chop is gated at 15 m/s of closure in the
   Spitfire's units (19 real), so it never brakes, comes within 1 to 5 m of
   the target's tail about 20 s in, goes past and loses sight. Single
   cannon, small tail-on target: 5 to 20 rounds land on the closing run
   against the 22 that bring it down. Shot down in 1 of 9.
3. **The break, the counter and the moves hold** as they do on the
   Spitfire, with the jet's own sizes: a circle about 135 m across at 70
   to 80 m/s, the attacker swinging back in 110 m behind, the yo-yo 40 to
   70 m above.

## What was changed, and why

- `ace.start.speed` 52 -> 68 (87 m/s on the F-16; the cruiser holds its
  start speed, 86). A jet cruises nearer its top speed; at that cruise the
  attacker closes at 16 to 21 m/s, settles 25 to 30 m behind (its throttle
  rule now holds it there) and shoots the target down. This is tuning (a):
  flying straight under a jet's gun is fatal; the as-written fight only
  showed the plan's attacker failing to brake on a jet. 64, 66 and 70 were
  also flown: 9 of 9 at 64 and 66 with 45 s (one kill at 44 s on 66), 8 of
  9 at 70 in 40 s. 68 is the middle with the latest kill at 40 s.
  `breakTurn` breaks at once whatever its start speed, so `move` and
  `counter` start 20 m/s faster too and hold (below).
- `seconds` 40 -> 45: the only demo it times is the retired `without`;
  every shown demo carries its own `seconds`. At 40 s, 8 of 9.
- Words, all rewritten with the F-16's numbers: `tagline` (no "wait"),
  `note`, `story`, `counterStory`, the `move`, `dip`, `flip` and `ninja`
  notes, the three verdicts, `survival`, and `coach` (`watch` says when
  they break, `turn` says 110 m). Unmeasured Spitfire claims (roll out and
  run, never more than 330 m back) were dropped, not carried over.
- The Flip's note gives its plan numbers in real metres: breaks at 460 m
  (`breakAt` 360), zooms with them inside 155 m (120) until 67 m/s (52).

## Nine starts on the F-16, before and after

Harness starts (`dogfight_jet_harness.mjs break-turn --text`, `--demo
without`, `--base` for before). Hits ACE/YOU.

| Demo | As written | Re-tuned |
|---|---|---|
| without (cruiser vs chaser) | shot down 1 of 9 (33 s); the rest 5 to 20 hits, attacker through their tail 20 s in | shot down 9 of 9, 29.5 to 40.2 s in, from 25 to 30 m behind; the target lands nothing |
| move (they break) | never down; 1 to 6 hits on the breaker, all by 4.2 s; attacker past 13 to 43 m off, 4.5 s in | never down; 0 to 4 hits on the breaker, all 1.1 to 3.5 s in; attacker past 42 to 71 m off, 4.3 to 7.0 s in; reverse 4.1 s; then 107 to 129 m behind, nose 45 to 60 degrees off, no landing shot after 8 s |
| counter (you stay patient) | never down; 0 to 1 hits; yo-yo 41 to 85 m above | never down; 0 to 1 hits, both at 1.2 s; yo-yo from 0.5 s, more than 30 m above from 3 s in every start, 40 to 73 m (median), never within 59 m |
| dip | 0/0 in all nine | 0/0 in all nine (the Dip, Flip and Ninja start from their own places, which the jet file does not touch) |
| flip | 0/0 | 0/0 |
| ninja | 0/0 | 0/0 |

In two `counter` starts the breaker slows to 43 to 45 m/s and finds the
attacker out in front of its nose (`chase`, 10.9 s); no round lands.

## The moves, as the school scores them

Counted with `dogfight-measure.js` `movesOn` / `scoreMove` over the
measure's nine `STARTS` (not the harness's), on the F-16, from a scratch
script that loads the viewer modules the harness's way. The flights are the
same with and without the jet file; the verdicts are the Spitfire's counts.

- **Dip: 9 of 9.** Their guns never have you, no round lands. The hunter
  follows the zoom (8 s) and slows to 57 to 65 m/s; you come over the top
  at about 40 m/s (17 s). The run (`dip-run`, 25 s) is slow on a jet: 10 to
  50 m/s for about 20 s, 520 to 630 m of height lost, before the speed
  comes back. They give up (`let-go`) 32 to 33 s in; at 50 s 1.2 to 1.4 km
  apart and opening (by 3 m in one). It scores, and the words say how slow
  it is.
- **Flip: 0 of 9.** From 12 to 42 s the hunter is 110 to 750 m away and
  22 to 142 m above you, never dead astern inside 155 m, so the zoom does
  not start until 46 to 48 s in, after a head-on pass at 43 to 46 s. No
  round lands either way.
- **Ninja: 0 of 9.** The Dip's flight until 25 s: no dive phase in any
  start, no shot, no round either way; they sit on your six 1.4 to 1.6 s
  once (the score's "never a second" fails too).

## The MiG-29

Same jet file (`--plane Mig29`, pace 1.5): flying straight is shot down in
only 3 of 9 (43.5 to 44.7 s), 4 to 16 hits in the rest; the break is never
shot down (0 to 2 hits); the patient attacker lands nothing and the yo-yo
sits 46 to 260 m above; the Dip scores 2 of 9 (the hunter turns back to
meet you in several), the Flip and the Ninja 0 of 9. Tuned on the F-16
only.

## Open

- `RETIRED_DEMOS['break-turn']` is not reached by `lessonFor` (it merges
  `jet.demos` over `lesson.demos` only), so `without` can only be tuned
  through `ace`, `you` and `seconds`. Nothing needed now.
- `breakTurn` and `btFlip` hold 52 m/s in `watch` (`holdSpeed(c, 52)`); on
  a jet the break comes at 0 s so it never matters here, but a jet start
  further out would cruise at 67 m/s, not at its start speed.
- The Dip's slow run is `btUpAndAway`'s Spitfire numbers (zoom to 52 m/s,
  8 s over the top with `pullLift`) on a jet. A jet version of the run
  (leave the zoom faster, shorter over the top) would need a plan in
  `dogfight-jet-plan-break-turn.js`; not done, since it already scores.
- The MiG-29 is not tuned (above).
