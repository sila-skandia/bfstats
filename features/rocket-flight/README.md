# Rocket flight: gravity, the motor, and where a round lands

Status: gravity built 2026-10-06 (Desert Combat parity round, package
`rounds`). Every round, drawn or invisible, falls by its own
`gravityModifier`.

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

These ranges are only as good as the motor (§3).

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

## How it is checked

`tests/test_rocket_flight.py` runs the harness. `RoundsMatchTheTrees` checks the
harness's copies of the rounds against the shipped glbs, when they are
extracted on the machine.

## Open

1. `hasCollisionPhysics 0` is not honoured for rounds. `Blank_Projectile`
   (the MLRS's `Blast` gun, DC Final's Nimitz) declares it, and in the engine
   it meets nothing; here it is swept like any round, and now that it falls
   it can meet the ground in front of the launcher. `con.py` parses only the
   `setHasCollisionPhysics` spelling, not the projectile's
   `hasCollisionPhysics`, so the exporter never carries it.
