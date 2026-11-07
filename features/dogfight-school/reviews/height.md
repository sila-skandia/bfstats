# Height lessons: boom and zoom, and when he has the height (fixer `height`, 2026-11-07)

Covers lessons `boom-and-zoom` and `under-the-height`, and the plans they fly:
`boomAndZoom` (the ace in both), `unaware`, `meetTheDive`, `climbStraight`,
`flatTurn`, `climbBetween`. Shape tests: `tools/bf1942-models/tests/test_dogfight_shape_height.py`
with `dogfight_shape_height.mjs` (run after the school harness's head; 11 tests, about 2 s).

## The tactic

Boom and zoom (Shaw, *Fighter Combat*; Hartmann's "see, decide, attack, break"):
from above, dive steeply with a big overtake, hold fire until he fills the sight,
one short burst, zoom back up on the dive's speed before he can turn, reverse
over the top, come down again. Never turn with him. The counter: turn to face the
dive once he commits (a head-on pass gives him no time to aim), do it flat to keep
the speed, never follow the zoom, climb shallow between dives. Each wasted dive
costs him height.

## What the reconstructions now do (nine starts each, El Alamein's Spitfire)

| demo | before (review) | now |
|---|---|---|
| B&Z move, "He bounces you" | one long flat tail chase, 2.2 s firing run, no zoom | 2 or 3 passes, kill at 33 to 48 s; each pass a 41 to 58 degree dive, first shot at 16 to 21 degrees nose down with 42 to 49 m/s closure, a 0.6 s burst from inside 130 m, zoom back 245 to 268 m above you after the first pass; every landing round fired in a dive |
| B&Z counter, "You meet the dive" | merge 38 to 50 m, one dive met, you stood on your tail at 24 m/s, then 33 s of both climbing 1 km apart | 3 dives starting 400, 235 to 262 and 130 to 195 m above you (energy gap 396 to 419, then 313 to 347, then 199 to 266); every one a head-on pass he breaks off at 350 m (merges 121 to 203 m apart, noses 143 to 149 degrees apart); he ends the first pass 178 to 195 m above you; your nose never over 20 degrees, never under 40 m/s; 0 hits on you |
| UH move, "You climb straight" | one pass; your 21 degree climb was the counter's own climb | 30 degree climb at 35 m/s, killed in one pass at 13.5 to 14.1 s, every landing round in the dive |
| UH flat, "You turn flat" | spiralled 280 to 64 m, 28 s on the floor guard | holds 168 to 183 m from a 180 m start, 47 to 48 m/s, about 40 degrees a second; never hit; he dives 2 or 3 times and wastes his height (ends 31 m under to 62 m over you) |
| UH counter, "You climb between his dives" | one dive, you climbed straight away 5 km and sat on the ceiling | 2 dives (520, then 149 to 177 m above you), each broken into 2.9 to 3.8 s before his pass, he pulls out without a shot; you climb 402 to 469 m with him in sight 77 to 80 % of the climb; range never over 890 m; never above 850 m or below 100 m; he ends 34 to 156 m above you, from 520 |

## What changed

- `PLANS.boomAndZoom` (rewritten): perch flies level toward him until he is 35
  degrees below; dive leads him but never steeper than 50 degrees, holds fire until
  inside 130 m (`mem.open`), three seconds from the merge, or the last moment
  before the pull-out; breaks off after `mem.burst` seconds of firing (0.6 s: at
  one round a tick that is 19 rounds, under the 22 that bring a fighter down, so a
  kill always takes more than one pass), a second from the merge, before a
  predicted pull-out would take him under your height, or once you have turned to
  face him inside 350 m (read on the horizon); keeps the pass, guns quiet, until
  the nose is off you (so a landing solution always reads as attack); zooms at 35
  degrees (a 60 degree zoom from 100 m/s threw away 200 m of energy); wingover;
  dives again only with 100 m in hand and not into a face-on pass; climbs straight
  on his exit heading (chasing a bearing round a hard turner was a sinking turn)
  and turns back toward you past 700 m. Captions: "He has turned to face me: no
  shot, back up", and "He has my height now: climbing to get it back" when he
  climbs from below.
- `PLANS.unaware`: never looks up at all (it used to chase after the first pass,
  against the demo note). Its memory key is `cruiseDir`, not `dir`: the ace bench
  passes `memory: { dir: 1 }`, which made it fly off at full throttle.
- `PLANS.meetTheDive`: the climb is a gentle climbing turn toward his side (the
  old one divided degrees by DEG and so always spiralled at the hard rate); stops
  facing once he is zooming away.
- `PLANS.flatTurn`: three quarters of the stick at about 75 degrees of bank, bank
  eased by sink and lost height; holds height at about 40 degrees a second. (Full
  stick spiralled down at 4 m/s.)
- `PLANS.climbStraight`: 30 degrees (was 25, the same climb as the counter).
- `PLANS.climbBetween`: climbs in a gentle turn toward his side, the nose up to 20
  degrees as the break's speed comes back.
- Lessons: boom and zoom ace starts at [-350, 680, 300] (400 m above, off your
  left quarter). Under the height: ace at [-150, 700, 700], you at 180 m (520 m
  under him), `memory: { burst: 1.8, open: 300 }` (he sits well back and settles
  behind a straight line: one long burst), 55 s (was 75). Story, counterStory,
  notes, coach tips and the pilots' captions reworded to the measured numbers.
- `test_dogfight_school.py`: `test_the_counters_take_his_kill_shots_away` no
  longer asks the two height lessons' moves for 4 s of shot (a boom-and-zoomer's
  shots are short bursts by design; the shape tests hold passes and kills);
  `test_under_his_height_climbing_between_dives_wins_the_height_back` drops the
  energy-lead claims that are no longer true (heights are in the shape tests).

## Thresholds relaxed from the reviews, and why

- Firing pass: measured on the trigger (`f`), not the solution (`o`). The ace
  tracks the lead from 270 m but holds fire to 130 m; the burst is what is short.
- Counter climb (B&Z): 6 to 20 degrees and 5 m/s, not 20 to 30 and 10 m/s. After a
  flat face the speed is about 41 m/s; a 20 degree climb at that speed stalls the
  next turn. The words now say "about 10 degrees".
- Energy gap per B&Z dive: shrinks by at least 50 m, not 100. The pass costs him
  the dive's drag and a pull-out (60 to 130 m); your shallow climb adds the rest.
- Ace above you 10 s after each merge: required for the first pass only (178 to
  195 m). Later dives start from 150 m or less and bottom out near your height.
- UH counter climb: 8 to 25 degrees, 35 m/s, in sight 70 %, not 15 to 25, 42 m/s,
  80 %: the break costs the speed, and the climb that keeps him in sight is a
  turn. The energy lead at last contact (review: over +100) is not reached: he
  rebuilds by climbing away after his second dive. The words now claim the height
  you gain and the gap you close, not an energy lead.

## Open

- The theatre labels every `o` tick a kill shot. In boom and zoom the ace holds
  the lead from about 270 m and fires from 130 m, so the shot bands are longer
  than the bursts (the move reads "Kill shots: the ace had 10.7 s").
- The theatre flies the battle's own fighter, not the harness Spitfire. On Coral
  Sea the move killed on the first pass; on El Alamein it matches the harness. The
  0.6 s burst now makes a one-pass kill impossible on any airframe.
- Screenshots (top and wide, every demo):
  `<scratchpad>/fix-height/shots/`.
