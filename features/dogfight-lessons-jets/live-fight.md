# The live fight on a jet

Status: **fitted** (2026-11-10). FLY IT on the Range (`viewer/dogfight-live.js`)
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

`proving-ground-page.js` was not touched: its `makePlane(i)` already builds
the ace's (0) and your (1) airframes.

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

- **A way out's memory in `extendFrom`.** `dogfight-deadlock.js` line 331
  seeds the way's pilot with `y0: states[side].position[1]`, a real height,
  inside a duel whose pilot sees heights shrunk. On a jet, every way out
  that holds `y0` aims about `pace` times too high. This affects the
  theatre's extended scene and the live card alike. The fix belongs in
  `extendFrom` (`y0` from `pilotView(fit.pace).see(state)`), which was
  outside this change's files. The way flown live afterwards (`flyChosen`)
  is fitted.
- **The coach's own numbers.** `dogfight-coach.js` judges real ranges and
  speeds against Spitfire thresholds: a stall under 28 m/s, "closing fast"
  under 250 m, the 300 to 900 m approach. That is correct for the screen but
  not tuned for a jet.
- **The world's guns.** The ace's pilot now decides when to fire using its
  own cannon. The rounds are still the bot's world weapons, and the hits on
  you are still counted against `KILL_HITS` (22), which was written for the
  wing guns' stream.
- **Not checked in a page.** No browser was used for this change. The page
  wiring (`refit` at `start` and `place`, and the lesson read again when the
  era changes) is covered only by reading the code, not by a run on the
  Range.
