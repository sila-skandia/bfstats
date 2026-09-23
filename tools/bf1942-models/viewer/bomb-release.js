// A bomb rack, and what one trigger pull off it costs.
//
// `FireArms` is one class in the engine and a bomb rack is an ordinary
// instance of it -- nothing about the aircraft secondary is special-cased in
// Refractor. Everything here therefore falls out of two template fields, the
// barrel list and one flag, and it applies to every multi-barrel weapon in the
// game and not only to bombs. The corpus is
// `features/bf1942-engine-reference/subsystems/bombs-and-torpedoes.md`, ledger
// rows BOMB-1..BOMB-12; the build record is
// `features/plane-bombs-and-torpedoes/BUILD.md`.
//
// Kept out of `gunfire.js` so it can be stepped under node with no `three` in
// the import graph -- `tests/bomb_release_harness.mjs` drives it directly. It
// imports NOTHING, deliberately: `seats.js` pulls it in for the HUD slot order
// and every harness that copies `seats.js` would otherwise have to grow a
// transitive module list.

/**
 * Does this weapon put something the player can SEE into the world?
 *
 * The guard this replaces (`gunfire.js`, `collect()`) read
 *
 *     if (!emitters.length && !stats.tracer && !stats.recoil
 *         && !(stats.velocity > 0)) return;
 *
 * and a bomb rack matches on all four clauses: no muzzle flash, no tracer, no
 * recoil, `velocity 0`. That one `return` is why no plane in this viewer has
 * ever dropped a bomb (ledger BOMB-9), and its comment -- "Bomb racks declare
 * no flash, no tracer and no recoil: nothing to show" -- describes exactly the
 * case it was wrongly excluding.
 *
 * What the guard was protecting is still worth protecting, so it is not simply
 * deleted. A `FireArms` with no signature of any kind and nothing to launch is
 * a placeholder: building a group for it costs a `setFiring` call, a cooldown
 * timer and, once `velocity || 100` had invented a muzzle velocity for it, a
 * stream of invisible rounds spending collision casts on nobody's behalf. The
 * amended test keeps that out and admits exactly the weapons that drop a drawn
 * body: a `shell` or `rocket` projectile spec WITH the baked mesh that
 * `spawnProjectile` needs. A bomb rack has both (`Stuka.glb`'s
 * `StukaBombRack projectile` node carries `projectileMesh`
 * `{template: DiveBomberBomb, geometry: Big_Bomb_M1}`); a placeholder has
 * neither, and a stale GLB whose body failed to bake still falls back to the
 * old velocity test rather than firing nothing forever.
 */
export function launchesADrawnBody(stats, projectileMesh) {
  const kind = stats?.projectile?.kind;
  return !!projectileMesh && (kind === 'shell' || kind === 'rocket');
}

/**
 * The muzzle velocity a round leaves with, in m/s.
 *
 * `gunfire.js` read `group.stats.velocity || 100`, and `velocity: 0.0` is
 * falsy -- so lifting the guard above on its own would have fired a released
 * bomb forward at 100 m/s (ledger BOMB-8). `0` is a real, authored value on
 * every one of the thirteen vanilla aircraft racks and means precisely what it
 * says: the round leaves at no speed of its own and inherits the platform's.
 * `?? ` instead of `||` is the whole fix; the 100 stays as the fallback for a
 * template that declares no `velocity` at all.
 */
export function releaseSpeed(stats) {
  return stats?.velocity ?? 100;
}

/**
 * Which barrels fire on one pull, and how many rounds that costs.
 *
 * `FireArms::Fire` (lnxded `0x0828a090`) picks the barrels and
 * `FireArms::fireFinished` (`0x08288470`) charges for them; they are separate
 * functions and they agree. The barrel count is the size of the
 * `addFireArmsPosition` vector (`FireArmsTemplate+0x210`..`+0x214`, 12-byte
 * elements), which is `muzzles` in the extracted data.
 *
 *   barrels | asynchronyFire | fires
 *   0 or 1  | --             | the one barrel
 *   > 1     | clear          | ALL of them, one salvo
 *   > 1     | set            | ONE, round-robin on a counter at FireArms+0x296
 *
 * and the charge is `barrelCount` for the salvo case and 1 for every other,
 * i.e. **a round is spent per projectile, not per trigger pull** (BOMB-1). A
 * Stuka's `magSize 30` over two barrels is fifteen drops of a pair, and one
 * pull takes its counter from 30 to 28 -- not to 29.
 *
 * `roundsLeft < barrelCount` is BOMB-5, the partial salvo: `Fire` has a rule
 * above the loop that fires only `roundsLeft` barrels, so a dive bomber down
 * to its last round drops ONE bomb and never goes into ammunition debt.
 *
 * It never fires on a bomb rack, though, and the "free bomb at the bottom of
 * every magazine" this comment used to claim does not occur in shipped data:
 * every non-async multi-barrel weapon's `magSize` is a multiple of its barrel
 * count, or -1. The case that does reach it is XPack2's `WasserFallGuns` —
 * 25 `addFireArmsPosition` entries on `magSize 1`, so one pull fires a single
 * barrel and empties it.
 *
 * An unlimited weapon (`roundsLeft` Infinity, the `mags == -1` sentinel of
 * GUN-4) short-circuits the whole charge block in the engine, so it salvos in
 * full and is charged nothing at all.
 *
 * `nextBarrel` is the round-robin counter -- `gunfire.js` passes `group.shots`,
 * which is what it already used for the same purpose.
 *
 * The third flag in the engine's expression, `FireArmsTemplate+0x348`, read as
 * `fireAllAtOnce` (BOMB-4, `inferred`), would force the single-round charge
 * and suppress the partial salvo. It is not modelled: the survey finds **zero**
 * declarations of it across all 14 installs, so nothing shipped depends on
 * which way it falls, and modelling an unproven offset would be worse than
 * leaving the case out.
 *
 * @returns {{barrels: number[], rounds: number}}
 */
export function salvo(barrelCount, {
  asynchronyFire = false,
  roundsLeft = Infinity,
  nextBarrel = 0,
} = {}) {
  const barrels = Math.max(1, barrelCount | 0);
  const unlimited = !(roundsLeft < Infinity);
  if (barrels === 1) {
    return { barrels: [0], rounds: unlimited ? 0 : 1 };
  }
  if (asynchronyFire) {
    // `bVar14 = this[0x296]; if (barrelCount <= bVar14) bVar14 = 0;` -- a plain
    // wrap, which a modulo is.
    return { barrels: [Math.max(0, nextBarrel | 0) % barrels],
             rounds: unlimited ? 0 : 1 };
  }
  if (unlimited) {
    return { barrels: range(barrels), rounds: 0 };
  }
  const firing = Math.min(barrels, Math.max(0, Math.floor(roundsLeft)));
  return { barrels: range(firing), rounds: firing };
}

function range(n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(i);
  return out;
}

/**
 * Does a water contact end this round, or does the round go through it?
 *
 * `Projectile::handleCollision` (lnxded `0x0831ee80`) has exactly one
 * `return 0` path in the whole function, and it is a water contact on a round
 * whose `detonateOnWaterCollision` is clear (field `+0x1ac`, tested at
 * `0x0831f3ae`) -- the contact is swallowed and the round keeps going. That one
 * fact is the whole of an aircraft torpedo's water entry (BOMB-11), and
 * `AircraftTorpedo` is the only vanilla template that declares the word.
 *
 * Absent means "behave as this viewer always has", which is what keeps the
 * three bombs bursting on the sea: none of them declares it.
 */
export function entersWater(spec) {
  return spec?.damage?.detonateOnWaterCollision === false;
}

/**
 * `PointPhysicsNode::updatePositionalDragSimple`, `0x00578990`, for one round.
 *
 *     accel -= scale * v * pi * r^2 * drag / mass
 *
 * `scale` is `1 + 24 * min(underWater / r, 1)` -- PHY-7's 25x submerged drag,
 * `physics.js`'s `DRAG_SUBMERSION_SCALE`. Wind is zero everywhere in this
 * viewer (`physics.js` `WIND`) so the wind-relative term collapses to `v`.
 *
 * Written into `out` as an acceleration, and zero unless the round carries both
 * `mass` and `drag` -- which, before this round's extractor change, was every
 * round in the viewer. For a 250 kg bomb at `drag 0.08` and a ~0.9 m bounding
 * radius this is about 0.12 m/s^2 at 150 m/s, so it is a correction and not a
 * shape change; for an 800 kg torpedo running submerged the 25x is what makes
 * it a real term at all.
 *
 * `r` is the engine's `getBoundingRadius` (virtual slot `+0x1c`), which nothing
 * exports: the caller measures it off the drawn body's own geometry, which is
 * the same object the engine is measuring.
 */
export function dragAcceleration(spec, velocity, boundingRadius, underWater,
                                 out) {
  out.x = 0; out.y = 0; out.z = 0;
  const mass = spec?.mass;
  const drag = spec?.drag;
  if (!(mass > 0) || !(drag > 0) || !(boundingRadius > 0)) return out;
  const scale = 1 + 24 * Math.min(1, Math.max(0, underWater / boundingRadius));
  const k = Math.PI * boundingRadius * boundingRadius * drag / mass;
  out.x = -scale * velocity.x * k;
  out.y = -scale * velocity.y * k;
  out.z = -scale * velocity.z * k;
  return out;
}

/**
 * The FireArms nodes of a seat, primary weapon first.
 *
 * `map.html`'s ammo panel reads `nodes[0]` as primary and `nodes[1]` as
 * secondary, and until now that was declaration order -- which puts the B17's
 * bombs in the SECONDARY slot even though `B17BombRack` is the pilot's only
 * weapon and its `setNumberOfWeaponIcons 1` / `setPrimaryAmmoIcon
 * "Ammo/Icon_bomb.tga"` say the bombs ARE the primary (BOMB-7). Sorting on the
 * declared trigger instead gives the right slot for all thirteen vanilla
 * aircraft racks and leaves every same-input seat (a Sherman's cannon and
 * coax, both `c_PIFire`) in declaration order, because the sort is stable.
 *
 * This is a DESIGN CHOICE and not a derived fact: ledger VHUD-10 has which
 * weapon fills primary versus secondary explicitly open -- the registrar tables
 * are read, the writer is not -- and the extracted data carries no independent
 * primary/secondary tag to check it against.
 */
export function byWeaponSlot(nodes) {
  return nodes.slice().sort((a, b) => altFireRank(a) - altFireRank(b));
}

function altFireRank(node) {
  return node?.userData?.fireArms?.input === 'c_PIAltFire' ? 1 : 0;
}
