// The strategic AI (`SAI`) that runs over the strategic layer: split out of
// `strategic.js`, which re-exports it beside `strategic-layer.js`, the area
// data this reads.

import { INFANTRY_TYPE } from './strategic-layer.js';
import { captureReach, captureStandRadius } from './control-point-law.js';
import { LANDING, landingZonesOf, beachTarget, beachLandingOrder } from './doctrine-landing.js';

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
    /** The level's landing zones by name (`extras.ai.landingZones`), for the
     *  beach orders `_order` gives a landing craft. */
    this.zones = landingZonesOf(layer.ai);
    /** The alive map of the pass being distributed, for `_order`. */
    this._alive = null;
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
        /** The hold-only fallback holds the side (`_holdOnlyFallback`). */
        fallback: false,
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
    this.bots.set(id, { id, side, positionOf, area: null, assignedTo: null, isAttack: false, orderedAt: -Infinity, waypoints: null, free: true, post: null, lastPost: null });
  }

  removeBot(id) {
    this.bots.delete(id);
  }

  /** A bot died: it is freed and its order dropped. */
  botDied(id) {
    const b = this.bots.get(id);
    if (!b) return;
    b.assignedTo = null; b.waypoints = null; b.free = true; b.area = null; b.post = null; b.lastPost = null;
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
    // A garrison post (doctrine-garrison.js) is given up with the rest; the
    // flag keeps him as its last guard, for the next pass.
    if (b.post) { b.lastPost = b.post; b.post = null; }
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
    this.beginPass(alive);
    for (const side of [1, 2]) this.sidePass(side, alive);
  }

  /**
   * The half of a pass both sides share: the flags bound to the areas and
   * each area's presence, owner, status and temperatures (`_updateAreas`).
   * `alive` is every alive bot of both sides. The strategic command
   * (doctrine.js) calls this and then `sidePass` per side, which is what
   * `update` does.
   */
  beginPass(alive) {
    this.layer.bindFlags(this.layer.flags);
    this._updateAreas(alive);
  }

  /**
   * One side's half of a pass: the states, the strategy, the temperatures
   * and the distribution of the side's bots in `alive`. A doctrine that
   * hands only some of its bots to the SAI (doctrine-squad.js: the squad
   * leaders) passes those alone; the areas were counted with everyone in
   * `beginPass`. `opts.garrison` is the garrison play's hook
   * (doctrine-garrison.js, INVENTION): see `_distribute`; the 'sai' doctrine
   * passes none, and without it nothing here changes.
   */
  sidePass(side, alive, opts = null) {
    this._updateStates(side);
    this._chooseStrategy(side);
    this._updateTemperatures(side);
    if (this._holdOnlyFallback(side)) return;
    this._distribute(side, alive, opts);
  }

  /**
   * INVENTION, labelled (features/bot-map-generation/no-live-strategy.md and
   * flag-binding.md; KNOBS.md "hold-only side"): on a GENERATED layer
   * (`ai.generated`, the marker the bake copies from `generated.json`), a side
   * the SAI can only order to hold, gives every bot the order a level with no
   * layer gives (bot-decision.js `fallbackWaypoint`: the nearest flag the side
   * does not hold), and goes back to the SAI at
   * the first pass where it can attack again. A side holds-only when its
   * strategy (live, or the one kept with none scoring) has no attack target
   * (no area above `SAI.candidateMin`, or NumberOfAttacks 0) while a
   * capturable flag it does not hold still stands: the flag the no-layer
   * order would walk it to. A side that holds every capturable flag is left
   * to the SAI. A flag the generator took out of play (`setTakeable <side>
   * 0`, "unreachable" by the walk test) counts, as it does on a level with no
   * layer: on the street levels every flag is out of play and both sides held
   * all match, and a flag the walk test calls unreachable is not always one
   * nobody takes (FH Pegasus' Axis took them; flag-binding.md).
   *
   * Why: a generated layer copies DICE's strategy template unchanged and its
   * area graph from the walk test. Where a side's own areas touch no area it
   * could take (FHSW Edson's Ridge before the flag binding was put right,
   * `StrategicLayer.bindFlags`; The Fortress, whose Axis base links to no
   * area; Knife Championship, The Corridor and Omaturi Channel Cannon), the
   * SAI orders every bot to hold where it stands for the whole match. The
   * first form of the rule (2026-11-11) also asked for no strategy to score;
   * once the `ControlPoint` state counted as the engine counts it, strategies
   * came alive on those levels with still nothing to attack, and that clause
   * kept their sides at home (no-live-strategy.md, flag-binding.md).
   *
   * Why the attack-target clause: a side with a target is the SAI's to play,
   * live strategy or not. Without it the fallback took over The Maze for 56 %
   * (Axis) and 78 % (Allies) of the match and its kills fell from 68 to 29
   * in the census match; DC_Basrah_Nights' from 52 to 36.
   *
   * The engine has no such rule: `SAI::chooseStrategy` 0x08631cd0 keeps the
   * strategy it has when none scores (AI-38; ai-spec strategic.md section 3),
   * and a side with no attack target holds (`retainBot`). A layer DICE or a
   * mod team wrote is never touched: what the retail engine does there is
   * what it does.
   *
   * Sets `sides[side].fallback`; true when it holds, after releasing every
   * bot of the side (no order, no assignment, a garrison post given up to
   * `lastPost`) and clearing the side's targets. `StrategicCommand` then
   * drops the side's orders, whatever its doctrine.
   */
  _holdOnlyFallback(side) {
    const S = this.sides[side];
    const on = !!this.layer.ai?.generated && S.containers.length > 0
      && ((S.active?.strategy.attacks ?? 1) <= 0 || !this.layer.areas.some(a => this._attackValue(a, side) > SAI.candidateMin))
      && this.layer.flags.some(f => f.position && !f.uncapturable && f.team !== side);
    S.fallback = on;
    if (!on) return false;
    S.attacks = [];
    S.defences = [];
    for (const b of this.bots.values()) {
      if (b.side !== side) continue;
      b.assignedTo = null; b.free = true; b.isAttack = false; b.waypoints = null;
      if (b.post) { b.lastPost = b.post; b.post = null; }
    }
    for (const [, st] of this.areaState) { st[side].assigned.clear(); st[side].isAttack = false; }
    return true;
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
      // `AIStrategicArea::update` 0x0863d6d0 counts the side's and the
      // enemy's units in the area (the two counts its hold is decided by,
      // after the loops) over the objects the side and neutral grids return
      // there, skipping one whose Information type word has the air bit
      // (+4 & 0x10: the `testb $0x10,0x4(%ecx)` before each `inc`, at
      // 0x0863e182 and 0x0863e1e5), and then over each object's secondary objects
      // (`getFirstSecondaryObject` / `getSecondaryObject`, vt+0x80 at
      // 0x0863db67 and vt+0x78 at 0x0863dc73) with no such test. So a
      // plane's own seat never holds or contests an area, a gunner's seat of
      // it (a B17's) does; the strength sums take both (Brief R item 5,
      // ledger AI-127). The viewer counts bots: one in an aircraft's root
      // seat is left out of the count.
      const unit = this.unitOf?.(b.id) ?? null;
      if (!(unit?.air && unit?.root)) st[b.side].present.push(b.id);
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
    // `ControlPoint` (state slot 0x12). NOT the engine's count, kept. The
    // engine's is `IAIEnvironment` vt+0x94 for the side,
    // `BFEnvironment::getNumberOfControlPoints(team)` (0x085e4f80): the
    // control points in the object manager's vector whose team (+0x174) is
    // the side's, so no stand-in (a spawn group no point claims, a ship's
    // decks; strategic-layer.js `isStandIn`), and `SAI::updateStates` adds no
    // area type flag to it (read from the third-party decompile of the 1.61
    // Linux server and the Mac client). The page counts every world flag the
    // side holds, stand-ins with them, and (the flag loop below) each owned
    // area typed `ControlPoint` again. Either change moves the strategy a
    // generated layer's template chooses on every level that has stand-ins
    // or such areas: with both, DC_LostVillage lost a third of its captures
    // and Tunis 39 %; with the stand-ins alone out, Battle for Ortona lost
    // half its kills, three seeds each; DICE's four levels and every bar and
    // verdict measured on them move with the area term
    // (features/bot-map-generation/flag-binding.md, section 5). Its own
    // change, with the generator's template choice beside it: not made here.
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
        // NOT the engine's, kept: the type flag `ControlPoint` shares its name
        // with the state slot above, and so an owned area typed
        // `ControlPoint` adds one to the side's `ControlPoint` again; the
        // engine counts that type flag into no slot (see above for why it is
        // kept).
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
      // A change frees every bot of the side (a garrison post too: `post` is
      // set only while a bot is posted, `lastPost` keeps the flag's guard).
      for (const b of this.bots.values()) {
        if (b.side !== side) continue;
        b.assignedTo = null; b.free = true;
        if (b.post) { b.lastPost = b.post; b.post = null; }
      }
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

  /**
   * `opts.garrison` (the garrison play, doctrine-garrison.js; INVENTION,
   * labelled at each branch): every free bot attacks whatever the strategy's
   * aggression; the strategy's defence targets are not collected; before the
   * collection `garrison.post({ sai, side, bots, alive })` posts at most one
   * bot on each flag it chooses (the record's `post`, not free, no SAI
   * order: the play gives the post its own); and after it a free bot joins
   * the nearest attack target instead of holding where it is.
   */
  _distribute(side, alive, opts = null) {
    const garrison = opts?.garrison ?? null;
    this._alive = alive;
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
      // The garrison: a free bot attacks (its posts are its own).
      const attack = garrison ? true : total === 0 ? aggression >= 0.5
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
    // The garrison collects no defenders: one post a flag stands for them.
    const defences = garrison ? [] : defenceCands.slice(0, Math.max(0, nDefences));
    S.attacks = attacks.map(c => c.area);
    S.defences = defences.map(c => c.area);
    for (const [area, st] of this.areaState) st[side].isAttack = S.attacks.includes(area);
    // Release bots assigned to areas no longer targeted.
    for (const b of myBots) {
      if (b.post && !b.free) continue;   // a garrison post: the play releases it
      if (b.assignedTo && !S.attacks.includes(b.assignedTo) && !S.defences.includes(b.assignedTo)) {
        b.assignedTo = null; b.free = true;
      }
    }
    if (garrison) garrison.post({ sai: this, side, bots: myBots, alive });
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
    // The garrison: a free bot left over joins the nearest attack target
    // rather than holding where it is (the base it spawned at, the flag it
    // just took).
    if (garrison && attacks.length) {
      for (const b of myBots) {
        if (!b.free) continue;
        const p = alive.get(b.id);
        let best = null, bestD = Infinity;
        for (const t of attacks) {
          const c = this.layer.orderPosition(t.area);
          const d = Math.hypot(p[0] - c[0], p[2] - c[1]);
          if (d < bestD) { bestD = d; best = t.area; }
        }
        this._order(b, best, side);
        b.free = false;
        b.isAttack = true;
        b.assignedTo = best;
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
    // INVENTION (`_captureRing`): a ring order whose bot found no route to
    // the flag is drawn again, now the engine's way.
    for (const b of myBots) {
      const o = b.waypoints;
      if (o?.captureFlag && b.ringless?.has(o.captureFlag)) this._order(b, o.area, side);
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
    if (type === LANDING.unitType && this.zones.size) {
      const beach = this._orderBeach(bot, area, side, unit);
      if (beach) return beach;
    }
    const valid = unit?.isWalkable ?? this.isWalkable;
    const bounding = unit?.radius ?? SAI.unitRadius;
    const R = Math.max(SAI.waypointRadiusMin,
                       this.layer.sideRadius(area, side) * SAI.waypointRadiusFraction + 2 * bounding);
    // INVENTION (the capture ring, `_captureRing`): on foot, to a flag
    // narrower than this order's own arrival distance, the point is the flag.
    const ring = this._captureRing(bot, area, side, unit, R, valid);
    let point = ring?.point ?? null;
    for (let i = 0; !point && i < 20; i++) {
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
      // The plan's arrival radius (bot-plans.js `planMoveTo`): the engine's
      // R, or the ring's when the order is bound to a flag's.
      radius: ring ? ring.radius : R,
      /** The flag whose capture ring this order ends in, else null. */
      captureFlag: ring?.flag ?? null,
      /** The bot's routes to the ring's point keep failing (bot-decision.js
       *  `urgencyMoveTo`): it stops asking for this flag's ring, and the
       *  next pass draws its order again (`_distribute`). */
      noRoute() { if (ring) (bot.ringless ??= new Set()).add(ring.flag); },
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
        // INVENTION (`_captureRing`): while the flag is still to take, the
        // order has arrived only inside its ring, and between the ring and
        // R' it keeps the urgency the engine's order has at R' (0.25 x 2),
        // so the last metres are asked for as firmly as the approach was.
        // A ring the ground cut (`ring.cut`: the pole on a floor over the
        // street, or in a pit) is the exception: its urgency is the engine's
        // law with the ring's own radius where it has R',
        // clamp(d^2 / 4 r^2, 0.25, 1) x 2. Measured against R' those metres
        // asked 0.5 all the way in, under the Scout behaviour's 1.0 for an
        // enemy lost from sight, and a soldier who had seen one stood
        // between the ring and R' turning to and fro until shot (the lifted
        // shigaisen_B test level, seed 2, 27 s at 3.6 m from a 1.86 m ring).
        // A flat ring keeps R': with its own radius for every ring, the real
        // shigaisen_B at 16 a side went from 1.78 to 2.23 stuck seconds a
        // bot-minute over ten seeds, and Stalingrad's traces changed. Once
        // the side holds the flag the engine's rule below reads the same
        // point, and a bot in the ring is inside R'.
        if (ring?.wanted()) {
          const r2 = ring.radius * ring.radius;
          if (d2 < r2) { this.arrived = true; return 0; }
          this.arrived = false;
          return Math.min(1, Math.max(0.25, d2 / (4 * (ring.cut ? r2 : R2)))) * 2.0;
        }
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
   * INVENTION, labelled (the engine has no such rule; `orderNormalBot` and
   * `WPMoveTo::getUrgency` never read a control point's radius): a bot on
   * foot ordered to a flag ends inside its capture ring.
   *
   * The engine's order has arrived inside R' = round(R) + the path radius of
   * a random point of the area's box, R at least 5, so 6 m on foot at the
   * least. A capture counts a body inside the flag's own radius
   * (control-point-law.js). Where that radius is under R', even a point
   * drawn on the pole stops the bot outside the ring: at a 5 m flag
   * (Stalingrad's `Railroads`, seven of the community map shigaisen_B's
   * eight) bots stopped 5 to 7 m out, scouted there and took nothing but
   * what a route happened to cross. DICE's wider flags hide it.
   *
   * So for a soldier, when the area holds a control point that can change
   * hands, whose reach across the ground is under this order's R', and which
   * the side does not hold or is losing (the lose timer running, state 2),
   * the order's point is the flag itself (the nearest point of the bot's own
   * map inside the ring when the flag's cell is blocked, as the engine tests
   * its own draws) and it has arrived only within `captureStandRadius` of
   * the flag. Returns `{ flag, point, radius, cut, wanted() }`, or null and the
   * engine's order stands untouched: every flag at least R' wide on the
   * ground, a held flag, an area with no point, a flag no cell of the map
   * reaches.
   *
   * The ring is the 3D radius cut by the ground. A capture is measured in 3D
   * and an order across the ground, so where the unit knows the ground a
   * soldier stands on under the pole (`unit.groundAt`) the flag's reach is
   * what its radius leaves there, sqrt(r^2 - dy^2) (control-point-law.js
   * `captureReach`), and the stand radius is that less the body's metre once
   * the flat figure no longer fits (`captureStandRadius`). The community map
   * shigaisen_C stands its six 5 m flags on a floor 4.1 m over the street:
   * 2.8 m of reach, so a soldier must come within 1.8 m of the pole's foot,
   * and the engine's order stopped them 6 m out. A wide flag on a height is
   * narrow on the ground the same way (10 m, 8.5 m up: 5.3 m of reach).
   *
   * Two things keep a ring that cannot be stood in from being ordered. A
   * pole the ground does not reach: where the radius leaves less than a
   * body's width on the ground, or nothing, the engine's order stands. Two of
   * Stalingrad's three flags are on an upper floor, 13.5 m over the street;
   * bound to their rings, bots failed 31 routes in 300 s where they had
   * failed none, walked at the walls and were redeployed. And a valid cell
   * is not a route: a bot whose routes to the ring's point fail twice running
   * gives that flag's ring up for the match (`noRoute`, the record's
   * `ringless`) and is ordered again the engine's way on the next pass.
   *
   * Not a mounted bot: a hull's R' carries twice its bounding radius, which
   * is wider than most flags, and a ring is no promise of room for a hull at
   * the pole; it keeps the engine's order.
   */
  _captureRing(bot, area, side, unit, R, valid) {
    if (unit?.mounted) return null;
    const arrive = Math.round(R) + SAI.unitRadius;
    const wanted = flag => flag.team !== side || flag._cp?.state === 2;
    for (const flag of area.controlPoints) {
      if (!flag.position || flag.uncapturable || bot.ringless?.has(flag)) continue;
      if (!wanted(flag)) continue;
      const [fx, fz] = [flag.position[0], flag.position[2]];
      // The pole over (or under) the ground a soldier stands on at its foot.
      const ground = unit?.groundAt?.(fx, fz);
      const dy = Number.isFinite(ground) ? flag.position[1] - ground : 0;
      if (captureReach(flag, dy) >= arrive) continue;
      const stand = captureStandRadius(flag, dy);
      if (!(stand > 0)) continue;
      // The flag's own cell, else the nearest valid one on rings 1 m apart,
      // keeping at least 1 m of arrival radius about the point.
      let point = !valid || valid(fx, fz) ? [fx, fz] : null;
      let off = 0;
      for (let d = 1; !point && d <= stand - 1; d++) {
        for (let k = 0; !point && k < 8; k++) {
          const x = fx + d * Math.cos(k * Math.PI / 4), z = fz + d * Math.sin(k * Math.PI / 4);
          if (valid(x, z)) { point = [x, z]; off = d; }
        }
      }
      // `cut`: the ground left less than the flat figure (`_order`'s urgency).
      if (point) return { flag, point, radius: stand - off, cut: stand < captureStandRadius(flag), wanted: () => wanted(flag) };
    }
    return null;
  }

  /**
   * `orderNormalBot` 0x08640bd0 for a landing craft (the unit type
   * `LandingCraft`): the area's own beach when it uses a zone for the unit
   * with no route or already in it (`WPBeachLanding`), else the beach of
   * the first zone-using area on the engine's route to it, with the route's
   * points (`WPMoveToBeachLanding`); null when neither applies, and the
   * order is the ordinary `WPMoveTo`. doctrine-landing.js has the laws.
   */
  _orderBeach(bot, area, side, unit) {
    const p = this._alive?.get(bot.id);
    if (!p) return null;
    const target = beachTarget({ layer: this.layer, zones: this.zones, area, side, unit, x: p[0], z: p[2],
                                 ai: this.layer.ai, random: this.random, isValid: unit?.isWalkable ?? null });
    if (!target) return null;
    const order = beachLandingOrder({ target, area, side, layer: this.layer, isValid: unit?.isWalkable ?? null,
                                      random: this.random, zones: this.zones });
    if (!order) return null;
    bot.orderedAt = this.time;
    bot.waypoints = order;
    return order;
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
