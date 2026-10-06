# Rocket flight: gravity, the motor, and where a round lands

Status: gravity built 2026-10-06 (Desert Combat parity round, package
`rounds`). Every round falls by its own `gravityModifier`.

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
ground, 2 m launch height). With the motor still the 25 m/s² placeholder (§2):

| Round | 45 deg before | 45 deg after | 30 deg after |
|---|---|---|---|
| `KatyushaRocket` | still climbing at 20 s, 1.67 km up | lands 469 m out | 266 m |
| `MLRSRocket` | still climbing at 20 s, 2.75 km up | lands 2.04 km out | 1.19 km |
| `BM21_Rocket` | still climbing at 20 s, 1.85 km up | lands 1.10 km out | 731 m |
| `SCUD-BRocket` | still climbing at 20 s, 4.50 km up | lands 3.83 km out | 1.60 km |

These ranges are only as good as the motor (§2).

## How it is checked

`tests/test_rocket_flight.py` runs the harness. `RoundsMatchTheTrees` checks the
harness's copies of the four rounds against the shipped glbs, when they are
extracted on the machine.
