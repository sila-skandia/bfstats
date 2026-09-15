# Impact effects: the game's own bursts, holes and trails

Closes the "play" half of gap **M-1**, gap **M-3** (decals), and the trail half
of the projectile picture from
[`projectile-collision.md`](projectile-collision.md), for the Thompson and the
Bazooka first. Before this a hit was *named* — `RichoStoneDecal`,
`BazookaCascadesStone` — and a tinted disc marked it. Now the named bundle
plays: the ricochet burst, the dirt or grit, the bullet hole that stays and
fades, the rocket's smoke line and the explosion.

Engine reading, with every address:
[`../bf1942-engine-reference/subsystems/projectiles-and-impacts.md`](../bf1942-engine-reference/subsystems/projectiles-and-impacts.md);
ledger rows IMP-1..7, CRD-1, EMT-1..5.

Code: [`bf42/effects.py`](../../tools/bf1942-models/bf42/effects.py) (spec),
[`extract_effects.py`](../../tools/bf1942-models/extract_effects.py) (bake),
[`viewer/effects-core.js`](../../tools/bf1942-models/viewer/effects-core.js)
(arithmetic, no three.js), [`viewer/effects.js`](../../tools/bf1942-models/viewer/effects.js)
(player), hooks in `gunfire.js` and `map.html`. Tests: `tests/test_effects.py`
(+ `effects_harness.mjs`).

---

## What the game does, in one paragraph each

**The hit picks a bundle.** `MaterialManager.setEffectTemplate` per (attacker
material, defender material); the attacker is the *projectile's* `material`
(216 for every SMG round, 226 for the bazooka), the defender the struck face's
byte or the terrain id. A Thompson round into the Wake bunker (material 93,
reinforced concrete) is `RichoStoneDecal`; onto sand `e_richoGround`; into
water `e_RichoWater`. The bazooka gets `BazookaCascadesStone` — the explosion
plus concrete debris.

**The bundle stands on the normal.** `Game::playCollisionEffect` writes the
surface normal into the new object's Up axis and derives the other two from
world +Z. Everything in the bundle is authored in that frame: "up" is off the
surface, "right"/"dof" lie in it.

**Emitters spawn on a clock.** Each emitter names one payload and spawns it
every `|1/intensity|` seconds for `timeToLive` seconds after `delay`, from an
offset in the frame with an initial speed in the frame, optionally adding the
emitter's own velocity. Every number is a CRD random variable, resampled per
spawn.

**The bullet hole is a mesh particle.** `Fx_RichoStoneDecal`: a 0.2 m quad
(`Decal_Stone_m1.sm`), placed 1 mm off the surface, alive 1–15 s (uniform),
alpha held for 70% of that life then ramped to zero — and cut off at 50% by the
mesh's own `alphaTestRef 0.5`, which is why an in-game hole vanishes rather
than fades out. Dark because its shader says `materialDiffuse 0.388`.

**The rocket's trail is a bundle riding the round.** `e_rocketFume`: smoke
at 100 puffs/s for 7 s, each puff born at the rocket's 50 m/s and dragged
(`drag 20`) to a halt within a tenth of a second, growing 0.5 → 0.9 m over
2.5 s; and a motor flame that burns for exactly one second. The rocket itself
falls at 0.2 g (`gravityModifier 0.2`) and detonates on contact.

**Damage decays over distance.** `Projectile::getDamage`: full `materialDamage`
out to `distToStartLoseDamage`, linear to `minDamage` × full at
`distToMinDamage`, flat beyond. Thompson: 5 → 2.5 between 40 and 80 m.

## What was built

- `con.py` now keeps every raw property on EffectBundle / Emitter / Particle
  templates (`effect_props`) and parses the projectile's damage falloff,
  `radius`, `material2` and `endEffectTemplate`. `crd4()` reads a CRD as
  `[dist, a, b, mirror]`.
- `bf42/effects.py` turns those into the viewer's spec (emitter + particle
  dictionaries; nested bundles keep their placement).
- `extract_effects.py` bakes every bundle the material table can name, plus
  projectile trails and end effects, into **`_shared/effects.glb`**: 59
  bundles, 300 emitters, 497 KB for vanilla. The ten it cannot bake are
  sound-only collision bundles and one undefined name.
- `effects-core.js` is the engine's arithmetic — CRD sampling, the frame from
  the normal, the emitter clock, spawn placement, gravity/drag integration,
  size/colour/alpha evaluation, damage falloff — with no imports, so
  `tests/effects_harness.mjs` runs it under node (17 tests).
- `effects.js` plays a bundle: sprites billboarded with their ramps, mesh
  particles oriented by the frame and faded through opacity under the
  authored alpha test, pooled, 1200 particles and 128 decals at most (the
  engine's own decal ring is 127). Bundles can attach to a moving object.
- `gunfire.js` plays the resolved bundle at every hit, hangs the trail
  bundle on a shell that declares one, plays `endEffectTemplate` on a
  `timeToLive` expiry, and stamps `damage` / `damageFactor` and the exact
  distance to the surface on the hit record.
- `map.html` loads the library beside `damage.json`, lights mesh particles
  through `bindDynamicShading` (the engine's MODULATE2X combine), advances
  the player each frame, and exposes `__effects()` and `__teleport()` for
  headless checks. `?effects=off` leaves it out.

## Measured

Wake, on foot, `?shots`, frames stepped with `__renderOnce`:

| | |
|---|---|
| Thompson, 7 rounds at 4.0 m into the supply bunker's west wall (material 93) | 7 hits, all `RichoStoneDecal`, all played; 7 decals live 1 s later, each at 1.0 mm off the wall (x 1337.805 vs face 1337.804), unoccluded, 0.2 m, `alphaTest 0.5`, base colour 0.388 |
| rendered hole vs wall (16×16 px means, 1600×1000 render) | holes 52–72, lit wall beside them 124–150 |
| damage on the record | 5 at 4 m (factor 1); the 40→80 m line is in the JS test |
| Bazooka, one round from 36 m | trail run alive in flight (32 particles at 0.3 s); hit at 36.0 m on material 93, `BazookaCascadesStone` played, damage 10; explosion cloud still drifting 1.2 s later |
| library | 59 bundles, 300 emitters loaded; 0 dropped spawns in every run |

## Still missing

- **Sound.** Most bundles carry `loadSoundScript`; nothing plays. Same block
  as before: the samples are not extracted.
- **Splash damage** (`radius`, `material2`, `damageType 1`) is on the record
  and nothing takes it.
- **`SpriteParticleNew`** payloads (a handful of newer effects) are treated
  as plain sprites; their extra properties are ignored.
- **Debris does not rest.** The cascade bundles' concrete chunks fall through
  the ground after 3–5 s instead of landing; particles have no collision.
- **Emitter `lodDistance`** is applied at play time from the camera; the
  engine re-evaluates it per frame.
- The emitter clock's t = 0 first spawn is inferred from data, not read
  (ledger EMT-2).
