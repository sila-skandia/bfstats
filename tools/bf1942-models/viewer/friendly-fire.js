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

// --- Hold-fire (INVENTION, 2026-11-11, features/bot-friendly-fire "Decisions",
// features/bot-map-generation/hold-fire.md) ----------------------------------
//
// The engine has none (FF-7): a retail bot fires through a teammate in its
// line. On the page's generated corridor levels that cost one side half its
// deaths to its own rifles, and a person playing with the bots is shot in the
// back in any corridor, so the owner chose playability over parity here. A bot
// does not release a direct-fire round while a living teammate's body lies in
// the line from its muzzle to the target, nearer than the target, inside a
// tube a body wide and a bounded reach. Teammates only, no terrain ray: a
// friend behind a wall the round could not pass is still a reason to hold,
// which costs a moment's fire and never a friend.

/** The hold-fire's tube and reach.
 *  - `radius` 0.6 m: the referee's stand-in body radius (`BOT_BODY_RADIUS`),
 *    where the runner's round meets a body, and wider than a drawn body's
 *    shoulders (about 0.25 m each side) plus the cone's spread inside the
 *    reach. 93 of the page's 99 team-kill victims with a known line stood
 *    within a metre of it.
 *  - `reach` 100 m: most of the page's victims stood 1 to 7 m from the
 *    muzzle, but 5 of 24 on The_Maze stood 46 to 64 m down the line, and
 *    with a 40 m reach the runner's remaining team kills had a median range
 *    of 25 m and a quarter past 43 m (rifles and snipers: the cone does not
 *    spread a rifle's round round a body at 60 m). Past 100 m the round has
 *    usually met the target or the ground, and a friend there is no file.
 *  - `clearOfTarget` 1.0 m: a friend must be at least this much nearer than
 *    the target, so one at the target's own spot does not silence the bot.
 *  - `bodyBottom` 0.1 m and `bodyTop` by stance (standing 1.8, crouched 1.25,
 *    prone 0.5; seated 1.2 over the seat): the body's vertical axis. */
export const HOLD_FIRE = Object.freeze({
  radius: 0.6,
  reach: 100.0,
  clearOfTarget: 1.0,
  /** A body whose axis is up to this far behind the muzzle, horizontally, is
   *  still in the line: it overlaps the muzzle. */
  behind: 0.3,
  bodyBottom: 0.1,
  bodyTop: Object.freeze({ stand: 1.8, walk: 1.8, crouch: 1.25, prone: 0.5, lie: 0.5, seated: 1.2 }),
  /** The tube widens with the bot's own deviation cone: `spread` is the
   *  cone's half-width in radians (the bot's `aimDeviation` / 100, a square
   *  of that reach on each axis: round-launch.js `deviate`), added at the
   *  friend's distance down the line, the whole radius capped at `radiusMax`
   *  so a wild machine gun is not silenced by every friend in front. */
  radiusMax: 2.0,
  /** The step aside (bot-plans.js `holdFireStep`): after holding this long on
   *  foot the bot strafes away from the friend for `stepSeconds`, then looks
   *  again; it keeps aiming throughout. */
  stepAfter: 1.0,
  stepSeconds: 0.75,
  /** How far beside itself the bot looks for a walkable cell to step into. */
  stepProbe: 1.0,
});

/** The closest approach of segment p0->p1 and segment q0->q1: `{ dist, s }`,
 *  `s` the fraction along p0->p1 of p's closest point. */
export function segmentDistance(p0, p1, q0, q1) {
  const d1 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
  const d2 = [q1[0] - q0[0], q1[1] - q0[1], q1[2] - q0[2]];
  const r = [p0[0] - q0[0], p0[1] - q0[1], p0[2] - q0[2]];
  const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const clamp01 = x => Math.min(1, Math.max(0, x));
  const a = dot(d1, d1), e = dot(d2, d2), f = dot(d2, r);
  let s, t;
  if (a <= 1e-12 && e <= 1e-12) { s = 0; t = 0; }
  else if (a <= 1e-12) { s = 0; t = clamp01(f / e); }
  else {
    const c = dot(d1, r);
    if (e <= 1e-12) { t = 0; s = clamp01(-c / a); }
    else {
      const b = dot(d1, d2), den = a * e - b * b;
      s = den > 1e-12 ? clamp01((b * f - c * e) / den) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = clamp01(-c / a); }
      else if (t > 1) { t = 1; s = clamp01((b - c) / a); }
    }
  }
  const cx = p0[0] + d1[0] * s - (q0[0] + d2[0] * t);
  const cy = p0[1] + d1[1] * s - (q0[1] + d2[1] * t);
  const cz = p0[2] + d1[2] * s - (q0[2] + d2[2] * t);
  return { dist: Math.hypot(cx, cy, cz), s };
}

/**
 * The nearest friend whose body is in the line of fire, or null.
 * `origin` is where the round leaves, `aim` the point it is fired at (the
 * target's), `friends` `[{ id, pos: [x, y, z] (feet), stance }]`: the living
 * teammates the round could meet (the firer and his own hull's crew left
 * out, as `roundPasses` passes them). Returns `{ id, along, offset, side }`:
 * how far down the line the friend is, how far off it, and on which side of
 * it: +1 along (dz, -dx) of the line's x/z (+x for a line down +z, which is
 * a soldier's left: his strafe +1 runs along (-cos yaw, sin yaw),
 * walking-body.js), -1 the other way.
 */
export function friendInLine(origin, aim, friends, opts = HOLD_FIRE) {
  // `opts` may name only what it changes (`spread`): the rest are HOLD_FIRE's.
  const dx = aim[0] - origin[0], dy = aim[1] - origin[1], dz = aim[2] - origin[2];
  const len = Math.hypot(dx, dy, dz);
  if (!(len > 1e-6) || !friends) return null;
  const limit = Math.min(opts.reach ?? HOLD_FIRE.reach, len - (opts.clearOfTarget ?? HOLD_FIRE.clearOfTarget));
  if (!(limit > 0)) return null;
  const k = limit / len;
  const end = [origin[0] + dx * k, origin[1] + dy * k, origin[2] + dz * k];
  const radius = opts.radius ?? HOLD_FIRE.radius;
  const spread = Math.max(0, opts.spread ?? 0);
  const radiusMax = opts.radiusMax ?? HOLD_FIRE.radiusMax;
  // The box cut's margin: the widest the tube gets.
  const margin = Math.min(radiusMax, radius + spread * limit);
  const tops = opts.bodyTop ?? HOLD_FIRE.bodyTop;
  const bottom = opts.bodyBottom ?? HOLD_FIRE.bodyBottom;
  const h = Math.hypot(dx, dz) || 1;
  let best = null;
  for (const f of friends) {
    const p = f?.pos;
    if (!p) continue;
    // The cheap cut: the foot point against the line's x/z box.
    if (p[0] < Math.min(origin[0], end[0]) - margin || p[0] > Math.max(origin[0], end[0]) + margin
        || p[2] < Math.min(origin[2], end[2]) - margin || p[2] > Math.max(origin[2], end[2]) + margin) continue;
    const top = tops[f.stance] ?? tops.stand;
    const r = segmentDistance(origin, end, [p[0], p[1] + bottom, p[2]], [p[0], p[1] + top, p[2]]);
    if (r.dist > Math.min(radiusMax, radius + spread * r.s * limit)) continue;
    // A friend whose body overlaps the muzzle counts (the page logged victims
    // 0.2 m from it, one 0.12 m behind it); one wholly behind the bot does not.
    const ahead = ((p[0] - origin[0]) * dx + (p[2] - origin[2]) * dz) / h;
    if (ahead < -(opts.behind ?? HOLD_FIRE.behind)) continue;
    const along = r.s * limit;
    if (best && along >= best.along) continue;
    const lateral = ((p[0] - origin[0]) * dz - (p[2] - origin[2]) * dx) / h;
    best = { id: f.id, along, offset: r.dist, side: lateral >= 0 ? 1 : -1 };
  }
  return best;
}
