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

**A round has two explosions, and only one of them is on contact.** Added
2026-09-20, ledger **HP-9d**. `damageType` alone does not say which a round
gets:

```
impact explosion, at the collision:   damageType == 1 && hasCollisionEffect
end-of-life explosion, on the fuse:   damageType == 1 || damageType == 4
```

`hasCollisionEffect` is the **impact-versus-fuse discriminator**, not a
"can this round splash" flag, and the difference is the whole grenade. Exactly
three vanilla `damageType 1` projectiles omit it — `ExpPackProjectile`,
`GrenadeAlliesProjectile`, `GrenadeAxisProjectile` — and `LandmineProjectile`
is `damageType 4`; those four are the game's fuse weapons, and requiring the
flag for splash generally (an earlier recommendation, refuted against the
binary) would have deleted every point of damage they deal. `damageType 4`
never takes the impact path even with the flag set, which is why vanilla's
three flak shells burst on their fuse rather than on the aircraft they graze.
Surveyed over every installed mod's `objects*.rfa`: 3,161 `damageType 1`
templates, 2,935 with the flag, 46 `damageType 4`.

**The blast measures to the victim's origin.** `t = clamp((radius − d)/radius,
0, 1)` times `materialDamage(material2)` times `damageMod(material2,
victim.material)`, with a strict `radius > d` cutoff — the distance to the
victim's **transform origin**, not a bounding box and not the nearest surface,
with only the **Y** term scaled (by `YModOnExplosion`, default 1.0, authored
2.0 on 629 of the 642 declarations surveyed and every one of them a bomb).
There is **no occlusion at all** for a victim that is not a soldier. For a
soldier the engine multiplies in an exposure term from `checkForHitOnSoldier`
and short-circuits on 0; the viewer has no per-limb volumes to sample, so it
passes 1 and names the gap rather than hiding it.

**The radius is an integer.** `ProjectileTemplate.radius` is a console `int`,
truncated toward zero at parse, so a fractional radius below 1 is **no splash
at all** — DC's `50calSniper_Projectile radius 0.25` becomes 0, and the strict
`radius > d` gate then reaches nothing. 384 templates across the installed mods
author a fractional radius. When the `.con` omits `radius` entirely the
constructor's own 10.0 applies, which six vanilla tank rounds rely on.

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

## The two-path rule on the page (2026-09-20)

Aberdeen, re-extracted by the same worktree that made the change, served on
5332 and driven with Playwright. `models/damage.json` is the arithmetic's own
source, so the closed forms below are checkable without the page.

| what | measured |
|---|---|
| **A tank shell's splash hurts a nearby vehicle on impact.** A Priest's round struck a static object at `[921.6, 93.3, -865.7]`: record `blast: "impact"`, `splashMaterial2 201`, `splashRadius 15`, `splashYMod 1`, direct damage 0 (the thing it hit has no Armor) | the **M10 7.86 m away, never touched by the round, fell 100 → 76.18 HP**. Closed form `materialDamage(201) 10 × damageMod(201→50) 5.0 × (1 − 7.86/15) = 23.81` against 23.82 measured |
| **A grenade does nothing where it lands.** `GrenadeAxisProjectile`, `damageType 1`, `hasCollisionEffect 0`, thrown at a Sherman from 8.5 m | it met the ground at age **0.25 s** and rested there. Over the **130 frames** between landing and the fuse, the tank's HP did not move by one hundredth and **no impact record was ever created** |
| **…and everything when its fuse ends.** `timeToLive CRD_NONE/3/0/0` | at 3 s a single record appeared, `kind: "endOfLife"`, `blast: "endOfLife"`, `splashMaterial2 205`, `splashRadius 15`, **direct damage `null`** — splash and nothing else. The Sherman fell 100 → 84.06 HP in that same frame. Closed form `10 × 2.0 × (1 − 3.03/15) = 15.95` against 15.94 measured |

The gun in the first row is a Priest's and not a Sherman's, and that is a
finding rather than a convenience: **`damageMod(206, 50)` has no cell in
vanilla's tables**, and by DMG-1 an unlisted pair means no damage — so a
Sherman's or PanzerIV's HE round splashes soldiers and does nothing at all to
armour. Artillery material 201 carries 5.0 against armour, material 205 (the
grenades) 2.0, material 204 (the explosives pack) 3.5, and the landmine's 232
carries **100.0**, which is what makes an anti-tank mine an anti-tank mine.

## Still missing

- **Sound.** Most bundles carry `loadSoundScript`; nothing plays. Same block
  as before: the samples are not extracted.
- **A soldier's exposure.** `splashDamage` takes the term and every caller
  passes 1, so a man in cover takes full splash here where the engine would
  give him some or all of it back. It needs per-limb soldier volumes and a ray
  budget to sample them, neither of which exists.
- **Nothing splashes a soldier at all yet.** `applySplash` walks registered
  *vehicles*; the on-foot player is not among them, so a grenade at his own
  feet costs him nothing.
- **A fuse round rests where it lands instead of bouncing.** The engine's
  grenade is a rigid body (`setHasCollisionPhysics 1`,
  `setHasResponsePhysics 1`) and genuinely bounces; the contact solver that
  would bounce it belongs to the collision round (COL-2..COL-12). Rather than
  invent a restitution coefficient the round stops on the surface it met and
  runs its fuse down there — the damage rule is exact, the trajectory after
  first contact is not. The authored word for this is `dieAfterColl`, on 2,311
  templates across the installed mods but **not** aligned with
  `hasCollisionEffect` (1,676 carry the flag set *and* `dieAfterColl 0`); what
  the engine does with it was not read, so it is recorded and not consumed.
- **The end-of-life blast is not reached from the tracer path.** A round only
  detonates on its fuse if it flies as a projectile (`kind` `shell`/`rocket`
  with a baked body). A `damageType 4` round whose body did not bake would fly
  as a tracer and expire silently. No vanilla case does, but a mod's could.
- **`SpriteParticleNew`** payloads (a handful of newer effects) are treated
  as plain sprites; their extra properties are ignored.
- **Debris does not rest.** The cascade bundles' concrete chunks fall through
  the ground after 3–5 s instead of landing; particles have no collision.
- **Emitter `lodDistance`** is applied at play time from the camera; the
  engine re-evaluates it per frame.
- The emitter clock's t = 0 first spawn is inferred from data, not read
  (ledger EMT-2).
