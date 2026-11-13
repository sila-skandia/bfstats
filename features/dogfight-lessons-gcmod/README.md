# Galactic Conquest's dogfight lessons

Status: **two lessons, on GCMOD only** (2026-11-12), flown and measured from
the school's nine starts on the published X-Wing and TIE fighter. The owner
asked for Star Wars dogfighting lessons in the school as part of bringing
GCMOD in ([gcmod-extraction](../gcmod-extraction/README.md)), and for the
lessons to move into per-mod folders while that was done.

## Where the lessons live now

`viewer/dogfight-lessons/` holds every lesson that is not the book's own
(`viewer/dogfight-lessons.js` `LESSONS`, the nine plus the two-seater, written
on the Spitfire):

| Folder | What | Chosen by |
|---|---|---|
| `jets/` | the jet overlay of each of the nine (`<lesson>.js`), the plans they add (`plan-<lesson>.js`), `index.js` (`JET_LESSONS`) and `plans.js` | the airframe's pace: one `fitAirframe` paces as a jet (`setEra('jet')`), on any tree. Measured on Desert Combat's F-16 ([dogfight-lessons-jets](../dogfight-lessons-jets/README.md)) |
| `gcmod/` | GCMOD's own lessons (`index.js`, `GC_LESSONS`) and their plans (`plans.js`) | the tree: `MOD_LESSONS.gcmod`, listed first on GCMOD (`lessonsFor`, `setLessonMod`) and on no other tree |

The files were `viewer/dogfight-jet-<lesson>.js`, `dogfight-jet-plan-<lesson>.js`,
`dogfight-jets.js` and `dogfight-jet-plans.js` until this change; nothing
in them moved but their imports. `dogfight-jet-ceiling.js` (the roof every
jet pilot flies under) stays beside the pilot, which reads it.

A lesson that belongs to a tree carries `mods: [...]`; `lessonById` finds
any lesson by id, a tree's own included, so a link to one opens on it.
The lesson files import nothing (the Range loads the lesson book before the
rest of the school); the plans are imported by `dogfight-duel.js`.

## What a GCMOD fight is

A GCMOD lesson flies its own craft and its own fight, read off GCMOD's data,
whatever plane the page has picked:

- **The craft** (`ace.craft`, `you.craft`): the page loads them once
  (`dogfight-school-page.js` `crafts`), `makePlane` builds a side on its
  own craft, and the theatre draws it (`planeVisual(i, craft)`) and names it
  (`ace.name`, `you.name`) in the header.
- **Their own size** (`fight.pace: 1`): `fitAirframe` would pace the TIE
  (108 m/s level) as a jet, 1.43 times the Spitfire's fight, and the X-Wing
  (79 m/s) not at all. A GCMOD lesson is written in real metres.
- **Their own guns** (`fight.gun`): the lasers, `MediumLaserProjectileRedNS`
  and `GreenNS`, 650 m/s, living 5 s, with their rate (`rate`, rounds a
  second: the X-Wing's four `XWing_Laser_Cannon` at 5.3 each, 21.2; the
  TIE's one `TieFighterGuns`, 4.8). Without a rate the duel fires a round a
  tick, as it always has.
- **Their own hulls** (`fight.killHits`): a bolt (material 702, damage 7)
  does twice that to GCMOD's light armour (801, modifier 2.0), 14. The
  X-Wing's 90 hit points are seven bolts, the TIE's 55 four. The duel's
  `KILL_HITS` (22) stays for everyone else.

`runDuel` takes all three per side (`pace`, `gun`, `killHits`) and
`demoSides` hands a lesson's `fight` and `craft` on; absent, nothing moves.

## The brake

GCMOD's fighters carry lift engines wound backwards on the throttle
(`X-WingVTOLEngine`, `TieFighterVTOLEngine`: `setAcceleration 0/0/-10000`
clipped to 0..100). Full reverse winds the main engine down and spins the
lift engines up: the X-Wing goes from 86.3 m/s to 7.7 in 9.8 s and climbs
51 m doing it (`tests/gc_brake_probe.mjs`). It is the obvious Star Wars move
("they'll fly right past"), and the first lesson was built on it. It does
not work: the TIE's pilot eases off with the same engines
(`PLANS.hunter`'s closure law already pulls the throttle to -1), so a
straight-line brake never makes it overshoot. Braking from 60, 100, 150
and 260 m, against a TIE arriving from 250, 350 and 450 m back at 100 and
125 m/s, was shot down 9 of 9 every time. A brake held through a hard turn
was never hit, like the turn at full throttle, and added little: one kill
in nine held 8 s from 300 m, none held 2 to 4 s. So the lesson says so.

## The lessons

Nine starts each (the school's ±30 m and ±3 m/s about yours), the X-Wing
yours, the TIE fighter the ace's. `tests/dogfight_gcmod_harness.mjs` flies
them (`--text`, `--trace <demo>`); `tests/test_dogfight_gcmod.py` holds
every number the words give.

| Lesson | Demo | Nine starts |
|---|---|---|
| **Never race a TIE**: a TIE 450 m behind, closing at 22 m/s | Run for it (`swRun`) | shot down 9 of 9, 15.8 to 16.2 s in; it sits 95 m back for the seventh bolt |
| | Hit the brakes (`swBrake`, inside 260 m) | shot down 9 of 9, 14.7 to 16.8 s in; you slow to 25 m/s, it to 39 to 41; it slides past in three, at 19 s, too late |
| | Turn hard (`swBreak`, inside 300 m, full throttle) | never hit, 9 of 9; it is in front of you 9 to 19 s in; 52 to 224 m apart at 40 s; two bolts on it in one |
| **Four guns to one**: head-on, 1,400 m apart | The joust (`swJoust` both) | the X-Wing wins 9 of 9, 6.1 to 7.1 s in; the TIE lands 0 to 4 of the seven it needs |
| | The TIE comes back (`swSlash`) | for the TIE: shot down in five, 10.3 to 10.9 s in; four come to nothing; two bolts at most |
| | The TIE leaves (`swExtend`) | for the TIE: never hit, 9 of 9; never closer than 1,124 m; 2.2 km apart at 40 s |

A pilot cannot see straight behind (`EYES.tail`, 20 degrees) and loses a
plane there in 4 s (`EYES.lose`): the defending plans judge the range from
where they last saw the TIE and how fast it was closing (`judged`), as a
pilot who saw it 450 m back would. A weave to keep it in sight was tried
first and dropped: it threw the TIE's aim off by itself (running then took
0 or 1 bolts), and the lesson stopped being about the move.

## Open

- **FLY IT and the Range** (`dogfight-live.js`) fly these lessons on the
  page's real planes, with the game's own guns and damage, not the lesson's
  `fight`: nobody has flown them there.
- **The what-if replays** (`extendFrom`) carry each side's craft but not its
  `fight`, so a what-if from a GCMOD fight flies the school's guns.
- **The nine book lessons on GCMOD** are flown as written (the X-Wing, pace
  1) or as their jet files (the TIE, the A-Wing and the TIE Advanced pace as
  jets), with the Spitfire's or the F-16's numbers in their words. None was
  re-flown on GCMOD's craft.
- **One pair.** Measured on the X-Wing against the TIE fighter. The A-Wing,
  TIE Interceptor, TIE Advanced and Y-Wing are in the fixture
  (`tests/fixtures/gc-starfighters.json`) and unmeasured in the lessons.
- **No real-game check.** The brake, the lift engines and the TIE's matching
  brake are the page's flight law on GCMOD's data; nobody has watched a TIE
  try to follow a braking X-Wing in the game.
