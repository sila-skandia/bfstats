# Dogfight school

Bot pilots who fly the classic air combat moves well, a theatre that replays
each move the way the History Channel's *Dogfights* drew its fights, and a live
fight on the proving ground against the ace flying it, with a coach on screen
telling you what he is doing and what beats it.

The owner's brief (2026-11-07), in short: fly-boy bots extremely skilled at
dogfighting; research the tactics (the scissors and the rest); use the
proving ground to show a fight and how a move helps or hurts; and explain
the trick the best BF1942 pilots use, pulling up and over so you cannot
follow them, then coming down to pick you off. Above all, learn to **counter**
moves, with tips on screen for the controls.

The owner's second round of notes (2026-11-07): follow the site's design
system; the enemy is too basic, real bots are harder to shoot down and hold
you in their lock; two situations he could not solve (a tight turn fight with
an equal, or one turning tighter, and an enemy with the height); too much on
screen while flying, and a view of where the opponent is against you instead;
and the reconstructions should show the shots. All in: "The hunter", "When he
has the height", "Out of his lock", "The live fight's screen", "The firing"
and "In the site's design system" below.

Status: **built**, vanilla Coral Sea checked in headless Chrome (see
"Checked"). Not checked by hand in the browser pane, which was hidden for the
whole session (the page ran at 1.5 frames a second, then not at all). Nothing
is published: no asset is involved.

## Using it

- **Menu:** PROVING GROUND tab, pick a battle with aircraft, **DOGFIGHT
  SCHOOL**. That opens the range with one enemy pilot and the theatre up
  (`?proving=1&map=<battle>&botCount=1&school=`).
- **On the range:** **V**, or the DOGFIGHT SCHOOL button on the readout.
- **The theatre:** six lessons down the left. Each has its fights as tabs (for
  example *He bounces you* and *You meet the dive*), play, pause, 0.25x to 2x,
  a scrubber over a chart of both pilots' energy with the hits marked, and
  four cameras (wide, behind either pilot, from above). Drag to swing the wide
  view, wheel to zoom, Space to pause, arrows to skip. THE MOVE and THE
  COUNTER under it. **FLY IT YOURSELF** puts you in the air against the
  lesson's ace.
- **The live fight:** the coach (top centre: what he is doing, what to do,
  the keys, and one line of score), the view (bottom right: a window on the
  two of you, see below), and a ring on him with his range, or an arrow on the
  screen's edge pointing to him ("261 m behind"). The range's own readout and
  hit log are hidden while you fly. **Y** again, **I** the instructor, **O**
  end the lesson, **V** back to the theatre.
- **The instructor:** I hands your seat to a pilot flying the lesson's counter.
  The stick shows his hands. Touch any control and you have it back ("YOU HAVE
  CONTROL").

## The hunter

`PLANS.hunter` is the lock: he gets onto your tail and stays there. He holds
the closure (fast in from far out, matched inside 200 m so he does not fly
past), leads you once the nose is on, lags your turn when you out-turn his
sight, pulls up out of your turn (a high yo-yo) when he is closing too fast,
follows a climb shallow, and breaks if you get onto his. Against a pilot who
flies straight he kills ten times in ten. He is the opponent of *Out of his
lock*, which starts him 300 m behind you.

## Your two situations

Each answer was found by flying the candidates against the ace from ten
starts, then held to its lesson from nine (`test_dogfight_school.py`).

**Out of his lock: the turn fight.** The hunter on your tail, 60 s:

| What you do | Ten starts (first bench) | Nine starts (the lesson) |
|---|---|---|
| Fly straight | shot down 10 of 10 | shot down 9 of 9 |
| Dive away | 144 hits taken, shot down 5 | 12 hits a fight |
| Jink (reverse every couple of seconds) | 48 hits taken | (not in the lesson) |
| Turn hard and keep turning | 4 to 9 taken | 0.2 a fight |
| Turn hard, and chop the throttle (S) when he is inside 220 m | 2 taken, 17 landed on him | none taken, the only hits are yours |

So in a turn fight between equals: survive by turning as hard as it goes (he
cannot pull his sight onto a Spitfire turning hard, and a faster Spitfire turns
no tighter), and turn the tables with the throttle: S bites in three seconds,
the propeller drags you back, he flies out in front. If he is turning tighter
on you, the same: he cannot shoot what he cannot point at, and the chop is
what makes him fly past.

**When he has the height.** The boom-and-zoom ace starting 440 m above, 75 s:

| What you do | Nine starts | Your energy at the end against his |
|---|---|---|
| Climb straight for the height | shot down 9 of 9 | 170 m behind |
| Turn flat | 0.7 hits a fight | 280 m behind |
| Climb between his dives, break only when he commits inside 380 m | never hit | **300 m ahead** |

Climbing is right, but only while he is not coming at you; the break is what
makes his dive cost him, and the climb between dives is what takes the height
back.

## The live fight's screen

The owner found too much on screen. What is left: the coach (one line, one
tip, the keys, one line of score), the view, and the mark on him. The scope,
the energy bars, the separate score panel and the stick went; the stick comes
back only while the instructor flies.

**The view** (`dogfight-live.js` `renderInset`): the world drawn again into a
window bottom right, from a camera behind you on the line from him to you,
raised a third, far enough back that both of you fit (`range x 0.45`, 45 to
320 m). Over it, a pin and a four-second trail for each of you, the line
between, and under it the range, his height against yours and his own words,
turned to you ("On your tail, guns on you"). The page calls it after its
render, the way the range's spotter is drawn.

**The mark:** where he is in the camera's frame decides it. On screen, a ring
on him and his range; off it, an arrow on the screen's edge pointing the way
he is, leaning to the bottom edge when he is behind you, labelled "behind".

## The firing

Every burst in a reconstruction is drawn: a flash at the firing pilot's nose,
each round a bright head on a 50 m streak in his colour, the hit sparks
larger, and a GUNS callout over him with the range he is firing from ("GUNS ·
271 M · HIT"). The timeline shades each side's bursts (the ace's above, the
other's below), and **Slow on shots** (on by default) drops the replay to 0.3x
for half a second either side of every burst, so the moment the move paid off
is the moment you see.

## In the site's design system

The theatre and the live screen are in Neutral Depth (`tokens.css`, the
site's `ui/DESIGN_SYSTEM.md`): the `--mm-*` surfaces and hairline rules, Geist
with the mono uppercase eyebrows, the olive accent's leading bar on headings
and underline on the selected fight, the sub-tab chips for speed and camera,
the highlight button for *Fly it yourself*. The two pilots are the site's team
tints, the enemy in `--mm-kill` red and the other seat in `--mm-success`
green, the shots in `--mm-load-busy`. The 3D stage is `--mm-stage`, its floor
`--mm-bg` and its grid the rules; the theatre reads every colour from the
tokens at runtime, so no hex lives in its code.

## What the airframe does

El Alamein's Spitfire on the engine's flight law (`viewer/aircraft.js`, the
laws of `features/flyable-vehicles/flight-model.md` §10), flown under node by
`tests/dogfight_school_harness.mjs`. These are the numbers the lessons quote,
and `tests/test_dogfight_school.py` holds every one.

| | measured |
|---|---|
| Straight up from 70 m/s | 70, 61, 47, 34 m/s a second apart: 10 to 14 m/s lost every second, gone about 160 m higher. It does **not** hang on its propeller |
| 45 degree dive, full throttle, from 60 m/s | 105 m/s in ten seconds |
| Best sustained climb | 12.5 m/s up at 20 degrees (51 m/s), 12.2 at 30 (40 m/s); 8.8 at 45 |
| Full pull from wings level | 6 deg/s at 20 m/s, 31 at 40, 46 at 55, 61 at 70: faster turns faster, there is no corner speed |
| Hardest sustained turn | about 39 deg/s (9 s a circle), settling at about 46 m/s, sinking 5 m/s |
| Throttle | S takes 3 to 4 s to bite; held, it takes 65 m/s to 37 in nine seconds, the shut throttle to 47 |
| Guns | 400 m/s, 1.5 s; two wing guns 2.5 m out, 1.6 degrees in: the streams cross about 90 m ahead and are a wingspan apart by 268 m |

Two of these changed the school:

- **Speed buys turn rate.** With no g limit, a faster Spitfire turns both
  faster and about as tight as a slower one. The real world's overshoot, where
  the fast attacker flies wide of the slow defender's break, mostly does not
  happen here. The break turn spoils the shot; it does not reverse the fight.
- **The guns reach 270 m, not 400.** Wing convergence, read off the live
  Spitfire's muzzles, parts the two streams past the target's wingtips beyond
  268 m. The school's pilots fire only inside that (`dogfight-pilot.js`
  `gunOf`), and the duel flies both guns' rounds, converging, against a
  wing, fuselage, tailplane and fin (`dogfight-duel.js` `AIRFRAME`). Flown
  against a 4.5 m sphere instead, the duels scored kills at 350 m that the
  page's own rounds never landed.

## The lessons, and what their fights showed

Every fight is flown, not animated: two of the school's pilots in two
Spitfires (`runDuel`), every round flown and tested against the airframe. Each
fight was flown from nine nearby starts (30 m either side, 3 m/s either way),
and its lesson's words quote what those nine did (`test_dogfight_school.py`
`LessonTests`).

| Lesson | Fight | Nine starts |
|---|---|---|
| Boom and zoom | *He bounces you*: the unaware pilot | shot down 9 of 9 |
| | *You meet the dive*: turn round flat to face each dive, never chase the zoom | never shot down, no hits |
| Up and over | *You let him go*: peel away, as "never follow a faster plane up" says | he lands 11 hits a fight |
| | *You follow shallow*: 20 to 30 degrees under him, keep your speed | he lands about 1; you land more on him |
| The break turn | *He flies straight* | shot down 9 of 9 |
| | *He breaks* | never shot down, about 0.3 hits |
| | *You stay patient*: lift out of his turn | no kill either side |
| The flat scissors | *Scissoring* | no kill: slow, and both sink |
| The Immelmann and the split-S | *He turns round* | never shot down |
| When he has the height | *You climb straight* / *You turn flat* / *You climb between his dives* | see "Your two situations" |
| Out of his lock | *You fly straight* / *You dive away* / *You turn hard* / *You turn and chop* | see "Your two situations" |
| Against the ace | none: fly it | |

What the school found on the way, and what it cost:

- **Up and over is the owner's trick, and its counter is the opposite of the
  old advice.** Between two Spitfires a steep climb can never outrun a
  follower, because both bank energy at the same rate, and the follower who
  climbs at 25 degrees keeps more of it. Climbing away works when the other
  pilot gives up the chase or wastes his speed yanking the nose up. Over
  sixteen starts in the first version (hits as a sphere), following him won
  every time; letting him go lost most.
- **A hard-turning Spitfire cannot be hit from a flat chase.** Pure pursuit,
  lead pursuit and both yo-yos, flown at it from five starts each for 40
  seconds, landed nothing. So the yo-yo lessons (and the lead turn, whose
  pilot lost the pass it was meant to win) are not in the school: their
  fights could not be made to say what the lessons said. Their plans are not
  kept.
- **Catching the Immelmann at the top** worked against the sphere and not
  against the airframe: the follower, too close at the pass, ran out of speed
  climbing after him. The counter stays as advice, with the warning in its
  words, and with no fight claiming it.
- **The scissors is a stalemate here.** At 30 m/s a Spitfire barely turns.
  Its fight is shown for what it is, and its end card says so.

## The ace

*Against the ace* is a sparring partner who picks his own moves
(`PLANS.ace`), all of them ones the lessons' fights proved: never let a
target run (past 900 m, straight after him, height spent on speed); a target
going away is no threat, so go for him; anyone pointing at him from out of
reach, turn to face; on his tail, break into him, and if he sits close in the
circle, chop the throttle so he flies past (S bites after 3 s); with 220 m
over a target not facing him, boom and zoom; a target climbing away, follow
shallow; otherwise climb round him at a 700 m stand-off, on the side he is
already turning, at the climb that banks the most energy.

Flown against every other pilot in the school (`chaser`, `meetTheDive`,
`shallowFollow`, `patientAttacker`, `circler`, `unaware`) from five starts at
two speeds, 90 s each (`test_dogfight_school.py` `AceTests`):

| | landed | took | lost |
|---|---|---|---|
| The first ace (yo-yos, a climb away from him) | 9 | 178 | 1 |
| The ace now | 128 | 82 | 0 |

He kills nobody in 90 s: between two Spitfires that both turn, the circle is a
stalemate (above), and 22 hits in one fight is a lot. Most of his hits come
from the throttle chop and the run in on a target that has stopped turning.

## How it is built

| Module | What |
|---|---|
| `viewer/dogfight-flight.js` | The hands: `pointNose` (roll the lift onto the target, pull; near it, bank by the sideways error with a slow trim integral, so the nose settles instead of rolling round it), `pullLift`, `bankAndPull`, `hardTurn` (full pull, the bank eased off by the sink), `leadPoint` (relative velocity, the target's turn as an acceleration), `gunSolution`. Pure; gains found by a search on the Spitfire (`rollDamp 0.6`, `kPitch 2.5`, `kPitchI 2`) |
| `viewer/dogfight-pilot.js` | `geometry` (range, angle off the nose, aspect, closure, energy), `situation`, the moves (lead, pure and lag pursuit, `turnToward`, `wingover`, `climbAngle`) and the plans (`PLANS`): the aces' `boomAndZoom`, `upAndOver`, `breakTurn`, `scissors`, `turnarounds`, `hunter`, `ace`; the other seat's `unaware`, `chaser`, `cruiser`, `circler`, `meetTheDive`, `dontFollow`, `shallowFollow`, `patientAttacker`, `flatTurn`, `chopper`, `diveOut`, `climbStraight`, `climbBetween`. A floor and ceiling guard over every plan; `reflex` breaks a plan into anyone on its tail; a green pilot (skill under 0.7) loses sight of a target that slips behind him |
| `viewer/dogfight-duel.js` | `runDuel`: two pilots, two airframes, a tick at a time; the rounds flown and struck against `AIRFRAME`; `placePlane` stands an airframe in the air with its engines spun up |
| `viewer/dogfight-lessons.js` | The six lessons: words, starts, fights (`demos`), the coach's line for every phase the ace flies; `fighterRank` (a fighter before a bomber) |
| `viewer/dogfight-coach.js` | The live fight's words, worst first: the ground, being slow, the ace's own phase (the lesson's line), a bandit on your tail, a shot to take |
| `viewer/dogfight-theatre.js` | The theatre: its own renderer and scene over the page; the fighters are clones of the battle's own (`proving-ground-page.js` `fighterOn`), drawn up to four times life size when the camera stands back, each trailing a ribbon along its wings (it twists as he rolls) with its shadow and a drop line to the ground |
| `viewer/dogfight-live.js` | The live fight: places both seats in the air, flies the ace's seat (`bot.ace`), the instructor (`flightOverride`), counts the ace's rounds on you (`noteImpact`), the coach, the view (`renderInset`) and the mark on him |

Hooks in the page, each one line where it lands:

- `bot.js` `tick`: after the plan, `this.ace?.(this, dt, now)` flies an air
  seat: the stick, throttle and trigger (`_airInput`, `isFiring`).
- `local-player.js` `frameInput`: `page.flightOverride?.(input)` for a seated
  player, before the world takes the input.
- `map.html` `guns.onImpact`: `provingPage.noteImpact(record, firer)` before the
  range's harmless gate. A hull's hit names its owner id; the damage table
  (`damageVisuals`) has its node.
- `map.html` `pilotBots`: a free fighter before a bomber.
- `proving-ground.js` `provingGroundUrl`: `school`.

The page loads the school's modules (the theatre and the live fight) the
first time it opens (`proving-ground-page.js` `loadSchool`), so the range's
own tests and loads carry only the lesson book.

The theatre flies its fights over a floor at 0, as the tests do, so a
reconstruction in the page is the one the tests hold: checked, all nine
fights' ends and hits match node's to the tick.

The live fight stages over the firing line heading down range. The page
drops a seat flown about 4 km out (seen at z -4030; not traced), so past
2 km from the floor's middle the coach says to turn back.

## Checked

- `tests/test_dogfight_school.py`: 29 tests, about 20 s. The airframe's
  numbers above, the stick's signs, the hands settling, the guns' reach and
  the airframe's hit boxes, the coach, and every lesson's fights from nine
  starts.
- `tests/test_proving_ground.py` (56) passes with the page's new imports.
- Headless Chrome (system Chrome through the ui's Playwright), Coral Sea,
  1440x900:
  - The theatre opens from `?school=`, flies every lesson's fights on the
    battle's Spitfire, and its ends and hits match node's.
  - Wide, chase and overhead cameras. The end card reads "The other pilot wins
    at 13.9 s. Hits: ace 0, other 22..." on the first version's up-and-over.
  - The menu's DOGFIGHT SCHOOL is enabled for Coral Sea and navigates to
    `map.html?proving=1&map=Coral_sea&team=1&botCount=1&botSkill=0.5&school=`.
  - The live fight: the bot takes a Spitfire off the enemy airfield, is placed
    440 m above and 420 m behind, and flies dive, zoom and wingover through
    its phases while the coach calls each one. With nobody flying your seat it
    landed 62 rounds and the banner said he would have shot you down. With the
    instructor flying the counter, it landed none in 45 s.

Two things this found in the live page that the duels could not: the stick
went NaN when the bot's gun numbers had not loaded (a muzzle speed of 0 put
the lead at infinity; `gunOf` now keeps the Spitfire's), and the convergence
above.

## Open

- **Not flown by hand.** The browser pane was hidden all session. A person
  should fly each lesson once with the mouse.
- **The yo-yos, the lead turn and the Thach weave** are researched
  (`research.md`) but not in the school: no pilot here made their fights say
  what the lessons would. The Thach weave needs two friendly aircraft and the
  school has one seat a side.
- **Against the ace** has no fight in the theatre: his fights end without a
  kill, which makes a dull reconstruction. He is the live fight's sparring
  partner.
- **One airframe both sides.** The theatre flies the battle's best fighter in
  both seats, so only the flying differs. The live ace takes whatever fighter
  the enemy airfield has first (`fighterRank`); a Bf 109 against your
  Spitfire is a different fight from the lesson's.
- **His hits are counted, not felt.** The range is harmless, so the score
  counts his rounds on you and a banner says when 22 would have brought you
  down (`KILL_HITS`, the duel's number, not read from the damage tables).
- **Mods** are untested: the school picks fighters by name (`FIGHTERS`).
- **Where the page drops a far-out seat** is not traced.
