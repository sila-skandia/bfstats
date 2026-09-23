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
//
// Split out of `strategic.js`, which re-exports it beside `strategic-ai.js`.

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
