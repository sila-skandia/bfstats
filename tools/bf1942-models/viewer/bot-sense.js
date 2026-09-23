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
//  * What a SIDE knows of an enemy (read 2026-09-24; ledger AI-75): every
//    AI object holds one `Information` per side. Its own side's is an
//    `InformationReal` (`getSecurity` 0x085e8d10 is `fld1`); an object whose
//    template sets `commonKnowledge 1` (`AITemplate` +0x18, console
//    handler 0x08500260) is an `AIObjectShared` with one `InformationReal`
//    for everybody (`AIObjectShared::createInformation` 0x085db040). Any
//    other side gets an `InformationKnown`, made on demand the first time
//    that side asks for it (`AIObjectReal::getInformation` 0x085d8970 ->
//    `createInformation(t, side)` 0x085d8ca0, which ends in `setTime(t)`).
//    A bot asks when it rebuilds its sense candidates: `BotMain::sense`
//    takes every object of the band's frustum from `getWorldFrustumObjects`
//    (env vt+0x50) and calls `getInformation(own side)` on it, on an
//    occupied unit's occupier and on each secondary's occupier
//    (0x08521cf0, before any ray), so an enemy is known at security 1 the
//    first time it stands in any bot's frustum band, seen or not, and
//    nowhere in the side's grid before that. Asking again makes nothing
//    new and refreshes nothing. The
//    known one keeps its last refresh time t0 (+0x3c, written by every
//    `setTime(t)` 0x085e8050) and the template's `aiTemplate.degeneration`
//    D (+0x40, from `AITemplate` +0xc, console handler 0x084ff660; the ctor
//    0x085e7f50), and `getSecurity(t)` 0x085e8670 is
//    `1 - SCurve((t - t0) / D)`: 1 at a refresh, 0 once D seconds pass.
//    The soldier's template (`Objects/Soldiers/Common/AI/Objects.con`) has
//    `degeneration 15`.
//  * What refreshes it: `event_SpottedEnemyObject` 0x08523ae0 calls
//    `setTime(now)` on the spotted object's information and then on every
//    secondary object's (the other seats of a spotted hull); `updateMemory`
//    0x085244e0 calls it on a remembered object each time a re-test sees it
//    (0x08524b05). Hearing (`event_soundEmitter` 0x085237c0,
//    `updateHearingMemory` 0x085240e0) calls `setTime(now, 0.5)` 0x085e8210:
//    the quality is clamped to 0..1 and, only when the current security is
//    below it, t0 becomes `now - 1 / (q * D)` (the x87 is `fdivrp`,
//    checked against the bytes: 1 / (q D), not q D) -- an offset in seconds
//    that the security then divides by D again, so a heard enemy comes back
//    at `1 - SCurve(2 / D^2)`, 0.998 for a soldier. The engine's arithmetic,
//    kept as it is.
//  * `SCurve::calculate` 0x08658420: 0 below 0, 1 from 1, else the linear
//    blend of the 101-entry `SCurve::init` 0x08658030 table at `trunc(100
//    x)` (the fistp runs under a truncating control word, 0x08658457;
//    Ghidra shows ROUND).
//
// INVENTION, labelled: the environment grid is a scan of `world.players`;
// sense points are a fixed spread of heights on the body with a small lateral
// jitter; a hearing radius for a weapon is its AI template's
// `setSoundSphereRadius` when the page supplies it, else the soldier's 15 m;
// the FireObject decay rate is 1.0 (the collision handler's value was not
// read); a side's knowledge is keyed by player, not by AI object, so a
// soldier who boards a hull stays known as himself (the engine would ask
// about the seat's own object), and a player's record is dropped when he
// dies (the engine deletes the dead object's informations with it).

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

/** `SCurve::init` 0x08658030: `SCurve::curveValues`, 101 floats. */
export const SCURVE_TABLE = [
  0.0, 0.00224938989, 0.00338781998, 0.00463052979, 0.00598675013, 0.00746650994, 0.00908064004,
  0.0108407997, 0.0127597004, 0.0148508996, 0.0171288997, 0.0196096003, 0.0223098006, 0.0252474006,
  0.0284416005, 0.0319131017, 0.0356835015, 0.0397756994, 0.0442142002, 0.0490242988, 0.0542327985,
  0.0598676018, 0.0659573004, 0.0725317001, 0.0796212032, 0.0872564986, 0.0954684988, 0.104287997,
  0.113744996, 0.123869002, 0.134688005, 0.146227002, 0.158509001, 0.171553999, 0.185376003,
  0.199987993, 0.215393007, 0.231592, 0.248576, 0.266330004, 0.284830987, 0.304048002, 0.323940992,
  0.344460994, 0.365550995, 0.387147993, 0.409179002, 0.431564987, 0.45422399, 0.477064997, 0.5,
  0.52293402, 0.54577601, 0.568435013, 0.590821028, 0.612851977, 0.634449005, 0.655538976,
  0.676059008, 0.695951998, 0.715167999, 0.733669996, 0.751424015, 0.768408, 0.784606993,
  0.800011992, 0.814624012, 0.828445971, 0.841490984, 0.853772998, 0.86531198, 0.876130998,
  0.886255026, 0.895712018, 0.904532015, 0.912743986, 0.920378983, 0.927468002, 0.93404299,
  0.940132022, 0.945766985, 0.950976014, 0.95578599, 0.960223973, 0.964317024, 0.968087018,
  0.971557975, 0.974753022, 0.977689981, 0.980390012, 0.982870996, 0.985149026, 0.987240016,
  0.989158988, 0.990918994, 0.992533982, 0.994013011, 0.995369017, 0.996612012, 0.997750998, 1.0,
];

/** `SCurve::calculate` 0x08658420: the table at `trunc(100 x)`, blended. */
export function sCurveExact(x) {
  if (!(x < 1)) return 1;
  if (!(x >= 0)) return 0;
  const s = x * 100;
  const i = Math.trunc(s);
  const f = s - i;
  return (1 - f) * SCURVE_TABLE[i] + f * SCURVE_TABLE[i + 1];
}

/** A side's knowledge of an enemy object (`InformationKnown`). */
export const INFORMATION = {
  /** `aiTemplate.degeneration` of the soldier (`Objects/Soldiers/Common/
   *  AI/Objects.con`): seconds from a sighting to security 0. */
  soldierDegeneration: 15.0,
  /** `setTime(now, 0.5)` from `event_soundEmitter` / `updateHearingMemory`. */
  heardQuality: 0.5,
};

/** `InformationKnown::getSecurity(t)` 0x085e8670 for an information last
 *  refreshed `age` seconds ago with degeneration `D`. */
export function informationSecurity(age, degeneration = INFORMATION.soldierDegeneration) {
  return 1 - sCurveExact(age / degeneration);
}

/**
 * One side's `InformationKnown` records for the enemy: `id -> t0`. The
 * `setTime` calls of the spotting, re-sighting and hearing paths write it,
 * `EnemyStrengthTables` (bot-strength.js) reads it for `SAI::
 * updateStrengths`. `degenerationOf(id)` is each object's template value,
 * recorded from the units the strategic pass sees (the soldier's 15 until
 * then).
 */
export class SideKnowledge {
  constructor() {
    /** id -> t0 (+0x3c). */
    this.t0 = new Map();
    /** id -> `aiTemplate.degeneration` (+0x40). */
    this.degeneration = new Map();
  }

  degenerationOf(id) {
    const d = this.degeneration.get(id);
    return d > 0 ? d : INFORMATION.soldierDegeneration;
  }

  /** `getInformation(side)` 0x085d8970: made (at security 1) when missing,
   *  left alone when present. */
  contact(id, now) {
    if (id === null || id === undefined || this.t0.has(id)) return;
    this.t0.set(id, now);
  }

  /** `setTime(now)` 0x085e8050: made on first contact, refreshed after. */
  spotted(id, now) {
    if (id === null || id === undefined) return;
    this.t0.set(id, now);
  }

  /** `setTime(now, q)` 0x085e8210: raise to quality `q` only when below it. */
  heard(id, now, q = INFORMATION.heardQuality) {
    if (id === null || id === undefined) return;
    if (!this.t0.has(id)) { this.t0.set(id, now); return; }   // made at contact: security 1
    const s = Math.min(1, Math.max(0, q));
    const d = this.degenerationOf(id);
    if (!(this.security(id, now) < s)) return;
    this.t0.set(id, s === 0 ? 0 : now - 1 / (s * d));
  }

  /** The security the side holds for `id` at `now`, or null when it has no
   *  information on it (the object is in none of the side's grids). */
  security(id, now) {
    const t0 = this.t0.get(id);
    if (t0 === undefined) return null;
    return informationSecurity(now - t0, this.degenerationOf(id));
  }

  forget(id) {
    this.t0.delete(id);
    this.degeneration.delete(id);
  }

  clear() {
    this.t0.clear();
    this.degeneration.clear();
  }
}

function wrapAngle(a) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

/**
 * The position of a player record, or null.
 *
 * A seated player is where his seat is: `publishSeatPositions`
 * (`vehicle-instance.js`) writes the seat node's world position into
 * `position` every tick, for the human and a bot alike. His `soldier` record
 * is NOT moved while he rides, it stays where he climbed in, so reading it
 * first had every bot sense a pilot at the spot he boarded: an AA gunner
 * watched the human's Spitfire parking place while the Spitfire flew over him.
 */
export function playerPosition(player) {
  if (player?.occupancy?.root && player.position) {
    return [player.position[0], player.position[1], player.position[2]];
  }
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

/**
 * The frustum test of `BotMain::sense` 0x08521cf0: `Frustum::setupFrustum
 * (fov, 1.0, 0.01, viewDistance)` 0x08440c70 transformed by
 * `AIPlayer::getCameraTransformation`, so a SQUARE frustum (aspect 1.0) about
 * the camera: the same half-angle across and up / down, and nothing behind.
 * `basis` is the camera's `{ f, r, u }` (world unit vectors); without one
 * (a caller that only has a yaw) the test is the bearing alone.
 */
export function inFrustum(basis, yaw, dx, dy, dz, halfFov) {
  if (!basis) return Math.abs(wrapAngle(Math.atan2(dx, dz) - yaw)) <= halfFov;
  const { f, r, u } = basis;
  const a = dx * f[0] + dy * f[1] + dz * f[2];
  if (!(a > 0)) return false;
  const t = Math.tan(halfFov) * a;
  return Math.abs(dx * r[0] + dy * r[1] + dz * r[2]) <= t && Math.abs(dx * u[0] + dy * u[1] + dz * u[2]) <= t;
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
    /** The bot's side's `SideKnowledge` (the referee hands it the side's
     *  `EnemyStrengthTables.knowledge`); null: nobody reads it. */
    this.knowledge = null;
  }

  /** `event_SpottedEnemyObject` 0x08523ae0: `setTime(now)` on the object
   *  and on every other seat of its hull. */
  _spotted(now, world, id, player) {
    const k = this.knowledge;
    if (!k) return;
    k.spotted(id, now);
    const owner = this.unitOwnerOf?.(player) ?? -1;
    if (owner === -1 || owner === null || owner === undefined) return;
    for (const [pid, p] of world.players) {
      if (pid !== id && p !== player && this.unitOwnerOf(p) === owner) k.spotted(pid, now);
    }
  }

  /** The security the bot's side holds for `id` (1 without a knowledge
   *  store, null when the side has never spotted or heard it). */
  securityOf(id, now) {
    return this.knowledge ? this.knowledge.security(id, now) : 1;
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
  sense(now, world, me, eye, yaw, basis = null) {
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
      if (!inFrustum(basis, yaw, dx, pos[1] - eye[1], dz, halfFov)) continue;
      candidates++;
      this.knowledge?.contact(id, now);                     // getInformation(own side), before the rays
      if (this.memory.has(id)) continue;                    // updateMemory re-tests those
      if (this._rays(world.collider, eye, player, pos, d)) {
        // The record also carries the per-weapon shots fired at this target
        // and hits on it (+0x34 / +0x54), the Fire behaviour's miss penalty.
        this.memory.set(id, { id, seen: true, lastSeen: now, lost: false, lostAt: null,
                              pos: [...pos], team: player.team ?? 0, shots: [], hits: [] });
        this._spotted(now, world, id, player);
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
  updateMemory(now, world, me, eye, yaw, basis = null) {
    const fovs = this.isMobile ? FRUSTUM_FOV.mobile : FRUSTUM_FOV.infantry;
    const halfFov = fovs[0] / 2;
    const myTeam = me?.team ?? null;
    for (const [id, m] of this.memory) {
      const player = world.players.get(id);
      const pos = playerPosition(player);
      if (!player || !pos || player.team === myTeam || world.armorOf?.(id)?.destroyed) {
        this.memory.delete(id);
        // A dead object's informations go with it (`deleteAllInformation`).
        if (!player || world.armorOf?.(id)?.destroyed) this.knowledge?.forget(id);
        continue;
      }
      m.pos[0] = pos[0]; m.pos[1] = pos[1]; m.pos[2] = pos[2];   // the live transform
      const dx = pos[0] - eye[0], dz = pos[2] - eye[2];
      const d = Math.hypot(dx, pos[1] - eye[1], dz);
      const inView = d <= this.viewDistance && inFrustum(basis, yaw, dx, pos[1] - eye[1], dz, halfFov);
      const seen = inView && this._rays(world.collider, eye, player, pos, d);
      if (seen) {
        m.seen = true; m.lost = false; m.lostAt = null; m.lastSeen = now;
        this.knowledge?.spotted(id, now);     // 0x08524b05: the entry's own information
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
    this.knowledge?.heard(shooterId, now);     // `setTime(now, 0.5)`
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
