// Friendly fire: which soldiers a round may meet, and what a hit on your own
// side costs. Ledger FF-1..FF-5 (features/bf1942-engine-reference/ledger.md).
//
// Imports nothing, so a node harness (`tests/friendly_fire_harness.mjs`) and
// the headless runner load it as the page does.
//
// WHAT WAS READ (bf1942_lnxded.static). A round meets any soldier in its path,
// friend or foe: nothing from the contact test
// (`PointResponsePhysics::checkObjectVsObject` 0x08257030) to the damage
// (`GameServer::handleCollisionForProjectile` 0x08153ba0, `giveDamage`
// 0x0814b2e0) compares teams. The only soldier the contact test passes is one
// whose root is the root of the firer's controlled object: the firer himself,
// and anyone seated in the hull he fires from, because a seated soldier is a
// child of his seat (`SeatObject::enter` 0x083208d0). That is `roundPasses`.
//
// The price is `GameServer::calcDamage` 0x0814b520: a hit is scaled only when
// the round's team (stamped at fire time, `FireArms::fireBarrel` 0x0828b4ec)
// is 1 or 2 and equals the team of the PlayerControlObject at the victim's
// root. A soldier takes the soldier ratio. Anything else takes the vehicle
// ratio: a hull, and also a man seated in one, whose root is the hull. A blast
// takes the `OnSplash` pair. Each ratio is its console percentage divided by
// 100 (`Setup::initWorld` 0x080be4c0, `Setup::startHostGame` 0x080c4080) and
// clamped to [0, 2] by its setter (`setSoldierFFRatio` 0x081572d0 and its
// three siblings). That is `friendlyDamage`.
//
// The shipped `Mods/bf1942/Settings/ServerSettings.con` writes all four at 100,
// so a friendly round costs exactly what an enemy one does:
//
//     game.serverSoldierFriendlyFire 100
//     game.serverVehicleFriendlyFire 100
//     game.serverSoldierFriendlyFireOnSplash 100
//     game.serverVehicleFriendlyFireOnSplash 100
//
// It also writes `game.serverKickBack 0.000000` and `serverKickBackOnSplash
// 0.000000`: the share of friendly damage `_giveDamage` 0x0814b870 turns back
// on the shooter (FF-4). At 0 nothing is turned back, so it is not modelled.

/** The shipped `ServerSettings.con` friendly-fire percentages. */
export const FRIENDLY_FIRE_SHIPPED = Object.freeze({
  soldier: 100,
  vehicle: 100,
  soldierSplash: 100,
  vehicleSplash: 100,
});

/** A console percentage as the server holds it: `/ 100`, clamped to [0, 2]. */
export function friendlyFireRatio(percent) {
  const ratio = Number(percent) / 100;
  if (Number.isNaN(ratio)) return 1;
  return Math.min(2, Math.max(0, ratio));
}

/**
 * `calcDamage`: `damage` scaled for a hit on the attacker's own side.
 *
 * `attackerTeam` is the round's team, `victimTeam` the team of whoever the
 * victim's root belongs to: a soldier's own, a hull's crew (0 when it is
 * empty: `PlayerControlObject::clearTeam`, ledger XHIT-5). `soldier` is false
 * for a hull and for a man seated in one. Anything but a same-team hit by
 * team 1 or 2 comes back untouched.
 */
export function friendlyDamage(damage, {
  attackerTeam = null, victimTeam = null, soldier = true, splash = false,
  settings = FRIENDLY_FIRE_SHIPPED,
} = {}) {
  if (attackerTeam !== 1 && attackerTeam !== 2) return damage;
  if (victimTeam !== attackerTeam) return damage;
  const percent = soldier
    ? (splash ? settings.soldierSplash : settings.soldier)
    : (splash ? settings.vehicleSplash : settings.vehicle);
  return damage * friendlyFireRatio(percent);
}

/**
 * Whether a round fired by `firerId` flies through `targetId`'s body: he is
 * the firer, or sits in the hull the firer fires from. `world` is the page's
 * or the runner's (`player(id).occupancy.root` is the hull a player sits in).
 * Everyone else is met, whatever his side.
 */
export function roundPasses(world, firerId, targetId) {
  if (targetId === firerId) return true;
  const hull = world?.player(firerId)?.occupancy?.root ?? null;
  return hull != null && world.player(targetId)?.occupancy?.root === hull;
}
