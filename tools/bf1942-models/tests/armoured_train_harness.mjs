// BF1918's armoured train on a synthetic track, headless: the real locomotive
// glb (`ArmouredTrain_GILI`, its collision meshes and groups from the bf1918
// tree's `collision-meshes.json`), seated through the page's own
// `VehicleOccupancy.ensureDrive`, adopted into a `BodyWorld` with a real
// `WorldCollider` over a track built the way BF1918 builds one:
//
//   - the visible embankment (`railmerged_3_anzio_m1`'s col0: a 2.94 m top at
//     0.72 m), in `c_CGStaticObjects` (the level's `collisionGroups` say 2);
//   - the invisible guide walls (`railmerged_3_anzio_guide_m1`'s col0: two
//     vertical faces 2.93 m apart, 0.07 to 0.81 m), in no group;
//
// laid along a 60 m straight, a 100 m-radius 30 degree right-hand bend and a
// 60 m straight. Printed as one JSON line; `tests/test_armoured_train.py`
// asserts on it. Every piece is the viewer's own module, imported in place.
//
//   node tests/armoured_train_harness.mjs [viewer assets dir]
//
// The rules under test (ledger COL-20, COL-21, COL-25): a `c_CGLandscape`
// spring meets no terrain; a spring meets the static world along the face
// normal whatever its axis; a pair whose groups share a bit is not tested.

import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { installModuleHooks, viewerDir } from '../sim/env.mjs';

const viewer = viewerDir();
installModuleHooks(viewer);
const here = path.dirname(new URL(import.meta.url).pathname);
const imp = rel => import(pathToFileURL(path.join(here, '..', rel)).href);
const assets = process.argv[2] ?? viewer;
const glbPath = path.join(assets, 'models', 'mods', 'bf1918', 'ArmouredTrain_GILI.glb');
const cmPath = path.join(assets, 'maps', 'mods', 'bf1918', '_shared', 'collision-meshes.json');
const dmgPath = path.join(assets, 'maps', 'mods', 'bf1918', '_shared', 'damage.json');
if (![glbPath, cmPath, dmgPath].every(p => fs.existsSync(p))) {
  process.stdout.write(JSON.stringify({ skipped: `no bf1918 tree under ${assets}` }));
  process.exit(0);
}

const [
  { readGlb }, { buildSceneTree }, { VehicleOccupancy }, { Aircraft }, { GroundVehicle },
  { TrackedVehicle }, { describeVehicleParts, wheelContactDepths }, { BodyWorld },
  { adoptDriven }, { buildCollisionIndex }, { WorldCollider },
] = await Promise.all([
  imp('server/glb-tree.mjs'), imp('server/glb-scene.mjs'), imp('viewer/seats.js'),
  imp('viewer/aircraft.js'), imp('viewer/wheeled-vehicle.js'), imp('viewer/tracked-vehicle.js'),
  imp('viewer/vehicle-bodies.js'), imp('viewer/body-world.js'), imp('viewer/world-bodies.js'),
  imp('viewer/static-index.js'), imp('viewer/world-collider.js'),
]);

const TICK = 1 / 30;
const DEG = 180 / Math.PI;
const r3 = v => (Number.isFinite(v) ? Math.round(v * 1000) / 1000 : v);
const collisionMeshes = JSON.parse(fs.readFileSync(cmPath, 'utf8'));
const tables = JSON.parse(fs.readFileSync(dmgPath, 'utf8'));

// --- the track ----------------------------------------------------------------
// Centreline samples every metre, glb frame (forward -z, a right turn toward +x).
const STRAIGHT = 60, RADIUS = 100, BEND = 30 / DEG;
function centreline() {
  const pts = [];
  for (let s = 0; s <= STRAIGHT; s += 1) pts.push({ x: 0, z: -s, h: 0 });
  const cx = RADIUS, cz = -STRAIGHT;
  const arc = RADIUS * BEND;
  for (let s = 1; s <= arc; s += 1) {
    const a = s / RADIUS;
    pts.push({ x: cx - RADIUS * Math.cos(a), z: cz - RADIUS * Math.sin(a), h: a });
  }
  const end = pts[pts.length - 1];
  for (let s = 1; s <= STRAIGHT; s += 1) {
    pts.push({ x: end.x + Math.sin(BEND) * s, z: end.z - Math.cos(BEND) * s, h: BEND });
  }
  return pts;
}
const track = centreline();

/** The distance from the centreline (+ right of travel) and the heading
 *  error of a hull at (x, z) facing `heading` (radians, + right). */
function trackError(x, z, heading) {
  let best = Infinity, at = null;
  for (const p of track) {
    const d = Math.hypot(x - p.x, z - p.z);
    if (d < best) { best = d; at = p; }
  }
  const rx = Math.cos(at.h), rz = Math.sin(at.h);      // the track's right
  return { lateral: (x - at.x) * rx + (z - at.z) * rz, heading: heading - at.h, along: track.indexOf(at) };
}

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function mesh(positions, sourceTemplate) {
  const index = [];
  for (let i = 0; i < positions.length / 3; i += 4) index.push(i, i + 1, i + 2, i, i + 2, i + 3);
  const node = {
    isMesh: true, name: sourceTemplate, parent: null, children: [],
    userData: { collision: true, sourceTemplate },
    matrixWorld: { elements: IDENTITY },
    geometry: {
      attributes: { position: { array: Float32Array.from(positions), count: positions.length / 3 } },
      index: { array: Uint32Array.from(index), count: index.length },
      userData: { defenseMaterial: 0, collision: true },
    },
    traverse(fn) { fn(node); },
  };
  return node;
}
function placed(children) {
  const node = {
    name: 'SimpleObject', children, parent: null, userData: { templateKind: 'SimpleObject' },
    matrixWorld: { elements: IDENTITY },
    traverse(fn) { fn(node); for (const c of children) c.traverse(fn); },
  };
  for (const c of children) c.parent = node;
  return node;
}

/** Quads between consecutive centreline samples: `across` offsets from the
 *  centre (right +), at heights `y0`..`y1` (a wall) or one height (a top). */
function strip(across0, across1, y0, y1) {
  const pos = [];
  for (let i = 0; i + 1 < track.length; i++) {
    const a = track[i], b = track[i + 1];
    const ra = [Math.cos(a.h), Math.sin(a.h)], rb = [Math.cos(b.h), Math.sin(b.h)];
    const P = (p, r, off, y) => [p.x + r[0] * off, y, p.z + r[1] * off];
    pos.push(...P(a, ra, across0, y0), ...P(b, rb, across0, y0), ...P(b, rb, across1, y1), ...P(a, ra, across1, y1));
  }
  return pos;
}

function buildTrack({ guides = true, embankmentGroup = true } = {}) {
  const roots = [];
  // The embankment's top, 2.93 m wide at 0.72 (`railmerged_3_anzio_m1` col0).
  roots.push(placed([mesh(strip(-1.465, 1.465, 0.72, 0.72), 'railmerged_3_anzio_m1')]));
  if (guides) {
    // The two guide walls (`railmerged_3_anzio_guide_m1` col0), 0.07..0.81.
    roots.push(placed([mesh([...strip(-1.465, -1.465, 0.07, 0.81), ...strip(1.465, 1.465, 0.07, 0.81)],
                            'railmerged_3_anzio_guide_m1')]));
  }
  const root = { children: roots, parent: null, userData: {},
                 traverse(fn) { fn(root); for (const c of roots) c.traverse(fn); } };
  for (const c of roots) c.parent = root;
  const groups = embankmentGroup ? { railmerged_3_anzio_m1: 2 } : {};
  const statics = buildCollisionIndex(root, { ownerRoots: roots, collisionGroups: groups });
  return new WorldCollider({ statics });
}

// --- the train ----------------------------------------------------------------
const DRIVE_CLASSES = { Aircraft, GroundVehicle, TrackedVehicle };
const { json, bin } = readGlb(glbPath);

function run({ guides = true, embankmentGroup = true, seconds = 30, throttle = 1, startLateral = 0 } = {}) {
  const collider = buildTrack({ guides, embankmentGroup });
  const { root: scene } = buildSceneTree(json, bin);
  const root = scene.children.length === 1 ? scene.children[0] : scene;
  root.position.set(0, 0, 0); root.quaternion.identity(); root.updateMatrixWorld(true);
  const occ = new VehicleOccupancy(root, DRIVE_CLASSES);
  occ.setActiveSeat(occ.rootId);
  const drive = occ.ensureDrive(null, { cockpit: false, groundHeight: () => 0, waterLevel: -1000, collisionMeshes });
  const spec = describeVehicleParts(root, collisionMeshes);
  wheelContactDepths(drive, spec, tables);
  drive.state.position.set(startLateral, 0.72 + 1.02, -5);
  drive.state.orientation.identity();
  drive.state.velocity.set(0, 0, 0);

  const terrain = {
    height: () => 0, normal: (x, z, out) => { out[0] = 0; out[1] = 1; out[2] = 0; return out; },
    material: () => 0, waterLevel: null,
  };
  const world = { bodyWorld: new BodyWorld({ tables, terrain, statics: collider.staticProbe() }) };
  // An owner id no static carries (the track's roots are owners 0 and 1).
  const OWNER = 1000;
  adoptDriven(world, OWNER, drive, spec);
  const entry = world.bodyWorld.get(OWNER);

  const guideWheels = drive.wheels.filter(w => /GuideWheel/.test(w.node.name));
  const out = {
    kind: occ.rootKind, wheels: drive.wheels.length, guideWheels: guideWheels.length,
    guideGroups: guideWheels.map(w => w.groups),
    radii: drive.wheels.map(w => [w.node.name.replace('ArmouredTrain_', ''), r3(w.radius), r3(w.contactDepth), r3(w.rest.y)]),
    springParts: entry.springs.length,
    guideSpringParts: entry.springs.filter(p => /GuideWheel/.test(p.node.name)).length,
    maxLateral: 0, maxHeading: 0, guidePushes: 0, guidePushMaxNy: 0, minY: Infinity, maxY: -Infinity,
    trace: [],
  };
  const ticks = Math.round(seconds / TICK);
  for (let i = 0; i < ticks; i++) {
    drive.setInput('c_PIThrottle', throttle);
    drive.setInput('c_PIYaw', 0);
    drive.integrate(TICK);
    world.bodyWorld.step(TICK);
    const s = drive.state;
    // Heading (+ right) off the hull's forward (-z body).
    const q = s.orientation;
    const fx = -(2 * (q.x * q.z + q.w * q.y)), fz = -(1 - 2 * (q.x * q.x + q.y * q.y));
    const heading = Math.atan2(fx, -fz);
    const e = trackError(s.position.x, s.position.z, heading);
    // Measured while the train is on the track (it runs off its far end).
    if (i > 15 && e.along < track.length - 8) {
      out.lastOnTrack = r3(i * TICK);
      out.maxLateral = Math.max(out.maxLateral, Math.abs(e.lateral));
      out.maxHeading = Math.max(out.maxHeading, Math.abs(e.heading) * DEG);
      out.minY = Math.min(out.minY, s.position.y);
      out.maxY = Math.max(out.maxY, s.position.y);
    }
    for (const w of guideWheels) {
      const p = w.staticPush;
      if (!p) continue;
      out.guidePushes++;
      const d = Math.hypot(p.x, p.y, p.z);
      if (d > 0) out.guidePushMaxNy = Math.max(out.guidePushMaxNy, Math.abs(p.y) / d);
    }
    if (i % 30 === 0 || process.env.TRAIN_DEBUG) {
      const row = { t: r3(i * TICK), x: r3(s.position.x), y: r3(s.position.y), z: r3(s.position.z),
                    v: r3(s.velocity.length()), lat: r3(e.lateral), hdg: r3(e.heading * DEG), along: e.along };
      if (process.env.TRAIN_DEBUG) {
        row.sc = world.bodyWorld.springContacts; row.hc = world.bodyWorld.staticContacts;
        row.vy = r3(s.velocity.y);
        row.w = drive.wheels.map(w => `${w.node.name.replace('ArmouredTrain_', '')}:${r3(w.compression)}:${w.staticPush ? 'S' : ''}`).join(' ');
      }
      out.trace.push(row);
    }
  }
  const s = drive.state;
  const end = trackError(s.position.x, s.position.z, 0);
  out.end = { along: end.along, of: track.length - 1, speed: r3(s.velocity.length()), y: r3(s.position.y) };
  for (const k of ['maxLateral', 'maxHeading', 'guidePushMaxNy', 'minY', 'maxY']) out[k] = r3(out[k]);
  return out;
}

const results = {
  railed: run(),
  // A start 10 cm off the centreline, the right guide wheels 5.5 cm into
  // the right wall: it pushes the train back inside the 4.5 cm clearance.
  offset: run({ startLateral: 0.1, seconds: 6 }),
  // The embankment in no group: the guide wheels' probe meets its top face
  // first (the group rule is what lets them reach the walls).
  ungrouped: run({ embankmentGroup: false, seconds: 12 }),
  // No guide walls: nothing holds the train to the bend.
  unguided: run({ guides: false }),
};
process.stdout.write(JSON.stringify(results));
