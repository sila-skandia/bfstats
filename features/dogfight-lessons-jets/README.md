# The dogfight lessons on jets

Status: **all nine lessons are re-tuned on the F-16, under a roof every jet
pilot flies under** (2026-11-11), and the Range's live fight is fitted to a
jet ([live-fight.md](live-fight.md)). Each lesson was flown from the nine
starts on the published F-16; where its claim was false on a jet the words
now say what the jet does, and where a fight could be made to hold with a
small change it was ("Where the lessons stand"). The numbers in the words are
the F-16's: the MiG-29 flies the same files and each lesson's own page says
how it does there.

The lessons went live on play.bfstats.io on 2026-11-11 with pilots who could
climb through the top of the sky. The same day the owner said "Yes, re-tune"
to a roof that holds every jet pilot under it ("The roof"), and all nine
were measured again under it: six now have a way out, where four did.

The roof is live there too, checked headless the same day: on Desert Combat
the school shows six lessons "Survivable" and three "No way out", the break
turn's re-flown Dip with its four steps at 9 of 9, the Spitfire's lessons on
vanilla as they were, and in the Range boom and zoom's ace dives at once from
its 730 m perch and both planes end level under 770 m, no page errors.

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
| Level speed at 300 m (`levelSpeed`) | 75.6 m/s | 97.1 | 113.6 | `pace` 1.28 and 1.5: every start is made larger by it, speed and place alike (`paced`), heights bent over under the roof (`pacedHeight`, below: no start over 760 m) |
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

Each lesson on the F-16, nine starts a fight, as its jet file flies it under
the roof (2026-11-11). "As written" is the Spitfire's lesson with no jet file, on the
same jet. Each row's own page has the measures, the MiG-29 and what is open;
`tests/test_dogfight_jet_<lesson>.py` holds every number the words quote.

| Lesson | As written, on the F-16 | Now, under the roof | What the jet file changes |
|---|---|---|---|
| [Boom and zoom](boom-and-zoom.md) | The 0.6 s burst leaves eight of nine alive in 60 s | The ace perches at 730 m, 372 m over you. The pilot who never looks up is shot down in 9 of 9, 13 to 52 s in, in one pass or two; the one who meets the dive is never hit, and after that one dive the ace never gets above them again. Dip 9 of 9, Flip 0, Ninja 0 | The burst 1.1 s. A jet Dip (`jetBzDip`: meet the dive, then straight on climbing 3 degrees to the top of the sky, where a jet is fastest) against an ace that dives once you are 30 degrees under it (`jetBzAceMeet`) |
| [When they have the height](under-the-height.md) | Climbing straight is never hit: a jet does not run out of speed going up | Their 505 m of height lasts about 13 s against a full-throttle climb. Climbing between their dives ends level with them and a kilometre apart; climbing straight ends with them behind you inside 450 m for 8 to 38 s, never firing; turning flat is fired at in 3 of 9 and ends 340 to 416 m of energy behind. Dip 9 of 9 (the lesson's own), Flip 0, Ninja 0 | Words. The jet aces (`jetBoomAndZoom`, `jetUhAce`) turn over the top once the roof holds their zoom level |
| [Up and over](up-and-over.md) | Following up: nothing either way. Following shallow: 1 to 12 hits | They go over the top at 550 m while the air holds them and come straight back down. Follow them up and it is you who ends slow at the top: 18 to 27 m/s at 773 to 786 m, hit in four starts of nine. Following shallow, the shot is as they pull: 6 to 12 hits in seven, and they never hit you. Dip 9 of 9, Flip 0, Ninja 0 | A jet ace that loops under the thin air and zooms back up at 35 degrees at most (`jetUpAndOver`, `jetUoAce`, `jetUoAceSharp`); a jet Dip (`jetUoDip`: the shot as they pull, past them as they come down, away) |
| [Out of their lock](out-of-the-lock.md) | Turning hard: shot down in 1 of 9 | Turning hard and turn-then-chop: no hit in 9 of 9; the turn climbs 310 m and levels off at 747 to 759 m, slower round in the thin air. Flying straight: down in 9 of 9. Survival "no": the Dip is never hit and never gets away, Flip and Ninja 0 | The look-behind turn keeps the Spitfire's rate, not its 20 degrees of bank (`jetOlHardTurn`, `jetOlChop`) |
| [On their tail](on-his-tail.md) | Nobody's kill; the Dip shot down in 9 of 9 | The rush is still nobody's kill (they break 436 to 543 m out). Dip 9 of 9, never hit, 2.6 to 3.4 km apart at 40 s. Flip 0, Ninja 0 (both level off at 749 to 766 m and they come round onto your tail) | A jet Dip (`jetOtLeave`: not into their circle, straight on at full throttle) |
| [The break turn](break-turn.md) | Flying straight is shot down in 1 of 9 | Flying straight: down in 9 of 9. The break: never down, 0 to 4 hits, all in the first 3.5 s. Dip 9 of 9: never hit, they let go 31 to 35 s in, 3.6 to 4.5 km apart at 50 s. Flip 0, Ninja 0 | The target cruises at 68 m/s (Spitfire's units), the fight 45 s. A jet Dip (`jetBtDip`: the break, the zoom, 8 s over the top, then away level and high; nose 8 degrees down, the Spitfire's, is 5 of 9) |
| [The flat scissors](scissors.md) | The braid swings 106 degrees off the line, 572 m apart | Swing 74 degrees at most, nobody's kill. No way out: the pilot who leaves is shot down in 9 of 9; Flip 0; the Ninja climbs to the roof, they follow, and their rounds land in 5 of 9 by 40 s. Survival "no" | A led scissors (`jetScissors`: reverses on the heading 0.8 s on) flown on the brakes, and jet copies of its ace |
| [The Immelmann and the split-S](turnarounds.md) | Nobody down, but no split-S is ever flown: the ace is fast by the time they decide, and Immelmanns instead | The Immelmann costs the F-16 4.8 s and gains 130 m (never slower than 69 m/s): the jet's turn round, from under 530 m, the highest a loop can start and still top out under 800 m on either jet; from higher the aces turn round flat instead, in 3 to 6 s. The split-S (163 m down, out at 96 m/s) is only for a jet that is slow and high. Nobody down in either. Dip 9 of 9, Flip 0, Ninja 0 | The split-S demo's ace starts 120 m closer, so the split-S is flown in all nine. Jet aces (`jetTurnarounds`, `jetTaAce`) whose loop is flown whole from under 530 m and not started above it |
| [Breaking the circle](the-circle.md) | Nobody gets a shot: holds | The circle holds, climbing 142 to 189 m in 30 s; none of the six ways out works (0 of 9 each): the zoom levels off at 765 m with them beside you. Survival "no" | Words only |

What the nine say together about a jet in this game, against the Spitfire
the lessons were written on:

- **It does not run out of speed going up.** It runs out of air: the flight
  law gives a wing no lift at 1,000 m. Every Spitfire move that waits for
  "slow over the top" (most Flips and Ninjas) waits for something a jet never
  gives; a jet's pilot levels off under 800 m instead ("The roof"), and a
  climbing fight ends with both planes level there.
- **Height is worth what lies under the roof.** A perch is 370 to 505 m over
  you: one met dive spends it, and a full-throttle climb reaches them in
  about 13 s.
- **It is fastest at the top of the sky.** The drag thins with the air: the
  F-16 flies level at 128 m/s at 770 m and 93 at 215 m. Two ways out are up
  there: boom and zoom's Dip climbs gently to the roof and the break turn's
  runs level from the top of its zoom, where the Spitfire's ran low.
- **Its cannon reaches twice as far.** One barrel, no crossing point, rounds
  at 1,000 m/s: a pilot opens fire from about 500 m, so breaks come early
  and a hunter does not give a chase up until you are 550 m away.
- **Its nose answers late** (0.83 s to the Spitfire's 0.33), so anything
  timed on a crossing has to be led.
- **The way out is speed in a straight line.** Every Dip that works on a jet
  ends the same way: do not turn after them, go straight on at full
  throttle. Six lessons have one (boom and zoom, when they have the height,
  up and over, on their tail, the break turn, the Immelmann and the
  split-S); in the lock, the scissors and the circle nothing gets you out.

## The roof

The flight law gives a wing no lift at 1,000 m (`aircraft.js`
`AIR_DENSITY_ZERO_AT_HEIGHT`: half at 500 m, a fifth at 800, a tenth at 900).
A Spitfire is out of speed long before that; a jet is not. Until 2026-11-11 a plan that zoomed steeply on a jet
coasted to 1,300 to 1,850 m and fell back out of it, and the lessons' perches
were paced to 870 and 896 m, in a tenth of the air. Now every pilot of an
airframe paced as a jet flies under a roof, and the lessons start under it.

- **The roof is 800 m real** (`dogfight-jet-ceiling.js` `ROOF`). `stepPilot`
  (`dogfight-pilot.js`) passes whatever a jet pilot's plan answers through
  `underRoof`. The climb allowed falls with the height left (the climb rate
  that would use it up in 3.5 s, `roofClimb`), so a climb levels off as the
  roof nears: a pilot held by it flies level at about 765 m.
- **It caps the pull and nothing else.** The pull that would put the path on
  the allowed climb is worked out in the plane's own pitch plane, over the
  share of its lift that points up: a banked pilot eases the pull, an inverted
  one pulls through. The plan's own pull is flown wherever it asks for less
  sky than that. The roll, the rudder and the trigger stay the plan's, so a
  turn at the roof is the plan's turn, flatter, and a plan that wants to roll
  out, fly level or dive does.
- **The nose is led.** A jet's nose answers 0.83 s late, and a nose on its way
  up goes on rising that long: the pitch rate under way is taken off the cap,
  by more on an airframe whose nose answers late (`hand.pitch`). Without the
  lead, a hard pull begun at 690 m at 115 m/s carried the nose to 53 degrees
  before the push bit, and in that air nothing brought it back: 974 m.
- **The throttle comes off** while the nose is more than 15 degrees over the
  allowed climb: a jet's engine out-pulls its weight, and on full power a nose
  that is too high carries the plane up whatever the stick does.
- **A loop that fits is left alone.** At the rate the nose is coming round, a
  loop's radius is the speed over that rate; where its top (times 1.3, for the
  air thinning on the way up) is under the roof, the pull is not capped. So an
  Immelmann begun at 455 m on the MiG-29 is flown, and one begun too high is
  levelled off. A plan can also say its answer is not to be touched (`roof:
  false`), which up and over's jet ace does for the loop it starts at 550 m.
- **The starts are bent over under it** (`dogfight-duel.js` `pacedHeight`): as
  paced up to 600 m real, and from there toward 760 m, never reached. A 700 m
  perch (the Spitfire's size) is 735 m on the F-16 and 750 on the MiG-29, where
  it was 896 and 900; 680 m is 730; two starts that differ in height still do.
  The Range stages a fight over the level's own ground (40 m under Desert
  Shield's arena), and the roof and the air are the sky's: a jet's fight is
  staged at the heights in the sky it was measured at, up to 80 m nearer the
  ground (`paced`'s `base`). Lifted whole, boom and zoom's perch was bent
  34 m nearer its target and its ace never had the angle to dive.
- **The Spitfire's pilots are not under it** (pace 1): they never get there,
  and the school's own tests did not move.
- **The guard is still the last word** (`guard`, read over the pace: the nose
  on the horizon above 880 m real and climbing), and nobody reaches it
  (`tests/dogfight_jet_harness.mjs --tops`, held by `TheRoofTests` and each
  lesson's own test): nine starts of every demo and move of the nine lessons
  top out at 804 m on the F-16 and 847 on the MiG-29.

What was tried on the way, and not shipped:

- **A roof that flies the plane.** The first one put the nose on the allowed
  climb itself (pushed down along the heading, or a little round the way the
  wings were banked). It held everyone under 840 m, and three lessons'
  re-measures found what it cost: it climbed a plan that wanted less at the
  steepest rate allowed, and above 800 m it took every answer over and held
  whatever bank the plane had, so a pilot up there flew a 45-degree turn at
  about 830 m until the fight ended. The break turn's hunter circled there
  while the Dip left (9 of 9, and 0 of 9 against a hunter free to chase); in
  under the height both planes ended every fight circling level with each
  other. It also flattened every loop begun above about 450 m.
- **The two lessons' roof as it stood** (no lead, full throttle) over every
  pilot: all but a handful under 880 m, and pilots at the roof in a one-second
  roll, push, bank cycle.
- **A hard stop on the start heights** at 750 m: a 600 m and a 620 m start at
  the same height.

**A move's steps on a jet.** The step lists (`dogfight-steps.js`) are the
Spitfire's, with its distances. A jet demo carries its own (`steps` in the
jet file; the two re-flown Dips have them), and a jet lesson shows none for
a move it did not re-fly (`stepsOf`): its verdict line says what the move
does there. The lesson list's one-line taglines and "Survivable" badges
follow the era too (`dogfight-theatre.js` `labelLessons`).

## Open

- **The roof never rolls a plane.** It caps the pull and leaves the plan its
  wings, so a pilot who arrives nose high and steeply banked in thin air is
  not recovered: up and over's follower breaks at 698 m with the nose 58
  degrees up, the throttle comes off, and the speed bleeds to 18 to 27 m/s
  at 776 m. The lesson says so (following them up is the mistake), and the
  MiG-29's follower is shot down there in four starts of nine.
- **A fast loop from high up is not started.** The roof leaves a pull alone
  once the loop it is flying fits under 800 m, read from the pitch rate
  under way; a hard pull at speed is capped before that rate has built.
  The Immelmann lesson's aces carry their own rule instead (they loop from
  under 530 m, the MiG-29's limit, and say `roof: false`); any other plan
  that loops from above about 450 m on a jet meets the cap as it is.
- **Rolling through level at the roof.** The MiG-29's hunter, reversing a
  steep bank at 765 m while pulling, climbs to 848 m before it comes back
  (the break turn's Flip): the highest anyone goes.
- **A hard turn at the roof is a slow one.** Out of their lock's turn falls
  from 40 to 15 degrees a second as it reaches 760 m: a fifth of the lift.
- **An ace behind you that never shoots.** In "when they have the height"
  the straight climb ends with the ace on your tail for up to 38 s, holding
  its fire: its plan waits in `climb` for 150 m of height the roof never
  gives it. An ace that took that shot would make the straight climb a trap
  again.
- **Flips and Ninjas.** Every one is 0 of 9 on a jet and says so. A jet's
  own versions (a pass that does not wait for a slow top) would be new
  moves, not re-tunes.
- **The hunter never gives up** inside its guns' reach plus 30 m, which on a
  jet is about 550 m: out of their lock's Dip is never hit and never gets
  away, and the break turn's gets away by 14 to 69 m of that margin.
- **One jet.** The tuning and the words are the F-16's. The MiG-29 flies the
  same files (each lesson's page has its numbers; some hold, some do not:
  its boom and zoom perch is too low for the first dive to bear, and its
  on-their-tail Dip is 5 of 9); the F-15C is the MiG-29's airframe; the
  Mirage, F-14B and AV-8 are in neither the fixture nor the harness.
- **Nobody has flown a jet lesson by hand** in FLY IT. The live fight is
  fitted, reads the jet files and has been run in a page with the
  instructor flying your seat ([live-fight.md](live-fight.md)).
