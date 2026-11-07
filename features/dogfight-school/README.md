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

The third round (2026-11-07): the reconstructions did not say whether a pilot
was evading or going for the kill, and in game it is all about the kill shot;
and the live screen should show which way to move the stick, with a way to
freeze the fight, see how the move plays out, then go back and fly it (then:
that preview is confusing, draw lines on the screen instead). In: "Where the
kill shots are" and "The guide, and the lines" below. Seeing the rings, the
owner asked for a training course of them on their own, from a pure skills
point of view: "Ring courses" below.

Status: **built**, vanilla Coral Sea checked in headless Chrome (see
"Checked"). Not checked by hand in the browser pane, which was hidden for the
whole session (the page ran at 1.5 frames a second, then not at all). Nothing
is published: no asset is involved.

## Using it

- **Your plane:** YOUR PLANE at the top of the school's list: every aircraft
  in the battle (they all park on your airfield, both sides' types, all open
  to you), fighters first. The choice is kept in this browser and used for
  the lessons, the ring courses and the lines; the HUD names it ("DOGFIGHT
  SCHOOL · BOOM AND ZOOM · YOUR BF109"). The reconstructions in the theatre
  stay on the battle's best fighter, which is what their numbers were
  measured on.
- **Straight into the plane:** FLY IT YOURSELF or a ring course seats you in
  your plane at once: if the spawn screen is up, or you are dead, the range
  stands you up on the firing line itself (no flag to pick, no READY) and
  puts you in the plane. Shot down or crashed, you are back in it the same
  way. The menu's DOGFIGHT SCHOOL opens with you already stood up
  (`spawn=FiringLine`). Checked on Coral Sea: from the spawn screen to
  airborne in a BF109 in 1.5 s for a lesson, 4 s for a course (three of
  them the course's count).

- **Menu:** THE RANGE tab, pick a battle with aircraft, **DOGFIGHT
  SCHOOL**. That opens the range with one enemy pilot and the theatre up
  (`?proving=1&map=<battle>&botCount=1&school=`).
- **On the range:** **V**, or the DOGFIGHT SCHOOL button on the readout.
- **The theatre:** six lessons down the left. Each has its fights as tabs (for
  example *He bounces you* and *You meet the dive*), play, pause, 0.25x to 2x,
  a scrubber over a chart of both pilots' energy with the hits marked, and
  six cameras (wide, behind either pilot, down either pilot's gunsight, from
  above). Drag to swing the wide
  view, wheel to zoom, Space to pause, arrows to skip. THE MOVE and THE
  COUNTER under it. **FLY IT YOURSELF** puts you in the air against the
  lesson's ace.
- **The live fight:** the coach (top centre: what he is doing, what to do,
  the keys, and one line of score), the guide (bottom left: which way to move
  the stick), the view (bottom right: a window on the two of you, see below),
  and a ring on him with his range, or an arrow on the screen's edge pointing
  to him ("261 m behind"). The range's own readout and hit log are hidden
  while you fly. **P** pause, **G** the guide and its lines on or off, **I** the
  instructor, **Y** again, **O** end the lesson, **V** back to the theatre.
- **Ring courses:** in the school's list under the lessons (RING COURSES),
  or `?proving=1&map=<battle>&course=<id>`. In the air: **Y** again, **N**
  the next course, **I** the instructor, **G** the guide, **O** end.
- **The instructor:** I hands your seat to the pilot the guide follows. Touch
  any control and you have it back ("YOU HAVE CONTROL").

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

**Out of his lock: breaking the tail.** The hunter on your tail, 60 s (the first bench; the lesson as rebuilt on 2026-11-07 is below the table):

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

Rebuilt 2026-11-07 after the owner watched it ("the dive, turn and chop all
have the ace on the 6"): turning hard spoils his aim but never moves him off
your tail (he follows you round 40 to 100 m back), and the old chop left him
in front of you for one second before he broke back. Measured in the node rig
from nine starts, what moves him off your tail in this engine is two things:
turning into him while he is still about 400 m back (from that far he cannot
follow you round a 120 m circle, and the chase becomes a head-on pass), and
the chop once he is close behind you in the circle, now with the hunter
running after he flies past (he is the faster one; full throttle away is his
way out) so he stays in front of you for about 13 s. A break at 250 m, a
split-S, a straight pull-up chop and a flat scissors were tried and did not
move him (`reviews/tail.md`, "Breaking the tail").

**When he has the height.** The boom-and-zoom ace starting 440 m above, 75 s:

| What you do | Nine starts | Your energy at the end against his |
|---|---|---|
| Climb straight for the height | shot down 9 of 9 | 170 m behind |
| Turn flat | 0.7 hits a fight | 280 m behind |
| Climb between his dives, break only when he commits inside 380 m | never hit | **300 m ahead** |

Climbing is right, but only while he is not coming at you; the break is what
makes his dive cost him, and the climb between dives is what takes the height
back.

## On his tail: staying there

The owner's fourth note: on someone's tail, when he breaks and I chase him,
it almost at once turns into a 50/50; how do I stay there without
overshooting? Researched by flying eleven attacking techniques against three
defenders (`breakTurn`, which breaks once you are committed and reverses;
`chopper`, which turns and chops; `flatTurn`, which just turns), five starts
each, 60 s, then the best against `breaker` (the lesson's ace: breaks early
at 450 m, keeps turning, chops when you sit close, reverses if you fly past).

What decided it, in hits landed / taken over the five starts:

| Attacker | vs the usual break (`breakTurn`) | vs the chop (`chopper`) |
|---|---|---|
| The eager chaser (full throttle, nose on him) | 11 / 0 | 0 / 4 |
| **Arrive slow** (250 m back at his speed before he sees you) | **110 / 0, five kills** | 0 / 0 |
| Lag and match speed | 0 / 0 | 4 / 0 |
| High yo-yo when he breaks (`patientAttacker`) | 12 / 3 | 2 / 17 |
| The hunter (sits about 170 m back) | 2 / 7 | 6 / 5 |
| Extend and come back | 13 / 5 | 11 / 7 |
| Lag roll round his turn | 11 / 0 | 2 / 7 |
| The perch (climb over his circle, dive when his nose is away) | 110 / 0, five kills | 2 / 0 |

Why the 50/50: a defender who breaks while you are still 400-500 m back
completes half his circle (4.5 s) before you can cover the distance, so he is
facing you when you arrive. And a Spitfire turning hard cannot be hit from a
flat chase: against a defender who breaks early and keeps turning, nothing
the school tried landed much in 60 s or in 150. The aim against him is not to
lose: stay out of the 220 m where his chop makes you fly past, follow his
circle with the nose behind him, and shoot when he stops turning.

The lesson (*On his tail: staying there*, nine starts): rushing in lands
about 3 hits a fight and never kills; arriving slow kills eight times in nine.
Against the chop, sitting 170 m back takes 3 hits a fight and lands almost
none; lagging 250 m back (`lagBack`: his speed, not your closure) takes none.

## Room to fight

The owner's third note: the fights left the map too quickly and took damage.
The construct declared no combat area, so the engine's rule for a level that
declares none bounded it by its terrain (`combat-area.js` `terrainRect`, the
2 km floor): ten seconds outside, then 5 HP a second (CA-1), and a fighter
out of it in fifteen seconds was dead some thirty after. That was the seat
"dropped about 4 km out" earlier.

- The construct now declares a combat area of its own, 10 km square round the
  floor's middle (`proving-ground.js` `PG.ARENA`); the floor's look repeats out
  to it. An unflown Spitfire flying straight off the floor, which died at 43 s,
  flies on past 70 s.
- The school's pilots fly inside a fence (`dogfight-pilot.js` `fence`): past
  2.6 km from the floor's middle and flying outward, the ace (and the
  instructor) turns back toward it, level, unless an enemy is about to shoot
  him, and flies home until 500 m back inside, so his plan cannot turn him
  straight back out. In the live check he stayed inside 2.2 km for 70 s.
- The coach says "You are leaving the range" past 3.5 km.

## The live fight's screen

The owner found too much on screen. What is left: the coach (one line, one
tip, the keys, one line of score), the view, and the mark on him. The scope,
the energy bars and the separate score panel went. The stick came back in the
third round as the guide (below), which says what to do rather than what
anyone is doing.

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
the plane's own tracers (below), the hit sparks, and a GUNS callout over him with the range he is firing from ("GUNS ·
271 M · HIT"). The timeline shades each side's bursts (the ace's above, the
other's below), and **Slow on shots** (on by default) drops the replay to 0.3x
for half a second either side of every burst, so the moment the move paid off
is the moment you see.

### The planes' own propellers and tracers (2026-11-07)

The theatre draws each fighter as the game does (`dogfight-plane-look.js`):

- **Propeller.** Every duel tick records the propeller engine's revs
  (`rv`, `Aircraft.rotorEngine`), and the replay turns the blades on them with
  the engine's own tail (`engine-spin.js`, ledger PHY-30): 20 degrees a tick
  per unit of revs, the blurred disc in place of the blades past the
  selector's `comparison^2`. A seek or a pause turns nothing.
- **Tracers.** The rounds are the gun's own streak, `TLight_m1` on every
  vanilla fighter, stretched the engine's way (TRC-1..TRC-3): 10 across and
  `|v| / tracerScaler` long (8 m for a 400 m/s MG over 50), its tail growing
  out of the muzzle. A duel fires a round every tick, 30 a second, while the
  gun fires `roundOfFire` (12 for a Spitfire's or a 109's guns), so the
  tracers are the duel's rounds on the gun's own cadence, every
  `tracer.interval`-th of them (3), counted across bursts. The rounds between
  fly unseen, as in the game. Far off, the streak is held at 2.5 px and dimmed
  by as much, as the world's tracers are; in the diagram views, where the
  fighters are drawn bigger than life, it is scaled with them and keeps at
  least a third of its light so a burst reads from a kilometre off. Both
  sides' tracers are the same colour, as the game's are: who is firing is the
  gun line, the flash and the GUNS callout.

`tests/test_dogfight_plane_look.py` holds the cadence (4 tracers in a
second's burst), the spin and the disc, the streak's size and its tail.

## Where the kill shots are

Every phase of every plan says what the pilot is trying to do: **going for
the shot**, **evading**, or **setting up** (`dogfight-pilot.js` `INTENTS`; the
reflex's break is evading, the floor and the fence are setting up, and a
pilot on the trigger is going for the shot whatever his phase). The duel
records it each tick, with whether his guns have the other (`o`: the nose on
the lead, inside the guns' reach, the shot that lands) and the kill zone
round it (`z`: inside the reach, within 8 degrees).

The theatre draws it four ways:

- **The label** beside each pilot's words: GOING FOR THE SHOT (hit colour,
  pulsing), EVADING, SETTING UP.
- **His gun line,** from his nose out to the guns' reach (268 m for the
  Spitfire): faint, in his colour while the other is in the kill zone, the
  hit colour while the shot would land.
- **The timeline** shades each side's kill-shot windows in his colour (the
  ace's above, the other's below), with the hits as ticks.
- **Explain shots** (on by default): the replay stops for 2.8 s on every new
  kill shot. The card says who has it, from how far and how far off the lead
  ("268 m out, his nose 0.4 degrees off the lead, for 6.3 s"), how he got it
  (the move before, then the move now: "sitting high: picking the moment.
  Then: diving on him"), and what the other pilot was doing meanwhile.

Two gunsight cameras look down each pilot's guns: a ring where his guns point,
a dot where they need to point (the lead), "KILL ZONE" or "ON TARGET" with the
range under it. The dot in the ring is the shot. The end card adds each side's
seconds of kill shot.

What the windows showed, flown from nine starts each (the tests hold these):

| Lesson | Without the counter | With it |
|---|---|---|
| Boom and zoom | the ace has 5.7-6.7 s of kill shot | none |
| When he has the height | 4.6-5.1 s | none |
| Out of his lock | 10.7-14.4 s | turning into him early: none; turn then chop: 4.5-8.5 s, all of it before you turn, while he holds his fire, never a hit |
| On his tail, rushing in vs arriving slow | you: 0.4-0.8 s | you: 11-25 s |

## The guide, and the lines

**The guide** (bottom left, G hides it): a pilot flying the lesson's counter
flies your seat in his head every frame, and his stick, smoothed over a
quarter of a second, is what the guide shows. A stick gate where up is the
nose going up: the filled dot is where the stick should be, the ring is
yours, and the arrows round it light the way to move it. Beside it, a row per
control with its default keys: *Pull · nose up* (Down arrow or mouse back),
*Roll hard right* (Right arrow or mouse right), *Rudder left* (A), *Throttle
back* (S), *Fire* (Space or click). A row turns green while you are doing it;
the ring turns green when your stick is where his is. The keys are the Air
control map's defaults (`controls-defaults.js`); a rebound key is not shown.

**The lines** (on with the guide): four times a second the school flies the
next 3.5 s off the page from where you both are (`runDuel` from both
airframes' exact states and both pilots' memories, you flying the counter
the guide follows) and draws it into the world: a green tube for your way,
rings every half second from a second out to fly through, his path in red,
and a gold ring where your guns would have him, tagged "YOUR SHOT · 2.4 S".
Each flight builds fresh airframes: one reused carried its servos over and drew the wrong line, which the tests caught. **P**
pauses the fight with the lines up (both airframes held where they are) so
you can look before you fly; P again to go.

This replaced the first try, Show me, which froze the fight and played the
counter and "holding on" as ghosts with a card comparing them. The owner
found it confusing; the lines say the same thing in the place you are
already looking. The duel-from-a-frozen-moment it needed stayed, and so did
its tests: from out of his lock, frozen 5 s and 7 s in with the ace on your
tail, holding on is a kill every time and the counter takes 0 and 4 hits.

## Ring courses

Stick-and-rudder drills with nobody shooting (`dogfight-rings.js`, live in
`dogfight-course.js`). Each course is a manoeuvre the school's hands fly first,
on an airframe built from the fighter you fly, from the course's start over
the range: rings are dropped along that path every 0.6 to 0.75 s, so every
ring is one the airframe can reach. The hands fly at 85% of full stick
(`RESERVE`): a path flown at the limit can never be caught from outside it,
since no turn is tighter, so the courses keep a reserve for the pilot
catching up.

| Course | What it is | Rings | Seconds |
|---|---|---|---|
| Break turns | hard right 180, reverse, hard left 180 | 18 | 15.5 |
| Climbing turn | the chandelle: 180 degrees, trading speed for height | 6 | 6.4 |
| Reversals | bank to bank four times: the scissors' hands | 18 | 12.3 |
| Wingover | climb at 45, roll to the vertical, let the nose fall round | 17 | 14.7 |
| Loop | up and over, wings level | 10 | 8.9 |
| Split-S | roll inverted and pull through, down and back | 10 | 8.6 |

(Rings and seconds on the tests' Spitfire; the live course is laid with the
battle's own fighter, so Coral Sea's has 12 rings in its loop.)

In the air: a three-second count with the airframe held at the start, then
the clock. The ring to fly through next is lit green and pulses, the next few
are olive and fade with distance, the manoeuvre's path runs faint through
them, and an arrow on the screen's edge points to the next ring when it is
off the screen. Through a ring flashes gold; past it outside, or flying on
away from it for 2.5 s, flashes red and counts as missed. Rings are 12 m
across the middle (a Spitfire is 11.3 m wide). The end card: rings, time, how
far from the middle on average, and your best, kept in this browser.

**The guide** on a course shows the stick for the part of the course you are
on (`steerCourse`): the hands for that part (the hard turn, the loop) flown
from your own state, more pull when the path is on the lift side, and well
off the path a turn back toward it. The instructor flies it.

The tests (`tests/test_dogfight_school.py`): every course is flown without a
stall (never under 25 m/s, the wingover's slowest is 29) or coming within
150 m of the floor; the guide followed threads every ring from the start, and
at least three quarters of them from starts a few metres and m/s off.
Checked in the page on Coral Sea with the instructor flying: break turns 15
of 18, the loop 6 of 12.

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

The table as it stands after the review and rebuild of 2026-11-07 (below).
Each row's numbers are held by that lesson's shape test, from the nine starts;
the full figures, and every threshold relaxed from a reviewer's proposal with
its reason, are in `reviews/<fixer>.md`.

| Lesson | Fight | Nine starts | Notes |
|---|---|---|---|
| Boom and zoom | *He bounces you* | 2 or 3 passes, each a 41-58 degree dive and a 0.6 s burst from inside 130 m, a zoom 245-268 m back above you; shot down at 33-48 s | `reviews/height.md` |
| | *You meet the dive* | 3 dives, each starting lower (400, about 250, about 160 m above you); each a head-on pass he breaks off at 350 m; no hits | |
| When he has the height | *You climb straight* / *You turn flat* / *You climb between his dives* | killed in one pass at 13.5-14.1 s / a flat turn held at 168-183 m, never hit / two dives broken into 2.9-3.8 s before his pass, 402-469 m climbed with him in sight, never more than 890 m apart | `reviews/height.md` |
| Up and over | *You follow him up* | he pulls to 78 degrees, you to 52-58; you hang 46-116 m under him at about 13 m/s; he seldom lands the shot coming down (0.7 hits a fight) | `reviews/vertical.md` |
| | *You follow shallow* | a 23 degree climb, nose under him; 184-273 m from him at his top, 16-18 m/s faster; the shot as he hangs in 6 of 9; hits 11 to you, 0.2 to him | |
| Out of his lock | *You fly straight* / *You dive away* / *You turn hard* / *You turn into him early* / *You turn, then chop* | shot down 9/9 / he sits 135-140 m behind all the way down, nose on you, and lands 7-20 / no hits either way, but he follows you round on your tail / his lock gone 2 s into the turn, a head-on pass 20-26 m apart, no hits / he flies past underneath 9/9 (5-14 m), runs, and is in front of you 13-14 s; you land 1-10, he lands none | `reviews/tail.md` |
| On his tail | *You rush in* / *You arrive slow* / *He chops, you sit close* / *He chops, you lag back* | he breaks at 298 m; you pass his tail 35 m behind and sit 50 m back with no lead / he really breaks; you go up over his turn, nobody hit / you fly past underneath 9/9 and run, he lands 2-7 / you stay 266-283 m out, he rolls out and you shoot him down from astern 7/9 | `reviews/break.md`, `reviews/tail.md` |
| The break turn | *He flies straight* / *He breaks* / *You stay patient* | shot down 9/9 / breaks at 298 m into him, he passes your tail 33-36 m behind, you reverse within 2 s; he stays 50 m back with no lead / a high yo-yo 0.8 s after the break, 70 m above, never inside 83 m, no hits | `reviews/break.md` |
| The flat scissors | *Scissoring* | a braid along one line, a crossing every 4.5-6 s, flat, never more than 200 m apart; the full-throttle pilot drifts ahead and the slower ace gets snap shots | above |
| The Immelmann and the split-S | *You follow him up* / *You meet him at the top* / *You let him go* / *You dive on him* | a half loop in its plane, 172 degrees round, 107 m up, 37 m/s on top; you hang under it / 261-279 m off at his top, nose on it, fire in 7 of 9 / a split-S: 180 degrees, 145 m down, 51 to 69 m/s / dive on him as he rolls over, fire in 9 of 9 | `reviews/loop.md` |
| Against the ace | none: fly it | | |

What the review found about the engine, which every lesson had to live with:

- **A faster Spitfire turns faster, not wider** (radius 55-76 m from 45 to
  130 m/s, measured). The textbook overshoot, where an attacker too fast for
  your turn flies out in front, does not happen in a flat turn here: he slides
  in behind you again. The break turn's payoff is therefore "he is stuck 50 m
  behind you with no lead", and the throttle chop only works as chop and pull
  up through the turn (he flies past underneath).
- **No hammerhead.** At 15 to 30 m/s nose-up, full rudder barely moves the
  nose; it falls through on its own (85 degrees up to 26 down in 4.5 s from
  15 m/s, the same with and without rudder). So the up-and-over pilot comes
  back over the top slow, and his nose sweeps through the follower he left
  hanging instead of settling on him: a snap shot, rarely a kill. Stronger
  aim, a closer break-off and a faster over-the-top were tried and made it
  worse (head-on hits in the counter). Open: whether a human with the mouse
  lands it where the bot cannot.
- **The throttle is a rate**: +1 winds the engine up, -1 brakes after 3-4 s,
  0 holds. A pilot "holding" 0.4 keeps winding it up.
- **Kill shots are taken shots.** The theatre's shot windows, end card and
  explain cards count a moment only when the trigger is down and the rounds
  would land (`ko`); a solution held while closing to firing range shows on
  the gun line instead. The boom-and-zoom ace lines up at 270 m and fires at
  130 m.

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
- **The scissors was not a scissors** (overruled 2026-11-07, see "Reviewed
  against the real tactics"): it was two planes flying circles of their own.
  It is rebuilt and its shape is tested.

## Reviewed against the real tactics (2026-11-07)

The owner watched the flat scissors and saw "after the contact both planes
spaz out and do their own thing". An adversarial reviewer measured it and
agreed: after the first pass the two flew separate circles in opposite
directions, met head-on every 11 s and drifted 580 m apart; the slow ace
never got behind. The tests had passed because they only counted hits. A
reviewer was then run on every lesson, each told to assume the reconstruction
was wrong until the numbers and the screen said otherwise (research the real
tactic, fly every demo from the tests' nine starts, look at it from above and
side-on in the theatre, list every lie in the words, propose a shape test).
Every lesson came back "no" or "partly". The reports are kept with the
work's notes; each lesson's fix is in `reviews/<fixer>.md`.

What was wrong everywhere:

- **The tests counted outcomes, not shapes.** Two planes circling apart
  passed "nobody's kill". Each lesson now has a shape test: the geometry of
  the manoeuvre (crossings, heading swings, where the shot comes from, who is
  behind whom, heights and speeds) from every start.
- **Which side he is on was measured against the banked wings** (`geometry`
  `side`): in a hard bank the wings' right points mostly down, so "is he on
  my right" came back as "is he below me", and reversals and break sides
  went wrong across the school. It is now judged on the horizon against the
  heading (`sideOf`), the wings answering only near the vertical.
- **Phases changed on timers**, so the captions and intent labels said
  "reversing onto his tail" while he sat on yours.
- **From above was a tilted perspective that followed the planes**, so a
  fight's shape never sat still, a steady turn drew as shrinking circles, and
  two paths that crossed at different times looked like a braid. It is now a
  flat map (orthographic) of the whole fight, framed between the meters and
  the captions and turned a quarter for a fight that runs along one line,
  and both paths carry a dot every 2 s with a faint rung between the two
  planes at the same moment. The stage is taller.
- **The wide camera looked at a vertical move end-on**, so a half loop read
  as a hook. It now opens side-on to the line the fight runs along, the fight
  reading left to right. A demo may carry its own `seconds`, so one that has
  shown its move ends instead of circling on.

**The flat scissors, rebuilt** (`PLANS.scissors`): it starts from the
overshoot (side by side on one heading, 120 m apart, the other pilot 8 m/s
faster); each pilot turns into the other across the fight's axis and
reverses when their paths cross, the heading 60 degrees either side of the
axis (a hard turn with the bank held at 72 degrees for the big changes: the
general aim rolled past the vertical and let the nose fall 20 degrees every
reversal); the nose lifts a few degrees when he sinks, but only with speed
to spend; the ace's throttle anticipates the brake's lag and holds about 40
m/s (the throttle is a rate: hold is 0, not a fraction); the shot only once
the other has drifted out ahead along the axis and the nose comes onto him.
From all nine starts (`test_the_flat_scissors_braids_along_one_line`,
`test_in_the_scissors_the_slower_pilot_gets_the_shot`): 7-8 crossings at a
steady 4.5-6 s, headings within 80 degrees of the axis, never more than
200 m apart, height held within 70-110 m over 45 s, nobody below 32 m/s, the
full-throttle pilot ahead at the end, and the ace with snap shots in every
start but one while the other never has one.

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
| `viewer/dogfight-pilot.js` | `geometry` (range, angle off the nose, aspect, closure, energy), `situation`, the moves (lead, pure and lag pursuit, `turnToward`, `wingover`, `climbAngle`) and the plans (`PLANS`): the aces' `boomAndZoom`, `upAndOver`, `breakTurn`, `scissors`, `turnarounds`, `hunter`, `ace`; the other seat's `unaware`, `chaser`, `cruiser`, `circler`, `meetTheDive`, `dontFollow`, `shallowFollow`, `patientAttacker`, `flatTurn`, `chopper`, `diveOut`, `climbStraight`, `climbBetween`, `arriveSlow`, `lagBack`; the defender `breaker`. A floor and ceiling guard over every plan; `reflex` breaks a plan into anyone on its tail; a green pilot (skill under 0.7) loses sight of a target that slips behind him |
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

The live fight stages over the firing line heading down range, inside the
range's 10 km combat area ("Room to fight").

## Checked

- `tests/test_dogfight_school.py`: 41 tests, about 45 s. The airframe's
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

  - The third round (2026-11-07): the freeze card on boom and zoom's first
    kill shot, the ace's gunsight ("ON TARGET · 202 M"), the guide on out of
    his lock ("Pull · nose up, Roll hard right, Full throttle"), the green
    line and rings from the cockpit at 60 frames a second with the lines
    flown four times a second, P holding both airframes still, and the gold
    ring tagged "YOUR SHOT · 2.4 S" on his tail with the instructor flying.

The show-me test found the two flights from one moment shared the ace's
memory and so differed run to run; each duel now copies it.

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
- **The guide follows one counter.** It is the lesson's counter pilot, so in
  the free fight against the ace it flies *You meet the dive* whatever he
  does. A guide that picks the counter to the ace's phase is the next step.
- **The instructor is weaker on a course in the page than in node.** It
  threads every ring of every course in node but 15 of 18 break turns and 6
  of 12 of the loop in the page. The control delay in the live page (the
  stick is worked out a frame before the tick that uses it) is the likely
  cause: the same follower made a fifth of a second late threads few rings in
  node. A follower that tolerates lag, so the guide suits a human's
  reactions, is the next step. The courses themselves are flyable by eye.
- **The lines fly the school's own airframe,** one built from the battle's
  fighters, with its engines run up to the throttle the pilot was holding,
  not the live hull's engine state.
