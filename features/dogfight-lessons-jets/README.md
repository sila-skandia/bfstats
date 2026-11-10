# The dogfight lessons on jets

Status: **all nine lessons are re-tuned on the F-16** (2026-11-11), and the
Range's live fight is fitted to a jet ([live-fight.md](live-fight.md)). Each
lesson was flown from the nine starts on the published F-16; where its
claim was false on a jet the words now say what the jet does, and where a
fight could be made to hold with a small change it was ("Where the lessons
stand"). The numbers in the words are the F-16's: the MiG-29 flies the same
files and each lesson's own page says how it does there.

The owner, after Desert Combat got its arenas and its rules card
([dogfight-doctrine-1991](../dogfight-doctrine-1991/README.md)): "Yes,
re-tune" the lessons for jets. They were written on one airframe, the
school's Spitfire, and their plans carry its numbers.

## What a jet is to the school

A duel now fits itself to the airframe it flies (`viewer/dogfight-duel.js`
`fitAirframe`, measured once a type on a second airframe):

| | Spitfire (the reference) | F-16 | MiG-29 | What the duel does with it |
|---|---|---|---|---|
| Pitch lag: seconds until the pitch rate is 63% of a full pull's, at 100 m/s (`pitchLag`) | 0.33 | 0.83 | 0.87 | `hand.pitch` 2.5 and 2.6 ride on the plane's state, and `pointNose` damps its pull by that much more: undamped, the F-16's nose went through the point it wanted (12 degrees past a target 90 degrees off; 2.8 fitted) |
| Level speed at 300 m (`levelSpeed`) | 75.6 m/s | 97.1 | 113.6 | `pace` 1.28 and 1.5: every start is made larger by it, speed and place alike (`paced`), heights stopping 100 m under the lift ceiling |
| Guns | the school's wing guns: 400 m/s, the streams crossing 90 m out | its own cannon: 1,000 m/s, one barrel, rounds that live 5 s | the same | a plane paced as a jet fights with its own cannon (`ownGun`, off its model's extras) |
| What the pilot is shown | the fight | the fight shrunk by 1.28 | by 1.5 | `pilotView`: every place and speed alike, angles and seconds untouched, so a plan's "zoom until under 55 m/s" or "open fire inside 130 m" is read at the Spitfire's size and flown at the jet's |

An airframe no laggier and no faster than the Spitfire by the slack
(`HAND.slack` 1.25, `PACE.slack` 1.15) gets `{ hand: null, pace: 1, gun:
null }` and is flown to the last decimal as before: the school's 270 tests
on the Spitfire did not move. `runFight` (the pair, the two-seater) fits its
planes the same way.

**The lesson's plane is now the plane you fly.** The school pages built
their airframes with no collision meshes, so the flight law took its box
(drag and inertia, PHY-4, COL-14) from the drawn mesh; the plane you sit in
takes the `.sm` header's. On Desert Combat the two differ: the theatre's
MiG-29 flew level at 102 m/s and the one in the arena at 114. Both pages
now build with the tree's `_shared/collision-meshes.json`
(`dogfight-school-page.js` `collisionOf`, `proving-ground-page.js`
`schoolFrame`).

## How a lesson gets its jet version

- `viewer/dogfight-jet-<lesson>.js` is data: `{ note, seconds, ace, you,
  demos, ... }`, laid over the lesson when the plane on stage is paced as a
  jet (`dogfight-lessons.js` `lessonFor`, `setEra`; the theatre asks
  `fitAirframe`). `ace` and `you` are merged, starts and memories too; a
  demo is merged by its id; anything else it gives (story, counterStory,
  survival, coach, seconds) replaces the lesson's. `note` is drawn above the
  story: what the nine flights on the F-16 showed.
- `viewer/dogfight-jet-plan-<lesson>.js` holds any plan the jet lesson needs
  of its own, registered on `PLANS` and `INTENTS` as it loads
  (`dogfight-jet-plans.js`, imported by the duel). The lesson files import
  nothing, because the Range loads the lesson book before the school.
- Starts, and every number a plan reads, stay in the Spitfire's units.
- `tests/dogfight_jet_harness.mjs` flies a lesson's jet version from the
  nine starts on the published F-16 or MiG-29 (`--text`, `--trace <demo>`
  for one fight's timeline, `--base` for the lesson as written);
  `tests/jet_school.py` is the same for a test.
- The jets are `tests/fixtures/dc-jets.json`: each published airframe's
  node tree and header box, no geometry, written by
  `surveys/airframe_fixture.py desertcombat F16 Mig29`. It measures as the
  published glb does to the last decimal.

## Where the lessons stand

Each lesson on the F-16, nine starts a fight, as its jet file flies it
(2026-11-11). "As written" is the Spitfire's lesson with no jet file, on the
same jet. Each row's own page has the measures, the MiG-29 and what is open;
`tests/test_dogfight_jet_<lesson>.py` holds every number the words quote.

| Lesson | As written, on the F-16 | Now | What changed |
|---|---|---|---|
| Boom and zoom | Two clean passes, 12 to 18 hits, nobody down in 55 s | The pilot who never looks up is shot down in 8 of 9; the one who meets the dive is never hit | Tuned: the burst 1.1 s, the fight 60 s |
| [When they have the height](under-the-height.md) | Climbing straight is never hit: a jet does not run out of speed going up | Words rewritten. Nobody is fired at in any of the three; the trap is the top of the sky (no lift at 1,000 m): the straight climb falls 330 m out of it and ends 840 to 880 m of energy behind. Climbing between dives ends 980 to 1,360 m ahead. Dip 9 of 9, Flip 0, Ninja 0 | No fight changed |
| [Up and over](up-and-over.md) | Following up: nothing either way. Following shallow: 1 to 12 hits | Words rewritten: they never hang slow at the top, they run out of air (up to 1,182 m, then 11 s falling back under 700 m). The shot is as they pull, 390 to 430 m out. Dip 1 of 9 to 9 of 9 | A jet Dip (`jetUoDip`: the shot as they pull, then on under them) |
| [Out of their lock](out-of-the-lock.md) | Turning hard: shot down in 1 of 9 | Turning hard and turn-then-chop: no hit in 9 of 9. Flying straight: down in 9 of 9. Survival "no": the Dip is never hit and never gets away, Flip and Ninja 0 | The look-behind turn keeps the Spitfire's rate, not its 20 degrees of bank (`jetOlHardTurn`, `jetOlChop`) |
| [On their tail](on-his-tail.md) | Nobody's kill; the Dip shot down in 9 of 9 | The rush is still nobody's kill (they break 436 to 543 m out). Dip 9 of 9, never hit | A jet Dip (`jetOtLeave`: not into their circle, straight on at full throttle) |
| [The break turn](break-turn.md) | Flying straight is shot down in 1 of 9 | Flying straight: down in 9 of 9. The break: never down, 0 to 4 hits, all in the first 3.5 s. Dip 9 of 9, Flip 0, Ninja 0 | The target cruises at 68 m/s (Spitfire's units), the fight 45 s. The break comes at once: their cannon reaches 500 m |
| [The flat scissors](scissors.md) | The braid swings 106 degrees off the line, 572 m apart | Swing 74 degrees at most, nobody's kill. No way out: the pilot who leaves is shot down in 9 of 9; Flip and Ninja 0. Survival "no" | A led scissors (`jetScissors`: reverses on the heading 0.8 s on) flown on the brakes, and jet copies of its ace |
| [The Immelmann and the split-S](turnarounds.md) | Nobody down, but no split-S is ever flown: the ace is fast by the time they decide, and Immelmanns instead | The Immelmann costs the F-16 4.8 s and gains 130 m (never slower than 69 m/s) and is the jet's turn round below about 600 m; the split-S (163 m down, out at 96 m/s) is only for a jet that is slow and high. Nobody down in either. Dip 9 of 9, Flip 0, Ninja 0 | The split-S demo's ace starts 120 m closer, so the split-S is flown in all nine; words rewritten |
| [Breaking the circle](the-circle.md) | Nobody gets a shot: holds | The circle holds; none of the six ways out works (0 of 9 each). Survival "no" | Words only |

What the nine say together about a jet in this game, against the Spitfire
the lessons were written on:

- **It does not run out of speed going up.** It runs out of air: the flight
  law gives a wing no lift at 1,000 m, and a jet held nose up climbs into
  that and falls out of it. Every Spitfire move that waits for "slow over
  the top" (most Flips and Ninjas) waits for something a jet never gives.
- **Its cannon reaches twice as far.** One barrel, no crossing point, rounds
  at 1,000 m/s: a pilot opens fire from about 500 m, so breaks come early
  and a hunter does not give a chase up until you are 550 m away.
- **Its nose answers late** (0.83 s to the Spitfire's 0.33), so anything
  timed on a crossing has to be led.
- **The way out is speed in a straight line.** The two Dips that were
  re-flown both work the same way: do not turn after them, go straight on at
  full throttle, nose a little down.

**A move's steps on a jet.** The step lists (`dogfight-steps.js`) are the
Spitfire's, with its distances. A jet demo carries its own (`steps` in the
jet file; the two re-flown Dips have them), and a jet lesson shows none for
a move it did not re-fly (`stepsOf`): its verdict line says what the move
does there. The lesson list's one-line taglines and "Survivable" badges
follow the era too (`dogfight-theatre.js` `labelLessons`).

## Open

- **The ace goes over the top of the sky.** In "When they have the height"
  and "Up and over" the ace's own zoom carries them past 1,000 m, where they
  wallow at 15 to 60 m/s for 20 s. The words say what happens, but an ace
  that levelled off under 900 m would make both fights harder: tried and not
  shipped, climbing between dives then ends about 100 m ahead, not 1,000.
- **Flips and Ninjas.** Almost every one is 0 of 9 on a jet and says so. A
  jet's own versions (a pass that does not wait for a slow top) would be new
  moves, not re-tunes.
- **The hunter never gives up** inside its guns' reach plus 30 m, which on a
  jet is about 550 m: several Dips are never hit and never get away.
- **One jet.** The tuning and the words are the F-16's. The MiG-29 flies the
  same files (each lesson's page has its numbers; some hold, some do not);
  the F-15C is the MiG-29's airframe; the Mirage, F-14B and AV-8 are in
  neither the fixture nor the harness.
- **Heights.** A paced start stops at 900 m; at the MiG-29's pace the
  lessons' higher perches are all there, so its fights begin flatter than
  the lesson draws them.
- **Nobody has flown a jet lesson by hand** in FLY IT. The live fight is
  fitted and reads the jet files (the scissors' ace there is `jetScAce`),
  checked off the page only.
