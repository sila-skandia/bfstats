// The strategic AI's beach landing: the orders `orderNormalBot` gives a
// landing craft (`WPBeachLanding`, `WPMoveToBeachLanding`) over the level's
// `AILandingZone`s, and the bail at the beach every occupant of a landing
// craft runs (`BBChangeLandingCraft`). Read 2026-09-24 from the lnxded
// decompile (ledger AI-92..AI-95, KNOBS.md "beach landing").
//
// The SAI builds the order in `strategic-ai.js _order` for a bot whose unit
// is a `LandingCraft` (the helm of a Daihatsu or an LCVP); `doctrine.js`
// registers both kinds with `landingTick` as their per-tick executor. The
// order meets the bots' contract (doctrine.js header): a point, a radius and
// an urgency; on the beach leg it also carries `direct`, which the plan
// (`bot-plans.js planMoveTo`) drives as a straight helm with no route.
//
// ## What the engine does (addresses in lnxded)
//
//  * `AIStrategicArea::orderNormalBot` 0x08640bd0: the bot's unit type is its
//    Unit plug-in's equipment type (`LandingCraft` = 7 in
//    `Game/AIbehaviours.con`, the Daihatsu's and LCVP's `equipmentType 7`).
//    With no route (0x08640cf3) or a route of one area (0x08641428), an area
//    whose landing-zone users (+0x150, `isLandingZoneUser` 0x086402b0) hold
//    that type gets a `WPBeachLanding` on its zone closest to the bot
//    (`getClosestLandingZone(Pos3)` 0x08640250 -> 0x086401e0: least
//    `getDistanceSqr`). With a longer route, the first route area that is a
//    user (0x0864104b) ends it in a `WPMoveToBeachLanding` (0x08641133) with
//    the route's earlier area points and that area's closest zone.
//  * `AILandingZone` (ctor 0x0863ac80): a corner box, its corners sorted, and
//    a beach side (`LZXMin` 0, `LZZMin` 1, `LZXMax` 2, `LZZMax` 3, operator>>
//    0x08488e80). `getBeachPosition` 0x0863ae40 is a uniform random point on
//    the beach edge; `getApproachPosition` 0x0863ad80 is a random point on the
//    opposite edge ((side + 2) mod 4) moved 10 m in (`getRandomPosOnSide`
//    0x0863b130), tried up to 20 times against the unit's own map (the
//    `IAIPathfinding` vt+0x78 test), the last try kept when none is valid.
//    `getDistanceSqr` 0x0863af20: 0 inside the box (`insideCornerBox`
//    0x08654020, edges inclusive), else the squared distance from the point
//    to where the line from the box centre towards it leaves the box
//    (`getIntersection` 0x08654560).
//  * `WPBeachLanding` (ctor 0x08536350): `getUrgency` 0x085363d0 is 1 unless
//    the waypoint's error flag (+6, `setWayPointError` 0x085353b0) is set,
//    and never arrives; it stores `inside = getDistanceSqr == 0` (+0xc; the
//    x87 test at 0x08536409 is equality) and flags the waypoint changed (+4)
//    when that flips, which rebuilds the plan. `getGoalPoint` 0x08536450 is a
//    fresh approach point outside the zone and a fresh beach point inside
//    it. `getWayPointRadius` 0x08536500 is 10.
//  * `WPMoveToBeachLanding` (ctor 0x08537ce0): the route points first; then
//    as above, but inside is `getDistanceSqr < 10` (0x08537e89, the constant
//    at 0x86b9314) and the radius is its +0x10, max(5, the ctor's radius).
//  * The craft's plan, `BBPGotoWaypointBoat::createPlan` 0x085b8c50 for the
//    waypoint ids 3 and 4 (the `default:` arm): outside the zone, a
//    `BAPAMoveToFinding` to the approach point with the waypoint's radius;
//    inside it, `while (true) { BAPAMoveToDirect to the beach point,
//    BAPATriggerContinously(PIPitch) }` -- a straight run at the beach with
//    the ramp input held (the Daihatsu's `DaihatsuLanding1/2` and the LCVP's
//    `Lcvp_Ramp` are bound to `c_PIPitch`), which never finishes.
//  * `BBChangeLandingCraft::calculateUrgency` 0x085602b0, the Change
//    behaviour of the `LandingCraft`, `LandingCraftPassenger` and
//    `LandingCraftFixed` units (`Game/AIbehaviours.con`): every occupant of a
//    surface craft gets out (`BBPChangeLandingCraft` 0x0858f2e0 presses
//    PIUse, urgency 4.0) when the craft is inside ANY landing zone
//    (`AILandingZoneManager::isInsideLandingZone` 0x08560684), touching land
//    (`IPIPhysical::isTouchingLand`, vt+0x4c at 0x085606bd), slower than
//    2 m/s (`IPIMobile::getSpeedMagnitude` vt+0x1c, 0x8560c60 against 2.0 at
//    0x86c08c4), and the soldier's own map is valid where he sits
//    (0x0856080e); or when the craft has tipped: its up axis under 0.7071 of
//    the vertical in water 2 m deep or more, under 0.7071 of the terrain
//    normal in shallower water (0x8560b84..0x8560c4b).
//
// ## What the viewer does differently
//
//  * No strategic route: the viewer's SAI orders a bot into its target
//    directly (`strategic-ai.js _order`), so the engine's no-route case is
//    the rule -- a target that uses a zone gets a `WPBeachLanding`. A target
//    that does not (an inland area, or one that expels landing craft) would
//    be an inland `WPMoveTo` the craft cannot drive; there `landingRoute`
//    walks the area graph from the craft's area to the target (INVENTION:
//    the engine's route tables, `AIStrategicArea::validateDistances`, are not
//    read) and the first area on it that uses a zone gives a
//    `WPMoveToBeachLanding`. Its intermediate route points are not driven:
//    the craft's own water-map route goes round the island.
//  * `isTouchingLand` has no viewer counterpart: the infantry map's test at
//    the hull (which the engine also makes) stands in for both. The tip test
//    reads the candidates' `upright` (the hull's up y at least 0.6914), not
//    the engine's two forms.
//  * The occupants' bail runs from the driver's order: this executor
//    presses Use for every bot in the craft. A craft whose driver has left
//    or died carries its passengers on (the engine's run their own Change).
//  * The ramp input (PIPitch) is not written: the viewer's craft has no
//    ramp to lower.

/** The engine's numbers (addresses above). */
export const LANDING = {
  /** `Game/AIbehaviours.con` `setVehicle 7 LandingCraft`: the unit type the
   *  zones name with `addLandingZoneUnit`. */
  unitType: 'LandingCraft',
  /** `getGoalPoint` 0x08536450 pushes 10.0 (0x41200000) as the approach
   *  point's offset in from the seaward edge. */
  approachOffset: 10.0,
  /** `getApproachPosition` 0x0863ad80: tries against the unit's map. */
  approachTries: 20,
  /** `WPBeachLanding::getWayPointRadius` 0x08536500. */
  waypointRadius: 10.0,
  /** `WPMoveToBeachLanding` ctor 0x08537ce0: its radius is at least 5. */
  moveToRadiusMin: 5.0,
  /** `orderNormalBot` 0x08640bd0: the radius before any route area is read
   *  (`fStack_180 = 1.0`). */
  moveToRadiusNoRoute: 1.0,
  /** `WPMoveToBeachLanding::getUrgency` 0x08537e89: inside is d^2 < 10. */
  moveToInsideD2: 10.0,
  /** `BBChangeLandingCraft` 0x8560c60: the craft is stopped under 2 m/s. */
  bailSpeed: 2.0,
};

/** Every landing zone of the level (`extras.ai.landingZones`), by name. */
export function landingZonesOf(ai) {
  const out = new Map();
  for (const z of ai?.landingZones ?? []) {
    if (!Array.isArray(z?.min) || !Array.isArray(z?.max)) continue;
    out.set(String(z.name).toLowerCase(), {
      name: z.name,
      min: [Math.min(z.min[0], z.max[0]), Math.min(z.min[1], z.max[1])],
      max: [Math.max(z.min[0], z.max[0]), Math.max(z.min[1], z.max[1])],
      beach: z.beach ?? null,
    });
  }
  return out;
}

/** `insideCornerBox` 0x08654020: min <= p <= max, edges inclusive. */
export function insideZone(zone, x, z) {
  return x >= zone.min[0] && z >= zone.min[1] && x <= zone.max[0] && z <= zone.max[1];
}

/**
 * `getIntersection` 0x08654560: where the line from `p` along `d` crosses
 * the box `min..max`, the z edges tried before the x edges, the far one by
 * the sign of `d`; a flat box gives `p`. Null when no edge is crossed (the
 * engine then leaves the output as it was: zero).
 */
export function lineBoxExit(min, max, d, p) {
  const w = max[0] - min[0], h = max[1] - min[1];
  if (w === 0 || h === 0) return [p[0], p[1]];
  const a = d[0], b = d[1], na = -a;
  const c = -(b * p[0] + na * p[1]);
  const fMin = na * min[1] + b * min[0] + c;
  const fMax = b * max[0] + na * max[1] + c;
  if (b <= 0) {
    if (b < 0) {
      const t = -fMin / (b * w);
      if (t >= 0 && t <= 1) return [min[0] + w * t, min[1]];
    }
  } else {
    const t = fMax / (b * w);
    if (t >= 0 && t <= 1) return [max[0] - w * t, max[1]];
  }
  if (a >= 0) {
    if (a > 0) {
      const t = fMax / (na * h);
      if (t >= 0 && t <= 1) return [max[0], max[1] - h * t];
    }
  } else {
    const t = -fMin / (na * h);
    if (t >= 0 && t <= 1) return [min[0], min[1] + h * t];
  }
  return null;
}

/** `AILandingZone::getDistanceSqr` 0x0863af20 (Pos2 form). */
export function zoneDistanceSqr(zone, x, z) {
  if (insideZone(zone, x, z)) return 0;
  const c = [(zone.min[0] + zone.max[0]) * 0.5, (zone.min[1] + zone.max[1]) * 0.5];
  let dx = x - c[0], dz = z - c[1];
  // `BaseVector2::normalize`: left alone within 1.19e-7 of unit length,
  // zeroed below 1.42e-14.
  const l2 = dx * dx + dz * dz;
  if (Math.abs(l2 - 1) >= 1.1920929e-07) {
    if (Math.abs(l2) >= 1.4210855e-14) { const k = 1 / Math.sqrt(l2); dx *= k; dz *= k; } else { dx = 0; dz = 0; }
  }
  const e = lineBoxExit(zone.min, zone.max, [dx, dz], c) ?? [0, 0];
  return (x - e[0]) ** 2 + (z - e[1]) ** 2;
}

const OPPOSITE = { xMin: 'xMax', xMax: 'xMin', zMin: 'zMax', zMax: 'zMin' };

/**
 * `getRandomPosOnSide` 0x0863b130: a uniform point on the edge `edge`
 * (`xMin` / `xMax` / `zMin` / `zMax` in the viewer's frame), moved `offset`
 * in from it. Null for an undefined side (the engine's NaN).
 */
export function randomPosOnSide(zone, edge, offset, random = Math.random) {
  const u = random();
  switch (edge) {
    case 'xMin': return [zone.min[0] + offset, zone.min[1] + u * (zone.max[1] - zone.min[1])];
    case 'xMax': return [zone.max[0] - offset, zone.min[1] + u * (zone.max[1] - zone.min[1])];
    case 'zMin': return [zone.min[0] + u * (zone.max[0] - zone.min[0]), zone.min[1] + offset];
    case 'zMax': return [zone.min[0] + u * (zone.max[0] - zone.min[0]), zone.max[1] - offset];
    default: return null;
  }
}

/** `getBeachPosition` 0x0863ae40: a random point on the beach edge. */
export function beachPosition(zone, random = Math.random) {
  return randomPosOnSide(zone, zone.beach, 0, random);
}

/**
 * `getApproachPosition` 0x0863ad80: a random point 10 m in from the edge
 * opposite the beach, valid on the unit's map (`isValid(x, z)`); up to 20
 * tries, the last kept (`valid: false`) when none is.
 */
export function approachPosition(zone, isValid = null, random = Math.random) {
  const edge = OPPOSITE[zone.beach];
  if (!edge) return null;
  let p = null;
  for (let i = 0; i < LANDING.approachTries; i++) {
    p = randomPosOnSide(zone, edge, LANDING.approachOffset, random);
    if (!isValid || isValid(p[0], p[1])) return { point: p, valid: true };
  }
  return { point: p, valid: false };
}

/** `getClosestLandingZone` 0x086401e0: the area's zone with the least
 *  `getDistanceSqr` to the point (strictly less than the running best,
 *  starting at 1e9), or null. */
export function closestZone(area, zones, x, z) {
  let best = null, bestD = 1e9;
  for (const name of area?.landingZones ?? []) {
    const zone = zones.get(String(name).toLowerCase());
    if (!zone) continue;
    const d = zoneDistanceSqr(zone, x, z);
    if (d < bestD) { bestD = d; best = zone; }
  }
  return best;
}

/** `isLandingZoneUser` 0x086402b0: whether `area` sends `unitType` to its beach. */
export function isLandingZoneUser(area, unitType) {
  return !!area && (area.landingZoneUnits ?? []).includes(unitType) && (area.landingZones ?? []).length > 0;
}

/**
 * INVENTION (the engine's route tables are not read): the shortest path of
 * areas over the neighbour lists, taken both ways, from `start` to `target`;
 * returns the path's areas in order, or null.
 */
export function areaPath(layer, start, target) {
  if (!start || !target) return null;
  if (start === target) return [start];
  const adj = new Map(layer.areas.map(a => [a, new Set()]));
  for (const a of layer.areas) {
    for (const n of layer.neighboursOf(a)) { adj.get(a).add(n); adj.get(n)?.add(a); }
  }
  const prev = new Map([[start, null]]);
  const queue = [start];
  while (queue.length) {
    const a = queue.shift();
    for (const n of adj.get(a) ?? []) {
      if (prev.has(n)) continue;
      prev.set(n, a);
      if (n === target) {
        const path = [n];
        for (let p = a; p; p = prev.get(p)) path.unshift(p);
        return path;
      }
      queue.push(n);
    }
  }
  return null;
}

/**
 * The craft's own area, the route's first element: the area holding the
 * point (`StrategicLayer.areaAt`) unless it uses a zone for the unit or
 * expels it, else the nearest area by centre that does neither. INFERRED
 * from `AIStrategicObjectManager::getClosestObject` 0x08646490, which skips
 * an area that expels the unit (0x08646509) or, given a landing unit type,
 * uses a zone for it (0x0864653c); its own closeness measure (the area's
 * vt+0x58) is not read.
 */
export function craftArea(layer, x, z, unitType = LANDING.unitType) {
  const ok = a => a && !isLandingZoneUser(a, unitType) && !(a.expelledUnits ?? []).includes(unitType);
  const here = layer.areaAt(x, z);
  if (ok(here)) return here;
  let best = null, bestD = Infinity;
  for (const a of layer.areas) {
    if (!ok(a)) continue;
    const d = Math.hypot(x - a.centre[0], z - a.centre[1]);
    if (d < bestD) { bestD = d; best = a; }
  }
  return best ?? here;
}

/**
 * `orderNormalBot` 0x08640bd0 for a landing craft ordered to `area`: the
 * zone and kind of its beach order, or null when the order is an ordinary
 * `WPMoveTo`. `from` is the craft's own area (the route's first element).
 *
 *  * `area` uses a zone for the unit: `WPBeachLanding` on its closest zone
 *    (the engine's no-route case, 0x08640cf3).
 *  * Otherwise the first zone-using area on `areaPath(from, area)` gives a
 *    `WPMoveToBeachLanding` (0x08641133); its radius is the engine's
 *    `0.25 x side radius + 2 x bounding radius` of the last route area
 *    before it (0x08641369), 1.0 with none, at least 5.
 */
export function beachTarget({ layer, zones, area, side, unit, x, z, from = null }) {
  const type = unit?.type ?? LANDING.unitType;
  if (!zones?.size || !area) return null;
  if (isLandingZoneUser(area, type)) {
    const zone = closestZone(area, zones, x, z);
    return zone ? { kind: 'WPBeachLanding', zone, via: area, radius: LANDING.waypointRadius } : null;
  }
  const path = areaPath(layer, from ?? craftArea(layer, x, z, type), area);
  if (!path) return null;
  let r = LANDING.moveToRadiusNoRoute;
  for (let i = 0; i < path.length; i++) {
    const a = path[i];
    if (isLandingZoneUser(a, type)) {
      const zone = closestZone(a, zones, x, z);
      if (!zone) return null;
      return { kind: 'WPMoveToBeachLanding', zone, via: a, radius: Math.max(LANDING.moveToRadiusMin, r) };
    }
    if (i > 0) r = layer.sideRadius(a, side) * 0.25 + 2 * (unit?.radius ?? 1.0);
  }
  return null;
}

/**
 * The order. `target` is `beachTarget`'s; `area` is the SAI's target area
 * (the order is "in" it for Fire and Change, as a `WPMoveTo` is). `inside`
 * picks the leg: the approach point outside the zone, the beach point
 * inside it (`direct`: the straight run). The approach point is drawn once
 * per order object (the engine draws one per plan).
 */
export function beachLandingOrder({ target, area, side, layer, isValid = null, random = Math.random,
                                    inside = false, zones = null, last = null }) {
  const { kind, zone, via, radius } = target;
  let point, valid = true;
  if (inside) point = beachPosition(zone, random);
  else {
    const a = approachPosition(zone, isValid, random);
    point = a?.point ?? null;
    valid = !!a?.valid;
  }
  if (!point) return null;
  const order = {
    kind, zone, via, point, radius,
    area: area ?? null,
    insideZone: inside,
    /** The beach leg: a straight run, no route (`BAPAMoveToDirect`). */
    direct: inside,
    /** No valid approach point in 20 tries (the engine's createPlan fails). */
    approachValid: valid,
    zones,
    zoneD2: null,
    arrived: false,
    _last: last,
    /** `WPBeachLanding::getUrgency` 0x085363d0: 1, never arrived. */
    urgency() { this.arrived = false; return 1; },
    regoal(nowInside) {
      return beachLandingOrder({ target, area, side, layer, isValid, random, inside: nowInside, zones, last: this._last });
    },
  };
  if (area && layer) {
    order.owned = () => layer.ownerOf(area) === side;
    order.inside = (x, z) => layer.isInside(area, x, z);
  }
  return order;
}

/**
 * The per-tick executor of both kinds (registered in doctrine.js): the
 * `getUrgency` side of the waypoint (the inside flag, a new order on the
 * other leg when it flips) and `BBChangeLandingCraft`'s bail for everyone
 * aboard. `ctx` is the command's: `{ id, position, command, candidates(),
 * actuators }`.
 */
export function landingTick(order, { id, position, command, candidates, actuators }) {
  const [x, y, z] = position;
  const t = command?.time ?? 0;
  const last = order._last;
  order._last = { x, y, z, t };
  // `getSpeedMagnitude`, from the hull's travel between ticks.
  const speed = last && t > last.t ? Math.hypot(x - last.x, y - last.y, z - last.z) / (t - last.t) : Infinity;
  const cands = candidates?.() ?? [];
  const mine = cands.find(c => c.occupiedBy === id) ?? null;
  if (!mine) return null;
  const zones = order.zones ? [...order.zones.values()] : [order.zone];
  const inAnyZone = zones.some(zn => insideZone(zn, x, z));
  const walkable = command?.isWalkable ? !!command.isWalkable(x, z) : true;
  const beached = inAnyZone && speed < LANDING.bailSpeed && walkable;
  const tipped = mine.upright === false;
  if (beached || tipped) {
    for (const c of cands) {
      if (c.vehicleId === mine.vehicleId && c.occupiedBy != null) actuators?.exit?.(c.occupiedBy);
    }
    order.bail = { t, speed, tipped };
    return null;
  }
  const d2 = zoneDistanceSqr(order.zone, x, z);
  order.zoneD2 = d2;
  const inside = order.kind === 'WPMoveToBeachLanding' ? d2 < LANDING.moveToInsideD2 : d2 === 0;
  if (inside !== order.insideZone) return order.regoal(inside);
  return null;
}
