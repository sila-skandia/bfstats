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
      const area = {
        name: a.name,
        min: a.min, max: a.max, radius: a.radius ?? 0,
        centre: [(a.min[0] + a.max[0]) / 2, (a.min[1] + a.max[1]) / 2],
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
   * the points are neutral or split; the authored side for an area with no
   * control point (a base's spawn area, a pass).
   */
  ownerOf(area) {
    if (!area.controlPoints.length) return area.side ?? 0;
    let side = null;
    for (const f of area.controlPoints) {
      const t = f.team === 1 || f.team === 2 ? f.team : 0;
      if (side === null) side = t;
      else if (side !== t) return 0;
    }
    return side ?? 0;
  }

  /** Whether `side` can take the area (`setTakeable <side> 0` forbids it;
   *  an uncapturable control point forbids it too). */
  takeableBy(area, side) {
    if (area.takeable[String(side)] === false) return false;
    if (area.controlPoints.length && area.controlPoints.every(f => f.uncapturable)) return false;
    return true;
  }

  /** The point an infantry order to `area` walks to. */
  orderPosition(area, vehicleType = INFANTRY_TYPE) {
    const p = area.orderPositions[vehicleType] ?? area.orderPositions[INFANTRY_TYPE];
    if (p) return [p[0], p[1]];
    if (area.controlPoints.length) {
      const f = area.controlPoints[0];
      return [f.position[0], f.position[2]];
    }
    return [area.centre[0], area.centre[1]];
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
  updateFrequency: 5.0,
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
  randomizeFraction: 0.8,
  waypointRadiusFraction: 0.25,
  waypointRadiusMin: 5.0,
  unitRadius: 1.0,
  unitValue: 1.0,
};

export class StrategicAI {
  /**
   * @param {StrategicLayer} layer
   * @param {object} [opt]  `random`, `isWalkable(x, z)`
   */
  constructor(layer, { random = Math.random, isWalkable = null } = {}) {
    this.layer = layer;
    this.random = random;
    this.isWalkable = isWalkable;
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
      const strength = cond.strength[0] ?? 'Required';
      if (strength === 'Required' || strength === 'RequiredPositive') { if (v < 0) return 0; }
      else if (strength === 'RequiredNegative') { if (v > 0) return 0; }
      else if (strength === 'Advisory') sum += v;
      else if (strength === 'AdvisoryPositive') sum += Math.max(0, v);
      else if (strength === 'AdvisoryNegative') sum += Math.min(0, v);
      else if (v < 0) return 0;
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
  }

  /** `orderNormalBot`: a WPMoveTo at the area's (randomised) position. */
  _order(bot, area, side) {
    const st = this.areaState.get(area)[side];
    const base = this.layer.orderPosition(area);
    const R = Math.max(SAI.waypointRadiusMin, area.radius * SAI.waypointRadiusFraction + 2 * SAI.unitRadius);
    let point = base;
    for (let i = 0; i < 20; i++) {
      const ang = this.random() * Math.PI * 2;
      const r = this.random() * area.radius * SAI.randomizeFraction;
      const cand = [base[0] + Math.cos(ang) * r, base[1] + Math.sin(ang) * r];
      if (!this.isWalkable || this.isWalkable(cand[0], cand[1])) { point = cand; break; }
    }
    bot.orderedAt = this.time;
    bot.waypoints = {
      kind: 'WPMoveTo',
      area,
      point,
      radius: R,
      owned: () => this.layer.ownerOf(area) === side,
      inside: (x, z) => this.layer.areaAt(x, z) === area,
      /** `WPMoveTo::getUrgency`: distance-scaled, x2 for a hostile area,
       *  0 once inside an owned one; arrived at `d^2 < 2 R^2`. */
      urgency(x, z, unitRadius = SAI.unitRadius) {
        const Rr = R + unitRadius;
        let d2 = (x - point[0]) ** 2 + (z - point[1]) ** 2;
        let factor;
        if (!this.owned()) factor = 2.0;
        else if (this.inside(x, z)) { factor = 0; d2 = 0; }
        else { factor = 1.0; d2 = Math.max(0, d2 - area.radius * area.radius); }
        this.arrived = d2 < 2 * Rr * Rr;
        return Math.min(1, Math.max(0.1, d2 / (4 * Rr * Rr))) * factor;
      },
      arrived: false,
    };
    return bot.waypoints;
  }
}
