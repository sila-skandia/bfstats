# Breaking the circle on a jet

Status: **re-worded, no fight changed** (2026-11-10). On the F-16 none of the
six ways out breaks the circle, the Spitfire's one answer (leaving) included.
The jet file (`tools/bf1942-models/viewer/dogfight-jet-the-circle.js`) says
so with the nine flights' numbers; every try flies the plan it flies on the
Spitfire. The plan file holds no plan. Tests:
`tools/bf1942-models/tests/test_dogfight_jet_the_circle.py`.

**2026-11-11, the ceiling guard.** Every pilot noses over above 880 m; a jet's
pilot, shown the fight at the Spitfire's size, waited for 1,126 m real until
the guard read its 880 m over the pace (commit `726b12eb6`). Re-flown with
it, only the zoom moved: still 0 of 9, but it now ends above them, not
under them (table below; its words and test rewritten). Every other try,
and the MiG-29's harness numbers, are unchanged to the metre.

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

The fights before and after the jet file are the same: nothing but words changed. The zoom's row gives both sides of the 2026-11-11 guard fix.

| Demo | Spitfire verdict | F-16, nine starts |
|---|---|---|
| `circle` | nobody's shot, 52 to 218 m apart | nobody's shot, no hits; 50 to 279 m apart for the first 8 s, both speeding up to 85 to 90 m/s; the circle climbs 140 to 200 m in 30 s |
| `dip` (Dip) | 7 of 9 | **0 of 9.** They turn after you and settle 285 to 361 m behind, nose on you, with a landing shot for 16 to 23 s of the 32. Never let go (no `let-go` phase), never fire, no hits. Flown to 70 s (scratch run, not on screen or in a test) they close to 168 to 233 m and land 2 to 14 rounds in three |
| `zoom` (Ninja) | 0 of 9 | **0 of 9.** At 60 degrees the jet never slows to the plan's 30 m/s (Spitfire units). Before the guard fix: 105 to 106 m/s at most, 274 to 322 m over them, the climb ending at the guard's 1,126 m real; you hung at 25 to 29 m/s and fell, 423 to 618 m under them at 30 s. With the guard at 880 m real: the guard cannot level a 60-degree jet climb (it pre-empts the plan while the jet still climbs, and the wing lifts 12% or less up there), so you go on to 1,416 to 1,426 m, at most 98 to 99 m/s; they follow (`follow`) to 920 to 1,368 m, never as high. You end 324 to 554 m over them at 52 to 54 m/s, and at 30 s are still 45 to 509 m above them, coming over the top. No hits, no shot |
| `back` (Ninja) | 0 of 9 | **0 of 9, and it gets you killed.** Never let go, so turning back at 30 s is a pass 29 to 42 m apart and they are behind you again, a landing shot for 12 to 35 s; 10 to 44 rounds on you in six, shot down in two. You never have a shot |
| `chop` (Flip) | 0 of 9 | **0 of 9.** 37 to 38 m/s, 272 to 320 m under them, 514 to 563 m of energy behind; never in their quarter; nobody has a shot |
| `reverse` (Flip) | 0 of 9 | **0 of 9.** No head-on pass at all (the Spitfire met head-on in five): the circle turns the other way, 98 to 160 m apart at the closest; nobody fires |
| `low` (Flip) | 0 of 9 | **0 of 9.** Round behind them (100 to 131 degrees) 14 to 16 s in, 114 to 134 m under, 82 to 83 m/s; the pull up costs little but the nose never comes onto them, no landing shot in any. In seven you sit 2 s in their rear quarter at 37 to 40 s, 29 to 32 s after the move, past the Flip's 20 s |

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
  inside it at 285 to 361 m (223 to 282 in the pilot's units). And
  `HUNTER_FIRE` (150, 192 m real) is the only reason they never fire with a
  landing shot for 20 s.
- **Going up costs a jet nothing, and costs the follower nothing.** The
  zoom's end (`CI.zoomEnd`, 30 m/s) never comes. With the guard at 880 m
  real the climb does not stop there either: from 60 degrees up the nose
  will not come down at the top of the sky, and you hang above them at 52
  to 54 m/s with no lift to come down onto them.
- **The jet's circle climbs**, so the nose-low try (`CI.sink`, -5 m/s in the
  pilot's units) barely sinks: you are only 114 to 134 m under them when you
  start up.

## What was tried and dropped

Each scored from the nine starts with `scoreMove`; none kept, so the plan
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
