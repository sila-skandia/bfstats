// `vehicle-bodies.js` `standsOnAStatic`: a hull the level placed on a structure
// the terrain-only load settle cannot see (XPack2's Natter on its ramp).
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { installModuleHooks, viewerDir } from '../sim/env.mjs';

const viewer = viewerDir();
installModuleHooks(viewer);
const bodies = await import(pathToFileURL(path.join(viewer, 'vehicle-bodies.js')).href);
const index = await import(pathToFileURL(path.join(viewer, 'static-index.js')).href);
const mask = await import(pathToFileURL(path.join(viewer, 'drivable-mask.js')).href);

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
// A prop under one corner only (doomed_budapest's sandbag pile under a tank
// spawned 1.75 m up): one vertex of four is over it, which holds nothing up.
results.aPropUnderOneCorner = bodies.standsOnAStatic(spec, at(GROUND + 2.6), flat,
  (x, y, z) => (x < 10 && z < 20 ? GROUND + 1.6 : null));
// A hull with no ground under it at all (off the map).
results.offMap = bodies.standsOnAStatic(spec, at(50), () => NaN, () => 50);

// A tail-dragger sunk into a hangar floor (FHSWEurope Operation Da's P-40): a
// hull of four vertices 1.2 m under its origin and two wheel springs 2.27 m
// under it, the origin 0.56 m over a floor 1.6 m over the ground. The probe is
// COL-6's segment from the origin to each vertex, crossing the floor plane.
const FLOOR = GROUND + 1.6;
const plane = (ny) => (ox, oy, oz, x, y, z) => {
  if (!(oy > FLOOR && y < FLOOR)) return null;
  const t = (oy - FLOOR) / (oy - y);
  const nz = Math.sqrt(1 - ny * ny);
  return { x: ox + (x - ox) * t, y: FLOOR, z: oz + (z - oz) * t, nx: 0, ny, nz };
};
const wheel = (x, z) => ({ kind: 'spring', offset: [x, -1.9, z], rot: identity,
  shape: { layers: [{ vertices: [0, -0.37, 0, 0, 0, 0.1, 0, 0, -0.1] }] } });
const tailDragger = { parts: [
  { kind: 'body', offset: [0, 0, 0], rot: identity,
    shape: { layers: [{ vertices: [-1, -1.2, -2, 1, -1.2, -2, -1, -1.2, 2, 1, -1.2, 2] }] } },
  wheel(-1.25, -1.2), wheel(1.25, -1.2)] };
const sunk = bodies.sunkIntoAStatic(tailDragger, at(FLOOR + 0.56), flat, plane(1));
results.sunkDepth = sunk.depth;
results.sunkLevel = sunk.level;
// The same into a ramp tilted 9 degrees (XPack2's Natter): lifted, never let down.
results.sunkOnARamp = bodies.sunkIntoAStatic(tailDragger, at(FLOOR + 0.56), flat, plane(0.988)).level;
// Wheels on the floor, nothing under it.
results.notSunk = bodies.sunkIntoAStatic(tailDragger, at(FLOOR + 2.27), flat, plane(1)).depth;

// A hangar marked as a ride surface at its floor (`rideSurfaceTopOf`): its
// floor quad at y 3 is drivable, its roof at y 8 is not.
const hangar = group([fakeMesh(quad(3)), fakeMesh(quad(8))]);
hangar.userData.rideSurfaceTop = 3;
const hangarLevel = group([hangar]);
const hangarIndex = index.buildCollisionIndex(hangarLevel, { ownerRoots: [] });
const deckDown = hangarIndex.cast(0, 20, 0, 0, -1, 0, 30, -1, probe(), -1, true);
results.rideFloorY = deckDown ? deckDown.y : null;
const hangarMask = mask.buildDrivableMask(hangarLevel);
results.rideMaskTop = hangarMask ? Math.max(...Array.from(hangarMask.maxY).filter(Number.isFinite)) : null;
// Unmarked, the same hangar is no deck at all.
results.unmarkedDeck = index.buildCollisionIndex(group([group([fakeMesh(quad(3))])]), { ownerRoots: [] })
  .cast(0, 20, 0, 0, -1, 0, 30, -1, probe(), -1, true);

// A house a level script put at 1e22 m (FHSWEurope tigerpass-1943) is left out
// of the index rather than stretching it past what an array can hold.
const farHouse = fakeMesh(quad(0));
farHouse.matrixWorld = { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 494.8, 6.4205e20, -1.84847e22, 1] };
results.outOfWorldDropY = dropY(index.buildCollisionIndex(group([ramp, group([farHouse])]), { ownerRoots: [] }));
// sand_dunes' barbed wire at 858 km (inside the old 1e6 m cut) made a grid of
// 6.2e9 cells: it is left out too, and the index stays the ramp's few cells.
const farWire = fakeMesh(quad(0));
farWire.matrixWorld = { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 858443, 50, -4631.8, 1] };
const wireIndex = index.buildCollisionIndex(group([ramp, group([farWire])]), { ownerRoots: [] });
results.farWireDropY = dropY(wireIndex);
results.farWireCells = wireIndex.cols * wireIndex.rows;
// A static whose own triangles span 60 km (origin in the world) gets coarser
// cells, not a 5.6e7-cell table: the grid stays under 2^25 cells and still hits.
const wide = [-30000, 3, -30000, 30000, 3, -30000, 30000, 3, 30000, -30000, 3, -30000, 30000, 3, 30000, -30000, 3, 30000];
const wideIndex = index.buildCollisionIndex(group([group([fakeMesh(wide)])]), { ownerRoots: [] });
results.wideCells = wideIndex.cols * wideIndex.rows;
results.wideCellSize = wideIndex.cellSize;
results.wideDropY = dropY(wideIndex);
const wideDeck = group([fakeMesh(wide)]);
wideDeck.userData.rideSurfaceTop = 3;
const wideMask = mask.buildDrivableMask(group([wideDeck]));
results.wideMaskCells = wideMask ? wideMask.cols * wideMask.rows : null;

// `skipRoots` leaves a subtree's collision out of the index.
results.everything = dropY(index.buildCollisionIndex(level, { ownerRoots: [] }));
results.withoutTheHull = dropY(index.buildCollisionIndex(level, { ownerRoots: [], skipRoots: [hull] }));
results.onlyTheHull = index.buildCollisionIndex(hull, { ownerRoots: [], skipRoots: [hull] });
process.stdout.write(JSON.stringify(results));
