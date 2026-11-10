# The dogfight lessons on jets

Status: **the ground is laid and one lesson is re-tuned** (2026-11-10): boom
and zoom. The other eight lessons with a jet file are still flown as written,
which on a jet mostly does not go as their words say ("Where the lessons
stand"). Each is its own piece of work, in its own two files.

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

The school's own tests, run on the F-16 in the Spitfire's place, fitted, with
no jet file (2026-11-10; 42 tests, 19 failing, six of those the Spitfire's
own airframe facts). What the nine starts of each fight did:

| Lesson | Its claim | On the F-16, as written |
|---|---|---|
| Boom and zoom | The pilot who never looks up is shot down every time; the one who meets the dive is never hit | Two clean passes, 12 to 18 hits, nobody down inside 55 s: the pass is right and the 0.6 s burst too short. Met, the dive lands nothing. **Re-tuned** (below) |
| When they have the height | Climbing straight is fatal; climbing between dives wins the height back | Climbing straight is never hit: a jet does not run out of speed going up. Turning flat and climbing between dives are never hit either |
| Up and over | Following them up gets nothing; following shallow gets the hits | Following up: nothing either way. Following shallow: 1 to 12 hits a fight, half the Spitfire's |
| Out of their lock | Flying straight is fatal; turning hard keeps you alive | Flying straight: down in nine of nine. Turning hard: down in one of nine |
| On their tail | Rushing in is nobody's kill | Nobody's kill, and few hits either way |
| The break turn | Flying straight is fatal, the break is not | The break is never hit; flying straight is shot down in one of nine, not nine |
| The flat scissors | They braid along one line; nobody's kill | Nobody's kill, but the braid swings 104 degrees off the line, past the lesson's 90 |
| The Immelmann and the split-S | They turn round without being shot down | Holds |
| Breaking the circle | Two equals: nobody gets a shot | Holds: no hits in nine |

**Boom and zoom, re-tuned** (`viewer/dogfight-jet-boom-and-zoom.js`): the
ace's burst is 1.1 s and the fight 60 s. On the F-16 the dive runs 110 to
130 m/s against a target cruising at 72 and the guns bear for under two
seconds; two passes then bring down the pilot who never looks up in eight
starts of nine (43 to 51 s in; the ninth has 20 hits at the bell), and the
pilot who meets each dive is not hit once. On the MiG-29 (pace 1.5) the
same fight lands 0 to 16 hits: the theatre flies an arena's best fighter,
so an arena without an F-16 flies the F-15C or the MiG-29, and a lesson
tuned on one jet is not tuned on the others.

## Open

- **Eight lessons** are not re-tuned. The table says where each stands;
  several are different lessons on a jet (climbing straight under a diver
  works), and their words should say what the jet does, not be bent until
  the Spitfire's words come true.
- **The live fight** (FLY IT on the Range) is not fitted: its ace still
  flies the Spitfire's hands, starts and guns on a jet
  (`dogfight-live.js`).
- **The Dip, the Flip and the Ninja** of each lesson are flown and counted
  on the jet as on any airframe; none is re-tuned.
- **One jet.** The tuning is the F-16's. The MiG-29 is in the fixture and
  the harness (`--plane Mig29`); the F-15C, Mirage, F-14B and AV-8 are not.
- **Heights.** A paced start stops at 900 m; at the MiG-29's pace the
  lessons' higher perches are all there, so its fights begin flatter than
  the lesson draws them.
