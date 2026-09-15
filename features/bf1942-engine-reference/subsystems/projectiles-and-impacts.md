# Projectiles and impacts: what a round does when it lands

Settled 2026-09-15 for the mesh viewer's Thompson and Bazooka. Two binaries
were read side by side, the same way as [handweapon-view-and-deviation.md](handweapon-view-and-deviation.md):

- **Server** `bf1942_lnxded.static` (54,895 symbols) — addresses `0x08xxxxxx`,
  cited with names. The projectile, material, effect-bundle, emitter and
  particle classes all live in `dice::ref2::world` (shared engine source), so
  the server's *named* code is the reading and the client is the confirmation.
- **Client** `BF1942.exe` (corpus binary, sha256 `60c9452d…`) — addresses
  `0x00xxxxxx`. Everything marked VERIFIED below was decompiled in the client
  and found to be the same algorithm; the client offsets are recorded in
  [symbols.json](../symbols.json) under subsystems `weapons` and `effects`.

The viewer code this settles: [`viewer/effects-core.js`](../../../tools/bf1942-models/viewer/effects-core.js)
(the arithmetic), [`viewer/effects.js`](../../../tools/bf1942-models/viewer/effects.js)
(three.js), [`bf42/effects.py`](../../../tools/bf1942-models/bf42/effects.py) and
[`extract_effects.py`](../../../tools/bf1942-models/extract_effects.py) (the bake).

---

## 1. The chain, from contact to picture

```
collision system
  -> Projectile::handleCollision(other, velocity, normal, relPos, material, flag)   lnxded 0x0831ee80
       material := ProjectileTemplate.material (+0x88 lnxded) when set             (the attacker id)
       -> SimpleObject::handleCollision(...)                                        0x081dab40
            -> Game::handleCollisionForProjectile (virtual +0x30)                   server 0x08153ba0
                 att = projectile material, def = struck material
                 effect = MaterialManager::getEffectTemplate(att, def, |v.n|)       0x081750d0 -> MMCell 0x081746a0
                 Game::playCollisionEffect(other.pos + relPos, effect, normal, dot, speed)
                                                                                    0x0805de20 / client 0x0040e590
                 damage: getDamageForMaterial(material2) and the radius sweep (damageType 1)
       -> attach-to-object / soldier hit / resetProjectile per the template's bools
```

`Game::playCollisionEffect` (VERIFIED, both): creates the EffectBundle object,
`setPosition`, copies its transform, **writes the surface normal into row 1
(Up)** and calls `BaseVector3::makeOrthonormalBasis(row0, row1, row2)`
(lnxded `0x08061bd0`, client `0x0040e360`): Right = Up × DOF, normalize; DOF =
Right × Up, normalize; Right = Up × DOF. The object's DOF before the call is
its constructor default, world +Z. So **an impact effect stands with Up along
the surface normal and its forward axis the projection of world +Z onto the
surface** — the bullet hole lies flat in the wall, the dirt spike rises along
the normal. A wall facing exactly ±Z leaves the cross product zero; the engine
just fails the call (the return code is ignored), the viewer falls back to +X.
If the template is an `EffectBundleTemplate` the impact's `|v·n|` and speed are
stored on the bundle (+0x10c/+0x110 lnxded, +0x128/+0x12c client).

`Projectile::startEndEffect` (0x0831f590) is the other entry: on `timeToLive`
expiry (`detonate`, 0x0831e680) the `endEffectTemplate` is played with Up =
world (0, 1, 0), or for a `material2` projectile `getEffectTemplate(material2,
struck-or-water, 1.0)`.

`MMCell::getEffectTemplate(float)` (0x081746a0) keeps a `map<float, template>`
per (attacker, defender) cell and picks by the passed value clamped to [0, 1].
Vanilla only ever registers one entry per cell (`setEffectTemplate` has no
angle argument), so the cosine never selects anything; recorded for mods.

## 2. The projectile template (ProjectileTemplate::makeScript — the rosetta)

Serialised by `ProjectileTemplate::makeScript` (lnxded `0x0831fd40`, client
`0x00541a60`), defaults from the constructor (`0x0831f8d0`):

| property | lnxded | client | default |
|---|---|---|---|
| `timeToLive` (CRD) | +0x17c | ~+0x1f8 | 3 s |
| `gravityModifier` | +0x164 | +0x214 | **1.0** |
| `material` | +0x88 | +0x10c | −1 (= inherit the collision material) |
| `material2` | +0x1b8 | +0x298 | −1 |
| `radius` | +0x190 | +0x270 | 10 |
| `damageType` | +0x160 | +0x210 | 0 |
| `minDamage` | +0x194 | +0x278 | 1.0 |
| `distToStartLoseDamage` | +0x198 | +0x27c | 0 |
| `distToMinDamage` | +0x19c | +0x280 | 0 |
| `explodeNearEnemyDistance` | +0x168 | +0x218 | −1 (off) |
| `endEffectTemplate` | +0x170 | +0x21c | none |
| `hasCollisionEffect` / `hasOnTimeEffect` / `dieAfterColl` / `stopAtEndEffect` / `invisible` | +0x1a4.. | +0x284/+0x285/+0x287/+0x289/+0x28a | `dieAfterColl` **1** |

The falloff — **`Projectile::getDamage`** (lnxded `0x0831f3c0`, client
`0x00542e80`, both decompiled, VERIFIED):

```
base = damage override ? override.value : MaterialManager.getDamageForMaterial(material)
if minDamage < 1 and distToStartLoseDamage > 0:
    d = |hitPos - launchPos|
    d <= distToStartLoseDamage           -> base
    d >= distToMinDamage                 -> base * minDamage
    else                                 -> base * (minDamage + (1 - minDamage) * (end - d) / (end - start))
```

A Thompson round (`ThomsonProjectile`: material 216 "SMG", `materialDamage 5`,
`minDamage 0.5`, 40 → 80 m) does 5 out to 40 m and 2.5 past 80. The
`minDamage/distTo…` lines on the `Thompson` *weapon* template (50/100) are a
different class and are not what `getDamage` reads.

`Projectile::handleUpdate` (0x0831e940) does no flight integration at all: the
body is `hasCollisionPhysics 1` physics, gravity × `gravityModifier`
(−14.73 × 0.2 = −2.95 m/s² for the bazooka's 50 m/s rocket, which has no
`c_ETRocket` engine and does not accelerate). The function only runs the
`explodeNearEnemyDistance` proximity fuse and scales the visible body.

## 3. EffectBundle → Emitter → particle

An impact effect is an `EffectBundle`; the material table names 73 in vanilla.
The vocabulary, from the three template serialisers (lnxded `EmitterTemplate::makeScript`
`0x081e61c0` / client `0x005097a0`; `ParticleTemplate::makeScript` `0x0820b260` /
`0x005384d0`), and what the update loops do with it:

**CRD random variables** — `Random::getContinuousRandom` (0x081e28b0) and the
emitter's inline copy (0x081e2f10), VERIFIED: `CRD_NONE/a` → a;
`CRD_UNIFORM/a/b` → `a + r(b − a)`, r ∈ (0, 1] (`(raw>>7|1)+1` × 2⁻²⁴), so
`CRD_UNIFORM/15/1/0` is **uniform 1..15**; `CRD_EXPONENTIAL/a` → `−a ln r`;
`CRD_NORMAL/a/b` → `a + b·N(0,1)`. The fourth field is a **mirror flag**: the
sample's sign is flipped with probability ½ (0x081e3037).

**Emitter clock** — `Emitter::handleUpdate` (0x081e3200) with
`calcInvItensity` (0x081e2f10): `delay` counts down; then a `timeToLive` runs
during which spawns are spaced `|1 / intensity|` apart, the intensity resampled
per spawn and multiplied by `speed / IntensityAtSpeed` when that is set (the
Panzer trail's `IntensityAtSpeed 20`); a zero intensity means one per 100 s.
`looping` restarts on expiry, which comes once `age >= timeToLive`.
**The first spawn is at t = 0** — VERIFIED (ledger EMT-2): the constructor
zeroes both `age` and `next` (0x081e2bb0), and a spawn is due when
`age >= next` (0x081e37bb). That is why a decal emitter (`intensity 2` over
`timeToLive 0.1`, 0.2 of a spawn by the arithmetic) still leaves a hole. The
test is skipped for the tick when the template's `showInFirstPerson` or the
instance's `+0x124` is set. When a `delay` runs out mid-tick, `age` advances by
the delay's pre-tick value rather than by the leftover.

**Spawn placement** — position = emitter origin + `relativePositionInDof/Up/Right`
along the frame; velocity = `positionalSpeedIn…` along the frame, plus the
emitter's own velocity × `emitterSpeedScale` when `addEmitterSpeed`.
`startRotation` rolls the frame about its **DOF** per spawn (`dice::ref2::roll`
0x08061df0 = `rotateAboutLine(m, m.row2, angle)`), in degrees — VERIFIED: the
angle passes unchanged down to `setRotateZDeg` 0x08062740, which multiplies by
π/180 before `fsincos` (ledger EMT-3).

**Mesh particles** — `Particle::handleUpdate` (0x0820ad20), VERIFIED: each tick
the body gets gravity `gravityModifier × gravityModifierOverTime(phase)` and
`drag × dragOverTime(phase)` through `setGravityModifier` / `setDrag`. That body
is a `PointPhysicsNode`, so drag is an acceleration,
`accel −= (scale·v − wind)·π·r²·drag/mass`, integrated in four sub-steps
([physics.md](physics.md) §3, ledger EMT-5). If `sizeModifier` ≠ (0,0,0) the scale is
`size × sizeOverTime(phase) × sizeModifier` via `IScaleable::setScale`,
otherwise the mesh draws at its authored size; if `alphaOverTime` is declared
the byte `255 × alpha(phase)` goes to `IStandardMesh::setAlpha` (+0x34).
Curves are rasterised to 101 samples per percent at template load and
linearly interpolated. The client function was not isolated (three candidates
share the 255/100 constants; none matched) — the server reading stands.

**Sprites** — `SpriteParticle` quads face the camera; `size`, `sizeOverTime`,
`colorRGBAOverTime` (0..255), `initRotation`/`rotationSpeed` (degrees),
`destBlendMode BMOne` additive else source-over. The update code is client-only
— on the server `ParticleSystem::update`, `addParticle` and `draw` are empty
(ledger SPR-1). On the client (SPR-2…SPR-6) a sprite template owns a
`geom::ParticleSystemTemplate` that bakes every `…OverTime` curve to 101
samples; each particle rolls its CRDs once in `ParticleSystem::addParticle`
(0x0060a680), and `draw` (0x0060a0e0) evaluates the curves per frame. Four words
our pipeline ignores — `numAnimationFrames`, `initAnimationFrame`,
`animationSpeed`, `animationSpeedOverTime` — make 791 of 7,159 sprite templates
flipbooks, among them explosion cores, aircraft fires and blood.

### The bullet hole

`MaterialManager.setEffectTemplate` for SMG/rifle rounds against every wall
material (80–119, 190–194) names **`RichoStoneDecal` / `RichoMetalDecal` /
`RichoWoodDecal`** — composite bundles (`Objects/Effects/Common/effects.con`)
of the ricochet burst plus one decal emitter:

```
Em_RichoStoneDecal:  timeToLive 0.1, intensity 2, relativePositionInUp 0.001
Fx_RichoStoneDecal:  Particle, geometry Decal_Stone_m1 (a 0.2 x 0.2 m quad in the XZ plane),
                     timeToLive CRD_UNIFORM/15/1  (1..15 s), size 1, sizeModifier 1/1/1,
                     gravityModifier 0, alphaOverTime 0/1|70/1|100/0
Decal_Stone_m1.rs:   lighting true, materialDiffuse 0.388, blendSrc sourceAlpha, blendDest
                     invsourceAlpha, depthWrite false, alphaTestRef 0.5, texture decal_stone_I
```

So the hole is a mesh particle lying in the surface (its plane normal is the
emitter's Up = the surface normal), lifted 1 mm, dark grey (a 19%-opaque
texture at luminance 69 × 0.388), held for 70% of a 1–15 s life and then
faded — and because the alpha test is on the *final* alpha, it drops out at
half opacity rather than fading to nothing. Metal holes are 3–5 cm
(`size 0.15..0.25`), wood splinters 0.4–0.5 m (`size 2..2.5`). None of this is a
`DecalManager` decal: that class (0x081e05f0, a 127-entry quad ring per
emitter) is a separate mechanism no impact bundle uses.

### The bazooka

`BazookaProjectile`: `projectile_m1` body, `velocity 50` (from the weapon),
`gravityModifier 0.2`, `timeToLive 10`, `material 226`, `material2 200`,
`radius 4`, `damageType 1`, and `addTemplate e_rocketFume` — the trail, a
bundle riding the round: `Em_rocketFume_Smoke` looping at 100/s for 7 s
(`Fx_rocketFume_Smoke`: 2.5 s, size 1.2 ramping 0.4→0.75, **`drag 20`**,
`addEmitterSpeed 1` so each puff leaves at the rocket's speed and is dragged
to a stop within a tenth of a second — that is the smoke line) and
`Em_rocketFume_Fire`, the motor flame, `timeToLive 1`: it goes out after the
first second. Against a wall the table names `BazookaCascadesStone` =
`e_ExplBazooka` (flash, fireball, cloud 2 s, smoke 4 s, sparks) +
`e_RichoCascadesStone` (`Gibb_concret45/60_m1` debris objects).

## 4. Open

- ~~Which `Emitter::handleUpdate` branch spawns~~ — closed 2026-09-16 (ledger
  EMT-2). The spawn test (`age >= next`, due at t = 0) is reached only when the
  template's `showInFirstPerson` and the instance's `+0x124` are both zero;
  either set sends the update down a separate path to its return, which was
  not read. Nothing found sets `+0x124`.
- ~~Degrees vs radians for `startRotation`~~ — degrees, closed 2026-09-16
  (EMT-3). `initRotation` / `rotationSpeed` are still read from data only.
- ~~The drag law inside the physics body~~ — closed 2026-09-16: an
  acceleration, not an exponential (ledger EMT-5). Still unread: the mass and
  bounding radius a spawned particle's body reports.
- The client `GameClient::handleCollisionForProjectile` and
  `Particle::handleUpdate` (undefined code; not needed — the server copies are
  named and the client's `playCollisionEffect`/`getDamage` twins matched).
