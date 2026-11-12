// The infantry behaviours other than MoveTo and Fire — Scout, TakeCover,
// Idle — and the two curve tables every urgency passes through. Read on
// 2026-09-23 (features/bf1942-ai-research-2026-09-21/bot-behaviours.md §4-6):
//
//  * `DecleiningSlopeCurve::calculate` 0x08655560 and `SCurve::calculate`
//    0x08658420 are 101-entry tables read at `x * 100` and clamped to
//    `[0, 1]`: SCurve blends its two neighbours, Declein takes the lower
//    entry (both tables as the binary writes them, 2026-11-12).
//  * `BBScout::calculateUrgency` 0x08579a50 bins every threat around the bot
//    into eight quadrants (`computeQuadrants` 0x08579150, 25 / 45 deg cones)
//    weighted by each quadrant's inertia (`BotMain+0x1f0`: seconds since
//    the camera last covered it): incoming fire (`strength / (age * decay +
//    1)`, floor 0.1), heard enemies (their threat, aged over 30 s when not
//    heard directly), lost sightings (`threat / (d * 0.01 + 1) * age`), and
//    attackers (`10 * strength`, x3 into danger). The winning quadrant's
//    direction is the look target; a direction within 5 deg of the camera is
//    no scout. `urgency = Declein((accum * 0.2 + interest * 0.1) * boost)`
//    where `accum` starts at 100 (a fresh bot looks around at full urgency)
//    and is zeroed when the Sense instruction completes (10 deg). The plan
//    (`BBPScoutInfantery::createPlan` 0x085c5070) does not move: look, sense,
//    a pose.
//  * `BBTakeCoverInfantry::calculateUrgency` 0x08580140 sums danger by
//    quadrant: incoming fire fading over 3 s, heard enemies `security *
//    threat / d` attenuated by `1 - SCurve(d / weaponRange)`, spotted enemies
//    `threat^2 / d` (x0.5 .. x1 by staleness over 30 s). `getCoverObject`
//    0x08581a70 takes the environment's cover objects, refuses one lying past
//    the halfway line toward the threat, walks to `0.75 R .. 2 R` behind it
//    along threat -> cover (`traceValidPoint`), and scores `base * coverValue
//    / distance` with `base = 0.25 * clamp(0.2 * widthRatio) + 0.75 *
//    clamp(0.5 * heightRatio)`. `urgency = Declein(total) * Declein(d * 0.01)
//    * k`, zero when the threat cannot see the bot. Without cover the plan
//    (`BBPTakeCoverInfantry::createPlan` 0x085c97d0) walks to the lowest
//    ground in a 100 m box on the far side and goes prone. Arrival radius
//    `max(4, 0.5 * maxSpeed)`.
//  * `BBIdle::calculateUrgency` 0x08572550 returns its modifier; the plan
//    (`BBPIdleInfantery::createPlan` 0x085bea00) is `while (true) reset
//    controls`.
//
// INVENTION, labelled: the environment's cover list is the level's placed
// statics whose template has a `coverValue`, within the soldier's
// `coverSearchRadius 20`; a cover object's extents are its collider box; the
// per-strength threat a soldier poses is its `setBattleStrength`.

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

/** `DecleiningSlopeCurve::init` 0x08655170: `DecleiningSlopeCurve::
 *  curveValues`, the 101 floats it writes (`movl $0x3cef8d24,0x4(%eax)` ..
 *  `movl $0x3f800000,0x190(%eax)`). */
export const DECLEIN_TABLE = [
  0, 0.0292421058, 0.0584842116, 0.0877263099, 0.116968423, 0.146210521, 0.17545262, 0.204694748,
  0.233936846, 0.263178945, 0.292421043, 0.321663141, 0.35090524, 0.380147398, 0.409389496,
  0.438631594, 0.467873693, 0.497115791, 0.526357889, 0.551246345, 0.578947365, 0.604010522,
  0.626794755, 0.647596836, 0.666666329, 0.684210539, 0.7004053, 0.715399981, 0.729323208,
  0.742286325, 0.754386306, 0.765704215, 0.776315808, 0.786284208, 0.795665324, 0.804511547,
  0.812865257, 0.820768476, 0.828254759, 0.835357904, 0.842105269, 0.848524213, 0.854636908,
  0.860465288, 0.866028428, 0.871345282, 0.876430511, 0.881298959, 0.885965288, 0.890439987,
  0.894736886, 0.898865283, 0.9028337, 0.906653643, 0.910331607, 0.913875818, 0.917293727,
  0.92059058, 0.923774779, 0.926850557, 0.929824233, 0.932701111, 0.935484231, 0.938178957,
  0.940789521, 0.943319976, 0.945773721, 0.948153675, 0.950464189, 0.95270735, 0.95488739,
  0.957005262, 0.959064245, 0.961067379, 0.963015795, 0.964912653, 0.966758907, 0.968557894,
  0.970310569, 0.972018957, 0.973684251, 0.975308418, 0.976893723, 0.978439987, 0.979949474,
  0.981424272, 0.982864201, 0.984270513, 0.985646307, 0.986989498, 0.988304257, 0.989589512,
  0.990846336, 0.992076874, 0.993281066, 0.994460046, 0.995613754, 0.996744215, 0.99785161,
  0.998936832, 1,
];

/** `DecleiningSlopeCurve::calculate` 0x08655560: 0 at or below 0, 1 from 1,
 *  else the table at `i = clamp(trunc(100 x), 0, 99)` with NO blend: its
 *  fraction is `fld %st(0); fsubp` (0x086555a6..0x086555ab), x100 less
 *  itself, so 0, and the result is `table[i]` (`SCurve::calculate` reloads
 *  the integer with `fildl` and blends; this one does not). A step curve, the
 *  engine's arithmetic kept as it is. */
export function decleiningSlope(x) {
  if (!(x > 0)) return 0;
  if (x >= 1) return 1;
  const i = Math.min(99, Math.max(0, Math.trunc(x * 100)));
  return DECLEIN_TABLE[i];
}
/** `SCurve::calculate` 0x08658420, the exact 101-entry table (bot-sense.js). */
export function sCurve(x) { return sCurveExact(x); }

/** The eight sensing quadrants: four azimuths x {level, up}. `computeQuadrants`
 *  splits a direction into azimuth bins with 45 deg cones and an elevation
 *  bin at 25 deg (INFERRED from its cosines 0.7071 and 0.9063). */
export const QUADRANTS = 8;
export function quadrantOf(dx, dy, dz) {
  const yaw = Math.atan2(dx, dz);
  const az = ((Math.round(yaw / (Math.PI / 2)) % 4) + 4) % 4;
  const h = Math.hypot(dx, dz) || 1e-6;
  const up = Math.atan2(dy, h) > 25 * Math.PI / 180 ? 1 : 0;
  return az + 4 * up;
}
export function quadrantDirection(q) {
  const az = q % 4, up = q >= 4;
  const yaw = az * (Math.PI / 2);
  return [Math.sin(yaw), up ? 0.6 : 0, Math.cos(yaw)];
}

const DEG = Math.PI / 180;

export const SCOUT = {
  initialAccum: 100.0,
  accumWeight: 0.2,
  interestWeight: 0.1,
  inertiaWeight: 0.01,
  inertiaWeightCover: 0.005,
  boostDefault: 0.75,
  boostAttacker: 1.0,
  fireFloor: 0.1,
  soundAge: 30.0,
  lostFalloff: 0.01,
  attackerStrength: 10,
  attackerDanger: 3,
  quadDoneAfter: 5.0,
  lookGate: 0.087,
  senseDeviation: 10 * Math.PI / 180,
  planReuseCos: 0.95,
};

export const TAKE_COVER = {
  fireFade: 3.0,
  minDistance: 2.0,
  staleCap: 30.0,
  distanceCap: 100.0,
  distanceScale: 0.01,
  halfwayFraction: 0.5,
  behindNear: 0.75,
  behindFar: 2.0,
  widthWeight: 0.25, widthScale: 0.2,
  heightWeight: 0.75, heightScale: 0.5,
  arriveMin: 4.0,
  noCoverBox: 100.0,
  noCoverStep: 4.0,
  reuseMoveStatic: 3.0,
  reuseMoveObject: 1.0,
  coverSearchRadius: 20.0,
  saiUrgency: 0.2,
};

/**
 * The Scout generator's per-bot state and evaluation.
 */
export class ScoutState {
  constructor() {
    this.accum = SCOUT.initialAccum;
    this.lastQuad = -1;
    this.timer = 0;
    this.lookDir = null;
    this.invAttention = 1.0;
    this.senseDone = false;
  }

  /**
   * `BBScout::calculateUrgency`. `ctx` carries `now`, `dt`, `position`,
   * `yaw`, `pitch`, `quadInertia` (8 floats), `incoming` (BotSenses list),
   * `heard`, `spotted`, `attackers`, `isScouting`, `coverActive`.
   * Returns `{ urgency, dir, quad }`.
   */
  evaluate(ctx) {
    this.timer += ctx.dt;
    if (ctx.isScouting && this.lastQuad !== -1 && this.timer > SCOUT.quadDoneAfter) {
      ctx.quadInertia[this.lastQuad] = 0;
      this.accum = 0;
      this.timer = 0;
    } else {
      this.accum *= this.invAttention;
    }
    if (this.invAttention === 0) { this.invAttention = 1.0; this.timer = 0; }
    const weight = ctx.coverActive ? SCOUT.inertiaWeightCover : SCOUT.inertiaWeight;
    const interest = new Float32Array(QUADRANTS);
    const boost = new Float32Array(QUADRANTS).fill(SCOUT.boostDefault);
    const maxAt = new Float32Array(QUADRANTS);
    const source = new Array(QUADRANTS).fill(null);
    for (let q = 0; q < QUADRANTS; q++) interest[q] = ctx.quadInertia[q] * weight;
    const add = (pos, value, tag) => {
      const q = quadrantOf(pos[0] - ctx.position[0], pos[1] - ctx.position[1], pos[2] - ctx.position[2]);
      interest[q] += value;
      if (value > maxAt[q]) { maxAt[q] = value; source[q] = { pos, tag }; }
      return q;
    };
    for (const f of ctx.incoming) {
      const s = Math.max(SCOUT.fireFloor, f.strength / ((ctx.now - f.time) * f.rate + 1));
      if (f.pos) add(f.pos, s, 'fire');
    }
    for (const h of ctx.heard) {
      let v = h.threat ?? 4;
      if (!h.direct) v *= Math.min(1, (ctx.now - h.time) / SCOUT.soundAge);
      add(h.pos, v, 'sound');
    }
    for (const m of ctx.spotted) {
      if (!m.lost) continue;
      const d = Math.hypot(m.pos[0] - ctx.position[0], m.pos[2] - ctx.position[2]);
      const v = (m.threat ?? 4) / (d * SCOUT.lostFalloff + 1) * Math.max(0, ctx.now - m.lastSeen);
      add(m.pos, v, 'lost');
    }
    for (const a of ctx.attackers) {
      const s = SCOUT.attackerStrength * a.strength / ((ctx.now - a.time) * a.rate + 1);
      const q = add(a.pos, s, 'attacker');
      boost[q] = SCOUT.boostAttacker;
    }
    let sum = 0, best = -1, bestV = -Infinity;
    for (let q = 1; q < QUADRANTS; q++) sum += interest[q];
    for (let q = 0; q < QUADRANTS; q++) {
      if (interest[q] > bestV || (interest[q] === bestV && q === this.lastQuad)) {
        bestV = interest[q]; best = q;
      }
    }
    if (best < 0) return { urgency: 0, dir: null, quad: -1 };
    let dir;
    const src = source[best];
    if (src && src.tag !== 'fire') {
      const dx = src.pos[0] - ctx.position[0], dy = src.pos[1] - ctx.position[1], dz = src.pos[2] - ctx.position[2];
      const len = Math.hypot(dx, dy, dz) || 1;
      dir = [dx / len, dy / len, dz / len];
    } else {
      // `getQuadRecommendedLookDirection`: the quadrant's own direction,
      // jittered by multiples of 22.5 deg scaled by the inertia.
      const base = quadrantDirection(best);
      const jitter = (1 - Math.min(25, ctx.quadInertia[best]) / 30) * (Math.random() - 0.5) * (Math.PI / 4);
      const yaw = Math.atan2(base[0], base[2]) + jitter;
      dir = [Math.sin(yaw), base[1], Math.cos(yaw)];
    }
    // The 5 deg gate: a direction the camera already covers is no scout.
    const fwdX = Math.sin(ctx.yaw), fwdZ = Math.cos(ctx.yaw);
    const rightX = Math.cos(ctx.yaw), rightZ = -Math.sin(ctx.yaw);
    const side = Math.abs(dir[0] * rightX + dir[2] * rightZ);
    const vert = Math.abs(dir[1] - Math.sin(ctx.pitch ?? 0));
    if (side < SCOUT.lookGate && vert < SCOUT.lookGate && dir[0] * fwdX + dir[2] * fwdZ > 0) {
      this.lastQuad = -1;
      return { urgency: 0, dir: null, quad: best, changed: true };
    }
    const changed = this.lastQuad !== best;
    this.lastQuad = best;
    this.lookDir = dir;
    const urgency = decleiningSlope((this.accum * SCOUT.accumWeight + sum * SCOUT.interestWeight) * boost[best]);
    return { urgency, dir, quad: best, changed };
  }

  /** `EntrySense::execute` completing: the look is within 10 deg. */
  senseComplete() {
    this.invAttention = 0;
  }
}

/**
 * The TakeCover generator: threat by quadrant, the cover choice, the point
 * behind it.
 */
/**
 * `BBMedicAssist::calculateUrgency` 0x08573840 (read 2026-09-23): the
 * Special behaviour of a bot carrying a healing weapon (`weaponTemplate.
 * healing 1`: the MedPack, the RepairPack). Not while wading deeper than
 * 0.75 m. Per healing weapon with more than one round, the best
 * `strength[type]` and its `maxRange` per target type; every friendly unit
 * the environment lists whose health is under 95 % (and above 0), upright
 * (ground normal . up >= 0.7071), not inside another object, and — when
 * beyond that weapon's range — standing on a valid cell of the bot's map,
 * scores `value / (d * SCurve(health))` (x0.75 outside the bot's ordered
 * area); the sum feeds `Declein(sum) * 4 * k`, the best term (x `1 +
 * radio`) picks the target, and `BBPMedicAssist::init` gets it. The plan
 * (`BBPMedicAssist::createPlan` 0x085bf350): reset, the healing weapon,
 * `MoveToObjectFinding` to `R_target + 0.9 * maxRange` when farther, then
 * while the target exists, is under 95 % and within that distance and the
 * magazine has rounds: `LookAtObject` within 5 deg and the trigger held.
 */
export const MEDIC = {
  waterGate: 0.75,
  healthBelow: 0.95,
  uprightCos: 0.7071,
  rangeFraction: 0.9,
  lookTolerance: 5 * DEG,
  urgencyScale: 4.0,
  outsideAreaFactor: 0.75,
  /** The environment's friendly-unit query radius (INVENTION: not read). */
  searchRadius: 60.0,
  /** A unit's `Information+0x14` value term (INVENTION: 1 per soldier). */
  unitValue: 1.0,
  // What a round of the bag heals is not this state's: the bot fires its
  // MedPack through the human's `useMedPack` law (`bot-referee.js` `usePack`,
  // `healing-packs.js`; SUP-27), every wounded soldier within `healDistance`.
};

export class MedicState {
  constructor() {
    this.targetId = null;
    this.weaponIndex = -1;
    this.arrive = 0;
    this.lastUrgency = 0;
  }

  /**
   * `ctx`: `now`, `position`, `waterDepth`, `weapons` (AI entries with
   * `healing`, `strength`, `maxRange`, `ammo`), `friends` (`{ id, pos,
   * health (0..1), upright, inVehicle, radius, type }`), `isWalkable(x, z)`,
   * `insideMyArea(x, z)` or null, `mod`. Returns `{ urgency, targetId,
   * weaponIndex, arrive, changed }`.
   */
  evaluate(ctx) {
    const none = { urgency: 0, targetId: null, weaponIndex: -1, arrive: 0, changed: false };
    if ((ctx.waterDepth ?? 0) > MEDIC.waterGate) { this.targetId = null; return none; }
    // The best healing weapon per target type, and its range.
    const best = new Map();
    (ctx.weapons ?? []).forEach((w, i) => {
      if (!w?.healing) return;
      const ammo = w.ammo < 0 ? 0x10000 : w.ammo;
      if (!(ammo > 1)) return;
      for (const [type, strength] of Object.entries(w.strength ?? {})) {
        const cur = best.get(type);
        if (strength > 0 && (!cur || strength > cur.strength)) {
          best.set(type, { strength, index: i, range: w.maxRange ?? 0 });
        }
      }
    });
    if (!best.size) { this.targetId = null; return none; }
    let sum = 0, top = 0, target = null, weaponIndex = -1, arrive = 0;
    for (const f of ctx.friends ?? []) {
      const w = best.get(f.type ?? 'Infantry');
      if (!w) continue;
      const h = f.health;
      if (!(h < MEDIC.healthBelow) || !(h > 0)) continue;
      if (f.upright === false || f.inVehicle) continue;
      const dx = f.pos[0] - ctx.position[0], dy = f.pos[1] - ctx.position[1], dz = f.pos[2] - ctx.position[2];
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > w.range * w.range && ctx.isWalkable && !ctx.isWalkable(f.pos[0], f.pos[2])) continue;
      let value = MEDIC.unitValue;
      if (ctx.insideMyArea && !ctx.insideMyArea(f.pos[0], f.pos[2])) value *= MEDIC.outsideAreaFactor;
      const term = value / (Math.max(0.5, Math.sqrt(d2)) * Math.max(1e-3, sCurve(h)));
      sum += term;
      if (term > top) {
        top = term; target = f.id; weaponIndex = w.index;
        arrive = (f.radius ?? 1.0) + MEDIC.rangeFraction * w.range;
      }
    }
    if (!target) { this.targetId = null; this.lastUrgency = 0; return none; }
    const changed = target !== this.targetId;
    this.targetId = target; this.weaponIndex = weaponIndex; this.arrive = arrive;
    const urgency = decleiningSlope(sum) * MEDIC.urgencyScale * (ctx.mod ?? 1);
    this.lastUrgency = urgency;
    return { urgency, targetId: target, weaponIndex, arrive, changed };
  }
}

export class TakeCoverState {
  constructor() {
    this.coverId = null;
    this.dangerPos = null;
    this.dangerId = null;
    this.lastUrgency = 0;
    this.goal = null;
  }

  /**
   * `BBTakeCoverInfantry::calculateUrgency`. `ctx`: `now`, `position`,
   * `incoming` (with `pos`, `aimed`), `heard` (with `pos`, `threat`,
   * `security`, `weaponRange`), `spotted` (with `pos`, `threat`, `seen`,
   * `lastSeen`, `id`), `covers` (candidates `{ id, pos, value, width,
   * height }`), `lineClear(from, to)`, `nav` (for `traceValidPoint`),
   * `mod` (the contest multiplier), `myWidth`, `myHeight`.
   * Returns `{ urgency, dangerPos, dangerId, cover, goal }`.
   */
  evaluate(ctx) {
    const danger = new Float32Array(QUADRANTS);
    const dangerAt = new Array(QUADRANTS).fill(null);
    let total = 0;
    const add = (pos, value, ref, into) => {
      const q = quadrantOf(pos[0] - ctx.position[0], pos[1] - ctx.position[1], pos[2] - ctx.position[2]);
      danger[q] += into;
      total += value;
      if (!dangerAt[q] || value > dangerAt[q].value) dangerAt[q] = { pos, value, ref };
    };
    for (const f of ctx.incoming) {
      if (!f.pos) continue;
      const age = ctx.now - f.time;
      let s = f.strength / (age * f.rate + 1) * Math.min(1, Math.max(0, 1 - age / TAKE_COVER.fireFade));
      if (f.aimed) s *= 2;
      if (s > 0) add(f.pos, s, { id: f.attacker ?? null, object: false }, s);
    }
    for (const h of ctx.heard) {
      const d = Math.max(TAKE_COVER.minDistance, Math.hypot(h.pos[0] - ctx.position[0], h.pos[2] - ctx.position[2]));
      let s = (h.security ?? 1) * (h.threat ?? 4) / d;
      if (h.weaponRange) {
        if (d >= h.weaponRange) continue;
        s *= 1 - sCurve(d / h.weaponRange);
      }
      add(h.pos, s, { id: h.id, object: true }, s);
    }
    for (const m of ctx.spotted) {
      const d = Math.max(TAKE_COVER.minDistance, Math.hypot(m.pos[0] - ctx.position[0], m.pos[2] - ctx.position[2]));
      let s = ((m.threat ?? 4) ** 2) / d;
      if (!m.seen) s *= 0.5 + 0.5 * (1 - Math.min(ctx.now - m.lastSeen, TAKE_COVER.staleCap) / TAKE_COVER.staleCap);
      if (m.weaponRange) {
        if (d >= m.weaponRange) continue;
        s *= 1 - sCurve(d / m.weaponRange);
      }
      add(m.pos, s, { id: m.id, object: true }, 2 * s);
    }
    let best = -1, bestV = 0;
    for (let q = 0; q < QUADRANTS; q++) if (danger[q] > bestV) { bestV = danger[q]; best = q; }
    if (total <= 0 || best < 0 || !dangerAt[best]) {
      this.goal = null;
      this.lastUrgency = 0;
      return { urgency: 0 };
    }
    const threat = dangerAt[best];
    // The threat must be able to see the bot, else no cover is needed.
    if (threat.ref.object && ctx.lineClear && !ctx.lineClear(
        [threat.pos[0], threat.pos[1] + 1.0, threat.pos[2]],
        [ctx.position[0], ctx.position[1] + 1.0, ctx.position[2]])) {
      this.goal = null;
      this.lastUrgency = 0;
      return { urgency: 0 };
    }
    // The cover object is not a condition of the urgency: without one the
    // id is -1, "changed" every call, and the plan falls back to the lowest
    // ground. With one, the urgency is recomputed only when the choice
    // changes (`+0x1c` flag) and kept otherwise.
    const cover = this.chooseCover(ctx, threat.pos);
    const id = cover ? cover.id : -1;
    const changed = id === -1 || id !== this.coverId;
    this.coverId = id;
    this.dangerPos = [...threat.pos];
    this.dangerId = threat.ref.id;
    this.goal = cover ? cover.goal : null;
    // `d` is the distance to the threat, clamped 2 .. 100 m; the radio
    // message term `(1 + strength)` is 1 (no radio in the viewer).
    const d = Math.min(TAKE_COVER.distanceCap, Math.max(TAKE_COVER.minDistance,
      Math.hypot(threat.pos[0] - ctx.position[0], threat.pos[2] - ctx.position[2])));
    const urgency = changed || !(this.lastUrgency > 0)
      ? decleiningSlope(total) * decleiningSlope(d * TAKE_COVER.distanceScale) * (ctx.mod ?? 1)
      : this.lastUrgency;
    this.lastUrgency = urgency;
    return { urgency, dangerPos: this.dangerPos, dangerId: this.dangerId, cover, goal: this.goal, changed };
  }

  /**
   * `getCoverObject`: the best cover against a threat at `threatPos`:
   * `base * coverValue / distance`, only on the bot's side of the halfway
   * line, with the standing point `0.75 R .. 2 R` behind it. Returns
   * `{ id, pos, goal, score }` or null.
   */
  chooseCover(ctx, threatPos) {
    const D = [threatPos[0] - ctx.position[0], threatPos[2] - ctx.position[2]];
    const dLen = Math.hypot(D[0], D[1]) || 1e-6;
    let best = null;
    for (const c of ctx.covers ?? []) {
      if (!(c.value > 0)) continue;
      const C = [c.pos[0] - ctx.position[0], c.pos[2] - ctx.position[2]];
      const cLen = Math.hypot(C[0], C[1]) || 1e-6;
      if ((C[0] * D[0] + C[1] * D[1]) / cLen > TAKE_COVER.halfwayFraction * dLen) continue;
      const nx = (c.pos[0] - threatPos[0]), nz = (c.pos[2] - threatPos[2]);
      const nLen = Math.hypot(nx, nz) || 1e-6;
      const ux = nx / nLen, uz = nz / nLen;
      const R = c.radius ?? Math.max(c.width ?? 1, 1);
      const from = [c.pos[0] + ux * TAKE_COVER.behindNear * R, c.pos[2] + uz * TAKE_COVER.behindNear * R];
      const to = [c.pos[0] + ux * TAKE_COVER.behindFar * R, c.pos[2] + uz * TAKE_COVER.behindFar * R];
      const goal = ctx.traceValidPoint ? ctx.traceValidPoint(from, to) : to;
      if (!goal) continue;
      const base = TAKE_COVER.widthWeight * Math.min(1, Math.max(0, ((c.width ?? 1) / (ctx.myWidth ?? 1)) * TAKE_COVER.widthScale))
        + TAKE_COVER.heightWeight * Math.min(1, Math.max(0, ((c.height ?? 1) / (ctx.myHeight ?? 1.8)) * TAKE_COVER.heightScale));
      const score = base * c.value / cLen;
      if (!best || score > best.score) best = { id: c.id, pos: c.pos, goal, score };
    }
    return best;
  }

  /**
   * The no-cover fallback: the lowest walkable ground in a 100 m box on the
   * far side of the danger, on a 4 m grid.
   */
  lowestGround(ctx, dangerPos) {
    const dx = ctx.position[0] - dangerPos[0], dz = ctx.position[2] - dangerPos[2];
    const len = Math.hypot(dx, dz) || 1;
    const ux = dx / len, uz = dz / len;
    const half = TAKE_COVER.noCoverBox / 2;
    let best = null, bestH = Infinity;
    for (let a = -half; a <= half; a += TAKE_COVER.noCoverStep) {
      for (let b = 0; b <= TAKE_COVER.noCoverBox; b += TAKE_COVER.noCoverStep) {
        const x = ctx.position[0] + ux * b - uz * a;
        const z = ctx.position[2] + uz * b + ux * a;
        if (ctx.isWalkable && !ctx.isWalkable(x, z)) continue;
        const h = ctx.heightAt ? ctx.heightAt(x, z) : 0;
        if (Number.isFinite(h) && h < bestH) { bestH = h; best = [x, z]; }
      }
    }
    return best;
  }
}
