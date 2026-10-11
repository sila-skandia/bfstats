// `vehicle-bodies.js` `standsOnAStatic`: a hull the level placed on a structure
// the terrain-only load settle cannot see (XPack2's Natter on its ramp).
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { installModuleHooks, viewerDir } from '../sim/env.mjs';

const viewer = viewerDir();
installModuleHooks(viewer);
const bodies = await import(pathToFileURL(path.join(viewer, 'vehicle-bodies.js')).href);
const index = await import(pathToFileURL(path.join(viewer, 'static-index.js')).href);

// The fields of a three.js Mesh the collision index reads (`collision_harness.mjs`).
const IDENT = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function fakeMesh(positions) {
  const node = {
    isMesh: true, name: 'mesh', parent: null, children: [],
    userData: { collision: true }, matrixWorld: { elements: IDENT },
    geometry: {
      attributes: { position: { array: Float32Array.from(positions), count: positions.length / 3 } },
      index: null, userData: { defenseMaterial: 0, collision: true },
    },
    traverse(fn) { fn(node); for (const c of node.children) c.traverse(fn); },
  };
  return node;
}
function group(children) {
  const node = { children, parent: null, userData: {}, traverse(fn) { fn(node); for (const c of children) c.traverse(fn); } };
  for (const c of children) c.parent = node;
  return node;
}
// Two horizontal quads over the origin: a ramp top at y 3 (a static) and a hull
// floor at y 6 (a hull's own collision), each 10 m square, facing up.
const quad = y => [-5, y, -5, 5, y, -5, 5, y, 5, -5, y, -5, 5, y, 5, -5, y, 5];
const ramp = group([fakeMesh(quad(3))]);
const hull = group([fakeMesh(quad(6))]);
const level = group([ramp, hull]);
const probe = () => ({ t: 0, x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0, dx: 0, dy: -1, dz: 0,
  material: 0, kind: '', owner: -1, triangle: -1 });
const dropY = idx => { const h = idx?.cast(0, 20, 0, 0, -1, 0, 30, -1, probe()); return h ? h.y : null; };

// A hull of four col0 vertices 1 m under its origin, upright at the origin.
const identity = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
const spec = { parts: [{
  offset: [0, 0, 0], rot: identity,
  shape: { layers: [{ vertices: [-1, -1, -2, 1, -1, -2, -1, -1, 2, 1, -1, 2] }] },
}] };
const at = y => ({ position: [10, y, 20], axes: identity });
const GROUND = 100;
const flat = () => GROUND;
const results = {};

// On a ramp whose top is 1.6 m over the ground, the hull's vertices at its top.
results.onARamp = bodies.standsOnAStatic(spec, at(GROUND + 2.6), flat, (x, y, z) => GROUND + 1.6);
// Over the same ramp but 2 m above it: it is airborne, not resting.
results.hoveringOverIt = bodies.standsOnAStatic(spec, at(GROUND + 4.6), flat, (x, y, z) => GROUND + 1.6);
// Bare ground under it (El Alamein's M1A1, 2.5 m up): nothing to stand on.
results.overBareGround = bodies.standsOnAStatic(spec, at(GROUND + 3.5), flat, () => null);
// A paving slab 0.1 m high under a wheel is the ground, not a structure.
results.onASlab = bodies.standsOnAStatic(spec, at(GROUND + 1.1), flat, () => GROUND + 0.1);
// A static top far below the hull (a ray that fell through to a pit).
results.aPitBelow = bodies.standsOnAStatic(spec, at(GROUND + 5), flat, (x, y, z) => (y - 0.75 > GROUND + 1 ? null : GROUND + 1));
// A hull with no ground under it at all (off the map).
results.offMap = bodies.standsOnAStatic(spec, at(50), () => NaN, () => 50);

// `skipRoots` leaves a subtree's collision out of the index.
results.everything = dropY(index.buildCollisionIndex(level, { ownerRoots: [] }));
results.withoutTheHull = dropY(index.buildCollisionIndex(level, { ownerRoots: [], skipRoots: [hull] }));
results.onlyTheHull = index.buildCollisionIndex(hull, { ownerRoots: [], skipRoots: [hull] });
process.stdout.write(JSON.stringify(results));
