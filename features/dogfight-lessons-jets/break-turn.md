# The break turn on a jet

Status: **re-tuned on the F-16** (2026-11-10); re-measured with the ceiling
guard fixed (2026-11-11); **re-measured under the roof as reworked**
(2026-11-11, below). A jet Dip of the lesson's own (`jetBtDip`: break, up,
and away with the nose on the horizon) gets away in 9 of 9 on both jets
against a hunter free to chase; the Flip and the Ninja are 0 of 9;
survival is "yes". Files:
`tools/bf1942-models/viewer/dogfight-lessons/jets/break-turn.js` (the jet block),
`tools/bf1942-models/viewer/dogfight-lessons/jets/plan-break-turn.js` (`jetBtDip`),
`tools/bf1942-models/tests/test_dogfight_jet_break_turn.py`.

## Under the roof (2026-11-11)

Every jet pilot flies under a roof (`jet-roof`, `8d616bcc2`, reworked in
`868247883`). `underRoof` (`dogfight-jet-ceiling.js`) caps how hard a plan
may pull toward the sky, in the plane's own pitch plane, by the climb the
height left allows less the pitch rate under way; a plan asking for less is
flown as it asks, its roll, rudder and trigger are its own, and the
throttle comes off only while the nose is more than 15 degrees over the
allowed climb. Paced starts are bent over toward 760 m (`pacedHeight`): the
Dip, the Flip and the Ninja start at 712 m (the hunter) and 704 m (you) on
the F-16, 740 and 735 on the MiG-29 (794 and 768 on the F-16 before the
roof). `move` and `counter` start at 384 and 410 m, top out at 472 to 587
m and fly as before; their tests did not move.

Over the measure's nine starts on the F-16:

- **The zoom levels off under the roof.** `btUpAndAway`'s 70 degree zoom
  from 7.3 s levels off at 756 to 759 m, 17.2 to 17.7 s in, at 111 to 113
  m/s. The hunter comes up after you to 750 to 762 m with its nose on you;
  nobody hangs and nobody circles.
- **The Spitfire's Dip (`btDip`, the Ninja's flight to the last decimal):
  5 of 9.** It leaves 24.2 to 24.6 s in, straight away 8 degrees nose down.
  In five starts the hunter, not closing past 563 to 610 m, lets go 30.9 to
  31.4 s in, and you are 4.1 to 4.2 km apart at 50 s. In four it sits 493
  to 500 m behind you to the end, just inside the 550 m it gives up
  outside, nose on you, at your speed: lower down a jet is slower, and the
  run never draws out.
- **The jet Dip (`jetBtDip`): 9 of 9.** The same break, zoom and 8 s over
  the top, then away with the nose on the horizon (`dogfight-jet-plan-
  break-turn.js`). You run up where the air is thinner (traced on start 0:
  730 to 770 m), at 127 m/s at the end; 564 to 619 m behind you and not closing, the hunter lets go
  30.9 to 34.5 s in. At 50 s you are 3,608 to 4,460 m apart and opening.
  No round lands either way. They come past you 83 to 101 m off; as you go
  up they sit on your tail up to 4.67 s and have a shot that would land for
  0.77 s at most, but do not land one.
- **The Ninja: 0 of 9.** You are 50 to 55 m above them over the top, but
  their nose stays on you and the dive never comes; you leave, and the run
  is `btDip`'s (above). It never fires.
- **The Flip: 0 of 9.** From 12 to 42 s they are 25 to 744 m away and from
  41 m below you to 69 m above, never dead astern inside 155 m in time: the
  zoom comes in two starts, 40.7 and 40.9 s in. Their rounds never land;
  yours land in three of the nine, 1 round each, 38.4 to 39.3 s in
  (re-flown 2026-11-12 on retail g and box area; it was once, 39.3 s in).

What was tried for the jet Dip on this roof, each over the nine on the
F-16 (the run's nose angle after the same break, zoom and 8 s over):

| Run from the top | Count |
|---|---|
| level (kept) | 9 of 9, 3.6 to 4.5 km at 50 s |
| 2, 3 or 4 degrees down | 9 of 9 |
| 5 or 6 degrees down | 8 of 9 |
| 8 degrees down (`btDip`) | 5 of 9 |
| 15 degrees down | 5 of 9 |
| 4 s over the top instead of 8 | 0 of 9 |
| 12 s over the top | 1 of 9 |
| a 45 or 30 degree zoom | 1 and 4 of 9 |
| no zoom: break, then straight on 6 degrees down (the first roof's `jetBtDip`) | 0 of 9: the hunter sits on your six 20 to 32 s, never hits, 201 to 262 m behind and closing at 50 s |

On the MiG-29 every one of the "down" runs above is 9 of 9.

The margin is the hunter's own rule: it gives up past its reach plus 30 m
(550 m real on the F-16) when not closing for 6 s, and the level run is 14
to 69 m past that when it does. A change to the hunter or to the jet's drag
at height would move it first.

**The first roof, as history** (`8d616bcc2` alone): it put the nose on the
climb the roof allowed and turned a banked plane on round the turn, so the
hunter climbed to 840 m and circled there at 45 degrees of bank; the
straight-on `jetBtDip` got away 9 of 9 only because of that, and was 0 of 9
against a hunter left out of the roof. `868247883` removed both.

## The ceiling guard (2026-11-11, before the roof)

Measured before the roof, from starts at 768 m (you) and 794 m (the hunter)
on the F-16. None of it is the fight now; it is kept for why the lesson's
zoom was given up.

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
`dogfight-lessons/jets/plan-break-turn.js`, flown from the measure's nine, not kept
then; the name now holds the up-and-away-level run, above):

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
   cannon, small tail-on target: 6 to 17 rounds land on the closing run
   against the 22 that bring it down. Shot down in 2 of 9 (re-flown
   2026-11-12 on retail g and box area; it was 1 of 9, 5 to 20 rounds).
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
| without (cruiser vs chaser) | shot down 2 of 9 (36 and 38 s; 1 of 9 before retail g); the rest 6 to 17 hits, attacker through their tail 20 s in | shot down 9 of 9, 29.5 to 40.2 s in, from 25 to 30 m behind; the target lands nothing | unchanged (starts at 384 and 410 m) |
| move (they break) | never down; 1 to 6 hits on the breaker, all by 4.2 s; attacker past 13 to 43 m off, 4.5 s in | never down; 0 to 4 hits on the breaker, all 1.1 to 3.5 s in; attacker past 42 to 71 m off, 4.3 to 7.0 s in; reverse 4.1 s; then 107 to 129 m behind, nose 45 to 60 degrees off, no landing shot after 8 s | unchanged; tops 472 and 486 m |
| counter (you stay patient) | never down; 0 to 1 hits; yo-yo 41 to 85 m above | never down; 0 to 1 hits, both at 1.2 s; yo-yo from 0.5 s, more than 30 m above from 3 s in every start, 40 to 73 m (median), never within 59 m | unchanged (never within 56 m since the 2026-11-12 retail-g retune of `breakTurn`); tops 520 and 587 m |
| dip | 0/0 in all nine | 0/0 in all nine. With the guard fixed: 0/0, over the top at 1,590 to 1,600 m, 1.2 to 1.5 km apart and closing at 50 s | the jet Dip (`jetBtDip`): 0/0 in all nine, the hunter lets go, 3.4 to 4.4 km apart at 50 s; tops 762 (the hunter) and 770 m |
| flip | 0/0 | 0/0. With the guard fixed: the Flip lands 1 and 2 rounds in two starts, in the head-on pass 43.4 to 43.8 s in; the zoom in five of nine, 45.1 to 46.4 s in; closest 27 to 107 m | 1 round each way in two starts, nobody down; tops 767 and 768 m |
| ninja | 0/0 | 0/0. With the guard fixed: 0/0, the Dip's flight, with a dive 30 to 32 s in and no shot | 0/0, no dive in any start; tops 752 and 759 m |

In two `counter` starts the breaker slows to 43 to 45 m/s and finds the
attacker out in front of its nose (`chase`, 10.9 s); no round lands.

## The moves, as the school scores them

Counted with `dogfight-measure.js` `scoreMove` / `verdictOf` over the
measure's nine `STARTS` (not the harness's), on the F-16, as `movesOn`
does. `MEASURE` in the test file flies them; every number in the verdicts
is from it. The Flip and the Ninja fly the same with and without the jet
file; the Dip is the jet file's own seat (`jetBtDip`) since the roof.

Under the roof as reworked (2026-11-11), as above: **Dip (`jetBtDip`) 9 of
9, Flip 0 of 9, Ninja 0 of 9**; the lesson's own Dip (`btDip`) 5 of 9, the
Ninja's flight. Survival "yes".

| Move | Before the guard fix | Guard fixed | First roof (`8d616bcc2`) | Roof reworked (`868247883`) |
|---|---|---|---|---|
| Dip | 9 of 9 (the hunter wallowing above 1,000 m) | 0 of 9 (over the top at 1,600 m) | `btDip` 0 of 9 (circling with the hunter at 830 m); straight-on `jetBtDip` 9 of 9 (the hunter held circling) | `btDip` 5 of 9; `jetBtDip` (up, away level) 9 of 9; straight-on 0 of 9 |
| Flip | 0 of 9 | 0 of 9 | 0 of 9 (no zoom) | 0 of 9 (zoom in two, 41 s in) |
| Ninja | 0 of 9 | 0 of 9 | 0 of 9 (no dive) | 0 of 9 (no dive) |

MiG-29: first roof, straight-on `jetBtDip` 9 of 9, Flip 0, Ninja 0; reworked,
`jetBtDip` 9 of 9, `btDip` 9 of 9, Flip 0, Ninja 0.

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
(the hunter) and 735 (you). On the reworked roof the jet Dip gets away in 9
of 9, never hit, the hunter letting go 16.3 to 16.9 s in, 655 to 746 m
behind you; at 50 s you are 6,754 to 7,141 m apart and opening. The
Spitfire's Dip gets away in 9 of 9 too: the MiG-29's run from the top
draws out nose down as well. The Ninja is 0 of 9 (it never fires, though
its run gets away, 6.5 to 6.9 km at 50 s) and the Flip 0 of 9 (the zoom in
five, 34.5 to 37.1 s in; no round lands). The highest anyone goes is 847 m:
the hunter in the Flip, in a reversal at 113 to 120 m/s (below). On the
first roof the jet Dip (straight on) was 9 of 9, the hunter held circling
at 841 to 852 m. Before the roof the Dip scored 2
of 9 before the guard fix and 0 of 9 after it, its zoom going on up to
1,477 to 1,702 m. Tuned on the F-16 only.

## Open

- `RETIRED_DEMOS['break-turn']` is not reached by `lessonFor` (it merges
  `jet.demos` over `lesson.demos` only), so `without` can only be tuned
  through `ace`, `you` and `seconds`. Nothing needed now.
- `breakTurn` and `btFlip` hold 52 m/s in `watch` (`holdSpeed(c, 52)`); on
  a jet the break comes at 0 s so it never matters here, but a jet start
  further out would cruise at 67 m/s, not at its start speed.
- **The way out is a thin margin.** The hunter gives up past 550 m and
  not closing; the level run is 564 to 619 m behind at its let-go, and 5
  or 6 degrees down already loses one start. It rests on a jet being
  faster at 750 m than at 650.
- **The MiG-29's hunter goes over the roof in a reversal.** In the Flip
  (start 3 of the nine, `bt.mjs`-style trace) it rolls from 52 degrees of
  bank one way to 71 the other between 38 and 39 s at 113 m/s, still
  pulling, and climbs 732 -> 765 -> 798 -> 821 -> 835 -> 847 m from 38 to
  43 s before it comes down. The roof caps the pull toward the sky by the
  share of the lift pointing up; probably, while the wings pass through level that
  share is all of it, and the climb already under way carries on. 847 m is
  under the guard's 880 and the 860 the tests allow, so nothing here
  changes for it.
- FLY IT's guide is the counter (`patientAttacker`), and its ace is
  `breakTurn`; neither flies the jet Dip. Not changed here.
- The MiG-29 is not tuned (above).
