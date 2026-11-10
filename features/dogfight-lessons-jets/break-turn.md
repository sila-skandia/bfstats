# The break turn on a jet

Status: **re-tuned on the F-16** (2026-11-10); re-measured with the ceiling
guard fixed (2026-11-11); **re-measured under the roof** (2026-11-11,
below): the Spitfire's Dip, Flip and Ninja are 0 of 9, a jet Dip of the
lesson's own (`jetBtDip`: break, then straight on) gets away in 9 of 9, and
survival is "yes". The getaway rests on how the roof flies the hunter
("What the getaway rests on"). Files:
`tools/bf1942-models/viewer/dogfight-jet-break-turn.js` (the jet block),
`tools/bf1942-models/viewer/dogfight-jet-plan-break-turn.js` (`jetBtDip`),
`tools/bf1942-models/tests/test_dogfight_jet_break_turn.py`.

## Under the roof (2026-11-11)

Commit `8d616bcc2` (`jet-roof`) puts every jet pilot under a roof:
`stepPilot` passes a paced pilot's answer through `underRoof`
(`dogfight-jet-ceiling.js`), which levels a climb off by 800 m real, and
`pacedHeight` bends the paced starts over toward 760 m. The Dip, the Flip
and the Ninja now start at 712 m (the hunter) and 704 m (you) on the F-16,
740 and 735 on the MiG-29 (they were 794 and 768 on the F-16). `move` and
`counter` start at 384 and 410 m, top out at 472 to 587 m, under the roof,
and fly as before: their tests did not move. The three moves are different
flights.

- **The zoom no longer goes through the top of the sky.** `btUpAndAway`'s
  70 degree zoom from 7.3 s is levelled off by the roof at 832 m, 18.9 to
  19.6 s in, still at 121 m/s (it used to coast on to 1,586 to 1,601 m and
  hang there at 34 to 44 m/s). A jet does not slow going up, so the zoom
  never ends on its speed; it ends on its 9 s.
- **The hunter goes up too and stays up.** Its turn after you climbs to 839
  to 841 m, 14 s in, and from there it flies a level 45 degree bank turn at
  825 to 836 m, 126 m/s, to the end of the fight, whatever its plan asks
  ("The roof's turn", below). It lets you go 15.8 to 16.5 s in, 700 to
  1,060 m from you, out of its reach and not closing.
- **The Dip and the Ninja as written end in that circle with it.** You are
  more than 5 m above it from 12 to 42 s (the Ninja's dive wants 45), so no dive
  comes; you leave from the top 24.2 to 24.5 s in, at its speed, and your
  run's turn away is held level by the roof too: at 50 s you are 253 to 331
  m apart and closing in all nine. Nobody lands a round; it sits on your six
  0.53 s at most. Dip 0 of 9, Ninja 0 of 9: the two plans fly the same
  flight to the last decimal, so the jet file now gives the Dip's seat to
  `jetBtDip`.
- **The Flip never zooms.** You break and hold the circle at 81 degrees of
  bank and 81 to 99 m/s, between 661 and 786 m; from 12 to 42 s the hunter
  is above you, 17 to 150 m higher and 87 to 645 m away, never dead astern
  inside 155 m, so the zoom comes in none of the nine. No round lands either
  way. 0 of 9.

**The jet Dip** (`jetBtDip`): the way out the school found twice
(`jetOtLeave`, `jetUoDip`). Break into them at once, as `btDip` does, until
they have come past your tail (the range 20 m past its least: 7.1 to 7.5 s
in, 96 to 113 m apart); then wings level, full throttle, on the heading you
are flying as they go by, nose 6 degrees down to 400 m in the Spitfire's
units (512 m real) and level. It never climbs, so the roof never touches it.
Over the measure's nine on the F-16: **9 of 9.** Never hit, their guns never
have you, never on your six. They come past 68 to 88 m off. Their turn after
you takes them up to 839 to 841 m; 698 to 866 m behind you and not closing,
they let you go 15.8 to 16.4 s in and stay up at 825 to 836 m. At 50 s you
are 4,838 to 4,955 m apart and opening (601 to 662 m in the last 3 s), at
101 to 106 m/s, level at 506 to 507 m.

What was tried for it, each over the measure's nine on the F-16:

| Jet Dip | Count | At 50 s |
|---|---|---|
| On the heading at the pass, 6 degrees down to 512 m (kept) | 9 of 9 | 4.8 to 5.0 km apart, opening |
| The same, 3 degrees down | 9 of 9 | 5.1 to 5.2 km |
| The same, 12 degrees down to 190 m | 9 of 9 | 4.5 to 4.6 km |
| Straight away from them (not the heading), 12 degrees down | 6 of 9 | 4.0 to 5.4 km, three still closing |
| No break: straight on from the start | 0 of 9 | the hunter never climbs (713 m), sits on your six 10 to 23 s, never hits; 264 to 344 m behind and closing |

**What the getaway rests on.** The hunter lets the jet Dip go because its
turn after you climbs it into the roof, where it turns slowly and stays.
With the hunter's answers left out of the roof (`roof: false` on every
`btHunter` answer: a scratch run, not shipped) it tops out at 718 to 735 m,
comes round behind you, sits on your six 39.7 to 40.2 s, 156 to 205 m back
at 50 s, lands rounds in 5 of 9 (1 to 8) and never lets go: the jet Dip is
0 of 9, and so is the lesson's own Dip (the hunter 250 m behind at 50 s,
never hitting). "A jet does not outrun a jet" (the ceiling guard's tries,
below) still holds against a hunter free to chase. If the roof changes, the
jet Dip's 9 of 9 is the first number to re-measure.

**The roof's turn** (shared: `dogfight-jet-ceiling.js` `underRoof`, not
changed here). Two things in it decide all three moves here:

1. It holds the nose at the climb the roof *allows*, not at the smaller of
   that and the plan's own: a turn that brings the nose up for a moment is
   climbed on at the roof's rate. The hunter's turn after you tops out at
   839 to 841 m under the roof and at 718 to 735 m without it.
2. Above 800 m the allowed climb is below level (by its formula, about -3.5
   degrees at 827 m and 98 m/s in the pilot's units), so level flight is
   already over it and every answer is replaced. In a bank the replacement
   points the nose `TURN_ROUND` (35 degrees at 60 degrees of bank) round
   the way it is turning, which keeps the bank, which keeps it turning. In
   the Dip and the Ninja the hunter flies a 45 degree bank turn at about 16
   degrees a second at 825 to 836 m from its let-go to the end of the fight
   in all nine (traced: start 0), through a `let-go` whose plan is a fixed
   heading home; it never comes back down to 800 m. The Dip as written,
   turning away from it at the same height, is held in the same turn, and
   the two circle each other 194 to 1,072 m apart (12 to 42 s).

## The ceiling guard (2026-11-11, before the roof)

Measured before the roof, from starts at 768 m (you) and 794 m (the hunter)
on the F-16. None of it is the fight now; it is kept for why the lesson's
zoom was given up.

Commit `726b12eb6` made every pilot's "nose over above 880 m" guard read
the 880 m over the airframe's pace, so on the F-16 it fires at 880 m real,
not at 1,126 m (past the 1,000 m where a wing lifts nothing). The break,
the counter and flying straight never climb that high and fly identically.
The three moves all go up, and all three moved.

**Why the Dip broke** (`--trace dip --step 1 --start 4`, before and after):

- Before the fix the Dip pilot zoomed at 70 degrees from 746 m (8 s in) to
  1,170 m and went over the top 16.9 s in at 66 m/s (52 in the Spitfire's
  units, `btUpAndAway`'s zoom end). The hunter's guard waited for 1,126 m,
  so `follow` took them up after you to 1,127 m, into air with almost no
  lift, and they wallowed there at 57 to 65 m/s. That was "they follow you
  up and slow", and the run from the top got away from a slow hunter. The
  9 of 9 was the broken guard's.
- With the fix the hunter's guard takes their stick at 880 m: they level
  off at 951 to 955 m (1,033 m in one start) and never go under 95 m/s.
  They do not follow and they do not slow.
- The Dip pilot's own guard takes the stick at 880 m too, but cannot stop a
  70 degree jet climb: above 880 m the wing has 12% of its lift or less,
  too little to bring the nose down against the F-16's thrust, and while
  the guard holds (`vy > 0`) the plan is not stepped, so the zoom's own end
  (52 m/s or 9 s) is never read. The jet goes on up to 1,586 to 1,601 m
  and comes over the top 26 s in at 34 to 44 m/s.
- From the top, `over` waits 8 s (and now dives: the hunter's nose comes
  off you as they let go, 30 to 32 s in), and the run starts 44 to 47 s
  in at 35 m/s. The hunter gave up 31 to 33 s in and turned back the way
  they came, which is toward you: at 50 s you are 1.2 to 1.5 km apart and
  closing in every start, so `scoreMove` fails it on `opening` (in one start
  they come back to meet you and land 2 rounds at 47 s, 60 m off).

**What was tried for a jet Dip before the roof** (a `jetBtDip` plan in
`dogfight-jet-plan-break-turn.js`, flown from the measure's nine, not kept
then; the straight-on run under that name is kept now, above):

- Break, then straight away at full throttle on the heading flown as they
  pass, nose 6 to 25 degrees down, or always directly away: 0 of 9. A jet
  does not outrun a jet. The hunter comes round and sits 250 to 350 m
  behind with their nose on you for the rest of the fight (6 to 10 degrees
  down: never hit, never let go; 15 to 25 degrees down: they cut inside and
  land 8 to 65 rounds).
- Break, then a capped climb at 30 to 70 degrees: anything steeper than
  about 30 degrees goes through the 880 m guard and on to 1,000 to 1,500 m,
  however early the plan meant to level off, for the reason above; at 30 to
  45 degrees it levels under the guard and the hunter follows at the same
  speed, 250 to 500 m back: 0 to 1 of 9.
- The lesson's own Dip with its starts 300 m lower (Spitfire units), so the
  zoom has room under 880 m: the hunter does slow after their turn and
  gives up 22 s in, but the zoom still does not end on speed and goes on up
  to 1,040 to 1,540 m; 0 to 5 of 9 over a grid of zoom angles and caps,
  never steady.

None was the small change RETUNING.md allows, and none was the Spitfire's
tactic, so the lesson's own Dip stayed then and said what it did: 0 of 9.

**A note for the shared guard** (`dogfight-pilot.js` `guard`, not changed
here): it tests height and `vy > 0` only, and points the nose at the
horizon. A jet already climbing steeply when it reaches 880 m cannot be
levelled from there; a guard that began easing the climb earlier (from
the height the vertical speed will carry it to) would keep jets under the
top of the sky. The roof (above) is that change, made for every jet pilot.

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
3. **The break and the counter hold** as they do on the Spitfire, with the
   jet's own sizes: a circle about 135 m across at 70 to 80 m/s, the
   attacker swinging back in 110 m behind, the yo-yo 40 to 70 m above. (The
   moves held too on 2026-11-10; the ceiling guard and the roof, above,
   changed them.)

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

| Demo | As written | Re-tuned (2026-11-10) | Under the roof (2026-11-11) |
|---|---|---|---|
| without (cruiser vs chaser) | shot down 1 of 9 (33 s); the rest 5 to 20 hits, attacker through their tail 20 s in | shot down 9 of 9, 29.5 to 40.2 s in, from 25 to 30 m behind; the target lands nothing | unchanged (starts at 384 and 410 m) |
| move (they break) | never down; 1 to 6 hits on the breaker, all by 4.2 s; attacker past 13 to 43 m off, 4.5 s in | never down; 0 to 4 hits on the breaker, all 1.1 to 3.5 s in; attacker past 42 to 71 m off, 4.3 to 7.0 s in; reverse 4.1 s; then 107 to 129 m behind, nose 45 to 60 degrees off, no landing shot after 8 s | unchanged; tops 472 and 486 m |
| counter (you stay patient) | never down; 0 to 1 hits; yo-yo 41 to 85 m above | never down; 0 to 1 hits, both at 1.2 s; yo-yo from 0.5 s, more than 30 m above from 3 s in every start, 40 to 73 m (median), never within 59 m | unchanged; tops 520 and 587 m |
| dip | 0/0 in all nine | 0/0 in all nine. With the guard fixed: 0/0, over the top at 1,590 to 1,600 m, 1.2 to 1.5 km apart and closing at 50 s | the jet Dip (`jetBtDip`): 0/0 in all nine, the hunter lets go, 4.9 km apart at 50 s; you never above your 704 m start, the hunter 840 |
| flip | 0/0 | 0/0. With the guard fixed: the Flip lands 1 and 2 rounds in two starts, in the head-on pass 43.4 to 43.8 s in; the zoom in five of nine, 45.1 to 46.4 s in; closest 27 to 107 m | 0/0, no zoom in any start; you top out at 780 m, the hunter 840 |
| ninja | 0/0 | 0/0. With the guard fixed: 0/0, the Dip's flight, with a dive 30 to 32 s in and no shot | 0/0, no dive in any start; levelled at 832 m, the hunter 840 |

In two `counter` starts the breaker slows to 43 to 45 m/s and finds the
attacker out in front of its nose (`chase`, 10.9 s); no round lands.

## The moves, as the school scores them

Counted with `dogfight-measure.js` `scoreMove` / `verdictOf` over the
measure's nine `STARTS` (not the harness's), on the F-16, as `movesOn`
does. `MEASURE` in the test file flies them; every number in the verdicts
is from it. The Flip and the Ninja fly the same with and without the jet
file; the Dip is the jet file's own seat (`jetBtDip`) since the roof.

Under the roof (2026-11-11), as above: **Dip (`jetBtDip`) 9 of 9, Flip 0 of
9, Ninja 0 of 9**; the lesson's own Dip (`btDip`) 0 of 9, the Ninja's flight.
Survival "yes".

| Move | Before the guard fix | Guard fixed | Under the roof |
|---|---|---|---|
| Dip | 9 of 9 (the hunter wallowing above 1,000 m) | 0 of 9 (over the top at 1,600 m, closing at 50 s) | `btDip` 0 of 9 (levelled at 832 m beside the hunter, 253 to 331 m apart and closing at 50 s); `jetBtDip` 9 of 9 (4.8 to 5.0 km and opening) |
| Flip | 0 of 9 | 0 of 9 (zoom in three, 44 to 45 s in) | 0 of 9 (no zoom in any) |
| Ninja | 0 of 9 | 0 of 9 (dive from 1.2 km, no shot) | 0 of 9 (no dive in any) |

With the ceiling guard fixed, before the roof (2026-11-11):

- **Dip: 0 of 9** (was 9 of 9). Their guns never have you and no round
  lands after the run starts. Over the top at 1,586 to 1,601 m, 26 s in, at
  34 to 44 m/s; the hunter levels off at 951 to 955 m (1,033 in one), never
  under 95 m/s after 8 s, and lets go 31.5 to 32.9 s in. The run starts
  43.9 to 46.8 s in at 32 to 36 m/s; at 50 s every start is closing
  (`opening` -205 to -338 m over the last 3 s), 1,207 to 1,472 m apart, and
  in one 60 m, where the hunter turns to meet you (40.8 s) and lands 2
  rounds at 47.0 and 47.2 s. Why: "The ceiling guard", above.
- **Flip: 0 of 9.** From 12 to 42 s the hunter is 110 to 858 m away and
  from 97 m below you to 119 m above (the hunter's guard now holds them
  under 894 m), never dead astern inside 155 m. Head-on pass 39.8 to 44.6
  s in; the zoom in three starts only, 43.7 to 45.0 s in (no flip phase in
  six). Their rounds never land; in one start you land 1 round in the
  head-on pass, 43.8 s in.
- **Ninja: 0 of 9.** The Dip's flight: over the top at 1,586 to 1,601 m;
  the hunter's nose comes off you as they let go, and the dive does come,
  30.2 to 31.5 s in, from 1,159 to 1,331 m away and 552 to 615 m above
  them: no shot. They sit on your six 1.47 to 1.83 s once, 10.8 to 11.8 s
  in, as you start up; in one start they land 2 rounds at 47 s as you
  leave.

Before the fix: Dip 9 of 9 (the hunter followed the zoom to 1,127 m and
slowed to 57 to 65 m/s, let go 32 to 33 s in; 1.2 to 1.4 km apart and
opening at 50 s); Flip 0 of 9 (hunter 110 to 750 m away and 22 to 142 m
above, zoom 46 to 48 s in after a head-on pass at 43 to 46 s, no round
either way); Ninja 0 of 9 (no dive phase in any start, six 1.4 to 1.6 s).

## The MiG-29

Same jet file (`--plane Mig29`, pace 1.5): flying straight is shot down in
only 3 of 9 (43.5 to 44.7 s), 4 to 16 hits in the rest; the break is never
shot down (0 to 2 hits); the patient attacker lands nothing and the yo-yo
sits 46 to 260 m above. Under the roof (2026-11-11) those three fly as
before (starts 450 and 480 m, tops 563 to 789 m). The moves start at 740 m
(the hunter) and 735 (you): the jet Dip gets away in 9 of 9, never hit, the
hunter letting go 16.6 to 17.3 s in and staying at 841 to 852 m, 5,815 to 5,897 m apart
and opening at 50 s; the Flip 0 of 9 and the Ninja 0 of 9 (levelled at 847
m, leaves 24.8 to 25.2 s in, 609 to 672 m apart and closing at 50 s). The
highest anyone goes is 855 m (the hunter). Before the roof the Dip scored 2
of 9 before the guard fix and 0 of 9 after it, its zoom going on up to
1,477 to 1,702 m. Tuned on the F-16 only.

## Open

- `RETIRED_DEMOS['break-turn']` is not reached by `lessonFor` (it merges
  `jet.demos` over `lesson.demos` only), so `without` can only be tuned
  through `ace`, `you` and `seconds`. Nothing needed now.
- `breakTurn` and `btFlip` hold 52 m/s in `watch` (`holdSpeed(c, 52)`); on
  a jet the break comes at 0 s so it never matters here, but a jet start
  further out would cruise at 67 m/s, not at its start speed.
- **The way out rests on the roof's turn.** `jetBtDip` gets away 9 of 9
  because the hunter's turn after you is climbed into the roof and held
  there in a level 45 degree bank turn ("The roof's turn", above); against
  a hunter left out of the roof it is 0 of 9 and is hit in 5 of 9. If
  `underRoof` comes to fly the smaller of the plan's climb and the roof's,
  or to let a level turn roll out above 800 m, re-fly all three moves and
  expect the Dip to go back to "never hit, never away" (survival "no").
- FLY IT's guide is the counter (`patientAttacker`), and its ace is
  `breakTurn`; neither flies the jet Dip. Not changed here.
- The MiG-29 is not tuned (above).
