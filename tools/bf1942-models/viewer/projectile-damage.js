// A projectile's damage block, read the way the engine reads it: the falloff
// with distance, the splash (and which of the engine's two explosions a round
// gets), whether it dies on contact, and how long the viewer lets it live.
// Split out of `effects-core.js`, which re-exports it; like that module this
// imports nothing, so it runs under node as it is. The addresses are in
// `features/bf1942-engine-reference/subsystems/projectiles-and-impacts.md`.

/**
 * Damage falloff by distance — `Projectile::getDamage` (client 0x00542e80,
 * lnxded 0x0831f3c0): full out to `distToStartLoseDamage`, a straight line
 * down to `minDamage` (a fraction of full) at `distToMinDamage`, flat after.
 * Skipped entirely when `minDamage` is 1 or the start distance is 0.
 */
export function damageFactor(damage, distance) {
  if (!damage) return 1;
  const min = damage.minDamage ?? 1;
  const start = damage.distToStartLoseDamage ?? 0;
  const end = damage.distToMinDamage ?? 0;
  if (min >= 1 || start <= 0 || distance <= start) return 1;
  if (distance >= end || end <= start) return min;
  return min + (1 - min) * (end - distance) / (end - start);
}

/**
 * Engine `ProjectileTemplate` default splash radius when the `.con` omits
 * `radius` — the constructor's own `0x41200000` (lnxded 0x0831f9b3), and it is
 * load-bearing: six vanilla tank rounds (Sherman, Tiger, PanzerIV, T34,
 * T34-85, Chi-ha) declare no radius at all and every one of them splashes at
 * 10 m. HP-9.
 */
export const DEFAULT_SPLASH_RADIUS = 10;

/**
 * A projectile's radius as the engine holds it: truncated **toward zero**.
 *
 * HP-9. `ProjectileTemplate.radius` is a console **`int`** — the parser is
 * `istream >> int` (lnxded 0x082df83f) and the value is `fild`ed into the
 * float field (0x082df8ef) — so the truncation happens at PARSE and a
 * fractional radius never reaches the engine at all. `bf42/con.py` now does
 * the same, so a freshly extracted glb arrives already integral; this is the
 * defence for glbs baked before that, which may still carry `17.63`.
 *
 * The consequence that matters: with the engine's strictly `radius > d` gate
 * (0x08156655) and `d >= 0`, a radius below 1 truncates to 0 and means **no
 * splash at all**. DC's `50calSniper_Projectile radius 0.25` is the real case;
 * 384 templates across the installed mods author a fractional radius.
 */
export function truncateRadius(radius) {
  return Number.isFinite(radius) ? Math.trunc(radius) : radius;
}

/**
 * The distance an explosion measures to a victim, with the **Y term alone**
 * scaled by `YModOnExplosion`.
 *
 * HP-9, `handleExplosionOnObject` 0x081565c2-0x08156646: the position is the
 * victim's **transform origin** (`getPos`, IObject vtable +0x38 at
 * 0x081565c2) — not a bounding box, not the nearest surface, so a tank is not
 * hurt less for being caught on the far corner of its hull — and only `dy` is
 * multiplied (0x08156613). Engine default for the field is 1.0.
 *
 * What the scale buys, on the data: 629 of the 642 `YModOnExplosion`
 * declarations surveyed across the installed mods are `2.0` and every one of
 * those sits on a bomb. Doubling the vertical term halves a bomb's effective
 * vertical reach, which is how the game stops a 20 m airburst from killing
 * everyone on the floor below it.
 */
export function blastDistance(dx, dy, dz, yMod = 1) {
  const y = dy * (Number.isFinite(yMod) && yMod > 0 ? yMod : 1);
  return Math.sqrt(dx * dx + y * y + dz * dz);
}

/**
 * How far off the struck surface an **impact** explosion is centred: 0.1 m
 * along the collision normal.
 *
 * `GameServer::handleCollisionForProjectile` computes the explosion position
 * as `hitPos + 0.1 * normal` before handing it to `handleExplosion`: the
 * constant is loaded at lnxded 0x08153f5e from `ds:0x086b1ca0`
 * (`cdcccc3d` = 0.1f), multiplied into all three components of the normal at
 * 0x08153f6b-0x08153f73, added to the hit position at 0x08153f82-0x08153f8f,
 * and pushed as the blast centre at 0x08154026/0x08154030/0x08154037. The same
 * shape appears in the function's other two collision blocks, at 0x0815434e
 * and 0x081546f2.
 *
 * Two things it is NOT. It is not applied to the **collision effect** — that
 * is played at 0x08153e5b, before any of this, on the raw hit point. And it is
 * not applied to the **end-of-life** explosion, which stands on the
 * projectile's own `getPos()` with no offset at all (`startEndEffect`
 * 0x0831f747).
 *
 * Numerically it is small — 0.1 m out of a 10 to 30 m radius is well under 1%
 * of the falloff — but it is free and it is read, and it is always *away* from
 * whatever was struck, so the victim that took the direct hit is the one it
 * shades.
 */
export const IMPACT_BLAST_OFFSET = 0.1;

/**
 * Splash half of a projectile's damage block, or null when this round has no
 * area pass at all.
 *
 * **The engine has two explosions, and `damageType` alone does not say which a
 * round gets** (HP-9d):
 *
 *     impact, at the moment of collision:
 *         damageType === 1 && hasCollisionEffect        (0x08153e79 / 0x08153ea9)
 *     end of life, when timeToLive or the fuse runs out:
 *         damageType === 1 || damageType === 4          (0x0831f6bb / 0x0831f6c0)
 *
 * `hasCollisionEffect` is the **impact-versus-fuse discriminator**, not a
 * splash-capability flag, and the difference is the whole grenade. Requiring it
 * for splash generally — which an earlier research pass recommended and a
 * verifier refuted — would silently delete grenade, explosives-pack, satchel
 * and landmine splash, the most-used splash damage in the game. In vanilla
 * exactly three of the 28 `damageType 1` projectiles omit it
 * (`ExpPackProjectile`, `GrenadeAlliesProjectile`, `GrenadeAxisProjectile`),
 * and `LandmineProjectile` is `damageType 4`. Surveyed over every installed
 * mod's `objects*.rfa`: 3,161 `damageType 1` templates, 2,935 of them with the
 * flag, and 46 `damageType 4`.
 *
 * `damageType 4` explodes **only** at end of life, never on impact. Do not
 * read that as "so a `damageType 4` round rests where it lands and bursts
 * there" — whether a round survives contact at all is a **third** question,
 * and `diesOnContact` below is the one that answers it. Vanilla's three flak
 * shells are `damageType 4` *with* the flag set, and the flag is not dead on
 * them: it kills them on contact, with no explosion of either kind.
 *
 * Returns `{ material2, radius, damageType, hasCollisionEffect, yMod, impact,
 * endOfLife }`. `material2 -1` is the authored "no splash" (fighter MGs).
 *
 * **One radius, and it is the integer** — this is the easy thing to get wrong.
 * The ledger says the end-of-life path passes an *untruncated* radius
 * (0x0831f73e), and that is true of the code: the impact path re-truncates at
 * 0x08153f23-0x08153f58 and the end-of-life path does not. But that second
 * truncation is a **no-op in practice**, because the property is a console
 * `int` and the real truncation already happened at parse (0x082df83f). So
 * both paths see the same integer, and "untruncated" describes an absent
 * instruction rather than a surviving fraction: DC's
 * `50calSniper_Projectile radius 0.25` is 0 to the fuse path as surely as to
 * the impact path, and handing the fuse path 0.25 would resurrect a splash the
 * engine never has. `truncateRadius` is therefore applied once, here, for
 * both.
 *
 * Two fields an older baked glb will not carry, and what is assumed for it:
 * a missing `damageType` keeps being treated as **1**, the way this function
 * always has; and a missing `hasCollisionEffect` is treated as **true**, i.e.
 * impact-capable, because that is what 2,935 of 3,161 templates are and
 * assuming false would delete splash from every round in an old extract.
 * Both assumptions vanish the moment the scene is re-extracted.
 */
export function splashSpec(damage) {
  if (!damage) return null;
  const material2 = damage.material2;
  if (!(Number.isFinite(material2) && material2 >= 0)) return null;
  const damageType = damage.damageType ?? 1;
  if (damageType !== 1 && damageType !== 4) return null;
  const radius = truncateRadius(
    Number.isFinite(damage.radius) ? damage.radius : DEFAULT_SPLASH_RADIUS);
  const hasCollisionEffect = damage.hasCollisionEffect ?? true;
  const yMod = Number.isFinite(damage.yModOnExplosion) && damage.yModOnExplosion > 0
    ? damage.yModOnExplosion : 1;
  // The gate is strictly `radius > d` with `d >= 0`, so a zero radius reaches
  // nothing and is not a splash at all — on either path.
  if (!(radius > 0)) return null;
  const impact = damageType === 1 && !!hasCollisionEffect;
  const endOfLife = damageType === 1 || damageType === 4;
  if (!impact && !endOfLife) return null;
  return { material2, radius, damageType, hasCollisionEffect, yMod, impact, endOfLife };
}

/**
 * Does this round die the moment it touches anything?
 *
 * `Projectile::handleCollision` (lnxded 0x0831ee80) asks two questions and
 * recycles the round if either answers yes:
 *
 *     0x0831ef4b  cmp BYTE [tmpl+0x1a7],0   ; dieAfterColl     -> jne kill
 *     0x0831ef54  cmp BYTE [tmpl+0x1a4],0   ; hasCollisionEffect -> jne kill
 *
 * The kill is `Projectile::resetProjectile` (0x0831e720, called at
 * 0x0831f00a). It sets the round's detonate latch (`Projectile+0x10d`) and
 * despawns it, and it does **not** call `startEndEffect` — so a round that
 * dies this way never gets an end-of-life explosion, and a later `detonate()`
 * finds the latch already set and returns.
 *
 * This is the word that was missing, and the flak shells are why it matters.
 * `AA_Allies_Projectile`, `Carrier_AA_Projectile` and `Flak38_Projectile` are
 * `damageType 4` — no impact explosion, gate 0x08153e79 — but all three set
 * `hasCollisionEffect 1` (two also set `dieAfterColl 1`). So a flak round that
 * touches an aircraft, the ground or a wall is **deleted, silently**: it takes
 * its direct hit and plays its collision effect (`Game::playCollisionEffect`
 * runs at 0x08153e5b, before the explosion gate), and that is all. Reading the
 * flag as "dead on a type-4 round" and letting the shell rest where it landed
 * to burst on its fuse hands a 20 m, material2-199 blast to every AA gun
 * firing at the ground. What bursts a flak shell on an aircraft is not the
 * contact at all but its proximity fuse, `explodeNearEnemyDistance 10`,
 * which sets the end-of-life blast off before the shell reaches the hull
 * (`proximity-fuse.js`, ledger PROX-1..PROX-6).
 *
 * Only a round with NEITHER word survives contact. In vanilla that is exactly
 * the four fuse weapons — `GrenadeAlliesProjectile`, `GrenadeAxisProjectile`,
 * `ExpPackProjectile` and `LandmineProjectile`, all four `hasCollisionEffect
 * 0` and `dieAfterColl 0`.
 *
 * Absent on an older baked glb: `hasCollisionEffect` defaults to **true** (the
 * same assumption `splashSpec` makes, and the safe one — it keeps a tank shell
 * ending at the wall), `dieAfterColl` to the engine's own **false**.
 *
 * Two further words in the same chain are read but not modelled here, and
 * named so the next reader does not rediscover them: `isSticky`
 * (`ProjectileTemplate+0x1ab`, tested 0x0831ef16) attaches the round to what
 * it struck and disables its physics, and `detonateOnWaterCollision` (+0x1ac,
 * tested 0x0831f3ae) is what lets a water contact be handled at all — without
 * it `handleCollision` returns immediately on water. Neither is set by any
 * vanilla projectile.
 */
export function diesOnContact(damage) {
  if (!damage) return true;
  return !!(damage.hasCollisionEffect ?? true) || !!damage.dieAfterColl;
}

/**
 * A **fuse** round: one whose only explosion is the end-of-life one, and
 * which lives through a contact to reach it.
 *
 * Three conditions, and the third is the one that is easy to drop:
 *
 *   1. it has an end-of-life explosion (`damageType` 1 or 4);
 *   2. it has NO impact explosion (so `hasCollisionEffect` is clear, or the
 *      type is 4);
 *   3. it SURVIVES contact (`diesOnContact` is false).
 *
 * In vanilla exactly four templates answer all three —
 * `GrenadeAlliesProjectile`, `GrenadeAxisProjectile`, `ExpPackProjectile` and
 * `LandmineProjectile`. The three flak shells pass 1 and 2 and fail 3, which
 * is the whole reason the third condition exists.
 */
export function isFuseRound(damage) {
  const splash = splashSpec(damage);
  return !!(splash && !splash.impact && splash.endOfLife) && !diesOnContact(damage);
}

/**
 * The viewer's own recycling ceiling for a round that is still **flying**.
 *
 * Nothing vanilla flies for twenty seconds; a mod round with a huge
 * `timeToLive` and a slow muzzle would otherwise sail on forever. It is a
 * viewer guard, not an engine number.
 */
export const FLIGHT_TTL_CEILING = 20;

/** Fallback when a projectile spec carries no `timeToLive` at all. */
export const DEFAULT_TIME_TO_LIVE = 10;

/**
 * How long the viewer lets a round live: its authored fuse for a **fuse**
 * round, the flight ceiling for everything else.
 *
 * The distinction only started to matter when the fuse began firing a blast.
 * `ExpPackProjectile` authors `timeToLive 240` and `LandmineProjectile` 360,
 * and the engine really does detonate them then — `Projectile::handleUpdate`
 * (lnxded 0x0831e940) calls `detonate` (0x0831e680) at the end of the fuse,
 * which is where `startEndEffect` comes from. Clamping those to 20 s does not
 * make them expire early in some harmless cosmetic sense, the way it did when
 * `timeToLive` only recycled a mesh: it drops 12 m and 4 m of real splash on
 * the player twenty seconds after he puts the charge down.
 *
 * The ceiling's own reason does not apply to a fuse round anyway. Such a round
 * comes to rest, stops moving and stops sweeping, and costs one pooled mesh
 * while its fuse runs down. What the ceiling is there to catch is a round that
 * never stops travelling.
 *
 * Same principle as the range cap in `advance`: a guard the viewer invented
 * must not invent a blast with it.
 */
export function roundTimeToLive(timeToLive, damage) {
  const authored = timeToLive || DEFAULT_TIME_TO_LIVE;
  return isFuseRound(damage) ? authored : Math.min(authored, FLIGHT_TTL_CEILING);
}

/**
 * Splash HP: `materialDamage(att2) * damageMod(att2, splashMaterial) * (1 - d/radius)`.
 * Same formula as `bf42/damage.py` `splash_damage`. Returns 0 when the tables
 * have no entry for the pairing (a Sherman splash vs tank armour).
 *
 * The falloff is the engine's exact law (HP-9, confirmed 2026-09-19):
 * `t = clamp((radius - d) * (1/radius), 0, 1)`, with `A = 1/radius` computed
 * once by `handleExplosion` (0x08156f5c) and pushed at both call sites, and
 * the cutoff a strict `radius > d` (0x08156655) — so both of the engine's own
 * clamps are dead and the `Math.max(0, ...)` below is belt and braces.
 *
 * Three things about the geometry, which are easy to assume wrongly:
 *
 *   - the distance is to the victim's **transform origin**, not to a bounding
 *     box and not to the nearest surface (`blastDistance` above);
 *   - only the **Y** term is scaled, by `YModOnExplosion`, default 1.0;
 *   - there is **no occlusion at all** for anything that is not a soldier. A
 *     tank behind a wall takes the full falloff.
 *
 * `exposure` is the one term this cannot compute. For a **soldier** victim the
 * engine replaces the seeded `1.0` (0x08156505) with what
 * `checkForHitOnSoldier` (0x08156eb6) returns at 0x08156ece, and short-circuits
 * the whole victim when it comes back `0.0` (0x08156ede) — that is the engine's
 * cover model, and it is soldier-only. The viewer has no equivalent: it has no
 * per-limb soldier collision volumes and no ray budget to sample them per
 * blast, so callers pass 1 and a soldier in cover takes full splash here where
 * the game would give him some or all of it back. Named rather than silently
 * folded in, so the gap is visible in the one place it is wrong.
 */
export function splashDamage(material2, splashMaterial, distance, radius,
                             materials, modifiers, exposure = 1) {
  if (!(radius > 0) || !(distance >= 0) || distance >= radius) return 0;
  if (!(exposure > 0)) return 0;
  const base = materials?.[material2]?.damage ?? materials?.[String(material2)]?.damage;
  if (!(base > 0)) return 0;
  const attGroup = materials?.[material2]?.attGroup
    ?? materials?.[String(material2)]?.attGroup
    ?? material2;
  const defGroup = materials?.[splashMaterial]?.defGroup
    ?? materials?.[String(splashMaterial)]?.defGroup
    ?? splashMaterial;
  const mod = modifiers?.[attGroup]?.[defGroup]
    ?? modifiers?.[String(attGroup)]?.[String(defGroup)]
    ?? modifiers?.[attGroup]?.[String(defGroup)]
    ?? modifiers?.[String(attGroup)]?.[defGroup];
  // DMG-1, and do not "fix" this. The engine's fallback for a pair with no
  // cell is `MaterialManager+0x24` (`defaultDamageMod`), and that field is
  // **0.0 for the life of the process**: both constructors write 0
  // (0x0817485e, 0x0817491e), its setter (0x08176190) is a vtable slot nothing
  // calls, and the complete registered MaterialManager name block has no
  // console property for it — so no mod can set it either. An unlisted
  // material pair really does mean no damage. A research pass recommended
  // returning the field instead; a verifier refuted it, and acting on it would
  // either change nothing or introduce a bug.
  if (mod == null) return 0;
  return base * mod * exposure * Math.max(0, 1 - distance / radius);
}
