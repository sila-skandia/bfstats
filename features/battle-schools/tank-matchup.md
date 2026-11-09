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

## On the school's page, second round (2026-11-09)

The owner, after the first build: overlay the hit regions on the tank, as they
translate better for players; the steadiness panel is not intuitive, show the
real model wobbling; and the guns chart is unclear, show both tanks and the
pitch of the gun for each distance. Then: take the school off the Range tab
(deep link only), FHSW's models are all grey, show loading progress in the
model window, and check pairings across mods. All built in `tanks.html`.

**The hit regions on the tank.** The stage's first view is now OVERLAY: each
tank's own textured model, with its collision faces painted by band and laid
over it at 0.62 opacity. The faces are on a render layer of their own, drawn
after the model with the depth cleared, so a plate shows on the tank even
where the model's skin stands a few centimetres proud of it. FACES shows the
painted hull alone, MODEL the model alone. Edge lines are drawn only on a
coarse hull (300 triangles or fewer a mesh): on FHSW's detailed collision
meshes they were stripes.

**The guns: how far up to aim.** The arc chart is gone. For each tank, its
own model side-on and to scale (`viewer/tank-snapshots.js`: an orthographic
picture at 34 px a metre), with its gun drawn from the elevating bundle's
pivot at the true angle each distance needs, 100 to 400 m and the target's
lit. Under them, each gunner's sight at the target's range: the target's
front at its true angular size in a window a few degrees tall, and the cross
where the gun must point above it ("aim here: 7.7 degrees above"). Every
other number moved into ALL THE GUN NUMBERS.

**How steady the hull is.** Each hull is its own side picture (its rear for
the shot across, which rolls it) turned by the measured trace about its
middle, with the gun's line turning with it against a dashed line where it
was laid. A scrubber and PLAY drive it; the panel plays the first time it
comes into view. Under each, "nose 9.3 deg down: a shot now lands 33 m off
at 200 m". The words (`tank-words.js` `steadyWords`) say the worst miss at
200 m, when the hull has stopped swinging (within 1 degree of where it comes
to rest: the Tiger rests 1.5 degrees low after a hard stop, which is said on
its own), and whether that is before the next round is loaded.

**Loading.** The models load through the game's own loader with its download
progress (`loadTankModel`, the `plane-models.js` lookup), and a card on the
stage shows each tank's bytes and a bar (a sweep when the size is unknown,
"then its textures" once the glb is in, then "Measuring the hit faces and
drawing the tanks"). The full-screen wait covers only reading the arenas.

### Mods: what was wrong, and what decides a tank now

FHSW's tanks were grey because every face priced at nothing: the overlay
painted them all "no damage". Three causes, all fixed:

| Cause | Example | Fix |
|---|---|---|
| The catalogue's rule took in non-tanks | FHSW's artillery batteries, bunker turrets, cavalry, gun half-tracks, carriers with an anti-tank rifle | The tree's AI data decides (`_shared/vehicle-ai.json`): a tank is in it, `class` Land (Desert Combat spells it `land`), `equipmentType` 0, with a weapon the AI rates against armour (`strength.HeavyArmour` above 0), and with a main gun the catalogue can name. The catalogue's rule stays only for a tree with no AI data (EoD) |
| The main gun was a stand-in | FHSW's ammunition switch: `ValentineVIIIGunBarrel` fires `ChangeAmmo_FakeProjectile` (material 210, "Knives"); the real round is on `ValentineVIIIGunBarrel_AP` | `pickMainGun`: the AI's mapped main gun if its round is real, else its armour-piercing sibling, else any real shell |
| A part far from the hull caught the rays | FHSW's `BulletCatcher` cubes (COL-20), which also made the tanks tiny on the stage | Faces under a part named for a catcher, or outside the drawn model's box, are left out of the painting, the framing and the clocks |

A tree whose catalogue cannot pair its sides (Desert Combat files its T-72 as
Allied, beside the M1A1) gets an **Every tank** arena: any two of its tanks.
Every tree has one, last in its list.

Where a gun does nothing, the stage says so on that tank ("Your gun cannot
hurt this tank"; amber "barely scratches" past 30 hits from every side), and
says why when the cause is the data rather than the armour: no tank gun
found, a round the damage table does not list, a hull with no hit faces.
Counts past 30 read "more than 30" (FHSW's 23 mm on a T-VI's front: 1,714).

### Checked across the mods

`surveys/tank_school_pairs.mjs` reads each published tree and prices the
first pairs of up to eight arenas both ways (2026-11-09). After the fixes no
pairing fails for want of a gun or of faces; every "nothing" left is the
tree's own damage table:

| Tree | Arenas (with Every tank) | Tanks | What the pairs showed |
|---|---|---|---|
| bf1942 | 6 | 8 | Every pair hurts both ways. The Sexton stays: vanilla's own AI files it as equipment 0, rated against heavy armour |
| xpack1 | 9 | 11 | Every pair both ways; the M3 GMC needs 4 on a StuG's front, the M11/39 needs 6 on the M3 GMC's |
| xpack2 | 2 | 11 | Every pair both ways (the Sturmtiger and T95 come in through Every tank) |
| fh | 3 | 27 | Panzer III L against an IS-2: nothing gets through from any side (4 of the IS-2's 14 plate materials take damage, none that faces it). Ha-Go on a Sherman POA's front: 538 |
| fhsw, fhsweurope | 53, 47 | 379, 418 | FHSW keeps its self-propelled guns (its own AI files the Wespe, Priest and Sexton as equipment 0). Toldi I on a T-34: the side only. 23 mm on a T-VI: more than 30 |
| desertcombat | 1 (Every tank) | 7 | T-72 on a Shilka: 2 a side; the Shilka's 23 mm on a T-72: more than 30 |
| eod | 3 | 18 | No AI data, so the catalogue's rule: an M109 and mortar carriers come in. EoD's own tables price a Sherman on a Tiger's front at 111 |
| bf1918, gcmod, finnwars, bg42, pirates, interstate | - | - | No published catalogue: the school does not offer them |

In the browser (headless Chrome, the local viewer): FHSW Valentine VIII
against Panzer III J (both hurt, plates named by thickness, "5mm plate"),
FH Panzer III L against IS-2 (the warning on the stage, the IS-2 painted "no
damage"), Desert Combat's Every tank arena (T-72 against Shilka), and
vanilla. No page errors; a mod without a tank sheet says "not measured" in
the drive and steadiness panels.

### Fights from the recordings

A second rail section, FIGHTS (`?view=fights`): the tank fights the
recordings agent found (`viewer/replays/tankfights/index.json`, README "Tank
fights from the recordings"), this mod's first, filtered All, Kills, Light
beats heavy and Both at full health, ordered Best, Longest shot or Newest.
Each row: the kill shot's range, who beat whom in what (weight, hit points at
the start, hits of shots), the level, date and length, its badges, WATCH
(the round replay at the fight's start) and MATCHUP (the two tanks in the
every-tank arena, the winner's yours).

## Third round: what a gunner reads (2026-11-09)

The owner on FHSW's Valentine VIII against a T95 GMC: do those numbers look
right, "my tank shows 30+ hits to the front"; and everything below the stage
looks unfinished, nothing centred, the sight's text overlapping.

**The numbers were right, the clock's summary was not.** The Valentine's
57 mm round does nothing to the T95's 130 to 250 mm plates and 50 to 80 to
its thinner ones. The clock averaged every ray, misses on proof plates
included, so it read 12 head-on and "30+" at 30 degrees while a 3-hit plate
showed from every side. `bearingShots` now also gives `hurtShots` (the
median hit on a plate the gun gets through) and `share` (how much of that
side those plates cover). The clock shows the first as its number and fills
each sector out from the hull by the second; the words read the same
("Only 22% of their front takes damage from your gun: aim at the painted
plates"). The T95 from the Valentine: 3 hits on 26% of its front, 4 on 9% at
30 degrees, 3 on 50% of its rear. Vanilla barely moves: a Sherman needs 13
hits on a Tiger's front plate, every plate of it hurting.

**The guns.** The per-tank fan only worked for vanilla's slow shells: FHSW's
guns fire at 465 to 800 m/s, so every line sat at 0.2 degrees and the tanks
were specks in empty frames. Now one chart: how high each gun must point
for each distance, both tanks on it with their pictures in the key, the
target's distance marked and read off ("0.22 deg", "7.7 deg"); a slow shell
climbs, a fast one stays flat. Under it the two sights share one angular
window, so they compare; the window holds only the target, the cross and
the gap, and the words go under it ("Aim straight at them: by 200 m the
shell drops 0.8 m, less than half their height").

**Pictures of mod tanks.** Some FHSW models carry parts metres from the hull,
which shrank the tank to a speck in its picture; `tank-snapshots.js` now
boxes a tank by the meshes within 6 m of their median middle.

**Steadiness on an unmeasured mod** is one line, not empty frames.

## Fourth round: every mod measured, straight rounds, one more slider (2026-11-09)

The owner on Desert Combat's BMP-2 against a T-72: the sight's cross sat
below the wheels, most of THE DRIVE was empty ("surely we have that data"),
and the distance slider sat above the chart, a scroll away from the sights.

**Straight rounds.** The page priced the BMP-2's AT-5 (its weapon the AI
rates against armour: 6, its 25 mm chain gun 2), a round at 100 m/s that
declares no gravity. Under the engine's launch lift alone (FA-23, +0.98 m/s)
such a round climbs about 1 m a second, so the sums put the cross 2 m under
the target at 200 m. The rounds that declare no gravity are the mods'
missiles and rockets, whose flight their motor and guidance decide, so
`tank-ballistics.js` now flies them straight: no drop, no aim-off, no reach
on flat ground. The sight says "Its round flies straight: put the cross on
them", and the guns' words compare a straight round with a dropping one.
A vehicle with no shell to fire (the Shilka) is priced by its autocannon.

**Every mod measured.** THE DRIVE and STEADINESS read the tank sheet, which
was vanilla's only. `surveys/tank_school_sheet.mjs --fetch` now downloads a
published tree's catalogue, its `_shared` collision, mobility, damage and AI
data, and its tanks' glbs, and drives them, so every mod has its sheet
(then `viewer/tank-school/<mod>.json`, now the tree's own: below). Leaving the collision data out was tried
and is wrong (turns 10 to 40% quicker, the rocking off by up to a third), and
FHSW's is 24 MB compressed, so the sheets are made ahead rather than in the
page. A wheeled hull is driven too (the EE-9: 26.5 m/s). The vanilla tanks inside
Desert Combat's tree measure exactly as in vanilla's sheet.

**The sheet is a file of the tree, made by the mod pipeline.** The owner:
"if we need to add in extra steps to populate the school data we should do
this". The sheet first lived in git (`viewer/tank-school/<mod>.json`) and
was made by hand, so a re-extract or an AI change would have left it
describing the old tanks. It now lives beside the data it is measured from,
`<maps>/_shared/tank-school.json`, and `mod_pipeline.py` writes it in its
`tank_school` step (after `models`, `levels`, `collision`, `part_mobility`
and `vehicle_ai`; its inputs are those files, so a change to any re-runs
it). It is published with the rest of `_shared` by
`scripts/publish-mesh-delta.py maps`. What the step does, per tank, about a
second each: build the published glb into the server's scene tree, drop it
on its springs on flat ground with the tree's collision meshes, and step
the page's own drive law (`tracked-vehicle.js`, `wheeled-vehicle.js`) at
60 Hz with scripted inputs: full throttle to top speed, reverse, 5 m out
and back, 90-degree turns, a hard stop, letting go, a full-lock turn and a
pull-away, and one tick of the gun's `fireingForce` at the barrel (FA-19)
ahead and across. Pitch and roll are sampled the whole time; the peak, the
time to come still and the swings are the panel's numbers, and the samples
its trace. No randomness: two runs give byte-identical sheets. Vanilla's
sheet is run by hand (vanilla is not a pipeline mod) and pinned as
`tests/fixtures/tank-school-bf1942.json`. The service record's poses-only
trees (bf1918, BG42, FinnWars, GCMOD, Interstate, Pirates) publish no
models, so they have nothing to measure and the page does not offer them.

**A mod's AI rows are known by name (2026-11-09).** The first pipeline run
from the owner's own install, for EoD, gave 12 tanks where the published
sheet had 17. The published EoD tree had no `vehicle-ai.json`, so its sheet
had come from the catalogue's rule; the local run had the AI data, and the
AI rule took only `equipmentType` 0. That number is a row of the mod's own
`Game/AIbehaviours.con` `aiSettings.setVehicle` list, and a mod adds rows
past vanilla's 17 and numbers them its own way: EoD's 16 is AmphibiousCar
(BMP-1, BRDM), 18 AmphibiousTank (PT-76, V-100), 19 AmphibiousAPC (BTR-60,
M113s), 20 AmphibiousArty, where FHSW's 19 is MobileArtillery. So
`extract_vehicle_ai.py` now carries the list (`equipmentTypes`) and stamps
each record and seat with its row's name (`equipment`), and `tank-arena.js`
`tankRow` takes `Tank` and `AmphibiousTank` by name (row 0 for a table
extracted before the names). The same run showed the T-54 and T-62 missing
from both sheets: EoD names their guns `T54Gun` and `T62Gun`, which the
`...GunBarrel` / `...Cannon` pattern missed; a one-word name ending in `Gun`
now counts (`Type63_AAGunLeft` and `Coaxial_PK` do not). Across every tree
that adds only FHSW Europe's Autoblinda 41 and 43 (turreted armoured cars,
no AI record) and FH's towed `pak38`, which `NOT_A_TANK` now names. EoD's
sheet went from 17 to 16: the T-54, T-62 and Sexton in; the BMP-1, BTR-60,
BRDM-2 and M109 out (the game's AmphibiousCar, AmphibiousAPC and
ArtilleryDriver). Desert Combat's sheet from the install matched the
published one exactly.

**Every shot measured.** The owner, on the BMP-2's empty FIRE AHEAD: "it's
physics so we can calculate something". Two cases had been left out, and
both are measured now. A gun the game gives no recoil (`fireingForce` 0: the
BMP-2's AT-5, the M163's and Shilka's cannons) shoves nothing: the hull is
driven on with no push and stays where it rests, and the page says so ("its
gun has no recoil in the game, so firing does not move the hull"). A wheeled
hull's drive has no accumulator to post the push into, so the shot's one
tick is spent on its velocity and spin directly, as the tracked law spends
it (`a dt`, and `(r x a) dt` over the box inertia in the hull's frame): the
EE-9 fired across its hull rolls 11.7 degrees and settles in 0.9 s.

**One more slider.** A second TARGET AT over the sights, in step with the
one over the chart.


## On foot: the anti-tank weapons (2026-11-10)

The owner: "the FHSW panzerfaust is insane difficult to shoot. I'd love to
know its range and drop. Are we able to collect anti-tank weapons and plot
them against a tank?" Then, mid-build: "HUD sights are important too ...
those PIAT and axis anti tank have a complicated HUD ... or at least overlay
the HUD so it can be shown how to make a shot". Card 05, ON FOOT.

**Which weapons.** A side's kits on the arena's battles
(`loadouts.json` `levels[level][team].slots`, team 1 Axis and 2 Allied,
a level's own kit before the global one, a `Random*` item's variants
beside it), and of their items those the game's own AI table rates against
heavy armour (`aiWeapons[name].strength.HeavyArmour > 0`). EoD's loadouts
carry no AI table, so there the Anti-tank kits' items stand in, and the
knives and pistols that brings drop out at the next filter: a weapon is
listed only when some plate of the target takes damage from its round. A
rated weapon that hurts no plate of this tank is named under the list ("Carried
too, but no plate of the T-34 takes damage from: Grenade Axis"). A round
slower than 10 m/s is set down, not fired (FHSW's Haft-Hohlladung, 3 m/s),
and left out.

**The round.** The weapon's own glb: `fireArms.velocity`, the projectile's
`gravity` (1 when it declares none), `material` and `timeToLive`. Every hand
launcher's round is `kind: 'shell'` with no motor of its own, so it flies
`tank-ballistics.js`'s closed form, the launch lift included (FA-23: +0.98
m/s whatever the round's gravity). That lift is why EoD's LAW (gravity 0.01)
climbs 0.7 m over 50 m and is ended by its 20 s fuse, 1300 m out, not by the
ground: the reach is "until it lands or its fuse runs out".

| FHSW launcher | m/s | Up to hit at 25 m | at 50 m | at 100 m | Flight to 50 m | Reach |
|---|---|---|---|---|---|---|
| Panzerfaust 30, Faustpatrone II | 28 | 10.9 deg | 29.2 deg | out of reach | 2.0 s | 57 m |
| Panzerfaust 60 | 45 | 3.4 | 8.8 | 21 | 1.1 s | 144 m |
| Panzerfaust 100 | 60 | 1.6 | 4.5 | 10.6 | 0.8 s | 253 m |
| PIAT | 76 | | 2.6 | | 0.7 s | 402 m |
| Bazooka | 82 | 0.6 | 2.2 | 5.3 | 0.6 s | 468 m |
| Panzerfaust 150 | 85 | 0.5 | 2.0 | 4.9 | 0.6 s | 502 m |
| Panzerfaust 250 | 150 | flat | 0.4 | 1.3 | 0.3 s | about 1 km |

(The flight to 50 m is at the elevation that hits; aimed level, the
Panzerfaust 30 lands 15.7 m out.)

**The spread.** The glb's document extras carry the weapon's deviation
(`extras.weapon.deviation`: `min` is `setMinDev`, `speed` is `setSpeedDev`,
`mod` is `setDevMod`). A round strays up to `total / 100` radians on each of
the up and right axes (DEV-9), `min` unscaled by stance (DEV-2), and walking
adds up to `speed[0] x mod[stand]`. FHSW gives its Panzerfausts `setMinDev
2.0` and a walking cap of 8 x 1.4: standing still a round lands within 1 m
of the aim point at 50 m on each axis, walking within 6.6 m. That and the
lob are why it feels so hard. Vanilla's Bazooka and Panzerschreck declare
only `minDeviation` / `maxDeviation`, words the engine does not read
(DEV-8, checked in vanilla's `Objects.con`), so they have no spread at all:
the panel says "A miss is the drop or the lead, never luck".

**The lead.** The flight time times the target's top speed (from the tank
sheet), in metres and tank lengths: a Panzerfaust 60 at 50 m on a Tiger
crossing at 11 m/s, 12.4 m, 1.6 lengths.

**The card.** YOUR SIDE'S / THEIR SIDE'S (whose soldiers, at the other
side's tank in the matchup), a chip per weapon, a TANK AT slider out to the
furthest reach, then:

- the lob at true scale, both axes in metres: a standing soldier (the tube
  1.5 m up), the path aimed to hit and the path aimed straight at them, the
  tank broadside at the distance, its nose towards him, and the apex height;
- THROUGH THE SIGHT (`tank-sight-view.js`): what the soldier sees zoomed.
  The world through the weapon's `zoomFov` (radians, vertical, as
  `hand-fire.js` sets the camera), pitched up by the aim, the tank's model
  at the distance; the weapon's first-person rig
  (`viewmodels/<Soldier>__<Weapon>.fp.glb`, the side's soldier from the
  loadouts, the tree's index then vanilla's) at its zoom pose
  (`center1pHands` + `soldierZoomPosition`) in its own pass through
  `set1pFov x soldierZoomFov`, its standing `idle` clip; the HUD's scope
  picture across the whole frame where the weapon has one (the pack's
  `scopes.json`, SCOPE-2..SCOPE-6: FHSW's rifle grenades); and over it all
  the crosshair (where the tube points: `fireInCameraDof`), the dot where
  the round comes down on the tank, and its spread as squares;
- the clock of hits to kill for that warhead, and the words;
- EVERY WEAPON SIDE BY SIDE: speed, reach, the aim at 25, 50 and 100 m,
  the spread at 50 m and the hits to kill from the front, side and rear.

What the sight view shows about FHSW's own sights: aimed for the range, the
Panzerfaust 30's leaf has its "30m" mark at the tank's height at 30 m, and
the PIAT's aperture plate has the hole marked "6" at the tank's height at
60 m. The sights are the range tables, and the page says the angle they
encode. Their sideways place is the viewer's first-person mount, the same
the map page draws; it puts both marks right of the crosshair, which has
not been checked against the retail game.

**Checked** in headless Chrome (ui's Playwright, the viewer on its preview
port): vanilla Kursk (the Panzerschreck against the T-34, no spread, 0.5
deg at 50 m), FHSW Karelia (the Panzerfaust 30 against the KV-2, 13.9 deg
at 30 m, 57 m reach), FHSW Gold Beach (the PIAT against the Churchill VCS
and the Panzerfaust 60 against the Tiger), Desert Combat (the Bazooka and
SMAW against the T-72) and EoD (the M79, LAW and M72 against the T-34-85),
with no page errors. `tests/test_tank_school.py` `OnFootTests` pins the
kit reading, the Panzerfaust 30's numbers, DEV-8's no spread, the LAW's
fuse, the words and the rig lookup.

**Open.** A thrown weapon (a Molotov, a Gammon bomb, a grenade) is drawn
as a 20 to 25 m/s round, which is how the engine launches it; nothing
marks it as thrown. The sight view draws the target front-on, so the lead
shows in the words and not on the picture. FHSW's Arnhem is not an arena
(the school has no tank pair there), so its Panzerfaust 100 is reached on
Westwall, Hungary Forest or the Seelow Heights.
