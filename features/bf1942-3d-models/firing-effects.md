# Firing effects: game-data ground truth and viewer fidelity

Findings from the 2026-09-13 investigation into "muzzle flash too big" and "the
Katyusha fires lines instead of rockets", verified against the vanilla
`Objects.rfa` / `standardMesh.rfa`, plus the design that fixed it. Code:
`bf42/con.py`, `bf42/assemble.py`, `viewer/index.html` (gun-fire section).

## How the game defines a shot

Every FireArms template names a `projectileTemplate`. Projectiles come in three
shapes, and the difference is entirely data-driven:

- **Bullets** have no geometry and are invisible in flight. Visibility comes
  only from `setTracerTemplate <tpl> CRD_NONE/<interval>/0/0`: every
  `interval`-th round spawns the tracer template instead. The tracer is a real
  mesh — `TLight_m1`, 0.006 x 0.006 x 1.0 m — stretched by `tracerScaler`
  (50 for vanilla MGs). Between tracer rounds the game draws nothing.
  Example: `SpitfireGuns`, 400 m/s, 12 rps, tracer every 3rd round; the
  `SpitfireProjectile` geometry line is rem'd out in the shipped data.
- **Shells** have geometry and fly it: `ShermanProjectile` is `projectile_m1`
  (0.115 x 0.115 x 0.48 m), ttl 10 s, trail `e_PanzShootTrail` via
  `addTemplate`. 100 m/s, gravity applies.
- **Rockets** are shells with a child Engine of `setEngineType c_ETRocket` —
  they accelerate after launch. `KatyushaRocket`: geometry `r_rocket_m1`
  (0.27 m dia x 2.04 m), ttl 20 s, mass 20, muzzle velocity only 45 m/s,
  looping smoke trail from `startEffectTemplate e_KatyushaFume` (puffs
  0.4-1.2 m at ~100/s). The engine draws the
  `visibleDummyProjectileTemplate` (`KatyushaRocketDummy`, same mesh) on
  clients — prefer it when present.

Muzzle flashes are EffectBundles of emitters. Two properties matter beyond the
size/colour ramps:

- Additive blending (`destBlendMode BMOne`) marks *bright* elements but also
  additive muzzle **smoke** — e.g. `Em_MuzzPanz_WSmoke` grows 0.8 -> 3.6 m
  over 0.5 s at 40% -> 0 alpha. The real flash elements peak at 0.66-0.69 m.
- Emitters move: `positionalSpeedInDof` / `relativePositionInDof` push smoke
  and flare backward along the barrel (Sherman WSmoke -5 m/s, Flare -5,
  Flash -1). Parked at the muzzle they read several times too large.
- Mesh-flash ramps are relative and large: `fx_MuzzHeavy` (1.76 m mesh) ramps
  `0/0.12 | 100/9.4` — replayed as absolute node scale that is a 16.5 m
  terminal flash.

## What the viewer got wrong (pre-fix)

- `assemble.py` exported the projectile as a name string only; the viewer
  never read it and fired tracer cylinders for every weapon with
  `velocity > 0`, plus an invented dim streak on every non-tracer round.
  Rockets and shells therefore rendered as faint 2 m streaks (the reported
  Katyusha bug).
- Tracer cylinders were 0.03 m radius (10x the game's) on every round.
- The additive-blend filter baked muzzle smoke as flash, parked at the muzzle
  (emitter motion was not parsed), and size ramps replayed unclamped.

## The fix (implemented)

Data pipeline:

- `con.py` parses `visibleDummyProjectileTemplate`, `startEffectTemplate`,
  `gravityModifier`, `setEngineType`, `positionalSpeedInDof`,
  `relativePositionInDof` (CRD and bare spellings).
- `assemble.py` resolves the projectile chain and emits a typed dict:
  `{template, kind: bullet|shell|rocket, timeToLive, gravity, trail}`.
  Typing rule: no geometry -> bullet; geometry -> shell; geometry + child
  engine `c_ETRocket` -> rocket. The drawn body (dummy template preferred) is
  baked as a hidden `projectileMesh` node under the FireArms node, and the
  trail's longest-lived sprite spec rides along (`projectileTrail`). Emitter
  extras now carry `offsetInDof` / `speedInDof`.

Viewer (`fireShot` / `advanceFire`):

- Branch on `projectile.kind`. Bullets: tracer only on tracer rounds, nothing
  between; radius slimmed to 0.01 m. Shells/rockets: clone the baked mesh
  from a pool, fly at real speed below 150 m/s (`PROJECTILE_SCALE_CUTOFF`, so
  45 m/s rockets read correctly), gravity drop for shells, `ROCKET_ACCEL`
  ramp for rockets, pooled billboard trail puffs every 0.9 m (cap 96),
  recycle on ttl or the 250 m range cap.
- Flash: emitters drift along the muzzle DOF by
  `offsetInDof + speedInDof * age`; ramp scale clamped at
  `FLASH_RAMP_MAX = 3`.
- Manifests that still carry a string projectile fall back to the old streak
  behaviour, so stale GLBs keep working.

Open question (not blocking): for sprites declaring both `size` and
`sizeOverTime` (e.g. `Fx_MuzzPanz_Flash`, size 0.3 + ramp peak 0.66) the
engine may multiply rather than treat the ramp as absolute; if so those
sprites overshoot ~3x even after the clamp. Settle against the
`features/bf1942-engine-reference` corpus if flash size still looks off.

Tests: `tests/test_con.py` (new-command parsing), `tests/test_assemble.py`
(`ProjectileBakeTests`, `EmitterMotionBakeTests`, bullet/shell/rocket typing).

## 2026-09-25: `poses.html` firing gap re-checked — the data is already there

Investigated the corpus-sweep backlog item "Hand weapons in `poses.html`: no
muzzle nodes, no `GunFire` import". The muzzle-node half is stale: every
`.pose.glb` `poses.html` loads already carries a `<Weapon> muzzle N` node
(`templateKind: Muzzle`) and a `HandFireArms` node stamped with a full
`fireArms` extras block (`roundOfFire`, `magSize`, `numOfMag`, `velocity`,
`projectile`, `muzzles`) — verified directly on
`viewer/models/poses/GermanSoldier__K98.pose.glb`. That is exactly the
`obj.userData.fireArms` shape `gun-groups.js`'s `collectGroups()` scans for,
and `gunfire.js`'s `GunFire` needs only `{scene, camera}`, which `poses.html`
already exposes at module scope. The remaining gap is UI wiring only:
`poses.html`'s inline script never imports `GunFire` or `model-guns.js`'s
`createGunTriggers` — the same lightweight pattern `index.html` already uses
for its stationary-model turntable guns (not the heavier bot-oriented
`hand-fire.js` / `hand-weapon.js` / `arms-rig.js` stack `map.html` uses for
soldiers in the world). Re-scoped from **M** to **S**: import
`GunFire`/`createGunTriggers`, call it on `current` after each model load
(`poses.html:215-239`), step it in the render loop (`poses.html:250-273`),
add a fire trigger. See `features/bf1942-corpus-sweep-2026-09-18/README.md`
for the tracked backlog row.
