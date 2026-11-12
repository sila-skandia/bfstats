# Breaking the circle on a jet

Status: **re-worded, no fight changed; re-measured under the roof**
(2026-11-11, the roof as reworked in `868247883`). On the F-16 none of the
six ways out breaks the circle, the Spitfire's one answer (leaving)
included, and with every jet pilot under the roof none does still (0 of 9
each); the zoom now ends level with them under the top of the sky.
The jet file (`tools/bf1942-models/viewer/dogfight-lessons/jets/the-circle.js`) says
so with the nine flights' numbers; every try flies the plan it flies on the
Spitfire. The plan file holds no plan. Tests:
`tools/bf1942-models/tests/test_dogfight_jet_the_circle.py`.

**2026-11-11, the ceiling guard.** Every pilot noses over above 880 m; a jet's
pilot, shown the fight at the Spitfire's size, waited for 1,126 m real until
the guard read its 880 m over the pace (commit `726b12eb6`). Re-flown with
it, only the zoom moved: still 0 of 9, but it now ends above them, not
under them (table below; its words and test rewritten). Every other try,
and the MiG-29's harness numbers, are unchanged to the metre.

## Under the roof (2026-11-11)

Every jet pilot flies under a roof at 800 m real (`dogfight-jet-ceiling.js`
`underRoof`, called from `stepPilot`). As first shipped (`8d616bcc2`) it
put the nose on the climb the height left allowed and held a banked turn on
level; as reworked (`868247883`) it only caps how hard the plan may pull
toward the sky, in the plane's own pitch plane and less the pitch rate
under way, and leaves roll, rudder and trigger to the plan; a pull over a
loop whose predicted top is under 800 m is left alone, and the throttle
comes off while the nose is more than 15 deg over the allowed climb. The
cap acts wherever the roof allows less than 60 deg of climb, which for a
jet at 80 to 100 m/s is from about 500 to 560 m up. This lesson's starts
are at 512 m real on the F-16 (400 at the Spitfire's size), under the 600 m
knee of `pacedHeight`, so no start moved; but the circle is flown at 512 to
750 m, so every try moved a little. F-16, nine `STARTS` each:

| Try | Before the roof | First roof | The roof now |
|---|---|---|---|
| `circle` | 50 to 279 m apart, 85 to 90 m/s | the same | 50 to 279 m apart, 85 to 102 m/s; climbs 142 to 189 m in 30 s (harness starts) |
| `dip` | 285 to 361 m behind you, guns bearing 16 to 23 s | the same | 260 to 344 m behind, guns bearing 21 to 23 s; never let go, never fire |
| `zoom` | you on up to 1,416 to 1,426 m, they to 920 to 1,368; you end 324 to 554 m over them | levelled at 822 to 832 m, they 802 to 835; at most 134 to 175 m over them at 38 to 46 m/s; over the top started in two; level at 30 s (-12 to +69 m); let go in three; one round on you in one | levelled at 765 or 766 m, they 766 to 768; at most 103 to 118 m over them, never slow enough to go over the top; level at 30 s (-3 to +5 m), both at 124 m/s; never let go; their guns bear 0.4 to 1.4 s, no round lands |
| `back` | pass 29 to 42 m apart; guns bearing 12 to 35 s; 10 to 44 rounds on you in six; shot down in two | the same | pass 30 to 40 m apart; guns bearing 13 to 35 s; 5 to 26 rounds on you in five; shot down in two |
| `chop` | 272 to 320 m under them, 514 to 563 m of energy behind | 277 to 323, 510 to 644 | 246 to 272, 602 to 682 |
| `reverse` | no pass, 98 to 160 m at the closest | the same | no pass, 92 to 146 m |
| `low` | no landing fire; in their rear quarter in seven at 37 to 40 s | 0.13 s of landing fire in one; rear quarter in three at 33.5 to 35.8 s | no landing fire; rear quarter in seven at 26.7 to 37 s, no shot |

All six stay 0 of 9; no verdict flipped and the survival verdict stays
**no**: nothing gets you out, so FLY IT's guide stays `ciCircle`. In the
first roof the zoom and the nose-low try reached the roof and were flown in
its held level turn; now the zoom's climb is capped at 765 to 768 m and the
nose-low try tops out at 719 to 764 m, and nobody is held in a turn. The
highest anyone goes in any demo or try on the F-16 is 768 m (harness
starts 767), on the MiG-29 818 m (was 836 and 854 under the first roof).

## How it was counted

Verdicts and the numbers in the words come from the nine starts the school
scores a move from (`dogfight-measure.js` `STARTS`, the L9 array over
sideways, along, height and speed), each try scored with `scoreMove` and
measured with the Spitfire's own per-start circle measure
(`tests/dogfight_dfn_ci.mjs`), run over the published F-16 with the lesson
as the jet flies it. The test builds that scorer itself (the Spitfire
harness's head swapped for one that loads the viewer in place, as
`dogfight_jet_harness.mjs` does). `jet_lesson` (the harness's own nine
starts, sideways by speed) checks the outcomes again: the same in both.
Metres and m/s are the jet's real ones.

## What the F-16 does, try by try

The fights before and after the jet file are the same: nothing but words changed. Every row is under the roof as it is now; the zoom's row also gives the guard fix of 2026-11-11.

| Demo | Spitfire verdict | F-16, nine starts |
|---|---|---|
| `circle` | nobody's shot, 52 to 218 m apart | nobody's shot, no hits; 50 to 279 m apart for the first 8 s, both speeding up to 85 to 102 m/s; the circle climbs 142 to 189 m in 30 s (harness starts) |
| `dip` (Dip) | 7 of 9 | **0 of 9.** They turn after you and settle 260 to 344 m behind, nose on you, with a landing shot for 21 to 23 s of the 32. Never let go (no `let-go` phase), never fire, no hits. Flown to 70 s (scratch run before the roof, not on screen or in a test) they closed to 168 to 233 m and landed 2 to 14 rounds in three |
| `zoom` (Ninja) | 0 of 9 | **0 of 9.** Before the guard fix: 105 to 106 m/s at most, 274 to 322 m over them, the climb ending at the guard's 1,126 m real; you hung at 25 to 29 m/s and fell, 423 to 618 m under them at 30 s. With the guard at 880 m real: the guard could not level a 60-degree jet climb, so you went on to 1,416 to 1,426 m and ended 324 to 554 m over them at 52 to 54 m/s. Under the roof: levelled off at 765 or 766 m, they at 766 to 768 (`follow`); at most 103 to 118 m over them, never down to the plan's 30 m/s (Spitfire units) for over the top; at 30 s level with them (-3 to +5 m), both at 124 m/s, never let go. Their guns bear 0.4 to 1.4 s, no round lands; you never have a shot |
| `back` (Ninja) | 0 of 9 | **0 of 9, and it gets you killed.** Never let go, so turning back at 30 s is a pass 30 to 40 m apart and they are behind you again, a landing shot for 13 to 35 s; 5 to 26 rounds on you in five, shot down in two. You never have a shot |
| `chop` (Flip) | 0 of 9 | **0 of 9.** 37 to 38 m/s, 246 to 272 m under them, 602 to 682 m of energy behind (before the roof: 272 to 320 and 514 to 563); never in their quarter; nobody has a shot |
| `reverse` (Flip) | 0 of 9 | **0 of 9.** No head-on pass at all (the Spitfire met head-on in five): the circle turns the other way, 92 to 146 m apart at the closest; nobody fires |
| `low` (Flip) | 0 of 9 | **0 of 9.** Round behind them (100 to 131 degrees) 14 to 16 s in, 114 to 134 m under, 82 to 83 m/s; the pull up costs little but the nose never comes onto them; no round lands. In seven you sit 2 s in their rear quarter at 26.7 to 37 s, one of them inside the Flip's 20 s, none with a shot (before the roof: in seven, at 37 to 40 s) |

The survival verdict follows the Spitfire test's rule (yes if a try works,
partly if one partly works, else no): **no**, drawn as "No way out". The
line says the circle itself never hurts you.

## Why

- **An equal jet behind you does not fall back.** The Spitfire's Dip works
  because the hunter, out of reach and not closing for 6 s, lets you go. On
  the F-16 the run tops out at 99 to 107 m/s and so does the chase: they are
  never out of reach. `btHunter` reads "out of reach" as `c.gun.range + 30`;
  the jet's cannon (`ownGun`, no `range`) gets `gunOf`'s cap of 400 in the
  pilot's units (512 m real), so even the Spitfire's 268 would leave them
  inside it at 260 to 344 m (203 to 269 in the pilot's units). And
  `HUNTER_FIRE` (150, 192 m real) is the only reason they never fire with a
  landing shot for 20 s.
- **Going up costs a jet nothing, and costs the follower nothing.** The
  zoom's end (`CI.zoomEnd`, 30 m/s) never comes. Under the roof both jets
  are levelled off at 765 to 768 m and fly on together: you end level with
  them, both at 124 m/s, with nothing traded.
- **The jet's circle climbs**, so the nose-low try (`CI.sink`, -5 m/s in the
  pilot's units) barely sinks: you are only 114 to 134 m under them when you
  start up.

## What was tried and dropped

Each scored from the nine starts with `scoreMove`, before the roof; none kept, so the plan
file is empty.

- A jet zoom (`jetCiZoom`): up at 60 degrees until 80, 140 or 220 m over them
  (the pilot's units), then over the top onto them with lead pursuit and down,
  guns, and back up. 0 of 9 each, no round fired: they follow the climb and
  end above you.
- The same as a climbing spiral (the circle taken up, 10 or 20 m/s of climb,
  60 or 120 m over them before turning in): 0 of 9 each, no shot either way.
- A deeper nose-low turn (`jetCiLow`, sink 15 m/s): 0 of 9, the same as
  written.
- The Dip with `pick` (wait for their nose to come off you): identical to
  the Dip.

## The MiG-29 (pace 1.5), harness starts

No hits in `circle`, `dip`, `zoom`, `chop`, `reverse`, `low`. The Dip is
never let go (383 to 482 m apart at 40 s). Out and back is worse than on the
F-16: shot down in six of nine, 17 to 22 rounds in eight. Not tuned for it.
The guard fix moved only the zoom (370 to 772 m apart at 30 s, was 750 to
922) and the chop (539 to 640, was 458 to 545); still no hits in either.
Under the first roof the zoom ended 252 to 358 m apart and the chop 735
to 850. Under the roof as reworked (harness starts): no hits in `circle`,
`dip`, `zoom`, `chop`, `reverse`; nose low, one of your rounds lands in one
start. The Dip is never let go, 355 to 465 m apart at 40 s; the zoom ends
327 to 440 m apart, the chop 53 to 439; out and back shoots you down in
five of nine, 22 rounds each. Over `STARTS` every way out is still 0 of 9,
but leaving gets you shot down in two (44 and 51 rounds). The highest
either plane goes in any demo is 818 m (`low`).

## Open

- **Shared: the hunter's reach on a jet.** `btHunter`'s give-up test and the
  reflexes read `c.gun.range`, which for a jet's cannon is `gunOf`'s 400 cap
  (pilot's units). Whether a jet hunter should hold the Spitfire's 268 (so
  give-up behaves at the Spitfire's size) is a school-wide question, not this
  lesson's: it would not change the Dip here (they sit inside 268), but it
  changes every btHunter lesson on a jet. Not changed.
- **Shared: `HUNTER_FIRE` on a jet.** The hunter opens fire inside 150 (192 m
  real) with a cannon that lands from 512 m. A hunter that fired at its
  cannon's reach would shoot down the Dip and the out-and-back far more
  often; the words would then say so. Not changed.
- The live fight (FLY IT) is fitted to a jet ([live-fight.md](live-fight.md)) and reads this file; nobody has flown this lesson in it by hand.
