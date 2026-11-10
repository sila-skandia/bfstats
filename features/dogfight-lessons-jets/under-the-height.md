# When they have the height, on a jet

Status: **re-measured under the roof** (2026-11-11). Every jet pilot now
levels off by 800 m and the ace starts at 735 m on the F-16; nobody is fired
at in any of the three demos, both climbs end level with the ace under the
top of the sky, turning flat loses, and the Dip is the jet's own
(`jetUhDip`): 9 of 9. Flip 0, Ninja 0. Files:
`tools/bf1942-models/viewer/dogfight-jet-under-the-height.js` (the jet block),
`viewer/dogfight-jet-plan-under-the-height.js` (`jetBoomAndZoom`, `jetUhAce`,
`jetUhDip`), `viewer/dogfight-jet-ceiling.js` (the roof, shared),
`tools/bf1942-models/tests/test_dogfight_jet_under_the_height.py` (every number the
words make, the ace's roof and slowest speed, and the tops of both planes).

History: re-tuned for jets 2026-11-10 (RETUNING.md); re-flown 2026-11-11
against a jet ace that levelled off under the top of the sky, then with every
pilot's ceiling guard read over the pace; re-measured the same day once every
jet pilot flies under the roof (below).

## What was found

On a Spitfire the lesson is: climbing straight under a boom-and-zoomer is fatal
(down to 35 m/s on a straight line, shot down 9 of 9); turning flat is safe and
gains nothing; climbing between their dives wins the height back. On the F-16,
flown as written from the nine starts, **nobody is fired at, in any of the three**.
The diver cannot catch a jet that climbs: nose 30 degrees up at full throttle,
the F-16 *gains* speed as it climbs. The Spitfire's trap was the speed bleeding
away in the climb; a jet has the thrust not to bleed. That still holds under
the roof.

## Under the roof (2026-11-11)

Commit `8d616bcc2` (`jet-roof`) put every jet pilot under a roof: whatever a
plan answers on an airframe paced as a jet goes through `underRoof` in
`stepPilot`, which levels the climb off by 800 m real, and paced start heights
are bent over toward 760 m (`pacedHeight`). For this lesson that moved two
things:

- **The ace starts lower.** 735 m real on the F-16 (750 on the MiG-29), not
  896: 505 m over you at 230 m, not 666. Their dive starts 1.04 to 1.05 km
  out.
- **Nobody can climb past about 840 m.** The roof holds both planes; the guard
  (880 m) and the top of the sky (1,000 m) are never reached.

What is flown now, on the F-16:

- **There is no trap.** Climbing straight you are at their height 13.3 to 13.5 s
  in, going from 72 to 125 m/s. Their one dive starts at 10 s; at 13.6 to 13.8 s
  they pull out of it 409 to 448 m behind you and 5 to 8 m under you, without
  firing. They never dive again.
- **The roof takes the rest of their edge.** You level off at 829 to 836 m, they
  at 829 to 837; their energy edge is gone at 28.5 to 32.6 s, and at 55 s both
  are at 828 to 829 m at 125 m/s, 0 to 2 m of energy apart. The old claim, "the
  straight climb levels off at 950 m and ends 100 to 180 m ahead", is gone: the
  950 m was over the roof, and the lead came from the ace levelling 80 m lower.
- **Climbing between their dives ends the same.** One break, at 436 to 484 m;
  their height at 24.0 to 25.0 s, about 11 s after the straight climb; 67 to
  100 m of energy ahead for a moment at 26.5 to 30.9 s; then the roof evens it:
  828 m at 125 m/s, 0 to 1 m apart. The old "120 to 130 m ahead, 50 m above
  them" is gone for the same reason.
- **Turning flat still loses.** Three dives (four in one), never fired at; you
  climb 126 to 128 m and end at 357 to 358 m at 83 m/s, 345 to 571 m of energy
  behind; they top out at 753 to 754 m.

So the lesson on a jet: their height is worth about 13 s against a straight
climb at full throttle, and neither of you can get above the other once you are
both under the top of the sky. Climb, either way; only turning flat gives them
the sky.

### The Dip on a jet (`jetUhDip`)

The lesson's Dip (`uhDip`) runs once their height is spent and you have 50 m
of energy on them. Under the roof nobody gets 50 m: both planes end at the roof
at the same speed. Flown with the roof and no jet file change, the run started
in two of nine, and both turned back at the ace: **0 of 9**, the lesson's way
out gone. The jet's Dip is `uhDip` with two changes:

- **Run once even** (`EVEN`, 10 m in the Spitfire's units): level with them, the
  energy within 10 m, their nose more than 90 degrees off you and you flying
  away from them (more than 120 degrees off your nose).
- **Down off the roof first**: 5 degrees nose down until under 780 m real, then
  the Spitfire's 2 degrees. While over 780 m the answer says `roof: false`: up
  there, flown level, `underRoof` holds the nose and keeps a bank going round
  (below), so a run begun in a turn kept turning, back at them.

From the nine starts: never fired at, never on your tail; the run starts 27.7
to 37.0 s in, they let you go 36.9 to 45.8 s in, and at 70 s you are 4.6 to 6.0
km apart at 120 to 125 m/s. **9 of 9.** It has its own step list (climb, break,
run), each step coming in order.

### The wrapper

`jetBoomAndZoom` and `jetUhAce` used to put their own answer through
`underRoof`; `stepPilot` now does it for every jet pilot, so that call is gone.
Every number of the nine starts of all six demos was the same without it
(`underRoof` is idempotent: the second pass computes the same allowed climb and
nose from the same state). The `atRoof` -> `reverse` hand-over stays: without
it the zoom waits to be slow, which a jet under the roof is not.

## What the jet file says

`note`, `story`, `counterStory`, the notes of all six demos, jet `verdict`s for
the Dip, the Flip and the Ninja, the Dip's `steps`, `survival`, `coach`, and the
aces (`ace.plan` `jetBoomAndZoom`; the Dip, the Flip, the Ninja and FLY IT's
`flyAce` `jetUhAce`; the Dip's seat `jetUhDip`). The claims, one by one:

- "Climbing straight is fatal": **false** on a jet. Never fired at; at their
  height in 13.5 s; level with them at the end.
- "Turning flat is safe and buys nothing": **holds**, the jet's numbers.
- "Climbing between their dives wins the height back, never hit": **holds**, but
  no better than the straight climb: it gets their height about 11 s later and
  ends at the same place.
- The coach's "380 m" is the plans' threshold in the Spitfire's units, 486 m
  real: "about 490 m". The climb and zoom tips say level off by 800 m.

## The nine starts on the F-16

"Before the roof" is this page's previous measure (the jet ace with the guard,
perch 896 m); "under the roof" is now. Harness starts (sideways -30/0/30 by
speed -3/0/+3) for the first three; the school's L9 starts (`dogfight-measure.js`
`STARTS`) for the moves, each scored by `scoreMove` as `movesOn` scores them.

| Demo | Before the roof | Under the roof |
|---|---|---|
| move, climb straight | 0/0; their height 10.6-10.7 s; you level at 946-949 m, the ace at 869-871; ends +99 to +179 m | 0/0, never fired at; their height 13.3-13.5 s; they pull out 409-448 m behind you at 13.6-13.8 s; you top 829-836 m, they 829-837; ends 828-829 m at 125 m/s, 0 to +2 m |
| flat, turn flat | three dives; ends 357-358 m at 83 m/s, -391 to -487 m | three dives (four in one), never fired at; climbs 126-128 m, ends 357-358 m at 83 m/s, -345 to -571 m |
| counter, climb between | one break at 483-486 m; their height 23.9-24.1 s; ends 912-915 m, +120 to +130 m | one break at 436-484 m; their height 24.0-25.0 s; +67 to +100 m at 26.5-30.9 s; ends 828-829 m at 125 m/s, 0 to +1 m |
| dip | **9 of 9** (`uhDip`) | `uhDip`: **0 of 9** (the run starts in two, and turns back). `jetUhDip`: **9 of 9**, never fired at; run 27.7-37.0 s; let go 36.9-45.8 s; 4.6-6.0 km apart at 70 s, 120-125 m/s |
| flip | **0 of 9**: the reversal flown once | **0 of 9**: the reversal flown in two (27.5, 50.4 s), no shot |
| ninja | **0 of 9**: the energy yours in all nine, never a shot | **0 of 9**: the energy never yours by the margin it waits for, in any of the nine; never fired at |

The ace from 5 s on, every start of every demo: never over 837 m, never slower
than 83 m/s. `jet_tops`: nobody tops 840 m in any demo or move; the test holds
both planes under 860 m.

## The MiG-29 (pace 1.5), the same jet file

The words are the F-16's. The MiG-29's ace starts at 750 m, 480 m over you at
270 m and 1.17 to 1.19 km out, climbs no higher than 852 m and never flies
slower than 109 m/s. Nobody is hit in any of the three; the ace fires in one
flat turn of nine and misses. The straight climb is at their height at 12.4 to
12.8 s and ends 9 m ahead, both at 847 to 851 m and 154 m/s; climbing between
breaks once at 333 to 353 m and ends 1 m behind, both at 847 m; turning flat
climbs 142 to 145 m and ends 900 to 914 m behind. Dip 5 of 9 (never hit, 2.2 to
4.3 km apart at 70 s; the four that do not count pass within 15 m of the ace,
which the score counts as a collision), Flip 0 of 9 (the reversal flown in six,
no shot), Ninja 0 of 9. Tops: 847 to 852 m in every demo and move.

## Tried and not shipped

- **The guard alone**, no roof (before the shared roof): the ace's zooms ran on
  to 963 to 984 m before the guard caught them.
- **A roof at 900 m**: at a tenth of the lift the ace cannot hold level there
  and wallows. 800 m flies level.
- **Reading the pace off gravity**: the side force swamps it (0.49 for 1.28).
- **The jet Dip without `roof: false`** over 780 m: 0 of 9. The run is begun
  banked at 828 m, the roof holds the bank (the plan's full roll command leaves
  it at -44 to -47 degrees for 10 s), and you circle back at them.

## Open

- **The roof holds a bank above 800 m.** `underRoof` acts whenever the path is
  above the allowed climb plus 2 degrees, which above the roof is any level
  flight, and in a bank it puts the nose 35 degrees round the turn, replacing the
  plan's roll. A plan flying level above 800 m cannot roll out. Measured in the
  Dip, start 0: from 35.8 s, roll 1 commanded, the bank stays at -44 to -47
  degrees for 10 s; with `roof: false` it rolls level in 1 s. It is likely why
  both planes in this lesson circle at 828 m once there, and it may touch other
  lessons. A
  shared fix (not rolling round when the plan is rolling out, or not acting on
  a level or descending path) would be a re-measure of the school.
- **Near misses.** In the counter the diver passes 58 to 87 m from you; in the
  straight climb the two planes come within 5 to 73 m of each other in eight of
  nine. The duel does not model a collision.
- **The Flip and the Ninja** were not re-tuned: the reversal waits for a slow
  overshoot the jet diver almost never gives; the ascendancy waits for an
  energy edge the roof never allows. 0 of 9 is the verdict.
- **The live fight** (FLY IT) flies `jetUhAce` ([live-fight.md](live-fight.md));
  nobody has flown it by hand.
