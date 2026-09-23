// The strategic interface: the one place a bot's order comes from, and the
// doctrines ("plays") that fill it (features/bot-doctrines/README.md).
//
// The bot referee (bot-referee.js) holds a `StrategicCommand`, never a
// `StrategicAI`. The command owns the engine's SAI as the side's strategic
// picture (areas, owners, temperatures, strategies), runs a strategic pass
// every `SAI.updateFrequency` seconds, and on each pass asks each side's
// doctrine for that side's orders. Between passes it runs the per-tick part
// of the orders that have one (a moving goal, a seat to take). A bot's
// `waypoints` is whatever `waypointsOf(id)` returns, and nothing else writes
// it.
//
//   doctrine 'sai'    the engine's SAI (strategic-ai.js), unchanged: every
//                     bot of the side is distributed by `SAI.sidePass` and
//                     holds the order the SAI gave it. The baseline.
//   doctrine 'squad'  doctrine-squad.js: bots in fours, the leaders ordered
//                     by the SAI, the rest following them.
//
// ## The contract a doctrine meets
//
// A doctrine is built once per side by its factory,
// `factory({ side, sai, layer, random, command })`, and answers
//
//   orders(view) -> Map<botId, order | null>
//
// once per strategic pass. `view` is the side's picture at the pass
// (`StrategicCommand._view`; every field is read lazily, so a doctrine pays
// only for what it reads):
//
//   side, time         the side (1 Axis, 2 Allies) and the SAI clock
//   roster             every bot id of the side, in registration order
//   alive              Map id -> [x, y, z] of every alive bot, both sides
//   bots               the side's alive bots: { id, position, health (0..1),
//                      unit (the referee's `strategicUnit`: type, mounted,
//                      air, radius, ...), seat ({ vehicleId, seatId, drives,
//                      kind, candId, driver } or null), order (the one it
//                      holds) }
//   areas              every strategic area: { area, name, centre, radius,
//                      owner (0/1/2), status for the side ('Owned' /
//                      'Hostile' / 'Neutral'), friendly, enemy (presence) }
//   flags              the level's flags (name, team, position)
//   enemy              the side's `EnemyStrengthTables` (bot-strength.js)
//   vehicles           the seat candidates (bot-units.js `candidates`)
//   sai, layer         the engine's SAI and the strategic layer: a doctrine
//                      may hand some of its bots to `sai.sidePass(side,
//                      subset)` and read `sai.waypointsOf(id)` back
//   isWalkable(x, z)   the infantry map
//
// The returned map sets the order of every id it names; an id it leaves out
// keeps the order it holds. Returning the same object again keeps the bot's
// arrival state (the bots mark `arrived` on the object). The optional hooks
// `botDied(id)` and `unitChanged(id)` hear the referee's events (the command
// has already dropped the bot's order), and `stats()` returns whatever the
// doctrine counts, for the runner's summary.
//
// The SAI's pass is split so a doctrine sits between its halves:
// `sai.beginPass(alive)` (the areas, both sides, everyone counted) runs once,
// then each side's `orders(view)`. The 'sai' doctrine's `orders` is
// `sai.sidePass(side, alive)`, which is exactly what `StrategicAI.update`
// did, in the same order: a seeded match traces byte for byte as it did
// before the interface (checked on the synthetic level, El Alamein and
// Bocage, features/bot-doctrines/README.md).
//
// ## Orders, and adding a new kind
//
// An order is the object a bot's `waypoints` holds. Every kind meets the
// bots' contract (bot-decision.js `urgencyMoveTo`, `updateObjectiveReadout`;
// bot-plans.js `planMoveTo`; bot-perception.js; bot-mount.js):
//
//   kind               a string registered with `registerOrderKind`
//   point [x, z]       the goal the MoveTo plan walks or drives to
//   radius             the plan's arrival radius
//   y                  only for an air order: the goal's height
//   area, inside(x,z)  the strategic area the order is in, and its test
//                      (null / absent: no area; Fire and Change then apply
//                      no outside-area factor)
//   urgency(x, z, pathRadius, y) -> MoveTo's urgency before the modifier;
//                      it sets `arrived`
//   arrived            set by `urgency`
//
// A bot re-plans its move when its order is a different object
// (`planMoveTo` compares identity), so a goal that moves is a new object.
//
// To add a kind (Brief D's `WPBeachLanding` is the next one):
//   1. build the object where it is decided -- in strategic-ai.js when the
//      SAI issues it (next to `_order` / `_orderAir`), or in the doctrine
//      that invents it -- meeting the contract above;
//   2. `registerOrderKind('<Kind>', { tick })` in the same module. `tick` is
//      optional: when present the command calls it every tick for every
//      alive bot holding such an order, with `ctx = { id, position, command,
//      candidates(), actuators }`, and a returned object replaces the order
//      (a goal that moved). `actuators.enter(id, candId)` presses Use at a
//      seat (the referee seats him on its next vehicle tick if the seat is
//      free), `actuators.exit(id)` leaves the hull: a landing craft's
//      passengers bailing at the beach is an `exit` from a tick;
//   3. return it from a doctrine's `orders` (the 'sai' doctrine passes on
//      whatever the SAI's `_distribute` built). `checkOrder` refuses an
//      unregistered kind or a broken contract when the command applies it.
//
// A kind whose meaning the bots' behaviours cannot express through
// point / radius / urgency and the actuators needs a behaviour change in
// bot*.js; that is outside this interface.

import { SAI } from './strategic-ai.js';

// ---------------------------------------------------------------------------
// Order kinds
// ---------------------------------------------------------------------------

/** kind -> { tick?(order, ctx) }. */
export const ORDER_KINDS = new Map();

/** Register an order kind and its optional per-tick executor. */
export function registerOrderKind(kind, def = {}) {
  ORDER_KINDS.set(kind, def);
}

// The SAI's own two (strategic-ai.js `_order`, `_orderAir`): no per-tick part.
registerOrderKind('WPMoveTo');
registerOrderKind('WPAltitudeMoveTo');

/** Refuse an order that is not a registered kind or breaks the contract. */
export function checkOrder(order) {
  if (order === null || order === undefined) return null;
  if (typeof order.kind !== 'string' || !ORDER_KINDS.has(order.kind)) {
    throw new Error(`doctrine order of unregistered kind ${order?.kind}`);
  }
  if (!Array.isArray(order.point) || order.point.length < 2 || !Number.isFinite(order.point[0])
      || !Number.isFinite(order.point[1]) || !Number.isFinite(order.radius) || typeof order.urgency !== 'function') {
    throw new Error(`doctrine order ${order.kind} breaks the order contract (point, radius, urgency)`);
  }
  if (order.area && typeof order.inside !== 'function') {
    throw new Error(`doctrine order ${order.kind} names an area without inside(x, z)`);
  }
  return order;
}

/**
 * `dice::bf::ai::WPCloseTo` (read 2026-09-24, ledger AI-77): the engine's
 * waypoint on an object, not a point. Unused by the retail server (no
 * caller of either ctor, and its vtable 0x0875d748 is written only by them),
 * so no bot of the engine ever holds one; it is the engine's own law for an
 * order that follows something, and the squad play's follow order is built
 * on it.
 *
 *  * ctor 0x085365b0 `WPCloseTo(objectId, radius)`: R = max(5, radius); for
 *    an object with a physical body, R = max(R, 2 x its vt+0x30, read as its
 *    bounding radius: INFERRED), and the stored goal (+0x14) is the object's
 *    centre (its position plus the rotated centre offset, vt+0x2c).
 *  * `getUrgency` 0x08536990: the goal is the object's centre NOW; d^2 its
 *    3D distance squared from the bot (stored at +0x10); inside R (d^2 <
 *    R^2) it returns 0 (0x08536b28); else min(1, d^2 / 4R^2) (no 0.1 floor,
 *    no x2 -- unlike `WPMoveTo`), and when the goal has moved more than R
 *    from the stored one it becomes the stored goal and the waypoint is
 *    flagged changed (+4, 0x08536b91). An object gone sets +5 and returns 0.
 *  * `getGoalPoint` 0x08536ce0 is the stored goal: the path is planned to
 *    where the object was, re-planned when it has moved R.
 *  * `modifyMaxSpeed` 0x08536bf0: a mobile object's follower takes
 *    min(own, the object's speed) while d^2 <= R (R, not R^2, as compiled),
 *    else its own; a fixed object's stops there. Not built: the viewer's
 *    plans carry no speed cap.
 */
export const CLOSE_TO = {
  /** ctor 0x085365b0: the radius floor. */
  radiusMin: 5.0,
  /** ctor 0x085365b0: x the object's bounding radius (INFERRED vt+0x30). */
  boundingFactor: 2.0,
};

/**
 * A `WPCloseTo`-law order on a moving goal. `goalOf()` returns the goal's
 * [x, y, z] now, or null when what it follows is gone. `kind` 'WPFollow'
 * (a follower's) or 'WPHold' (a fixed point). `inherit` is an order whose
 * `area` / `inside` / `owned` the new one carries, so a follower is "in"
 * the area its leader was sent to.
 */
export function closeToOrder({ kind = 'WPFollow', goalOf, radius = CLOSE_TO.radiusMin, targetRadius = 0,
                               leaderId = null, slot = null, inherit = null }) {
  const R = Math.max(CLOSE_TO.radiusMin, radius, CLOSE_TO.boundingFactor * targetRadius);
  const g = goalOf();
  if (!g) return null;
  const stored = [g[0], g[1], g[2]];
  const order = {
    kind, leaderId, slot, goalOf,
    point: [stored[0], stored[2]],
    goalY: stored[1],
    radius: R,
    area: inherit?.area ?? null,
    arrived: false,
    lost: false,
    /** `getUrgency` 0x08536990 against the goal as it is now. */
    urgency(x, z, _pathRadius, y = stored[1]) {
      const now = goalOf();
      if (!now) { this.lost = true; return 0; }
      const d2 = (now[0] - x) ** 2 + (now[1] - y) ** 2 + (now[2] - z) ** 2;
      if (d2 < R * R) { this.arrived = true; return 0; }
      this.arrived = false;
      return Math.min(1, d2 / (4 * R * R));
    },
    /** The same order on the goal as it is now (the +4 "changed"). */
    regoal() {
      return closeToOrder({ kind, goalOf, radius, targetRadius, leaderId, slot, inherit });
    },
  };
  if (inherit?.area && typeof inherit.inside === 'function') order.inside = inherit.inside;
  if (typeof inherit?.owned === 'function') order.owned = inherit.owned;
  return order;
}

/** The per-tick half of `getUrgency`: past R, a goal that moved R is re-stored. */
function closeToTick(order, { position }) {
  const g = order.goalOf();
  if (!g) { order.lost = true; return null; }
  const R2 = order.radius * order.radius;
  const d2 = (g[0] - position[0]) ** 2 + (g[1] - position[1]) ** 2 + (g[2] - position[2]) ** 2;
  if (d2 < R2) return null;
  const m2 = (g[0] - order.point[0]) ** 2 + (g[1] - order.goalY) ** 2 + (g[2] - order.point[1]) ** 2;
  return m2 > R2 ? order.regoal() : null;
}

registerOrderKind('WPFollow', { tick: closeToTick });
registerOrderKind('WPHold', { tick: closeToTick });

/**
 * INVENTION (the squad play; the engine has no such order: a bot picks its
 * own seat in `BBChange`): walk to one seat's door and press Use there.
 * The goal is the door; R is the door's radius as `planChange` takes it
 * (max(entryRadius or 4, 2)), with the `WPCloseTo` urgency law but no 5 m
 * floor (a bot held 5 m from a 2.5 m door never reaches it).
 */
export function boardOrder(cand, candidatesOf, inherit = null) {
  const radius = Math.max(cand.entryRadius ?? 4, 2.0);
  const candId = cand.id;
  const doorOf = () => {
    const c = candidatesOf().find(x => x.id === candId);
    if (!c) return null;
    const e = c.entry ?? [c.pos[0], c.pos[2]];
    return [e[0], c.pos[1], e[1]];
  };
  const g = doorOf() ?? [cand.entry?.[0] ?? cand.pos[0], cand.pos[1], cand.entry?.[1] ?? cand.pos[2]];
  const order = {
    kind: 'WPBoard', candId, vehicleId: cand.vehicleId, seatId: cand.seatId, doorOf,
    point: [g[0], g[2]], goalY: g[1], radius,
    area: inherit?.area ?? null,
    arrived: false,
    urgency(x, z) {
      const d = doorOf();
      if (!d) return 0;
      // Horizontal: the door is on the hull, the bot on the ground.
      const d2 = (d[0] - x) ** 2 + (d[2] - z) ** 2;
      if (d2 < radius * radius) { this.arrived = true; return 0; }
      this.arrived = false;
      return Math.min(1, d2 / (4 * radius * radius));
    },
    regoal() { return boardOrder(cand, candidatesOf, inherit); },
  };
  if (inherit?.area && typeof inherit.inside === 'function') order.inside = inherit.inside;
  return order;
}

registerOrderKind('WPBoard', {
  tick(order, { id, position, candidates, actuators }) {
    const c = candidates().find(x => x.id === order.candId);
    if (!c || c.occupiedBy) return null;         // taken or gone: the next pass re-plans
    const e = c.entry ?? [c.pos[0], c.pos[2]];
    const d = Math.hypot(e[0] - position[0], e[1] - position[2]);
    if (d <= order.radius) { actuators?.enter?.(id, c.id); return null; }
    // The hull moved: a new door goal once it is a radius off.
    return Math.hypot(e[0] - order.point[0], e[1] - order.point[1]) > order.radius ? order.regoal() : null;
  },
});

/**
 * INVENTION (the squad play): get out of the hull where it stands. The
 * order asks for no move (urgency 0 at the bot's own position) and its tick
 * holds the Use key (`actuators.exit`) until the referee has unseated him;
 * the unit change then drops the order and the next pass gives him another.
 * A landing craft's passengers at the beach would take the same order.
 */
export function leaveOrder(position, inherit = null) {
  const order = {
    kind: 'WPLeave',
    point: [position[0], position[2]],
    radius: CLOSE_TO.radiusMin,
    area: inherit?.area ?? null,
    arrived: true,
    urgency() { return 0; },
  };
  if (inherit?.area && typeof inherit.inside === 'function') order.inside = inherit.inside;
  return order;
}

registerOrderKind('WPLeave', {
  tick(order, { id, actuators }) {
    actuators?.exit?.(id);
    return null;
  },
});

// ---------------------------------------------------------------------------
// Doctrines
// ---------------------------------------------------------------------------

/** name -> factory({ side, sai, layer, random, command }) -> doctrine. */
export const DOCTRINES = new Map();

export function registerDoctrine(name, factory) {
  DOCTRINES.set(name, factory);
}

/** The engine's SAI as a doctrine: every bot of the side through `sidePass`. */
registerDoctrine('sai', ({ side, sai }) => ({
  name: 'sai',
  orders(view) {
    sai.sidePass(side, view.alive);
    const out = new Map();
    for (const b of sai.bots.values()) if (b.side === side) out.set(b.id, b.waypoints);
    return out;
  },
}));

/**
 * `--doctrine` / `env.doctrine` as a per-side map: 'squad' (both sides),
 * 'axis=squad,allies=sai', '1=squad,2=sai', or `{ 1: 'squad', 2: 'sai' }`.
 * Unnamed sides take 'sai'.
 */
export function parseDoctrineSpec(spec) {
  const out = { 1: 'sai', 2: 'sai' };
  if (!spec) return out;
  if (typeof spec === 'object') {
    for (const side of [1, 2]) if (spec[side]) out[side] = spec[side];
    return out;
  }
  const parts = String(spec).split(',').map(s => s.trim()).filter(Boolean);
  for (const part of parts) {
    const m = part.match(/^(axis|allies|1|2)\s*=\s*(.+)$/i);
    if (!m) { out[1] = part; out[2] = part; continue; }
    const side = /^(axis|1)$/i.test(m[1]) ? 1 : 2;
    out[side] = m[2].trim();
  }
  for (const side of [1, 2]) {
    if (!DOCTRINES.has(out[side])) throw new Error(`unknown doctrine ${out[side]} (have ${[...DOCTRINES.keys()].join(', ')})`);
  }
  return out;
}

// ---------------------------------------------------------------------------
// The command: what the referee holds
// ---------------------------------------------------------------------------

export class StrategicCommand {
  /**
   * @param {StrategicAI} sai   the engine's SAI over the level's layer
   * @param {object} [opt]
   *   doctrine       a spec for `parseDoctrineSpec` (default 'sai')
   *   random         the doctrines' random stream (the SAI keeps its own)
   *   isWalkable     the infantry map test
   *   unitOf(id)     the referee's `strategicUnit`
   *   healthOf(id)   0..1
   *   enemyTablesOf(side)
   *   candidatesOf() the seat candidates
   *   actuators      { enter(id, candId), exit(id) }
   */
  constructor(sai, { doctrine = null, random = Math.random, isWalkable = null, unitOf = null, healthOf = null,
                     enemyTablesOf = null, candidatesOf = null, actuators = null } = {}) {
    this.sai = sai;
    this.layer = sai.layer;
    this.random = random;
    this.isWalkable = isWalkable;
    this.unitOf = unitOf;
    this.healthOf = healthOf;
    this.enemyTablesOf = enemyTablesOf;
    this.candidatesOf = candidatesOf ?? (() => []);
    this.actuators = actuators;
    this.spec = parseDoctrineSpec(doctrine);
    this.doctrines = {};
    for (const side of [1, 2]) {
      this.doctrines[side] = DOCTRINES.get(this.spec[side])({ side, sai, layer: this.layer, random, command: this });
    }
    /** id -> side, in registration order. */
    this.roster = new Map();
    /** id -> the order the bot holds. */
    this.orders = new Map();
    /** The latest alive map (id -> [x, y, z]), for goals that move between passes. */
    this.alive = new Map();
    this.passes = 0;
  }

  /** The doctrine names, `{ 1, 2 }`. */
  get doctrineNames() { return { ...this.spec }; }
  /** Whether both sides run the engine's SAI (the baseline). */
  get isBaseline() { return this.spec[1] === 'sai' && this.spec[2] === 'sai'; }

  // The referee reads the SAI's picture through these, as it read the SAI.
  get sides() { return this.sai.sides; }
  get time() { return this.sai.time; }

  addBot(id, side, positionOf) {
    this.roster.set(id, side);
    this.sai.addBot(id, side, positionOf);
  }

  removeBot(id) {
    this.roster.delete(id);
    this.orders.delete(id);
    this.sai.removeBot(id);
  }

  botDied(id) {
    this.orders.delete(id);
    this.sai.botDied(id);
    const side = this.roster.get(id);
    this.doctrines[side]?.botDied?.(id);
  }

  botChangedUnit(id) {
    this.orders.delete(id);
    this.sai.botChangedUnit(id);
    const side = this.roster.get(id);
    this.doctrines[side]?.unitChanged?.(id);
  }

  waypointsOf(id) {
    return this.orders.get(id) ?? null;
  }

  /**
   * Every tick: the SAI clock; a strategic pass when one is due (the SAI's
   * shared half, then each side's doctrine); then the per-tick executors of
   * the orders held.
   */
  update(dt, alive) {
    const sai = this.sai;
    this.alive = alive;
    sai.time += dt;
    if (sai.time - sai.lastPass >= SAI.updateFrequency) {
      sai.lastPass = sai.time;
      sai.beginPass(alive);
      for (const side of [1, 2]) {
        const out = this.doctrines[side].orders(this._view(side, alive));
        for (const [id, order] of out ?? []) {
          if (this.roster.get(id) !== side) continue;
          if (order) this.orders.set(id, checkOrder(order));
          else this.orders.delete(id);
        }
      }
      this.passes++;
    }
    this._tickOrders(alive);
  }

  _tickOrders(alive) {
    let cands = null;
    const candidates = () => (cands ??= this.candidatesOf() ?? []);
    for (const [id, order] of this.orders) {
      const def = ORDER_KINDS.get(order.kind);
      if (!def?.tick) continue;
      const position = alive.get(id);
      if (!position) continue;
      const next = def.tick(order, { id, position, command: this, candidates, actuators: this.actuators });
      if (next && next !== order) this.orders.set(id, checkOrder(next));
    }
  }

  /** Where a bot sits, from the candidates: `{ vehicleId, seatId, drives, kind, candId, driver }`. */
  seatOf(id, cands = this.candidatesOf() ?? []) {
    const c = cands.find(x => x.occupiedBy === id);
    return c ? { vehicleId: c.vehicleId, seatId: c.seatId, drives: !!c.drives, kind: c.kind, candId: c.id,
                 driver: c.driver ?? null } : null;
  }

  /** The side's picture for its doctrine; every field lazy. */
  _view(side, alive) {
    const cmd = this;
    const sai = this.sai;
    const layer = this.layer;
    let bots, areas, cands;
    return {
      side, alive, sai, layer, command: cmd,
      time: sai.time,
      isWalkable: this.isWalkable,
      get roster() { return [...cmd.roster].filter(([, s]) => s === side).map(([id]) => id); },
      get vehicles() { return (cands ??= cmd.candidatesOf() ?? []); },
      get bots() {
        if (bots) return bots;
        const vs = this.vehicles;
        bots = [];
        for (const [id, s] of cmd.roster) {
          if (s !== side || !alive.has(id)) continue;
          bots.push({ id, position: alive.get(id), health: cmd.healthOf?.(id) ?? 1, unit: cmd.unitOf?.(id) ?? null,
                      seat: cmd.seatOf(id, vs), order: cmd.orders.get(id) ?? null });
        }
        return bots;
      },
      get areas() {
        if (areas) return areas;
        areas = layer.areas.map(a => {
          const st = sai.areaState.get(a)?.[side];
          return { area: a, name: a.name, centre: a.centre, radius: a.radius, owner: layer.ownerOf(a),
                   status: st?.status ?? null, friendly: st?.friendly ?? 0, enemy: st?.enemy ?? 0 };
        });
        return areas;
      },
      get flags() { return layer.flags; },
      get enemy() { return cmd.enemyTablesOf?.(side) ?? null; },
    };
  }

  /** What each side's doctrine counted, for the runner's summary. */
  stats() {
    const out = { doctrine: this.doctrineNames, passes: this.passes };
    for (const side of [1, 2]) {
      const s = this.doctrines[side].stats?.();
      if (s) out[side] = s;
    }
    return out;
  }
}
