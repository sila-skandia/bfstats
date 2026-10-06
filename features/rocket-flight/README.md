# Rocket flight: gravity, the motor, and where a round lands

Status: built 2026-10-06 (Desert Combat parity round, package `rounds`).
Every round, drawn or invisible, falls by its own `gravityModifier` (§1, §2),
and a rocket flies on its own `Engine` and the box drag law, both read from
the server binary (§3, ledger PHY-18..PHY-22). Checked against the real game
on 2026-10-07 (review): with the drag box taken from the round's own `.sm`
header and the engine's 1000 m/s² lid on a body's summed push (both added in
review), the lab's recorded Desert Combat MLRS, AIM-9 and AA-10 flights are
flown within 1% (§3a); the square deviation cone is what a human's rounds
show on the lab server (§7).

## 1. Every round falls by its own data

`gravityModifier` defaults to 1.0 and the physics body integrates it (ledger
IMP-7). The viewer used to pick gravity from the exporter's `kind` label
instead: `round-launch.js` gave a `kind: 'rocket'` round gravity 0, so the
artillery rockets that declare no modifier flew in a straight line.

Census of every projectile whose effective gravity changes, over the glb
extras of all five trees (`~/.cache/dc-sweep/rounds/census.py`), each one
checked against its `.con`:

| Tree | Round | Kind | Declared | Before | After |
|---|---|---|---|---|---|
| vanilla | `KatyushaRocket` | rocket | none | 0 | 1 |
| DC, DC Final | `KatyushaRocket`, `MLRSRocket`, `BM21_Rocket`, `SCUD-BRocket` | rocket | none | 0 | 1 |
| DC, DC Final | `Rocket_Maverick` | rocket | 0.1 | 0 | 0.1 |
| DC, DC Final | `Silkworm` | rocket | 1.0 | 0 | 1.0 |

Every other rocket (Hydra, Hellfire, AIM-9, AA-10, Magic II, AT-2, Stinger,
SA-3, DC Final's TOW) declares `gravityModifier 0` and is unchanged. XPack1 and
XPack2 have no rocket.

Measured with `tests/rocket_flight_harness.mjs` (the real `gunfire.js`, flat
ground, 2 m launch height). With the motor still the 25 m/s² placeholder (§3):

| Round | 45 deg before | 45 deg after | 30 deg after |
|---|---|---|---|
| `KatyushaRocket` | still climbing at 20 s, 1.67 km up | lands 469 m out | 266 m |
| `MLRSRocket` | still climbing at 20 s, 2.75 km up | lands 2.04 km out | 1.19 km |
| `BM21_Rocket` | still climbing at 20 s, 1.85 km up | lands 1.10 km out | 731 m |
| `SCUD-BRocket` | still climbing at 20 s, 4.50 km up | lands 3.83 km out | 1.60 km |

These were the ranges with gravity alone fixed; §3 has them on the real
motor.

## 2. Invisible rounds and tracers fall too

The exporter bakes an invisible round as `kind: 'bullet'` (`bf42/assemble.py`
`_projectile_spec`), and the viewer flew every bullet on the tracer path with
no gravity at all. Now `round-launch.js` `tracerGravity` picks the word that
applies and `projectile-flight.js` `advanceTracers` integrates it, turning the
streak down its path:

- a round between tracers is the gun's own projectile: `spec.gravity ?? 1`;
- a tracer round is the tracer template in flight, so it falls by the
  tracer's own `gravityModifier`. The exporter now writes it into
  `fireArms.tracer.gravity`, resolved to 1.0 when undeclared, and
  `extract_map.py` writes every round's declared `gravityModifier` into its
  `damage.json` row, so the damage layer alone brings a tracer's word to a
  glb baked before (that layer is seconds a tree; the glb route reaches 83 DC
  and 100 DC Final model glbs and nearly every level). Assets too old for
  either keep the old straight streak, which is right for retail's
  `Tracer_Projectile` (`gravityModifier 0.0`).

What changes, from the census (each checked against its `.con`):

| Tree | Round | Declared | Now |
|---|---|---|---|
| vanilla, XPack1, XPack2 | every other invisible round (rifles, MGs, aircraft guns) and `Tracer_Projectile` | 0 | unchanged |
| XPack2 | `CommandoKnifeThrowProjectile`, `EliteKnifeThrowProjectile` | none | falls at 1.0 (a thrown knife arcs) |
| DC, DC Final | `25mmChaingunProjectile` and its BMP-2 and M2A3 copies | 0.2 | falls at 0.2 |
| DC, DC Final | `CBU87Prj` (A-10C, AV-8C cluster) | none | falls at 1.0 |
| DC, DC Final | tracers `20mm_Tracer_Projectile` (and `_iraqi`), `50cal_Tracer_Projectile`, `Minigun_Tracer`, `Avenger_Tracer` | 1 | fall at 1.0 once re-extracted; the rounds between them declare 0 and fly flat |
| DC, DC Final | `mortarbomb`, `IEDbomb`, `PKMbomb` | none | 1.0, but `deployables.js` flies these itself |
| DC, DC Final | `Blank_Projectile` (MLRS `Blast`, DC Final Nimitz) | none | falls at 1.0; see Open, item 1 |
| DC, DC Final | `Guided_Tomahawk`, `PatriotGuidedRocket` | none | falls at 1.0; these are vehicles the firer rides, not rounds (WP5) |

Measured (`rocket_flight_harness.mjs`, level barrel, 0.5 s at 60 Hz, where
semi-implicit Euler at g = 1 drops 1.903 m): the BAR round and vanilla's
tracer, fresh or stale, drop 0 before and after; the 25 mm drops 0.381 m
(0 before); `CBU87Prj` 1.903 m (0 before) with the streak pitched 26 degrees
down its path; DC's 50 cal round 0 and its tracer 1.903 m.

## 3. A rocket flies on its own engine

`projectile-flight.js` gave every `kind: 'rocket'` round a flat 25 m/s²
(parity-audit P-2), with no top speed, and never read the baked `parts`.
Read on lnxded on 2026-10-06 (ledger PHY-18..PHY-22, physics.md section 5,
"A rocket is a round with an engine"):

- A projectile's `Engine` is stepped like a vehicle's: `Engine::handleUpdate`
  from the object update, `PhysicsEngine::updatePhysics` from the physics
  node manager after it, and the push lands on the round's own physics node
  (PHY-18).
- `c_ETRocket` (0x11) starts itself and pins its throttle input to 1.0. Its
  revs follow the gearbox on the servo's `T1` against the load its own push
  feeds back, and it pushes with the aircraft's law,
  `fwd * (0.1|revs| + e|e|) * 3.5 * differential / 0.94` with
  `e = revs - rho (v.fwd) / noPropellerEffectAtSpeed`. Below the water level it
  stops (PHY-19, PHY-20).
- A full body (`setHasPointPhysics 0`) also takes its children's torque and
  drags by the box law on its own geometry's box; a point body takes the
  linear push only and never turns (PHY-21, PHY-22).

Built:

- `viewer/rocket-motor.js` is the motor: `isAirMotor` picks the Engine parts
  that push a round through the air (bit 0 and bit 4 set, bit 3 clear: in the
  shipped data exactly `c_ETRocket`), and `RocketMotor.tick` runs the servo,
  the gearbox and the thrust on the engine's own 30 Hz tick, holding the push
  between ticks, so the spool-up is the engine's at any frame rate.
- `round-launch.js` gives a round its motors, its drag box (measured off the
  drawn body once per group) when it is a full body, and, for a point body,
  the launch axis it will push along for good.
- `projectile-flight.js` `pushMotors` and `boxDrag`. The nose of a full body is
  held on its flight path, which is the tail `Wing`'s work in the engine (see
  Open, item 2), so the push is along the velocity and the box law reduces to
  its frontal ellipse. Projected onto the drawn mesh, a frame behind the path,
  the law put a sliver of the flow on the long side faces and moved a 45
  degree MLRS landing by 5% between 30 and 144 Hz.

The box law now also flies the bombs and the aircraft torpedo in the air,
which declare `setHasPointPhysics 0` too. A Stuka bomb dropped at 150 m/s from
500 m lands 1211 m out instead of 1229 m (`test_bomb_release.py`).

Measured (`rocket_flight_harness.mjs`, 2 m launch height, flat ground):

| Round | 30 deg | 45 deg | top speed at 45 deg | placeholder, 45 deg |
|---|---|---|---|---|
| `KatyushaRocket` (vanilla) | 229 m | 481 m | 112 m/s | 469 m |
| `MLRSRocket` | 807 m | 1313 m | 141 m/s | 2043 m |
| `BM21_Rocket` | 595 m | 952 m | 120 m/s | 1102 m |
| `SCUD-BRocket` | 1519 m | 4057 m | 372 m/s | 3830 m |

The landing moves by 0.3% between 30, 60 and 144 Hz.

The motor-carried rounds that declare `gravityModifier 0`, flown level 60 m
up for their life (the viewer caps a round at 20 s):

| Round | Launch | 1 s | 5 s | 10 s | Body | Placeholder at 10 s |
|---|---|---|---|---|---|---|
| `HydraRocket` | 150 | 112 | 137 | 137 | full | 92 |
| `HellfireRocket` | 350 | 80 | 82 | 82 | full | 29 |
| `Aim9` | 350 | 167 | 104 | 101 | full | 177 |
| `AA-10` | 500 | 114 | 70 | 70 | full | 99 |
| `Rocket_MagicII` | 300 | 228 | 265 | 266 | full | 319 |
| `AT2Rocket` | 350 | 16 | 16 | 16 | full | 23 |
| `StingerMissile` (1.3 s) | 300 | 286 | | | point | 305 |
| `SA-3Rocket` (1.3 s) | 250 | 237 | | | point | 274 |
| `DefenderTOW` (DC Final) | 150 | 189 | 515 | 817 | point | 400 |

Speeds in m/s. Every full body finds a top speed. The Hellfire (`drag 2`,
`mass 5`), the AA-10 and the AT-2 (whose `Rocket_AT2` box is 1.44 x 1.46 m
across) find a slow one: their authored drag over their geometry outweighs
the motor. The placeholder slowed them too, under the point body's sphere law.
The TOW is a point body of 500 kg at `drag 0.1`, so only the thrust law
limits it, at about 1.5 km/s.

### 3a. Checked against the lab's recordings (review, 2026-10-07)

The lab's Desert Combat rounds (`~/bf1942-lab/runs/*dc-*`,
`features/desert-combat-parity/lab-ground-truth.md`) caught three
motor-carried rounds in flight: 25 MLRS rockets on Bocage, 53 AIM-9s and 7
AA-10s. The server recorder writes each round's position every tick, so its
speed is a tick's displacement times 30. Flown in the harness as they were
launched, the section 3 laws missed in two places, both now fixed:

- **The drag box is the round's `.sm` header box**, not the drawn body's
  extent (ledger COL-14, which the air-flight review read the same day:
  `getBoundingBox` returns what `loadHeader` read from the file). The two differ on five of Desert Combat's eight full-body rockets,
  most on the AT-2 (drawn 1.44 m across, header 0.25 m), the Hydra (0.24 m
  square, header 0.11 m) and the AIM-9 (0.45 m tall, header 0.64 m), because
  the drawn body is often a `visibleDummyProjectileTemplate`. `assemble.py`
  `_geometry_box` writes the header box as the projectile's `box`, and
  `round-launch.js` uses it; a glb baked before falls back to the drawn
  body. The AIM-9 had come out 18% fast at its top speed on the drawn box.
- **A full body's summed push is held to 1000 m/s²** (ledger COL-8, already
  read for vehicles in collision-response.md §4.2; the rounds had not
  honoured it). An AA-10 leaving a MiG-29 at 520 m/s loses exactly 33.3 m/s
  a tick for five ticks before its drag falls under the lid. Without it the
  AT-2's box law at 30 Hz reversed the round and ran it away to 4e11 m/s.

With both, the viewer against the recordings (m/s, `test_rocket_flight.py`
`RECORDED`, the recorded speed taken a tick past each mark so the two
launches line up):

| Round | Launch | 0.5 s | 1 s | 2 s | 3 s | 5 s | 10 s |
|---|---|---|---|---|---|---|---|
| `MLRSRocket`, recorded | 100 m/s, 13.6 deg up | 88.5 | 91.3 | 101.3 | 108.9 | | |
| viewer | | 88.5 | 90.7 | 100.8 | 108.6 | | |
| `Aim9`, recorded | 512 m/s off an F-15C | 219.2 | 153.0 | 109.8 | 95.4 | 87.9 | 86.2 |
| viewer | | 218.0 | 151.6 | 109.2 | 95.4 | 87.8 | 86.3 |
| `AA-10`, recorded | 520 m/s off a MiG-29 | 179.6 | 118.1 | 84.3 | 75.0 | 70.9 | |
| viewer | | 178.8 | 117.1 | 84.1 | 75.0 | 71.0 | |

The MLRS's dip to 88 m/s and climb to 109 is the motor spooling up against
the drag, which no fixed ramp gives: on `main`'s placeholder (25 m/s², no
gravity) the same launch is at 108 m/s by 0.5 s and 142 by 3 s, and still
climbing, 937 m up, at 20 s. So the motor law (PHY-20) is the engine's.

What the motor-carried rounds of section 3's table fly once their glbs carry
the header box (level, 60 m up; m/s at 1, 5 and 10 s): Hydra 174, 280, 281;
Hellfire 82, 83, 83; AIM-9 137, 87, 86; AA-10 118, 71, 70; Magic II 229, 267,
268; Maverick 162, 179; AT-2 107, 105, 105. The Hellfire's 83 m/s is not a
bad read: its header box is its drawn box, and `drag 2` over `mass 5` is 16
times the AIM-9's drag per kilogram, which the recordings show the law is
right about. No Hellfire, Hydra, AT-2, Stinger or Katyusha was fired in a
recorded round.

The lab's TOW and AT-5 (`TOW_Projectile`, `BMP2_AT4_Projectile`, straight at
100 m/s) carry no Engine in Desert Combat 0.7, and this package does not
touch them. DC Final's `DefenderTOW`, which does, is a point body and was not
recorded. The lab page's Spandrel "191.3, not 200": both recorded Spandrels
leave at 200.4 and 201.1 m/s relative to the BRDM-2 that fired them, which
was reversing at 9 m/s in the 191.3 case (`addRootSpeed`, default 1, adds
the firer's velocity in `FireArms::fireBarrel`); FA-3's 200 stands.

## 4. A gun that declares no velocity

`bomb-release.js` `releaseSpeed` and `round-launch.js` `spawnTracer` launched a
`FireArms` that declares no `velocity` at an invented 100 m/s. Both
`FireArmsTemplate` constructors write 200.0 (ledger FA-3), so that is the
default now; an authored 0 (every aircraft rack, BOMB-8) is still 0. It moves
every `Binoculars` round and Desert Combat's BRDM-2 Spandrel.

## 5. A round bursts at the end of its life only if it says so

The viewer burst every `damageType` 1 or 4 round when its `timeToLive` ran out
(the adversarial sweep's CW4). `Projectile::handleMessage` (`0x0831e8f0`)
answers the expiry with `detonate` only when the template sets
`hasOnTimeEffect`, and with a silent `resetProjectile` otherwise; the
constructor's default is 0 (ledger PROX-7). So Desert Combat's Shilka shell,
which writes `hasOnTimeEffect 0` after DC took its proximity fuse out, put its
flak airbursts back in the viewer.

Built: `con.py` parses the word; `assemble.py` carries it in the damage block
when declared; `extract_map.py` `projectile_materials` writes it resolved into
every row of `damage.json`'s projectile table; `round-launch.js`
`onTimeEffectOf` reads it, and `projectile-flight.js` recycles a round whose
assets say 0, with no effect and no splash. Assets too old to carry it keep
the old burst.

Census of the archives (`~/.cache/dc-sweep/rounds/ontime_census.py`):
vanilla 23 `damageType` 1/4 rounds lose their expiry burst (every tank, naval
and artillery shell, the three bombs, the Katyusha, and `AA_POW_Projectile`
and `YamatoProjectile`, which keep their proximity fuse); XPack1 6, XPack2 9,
Desert Combat 46 (the Shilka, Sabot, the AC-130 howitzer, Spandrel,
`SA3RocketProjectile`, ...), DC Final 36. Vanilla's grenades, pack, landmine
and `AA_Allies` / `Flak38` shells set the word and still burst.

Measured (`rocket_flight_harness.mjs`, fired 80 degrees up at three fuse
rolls): `AA_Allies_Projectile` bursts at 240, 325 and 420 m and
`Flak38_Projectile` at 240, 295 and 355 m, before and after; the Shilka shell
burst 983 m out before and now vanishes with no record.

## 6. The CBU-87

An A-10C's or AV-8C's cluster pull is two guns on `c_PIAltFire`:
`A10_CBU87Dummy` drops the drawn canister (`CBU87DummyPrj`, 1 s, which bursts
into its shell halves through `hasOnTimeEffect 1` and carries the
`e_CBU87Emission2` bomblet emitter as its trail), and `A10_CBU87` fires the
fourteen invisible `CBU87Prj` submunitions, one per barrel, each down its own
`addFireArmsPosition 0/0/0 <yaw>/<pitch>/0` turn at 15 m/s on top of the jet,
from a dispenser pitched 20 degrees down.

- With §2 they fall. Measured (`rocket_flight_harness.mjs`, an A-10C at
  100 m/s, 150 m up): all fourteen land, each within 1.6 m of where its own
  barrel and gravity put it, in a pattern 38 m across and 74 m along track,
  473 m past the release. Before, none of them ever landed.
- `e_CBU87Emission2` was missing from Desert Combat's and DC Final's
  `effects.glb`. Its `Fx_CBU87bomb` names its mesh inline,
  `geometry StandardMesh:DesertCombat/Bomb_CBU87/CBU87bomb_m1`, and the reader
  looked the path up as a template name. `GeometryTemplateManager::getTemplate`
  (lnxded `0x0838b1e0`) splits a name it does not know at the ':' and makes a
  template of that type with the file after it; `con.py`
  `ObjectLibrary.geometry` now does the same when no template has the bare
  name (a declared one still wins, so vanilla's shell casings, which use the
  same form for declared templates, are unchanged). Extracted into scratch:
  DC's bake gains exactly that one bundle (216 -> 217, nothing else moves),
  DC Final's likewise (248 -> 249), vanilla's is identical.

## 7. The deviation cone is a square of hundredths of a radian

`round-launch.js` turned every round into a disc of `total` degrees. Ledger
DEV-9 (the hand-weapons package's read, re-checked here in
`FireArms::fireBarrel` lnxded `0x0828aba0`: the `0.01 <` gate on
`FireArms+0x188`, the two 2^-24 draws scaled to (-total, +total], and
`velocity / 100.0` at `0x0828baa4`, `d8 f2`) says the engine adds a lateral
velocity of `u * total * velocity / 100` on each of the launch frame's up and
right axes. `deviate` now does that: a muzzle-launched round uses the muzzle's
own axes, a camera-launched one the axes built from its line and world up.

Measured (`rocket_flight_harness.mjs`, 4,000 rounds of a level 1,000 m/s gun):

| Cone | Reach per axis | rms per axis | Corner share | Before (disc) |
|---|---|---|---|---|
| 1 | 0.573 deg | 0.33 deg | 0.04 | 1.0 deg, rms 0.50, corners 0 |
| 3 | 1.718 deg | 1.00 deg | 0.04 | 3.0 deg, rms 1.50, corners 0 |

Every gun in every mod is 1.75 times tighter on each axis than it was, and
square. A round that deviates is fractionally faster (1000.9 m/s in a cone-3
corner), as in the game. The bots roll their own cone in degrees
(`bot-referee.js` `rollCone`, `bot-rounds.js`); that copy is the bots
package's. The HUD cross's size is read from the same total and was not
touched.

**Checked against the real game (review, 2026-10-07).** The lab server's
recordings carry every `fireBarrel` call's matrix (`f`, its row 2 before any
deviation) and the round's position each tick, so a round's flight direction
against `d` is its deviation, plus the firer's velocity (`addRootSpeed`),
which the soldier's own samples give. The owner's 38 StG44 rounds in
`20261005-070852-parity-elalamein-rec`, fired running (6 m/s, so a saturated
speed channel) in bursts, against the total DEV-1's channels predict for
each shot (`setMinDev 0.75`, `setSpeedDev 2.25`, the fire channel's bloom):
all 76 per-axis values lie inside the square of `total` hundredths of a
radian (the largest 0.98 of it), with a mean square of 0.25 `total`²
against the square's 0.33. A disc of `total` degrees would have put about a
third of them outside. Bots are different: within a bot's burst the rounds
differ from the one before by a median 0.05 to 0.07 hundredths of a radian
(the recorder's rounding), whatever the cone; see Open item 9.

## Assets

Nothing in §1, §3 and §4 needs a re-extract: the rockets' `parts`, `mass`,
`drag` and `hasPointPhysics` were already baked. The rest:

- **The damage layer, every tree** (`hasOnTimeEffect` for §5, a tracer's
  `gravityModifier` for §2): `patch_scene.py --layer damage --mod <M> --all`
  for `bf1942`, `XPack1`, `XPack2`, `DesertCombat` and `DC_Final` (checked on
  a scratch copy of DC's El Alamein), then `publish-mesh-delta.py maps --hash`.
- **The effects library, DC and DC Final** (§6):
  `extract_effects.py --mod DesertCombat --out viewer/maps/mods/desertcombat/_shared`
  and the same for `DC_Final` into `viewer/maps/mods/dc_final/_shared`, then
  publish.
- **The models and levels that carry a full-body round, every tree** (§3a,
  the projectile's `box`): Desert Combat's and DC Final's rocket and bomb
  carriers move (the AT-2, Hydra, AIM-9, MLRS and Maverick boxes change);
  vanilla's Katyusha, bombs and torpedoes, and XPack2's, carry the word but
  their header boxes are their drawn ones. Until then the viewer flies the
  drawn box, as before.
- Optional: the glb words (`fireArms.tracer.gravity`, the damage block's
  `hasOnTimeEffect`) ride the next model and level bakes; the damage table
  already carries both.

## How it is checked

`tools/bf1942-models/tests/test_rocket_flight.py` runs
`rocket_flight_harness.mjs` through the real `gunfire.js` under node: the four
artillery rockets at 30 and 45 degrees, the landing at 30, 60 and 144 Hz, the
motor alone tick by tick, every motor-carried round of Desert Combat level
for its life, the invisible rounds and tracers, the flak and Shilka shells'
expiry, and one A-10C CBU pull. `RoundsMatchTheTrees` checks the harness's
copies of the rounds and the CBU barrels against the shipped glbs when they
are extracted on the machine. `test_assemble.py` pins the tracer's gravity and
`hasOnTimeEffect` in the exporter, `test_collision.py` the damage table's rows,
`test_con.py` the inline geometry form, `test_bomb_release.py` the bomb under
the box law. The effects bakes were extracted into scratch and compared with
the live trees' reports (§6).

## Open

1. `hasCollisionPhysics 0` is not honoured for rounds. `Blank_Projectile`
   (the MLRS's `Blast` gun, DC Final's Nimitz) declares it, and in the engine
   it meets nothing; here it is swept like any round, and now that it falls
   it can meet the ground in front of the launcher. `con.py` parses only the
   `setHasCollisionPhysics` spelling, not the projectile's
   `hasCollisionPhysics`, so the exporter never carries it.
2. **The tail wing is inferred, not read.** A full body's nose is held on its
   flight path, as if its `Wing` weathervaned it at once, and the wing's lift
   is taken as zero at zero incidence. The engine flies the round as a rigid
   body: `PhysicsWing` (client `0x0057fbf0`) pushes at the wing's own position
   behind the centre of mass, with the inertia `PhysicsNode` gives the round.
   A real round in a gravity turn will trail its nose above the path, carry a
   little incidence, and so a little lift and a little side-face drag. Reading
   the round's inertia and the wing's moment would settle how much.
3. Checked against the game for the MLRS, the AIM-9 and the AA-10 (§3a).
   The Hellfire, Hydra, AT-2, Stinger, SA-3, Maverick, Magic II, DC Final's
   `DefenderTOW` (a point body, 817 m/s at 10 s) and vanilla's Katyusha were
   not fired in a recorded round; a lab round with bots in AH-64s or Mi-24s at
   AI LOD 0 would give the first three.
4. The torpedo's water run (`viewer/torpedo-run.js`, plane-bombs-and-torpedoes)
   thrusts with its throttle at 1.0. PHY-19 says the revs are pinned to 1.0
   only when a `c_ETTorpedo` is out of the water; under it, as for the rocket,
   they follow the gearbox against the load (PHY-20). That would bring its
   158 m/s terminal speed down. PHY-18 also answers the file's open "whether a
   Projectile's child Engine is stepped at all": it is.
5. LOOP-1: the gearbox's 0.05 is per tick and the motor runs at the client's
   30 Hz. If the server ticks at 60 Hz, a server-side rocket spools twice as
   fast.
6. Desert Combat's `Silkworm` has a `c_ETRocket` and a `c_ETTorpedo`, two wings
   and four floaters. The rocket flies it in the air; nothing here makes it
   skim the sea.
7. The CBU canister's bomblet emitter starts 0.9 s after release and emits for
   0.5 s, but the canister bursts at 1.0 s, and the viewer stops a round's
   attached bundle when the round ends, so a tenth of a second of bomblets is
   drawn. Whether the engine keeps a detonated round's child bundle running
   (`stopAtEndEffect 0`, `invisibleAtEndEffect 0`) is not read.
8. Desert Combat's `e_ExplAni01_m_dirt` and `_sand` still lose their
   `Em_dirtgibb*_m` emitters in the effects bake; not the inline-geometry gap
   (the census finds the form only on the CBU in DC), not looked at further.
9. **A bot's rounds on the server do not scatter.** Within a burst each of a
   bot's rounds differs from the one before by a median 0.05 to 0.07
   hundredths of a radian in every recorded round (2,000-odd pairs, vanilla
   and DC; the human's StG44 scatters over the whole square):
   the deviation is there, but it is the same point of the square shot after
   shot, scaled by the total. `fireBarrel` seeds its draw from
   `Game::getCurrentInputIndex` (`Game+0x68`) plus the barrel, and
   `GameServer::simulatePlayerUpdate` (`0x0815bd72`, `0x0815bef9`) sets that
   from the player's action buffer, which for a bot looks never to advance
   (inferred: the writer of a bot's buffer was not read). The viewer's bots
   roll a fresh disc per shot (`bot-referee.js` `rollCone`), the bots
   package's.
