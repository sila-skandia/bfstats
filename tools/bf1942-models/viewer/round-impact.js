// The records a round leaves behind when it stops: the impact (a surface was
// struck — the material pair, the damage formula, the impact splash fields) and
// the end-of-life detonation (a fuse ran out, or a round was set off by hand).
// Split out of `gunfire.js`; both take the `GunFire` instance (`guns`) whose
// tables they read and whose `hits` / `onImpact` they report to.

import { impactEffect, materialFamily } from './collision-materials.js';
import { damageFactor, IMPACT_BLAST_OFFSET, splashSpec } from './effects-core.js';
import { angleFactor } from './crash-damage.js';
import { spawnImpact } from './round-visuals.js';

/** Record a hit, name the effect the game would play, and play or mark it.
 *  `origin` is where the round left the barrel, when the caller kept it. */
export function impact(guns, group, spec, hit, velocity = null, travelled = 0, origin = null) {
  const attacker = guns.attackerMaterial(spec);
  const family = materialFamily(hit.material);
  // `Projectile::getDamage`: the attacker material's `materialDamage`, then
  // the falloff over the distance the round has flown since it left.
  const base = guns.materials?.[attacker]?.damage ?? null;
  const factor = damageFactor(spec?.damage, travelled);
  // The two terms that were missing. `damageMod` is keyed by the attacker's
  // and defender's *groups*, not their material ids — most materials use
  // their own id for both, which is why a keyed-by-id lookup mostly works and
  // then silently doesn't on the ones that differ.
  const attGroup = guns.materials?.[attacker]?.attGroup ?? attacker;
  const defGroup = guns.materials?.[hit.material]?.defGroup ?? hit.material;
  const mod = guns.modifiers?.[attGroup]?.[defGroup] ?? null;
  // The angle term, `angleMod + (1 - angleMod) sin(abs(cos) pi/2)` with the
  // struck object's own `angleMod` (`handleCollisionForProjectile`, ledger
  // DMG-3 and DMG-4; the same term the crash law uses). `cos` is between the
  // round's path and the face normal, its sign only the side of the face. A
  // soldier and an aircraft author `angleMod 1`, so a round costs them the
  // same at any angle; everything else is left at the template's 0 and takes
  // the bare sine, 0.71 of full at 60 deg off square. (This was a bare
  // `abs(cos)`, 0.5 there, and it docked a glancing hit on a plane too.)
  let cos = 1;
  if (velocity) {
    const len = velocity.length();
    if (len > 0) {
      cos = Math.abs((velocity.x * hit.nx + velocity.y * hit.ny
                      + velocity.z * hit.nz) / len);
    }
  }
  const angleMod = hit.kind === 'soldier' ? 1 : (guns.angleModOf?.(hit.owner) ?? 0);
  const incidence = angleFactor(cos, angleMod);
  const record = {
    kind: hit.kind,
    material: hit.material,
    family,
    attacker,
    // The authored EffectBundle for this pairing. Named, not played — see the
    // comment on IMPACT_TINTS.
    effect: impactEffect(guns.damageEffects, attacker, hit.material),
    point: [hit.x, hit.y, hit.z],
    normal: [hit.nx, hit.ny, hit.nz],
    // `Projectile+0x134`, the barrel's world position when it fired: the
    // `Pos3` a direct hit hands `giveDamage`, which the victim's damage arc
    // points at (ledger HFD-4). Null for a round launched without one.
    origin: origin ? [origin[0], origin[1], origin[2]] : null,
    gun: group.node.name,
    distance: hit.t,
    // Which placed object was struck, against the firer's own. They must
    // never be equal; a gun shooting its own hull is the failure mode that
    // would look like "the guns stopped working" rather than like a bug.
    owner: hit.owner,
    // The soldier `bodyCast` put in the round's way, when that is what it met.
    target: hit.target ?? null,
    travel: hit.travel ?? null,
    feetY: hit.feetY ?? null,
    seated: !!hit.seated,
    bone: hit.bone ?? null,
    firer: group.owner,
    // The group itself, so a page with more than one seat on a hull can
    // say which seat's gun it was (a bot driver and a bot gunner share the
    // hull's owner id).
    firerGroup: group,
    travelled,
    damageFactor: factor,
    // The attacker/defender group pair and the two new terms, kept beside the
    // product so a readout can show why a round did what it did.
    attGroup,
    defGroup,
    damageMod: mod,
    incidence,
    // The engine's whole direct-hit formula. `damageMod` genuinely absent
    // (no table loaded) leaves the base damage alone rather than zeroing it;
    // a table that *does* load and says 0.0 for this pairing means exactly
    // that, and the round bounces.
    damage: base === null ? null
      : base * (mod === null ? 1 : mod) * incidence * factor,
    played: false,
  };
  // Splash / HE area pass. Direct HP is already in `damage`; these fields
  // tell the map page who else to hurt within `radius` of the blast centre.
  //
  // This is the **impact** explosion, and the engine gives it only to a
  // round with `damageType == 1` AND `hasCollisionEffect` (HP-9d, gates
  // 0x08153e79 / 0x08153ea9) — `splashSpec.impact` is that conjunction. A
  // grenade, satchel, explosives pack or landmine reaches this function with
  // `impact` false and gets no area pass here at all; its blast is the
  // end-of-life one in `detonate`. The radius is the truncated integer
  // (HP-9), which is what the impact path holds.
  const splash = splashSpec(spec?.damage);
  if (splash?.impact) {
    record.blast = 'impact';
    record.splashMaterial2 = splash.material2;
    record.splashRadius = splash.radius;
    record.splashYMod = splash.yMod;
    // The blast is centred 0.1 m off the surface, along the collision
    // normal — `hitPos + 0.1 * normal`, lnxded 0x08153f5e-0x08153f8f, pushed
    // at 0x08154026 (see `IMPACT_BLAST_OFFSET`). Kept as its own field
    // rather than moving `point`, because `point` is where the **collision
    // effect** goes and the engine plays that one at the raw hit position,
    // before this offset is computed (0x08153e5b).
    record.splashPoint = [
      hit.x + hit.nx * IMPACT_BLAST_OFFSET,
      hit.y + hit.ny * IMPACT_BLAST_OFFSET,
      hit.z + hit.nz * IMPACT_BLAST_OFFSET,
    ];
  }
  guns.hits.unshift(record);
  if (guns.hits.length > 16) guns.hits.length = 16;
  if (guns.effects && record.effect) {
    const handle = guns.effects.play(record.effect, {
      position: record.point,
      normal: record.normal,
      speed: velocity ? velocity.length() : 0,
    });
    record.played = !!handle;
  }
  spawnImpact(guns, hit, family);
  guns.onImpact?.(record, hit);
}

/**
 * The **end-of-life** explosion: the one a fuse weapon gets, and the one a
 * round that simply runs out of `timeToLive` in mid-air gets.
 *
 * `Projectile::startEndEffect` (lnxded 0x0831f590) fires it for
 * `damageType == 1` (test at 0x0831f6bb) **or** `damageType == 4`
 * (0x0831f6c0), and tests `hasCollisionEffect` at neither — which is the
 * whole point of HP-9d's two-path rule. Three differences from `impact`,
 * all read rather than assumed:
 *
 *   - the radius skips the impact path's second truncation (0x0831f73e vs
 *     0x08153f23), which is a no-op either way because the property is a
 *     console `int` truncated at parse — `splashSpec`'s own comment has the
 *     whole of why, and why handing this path a fractional radius would be
 *     wrong rather than faithful.
 *   - `sourceArmor` is pushed as **NULL** (0x0831f727), where the impact
 *     path passes the firer's. So this does not exclude the thrower, which
 *     is why your own grenade hurts you. UNVERIFIED, and named as such:
 *     what that argument actually gates downstream was not re-derived this
 *     round, only the fact that it is null here.
 *   - there is no surface: the engine stands the effect on world up,
 *     `startEndEffect` passing (0, 1, 0), so there is no material pair, no
 *     incidence cosine and no direct-hit HP — an end-of-life blast is
 *     splash and nothing else.
 *
 * Returns the record, or null when this round has no end-of-life blast.
 */
export function detonate(guns, group, spec, position, travelled = 0) {
  const splash = splashSpec(spec?.damage);
  if (!splash?.endOfLife) return null;
  const attacker = guns.attackerMaterial(spec);
  const record = {
    kind: 'endOfLife',
    material: null,
    family: null,
    attacker,
    // `endEffectTemplate` — `e_ExplGranade` on both grenades. Stood up on
    // world up, not on a surface normal.
    effect: spec?.endEffect ?? null,
    point: [position.x, position.y, position.z],
    normal: [0, 1, 0],
    gun: group.node.name,
    distance: 0,
    // Nothing was struck, so there is no owner to name and no firer to
    // exclude (`sourceArmor = NULL`, above).
    owner: -1,
    firer: -1,
    firerGroup: group,
    travelled,
    damageFactor: 1,
    attGroup: guns.materials?.[attacker]?.attGroup ?? attacker,
    defGroup: null,
    damageMod: null,
    incidence: 1,
    damage: null,
    blast: 'endOfLife',
    splashMaterial2: splash.material2,
    splashRadius: splash.radius,
    splashYMod: splash.yMod,
    played: false,
  };
  if (guns.effects && record.effect) {
    record.played = !!guns.effects.play(record.effect, {
      position: record.point, normal: record.normal, speed: 0,
    });
  }
  guns.hits.unshift(record);
  if (guns.hits.length > 16) guns.hits.length = 16;
  guns.onImpact?.(record, null);
  return record;
}

