# Battle schools

Status: **research, and the tank school's first screen built** (2026-11-09).
This folder holds the groundwork for schools like the
[dogfight school](../dogfight-school/README.md) for other kinds of fight,
tank against tank first. The tank school's own page, `tanks.html`, is built
with its MATCHUP screen ("Built: the tank school's MATCHUP", below). Its
lessons, GUNNERY and DRIVE IT are not. Not published: it reaches
mesh.bfstats.io when pushed.

The owner's brief (2026-11-09): research how the dogfight school could apply
to other battle types, tank against tank above all. "I'm a fly boy, not a
tank commander... whereas in a dog fight it's about manoeuvring, I feel like
with a tank it's about pre-positioning and then being a good shot." Not to
build yet: ideas to start planning an approach.

| File | What it holds |
|---|---|
| [tanks-engine.md](tanks-engine.md) | What BF1942's engine does in a tank fight: armour faces, shots to kill, the gun's flight, hull-down, repair, today's tank bots, a headless duel rig, what the recordings carry |
| [tanks-tactics.md](tanks-tactics.md) | Tank doctrine, the aces and engagements, a move catalogue, BF1942 tank lore, the dogfight-to-tank translation, a scoring scheme and ten ranked lessons |
| [infantry.md](infantry.md) | Infantry against infantry: the engine's spread, damage, movement, grenade and netcode laws, tactics and lore, scoring and ten ranked lessons |
| [tank-matchup.md](tank-matchup.md) | The owner's first use cases (2026-11-09): pick two tanks and compare hit regions, guns, drive and steadiness; firing on the move; working out the drop. With the wobble measured for every vanilla tank |
| [other-matchups.md](other-matchups.md) | Anti-tank infantry, fighter against bomber, AA, bombing, naval, light vehicles, artillery and team fights, each scored for fit |

Where the files disagree, `tanks-engine.md` wins on engine numbers: it read
the ledger and ran the viewer's own code. `tanks-tactics.md` was written
before that survey finished (see "Where the notes disagree").

## The short answer

**The owner's intuition holds, with three corrections.** A tank fight in
BF1942 is an ambush and a gunnery problem at range, and a knife fight up
close.

1. **Pre-positioning is real in the engine.** Shells stop on the terrain, and
   the gun sits 0.1 to 0.4 m above the hull roof. A crest can hide the whole
   hull and leave a band of turret about a fifth of the tank's front.
   Hull-down is a real position, not just doctrine.
2. **Being a good shot is the hard part.** Main-gun shells leave at 100 m/s
   and fall hard: 1 s and 6 m of drop at 100 m, 2 s and 27 m at 200 m. A
   human's main gun has no spread, but the hull's own speed is added to the
   shell. So gunnery means judging range, holding over, leading, and
   stopping to fire.
3. **Which face you hit decides the fight, so manoeuvre comes back.** Each
   face of a tank's collision mesh carries its own armour material. A square
   hit on a Panzer IV's or Sherman's rear plate kills it outright. Its front
   takes three hits. Manoeuvre here is not turning onto the six. It is
   getting off the enemy gun's line and onto a weak face.

Up close, BF1942 rewards a move the real war did not: **circling**. A
Tiger's turret turns 20 degrees a second, so a medium tank circling it at
15 m only needs about 5 m/s to stay ahead of its gun. It is the one true
dogfight in tank combat, and the best bridge for a pilot.

**Infantry fits the format too, but its lessons happen in the two seconds
before the first shot.** Kills take 0.25 to 0.3 s. **Anti-tank infantry
against a tank** is the best match-up after tank against tank. It reuses the
tank school's damage model from the other seat.

## A pilot's phrasebook

What each dogfight idea becomes in a tank. Detail in `tanks-tactics.md`
section 6.

| In the dogfight school | In a tank |
|---|---|
| Energy (speed plus height), spent for position | **The reload clock and the exposure budget.** A shot every 2.9 s (4.0 s for the Tiger and M10) is the beat of the fight. The budget is the seconds you are seen by a loaded, roughly aimed gun |
| Height advantage | **The position you chose first.** Hull-down, on a flank, unseen. Height counts only where it gives hull-down, a view, or a look at the roof (a roof is rear-grade armour) |
| The six | **The weak faces.** Rear and side, and the roof from above. One square hit there can end it |
| Turn rate | **Turret traverse plus hull turn rate.** 20 to 35 degrees a second, against a fighter's 200-plus of roll. You can stay outside their arc for seconds |
| Roll the lift vector, then pull | **Point the hull where you want the armour, and the turret where you want the shot.** The single most teachable idea |
| Kill-shot window | **The window when you are exposed and they are loaded** |
| Boom and zoom | **The peek: shoot and scoot.** Show, fire, reverse 5 m out of sight (1.8 s), before their reload ends |
| Dip, Flip, Ninja | **Duck, Flank, Ghost.** Break contact; turn a tank looking down your barrel into one showing you its side; kill without being hit, exposed for less than one of their reloads |
| `perceive()`: view cones, glances, noticing delay | The same, from the seat camera, with line of sight over the heightfield. Bushes hide a tank but stop no shells |
| The sky is empty | **Terrain is the third player.** Every lesson needs a piece of map, and a move that works on one crest fails on the next |

## Tanks: what is real in the engine, and what is doctrine only

From `tanks-engine.md` section 8. Each row's evidence is there.

| Lesson | In BF1942? |
|---|---|
| Shoot the rear and flanks | **Real, and big.** 2 to 3 times the damage on Sherman, Panzer IV, T-34-85 and Chi-ha. A square rear hit is one shot |
| The rear is every tank's weak spot | **False** for the Tiger, T-34 (76) and M10. Their rear carries side armour, so getting behind gains little over the side |
| Angle the hull 30 to 45 degrees (the Tiger's "Mahlzeit") | **Doctrine only, and a net loss.** The engine's angle term barely bites near square (30 degrees off still does 0.98), while angling shows more of the weaker side. Teach "face them square" |
| Sloped plates deflect | **Real where the mesh is sloped.** The Sherman's 60-degree glacis takes 0.71 of a flat hit |
| Hull-down | **Real** |
| Hide in a bush | **Hides you from people. Stops no shells** |
| Stop to shoot | **Real.** The hull's velocity goes into the shell |
| Range estimation and hold-over | **Real, and the dominant skill** |
| Shoot the tracks to immobilise | **Not in the engine.** Wheels and tracks take no damage |
| A crippled tank | **Real.** Under 12 HP the turret turns at a fifth of its speed and the hull burns out in about 8 s. Whether the drive slows too is unknown |
| Creep through a minefield | **Real.** A mine does not fuse for a hull under 2.5 m/s (9 km/h) |
| HE against armour | **Useless** on tanks (DMG-2) |
| Engineer repair mid-fight | **Real but weak.** A wrench roughly cancels the burn; a repair pad restores a tank in about 11 s |
| The match-ups are not even | A Sherman needs about 9 shots on a Tiger's front, and the Tiger needs 3. Fight your tank's fight, the way a Wildcat never turned with a Zero |

## Where the notes disagree

- **Drop.** `tanks-tactics.md` gives about 5 m over 100 m and 20 m over
  200 m. `tanks-engine.md` ran the engine's gravity (14.73 m/s²) and gets 6 m
  and 27 m for the Sherman's shell. The Panzer IV's and Chi-ha's shells take
  half that gravity. Use the engine figures.
- **"One rear hit kills from any tank gun"** (`tanks-tactics.md` section 0)
  holds only against tanks with rear plates: Sherman, Panzer IV, T-34-85,
  Chi-ha. Against a Tiger, T-34 or M10 it is 2 to 4 hits from behind. The
  lessons marked **[faces]** in `tanks-tactics.md` need re-checking against
  the shots-to-kill table in `tanks-engine.md`.
- **Angling.** Both files agree in the end: square up. Lesson 1, "Turn to
  face", is right. The move catalogue's "Angling the hull (the Mahlzeit)" is
  the history behind it, not advice for this engine.

## A tank school, sketched

**Lessons.** `tanks-tactics.md` ranks ten. The six that matter most to a
pilot:

1. **Turn to face.** A tank appears off your side. Swing the hull square to
   it while the turret tracks, then back toward cover. Nothing from flying
   carries over to this one.
2. **Peek on the reload.** A hull-down enemy covers a crest. Wait out of
   sight for its shot, then roll up, fire inside its 2.9 or 4 s reload, and
   back off.
3. **The first round.** Gunnery on a 100 m/s shell: range by hold-over, read
   where the first round fell, correct. A kill in two rounds or fewer.
4. **Circle the Tiger.** Close from cover and circle inside 25 m, faster than
   its turret. The counter, for the Tiger: reverse to open the range.
5. **The ambush lane.** Cross between two crests without giving an ambusher
   your side. Read the dead ground.
6. **Never chase the bait.** One tank shows, fires and backs behind a
   building, and a second waits beside it.

**The gunnery range.** This is the counterpart of the ring courses: a pure
skill drill with nobody shooting back. Targets stand at unknown ranges and
the coach calls the fall of shot ("short, about 20 m, hold over more"). It
is the cheapest piece to build, needing no tank bot, and it teaches the
skill a pilot most lacks.

**The theatre.** The dogfight theatre's parts carry over, with changes:

- Each gun's reload drawn as a ring that fills.
- Each shell's arc, and the face it struck coloured by armour.
- Sight lines shaded while a tank is exposed.
- The energy chart replaced by an exposure and hit-points strip, one line per
  tank.
- Slow on shots and the explain-shot cards, as they are.

**The guide.** A plane has one stick. A tank has two things to point, so the
guide wants two needles: the hull (where your armour faces, against the
threat) and the turret (lay and hold-over, against the target).

**Scoring.** Duck, Flank and Ghost (`tanks-tactics.md` section 6), on the
same nine-start L9 array scaled to tanks: 10 m sideways and along, 15 degrees
of hull angle, and the moment the enemy appears (plus or minus 1 s). 7 of 9
works, 3 to 6 partly, as in the dogfight school.

**From the recordings.** A `tank-duel-detect` on uploaded client recordings
can find opposing hulls in range, turret-on-target time, shots and hit-point
drops. It cannot see the face struck, misses' fall points, or who killed a
hull. The lab server's recordings carry everything but the face, and the face
can be found by casting the impact point at the hull mesh. Start on the
desert maps (Aberdeen, Gazala, El Alamein have the most tank spawners). The
school's opening question is whether "who fires first wins" holds in BF1942
the way it did in the war.

## Infantry, sketched

From `infantry.md`. The laws are short and well measured (spread DEV-1 to
DEV-15, movement PHY-34, damage DMG-3, grenade exposure HP-10). Three things
differ from air:

- **The spread cone is the infantry's energy.** Running, firing and jumping
  spend it. Stopping, crouching and lying down bring it back. At 30 m a
  running BAR lands about 12% of its rounds. A planted first round lands
  every time.
- **Fights last a second.** The lesson is who saw whom first and who stopped
  to shoot. The theatre needs bullet time centred on first sight.
- **Netcode matters.** The server rewinds a soldier by up to 0.3 s to judge a
  hit, so the peeker's advantage and being shot behind cover are real.

Top lessons: stop to shoot, pick the range for your gun (SMG inside 15 m,
rifle at 60 m), the corner (hold back, or peek tight), who saw whom first,
prone base of fire, and the grenade. For the grenade the counter feels
wrong: in the open, stand up and move. Standing halves your exposure.

Blocker: the headless sim prices every round as a chest hit on a sphere, so
it has no head shots and stance changes nothing. A per-stance hit-capsule
table comes first.

## The other match-ups

From `other-matchups.md`, ranked for fit:

| Rank | Match-up | Fit | Why |
|---|---|---|---|
| 1 | Anti-tank infantry against a tank | 5 | Short, decisive, and priced exactly by the same face tables. A bazooka kills a Sherman with one rear shot, three to the side or four to the front |
| 2 | Fighter against bomber or attack plane | 4 | The dogfight school plus a bomber airframe and gunner bots. 91 such fights are already in the mined recordings |
| 3 | Ground AA against aircraft | 4 | The flak fuse and AA bot exist, and the pilot's counters are clear moves. The gun cannot move, so it is half a duel |
| 4 | Bombing a ground target | 3 | Exact ballistics, but a course more than a duel |
| 5 | Team fights (2v2, tank plus engineer) | 3 | The most value and the most cost: two-a-side duels, a friendly bot, team scoring. The Thach weave waits on this too |
| 6 | Naval | 2 to 3 | Measured physics, but the submarine cannot dive on a control and fights last minutes |
| 7 | Light vehicles | 2 | One ram or one mine decides it: tips, not moves |
| 8 | Artillery and spotting | 2 | Indirect and slow; an explainer, not a duel |

## The owner's first use cases (2026-11-09)

Detail and numbers in [tank-matchup.md](tank-matchup.md).

- **Pick two tanks: the matchup, first.** Choose your tank and theirs; see
  each hull painted by the other's gun (where to aim, where you are exposed),
  the two guns' arcs, the drive, and how steady each hull is. Plain words
  for this pairing, never a who-wins verdict (the model browser's Compare
  panel was removed for that).
- **The Tiger wobbles: measured.** A hard stop pitches it 20 degrees; it
  rocks 7 s and comes to rest 1.5 degrees off (5 m at 200 m). A Sherman peaks
  at 5.6 degrees, a T-34 at 1.5.
- **The Tiger's range is the Sherman's.** Same shell, same gravity. The
  Panzer IV out-ranges both: its shell falls under half gravity, 903 m reach
  against 454.
- **Firing on the move:** the shell takes the hull's whole velocity. Lead is
  an angle, `atan(relative crossing speed / 100)`, the same at every range:
  8.4 degrees at a Sherman's top speed. Drop is a distance.
- **Drop:** three families. About 4 degrees per 100 m for most tanks, 2 for
  the Panzer IV, 3 for the Chi-ha.
- **Fixed on the way, in the model browser:** its armour inspector priced
  angled hits with a bare cosine; it now uses the engine's angle law. This is
  a fix to the model browser in its own right. The school does not live there.

## The tank school's own page (2026-11-09)

The owner: "the special thing about the dogfight school is it's a dedicated
page just to planes. Tanks would be the same." The model browser is a raw tool
for checking the extraction. The tank school borrows from it but is a page of
its own, built the way `dogfight.html` is.

### How the dogfight school's page is put together

- **`dogfight.html`** is a 33-line shell: the design system's `tokens.css` and
  `map.css`, a wait screen with the logo ("Fuelling the planes"), and one
  module, `dogfight-school-page.js`.
- **No level is loaded.** The page reads the mod's model catalogue
  (`models.json`) and level list, builds its **arenas** from them
  (`dogfight-arena.js` `arenasFrom`: a battle whose two sides both field a
  fighter, one arena per pair of fighter sets), and loads only the planes it
  draws (`plane-models.js`, the replay's model lookup).
- **The sidebar** picks the ARENA, then YOUR PLANE, then the lessons, ring
  courses and recorded fights. Choices are kept in `localStorage` and in the
  address (`?arena=`, `?lesson=`, `?mod=`, `?fight=`), with a mod pill in the
  header.
- **The theatre** (`dogfight-theatre.js`) is its own renderer and scene over
  the page: cameras, scrubber, the energy chart, the shot cards.
- **FLY IT** leaves the page for the Range's construct with `arena=dogfight`:
  only the battle's aircraft loaded, no kit bench, targets, briefing or spawn
  screen, the ace in the air (`proving-ground-page.js`, `map.html`).
- **The way in** is THE RANGE tab's DOGFIGHT SCHOOL card
  (`play/proving-ground-screen.js` `openSchool`), beside LIVE-FIRE RANGE. Esc
  goes back to that tab.

### The tank school, the same way

- **`tanks.html`** with `tank-school-page.js`: the same shell, wait screen
  ("Loading the shells"), mod pill and deep links (`?arena=`, `?yours=`,
  `?theirs=`, `?mod=`).
- **Arenas from the catalogue** (`tank-arena.js`), as the fighters' are: a
  battle whose two sides both field a tank, one arena per pair of tank sets.
  From vanilla's catalogue, three:

  | Arena | Allied | Axis | Battles |
  |---|---|---|---|
  | The West and the desert | Sherman, M10 | Tiger, Panzer IV | El Alamein, Gazala, Aberdeen, Battleaxe, Bocage, Battle of the Bulge, Market Garden |
  | The Eastern Front | T-34-85, T-34 | Tiger, Panzer IV | Kursk, Kharkov, Berlin, Stalingrad |
  | The Pacific | Sherman | Chi-ha | Guadalcanal, Iwo Jima, Invasion of the Philippines |

  The battle lists are a first read of the catalogue's `levels`, not a
  computed grouping; `tank-arena.js` would compute them, as `arenasFrom` does.
  The catalogue calls every land vehicle `land` (jeeps and half-tracks too),
  so a tank needs telling apart: a `tankRank` list as the dogfight school's
  `fighterRank` is, or the glb's `c_ETTank` engine type.
- **The sidebar:** ARENA, YOUR TANK, THEIR TANK (the arena's other side by
  default, any pair allowed), then MATCHUP, GUNNERY, and later LESSONS and
  FROM THE RECORDINGS.
- **MATCHUP is the first screen** (`tank-matchup.js`): the four panels of
  `tank-matchup.md` section 1. It needs no bot and no level.
- **GUNNERY** (`tank-gunnery.js`): the moving-fire and drop explainers of
  `tank-matchup.md` sections 2 and 3, as diagrams you can drive: the vector
  sum at the muzzle, the two ghost arcs, each gun's drop family, the ring and
  the dot. Built on a pure `tank-ballistics.js` (the FA-23 flight, lead and
  hold-over) that the live drill and the headless duel share.
- **DRIVE IT** leaves for the Range's construct with `arena=tanks`: only the
  arena's tanks, your side by your tank, a bot in theirs. The one real
  difference from the dogfight arena is the ground. The sky needs nothing; a
  tank needs a crest, a berm, a lane with dead ground and a corner. The
  construct already builds its white floor as terrain tiles in memory
  (`proving-ground.js`), so the arena's floor gets **sculpted sets** on the
  engine's 4 m grid (TERR-16). The same height samples feed the headless duel
  (`heightfieldFromSamples`), so a lesson's set is the same in the page and in
  the tests, as the dogfight theatre's fights are.
- **The way in:** a third card, TANK SCHOOL, on THE RANGE tab beside DOGFIGHT
  SCHOOL and LIVE-FIRE RANGE. Esc goes back to the tab.

### What it borrows, and from where

| Piece | From | How |
|---|---|---|
| Damage per face, shots to kill | Model browser: `armour-damage.js` | As it is: pure, no DOM |
| Painting a hull's collision faces by damage, the colour ramp | Model browser: `model-armour.js` | Lift the painting into a shared module (`armour-paint.js`), attacker a tank rather than one weapon; the inspector keeps its own UI on top |
| `damage.json`, the glbs, the mod's model lookup | Model browser and `plane-models.js` | Generalise `plane-models.js` to any vehicle (`vehicle-models.js`) |
| The turret turning with its collision mesh | `turret-rig.js`, `seats.js` | To show a turret's softer rear when it is turned away |
| The drive, for live rocking and the drive numbers | `tracked-vehicle.js`, `VehicleOccupancy` | Runs in the browser already. Run the hard stop and the shot live on a flat patch in the steadiness panel, or read precomputed traces |
| Page shell, wait screen, mod pill, arenas, deep links | Dogfight school: `dogfight.html`, `dogfight-school-page.js`, `dogfight-arena.js` | Copy the pattern |
| Theatre: cameras, scrubber, shot cards | `dogfight-theatre.js` (3,160 lines, plane-specific) | Extract the scrubber and cameras when the tank theatre is built, not before |
| Coach, guide, lines, the L9 nine starts and scoring tests | Dogfight school | Same shape; a two-needle guide (hull and turret) |
| The arena on the Range | `proving-ground.js`, `proving-ground-page.js`, `map.html` (`arena=dogfight`) | A sibling `arena=tanks`, with sculpted ground |
| Design system | `tokens.css`, `map.css` | As the dogfight page uses them |

What it does not take from the model browser: its page, its weapon picker
(the school picks tanks, not weapons), its crew stations panel, or its
removed Compare panel's who-wins verdict.

## Built: the tank school's MATCHUP (2026-11-09)

The owner: "Just do it, don't wait for me." Built as the plan above says:
`tanks.html`, its own page in the dogfight school's shell, with MATCHUP as
its first and only screen so far.

**Using it.** THE RANGE tab's TANK SCHOOL card, or `tanks.html` with
`?mod=`, `?arena=`, `?yours=`, `?theirs=` (all kept in the address, so a
matchup can be linked). The sidebar picks the ARENA (from the catalogue:
The Eastern Front, The West and the desert, The Pacific, and Kasserine Pass
and Liberation of Caen, whose tank sets differ), then YOUR TANK and THEIR
TANK, any two of the arena's. Esc goes back to the Range tab, L folds the
list. The board, top to bottom:

1. **Where to aim, where you are exposed.** Both hulls side by side, their
   collision faces painted by the shots a square hit from the other's gun
   needs (1, 2, 3, 4 to 5, 6 or more, or nothing). Front, 45, Side, 135 and
   Rear turn both at once; drag turns them freely; From above lifts the
   camera 20 degrees; Models shows the real models. Pointing at a face
   reads it: its armour, what a square hit does, and what it does at the
   angle you are looking from. Under it, a clock per hull of shots to kill
   from twelve bearings (the average over the silhouette, cast from the
   collision faces), and the plain words: where to aim, what to keep away
   from them, and your weakest face.
2. **The guns.** Both shells' arcs to a target you slide from 50 to 400 m:
   solid aimed to hit it, dashed fired level, a dot every half second, and
   a table of muzzle speed, gravity, the elevation to hit, the drop, the
   hold-over rule, flight time, reach, reload, turret and gun limits.
3. **The drive.** Hit points and the burning threshold, top speed, reverse,
   5 m forward and back, and a 90-degree turn from rest and at speed.
4. **How steady the hull is.** Hard stop, let go at speed, fire ahead and
   fire across: each hull's swing over time against a 1-degree band, the two
   hulls drawn rocking through it on Play, and the peak, when it is still and
   where it ends.

Every panel's sentences come from `tank-words.js`, which says what to do in
the pairing and never who wins. Sherman against Tiger opens "Get off their
front, and use your faster turret to stay on their side."

**How it is built.**

| Module | What |
|---|---|
| `viewer/tanks.html`, `viewer/tank-school-page.js`, `viewer/tank-school.css` | The page: the dogfight school's `.dfs` shell (rail, panel, arena list, chips, mod pill, from `map.css`) and the four cards. The stage is its own three.js renderer; the clocks, arcs and traces are SVG |
| `viewer/tank-arena.js` | `isTank` (land, a `...GunBarrel` or `...Cannon` not named for the air, 100 to 300 hit points), `arenasFrom` (one arena per pair of tank sets), `tankIn`, `enemyOf`, `prettyTank` |
| `viewer/tank-armour.js` | `pricer` (the damage table, DMG-1, DMG-3), `bandOf`, `bearingShots` (the ray grid from each bearing, every triangle tested directly so it runs on the page's meshes and in node; the engine's angle factor, DMG-4), `faceTable` |
| `viewer/tank-ballistics.js` | The shell's flight in closed form (FA-23, IMP-7, IMP-8: `projectile-flight.js`'s per-tick parabola): `dropAt`, `elevationFor`, `reach`, `leadAngle`, `degreesPer100`, `arc` |
| `viewer/tank-words.js` | The sentences |
| `surveys/tank_school_sheet.mjs` -> `viewer/tank-school/bf1942.json` | Each tank driven through the page's tracked drive on flat ground: the drive numbers, the steadiness and the traces (21 KB). Run with `--models` and `--maps` pointing at a tree that holds the glbs (the viewer's own, or a download of the published ones) |
| `viewer/play/proving-ground-screen.js` | The TANK SCHOOL card |

What it borrows: `armour-damage.js` (`damageMath`, `shotsFor`) and
`crash-damage.js` (`angleFactor`) as they are; `plane-models.js`'s model
lookup (`loadPlaneModel`, which loads any template); `mods.js`. The tank's
gun, turret and hit points are read off its glb's extras (`fireArms`,
`rig.axes`, `armor`); the reload is whole ticks (GUN-13).

**Checked.**

- `tests/test_tank_school.py` (14, through `tank_school_harness.mjs`): the
  three shell families' drop, elevation, reach and rule of thumb, the lead
  and drift on the move, the arenas and picks from a small catalogue
  (half-tracks, jeeps, SPGs, flak guns, radar towers and a captured tank
  left out), a box hull's price and shots from four bearings, the words for
  three pairings, and the committed sheet (the Tiger's 20-degree wobble,
  the Sherman's shove, every trace).
- `bearingShots` on the published glbs matches the scratch raycast of
  `tanks-engine.md` within a shot (Sherman shooting a Tiger: 10, 7, 5, 4, 4,
  4, 4 round from the front; a Tiger shooting a Sherman: 3, 3, 2, 2, 2, 2, 2).
- Headless Chrome against the local viewer (`model-viewer` in
  `.claude/launch.json`, the published glbs fetched through it), 1440x900 and
  390x844: Sherman against Tiger and against Panzer IV, T-34 against Tiger;
  the bearings, the hover card ("Theirs, side armour: 50 a square hit from
  your gun, 3 shots"), From above, Models, Play, a change of tank and of
  arena; no page or console errors. The Range tab's card opens
  `tanks.html?arena=Kursk&yours=T34&theirs=Tiger&mod=bf1942`.
- Not looked at in the browser pane by a person: it was hidden all session.

**Open.**

- **Mods.** The sheet is vanilla's only; a mod's DRIVE and STEADINESS say
  "not measured" until the survey is run on its tree. A mod's arenas come
  from its catalogue (FHSW's include its gun-armed half-tracks), and the
  page has not been checked on one past loading.
- **Kasserine Pass** carries its own faster guns (300 to 500 m/s); the page
  reads each template's own gun, so that arena's GUNS panel is the standard
  tanks', not the level's.
- **The clocks are the average over the silhouette**, as `tanks-engine.md`
  measured them; a gunner who picks a spot does better (the best spot is in
  the words and the painted hull, not in the clock).
- **Not built yet:** GUNNERY (the moving-fire and drop diagrams), DRIVE IT
  (the tank arena on the Range with sculpted ground), the lessons, the
  headless duel, the recordings.

## A planning approach

A suggested order. Each step stands on its own and is worth having even if
the next never comes.

1. **Settle the open engine questions** (`tanks-engine.md`, "Open
   questions"). Most important: a crest test on the lab server (a hull-down
   Sherman shot at its hull: does the shell stop on the ground where the page
   says?), and whether critical damage slows the drive.
2. **Done 2026-11-09: the tank school's page with its MATCHUP screen** (the owner's first
   pick). `tanks.html`, the arenas, YOUR TANK and THEIR TANK, and the four
   panels. No bot and no level: the shared armour painting, `damage.json`,
   the glbs, and a sheet of each tank's drive, steadiness and shots-to-kill
   rose. Then the card on THE RANGE tab.
3. **GUNNERY on the same page:** `tank-ballistics.js` and the moving-fire and
   drop diagrams. The live versions (the two ghost arcs, the ring and the dot)
   come with DRIVE IT.
4. **DRIVE IT: the tank arena** on the Range's construct, `arena=tanks`,
   with sculpted sets (a crest, a berm, a lane, a corner). Tailoring the
   Range's own gunnery for tanks waits, as the owner asked.
5. **A headless tank duel** (`tank-duel.js`, the counterpart of `runDuel`).
   The drive, terrain, shell flight and hit pricing already run in node (see
   `tanks-engine.md` section 6). What is missing: a tank crew policy with
   named moves (`tank-crew.js`, the counterpart of `dogfight-pilot.js`), with
   seat-camera perception; staging two hulls on a terrain window; and Duck,
   Flank, Ghost scoring. Prove three lessons' numbers here first: turn to
   face, peek on the reload, circle the Tiger.
6. **LESSONS: the theatre and the live drill** on the tank page and in the
   arena, with the tank strip, reload rings and shell arcs, flown on the
   arena's sets. This is the "pre-positioning" half.
7. **Anti-tank infantry against a tank**, the same damage model from the
   other seat.
8. **The tank-fight detector on recordings**, once there are enough server
   recordings, or on client files for the coarser questions (who fired first,
   and who won).

**A design decision to make early:** whether to lift the dogfight school's
shell into a shared core first: the theatre, the nine-start L9 harness, the
scoring tests, perception, the coach and guide plumbing, and the recording
detector's evidence-run machinery. Done once, each new school becomes a
policy, a staging and a scoring rule. Done per school, the tank school ships
sooner and the shared core is extracted at the second copy (infantry or
anti-tank).

**A teaching decision:** where the engine and doctrine disagree (angling, the
Tiger's rear, track shots), the dogfight school's rule applies: teach the
real doctrine as history, then show what the game does with it.
