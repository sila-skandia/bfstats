# A hull's box is its body, not the round parked on its gun

2026-11-12. Found screening Galactic Conquest for bots: on GC_BCanyon a
20-second headless match (`--bots 16`) did not finish in seven minutes
(`sim/run.mjs`, 86 % of one core, no trace written).

## Cause

A profile (`node --prof`) put half the time in `Math.hypot` under
`nav-search.js stepLocalSearch`: `cellOpen` testing every cell against
every obstacle a bot holds.

The obstacles came from one hull. `bot-units.js localBox` measures a hull's
box over every mesh under its node. GCMOD's two gunships (`RepGun`,
`ImpGunship`) carry `GunShipBubbleLaser2 projectile`, the
`LaserSightProjectile` template's mesh, parked on each bubble gun: a beam
9,200 m long. The exporter marks it `userData.projectileMesh` (the mark
`idle-vehicle.js IDLE_PAYLOAD_KEYS` hides on an idle vehicle), but the box
counted it:

    box  min [-7.9, -3.4, -9201.8]  max [7.7, 3.5, 7.3]

`bot-route.js avoidBodies` gave that hull a radius of half its diagonal,
4.6 km, and `subSpheres2d` cut it into `round(9209 / 15.7)` = 587 spheres
of 15.7 m. Every soldier on the level predicted a collision with it, planted
the 587 circles, and searched its routes through them.

`hull-bodies.js` measured the same union for the distance a player may enter
a hull from (`reachR`), which made a gunship's reach the whole level.

## Fix

Both measures leave out a mesh that is, or hangs under, a node marked
`userData.projectileMesh`: a round's template (shell, bomb, beam) is the
weapon's round, not the hull's body. Nothing else is left out: flashes,
tracers and trails stay in, because leaving those out moves two vanilla
hulls and several hundred mod hulls (measured below) and was not needed.

Test: `tests/test_bot_units_ai_of.py`
(`test_a_rounds_template_mesh_is_not_the_hulls_box`,
`test_a_barrel_is_still_in_the_box`).

## What it moves

Measured over every model glb in the local mirror and the local mod trees
(a script unioning each node's accessor bounds with and without the marked
nodes):

| Rule | Models whose box changes by more than 1 cm |
|---|---|
| leave out `projectileMesh` (the fix) | vanilla 0; GCMOD 24; FHSWEurope 84; BF1918 17; Desert Combat 12; EoD 7; FHSW 7 |
| leave out every payload mark | vanilla 5; several hundred in each mod |

The largest: the two gunships (9,192 m), FHSW's `Soryu` (48 m), submarines
(4 to 29 m). The rest are under 3 m: a shell at a muzzle, a rocket on a
rail.

DICE's levels do not move: Kharkov, Bocage and Berlin with vehicles, 16
bots, seed 1, 300 s, trace hashes identical before and after.

GC_BCanyon after: a 120 s match at 16 bots in 57 s of wall time.

Eight live generated levels place a hull whose box shrinks (Desert Combat's
`Minigun` 0.55 m, `BM21`, `SCUD-B`, `SA-3`; BF1918's `PomPom_Static`,
`LePrieurRaketenBase`; FHSWEurope Aberdeen's tanks): DC_Battle_of_73_Easting,
DC_LostVillage, DC_Oil_Fields, DC_Urban_Siege, Inshallah_Valley,
hindenburg_line, roye and FHSWEurope's aberdeen. Each got a page match
on the fix (`page-matches.md` section 6): five passed it, DC_LostVillage
and DC_Oil_Fields failed it and passed the next, and roye failed for the
second time that day and lost its tag (it was failing before the fix).

## Left open

- Whether a player could in fact board a gunship from across GC_BCanyon
  before the fix was not checked in the page; the reach radius says so.
- `subSpheres2d` has no cap on the count of spheres. Retail's
  `getSubSpheres2d` has none either; with a true box the count is small.
