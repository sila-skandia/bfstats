# Rocket flight: gravity, the motor, and where a round lands

Status: built 2026-10-06 (Desert Combat parity round, package `rounds`).
Every round, drawn or invisible, falls by its own `gravityModifier` (§1, §2),
and a rocket flies on its own `Engine` and the box drag law, both read from
the server binary (§3, ledger PHY-16..PHY-20). Not checked against the real
game: see Open.

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
  `fireArms.tracer.gravity`, resolved to 1.0 when undeclared. A glb baked
  before that carries none and keeps the old straight streak, which is right
  for retail's `Tracer_Projectile` (`gravityModifier 0.0`).

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
Read on lnxded on 2026-10-06 (ledger PHY-16..PHY-20, physics.md section 5,
"A rocket is a round with an engine"):

- A projectile's `Engine` is stepped like a vehicle's: `Engine::handleUpdate`
  from the object update, `PhysicsEngine::updatePhysics` from the physics
  node manager after it, and the push lands on the round's own physics node
  (PHY-16).
- `c_ETRocket` (0x11) starts itself and pins its throttle input to 1.0. Its
  revs follow the gearbox on the servo's `T1` against the load its own push
  feeds back, and it pushes with the aircraft's law,
  `fwd * (0.1|revs| + e|e|) * 3.5 * differential / 0.94` with
  `e = revs - rho (v.fwd) / noPropellerEffectAtSpeed`. Below the water level it
  stops (PHY-17, PHY-18).
- A full body (`setHasPointPhysics 0`) also takes its children's torque and
  drags by the box law on its own geometry's box; a point body takes the
  linear push only and never turns (PHY-19, PHY-20).

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

## How it is checked

`tools/bf1942-models/tests/test_rocket_flight.py` runs
`rocket_flight_harness.mjs` through the real `gunfire.js` under node: the four
artillery rockets at 30 and 45 degrees, the landing at 30, 60 and 144 Hz, the
motor alone tick by tick, every motor-carried round of Desert Combat level
for its life, and the invisible rounds and tracers. `RoundsMatchTheTrees`
checks the harness's copies of the rounds against the shipped glbs when they
are extracted on the machine. `test_assemble.py` pins the tracer's gravity in
the exporter, `test_bomb_release.py` the bomb under the box law.

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
3. **Nothing here is checked against the game.** The laws are read; what they
   add up to on Desert Combat's data (a Hellfire at 82 m/s, an AT-2 at
   16 m/s, a TOW past 800 m/s) has not been watched in DC. Vanilla's Katyusha
   (481 m at 45 degrees, 229 m at 30) can be: a lab recording of a Katyusha
   salvo on a known launcher pitch (skill `bf1942-server-lab`) would check the
   gravity, the motor and the drag at once.
4. The torpedo's water run (`viewer/torpedo-run.js`, plane-bombs-and-torpedoes)
   thrusts with its throttle at 1.0. PHY-17 says the revs are pinned to 1.0
   only when a `c_ETTorpedo` is out of the water; under it, as for the rocket,
   they follow the gearbox against the load (PHY-18). That would bring its
   158 m/s terminal speed down. PHY-16 also answers the file's open "whether a
   Projectile's child Engine is stepped at all": it is.
5. LOOP-1: the gearbox's 0.05 is per tick and the motor runs at the client's
   30 Hz. If the server ticks at 60 Hz, a server-side rocket spools twice as
   fast.
6. Desert Combat's `Silkworm` has a `c_ETRocket` and a `c_ETTorpedo`, two wings
   and four floaters. The rocket flies it in the air; nothing here makes it
   skim the sea.
