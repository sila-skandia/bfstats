// Finding what can be entered: every vehicle root in a scene, every
// `EntryPoint` of one vehicle tagged with its seat, and the nearest-of-
// several pick that settles a shared door by declaration order. Split out
// of `seats.js`, which re-exports everything here.

import { surveyVehicle } from './seat-survey.js';

/**
 * Every `PlayerControlObject` root in the scene, spawner-placed or not.
 *
 * `flight.js`'s `findVehicles` only returns spawner children -- by design,
 * for the "planes and cars a free camera can auto-possess" use it serves --
 * which is exactly why the Defgun, the AA guns and the Brownings have never
 * shown up as enterable: they are static level furniture, not spawner
 * output, but they carry the identical `templateKind`/`control` shape. A
 * root here is any PCO with no ancestor PCO before `root` -- the same
 * boundary `surveyVehicle` already respects.
 */
export function findAllVehicleRoots(root) {
  const found = [];
  root.traverse(obj => {
    if (obj.userData?.templateKind !== 'PlayerControlObject') return;
    for (let p = obj.parent; p && p !== root; p = p.parent) {
      if (p.userData?.templateKind === 'PlayerControlObject') return;
    }
    found.push(obj);
  });
  return found;
}

/**
 * The engine's bounding radius of an object about its own origin, which is
 * what files a vehicle root in the object manager's grid (ledger SEAT-31):
 * `BCompositeObject::getBoundingRadius` 0x08165630 takes the larger of its
 * own geometry's radius and, for every child, the child's distance from it
 * plus the child's own radius, recursively. So a root's sphere holds every
 * part and every `EntryPoint` under it. The geometry's radius is read here as
 * the mesh's bounding sphere about the node origin (`|centre| + radius`); a
 * node's scale scales what it holds.
 */
export function boundingRadius(node) {
  let own = 0;
  const geometry = node.geometry;
  if (geometry) {
    if (!geometry.boundingSphere && geometry.computeBoundingSphere) geometry.computeBoundingSphere();
    const sphere = geometry.boundingSphere;
    if (sphere && sphere.radius >= 0) own = sphere.center.length() + sphere.radius;
  }
  for (const child of node.children ?? []) {
    const s = child.scale;
    const scale = s ? Math.max(Math.abs(s.x), Math.abs(s.y), Math.abs(s.z)) : 1;
    own = Math.max(own, child.position.length() + scale * boundingRadius(child));
  }
  return own;
}

/** Every `EntryPoint` of one vehicle, tagged with which seat it opens into. */
export function listEntryPoints(root, fallbackRadius) {
  const { seats } = surveyVehicle(root);
  const list = [];
  for (const seat of seats.values()) {
    for (const entry of seat.entryPoints) {
      list.push({
        node: entry, seatId: seat.id,
        radius: entry.userData?.seat?.entryRadius || fallbackRadius,
      });
    }
  }
  return list;
}

/**
 * Round 3's second disclosed gap: a shared physical door can carry more than
 * one `EntryPoint` — the Sherman declares one for the driver's seat and a
 * second, separately-scoped one for the hull gunner's, at each of its two
 * doors, and Wake's M3A1 goes one further with four passenger `EntryPoint`s
 * stacked on its one side door. All of a set's candidates share the exact
 * same authored local offset relative to their own seat, and their different
 * parent chains (the root vs. each nested seat's own PCO) still compose to
 * the *identical* world position — confirmed against the live Wake scene
 * this round: the Sherman's two door-pairs differ by ~1.1e-13 m (`getWorld
 * Position`'s own double-precision floor), and M3A1's four-way tie composes
 * to a bit-exact match, zero difference. A plain `distance < best` compare
 * lets whichever candidate's matrix chain happens to round a hair smaller
 * win — floating-point noise the level's own data never expressed an opinion
 * on, not a real "closer door."
 *
 * The fix: a candidate only unseats the incumbent by beating it by more than
 * `TIE_EPSILON` — several orders of magnitude above the measured noise floor
 * and several more below the smallest gap between two genuinely different
 * doors — so within that band the FIRST candidate `distanceOf` reaches keeps
 * it. That first-found rule is what makes the tie-break deterministic:
 * `entries`/`candidates` here is always built by one fixed traversal
 * (`surveyVehicle`'s own `order`, root seat first — SEAT-22's declaration-
 * order convention, the same one `VehicleOccupancy.seatIdAt` rests its own
 * key-1..9 mapping on), so "first found" means "declared first" every time,
 * not "whichever the caller happened to iterate this run." For the Sherman
 * that seats the driver's own door ahead of the gunner's at the same spot;
 * for M3A1 it seats the lowest-numbered passenger PCO. Either way it is the
 * same answer on every call, not a coin flip decided by rounding.
 *
 * Generic on purpose — a plain array plus a distance function, no EntryPoint
 * of its own — so it is usable (and unit-testable, see `test_seats.py`)
 * anywhere else this viewer needs "closest of several, ties settled by who
 * was offered first" rather than only for doors.
 */
export const TIE_EPSILON = 1e-6;   // metres; ~1e7x the measured noise, ~1e5x below any real gap

export function pickNearest(candidates, distanceOf) {
  let best = null;
  let bestDistance = Infinity;
  for (const candidate of candidates) {
    const distance = distanceOf(candidate);
    if (distance < bestDistance - TIE_EPSILON) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}
