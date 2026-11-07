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
and the reconstructions should show the shots. All in: "The hunter", "When they
have the height", "Out of their lock", "The live fight's screen", "The firing"
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
  example *You meet the dive* and *The Dip: meet them, then run*), play, pause, 0.25x to 2x,
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

**Out of their lock: breaking the tail.** The hunter on your tail, 60 s (the first bench; the lesson as rebuilt on 2026-11-07 is below the table):

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

**When they have the height.** The boom-and-zoom ace starting 440 m above, 75 s:

| What you do | Nine starts | Your energy at the end against his |
|---|---|---|
| Climb straight for the height | shot down 9 of 9 | 170 m behind |
| Turn flat | 0.7 hits a fight | 280 m behind |
| Climb between his dives, break only when he commits inside 380 m | never hit | **300 m ahead** |

Climbing is right, but only while he is not coming at you; the break is what
makes his dive cost him, and the climb between dives is what takes the height
back.

## On their tail: staying there

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

The lesson (*On their tail: staying there*, nine starts): rushing in lands
about 5 hits a fight, all in the first 3 s of his break, and never kills.
The two chop demos (sitting close, lagging back) were retired on 2026-11-07:
under the eyes his chop never makes you fly past, and lagging out wide round
his circle was the lockstep turn the owner objected to. What replaced them is
the lesson's Dip, Flip and Ninja (below): climb beside his break rather than
follow him into it.

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
| When they have the height | 4.6-5.1 s | none |
| Out of their lock | 10.7-14.4 s | turning into him early: none; turn then chop: 4.5-8.5 s, all of it before you turn, while he holds his fire, never a hit |
| On their tail, rushing in vs arriving slow | you: 0.4-0.8 s | you: 11-25 s |

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
| Boom and zoom | *He bounces you* (retired from the tabs 2026-11-07; the tests still fly it) | 2 or 3 passes, each a 41-58 degree dive and a 0.6 s burst from inside 130 m, a zoom 245-268 m back above you; shot down at 33-48 s | `reviews/height.md` |
| | *You meet the dive* | 3 dives, each starting lower (400, about 250, about 160 m above you); each a head-on pass he breaks off at 350 m; no hits | |
| When they have the height | *You climb straight* / *You turn flat* / *You climb between their dives* | killed in one pass at 13.5-14.1 s / a flat turn held at 168-183 m, never hit / two dives broken into 2.9-3.8 s before his pass, 402-469 m climbed with him in sight, never more than 890 m apart | `reviews/height.md` |
| Up and over | *You follow them up* | he pulls to 78 degrees, you to 52-58; you hang 46-116 m under him at about 13 m/s; he seldom lands the shot coming down (0.7 hits a fight) | `reviews/vertical.md` |
| | *You follow shallow* | a 23 degree climb, nose under him; 184-273 m from him at his top, 16-18 m/s faster; the shot as he hangs in 6 of 9; hits 11 to you, 0.2 to him | |
| Out of their lock | *You fly straight* (retired from the tabs 2026-11-07; the tests still fly it) / *You dive away* / *You turn hard* / *You turn into them early* / *You turn, then chop* | shot down 9/9 / he sits 135-140 m behind all the way down, nose on you, and lands 7-20 / no hits either way, but he follows you round on your tail / his lock gone 2 s into the turn, a head-on pass 20-26 m apart, no hits / he flies past underneath 9/9 (5-14 m), runs, and is in front of you 13-14 s; you land 1-10, he lands none | `reviews/tail.md` |
| On their tail | *You rush in* / *You arrive slow* / *He chops, you sit close* / *He chops, you lag back* | he breaks at 298 m; you pass his tail 35 m behind and sit 50 m back with no lead / he really breaks; you go up over his turn, nobody hit / you fly past underneath 9/9 and run, he lands 2-7 / you stay 266-283 m out, he rolls out and you shoot him down from astern 7/9 | `reviews/break.md`, `reviews/tail.md` |
| The break turn | *He flies straight* (retired from the tabs 2026-11-07; the tests still fly it) / *They break* / *You stay patient* | shot down 9/9 / breaks at 298 m into him, he passes your tail 33-36 m behind, you reverse within 2 s; he stays 50 m back with no lead / a high yo-yo 0.8 s after the break, 70 m above, never inside 83 m, no hits | `reviews/break.md` |
| The flat scissors | *Scissoring* | a braid along one line, a crossing every 4.5-6 s, flat, never more than 200 m apart; the full-throttle pilot drifts ahead and the slower ace gets snap shots | above |
| The Immelmann and the split-S | *You follow them up* / *You meet them at the top* / *You let them go* / *You dive on him* | a half loop in its plane, 172 degrees round, 107 m up, 37 m/s on top; you hang under it / 261-279 m off at his top, nose on it, fire in 7 of 9 / a split-S: 180 degrees, 145 m down, 51 to 69 m/s / dive on him as he rolls over, fire in 9 of 9 | `reviews/loop.md` |
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

## Can you survive it? The Dip, the Flip and the Ninja (2026-11-07)

The owner, after watching the break turn circle on for 40 s: "Are you
proposing the only way out of the fight is to wait infinite time?" Every
lesson answers three questions for the pilot in trouble (the other seat, so
Fly it yourself puts the player there):

- **The Dip**: how do you leave the fight and fly away?
- **The Flip**: how do you go from the chased to the chaser, and stay there?
- **The Ninja**: how do you get the upper hand (come up with the shot) and
  stay there, without ever giving him a chance?

The Ninja was first scored as "he never gets a shot", and the owner watched
the result in On their tail: the enemy breaks, our pilot turns with him in
lockstep and lets him round onto his six. "Like no one would do that, it's
utterly pointless and gives the enemy the kill. ... I'm looking to watch
dogfighting and see how to get ascendancy (meaning coming up with a shot) and
how to stay there." Everything below is the second round, built to that.

### How a move is scored

`tests/dogfight_dfn_measure.mjs`, the same for every lesson:

- **Dip**: from the move on no round of his strikes you, and at the end you
  are over 900 m apart and still opening, above 30 m/s.
- **Flip**: within 20 s you sit in his rear quarter (inside 60 degrees of his
  tail, nose within 30 degrees of him, inside 350 m, at 35 m/s or more) for
  2 s with 0.5 s of landing shot (or you shoot him down); his guns have a
  landing shot for 0.2 s at most. Then you stay there: he is never on your
  six for a second, and you are never 20 s near him without another burst.
- **Ninja**: two attacks or more (an attack is a burst of 0.3 s of landing
  shot, more than 3 s after the last), 0.5 s of landing shot and a round on
  him in all, or you shoot him down. His guns never have a landing shot for
  more than 0.2 s and no round of his strikes you; he is never on your six
  for a second (within 60 degrees of your tail, his nose on you, inside
  400 m). From your first burst you hold the energy or sit behind him 60% of
  the time, and once you have the advantage (a burst, or a 50 m energy lead
  inside 600 m) you are never 20 s inside 600 m of him without a burst:
  circling with him out of each other's reach is a stalemate, not the upper
  hand.
- **Flip and Ninja**: never more than 3 s under 35 m/s inside 300 m of him.
  Hanging at 8 m/s in front of his nose is a fall, not a manoeuvre.
- **All**: never closer than 15 m, nobody flies into the ground; a fight is
  measured up to the kill (flying past the wreck is not a pass).
- **The nine starts** (`STARTS`, `nudge`) are an L9 orthogonal array over four
  nudges to the moving pilot's start: sideways and along (30 m), height
  (10 m) and speed (3 m/s), every pair of levels flown once. The first is the
  start itself, the one the theatre plays. Until 2026-11-07 the nine were
  sideways by speed only, so in a symmetric fight the two sideways starts
  were mirror images and height and range, which decide most bounces, never
  moved; On their tail's Ninja went from 7 to 2 and Turnarounds' from 9 to 3
  when they did.
- 7 or more of the nine **works**, 3 to 6 **partly**, fewer **no**. A lesson
  is survivable when any move works. `tests/test_dogfight_dfn_<lesson>.py`
  holds every demo's stated count to the measured one exactly.

Every rule after the first round came from an adversarial review of a lesson
(`reviews/dfn-<lesson>.md`, "Ascendancy" and "After the review"): snaps of two
ticks reset the clock and counted as attacks; zoom tops hung at 8 m/s; a kill
counted as a failure; a demo's 9 of 9 rested on one start.

### Every pilot sees only what a pilot could (2026-11-07)

The owner's choice, once a shared energy fighter (`PLANS.ascend`,
`reviews/ascend.md`) had shown that against an ace who sees everything an
equal Spitfire gets one or two passes and then the fight is even. Every pilot,
aces and the other seat alike, perceives the other plane through `perceive()`
in `dogfight-pilot.js` (`EYES`; every number and its source in
`reviews/eyes.md`): a 20 degree cone astern and the sky more than 10 degrees
under the wings are hidden; the front is watched all the time, behind only in
1 s glances every 2.5 s, and not at all above 4 g; a new contact is noticed
after 0.8 s; unseen, he flies on the last known position for 4 s, then knows
he has lost him and makes a clearing turn. Nobody fires at or breaks from
what he has not seen. Each track sample records `sees`, and the theatre's
meter for a pilot who has lost the other reads **LOST SIGHT OF HIM**.

The eyes changed the staging of several lessons (Out of their lock's hunter now
comes from your right rear quarter, where you can see him; dead astern the
headrest hides him) and made the chop fail: it needs a fast closer from dead
astern, exactly where you cannot see him.

### What the nine lessons show

| Lesson | Survive? | Dip | Flip | Ninja |
|---|---|---|---|---|
| Boom and zoom | yes | 9: meet his first dive, then run level | 0 | 0: one pass from above once his height is spent; he meets it |
| When they have the height | yes | 9: break his dive and his chase, run once his nose is off you | 6: break his chase, reverse onto him | 1: the height comes back in all nine, the kill in one |
| Up and over | yes | 7: climb past him over the top, run | 0: once you followed him up | 6: shoot at his top, under his tail unseen, leave when he turns in |
| Out of their lock | yes | 9: turn in, under him, run | 1 | 0: one pass across his beam, then his nose follows you |
| On their tail | partly | 6: leave his circle when he is across it going away | 0 | 3: climb beside his break, one pass from above |
| The break turn | yes | 9: turn in at once, zoom once he is past, leave from the top | 0 | 0: over the top his nose never leaves you |
| The flat scissors | partly | 6: out at the second crossing | 0 | 0: against a man who climbs with you |
| Immelmann and split-S | yes | 9: turn back under his loop and run | 0 | 6: one dive as his nose goes down through his split-S |
| Breaking the circle | yes | 7: roll out while they are across the circle | 0, three tries: the chop, reversing, nose low | 0, two tries: straight up, out and back |

What the fights say about BF1942's air war, between two equal Spitfires and
two pilots who see what a pilot sees:

- **You can almost always leave; you can rarely stay on top.** Equal Spitfires
  have the same top speed (74-76 m/s level), so a stern chase holds its range:
  you get away because he gives up (every ace gives up a chase he cannot
  win: past his guns' reach plus 30 m and not closing for 6 s).
- **The upper hand is the first pass, and it is spent by the pass.** A pass
  costs about 120 m of energy height; straight flight wins it back in about
  8 s, but an ace who sees you climb back turns onto you inside 5. Where the
  Ninja works it works by killing on the first dive (Turnarounds, Up and over
  in one, On their tail) or by leaving before he turns in (Up and over). The
  shared energy fighter's bench says the same: 39 of 180 work, every one a
  kill (`tests/test_dogfight_ascend.py`).
- **What the eyes give you is a bounce he never saw.** Under his tail, or
  from high behind while he pulls over 4 g, you close unseen; once he has
  seen you, you are an equal again.
- **A "no" is shown as the try and why it fails, then the Dip.** No demo
  circles with him: a Ninja that cannot hold the upper hand makes its pass
  and leaves, and a Flip that fails stops where it fails (`endAt`).

### Demos that open late or stop early

A demo may open where its move starts to matter (`startAt`, seconds) and stop
where it has played out (`endAt`), while it is flown and scored over its full
`seconds`; the scrub bar still reaches back to 0, and a kill after `endAt`
is not shown. The height lesson's Ninja opens at 26 s; the Flips of On his
tail, Up and over and Turnarounds stop at 23-27 s, before the circle that
follows.

### Fly a move yourself

On a move's tab the button reads **Practise the extension** (the reversal,
the bounce; until 2026-11-07 "Fly the Dip yourself"): you fly that move as it was measured (`flightOf` in
`dogfight-lessons.js`): its own staging, against the ace it was flown
against, with its plan as the guide's green rings and the instructor (I).
The coach puts the move's name first, with what its pilot is doing in your
seat now; only the ground and a stall come before it, since a bandit on your
tail is what the move is for. The live fight says when you have done it, as
the measure scores it: **CLEAR · THE EXTENSION WORKED** past 900 m and opening with
no hit taken, **REVERSED · YOU ARE THE HUNTER NOW** after 2 s on their tail.
`?dogfight=<lesson>&move=<dip|flip|ninja>` opens straight into one.

Any other tab flies the lesson's start against `flyAce`, the lesson's ace
with the give-up rule (all but the break turn, whose moves swap who attacks),
the guide flying the lesson's counter or, without one, its best move.
`tests/test_dogfight_fly_moves.py` holds the practice to the measured demo.

Open: a few lessons keep an older counter demo that a move now repeats
(boom and zoom's `counter` is its Dip's way in), because the older shape tests
read them.

### Move cards (2026-11-07)

The owner, reviewing the school: the lessons tab is great, but what are the
Dip, the Flip and the Ninja? They were the school's own words, and the screen
defined them only by how they are scored, in the notes. A pilot's names for
them, which the recorded fights' manoeuvre tags already use:

| The school's | A pilot's | What it is for |
|---|---|---|
| the Dip | **Extension** | Leave the fight: out of their reach at full speed, until they give up |
| the Flip | **Reversal** | Turn the tables: make the chaser fly past, then get onto their tail |
| the Ninja | **Bounce** | Take the upper hand: attack from above or unseen, then away before they answer |

`viewer/dogfight-steps.js` holds the names (`MOVE_INFO`) and every move
demo's steps (`STEPS`, 30 demos, 2 to 5 steps each). What changed on screen:

- **The tabs** carry the pilot's name with the nickname under it
  (EXTENSION *the Dip* 9/9), the lesson's own fights first, then its moves,
  the one that works most often first. The best answer (`bestMove`: the
  highest score of 3 of 9 or more) has its badge filled; a move that rarely
  works is dimmed. The tooltip says what the move is for.
- **The move card** (right of the picture, where the score card was): the
  move's name, what it is for, its steps numbered, and the verdict ("Works
  here · 9/9", or "Doesn't work here: watch why" with one line on what goes
  wrong). A step is a button that plays from a second before it. The card
  replaced a 90-word paragraph of test results on the title card; those
  numbers are in the notes, under the practise line.
- **The steps are pinned to the flight.** Each step names a phase of the
  seat's plan (`dogfight-pilot.js`), and `stepTimes` finds the first tick of
  the flown fight in that phase, from the demo's `startAt` and after the step
  before it. The step's numbered pin sits on the YOU path at that point, the
  one under way lit and pulsing, the ones to come dimmed, and the timeline
  carries the same numbers. Re-tuning a plan cannot leave a card pointing at
  nothing: `tests/test_dogfight_steps.py` flies every move demo and fails if a
  step's phase never comes, comes out of order, or comes after the part shown.
  Steps say they, never he.
- **The bar** no longer scrolls the tabs half out of sight under a fade when
  the notes are open or the window is narrow: they take a row of their own
  under play and the tools (`fitDemos`, `.is-stacked`).
- The live fight's banners and coach use the same names (CLEAR · THE
  EXTENSION WORKED, REVERSED · YOU ARE THE HUNTER NOW, the HUD's "EXTENSION:
  MEET THEM, THEN RUN"; `moveLabel`).

Checked in the browser pane at 1440 x 900: boom and zoom's tabs read
EXTENSION 9/9 (filled), REVERSAL 0/9, BOUNCE 0/9; the Extension card's three
steps at 0, 2.1 and 6 s with pins on the path tracking the clock; Out of their
lock's Reversal reads "Doesn't work here: watch why · 1/9" with its why; a
recorded fight shows no card and no pins.

## The briefing (2026-11-07)

The owner: the Range's dogfight should not open on the battle's own loading
screen, which has room for a map, a bar and a line; make a page in the
site's style, with the loading glyphs, that explains what you are about to be
dropped into.

A way into the school (`play/boot-loader/school-entry.js` `schoolEntry`: the
Range with `school`, `arena=dogfight`, `dogfight=<lesson>` with or without
`move`, or `course`) now loads like this:

1. **The boot shade** plays the dogfight scene (below) with "Loading the
   dogfight school" (`bootScene`, `bootWords` in `play/boot-loader/entry.js`).
2. **The briefing** (`viewer/dogfight-briefing.js`) goes up as map.html
   starts, over everything, and the same scene plays on in it. In the site's
   tokens: the kicker, a title and one line for the entry; WHAT HAPPENS NEXT
   (four numbered lines: what the Range is, how you start, who tells you what
   to do, what comes after); a second column (the three ways out for the
   school, the move's steps and where it goes wrong for a move, the counter
   for a lesson); and THE KEYS, flying keys then the school's own. A footer
   bar mirrors the load (`overlay.watch` in `progress.js`, new: the bar's
   fraction and the overlay's state).
3. **Ready** lights the button (Into the school, Practise the extension, Take
   off; Enter). Nothing starts until it is pressed: the range's frame waits on
   `page.schoolHeld()` before seating anyone in a lesson or course or opening
   the school, so a pilot reading the keys is not flying into the sea.
   Closing it also accepts the battle's own briefing screen if the range
   parked on it. A failed load closes it, so the overlay's error shows.

What it says for each entry is `briefingFor(entry)`, pure;
`tests/test_dogfight_briefing.py` holds which addresses get it, its words for
each kind (every move's steps, they not he) and the wiring.

Also fixed on the way: the range's readout and hit log drew over the battle's
loading picture once the world reported ready, before the screen went
(`covered()` now counts `overlay.loadingCaptures()`), on every Range load.

**The dogfight scene** (`play/loaders/dogfight.js`, in the rotation with the
other five): vanilla's Spitfire on a BF109's tail, both drawn from the game's
models (`render-loader-sprites.sh`, "the dogfight"; gear and static props left
out, the props drawn as discs). The tactic: hold fire while the target
jinks, fire when it steadies, leading its nose. The 109 jinks between three
lines; the Spitfire follows late; a snap burst fired mid-jink is aimed where
it was and passes behind its tail, a steady one can land (`missBy`,
`HIT_BAND`). Three hits and it smokes, six and it rolls over and goes down.
The thing that accumulates: a kill mark (the 109's silhouette) painted on the
row under the Spitfire per kill; eight and the row is painted over. Stepped
beat by beat in `loaders.html?scene=dogfight&step` over 120 s of clock: a
kill every 5 to 8 s, the row filled and painted over twice, the stage steady
at 21 elements. The models came from mesh.bfstats.io's store (this Mac has no
extracted trees) and the sprite script needed Pillow (`pip install --user`).

## Breaking the circle (2026-11-08)

The owner: two equal fighters stuck turning round each other in a tight
circle, neither getting a shot; show ideas for breaking it, each flown, so
the pilot learns what works and what does not, a failure shown failing and
why. The lesson is *Breaking the circle* (`the-circle` in
`viewer/dogfight-lessons.js`): the deadlock as its first tab, then six tries
out of it, each scored over the nine starts like any Dip, Flip or Ninja.

### What the real world says

- **The Lufbery** (the First World War's defensive circle, named for Raoul
  Lufbery): fighters chasing each other's tails round one circle, each
  covering the one ahead. Leaving it safely meant going while nobody was
  placed to follow.
- **Rate and radius** (Robert Shaw, *Fighter Combat: Tactics and
  Maneuvering*, 1985): two fighters turning the same way round, seen from
  above, fly two circles (or, as here, one, half a turn apart), and the
  faster turn rate wins; turning opposite ways round puts them on one circle
  meeting head-on, and the smaller radius wins. A real fighter trades one for the other with speed: slow
  for radius, the corner speed for rate. Between equals flown equally,
  neither wins.
- **Using the vertical:** the high yo-yo or a zoom trades speed for height
  and comes down on him; the nose-low (oblique) turn lets gravity add to
  the turn rate; the low yo-yo cuts across the circle below him and pulls up
  into him.
- **Forcing an overshoot:** the throttle chop, the flat scissors, only work
  on an attacker closing from behind.
- **Extend and re-engage, or leave:** out at full speed, and back with the
  height, or not at all.

### On BF1942's flight law

A faster Spitfire turns faster at the same radius and nothing limits the
pull ("What the airframe does"), so the real world's trade does not exist:
slower is not tighter, only slower. The circle is staged as the deadlock it
is: both Spitfires at 46 m/s, wings level, placed where a hard right turn
settles onto one circle 61 m in radius (a Spitfire turning right from 46 m/s
settles 73 m right of where it rolled in and 50 m ahead of it), half a turn
apart. Flown 30 s from the nine starts, they circle 52 to 218 m apart and
nobody has a shot that would land. The ace is the school's hunter with the
give-up rule (`btHunter`, also *FLY IT*'s): round the circle after you,
following a climb shallow, chasing anyone who runs, giving up a chase it
cannot close. Every try flies 8 s of the circle first (`CI.after`), so the
deadlock is on screen before the move.

| Try (tab) | Plan | Kind | Nine starts | What the fights showed |
|---|---|---|---|---|
| You turn with them | `ciCircle` | | | the deadlock: 52 to 218 m apart for 30 s, no shot, nobody gains |
| leave | `ciDip` | Extension | **7** | roll out on the tangent while they are across the circle: they chase 160 to 235 m back, out of their reach, and give up 16 to 24 s later; 1.1 to 2 km clear at 40 s. From 30 m to your right they never give up (274 to 291 m behind, holding their fire) |
| go vertical | `ciZoom` | Bounce | 0 | you top out 38 to 48 m over them at 30 m/s; they follow shallow at 41 to 43 m/s onto your tail, so there is no dive, and from 16.5 s it is the circle again; hit in two (6, 8 rounds) |
| out and back | `ciBack` | Bounce | 0 | out as the extension, back after 22 s to come under their tail: in five they had let you go and turn to meet you (38 to 52 s), in three they never stopped chasing; six passes inside 2 to 24 m, one round lands on a head-on snap |
| throttle chop | `ciChop` | Reversal | 0 | down to 27-28 m/s, 50 to 70 m under them and 42 to 94 m of energy behind; nobody to fly past you, nobody shoots |
| reverse | `ciReverse` | Reversal | 0 | five head-on passes 15 to 21 m apart at about 22 s, never your shot; in the other four the circle turns the other way |
| nose low | `ciLow` | Reversal | 0 | the closest to working: gravity's speed turns you faster and you come round 95 to 135 degrees behind their heading 17 to 24 s in, but 70 to 131 m under them; the climb back costs the speed (down to 28-38 m/s) before the nose gets there. One burst in nine lands, 7 rounds; in five they see you coming up and break |

What it says: **between equals, leave the circle; do not try to win it.**
Every way of buying an advantage in it costs energy that an ace who sees you
spend it does not spend (he follows the zoom shallow, does not follow the
chop down, and turns to meet you coming back). The nose-low turn is the one
idea the engine rewards (the angle really is gained, and under his wing he
cannot see you), and the one worth a human trying with the mouse: a pilot
who pulls up earlier, closer under him, might land what the bot does not.

### What changed for it

- **Several tries of one kind.** A tab used to say only the kind's nickname
  (EXTENSION *the Dip*); a demo's `tab` now names the try in its place
  (REVERSAL *throttle chop*), and the briefing finds a practised move by its
  demo's id rather than taking the id for its kind (`briefingFor`). The
  demo ids are what they try (`zoom`, `back`, `chop`, `reverse`, `low`).
- **Steps** for all six in `STEPS` (`the-circle/<try>`), each anchored to
  the seat's phases; a failed try's `why` is its one line.
- **Tests:** `tests/test_dogfight_dfn_ci.py` flies the circle and every try
  from the nine starts and holds each declared score to the measured one,
  and each failure to its shape (the zoom's top and his follow, the chop's
  speed and sink, the reversal's head-on passes, the nose-low turn's angle
  and height, coming back meeting him). The move-demo count is 30 in
  `test_dogfight_steps.py` and `test_dogfight_briefing.py`;
  `test_dogfight_fly_moves.py` lets a lesson hold several tries of a kind.

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
  planes at the same moment. The stage is taller. Framing the whole fight
  drew a 45 s chase's circle a few pixels wide behind its run-in, so the
  map now frames only the last 12 s of the fight (the first 12 at the
  start, `TOP_WINDOW`), eased along as the fight plays and snapped on a
  seek; its quarter turn is still the whole fight's, so it never flips.
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

## The school's own page, and its arenas (2026-11-07)

The school came the wrong way round: pick a battle on THE RANGE, load it, then
open the school over it. The owner: you enter the dogfight school, and fly
from there. So it has a page of its own, and the flying an arena of its own.

- **`dogfight.html`** opens on the school, no level loaded (0.2 s on the local
  server). Its sidebar picks an **ARENA** above YOUR PLANE. Each arena is a
  battle with fighters on both sides, from the model catalogue's `sides` and
  `levels` (`dogfight-arena.js` `arenasFrom`), one per pair of fighter sets:
  Spitfire v Bf 109 (Battle of Britain), Yak 9 v Bf 109 (Kursk), Mustang v
  Bf 109 (Market Garden), Corsair v Zero (Midway), Spitfire and Mustang v
  Bf 109 (Coral Sea). Its planes are the battle's aircraft, bombers too; a
  plane both sides fly (the B-17) is neither's.
- The page loads the planes' models itself (`plane-models.js`, the replay's
  lookup, shared with the Range's school for recorded types): the lessons
  are flown on the arena's best fighter, as the Range flies them, and drawn
  as your plane and the ace's (the other side's best fighter).
- **FLY IT**, a Dip, Flip or Ninja's practice, and a ring course go to the
  arena: the Range's construct over that battle with `arena=dogfight`
  (`arenaUrl`): only the battle's aircraft loaded (`provingGroundEntry`
  `only: 'air'`), no readout, hit log, kit bench, targets or boards, no
  briefing and no spawn screen, your side by your plane's, the ace in the
  air, the lesson started. On the local server it is in the fight 4.4 s
  after the page loads (Kursk, headless).
- In the arena: **Q** (Shift+Q back) changes plane and flies the lesson again
  in it; the lesson's own keys stay (Y again, P pause, G guide, I
  instructor, V the school, O stop). A bar over the lesson's key row says
  the battle, your plane and the lesson.
- Esc on the school's own page goes back to the front end's Range tab, and
  THE RANGE's DOGFIGHT SCHOOL button opens this page (its battle as the
  arena when it is one), no map step.
- Fixed on the way: a plane you sit in leaves the airfield's parked rows,
  so your plane list, its name and Q's "current" fell back to the next
  fighter (the Range's school had it too). `airfieldNodes` counts the seat.
- Tests: `test_dogfight_arena.py` (the arena list, your plane, the ace, the
  address).
- **Open.** The front end's SINGLEPLAY row has two spare slots (a demo
  build's) where DOGFIGHT SCHOOL belongs, but `singleplayerNav` is not in
  the published menu pack yet (`extract_main_menu_layout.py`, optional
  pages): it needs that extraction and a publish. A dedicated arena map,
  rather than the Range's white floor, is the owner's "potentially".

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
