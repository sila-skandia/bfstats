# Tank school: the first use cases

The owner's second round (2026-11-09), after reading the research:

- **Firing while moving.** How to see what the hull's speed does to the shell,
  and show the lead.
- **Shell drop.** It may differ by tank. How do you work out the drop?
- **The range.** Not yet. It exists, and tailoring it for tanks can wait.
- **Pick two tanks.** The school lets you choose your tank and theirs, then
  shows each one's hit regions against the other's gun and compares how they
  drive. "The Tiger is hard to use because it wobbles around and has less tank
  shell range." The owner's pick for the first use case.

Below are the numbers each idea rests on, what was measured for this note, and
a sketch of each. The engine facts come from [tanks-engine.md](tanks-engine.md).
The new measurements (the wobble, the moving-fire table, the shots-to-kill rose)
were made with scratch scripts, described under "How the numbers were made".

## 1. Pick two tanks: the matchup

### What the owner's two hunches turned out to be

**"The Tiger wobbles."** True, and by far the most of any tank. The page's
drive is the server's per-tick law, matched to the lab within half a millimetre
for the Sherman (TANK-18..TANK-25, [tank-ground-law](../tank-ground-law/README.md)).

- Brought to a hard stop from top speed, a Tiger pitches its nose down
  **20 degrees**. It rocks through five swings for **7 seconds**.
- It then goes to sleep **1.5 degrees** off level. That is 5 m of aim error at
  200 m until the hull next moves.
- A Sherman peaks at 5.6 degrees and is still in 5.3 s. A T-34 peaks at 1.5
  degrees and is still in 2 s.

**"The Tiger has less shell range."** Not against the Sherman. Its shell is
the Sherman's: 100 m/s under full gravity. It is out-ranged by the
**Panzer IV**, whose shell falls under half gravity and reaches twice as far
(903 m against 454 m on flat ground at full elevation). The Chi-ha falls under
half gravity too. The Tiger's real handicaps at range are the wobble above, a
turret that turns at 20 deg/s (the Sherman's turns at 35), the lowest eye of
any tank (0.97 m above its origin), and a 4 s reload against the Sherman's
2.87 s.

### The steadiness of each hull (measured)

Flat ground, the page's tracked drive. *Peak* is the largest swing from the
resting attitude. *Still* is when the hull stops rocking: no pitch or roll
moving faster than 0.5 deg/s. *Left* is where it comes to rest against its
resting attitude.

| Tank | Recoil (`fireingForce`) | Hard stop from top speed: peak, still, left | Let go at top speed | Fired straight ahead: pitch peak, still | Fired broadside: roll peak, still |
|---|---|---|---|---|---|
| Tiger | 90 | **20.1 deg, 7.1 s, 1.5 deg nose down** | 7.8 deg, 7.1 s | 6.9 deg, 3.5 s, left **1.25 deg** off | 4.0 deg, 1.7 s |
| Chi-ha | 60 | 11.1 deg, 6.3 s, 0.5 deg | 6.2 deg, 7.2 s | 4.9 deg, 3.5 s | 6.9 deg, 2.7 s |
| M10 | 90 | 5.8 deg, 5.5 s | 2.6 deg, 5.8 s | 5.7 deg, 3.6 s | 11.8 deg, 3.7 s |
| Sherman | **110** | 5.6 deg, 5.3 s | 2.9 deg, 4.9 s | 6.0 deg, 4.0 s | **13.4 deg**, 2.7 s |
| Panzer IV | 70 | 3.5 deg, 4.1 s | 1.9 deg, 3.9 s | 3.5 deg, 3.5 s | 5.7 deg, 1.7 s |
| T-34 | 100 | 1.5 deg, 2.0 s | 1.0 deg, 2.6 s | 2.7 deg, 2.0 s | 5.7 deg, 1.6 s |
| T-34-85 | 90 | 1.5 deg, 2.2 s | 1.1 deg, 2.6 s | 2.5 deg, 2.0 s | 5.2 deg, 1.5 s |

What it means for a crew:

- **One degree of hull pitch is 3.5 m at 200 m.** A tank's hull is 2 to 2.5 m
  tall. A Tiger that fires within 7 s of a hard stop puts its gun through a
  20-degree swing. A T-34 is steady in 2 s.
- **The Tiger's first shot after stopping is its worst shot.** It ends 1.5
  degrees off and stays there, so the crew must re-lay after every stop.
  Coast to a stop rather than brake: the peak drops from 20 degrees to 8.
- **The Sherman shoves itself hardest.** At 110 its recoil is the largest of
  any vanilla gun (FA-19, [gun-hull-recoil](../gun-hull-recoil/README.md)). A
  broadside shot rolls it 13 degrees. The Tiger, heavier on the same law,
  rolls 4.
- **Turning and pulling away rock the hull too.** At full lock from speed a
  Chi-ha rolls 3.9 degrees and a Tiger pitches 4.1. A Tiger's pull-away
  squats the nose 5.5 degrees.
- **The resting tilt is the engine's sleep, inferred.** A hull whose motion
  falls under the sleep threshold freezes where it is
  (`TrackedVehicle.law.sleepiness`, TANK-21). Whether the retail server
  leaves a Tiger 1.5 degrees off is not lab-checked. Only the Sherman's and
  the M3A1's drives are.

### Hit regions against the chosen gun

The model browser's armour inspector already does the arithmetic: it paints
a hull by what one weapon does to each face, with hit points, shots to
destroy and shots to critical
([bf1942-3d-models](../bf1942-3d-models/README.md), "Collision and armour
inspection"). The tank school's page borrows that arithmetic and painting,
not the inspector itself (see [README.md](README.md), "The tank school's own
page"), and shows the picture in both directions:

- **Their tank, painted by your gun:** where to aim.
- **Your tank, painted by their gun:** what to keep away from them.

The pairing changes the picture, not just the numbers:

- The Tiger's rear is side armour (51). Against a Tiger, "go round the back"
  buys almost nothing over the side.
- Every tank but the Tiger, T-34 and M10 has a rear plate (50) that a square
  hit from any tank gun, or a bazooka, kills in one shot.
- Small weak spots exist. The Sherman's bow Browning is material 50, about 1%
  of its front. A Tiger shell that finds it kills a Sherman from the front in
  one hit.

**Shots to kill, by bearing.** The mean over the silhouette and the best
single spot, from a raycast of the hull's collision faces on a 12 cm grid, each
ray priced with its face's material and the engine's angle factor. 0 degrees
is head-on; 180 is from behind.

| | 0 | 30 | 45 | 60 | 90 | 135 | 180 |
|---|---|---|---|---|---|---|---|
| Tiger shooting a Sherman: average (best spot) | 3 (1) | 3 (1) | 2 (1) | 2 (1) | 2 (1) | 2 (1) | 2 (1) |
| Sherman shooting a Tiger | **9** (3) | 7 (3) | 6 (3) | 5 (3) | 4 (3) | 4 (3) | 4 (3) |
| Panzer IV shooting a Sherman | 3 (1) | 3 (2) | 3 (2) | 3 (2) | 3 (1) | 2 (2) | 2 (1) |
| Sherman shooting a Panzer IV | 3 (1) | 3 (2) | 3 (2) | 3 (2) | 3 (1) | 2 (2) | 2 (1) |
| Panzer IV shooting a T-34 | 7 (2) | 6 (3) | 5 (3) | 4 (2) | 3 (2) | 3 (3) | 3 (2) |
| T-34 shooting a Panzer IV | 3 (1) | 2 (1) | 2 (1) | 2 (1) | 2 (1) | 2 (1) | **1** (1) |

Drawn as two polar "roses", one per tank, it reads at a glance: the Sherman
against a Tiger is a small tank in front of a big gun from every side, and
must not fight it head-on. The Sherman against a Panzer IV is a mirror.

### Lesson from the model browser: no verdict

The model browser once had a Compare panel. It parked a ghosted opponent and
scored a head-on duel between the two hulls. It was removed: "reading a
who-wins verdict off a shots-to-kill scoreboard turned out to be an
unintuitive way to ask the question" (bf1942-3d-models README). The matchup
should not repeat it. It says what to *do* in this pairing, not who wins.

### The matchup card, sketched

The first screen of the tank school's own page. Pick YOUR TANK and THEIR
TANK in its sidebar (the arena's two sides by default, any pair allowed).
Then four panels, each with one line of plain words at the top, written from
the numbers:

1. **Where to aim, where you are exposed.** The two painted hulls side by side,
   orbiting together, the camera at the same bearing on both. A bearing ring
   under each, and the rose. A "from above" toggle shows the roofs: from 20
   degrees above, a Panzer IV's front is 27% rear-grade roof, against 3% level.
   - *Sherman against Tiger:* "Its front costs you 9 shots, its side and rear
     4. Your front costs it 3; your bow gun is a one-shot spot. Do not trade
     from the front."
2. **The guns, side by side.** Both shells' arcs drawn to the same target from
   the side, with half-second ticks (section 3 below). Reload, traverse,
   elevation, and reach on flat ground.
   - *Sherman against Panzer IV:* "Its shell falls half as far as yours: past
     200 m it can hit you when you cannot hit it."
3. **The drive.** Top speed, reverse, a 90-degree turn from rest and on the
   move, 5 m forward and back (the peek's cost), from `tanks-engine.md`
   section 3.
4. **The steadiness.** Each hull drawn side-on, rocking through its measured
   hard stop and its shot, from the trace. The time until it is still is the
   time until its gun is a gun again.
   - *Tiger:* "After a hard stop your gun swings 20 degrees for 7 s and ends
     1.5 degrees low. Coast to a stop, and re-lay before you fire."

Then **DRIVE IT**: the two tanks in the arena, a bot in theirs, where the lessons start (Turn to face, Peek on the reload, Circle the
Tiger, in [tanks-tactics.md](tanks-tactics.md) section 6).

**What it needs.**

- The damage arithmetic (`viewer/armour-damage.js`, as it is) and the hull
  painting, lifted out of `viewer/model-armour.js` into a module both the
  model browser and the school use, taking an attacker tank rather than one
  weapon.
- `damage.json`, and the glbs the browser already loads.
- A per-tank sheet of the drive and steadiness numbers, made by a node survey
  beside `surveys/census_ground_drive.mjs` and written as JSON, so the card
  reads numbers rather than running a drive.
- The rocking traces in that sheet too, about 30 samples a second for 8 s per
  scenario.
- The rose, from the same raycast run once per pair. Seven tanks make 42
  pairs, at seven bearings and two heights each. Cheap enough to precompute.
- Mods later. Kasserine Pass's own guns fire at 300, 375 and 500 m/s, so a
  pairing belongs to a level as much as to two templates.

## 2. Firing on the move: the lead

### What the engine does

The shell leaves at the gun's muzzle speed down the bore, **plus the firing
hull's whole velocity**, plus 0.98 m/s of lift (FA-23, IMP-8). No vanilla tank
gun authors any spread, so the hull's motion is the only thing that moves a
human's shell off the bore, besides the hull rocking (section 1).

Two consequences, worked through the engine's own flight law (no drag,
14.73 m/s² times the round's `gravityModifier`, the first tick without
gravity, four sub-steps a tick):

**Broadside on the move, the shell drifts the way you are driving.** The
drift is your speed times the time of flight. As an angle it is the same at
every range: `atan(your speed / muzzle speed)`.

| Hull speed | Off line at 100 m | at 200 m | at 300 m | Aim back by |
|---|---|---|---|---|
| 5 m/s | 5 m | 10 m | 15 m | 2.9 deg |
| 10 m/s | 10 m | 20 m | 30 m | 5.7 deg |
| 14.7 m/s (a Sherman's top speed) | 15 m | 29 m | 44 m | 8.4 deg |

The Chi-ha's slower shell (80 m/s) needs more: 3.6, 7.1 and 10.4 degrees.

**Driving at the target, the shell flies flatter.** At full speed toward a
target 200 m off, a Sherman's shell falls 19.9 m instead of 26.6: aim lower.
Reversing away, it falls further.

**Lead and your own motion are one rule.** What the shell needs is the
target's motion *relative to yours*. Aim off by `atan(their crossing speed −
your crossing speed, over 100)`. Two tanks driving side by side at the same
speed need no lead at all. A target crossing at 13 m/s (a Tiger's top speed)
while you sit still needs 7.4 degrees.

**So the rule a coach can say is: lead is an angle, drop is a distance.** The
angle off for speed does not change with range. The drop does, and grows
with its square.

### How to show it

- **The vector, in the theatre.** From above, at the moment of firing, three
  arrows at the muzzle: the gun's 100 m/s down the bore, the hull's velocity,
  and their sum, the shell's real path. Then the shell flies, and its track
  bends away from the bore line. This is the picture the owner is asking for:
  the effect of speed on the shell, drawn as an addition.
- **Two ghost arcs, live.** While the player drives, two thin arcs from the
  muzzle: grey where the shell would go if the tank were still, green where it
  goes now. The gap between their ends is the drift. Stop the tank and the two
  arcs merge. This is the dogfight school's "lines", for a shell.
- **The ring and the dot.** The dogfight school's gunsight camera already
  draws a ring where the guns point and a dot where they need to point (the
  lead), with "the dot in the ring is the shot". For a tank the dot carries
  three corrections at once: the drop for the range, the target's motion, and
  your own motion. A breakdown under it names each one's share ("drop 7.7 deg
  up, their speed 4 deg right, yours 5.7 deg left").
- **The rocking.** While the hull is still swinging (section 1), the ring
  sways with it. The coach says "steady" when it settles.

### Lessons

1. **Your shell takes your speed.** Drive a lane past a still target at 100
   and 200 m at three speeds. The arcs show the drift; the player learns to
   aim back by the angle, then learns that stopping is simpler.
2. **Shooting a crossing tank.** Sit still; a bot crosses at 5, 10 and 13
   m/s. Lead by the angle.
3. **Both moving.** A bot drives a parallel lane. Match its speed and the
   lead goes to zero; this is the circling fight's gunnery (Circle the Tiger).
4. **Fire at a steady speed.** Turning, braking and pulling away rock the
   hull 2 to 20 degrees. Hold the throttle and the line, then fire.

## 3. Shell drop: working out the hold-over

### Each gun's drop

There are three shell families in vanilla. Level fire, from the engine's
flight law:

| Gun | Muzzle, gravity | 100 m | 200 m | 300 m | 400 m | Reach on flat ground at +20 deg |
|---|---|---|---|---|---|---|
| Sherman, T-34, T-34-85, Tiger, M10 | 100 m/s, full | 1.0 s, falls 6.0 m | 2.0 s, 26.6 m | 3.0 s, 62 m | 4.0 s, 112 m | 454 m |
| Panzer IV | 100 m/s, half | 1.0 s, 2.5 m | 2.0 s, 12.3 m | 3.0 s, 30 m | 4.0 s, 54 m | **903 m** |
| Chi-ha | 80 m/s, half | 1.2 s, 4.3 m | 2.5 s, 20.0 m | 3.7 s, 47 m | 5.0 s, 86 m | 583 m |

The elevation it takes to hit a target at your own height:

| Gun | 100 m | 200 m | 300 m | 400 m | Rule of thumb |
|---|---|---|---|---|---|
| Sherman family | 3.4 deg | 7.7 deg | 12.2 deg | 17.1 deg | **about 4 degrees per 100 m** |
| Chi-ha | 2.4 deg | 5.8 deg | 9.2 deg | 12.8 deg | about 3 degrees per 100 m |
| Panzer IV | 1.4 deg | 3.5 deg | 5.7 deg | 7.9 deg | **about 2 degrees per 100 m** |

The rule of thumb is within about half a degree out to 400 m. The gun
elevates only to +20 degrees and depresses to −5, and on Kursk a client sees
an enemy out to about 400 m (the recorder's 420 m is the view distance plus
20 m, `tanks-engine.md` section 7). So a Sherman-family gun needs 17 of its 20 degrees
at the edge of sight, and a Panzer IV 8.

### How a player can work it out

There is no zoom and, as far as the repo records, no range ladder on the HUD
(GUN-6; the HUD's tank cross is an open question in `tanks-engine.md`). So
the school teaches four ways, in order:

1. **Know your family.** Four degrees per 100 m for most tanks, two for the
   Panzer IV, three for the Chi-ha. The matchup card says which you have.
2. **Range by size.** A tank is about 6 m long. Broadside at 100 m it spans
   about 3.4 degrees; at 200 m half that. Its length on screen gives the
   range, and the range gives the hold-over. Here the school can show the
   tank's outline at 100, 200 and 300 m beside your cross.
3. **Watch the fall of shot.** At 200 m the shell lands 2 s after firing, and
   the gun reloads in 2.87 s. The first round's splash arrives before the
   second is ready: correct by what you saw. The coach calls it ("short, about
   20 m, hold over more").
4. **The arc on the card.** On the matchup card, both guns' arcs to the same
   target, side-on, with half-second ticks. Where the two arcs part is where
   one tank out-ranges the other.

The visual for the lesson is the dogfight's gunsight again. A dot where the
shell will land, at the range under your cross (from the ground under it, a
cast the page can make), and the ring where the bore points. Shown first, as
training wheels, then faded out as the player's own hold-over improves.

## How the numbers were made

- **The steadiness table:** a scratch script derived from
  `tools/bf1942-models/surveys/census_ground_drive.mjs`. It drives each
  vanilla glb through the page's `TrackedVehicle` on flat ground at 60 Hz.
  The recoil is posted as the engine does: one tick of `-forward ×
  fireingForce` at the gun's node, its moment about the hull's origin
  (FA-19, `viewer/gun-recoil.js`). Rest attitude after 3 s; scenarios of 15 to
  20 s. To be promoted to `surveys/` when the matchup is built.
- **The drop and moving-fire tables:** the FA-23 flight law integrated as
  `tanks-engine.md` describes it; they reproduce that file's figures (6.0 m and
  26.6 m) exactly.
- **The rose:** the raycast of `tanks-engine.md` ("Expected shots to kill"),
  run per pair and bearing. Average is `ceil(HP / mean damage over the
  silhouette)`; best is `ceil(HP / the dearest single face)`.

## Found on the way: the inspector's angle law (fixed)

The model browser's armour inspector priced an angled hit with the Damage
System tutorial's bare `cos(angle)`, half a hit at 60 degrees. The engine's
term is `angleMod + (1 − angleMod) · sin(|cos| · π/2)` (DMG-3, DMG-4), 0.71 at
60 degrees on a tank and always 1 on an aircraft, which authors `angleMod 1`.
The bf1942-3d-models README had been corrected on 2026-09-29; the inspector
had not. So it overstated what angling a hull buys, which is the myth
`tanks-engine.md` section 1 overturns.

Fixed 2026-11-09 in `viewer/model-armour.js`: it now uses `crash-damage.js`
`angleFactor` (the function the game's `round-impact.js` uses) with the
model's own `angleMod`, read from the template node's physics extras under
the glTF scene. Checked in the browser pane on the local model viewer:

- A Sherman face reads 1.000 square on, 0.978 at 30 degrees and 0.707 at 60
  (was 0.866 and 0.5).
- A Spitfire face reads "angleMod 1, any angle", 1.000 at 60 degrees.
- No console errors.

It reaches mesh.bfstats.io once pushed: the Mesh Pipeline builds on any change
under `tools/bf1942-models/viewer/` ([mesh-site](../mesh-site/README.md)).
