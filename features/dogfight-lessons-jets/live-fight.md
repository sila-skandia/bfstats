# The live fight on a jet

Status: **fitted, and checked in a page** (2026-11-11: "Checked in a
page", where two bugs in the Range's wiring were found and fixed). FLY IT on the Range (`viewer/dogfight-live.js`)
now fits its two seats to their airframes the way the school's recorded duels
do (`dogfight-duel.js` `runDuel`, `dogfight-fight.js` `runFight`; the README's
"What a jet is to the school").

## What was unfitted

On Desert Combat the ace bot's pilot flew an F-16 or MiG-29 as if it were the
school's Spitfire:

- **Hands.** The pilot was stepped on the drive's raw state, which carries no
  `hand`, so `pointNose` pulled with the Spitfire's damping and swung the
  jet's nose through its point.
- **Starts.** Both seats were placed at the lesson's starts as written:
  Spitfire speeds (56 to 62 m/s) and a Spitfire-sized geometry.
- **Gun.** The ace's pilot thought with the bot's world gun as `liveGun` reads
  it, never the airframe's own cannon.
- **View.** Its plan was handed real positions, speeds, ground and fence, so
  "zoom until under 55 m/s" or "open fire inside 130 m" were read in metres
  a jet does not fly the fight in.
- **Lesson.** `lessonById` was read without `setEra`, so the ace flew the
  lesson as written, never its jet file.
- The guide, the instructor and a way out flown from the card (`flyChosen`)
  built pilots of their own the same unfitted way; `flyChosen`'s `y0` was a
  real height.

## What changed

All in `viewer/dogfight-live.js`. New exported helpers, pure and testable
without a page:

| Helper | What it does |
|---|---|
| `fitSeats(makePlane)` | `fitAirframe` on the page's scratch airframes, `makePlane(0)` the ace's type and `makePlane(1)` yours. A seat that cannot be built gets the neutral fit |
| `handed(state, fit)` | the state with its airframe's `hand` on it, as a duel's airframe carries it (the live drives are never written to) |
| `seatGun(fit, gun)` | the gun the airframe fires, in real metres: its own cannon where fitted, else the world's |
| `seatPilot(plan, fit, opts)` | a pilot thinking with that gun as its pace shows it (`pilotView().gun`), its memory copied in |
| `stepSeat(pilot, fits, ctx)` | one tick: both states handed and shrunk, the ground and the fence shown at the seat's pace, as `runDuel` steps a pilot |

In the fight:

- `refit()` runs at `start()`, before the lesson is read, and again at
  `place()` once both are seated. It sets the era from the ace's fit
  (`setEra('jet')` when it is paced as a jet, else `setEra(null)`). If
  `place()` finds a different era from the one the lesson was read in, the
  lesson and its flight are read again.
- `place()` puts each seat at `paced(start, fit.pace)` for its own airframe.
- The ace's pilot, the guide's pilot (which the instructor flies) and the way
  out's pilot are all `seatPilot`s and are stepped with `stepSeat`: the ace
  on fits `[ace, you]`, the guide and the way out on `[you, ace]`. The way
  out's `y0` is taken from your seat's view.
- What the player's screen reads stays in real metres: the deadlock watch's
  gun and the drill's useful range now come from `live.aceGun` (`seatGun`,
  real) instead of the pilot's gun, which is shrunk on a jet. The HUD range,
  the marker, the sphere, the coach, the drill and the kill scoring were real
  already and are untouched.
- The lines and the extended scene go through `runDuel` / `extendFrom`, which
  fit themselves. Across that boundary the states handed in are the drives'
  real states, and the memories are the live pilots' own, which now live in
  the shrunk space, as `runDuel` expects.
- `state` (the page's test probe) gives `gun` as `live.aceGun` (the same
  values as before on the Spitfire) and adds `fits` and `era`.

**The Spitfire path does not change.** With a neutral fit, `paced` hands back
the start object itself, `pilotView(1)` returns each value it is given,
`handed` returns the state itself, and `seatGun` and the pilot's gun are
`gunOf` of the same gun as before. `setEra(null)` is the default era.

`proving-ground-page.js` was not touched then: its `makePlane(i)` builds
the ace's (0) and your (1) airframes. Which hull each was built from was
wrong in the page, and is fixed since ("Checked in a page").

## How it is checked

- `tests/test_dogfight_live_jets.py` runs `dogfight_jet_harness.mjs --live`
  on the published F-16 and MiG-29 (`fixtures/dc-jets.json`). It flies the
  live seats off the page (paced starts, `seatPilot`, `stepSeat` on the
  planes' real states) next to `runDuel` flying the same sides of boom and
  zoom's counter, F-16 against F-16 and F-16 against MiG-29. Over 20 s the
  two are the same flight to the millimetre; unfitted, they end 1.5 to 1.9 km
  apart. It also checks each seat's fit (2.5 and 1.28; 2.6 and 1.5), the
  paced start speeds, the real gun against the shrunk one, and the hand on
  the state. A `runDuel` handed a live moment's real state and the pilots'
  memories starts exactly where the plane is. The ace's fit sets the jet era
  and the lesson read is the jet version. A seat that cannot be built is
  neutral.
- `tests/test_dogfight_school.py` `LiveSeatsTests` (in
  `dogfight_school_harness.mjs`) checks the Spitfire: both seats fit neutral,
  and over 20 s of the counter, with a fence, every `stepSeat` answer and
  memory is byte-identical to the pilot stepped as the live fight used to
  step it. The starts, the gun and the hand are passed through unchanged.

## Open

- **Fixed since: a way out's memory in `extendFrom`.**
  `dogfight-deadlock.js` seeded a way's pilot with `y0`, the real height,
  inside a duel whose pilot sees heights shrunk, so on a jet every way out
  that holds its height aimed about `pace` times too high, in the theatre's
  extended scene and on the live card alike. It now divides the height by
  the airframe's pace (`fitAirframe`), as the way flown live already did.
- **The coach's own numbers.** `dogfight-coach.js` judges real ranges and
  speeds against Spitfire thresholds: a stall under 28 m/s, "closing fast"
  under 250 m, the 300 to 900 m approach. That is correct for the screen but
  not tuned for a jet.
- **The world's guns.** The ace's pilot now decides when to fire using its
  own cannon. The rounds are still the bot's world weapons, and the hits on
  you are still counted against `KILL_HITS` (22), which was written for the
  wing guns' stream.
- **The ace's type on the Range is not the school's.** The school's FLY IT
  says you fly "against the ace it was measured against", and its page
  draws Desert Shield as F-16 against MiG-29 (`aceAgainst`). The Range parks
  every type of the battle on both rows, and the ace bot takes the best
  fighter on the enemy's (`map.html` `pilotBots`, `fighterRank`): on Desert
  Combat that is always an F-16, so the live fight is F-16 against F-16
  whatever you fly. The fits follow the hull actually flown, so this is a
  question of which jet, not of a wrong fit.
- **Fixed since: the scissors' guide was the Spitfire's Ninja** (`scNinja`),
  which the jet file's own measures put at 0 of 9: in the page the
  instructor flying it took your F-16 up to about 1,000 m and down to
  27 m/s. With no counter demo, `flightOf` gives the guide the lesson's best
  move by the count, and with every move at 0 of 9 that is the first of
  them. The jet scissors and the jet circle now name their guide (`guide`
  in the jet file): `jetScissors`, stay in the braid, and `ciCircle`, hold
  the circle. `tests/test_dogfight_jets.py` `JetGuideTests` holds that no
  jet lesson's guide is a move at 0 of 9. Re-run in the page the same day
  (the scissors, the instructor on from the first second of the fight): the
  guide is `jetScissors`, you braid at 50 to 59 m/s against their 47 to 55
  for 34 s, the ace going reverse, cross, reverse, and nobody is hit.
- **Not flown by hand.** The runs below fly your seat with the instructor
  (I), not a person with a stick.

## Checked in a page (2026-11-11)

Headless Chrome (SwiftShader) on the served working tree, the Range at the
address the school's FLY IT builds:
`map.html?proving=1&map=DC_DesertShield&team=2&botCount=1&botSkill=0.5&mod=desertcombat&spawn=FiringLine&arena=dogfight&dogfight=<lesson>`
(plus `&move=dip`, `&mute&shots`), the instructor flying your seat, 30 s of
fight each at about 0.8 fight seconds a wall second. The probe is the page's
`__provingGround.dogfight.state`, which now also gives `youSpeed`,
`aceType` and `youType`.

**Two bugs, found on the first run and fixed** (`proving-ground-page.js`,
`map.html`): both seats were fitted `hand.pitch` 2.8, pace 1.34, when the
F-16 is 2.5 and 1.28.

- **The wrong airframe.** The Range fitted each seat on the best fighter
  still parked, and a hull being flown leaves the parked rows: once you
  and the ace had taken off in the two F-16s, both seats were fitted (and
  the lines and the ways out flown) on the MiG-29 parked beside them, and
  the arena bar named your plane as the MiG-29. A seat is now fitted on the
  hull its pilot sits in (`seatNode`), and the best fighter is read off
  the level's vehicles for its lifetime (`level.mapVehicles`,
  `bestFighter`).
- **No collision meshes.** `schoolFrame` reads `page.hullBodies`, which
  map.html never handed the Range, so its scratch airframes took their box
  from the drawn mesh (an F-16 measured 2.6 and 1.25, a MiG-29 2.8 and
  1.34) while the plane you sit in flies the header's. map.html now passes
  it.

`tests/test_dogfight_live_jets.py` `TheRangeFitsTheHullFlownTests` holds
both: the ace in an F-16 beside a parked MiG-29 is fitted 2.5 and 1.28
(the parked rows alone give the MiG-29's 2.6 and 1.5), and the page wiring.

After the fix, F-16 against F-16:

| | Scissors | Boom and zoom | On their tail | On their tail, the Dip |
|---|---|---|---|---|
| Era, fits (both seats) | jet; 2.5, 1.28, cannon 1,000 m/s | the same | the same | the same |
| Ace's plan | `jetScAce`, memory `lead` 0.8 | `bzAce`, `burst` 1.1 | `otAce` | `otAce`, guide `jetOtLeave` |
| Ace placed (over the floor) / speed | 384 m, 59 m/s (lesson 300, 44) | 870 m, 79 (lesson 680, 58) | 384 m, 69 (300, 52) | the same |
| You placed / speed | 384 m, 69 m/s (300, 52) | 359 m, 74 (280, 56) | 410 m, 93 (320, 72) | the same |
| Ace's phases | reverse, shoot 2.8, reverse 3.7, cross 5.5, chase 6.2, evade 28.2 | dive, zoom 5.1, clear 10.7, reverse 17.5, dive 19.7, let-go 23.7 | watch, break 2.7 and on | watch, break 2.6 and on |
| Ace's height / farthest from the range's middle | 377 to 849 m / 1.4 km | 591 to 1,130 m / 1.3 km | 384 to 636 m / 250 m | the same |
| Hits | none | none | none | none; 1.9 km apart at 28 s |

- Every start is the lesson's at 1.28, the boom and zoom perch 870 m (under
  900). The Dip run is `dogfight_jet_harness.mjs on-his-tail --trace dip`
  flown in the page: the break at 2.7 s, the ace holding its break climbing
  through 640 m by 30 s, 1,967 m apart at 30 s off the page and 1,904 at
  28 s in it.
- Nobody flew into the ground or past the fence (2.6 km). The ace's long
  "break" on their tail is the plan's, the same off the page. Boom and
  zoom's ace climbing to 1,130 m and 34 m/s at the top is the README's
  open "over the top of the sky".
- The coach's lines are the jet files': "the nose takes most of a second to
  answer" (scissors), "wings level, full throttle (W), nose a little down"
  (on their tail).
- No page errors, no console errors from the school.
- **Vanilla** (Battle of Britain, Spitfire against Spitfire, scissors and
  boom and zoom, 20 s): era null, both fits `{ hand: null, pace: 1, gun:
  null }`, starts as written (300 m at 44 and 52 m/s; the perch at 680),
  the wing guns (400 m/s, 2.6 m span, 1.6 degrees in), `scAce` and `bzAce`
  with no burst.
- **A different plane** (the A-10 picked, scissors, 15 s): the ace still
  flies the F-16 (above); your seat is fitted on the A-10 you sit in
  (2.5, 1.15, its own 900 m/s cannon) and placed at 1.15 (345 m, 60 m/s)
  while the ace starts at 1.28; the era is the ace's, jet. `refit` at
  `place` reads the airframes the two sit in, so the seats differ and both
  are right.
