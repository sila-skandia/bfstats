// A cover object's portals, and what a soldier does with them (ledger AI-116,
// SM-16): the doors and windows of a house, which the AI's fire machine
// throws through.
//
// Where they come from (settled 2026-11-13): `AITemplateCover::initFromObject`
// 0x085dfb10 reads a cover object's portals off `world::getPortalMesh`
// 0x0818d540 -- the PortalMesh at the tail of its StandardMesh (SM-16), which
// 95 vanilla `.sm` files carry -- and keeps, for each portal polygon, its
// centre, its normal and the two extents of its horizontal span
// (`bf42/stdmesh.py`, `extract_vehicle_ai.py portal_plane`, the mod's
// `vehicle-ai.json` `coverPortalPlanes`). `AIObjectCover::getPortalCount`
// 0x085d4fe0 is that count. The earlier note that no vanilla pack ships a
// portal looked for a `.aim` file and a portal object in the scripts; the
// portal mesh rides in the model.
//
// The three functions below are `getAttackPortal` 0x085a28c0,
// `getPortalFiringPosition` 0x085a2dc0 and `getPortalLookAtPosition`
// 0x085a32f0 (the lnxded static build; the constants are read with
// `readmem.py`). They are file-private functions of `BBPFireInfantery`'s
// translation unit; `createPlan` 0x085a3870 reaches them from its states 3, 6
// and 7. State 3 needs a thrown weapon (`soldier_choseThrownWeapon`'s result
// is the weapon handed to `getAttackPortal`), and 6 and 7 the soldier flag
// (+0x10 bit 2 of the bot's information): a tank, whose weapons throw
// nothing, never reaches them, so its firing point stays the bot's own
// position (state 1), which is what the page already did.
//
// The frame. The exporter writes a plane in the game's frame; the page's
// scene is the game's with z negated (`bf42/gltf.py`), so a plane's vectors
// have their z negated here and then go through the cover node's world
// matrix, as the engine multiplies its row vectors by the object's `Mat4`
// (0x085a29c8..0x085a2a30). A normal is a direction: it takes the matrix's
// rotation and no translation.

/** The retail constants, read from the binary. */
export const PORTAL = {
  /** `getAttackPortal`'s weight on the bot's distance to the point out in
   *  front of the portal (`fmuls 0x086c030c`, 0.3). */
  moveWeight: Math.fround(0.3),
  /** The point inside the portal the target's distance is taken from:
   *  centre - 5 normals (`0x086c5288` = 5.0). */
  behind: 5.0,
  /** `getPortalLookAtPosition`'s trace out of the portal: 100 m back along
   *  the normal (`0x086644ac` of the dynamic build = 100.0). */
  lookDistance: 100.0,
  /** The mid-range factor (`0x086b05e8` = 0.5): the point `getAttackPortal`
   *  stands in front of a portal is at half the weapon's `minRange +
   *  maxRange`. */
  half: 0.5,
};

/** A plane (`[cx, cy, cz, nx, ny, nz, extentL, extentR, yMin, yMax]`, the
 *  exporter's, in the game's frame) placed by a node's world matrix (a
 *  `THREE.Matrix4`'s `elements`, or a 16-array in the same column order).
 *  Returns `{ centre, normal, left, right, yMin, yMax }` in the page's
 *  frame. */
export function portalInWorld(plane, m) {
  const x = plane[0], y = plane[1], z = -plane[2];
  const nx = plane[3], ny = plane[4], nz = -plane[5];
  const centre = [m[0] * x + m[4] * y + m[8] * z + m[12],
                  m[1] * x + m[5] * y + m[9] * z + m[13],
                  m[2] * x + m[6] * y + m[10] * z + m[14]];
  const normal = [m[0] * nx + m[4] * ny + m[8] * nz,
                  m[1] * nx + m[5] * ny + m[9] * nz,
                  m[2] * nx + m[6] * ny + m[10] * nz];
  const yAt = v => m[1] * x + m[5] * v + m[9] * z + m[13];
  return { centre, normal, left: plane[6], right: plane[7],
           yMin: plane.length > 8 ? yAt(plane[8]) : centre[1], yMax: plane.length > 9 ? yAt(plane[9]) : centre[1] };
}

/** The weapon's `[minRange, maxRange]` as the engine's Weapon +0x18 / +0x1c. */
function ranges(weapon) {
  return [weapon?.minRange ?? 0, weapon?.maxRange ?? 0];
}

/**
 * `getAttackPortal` 0x085a28c0: the index of the portal a soldier attacks
 * through, or -1. Every portal is keyed
 *
 *   0.3 x |P - bot| + |Q - target| + extentR + extentL
 *
 * with `P` the portal's centre plus its normal x half the weapon's `minRange +
 * maxRange` (the spot out in front the soldier would stand at), `Q` its
 * centre minus 5 normals (the spot inside), and the extents the plane's two
 * horizontal spans (`extentL` is at most 0, so the pair's sum is the span's
 * lopsidedness, not its width: read from the two getters, 0x085d5110 and
 * 0x085d5130). The smallest key wins, the first of equals (`insert_equal`
 * puts an equal key after the others and the lowest is read). No portals: -1.
 *
 * @param {object} a
 * @param {number[]} a.botPosition
 * @param {number[]} a.targetPosition
 * @param {{ minRange: number, maxRange: number }} a.weapon
 * @param {number[][]} a.planes   the cover mesh's `coverPortalPlanes`
 * @param {ArrayLike<number>} a.matrix   the cover node's world matrix
 */
export function attackPortal({ botPosition, targetPosition, weapon, planes, matrix }) {
  if (!planes?.length || !matrix) return -1;
  const [min, max] = ranges(weapon);
  const R = Math.fround((min + max) * PORTAL.half);
  let best = -1, bestKey = Infinity;
  for (let i = 0; i < planes.length; i++) {
    const w = portalInWorld(planes[i], matrix);
    const P = [w.centre[0] + w.normal[0] * R, w.centre[1] + w.normal[1] * R, w.centre[2] + w.normal[2] * R];
    const Q = [w.centre[0] - w.normal[0] * PORTAL.behind, w.centre[1] - w.normal[1] * PORTAL.behind,
               w.centre[2] - w.normal[2] * PORTAL.behind];
    const toBot = Math.hypot(P[0] - botPosition[0], P[1] - botPosition[1], P[2] - botPosition[2]);
    const toTarget = Math.hypot(targetPosition[0] - Q[0], targetPosition[1] - Q[1], targetPosition[2] - Q[2]);
    const key = Math.fround(Math.fround(toBot * PORTAL.moveWeight + toTarget) + w.right + w.left);
    if (key < bestKey) { bestKey = key; best = i; }
  }
  return best;
}

/**
 * `getPortalFiringPosition` 0x085a2dc0: where a soldier stands to throw
 * through portal `plane`, and the direction to face. Two points on the
 * portal's normal, `minRange` and `maxRange` out from its centre, bound the
 * stretch; `traceValidPoint` (vt+0x54) from the near one finds the first free
 * point on it (none: the state is refused), `trace` (vt+0x4c) from there
 * toward the far one the last free point, and the soldier stands a random
 * fraction of the way between them, `((rand >> 7 | 1) + 1) x 2^-24`
 * (0x08678f10), the engine's dice, a number in (0, 1]. It stands at the
 * portal's height; it faces the portal's centre flattened to the ground (the
 * direction is zero if the soldier is on it).
 *
 * @param {object} a
 * @param {{ centre: number[], normal: number[] }} a.portal   `portalInWorld`
 * @param {{ minRange: number, maxRange: number }} a.weapon
 * @param {(from: number[], to: number[]) => number[]|null} a.firstValid   `traceValidPoint`
 * @param {(from: number[], to: number[]) => number[]|null} a.lastClear   `trace`
 * @param {() => number} a.random   a draw in [0, 1)
 * @returns {{ position: number[], direction: number[] } | null}
 */
export function portalFiringPosition({ portal, weapon, firstValid, lastClear, random }) {
  const [min, max] = ranges(weapon);
  const c = portal.centre, n = portal.normal;
  const near = [c[0] + n[0] * min, c[2] + n[2] * min];
  const far = [c[0] + n[0] * max, c[2] + n[2] * max];
  const first = firstValid(near, far);
  if (!first) return null;
  const last = lastClear(first, far) ?? first;
  // (rand >> 7 | 1) + 1 over 2^24: never 0, 1 at the top.
  const t = Math.min(1, (Math.floor(random() * 0x1000000) | 1) / 0x1000000 + 1 / 0x1000000);
  const x = first[0] + (last[0] - first[0]) * t, z = first[1] + (last[1] - first[1]) * t;
  let dx = c[0] - x, dz = c[2] - z;
  const len2 = dx * dx + dz * dz;
  if (Math.abs(len2 - 1) >= 1.1920928955078125e-7) {
    if (Math.abs(len2) >= 1.1920928955078125e-7) { const k = 1 / Math.sqrt(len2); dx *= k; dz *= k; }
    else { dx = 0; dz = 0; }
  }
  return { position: [x, c[1], z], direction: [dx, 0, dz] };
}

/**
 * `getPortalLookAtPosition` 0x085a32f0: the point a soldier looks toward
 * when the portal is a window onto the target: `traceValidPoint` from the
 * portal's centre 100 m back along its normal (inward), flattened to the
 * ground. Always answers (the engine ignores the trace's result; a failed
 * trace leaves its output as it was, zero).
 */
export function portalLookAtPosition({ portal, firstValid }) {
  const c = portal.centre, n = portal.normal;
  const p = firstValid([c[0], c[2]], [c[0] - n[0] * PORTAL.lookDistance, c[2] - n[2] * PORTAL.lookDistance]);
  return [p ? p[0] : 0, 0, p ? p[1] : 0];
}

/** The weight of state 3's draw (`createPlan` 0x085a5fc2..0x085a5fee):
 *  `1 - 1 / (2 p^2 + 1)` for a cover of `p` portals. */
export function portalStateWeight(count) {
  const p = Math.max(0, count | 0);
  return Math.fround(1 - 1 / (2 * p * p + 1));
}

/**
 * `AIObjectMobile::PortalEventCallback::handleEvent` 0x085d5fe0: a unit's
 * `getLastPassedPortal` (0x085d59f0) is the portal object of the last
 * event of type 0, and -1 after one of type 1. The world raises the events
 * when an object crosses a portal polygon; this page raises them from the
 * unit's step: a segment that goes through a polygon against its normal is
 * an event of type 0 (in), and with it, type 1 (out) -- INFERRED, the
 * binary names neither direction. The polygon is the plane's centre, normal
 * and the span `[extentL, extentR]` along the horizontal axis in its plane,
 * between its lowest and highest vertex.
 *
 * Cost: a unit near no cover with a portal costs one distance test per cover
 * with portals (at most a few dozen a level); a unit near one tests that
 * cover's portals (a house has two to ten).
 */
export function createPortalPassing() {
  /** unit id -> { cover id, previous position } */
  const state = new Map();
  /** @type {Array<{ id: number, planes: number[][], matrix: () => ArrayLike<number>, centre: number[], reach: number }>} */
  let covers = [];
  const cache = new Map();   // cover id -> portals in the world, once

  function worldPortals(cover) {
    let list = cache.get(cover.id);
    if (!list) {
      const m = cover.matrix();
      list = cover.planes.map(p => portalInWorld(p, m));
      cache.set(cover.id, list);
    }
    return list;
  }

  /** `covers`: only the covers whose mesh has portals. */
  function setCovers(list) {
    covers = list ?? [];
    cache.clear();
    state.clear();
  }

  /** Does the segment a -> b pass through the portal polygon? +1 against the
   *  normal (in), -1 along it (out), 0 no. */
  function crossing(w, a, b) {
    const n = w.normal, c = w.centre;
    const da = (a[0] - c[0]) * n[0] + (a[1] - c[1]) * n[1] + (a[2] - c[2]) * n[2];
    const db = (b[0] - c[0]) * n[0] + (b[1] - c[1]) * n[1] + (b[2] - c[2]) * n[2];
    if (da === db || (da > 0) === (db > 0) || (da === 0 && db === 0)) return 0;
    const t = da / (da - db);
    const x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t, z = a[2] + (b[2] - a[2]) * t;
    // The span along the plane's horizontal axis d = (nz, 0, -nx), as the
    // exporter measured it in the game's frame (a z flip leaves the sign
    // convention of d unchanged for a unit measured the same way).
    const s = (x - c[0]) * n[2] - (z - c[2]) * n[0];
    if (s < w.left - 0.05 || s > w.right + 0.05 || y < w.yMin - 0.05 || y > w.yMax + 0.05) return 0;
    return da > 0 ? 1 : -1;
  }

  /** One unit's step. Returns its `getLastPassedPortal` (a cover id) or -1. */
  function step(id, position) {
    const rec = state.get(id);
    if (!rec) { state.set(id, { inside: -1, at: [position[0], position[1], position[2]] }); return -1; }
    const a = rec.at;
    for (const cover of covers) {
      const r = cover.reach;
      if (Math.abs(position[0] - cover.centre[0]) > r || Math.abs(position[2] - cover.centre[2]) > r) continue;
      for (const w of worldPortals(cover)) {
        const x = crossing(w, a, position);
        if (x > 0) rec.inside = cover.id;
        else if (x < 0 && rec.inside === cover.id) rec.inside = -1;
      }
    }
    a[0] = position[0]; a[1] = position[1]; a[2] = position[2];
    return rec.inside;
  }

  return {
    setCovers, step,
    /** A unit's last passed portal object, -1 when out or unknown. */
    insideOf: id => state.get(id)?.inside ?? -1,
    forget: id => state.delete(id),
    reset: () => { state.clear(); cache.clear(); covers = []; },
  };
}

// --- the soldier's advance states 5, 6 and 7 (AI-116, AI-183) ---------------
//
// `BBPFireInfantery::createPlan` 0x085a3870 tries its firing states in the
// order 1, 2, 3, 4, 7, 6, 5 (the table at 0x085a44f9.., `local_8c`), each with
// a weight against a roll in (0, 1] + 0.0 (`((rand >> 7 | 1) + 1) 2^-24`,
// 0x086c4c10, 0x086ffd68); the first whose weight beats its roll stands, and
// with none the first eligible one (0x085a4d86 area: `state == 0` takes
// `local_424`). A direct weapon always wins state 1 from rest (its weight is
// at least 1.25 / 5), so 5, 6 and 7 are what a soldier does when no direct
// weapon of theirs can hurt the target and the throw is not to be had: the
// throw clock has not run, or the throw lost its roll. They need the soldier
// flag (+0x10 bit 2 of the bot's information) and the previous state 0 (a
// state of rest; `bVar40`, 0x085a62.. compares `-0x88(%ebp,%edi,4)` etc).
//
//   5  eligible: line of fire not blocked (`-0x419`), target farther than 1.0
//      (0x085a61f1); weight 0.3 (0x086c030c) / n5, `n5` the count of state 5
//      among the last eight decisions (0x085a6206..0x085a6229).
//      Plan: close in on the target (`createPlanInternal` 0x085a74e0, the
//      approach with rounds 0: no fire statement).
//   6  eligible: the target stands in a cover (its Mobile's last passed
//      portal, 0x085a6297); weight 0.4 (0x086c4f70) / n6 (0x085a62b2..0x085a62d5).
//      Plan: walk to `getPortalFiringPosition` of its attack portal.
//   7  eligible: the bot stands in a cover (0x085a633b); weight
//      `1 - 1 / (v^2 + 1)` with `v` the cover template's value (the
//      `AITemplateCover` ctor's float, +8; 0x085a6356..0x085a6388), divided
//      by n7 when n6 > 0 (the engine tests the count of state 6 and divides
//      by the count of state 7: 0x085a637d, 0x085a638c).
//      Plan: walk to `getPortalLookAtPosition` of its own attack portal.
//
// A move (6, 7) ends in `createPlanInternal` when the bot is inside `0.5 r` of
// the point (`BAPConPosition(point, 0.5 * +0x34)`, 0x085a7e48..0x085a7e7b),
// `r` the firing state's +0x34 = `getMaxPathPosRemovalDistance` 0x0852b780 +
// the bot's physical `getRadius` (0x085a4970..0x085a49a9), and `createPlan`
// calls the state done when the bot is within `r` of it (0x085a58..).

/** The weights and the thresholds of states 5, 6 and 7. */
export const ADVANCE = {
  approachWeight: Math.fround(0.3),     // 0x086c030c
  coverWalkWeight: Math.fround(0.4),    // 0x086c4f70
  minDistance: 1.0,                     // fld1 at 0x085a61f1
  /** `BAPConPosition(point, 0.5 * r)`: 0x086b05e8 at 0x085a7e48. */
  arriveFactor: 0.5,
  order: [7, 6, 5],                     // the table's tail: 1,2,3,4,7,6,5
};

/**
 * The firing state's +0x34, the radius its moves are judged by:
 * `getMaxPathPosRemovalDistance` (the bot's `_pathRadius()`) plus the
 * physical's `getRadius` (`radius`, the bot's body radius: a soldier's is
 * 1.0 and his path removal 0.953, `bot-sense.js`, AI-197).
 */
export function advanceRadius(pathRadius, radius) {
  return Math.fround(pathRadius + radius);
}

/** A move's stop: inside `0.5 r` of the point. */
export function advanceArrive(r) {
  return Math.fround(ADVANCE.arriveFactor * r);
}

/** The weight of state `state` given the last eight decisions' counts. */
export function advanceWeight(state, { counts, coverValue = 0 }) {
  const n = k => counts?.[k] ?? 0;
  if (state === 5) return Math.fround(n(5) > 0 ? ADVANCE.approachWeight / n(5) : ADVANCE.approachWeight);
  if (state === 6) return Math.fround(n(6) > 0 ? ADVANCE.coverWalkWeight / n(6) : ADVANCE.coverWalkWeight);
  if (state === 7) {
    const w = Math.fround(1 - 1 / (coverValue * coverValue + 1));
    // The engine tests n6 and divides by n7 (a divide by zero is infinity).
    return n(6) > 0 ? Math.fround(w / n(7)) : w;
  }
  return 0;
}

/**
 * Which of 7, 6, 5 stands. `eligible` is the set the conditions allow (above);
 * every eligible state draws `roll() = ((rand >> 7 | 1) + 1) 2^-24` and stands
 * when its weight beats it; with none, the first eligible one. 0 for none.
 */
export function chooseAdvance({ eligible, counts, coverValue, roll }) {
  let first = 0;
  for (const s of ADVANCE.order) {
    if (!eligible.has(s)) continue;
    if (first === 0) first = s;
    const r = roll();
    if (!(advanceWeight(s, { counts, coverValue }) <= r)) return s;
  }
  return first;
}

/** The count of each state among a bot's last eight decisions. */
export function decisionCounts(history) {
  const counts = [0, 0, 0, 0, 0, 0, 0, 0];
  for (const s of history ?? []) if (s >= 0 && s < 8) counts[s]++;
  return counts;
}
