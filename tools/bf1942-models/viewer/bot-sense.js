// A bot's senses: vision, vision memory, hearing, and the incoming-fire
// ledger — `BotMain::sense`, `updateMemory`, `updateHearingMemory`,
// `soundPerceptionCalculation` and `event_projectile`, as read on 2026-09-23
// (features/bf1942-ai-research-2026-09-21/bot-behaviours.md §1; the earlier
// ai-22-sensing-decoded.md is corrected there).
//
// What the engine does (bf1942_lnxded.static, `dice::bf::ai`):
//
//  * `BotMain::sense` 0x08521cf0 cycles three sub-states per pass, each a
//    frustum over a band of the view distance (`tweak_frustumUpdateState
//    MinMaxDistances` 0x086ffed8: 0..50 %, 50..75 %, 75..100 %) with its own
//    full field of view (`tweak_frustumUpdateAngle` 0x087d0860: infantry
//    100 / 60 / 30 deg, a vehicle 75 / 45 / 15 deg; near plane 0.01). The
//    band's objects come from the environment grid through `SideFilter::
//    predicate` 0x08533120: not the bot's side; a neutral only when it is a
//    unit; inside the view distance.
//  * Each candidate not yet in memory gets `n = clamp(round(30 * radius /
//    distance), 1, 10)` rays from the eye to random sense points on its body
//    (`pickSoldierRandomSensePosition`, env vtable +0x60), tested with
//    `collideLineWithWorld` (+0x54); one clear ray spots it
//    (`event_SpottedEnemyObject` 0x08523ae0, which also tells every bot in
//    the same vehicle).
//  * `updateMemory` 0x085244e0 re-tests every remembered object that is inside
//    the near frustum: seen refreshes it; the first miss marks it lost and the
//    entry is erased `60.0` s after that. The remembered point is a body-fixed
//    offset re-projected through the object's LIVE transform, so a bot knows
//    where a lost enemy actually is until the memory expires. The spotted
//    list the Fire behaviour scores is rebuilt from every entry, seen or lost.
//  * Hearing: `soundPerceptionCalculation` 0x08523290 hears an enemy that
//    fired within `3.0` s inside its weapon's sound radius, else any mobile
//    enemy inside the listener's own sound sphere (`setSoundSphereRadius 0
//    15` for a soldier), unless that soldier is crouched or prone; the
//    probability roll is `((1 - d) * pMin + d * pMax) * (1 - x) < rand` with
//    `x = max(speed / maxSpeed, 1)` — always true for a listener with a
//    mobile plug-in, so hearing is deterministic inside the radius. A bot is
//    deaf for `3.0` s after its own shot (`+0x118`, `event_firing`) and keeps
//    a heard object for `30.0` s.
//  * Incoming fire: `event_projectile` 0x085269e0 appends a `FireObject`
//    (strength per armour class, time, decay rate); `updateMemory` sums
//    `strength * 1 / (age * rate + 1)` (x10 for a hit) over a list that lives
//    `min(60 / n, 5)` s, and keeps an attacker map for `max(300 / n, 10)` s
//    that `isAttacking` reads.
//
// INVENTION, labelled: the environment grid is a scan of `world.players`;
// sense points are a fixed spread of heights on the body with a small lateral
// jitter; a hearing radius for a weapon is its AI template's
// `setSoundSphereRadius` when the page supplies it, else the soldier's 15 m;
// the FireObject decay rate is 1.0 (the collision handler's value was not
// read).

const DEG = Math.PI / 180;

/** `tweak_frustumUpdateAngle`: full field of view per sub-state. */
export const FRUSTUM_FOV = {
  infantry: [100 * DEG, 60 * DEG, 30 * DEG],
  mobile: [75 * DEG, 45 * DEG, 15 * DEG],
};
/** `tweak_frustumUpdateStateMinMaxDistances`: the band of the view distance. */
export const FRUSTUM_BANDS = [[0, 0.5], [0.5, 0.75], [0.75, 1.0]];
export const FRUSTUM_NEAR = 0.01;
/** `updateMemory`: erase a lost object this long after it was lost. */
export const MEMORY_EXPIRY = 60.0;
/** `updateHearingMemory`: keep a heard object this long. */
export const HEARING_RETENTION = 30.0;
/** `soundPerceptionCalculation`: deaf after the bot's own shot, and the
 *  window in which a shot's own sound radius counts. */
export const DEAF_AFTER_FIRE = 3.0;
export const SHOT_SOUND_WINDOW = 3.0;
/** `aiTemplatePlugIn.setSoundSphereRadius 0.0 15.0` on the soldier. */
export const SOLDIER_SOUND_RADIUS = 15.0;
/** Rays per candidate: `clamp(round(30 * radius / distance), 1, 10)`. */
export const RAYS_PER_METRE_RADIUS = 30;
export const RAYS_MAX = 10;
/** A soldier's bounding radius as the AI object reports it (INVENTION: the
 *  value is the collision sphere's, not read). */
export const SOLDIER_RADIUS = 1.0;
/** Incoming-fire list and attacker-map lifetimes. */
export const FIRE_LIST_TTL = 5.0;
export const FIRE_LIST_BUDGET = 60.0;
export const ATTACKER_TTL = 10.0;
export const ATTACKER_BUDGET = 300.0;
export const FIRE_DECAY_RATE = 1.0;
/** Heights on a standing body the sense rays aim at (INVENTION). */
const SENSE_HEIGHTS = [0.3, 0.8, 1.2, 1.55];
const SENSE_JITTER = 0.25;
/** The eye above the feet, per stance. */
const EYE = { stand: 1.6, crouch: 1.1, prone: 0.4, walk: 1.6 };

function wrapAngle(a) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

/** The position of a player record, or null. */
export function playerPosition(player) {
  if (player?.soldier) return [player.soldier.x, player.soldier.y, player.soldier.z];
  if (player?.position) return [player.position[0], player.position[1], player.position[2]];
  if (player?.vehicle?.state?.position) {
    const s = player.vehicle.state.position;
    return [s.x, s.y, s.z];
  }
  return null;
}

/**
 * Line of sight through the world: the collider's ray (`WorldCollider.cast`)
 * when it exists, else the terrain-height march the earlier build used.
 * Returns true when nothing solid lies between `from` and `to`.
 *
 * `skip` is an owner id or a list of them: the sense rays of `BotMain::sense`
 * 0x08521cf0 go through `collideLineWithWorld` (environment +0x54) ignoring
 * the bot's own unit, the target and the target's vehicle. A seated bot's
 * eye sits inside its own hull's collision, so without the skip every ray
 * from a plane ended a metre out, on its own fuselage. The collider takes
 * one owner to skip; a hit on another skipped owner re-casts past it.
 */
export function lineClear(collider, from, to, skip = -1) {
  if (!collider) return true;
  const dx = to[0] - from[0], dy = to[1] - from[1], dz = to[2] - from[2];
  const dist = Math.hypot(dx, dy, dz);
  if (!(dist > 1e-4)) return true;
  if (typeof collider.cast === 'function') {
    const skips = (Array.isArray(skip) ? skip : [skip]).filter(o => o !== -1 && o !== null && o !== undefined);
    const first = skips.length ? skips[0] : -1;
    const ux = dx / dist, uy = dy / dist, uz = dz / dist;
    let start = 0;
    for (let i = 0; i < 4; i++) {
      const hit = collider.cast(from[0] + ux * start, from[1] + uy * start, from[2] + uz * start,
                                ux, uy, uz, dist - 0.05 - start, first);
      if (!hit) return true;
      if (!skips.includes(hit.owner)) return false;
      start += (hit.t ?? 0) + 0.05;
      if (start >= dist - 0.05) return true;
    }
    return false;
  }
  if (typeof collider.surfaceHeight !== 'function') return true;
  const steps = Math.min(12, Math.max(1, Math.ceil(dist / 2)));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const y = from[1] + dy * t;
    const h = collider.surfaceHeight(from[0] + dx * t, from[2] + dz * t);
    if (Number.isFinite(h) && h > y + 0.3) return false;
  }
  return true;
}

export class BotSenses {
  constructor({ viewDistance = 600, isMobile = false, random = Math.random } = {}) {
    this.viewDistance = viewDistance;
    /** The collision owner of the unit the bot sits in (-1 on foot) and a
     *  `player -> owner` lookup for a target's unit: the rays skip both. */
    this.selfOwner = -1;
    this.unitOwnerOf = null;
    this.isMobile = isMobile;
    this.random = random;
    /** Vision memory: id -> { id, seen, lastSeen, lost, lostAt, pos, team }. */
    this.memory = new Map();
    /** Hearing memory: id -> { id, pos, time }. */
    this.heard = new Map();
    /** Incoming fire: { time, strength, attacker, hit }. */
    this.incoming = [];
    /** Attacker map: id -> last FireObject. */
    this.attackers = new Map();
    /** `+0x118`: the bot's own last shot. */
    this.lastOwnFire = -Infinity;
    /** `+0x10c`: the frustum sub-state this pass. */
    this.substate = 0;
    /** The yaw the current sub-state's frustum was built for. */
    this._frustumYaw = null;
    /** Scratch: the last sense pass's candidates, for the debug hook. */
    this.lastCandidates = 0;
  }

  /** The eye position of a soldier record. */
  static eyeOf(soldier, stance) {
    return [soldier.x, soldier.y + (EYE[stance] ?? 1.6), soldier.z];
  }

  /**
   * One sensing pass (`BotMain::sense`): the current sub-state's band and
   * fov, the side filter, then the rays. `me` is the bot's player record,
   * `eye` its eye position, `yaw` its facing.
   */
  sense(now, world, me, eye, yaw) {
    const fovs = this.isMobile ? FRUSTUM_FOV.mobile : FRUSTUM_FOV.infantry;
    // The engine rebuilds the query frustum when the camera has turned past
    // the sub-state's threshold (25 / 15 / 7.5 deg), otherwise it keeps
    // sweeping the same frustum; a fresh pass each tick is the simpler
    // reading that sees at least as much.
    const sub = this.substate;
    const [lo, hi] = FRUSTUM_BANDS[sub];
    const halfFov = fovs[sub] / 2;
    const minD = Math.max(FRUSTUM_NEAR, lo * this.viewDistance);
    const maxD = hi * this.viewDistance;
    const myTeam = me?.team ?? null;
    let candidates = 0;
    for (const [id, player] of world.players) {
      if (player === me || id === me?.id) continue;
      if (player.team === myTeam) continue;                 // SideFilter: own side
      if ((player.team === 0 || player.team == null) && !player.soldier) continue; // neutral non-unit
      if (world.armorOf?.(id)?.destroyed) continue;
      const pos = playerPosition(player);
      if (!pos) continue;
      const dx = pos[0] - eye[0], dz = pos[2] - eye[2];
      const d = Math.hypot(dx, pos[1] - eye[1], dz);
      if (d > this.viewDistance) continue;                  // SideFilter: viewDist
      if (d < minD || d > maxD) continue;                   // this sub-state's band
      const bearing = Math.atan2(dx, dz);
      if (Math.abs(wrapAngle(bearing - yaw)) > halfFov) continue;
      candidates++;
      if (this.memory.has(id)) continue;                    // updateMemory re-tests those
      if (this._rays(world.collider, eye, player, pos, d)) {
        // The record also carries the per-weapon shots fired at this target
        // and hits on it (+0x34 / +0x54), the Fire behaviour's miss penalty.
        this.memory.set(id, { id, seen: true, lastSeen: now, lost: false, lostAt: null,
                              pos: [...pos], team: player.team ?? 0, shots: [], hits: [] });
      }
    }
    this.lastCandidates = candidates;
    this.substate = (sub + 1) % 3;
  }

  /** The sense rays against one candidate: any clear ray spots it. */
  _rays(collider, eye, player, pos, dist) {
    const radius = SOLDIER_RADIUS;
    const n = Math.max(1, Math.min(RAYS_MAX, Math.round(RAYS_PER_METRE_RADIUS * radius / Math.max(dist, 0.1))));
    const stance = player.soldier?.stance ?? 'stand';
    const top = stance === 'prone' ? 0.5 : stance === 'crouch' ? 1.1 : 1.7;
    for (let i = 0; i < n; i++) {
      const h = (i === 0 && n > 1) ? Math.min(top, 1.0)
        : Math.min(top, SENSE_HEIGHTS[i % SENSE_HEIGHTS.length]);
      const jx = (this.random() * 2 - 1) * SENSE_JITTER;
      const jz = (this.random() * 2 - 1) * SENSE_JITTER;
      const point = [pos[0] + jx, pos[1] + h, pos[2] + jz];
      if (lineClear(collider, eye, point, [this.selfOwner, this.unitOwnerOf?.(player) ?? -1])) return true;
    }
    return false;
  }

  /**
   * `updateMemory`: re-test every remembered object inside the near frustum,
   * mark the misses lost, erase the expired, drop friendlies and the dead,
   * and keep every entry's position live.
   */
  updateMemory(now, world, me, eye, yaw) {
    const fovs = this.isMobile ? FRUSTUM_FOV.mobile : FRUSTUM_FOV.infantry;
    const halfFov = fovs[0] / 2;
    const myTeam = me?.team ?? null;
    for (const [id, m] of this.memory) {
      const player = world.players.get(id);
      const pos = playerPosition(player);
      if (!player || !pos || player.team === myTeam || world.armorOf?.(id)?.destroyed) {
        this.memory.delete(id);
        continue;
      }
      m.pos[0] = pos[0]; m.pos[1] = pos[1]; m.pos[2] = pos[2];   // the live transform
      const dx = pos[0] - eye[0], dz = pos[2] - eye[2];
      const d = Math.hypot(dx, pos[1] - eye[1], dz);
      const inView = d <= this.viewDistance
        && Math.abs(wrapAngle(Math.atan2(dx, dz) - yaw)) <= halfFov;
      const seen = inView && this._rays(world.collider, eye, player, pos, d);
      if (seen) {
        m.seen = true; m.lost = false; m.lostAt = null; m.lastSeen = now;
      } else if (!m.lost) {
        m.seen = false; m.lost = true; m.lostAt = now;
      } else if (now - m.lostAt > MEMORY_EXPIRY) {
        this.memory.delete(id);
      }
    }
    this._expireIncoming(now);
    for (const [id, h] of this.heard) {
      if (now - h.time > HEARING_RETENTION) this.heard.delete(id);
    }
  }

  /** The spotted-enemy list the Fire behaviour scores: every entry. */
  spottedEnemies() {
    return [...this.memory.values()];
  }

  /** The closest currently-visible entry, or null (a convenience). */
  closestVisible(from) {
    let best = null, bestD = Infinity;
    for (const m of this.memory.values()) {
      if (!m.seen) continue;
      const d = Math.hypot(m.pos[0] - from[0], m.pos[2] - from[2]);
      if (d < bestD) { bestD = d; best = m; }
    }
    return best;
  }

  /** `event_firing`: the bot's own shot starts the deaf window. */
  onOwnFire(now) {
    this.lastOwnFire = now;
  }

  /**
   * `event_soundEmitter` + `soundPerceptionCalculation`: an enemy `shooterId`
   * at `pos` fired (or is moving) — hear it inside its radius unless deaf.
   * `weaponRadius` is the weapon's AI sound radius when the shot is recent.
   */
  hear(now, shooterId, shooterTeam, pos, listenerPos, myTeam, {
    weaponRadius = null, firedAt = null, pose = 'stand',
  } = {}) {
    if (now - this.lastOwnFire < DEAF_AFTER_FIRE) return false;
    if (shooterTeam === myTeam) return false;
    const d = Math.hypot(pos[0] - listenerPos[0], pos[1] - listenerPos[1], pos[2] - listenerPos[2]);
    let radius;
    if (weaponRadius != null && firedAt != null && now - firedAt < SHOT_SOUND_WINDOW) {
      radius = weaponRadius;
    } else {
      if (pose === 'crouch' || pose === 'prone') return false;
      radius = SOLDIER_SOUND_RADIUS;
    }
    if (d > radius) return false;
    this.heard.set(shooterId, { id: shooterId, pos: [...pos], time: now });
    return true;
  }

  /** The freshest heard object, or null. */
  latestHeard() {
    let best = null;
    for (const h of this.heard.values()) if (!best || h.time > best.time) best = h;
    return best;
  }

  /** `event_projectile`: a round from `attackerId` with `strength` against
   *  this bot's armour class; `hit` when it landed. */
  onIncomingFire(now, attackerId, strength, hit = false, pos = null) {
    const f = { time: now, strength, attacker: attackerId, hit, rate: FIRE_DECAY_RATE,
                pos: pos ? [...pos] : null, aimed: hit };
    this.incoming.push(f);
    if (attackerId != null) this.attackers.set(attackerId, f);
  }

  _expireIncoming(now) {
    const listTtl = Math.min(FIRE_LIST_BUDGET / Math.max(1, this.incoming.length), FIRE_LIST_TTL);
    this.incoming = this.incoming.filter(f => now - f.time <= listTtl);
    const mapTtl = Math.max(ATTACKER_BUDGET / Math.max(1, this.attackers.size), ATTACKER_TTL);
    for (const [id, f] of this.attackers) if (now - f.time > mapTtl) this.attackers.delete(id);
  }

  /** `getIncommingFireTotalStrengthAgainstSelf`: the decayed sum. */
  incomingStrength(now) {
    let total = 0;
    for (const f of this.incoming) {
      const k = 1 / ((now - f.time) * f.rate + 1);
      total += f.strength * k * (f.hit ? 10 : 1);
    }
    return total;
  }

  /** `isAttacking`: when `id` last fired at this bot, or -1000. */
  attackedBy(id) {
    const f = this.attackers.get(id);
    return f ? f.time : -1000;
  }
}
