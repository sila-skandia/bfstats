// The strategic layer's data: the level's strategic areas as the server's
// `SAI` sees them, bound to the world's control points.
//
// Source: `extras.ai` (bf42/ai_level.py reads the level's `AI/*.con`; see
// features/bf1942-ai-research-2026-09-21/README.md §3.6). An area is a box
// `min..max` with a `radius`, object-type flags (`Base`, `ControlPoint`,
// `Front`, `Flank`, `Centre`, `Safe`, `Close`, `AirField`, `ChokePoint`,
// `StrongPoint`, ...), neighbours (the adjacency graph the strategies walk),
// per-vehicle-type order positions, and an authored side.
//
// Ownership is not authored per area: the engine's strategic objects are the
// control points, and an area's side is whoever holds the control points in
// it. `ownerOf` reads the world's live flags, so it follows captures.

/** The engine's vehicle-type names used by `setOrderPosition`. */
export const INFANTRY_TYPE = 'Infantery';

/**
 * An area's geometry as the engine builds it. `aiStrategicArea.create <name>
 * p1 p2 r` (`AIStrategicObjectManager::create` 0x08646ad0 passes both points
 * straight to the ctor 0x0863c000): p1 is the top-left corner (+0x10c/+0x110,
 * `setTopLeftCorner` 0x0863e7b0), p2 the area's position for both sides
 * (+0x84/+0x8c, `setPosition` 0x0863e770), and the ctor sets each side's
 * radius (+0x98/+0x9c) to |p2 - p1| (0x0863c657..0x0863c6d1); `r` is side 0's
 * radius (+0x94, `AIStrategicObject` ctor 0x08643140). The box is a CENTRE box
 * (`isInside` 0x08641d40 -> `insideCentreBox` 0x08653fa0): p1 <= p <= 2 p2 - p1
 * (`getBoxMaxCorner` 0x08654090), so p2 is the middle and the box is twice
 * the authored rectangle on each axis.
 *
 * The exporter keeps min/max, not p1/p2. Every vanilla, XPack1 and XPack2
 * area (326 + 86 + 69) lists p1 below p2 on both axes, so p1 is the min x and
 * the min engine z; the viewer's z is the engine's -z, so in the viewer p1 is
 * (min x, max z) and p2 (max x, min z). An area that carries `corner` and
 * `position` (a later export) is taken as given.
 */
export function areaGeometry(a) {
  const corner = a.corner ?? [a.min[0], a.max[1]];
  const position = a.position ?? [a.max[0], a.min[1]];
  const far = [2 * position[0] - corner[0], 2 * position[1] - corner[1]];
  return {
    corner, position,
    min: [Math.min(corner[0], far[0]), Math.min(corner[1], far[1])],
    max: [Math.max(corner[0], far[0]), Math.max(corner[1], far[1])],
    sideRadius: Math.hypot(position[0] - corner[0], position[1] - corner[1]),
  };
}

export class StrategicLayer {
  /**
   * @param {object|null} ai   `extras.ai`
   * @param {Array<object>} flags  `world.flags` (`name`, `position`, `team`)
   */
  constructor(ai, flags) {
    this.ai = ai ?? null;
    this.flags = flags ?? [];
    this.areas = [];
    this.byName = new Map();
    this.conditions = new Map();
    this.prerequisites = new Map();
    this.strategies = new Map();
    this.sideStrategies = { 1: [], 2: [] };
    if (!ai) return;
    for (const a of ai.strategicAreas ?? []) {
      const g = areaGeometry(a);
      const area = {
        name: a.name,
        min: g.min, max: g.max, radius: a.radius ?? 0,
        corner: g.corner, centre: g.position, sideRadius: g.sideRadius,
        neighbours: a.neighbours ?? [],
        flags: new Set(a.flags ?? []),
        orderPositions: a.orderPositions ?? {},
        side: a.side ?? null,
        takeable: a.takeable ?? {},
        vehicleSearchRadius: a.vehicleSearchRadius ?? null,
        controlPoints: [],
      };
      this.areas.push(area);
      this.byName.set(area.name.toLowerCase(), area);
    }
    for (const c of ai.conditions ?? []) this.conditions.set(c.name, c);
    for (const p of ai.prerequisites ?? []) this.prerequisites.set(p.name, p);
    for (const s of ai.strategies ?? []) this.strategies.set(s.name, s);
    for (const side of [1, 2]) {
      this.sideStrategies[side] = (ai.sideStrategies?.[String(side)] ?? [])
        .map(n => this.strategies.get(n)).filter(Boolean);
    }
    this.bindFlags(this.flags);
  }

  /** Attach every control point to the area whose box (grown by its radius)
   *  holds it; a flag outside every box goes to the nearest area centre. */
  bindFlags(flags) {
    this.flags = flags ?? [];
    for (const a of this.areas) a.controlPoints = [];
    for (const flag of this.flags) {
      if (!flag?.position) continue;
      const area = this.areaAt(flag.position[0], flag.position[2]);
      if (area) area.controlPoints.push(flag);
    }
  }

  /** The area holding a world point: inside a grown box, nearest centre wins. */
  areaAt(x, z) {
    let best = null, bestD = Infinity;
    for (const a of this.areas) {
      const r = a.radius;
      if (x < a.min[0] - r || x > a.max[0] + r || z < a.min[1] - r || z > a.max[1] + r) continue;
      const d = Math.hypot(x - a.centre[0], z - a.centre[1]);
      if (d < bestD) { bestD = d; best = a; }
    }
    if (best) return best;
    for (const a of this.areas) {
      const d = Math.hypot(x - a.centre[0], z - a.centre[1]);
      if (d < bestD) { bestD = d; best = a; }
    }
    return best;
  }

  /** The nearest area to a world point by centre distance. */
  nearestArea(x, z) {
    let best = null, bestD = Infinity;
    for (const a of this.areas) {
      const d = Math.hypot(x - a.centre[0], z - a.centre[1]);
      if (d < bestD) { bestD = d; best = a; }
    }
    return best;
  }

  /**
   * Who holds an area: the side every control point in it belongs to; 0 when
   * the points are neutral or split. An area with no control point (a base's
   * spawn area, a pass) is held by presence (`presenceOwner`), starting from
   * its authored side.
   */
  ownerOf(area) {
    if (!area.controlPoints.length) return area.presenceOwner ?? area.side ?? 0;
    let side = null;
    for (const f of area.controlPoints) {
      const t = f.team === 1 || f.team === 2 ? f.team : 0;
      if (side === null) side = t;
      else if (side !== t) return 0;
    }
    return side ?? 0;
  }

  /**
   * `AIStrategicArea::update` 0x0863d6d0 for an area without a control point
   * (+0x138 is -1): with units about, a side whose units are there and the
   * enemy's are not holds it when it may take it (`setTakeable`, +0x15f +
   * side; status 0 at 0x0863df64), and a side with only enemy units there
   * loses it when the enemy may take it (+0x160 + (side == 1); status 1 at
   * 0x0863dfaa); an empty area keeps its status. `present` is the side's
   * units in the area.
   */
  updatePresenceOwner(area, present1, present2) {
    if (area.controlPoints.length) return;
    if (!area.presenceStatus) {
      const a = area.side === 1 || area.side === 2 ? area.side : 0;
      area.presenceStatus = { 1: a === 1 ? 'Owned' : a ? 'Hostile' : 'Neutral',
                              2: a === 2 ? 'Owned' : a ? 'Hostile' : 'Neutral' };
    }
    for (const side of [1, 2]) {
      const friendly = side === 1 ? present1 : present2;
      const enemy = side === 1 ? present2 : present1;
      if (friendly <= 0 && enemy <= 0) continue;
      if (area.takeable[String(side)] !== false && friendly > 0 && enemy === 0) {
        area.presenceStatus[side] = 'Owned';
      } else if (area.takeable[String(side === 1 ? 2 : 1)] !== false && enemy > 0 && friendly === 0) {
        area.presenceStatus[side] = 'Hostile';
      }
    }
    area.presenceOwner = area.presenceStatus[1] === 'Owned' ? 1 : area.presenceStatus[2] === 'Owned' ? 2 : 0;
  }

  /** Whether `side` can take the area (`setTakeable <side> 0` forbids it;
   *  an uncapturable control point forbids it too). */
  takeableBy(area, side) {
    if (area.takeable[String(side)] === false) return false;
    if (area.controlPoints.length && area.controlPoints.every(f => f.uncapturable)) return false;
    return true;
  }

  /**
   * `AIStrategicArea::getOrderPos(map, side)` 0x0863e830: the order position
   * of the unit's search map. The ctor fills the per-map table with p2
   * (0x0863c250..0x0863c282); `setOrderPosition <type> x/z` 0x08647880 finds
   * the map of that search type (IAIPathfinding vt+0x20) and keeps the point
   * only when that map calls it valid (vt+0x78), so an order position on a
   * blocked cell leaves p2. `isValid(x, z)` is the unit map's test.
   */
  orderPosition(area, vehicleType = INFANTRY_TYPE, isValid = null) {
    const p = area.orderPositions[vehicleType];
    if (p && (!isValid || isValid(p[0], p[1]))) return [p[0], p[1]];
    return [area.centre[0], area.centre[1]];
  }

  /** `AIStrategicArea::isInside` 0x08641d40: inside the centre box. */
  isInside(area, x, z) {
    return x >= area.min[0] && x <= area.max[0] && z >= area.min[1] && z <= area.max[1];
  }

  /** Side `side`'s radius (+0x94 + side*4): r for side 0, |p2 - p1| for 1 and 2. */
  sideRadius(area, side) {
    return side === 1 || side === 2 ? area.sideRadius : area.radius;
  }

  /**
   * `AIStrategicObject::randomizePos(side, f)` 0x086449e0: p2 + rand * W * f
   * - W / 2 per axis, W = `getXExtent`/`getYExtent` 0x0863fc50/0x0863fc70 =
   * 2 (p2 - p1). The span runs from p1 to p1 + 2f (p2 - p1): with f = 0.8 it
   * covers the corner's 80% of the box, not a disc about the middle. The same
   * form holds in the viewer frame (z negated on both points).
   */
  randomizePos(area, factor, random = Math.random) {
    const out = [0, 0];
    for (let k = 0; k < 2; k++) {
      const w = 2 * (area.centre[k] - area.corner[k]);
      out[k] = area.centre[k] + random() * w * factor - 0.5 * w;
    }
    return out;
  }

  /** The area objects adjacent to `area`. */
  neighboursOf(area) {
    return area.neighbours.map(n => this.byName.get(n.toLowerCase())).filter(Boolean);
  }

  /** Count of areas with `flag` held by `subject` relative to `side`
   *  (`Friendly` = held by side, `Enemy` = held by the other side). */
  countFlagged(side, subject, flag) {
    const other = side === 1 ? 2 : 1;
    let n = 0;
    for (const a of this.areas) {
      if (flag !== 'Any' && !a.flags.has(flag)) continue;
      const owner = this.ownerOf(a);
      if (subject === 'Friendly' ? owner === side : owner === other) n++;
    }
    return n;
  }
}

// ---------------------------------------------------------------------------
// The strategic AI itself: `dice::bf::ai::SAI`, read 2026-09-23
// (features/bf1942-ai-research-2026-09-21/bot-behaviours.md §7).
//
//  * `SAI::update` runs a strategic pass at most once per
//    `getSAIUpdateFrequency` seconds (default not in the corpus; 5 s here).
//  * `SAI::updateStates` 0x086348c0 fills a 48-float state array per side:
//    Ticket, ControlPoint, Time, StartTime (seconds since the strategy was
//    chosen), Attacks, Defences, NumberOfFriendly/Neutral/HostileAreas, the
//    flag counts (Flank, Base, Close, Centre, Remote, Route, Bridge, North,
//    West, South, East) with `Front*` variants for an owned area with a
//    hostile neighbour, Front, Safe, FrontNeutral, EnemyObject, UnReachable.
//  * `SAI::chooseStrategy` 0x08631cd0: every strategy's score is its
//    prerequisite (`StrategyPrerequisite::evaluate` 0x0863aa50: a Required
//    condition below zero kills it, Advisory ones sum, abort conditions only
//    count while active; `SCConstant::compare` 0x08639250 with Crisp +-1 or
//    Fuzzy signed distance); the active one is kept while every score ratio
//    stays inside 0.83 .. 1.2 and its TimeLimit has not passed (then 1.5x,
//    1.75x ...); otherwise a roulette over the positive scores picks.
//    Changing a strategy frees every bot.
//  * `AIStrategicArea::update` 0x0863d6d0: attack temperature = unit
//    strength in the area + the area's base (the `create` radius), defence
//    temperature = base + static strength; status from the control point's
//    owner; wanted strength `round(2 * max(1, sum of present values))`
//    (x1.25 when not owned). `updateTemperature` 0x0863e8b0 multiplies both
//    by the strategy's modifier for each flag under the area's status, then
//    Enemy / Front / Safe / Neutral. `calculateAttackValue` 0x0863e3f0: not
//    owned with an owned neighbour -> `attackTemp * (1.5 hostile neighbour |
//    1.25 neutral neighbour)` minus the enemy cost; `calculateDefenseNeed`
//    0x0863e360: owned -> `(enemyStrength + attackTemp) * 2` with the same
//    neighbour factors.
//  * `SAI::distributeResources` 0x086329b0 splits free bots into attackers
//    and defenders by the strategy's Aggression; `categoryDistributeAttack`
//    0x08633d00 takes the top NumberOfAttacks values above 0.1 (up to 2N
//    within 0.8x of the Nth), `categoryDistributeDefence` 0x086333b0 the top
//    NumberOfDefences needs above 0.1; each target collects bots from the
//    nearest areas until present >= wanted (`collectResources` 0x0863eb50).
//  * `AIStrategicArea::orderNormalBot` 0x08640bd0 hands the bot a `WPMoveTo`
//    at the area's position (randomised inside 0.8 of its radius, 20 tries
//    for a valid point, else the order position) with radius `0.25 * area
//    radius + 2 * unit radius`, at least 5 (`WPMoveTo` ctor). `WPMoveTo::
//    getUrgency` 0x085374a0 on the last point: `clamp(d^2 / (4 R^2), 0.1, 1)
//    x 2` for a non-owned area, x1 owned and outside, 0 owned and inside;
//    arrived when `d^2 < 2 R^2`. `SAI::updateBotPositions` 0x08635bc0
//    re-orders an idle present bot every 20 s.
//
// INVENTION, labelled: the enemy-cost term (`EnemyStatistics`, filled from
// battle statistics) is 0; the area factor `X` is 0 as in the binary; unit
// strength is one per soldier; strategic areas with no control point take
// their authored side.

/** `SCConstant::compare`: Crisp gives +-1, Fuzzy the signed distance. */
export function compareCondition(cond, a, b = null) {
  const v = cond.value;
  const diff = b === null ? a : a - b;
  const crisp = cond.fuzzy === 'Crisp';
  switch (cond.op) {
    case 'Equal': case 'Difference':
      return crisp ? (diff === v ? 1 : -1) : -Math.abs(diff - v);
    case 'EqualGreater': case 'DifferenceGreater':
      return crisp ? (diff >= v ? 1 : -1) : diff - v;
    case 'EqualSmaller': case 'DifferenceSmaller':
      return crisp ? (diff <= v ? 1 : -1) : v - diff;
    case 'Quotient':
      if (!b) return crisp ? -1 : -1000;
      return crisp ? (a / b === v ? 1 : -1) : -Math.abs(a / b - v);
    case 'QuotientGreater':
      if (!b) return crisp ? 1 : 1000;
      return crisp ? (a / b >= v ? 1 : -1) : a / b - v;
    case 'QuotientSmaller':
      if (!b) return crisp ? -1 : -1000;
      return crisp ? (a / b <= v ? 1 : -1) : v - a / b;
    default:
      return 0;
  }
}

export const SAI = {
  /** Seconds between strategic passes: `AISettings` +0x28 = 2.0 (`reset`
   *  0x0848461a, no vanilla level sets it), read through vt+0x44 by
   *  `SAI::update` 0x086306d0 against the last pass (+0x1d8). */
  updateFrequency: 2.0,
  hysteresisLow: 0.83,
  hysteresisHigh: 1.2,
  candidateMin: 0.1,
  attackKeep: 0.8,
  defenceKeep: 0.9,
  hostileNeighbour: 1.5,
  neutralNeighbour: 1.25,
  wantedNotOwned: 1.25,
  surplusKeep: 1.1,
  reorderIdle: 20.0,
  /** `SAI::updateBotPositions` 0x08635bc0: an arrived bot is re-ordered after
   *  20 s on foot, 35 s in a vehicle, while it sees fewer than 2 objects. */
  reorderMounted: 35.0,
  /** `orderAirBot` 0x08640810: ground + 75 m, radius at most 40, the
   *  WPAltitudeMoveTo's 120 m vertical band and 50 m clearance. */
  airOrderHeight: 75.0,
  airRadiusMax: 40.0,
  airVertical: 120.0,
  airClearance: 50.0,
  reorderSpottedMax: 2,
  randomizeFraction: 0.8,
  waypointRadiusFraction: 0.25,
  waypointRadiusMin: 5.0,
  unitRadius: 1.0,
  unitValue: 1.0,
};

export class StrategicAI {
  /**
   * @param {StrategicLayer} layer
   * @param {object} [opt]  `random`, `isWalkable(x, z)` (the infantry map),
   *   `unitOf(id)` -> `{ type, isWalkable, radius, pathRadius, mounted }`: the
   *   bot's unit, its search type (`Infantery`/`Tank`/`Car`), the test of its
   *   own search map, its bounding radius and its `getMaxPathPosRemovalDistance`;
   *   `spottedOf(id)` -> how many objects the bot sees.
   */
  constructor(layer, { random = Math.random, isWalkable = null, unitOf = null, spottedOf = null } = {}) {
    this.layer = layer;
    this.random = random;
    this.isWalkable = isWalkable;
    this.unitOf = unitOf;
    this.spottedOf = spottedOf;
    this.time = 0;
    this.lastPass = -Infinity;
    /** Per side: the strategy container list and the active one. */
    this.sides = {};
    for (const side of [1, 2]) {
      this.sides[side] = {
        containers: layer.sideStrategies[side].map(s => ({ strategy: s, heat: 0, score: 0, chosenAt: 0, count: 1 })),
        active: null,
        states: new Map(),
        attacks: [],
        defences: [],
      };
      if (this.sides[side].containers.length) this.sides[side].active = this.sides[side].containers[0];
    }
    /** Per area per side: temperatures and bookkeeping. */
    this.areaState = new Map();
    for (const a of layer.areas) {
      this.areaState.set(a, { 1: this._blankArea(a), 2: this._blankArea(a) });
    }
    /** Per bot id: { side, area, assignedTo, isAttack, orderedAt, waypoints }. */
    this.bots = new Map();
  }

  _blankArea(a) {
    return { attackTemp: a.radius, defenceTemp: a.radius, friendly: 0, enemy: 0, present: [], wanted: 1, isAttack: false, assigned: new Set() };
  }

  /** Register a bot (`{ id, side, position() }`) with the strategic layer. */
  addBot(id, side, positionOf) {
    this.bots.set(id, { id, side, positionOf, area: null, assignedTo: null, isAttack: false, orderedAt: -Infinity, waypoints: null, free: true });
  }

  removeBot(id) {
    this.bots.delete(id);
  }

  /** A bot died: it is freed and its order dropped. */
  botDied(id) {
    const b = this.bots.get(id);
    if (!b) return;
    b.assignedTo = null; b.waypoints = null; b.free = true; b.area = null;
  }

  /**
   * The bot's controlled object changed (`SAI::handleChangingBot`
   * 0x08631450 through `setBotHasChangedEquipment` 0x08635990): its
   * assignment is removed and it is free, so the next distribution orders it
   * as the unit it now is (`orderBot` 0x08640760 picks the air, fixed or
   * normal order by the unit).
   */
  botChangedUnit(id) {
    const b = this.bots.get(id);
    if (!b) return;
    b.assignedTo = null; b.waypoints = null; b.free = true;
  }

  /** The order a bot currently holds, or null. */
  waypointsOf(id) {
    return this.bots.get(id)?.waypoints ?? null;
  }

  /**
   * One strategic tick. Cheap between passes; a full pass every
   * `updateFrequency` seconds. `livePositions` maps bot id -> [x, y, z] of
   * every alive bot (dead ones are skipped).
   */
  update(dt, alive) {
    this.time += dt;
    if (this.time - this.lastPass < SAI.updateFrequency) return;
    this.lastPass = this.time;
    this.layer.bindFlags(this.layer.flags);
    this._updateAreas(alive);
    for (const side of [1, 2]) {
      this._updateStates(side);
      this._chooseStrategy(side);
      this._updateTemperatures(side);
      this._distribute(side, alive);
    }
  }

  // --- the area pass --------------------------------------------------------

  _updateAreas(alive) {
    for (const [, st] of this.areaState) { st[1].present = []; st[2].present = []; st[1].friendly = 0; st[2].friendly = 0; st[1].enemy = 0; st[2].enemy = 0; }
    for (const b of this.bots.values()) {
      if (!alive.has(b.id)) { b.area = null; continue; }
      const p = alive.get(b.id);
      const area = this.layer.areaAt(p[0], p[2]);
      b.area = area;
      if (!area) continue;
      const st = this.areaState.get(area);
      st[b.side].present.push(b.id);
      st[b.side].friendly += SAI.unitValue;
      st[b.side === 1 ? 2 : 1].enemy += SAI.unitValue;
    }
    for (const [area, st] of this.areaState) {
      this.layer.updatePresenceOwner(area, st[1].present.length, st[2].present.length);
    }
    for (const [area, st] of this.areaState) {
      for (const side of [1, 2]) {
        const s = st[side];
        const owner = this.layer.ownerOf(area);
        const owned = owner === side;
        s.status = owned ? 'Owned' : owner === 0 ? 'Neutral' : 'Hostile';
        s.attackTemp = s.friendly + s.enemy + area.radius;
        s.defenceTemp = area.radius;
        const presentValue = Math.max(1, s.present.length * SAI.unitValue);
        s.wanted = owned ? Math.round(2 * presentValue) : Math.round(2 * presentValue * SAI.wantedNotOwned);
      }
    }
  }

  _hasNeighbourWithStatus(area, side, status) {
    for (const n of this.layer.neighboursOf(area)) {
      if (this.areaState.get(n)[side].status === status) return true;
    }
    return false;
  }

  _updateStates(side) {
    const S = this.sides[side];
    const other = side === 1 ? 2 : 1;
    const f = new Map(), e = new Map();
    const inc = (m, k, v = 1) => m.set(k, (m.get(k) ?? 0) + v);
    inc(f, 'ControlPoint', this.layer.flags.filter(fl => fl.team === side).length);
    inc(e, 'ControlPoint', this.layer.flags.filter(fl => fl.team === other).length);
    inc(f, 'Time', this.time);
    inc(f, 'StartTime', S.active ? this.time - S.active.chosenAt : 0);
    inc(f, 'Attacks', S.attacks.length);
    inc(f, 'Defences', S.defences.length);
    inc(f, 'Security', 1); inc(e, 'Security', 1);
    for (const area of this.layer.areas) {
      const st = this.areaState.get(area)[side];
      const hostileNb = this._hasNeighbourWithStatus(area, side, 'Hostile');
      if (st.status === 'Owned') {
        inc(f, 'NumberOfFriendlyAreas'); inc(e, 'NumberOfHostileAreas');
        if (hostileNb) { inc(f, 'Front'); inc(e, 'EnemyObject'); } else { inc(f, 'Safe'); inc(e, 'UnReachable'); }
      } else if (st.status === 'Hostile') {
        inc(f, 'NumberOfHostileAreas'); inc(e, 'NumberOfFriendlyAreas');
        if (this._hasNeighbourWithStatus(area, side, 'Owned')) { inc(e, 'Front'); inc(f, 'EnemyObject'); } else { inc(e, 'Safe'); inc(f, 'UnReachable'); }
      } else {
        inc(f, 'NumberOfNeutralAreas'); inc(e, 'NumberOfNeutralAreas');
        if (this._hasNeighbourWithStatus(area, side, 'Owned')) inc(f, 'FrontNeutral');
      }
      for (const flag of area.flags) {
        // Flag counts are per ownership: an owned area with the flag counts
        // for the friendly array, a hostile one for the enemy's.
        const target = st.status === 'Owned' ? f : st.status === 'Hostile' ? e : null;
        if (target) {
          inc(target, flag);
          if (hostileNb || st.status === 'Hostile') inc(target, 'Front' + flag);
        }
      }
    }
    S.states = { friendly: f, enemy: e };
  }

  _evaluatePrerequisite(side, strategy, isActive) {
    const S = this.sides[side];
    const prereq = this.layer.prerequisites.get(strategy.prerequisite);
    if (!prereq) return 1;
    let sum = 0;
    for (const { name, weight } of prereq.conditions) {
      const cond = this.layer.conditions.get(name);
      if (!cond) continue;
      if (!isActive && cond.abort) continue;
      const arr = cond.subject === 'Enemy' ? S.states.enemy : S.states.friendly;
      const a = arr.get(cond.object) ?? 0;
      const v = compareCondition(cond, a) * (weight ?? 1);
      // `StrategyPrerequisite::evaluate` 0x0863aa50: a Required condition
      // that holds adds its value like any other (0x0863aafd); only a failing
      // one ends the sum at 0. Advisory-positive / -negative clip theirs.
      const strength = cond.strength[0] ?? 'Required';
      if (strength === 'Required' || strength === 'RequiredPositive') { if (v < 0) return 0; sum += v; }
      else if (strength === 'RequiredNegative') { if (v > 0) return 0; sum += v; }
      else if (strength === 'AdvisoryPositive') sum += Math.max(0, v);
      else if (strength === 'AdvisoryNegative') sum += Math.min(0, v);
      else sum += v;
    }
    return sum;
  }

  _chooseStrategy(side) {
    const S = this.sides[side];
    if (!S.containers.length) return;
    let significant = false;
    for (const c of S.containers) {
      c.score = Math.max(0, this._evaluatePrerequisite(side, c.strategy, c === S.active));
      const ratio = c.score > 0 ? c.heat / c.score : (c.heat > 0 ? Infinity : 1);
      if (ratio <= SAI.hysteresisLow || ratio >= SAI.hysteresisHigh) significant = true;
    }
    if (!significant && S.active) {
      const limit = (S.active.strategy.timeLimit ?? 1e9) * (2 - Math.pow(2, 1 - S.active.count));
      if (this.time - S.active.chosenAt < limit) return;
      S.active.count++;
    }
    let total = 0;
    for (const c of S.containers) { c.heat = c.score; total += Math.max(0, c.heat); }
    let chosen = S.active;
    if (total > 0) {
      let r = this.random() * total;
      for (const c of S.containers) { r -= Math.max(0, c.heat); chosen = c; if (r <= 0) break; }
    }
    if (chosen && chosen !== S.active) {
      S.active = chosen;
      chosen.chosenAt = this.time;
      chosen.count = 1;
      // A change frees every bot of the side.
      for (const b of this.bots.values()) if (b.side === side) { b.assignedTo = null; b.free = true; }
      for (const [, st] of this.areaState) { st[side].assigned.clear(); st[side].isAttack = false; }
    }
  }

  _updateTemperatures(side) {
    const S = this.sides[side];
    const mods = S.active?.strategy.modifiers ?? [];
    for (const area of this.layer.areas) {
      const st = this.areaState.get(area)[side];
      let factor = 1;
      for (const m of mods) {
        const applies = m.owner === null || m.owner === undefined || m.owner === st.status;
        if (!applies) continue;
        if (area.flags.has(m.flag)) factor *= m.factor ?? 1;
        if (m.flag === 'Enemy' && st.status === 'Hostile') factor *= m.factor ?? 1;
        if (m.flag === 'Neutral' && st.status === 'Neutral') factor *= m.factor ?? 1;
        if (m.flag === 'Front' && st.status === 'Owned' && this._hasNeighbourWithStatus(area, side, 'Hostile')) factor *= m.factor ?? 1;
        if (m.flag === 'Safe' && st.status === 'Owned' && !this._hasNeighbourWithStatus(area, side, 'Hostile')) factor *= m.factor ?? 1;
      }
      st.attackTemp *= factor;
      st.defenceTemp *= factor;
    }
  }

  _attackValue(area, side) {
    const st = this.areaState.get(area)[side];
    if (st.status === 'Owned') return 0;
    if (!this.layer.takeableBy(area, side)) return 0;
    if (!this._hasNeighbourWithStatus(area, side, 'Owned')) return 0;
    let v = st.attackTemp;
    if (this._hasNeighbourWithStatus(area, side, 'Hostile')) v *= SAI.hostileNeighbour;
    else if (this._hasNeighbourWithStatus(area, side, 'Neutral')) v *= SAI.neutralNeighbour;
    return v;
  }

  _defenceNeed(area, side) {
    const st = this.areaState.get(area)[side];
    if (st.status !== 'Owned') return 0;
    let v = (st.enemy + st.attackTemp) * 2;
    if (this._hasNeighbourWithStatus(area, side, 'Hostile')) v *= SAI.hostileNeighbour;
    else if (this._hasNeighbourWithStatus(area, side, 'Neutral')) v *= SAI.neutralNeighbour;
    return v;
  }

  _distribute(side, alive) {
    const S = this.sides[side];
    const strategy = S.active?.strategy;
    const f = S.states.friendly;
    let aggression = strategy?.aggression ?? 0.5;
    if ((f.get('NumberOfFriendlyAreas') ?? 0) === 0) aggression = 1;
    else if ((f.get('NumberOfNeutralAreas') ?? 0) === 0 && (f.get('NumberOfHostileAreas') ?? 0) === 0) aggression = 0;
    const myBots = [...this.bots.values()].filter(b => b.side === side && alive.has(b.id));
    // Free bots split by aggression.
    let attackers = 0, defenders = 0;
    for (const b of myBots) if (!b.free) { if (b.isAttack) attackers++; else defenders++; }
    for (const b of myBots) {
      if (!b.free) continue;
      const total = attackers + defenders;
      const attack = total === 0 ? aggression >= 0.5
        : aggression > 0 && ((1 - aggression) <= 0 || attackers / total <= aggression);
      b.isAttack = attack;
      if (attack) attackers++; else defenders++;
    }
    // Targets.
    const nAttacks = strategy?.attacks ?? 1;
    const nDefences = strategy?.defences ?? 0;
    const attackCands = this.layer.areas.map(a => ({ area: a, value: this._attackValue(a, side) }))
      .filter(c => c.value > SAI.candidateMin).sort((x, y) => y.value - x.value);
    const defenceCands = this.layer.areas.map(a => ({ area: a, value: this._defenceNeed(a, side) }))
      .filter(c => c.value > SAI.candidateMin).sort((x, y) => y.value - x.value);
    const attacks = attackCands.slice(0, Math.max(0, nAttacks));
    const defences = defenceCands.slice(0, Math.max(0, nDefences));
    S.attacks = attacks.map(c => c.area);
    S.defences = defences.map(c => c.area);
    for (const [area, st] of this.areaState) st[side].isAttack = S.attacks.includes(area);
    // Release bots assigned to areas no longer targeted.
    for (const b of myBots) {
      if (b.assignedTo && !S.attacks.includes(b.assignedTo) && !S.defences.includes(b.assignedTo)) {
        b.assignedTo = null; b.free = true;
      }
    }
    // Collect: each target takes the nearest free bots of its kind until
    // present >= wanted; one bot per target per round so several targets
    // share the pool (`collectAdditionalResources(1)` round-robin).
    const targets = [...attacks.map(c => ({ area: c.area, attack: true })), ...defences.map(c => ({ area: c.area, attack: false }))];
    let progressed = true;
    let guard = 64;
    while (progressed && guard-- > 0) {
      progressed = false;
      for (const t of targets) {
        const st = this.areaState.get(t.area)[side];
        const have = myBots.filter(b => b.assignedTo === t.area).length;
        if (have >= st.wanted) continue;
        const centre = this.layer.orderPosition(t.area);
        let best = null, bestD = Infinity;
        for (const b of myBots) {
          if (!b.free || b.isAttack !== t.attack) continue;
          const p = alive.get(b.id);
          const d = Math.hypot(p[0] - centre[0], p[2] - centre[1]);
          if (d < bestD) { bestD = d; best = b; }
        }
        if (!best) continue;
        this._order(best, t.area, side);
        best.free = false;
        best.assignedTo = t.area;
        progressed = true;
      }
    }
    // Free bots hold where they are (`retainBot`: an empty route = this
    // area), re-ordered every 20 s while idle.
    for (const b of myBots) {
      if (!b.free) continue;
      if (this.time - b.orderedAt < SAI.reorderIdle) continue;
      const p = alive.get(b.id);
      const area = b.area ?? this.layer.nearestArea(p[0], p[2]);
      if (area) this._order(b, area, side);
    }
    this._reorderArrived(myBots, side);
  }

  /**
   * `SAI::updateBotPositions` 0x08635bc0 (the assigned, attacker and
   * defender lists alike): a bot whose single-point order has arrived
   * (WPMoveTo +5) is ordered again into the area it holds once 20 s (on foot)
   * or 35 s (in a vehicle: `getControlledObject` != the soldier) have passed
   * since its last order, while it sees fewer than 2 objects and is present
   * in that area. A new random point moves it on.
   */
  _reorderArrived(myBots, side) {
    for (const b of myBots) {
      if (b.free || !b.assignedTo || !b.waypoints?.arrived) continue;
      const mounted = !!this.unitOf?.(b.id)?.mounted;
      if (this.time - b.orderedAt <= (mounted ? SAI.reorderMounted : SAI.reorderIdle)) continue;
      if ((this.spottedOf?.(b.id) ?? 0) >= SAI.reorderSpottedMax) continue;
      if (b.area !== b.assignedTo) continue;
      this._order(b, b.assignedTo, side);
    }
  }

  /**
   * `AIStrategicArea::orderNormalBot` 0x08640bd0 (no route: the bot is
   * ordered into this area directly). The point is `randomizePos(side, 0.8)`,
   * tried up to 20 times against the bot's OWN unit map (IAIPathfinding
   * vt+0x78 on the Mobile plug-in's map), else `getOrderPos(map, side)`. The
   * WPMoveTo radius is 0.25 x the side's radius + 2 x the unit's bounding
   * radius, at least 5 (`WPMoveTo` ctor 0x08537200).
   */
  _order(bot, area, side) {
    const unit = this.unitOf?.(bot.id) ?? null;
    if (unit?.air) return this._orderAir(bot, area, side, unit);
    const type = unit?.type ?? INFANTRY_TYPE;
    const valid = unit?.isWalkable ?? this.isWalkable;
    const bounding = unit?.radius ?? SAI.unitRadius;
    const R = Math.max(SAI.waypointRadiusMin,
                       this.layer.sideRadius(area, side) * SAI.waypointRadiusFraction + 2 * bounding);
    let point = null;
    for (let i = 0; i < 20; i++) {
      const cand = this.layer.randomizePos(area, SAI.randomizeFraction, this.random);
      if (!valid || valid(cand[0], cand[1])) { point = cand; break; }
    }
    if (!point) point = this.layer.orderPosition(area, type, valid);
    const layer = this.layer;
    bot.orderedAt = this.time;
    bot.waypoints = {
      kind: 'WPMoveTo',
      area,
      point,
      radius: R,
      unitType: type,
      owned: () => layer.ownerOf(area) === side,
      /** Whether a point is in the ordered area: `AIStrategicArea::isInside`
       *  0x08641d40, the test `BBFire::calculateUrgency` (0x085639f3) and
       *  `WPMoveTo::getUrgency` make. */
      inside: (x, z) => layer.isInside(area, x, z),
      /**
       * `WPMoveTo::getUrgency` 0x085374a0 on the last point. R' = round(R)
       * + the unit's `getMaxPathPosRemovalDistance` (Bot vt+0xf8,
       * `BotMain` 0x0852b780). Inside R' the order has arrived and asks for
       * nothing. Otherwise: x2 in an area the side does not hold (area
       * +0x70[side] is the side's status, 0 Owned / 1 Hostile / 2 Neutral by
       * `operator<<` 0x08489660); in a held one 0 inside its box, else x1 with the
       * side's radius taken off d^2. Arrived again when d^2 < 2 R'^2; the
       * urgency is clamp(d^2 / 4R'^2, 0.1, 1) x the factor.
       */
      urgency(x, z, pathRadius = SAI.unitRadius) {
        const Rr = Math.round(R) + pathRadius;
        const R2 = Rr * Rr;
        let d2 = (x - point[0]) ** 2 + (z - point[1]) ** 2;
        if (d2 < R2) { this.arrived = true; return 0; }
        let factor;
        if (!this.owned()) factor = 2.0;
        else if (layer.isInside(area, x, z)) { factor = 0; d2 = 0; }
        else { factor = 1.0; d2 -= layer.sideRadius(area, side) ** 2; }
        this.arrived = d2 < 2 * R2;
        return Math.min(1, Math.max(0.1, d2 / (4 * R2))) * factor;
      },
      arrived: false,
    };
    return bot.waypoints;
  }

  /**
   * `AIStrategicArea::orderAirBot` 0x08640810 (`orderBot` 0x08640760 sends
   * a unit whose information carries the air flag here): no random point,
   * the area's own position (vt+0xc) at the ground + 75 m, a
   * `WPAltitudeMoveTo(min(40, side radius), 120, 50, 2)` (0x08640982). Its
   * +0x14 (50) is the clearance `BBPGotoWaypoint3d::createPlan` 0x085b81e0
   * hands `BAPAMoveTo3d`. `WPAltitudeMoveTo::getUrgency` 0x08535610 on the
   * last point: 1 unless within the radius across and 120 m up or down, then
   * (dy^2 + d^2) / (r^2 + 120^2); it never marks the order arrived.
   */
  _orderAir(bot, area, side, unit) {
    const [x, z] = area.centre;
    const g = unit.groundAt ? unit.groundAt(x, z) : NaN;
    const point = [x, z];
    const y = (Number.isFinite(g) ? g : 0) + SAI.airOrderHeight;
    const R = Math.min(SAI.airRadiusMax, this.layer.sideRadius(area, side));
    const layer = this.layer;
    bot.orderedAt = this.time;
    bot.waypoints = {
      kind: 'WPAltitudeMoveTo',
      area,
      point,
      y,
      radius: R,
      clearance: SAI.airClearance,
      owned: () => layer.ownerOf(area) === side,
      inside: (x, z) => layer.isInside(area, x, z),
      urgency(px, pz, _pathRadius, py = y) {
        const d2 = (px - x) ** 2 + (pz - z) ** 2;
        const dy2 = (py - y) ** 2;
        const V = SAI.airVertical;
        if (R * R <= d2 || V * V <= dy2) return 1;
        return (dy2 + d2) / (R * R + V * V);
      },
      arrived: false,
    };
    return bot.waypoints;
  }
}
