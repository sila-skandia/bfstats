#!/usr/bin/env node
// Census: every land hull of every model tree, driven on flat ground in node.
//
// For each template whose root seat classifies to a land drive (`ground` for a
// `c_ETCar` Engine, `tank` for `c_ETTank`: cars, trucks, tanks, half-tracks,
// horses, bikes; `ground` too for a propeller sled, a `VCLand` hull pushed by
// a `c_ETPlane`), the real glb is read (`server/glb-tree.mjs` `readGlb`, the
// node tree and the collision and wheel meshes through `glb-scene.mjs`
// `buildSceneTree`, as the room server reads a level), seated through the
// page's own `VehicleOccupancy.ensureDrive` (the same drive class map.html and
// the room build) and driven on an analytic flat plane:
//
//   settle    3 s with no input, dropped from just above its springs:
//             rests level on its wheels (pitch, roll), grounded, how far its
//             lowest collision vertex is below the ground (sunk) or how far
//             its lowest wheel is above it (floats)
//   forward   full throttle 8 s: top speed (m/s), heading drift and the
//             largest slip angle while going straight (crab)
//   turn      after 4 s of throttle, 2.5 s of full right lock with throttle:
//             heading turned (+ right), slip angle, roll; overturned?
//   reverse   from rest, full reverse throttle 6 s: speed backwards
//
// Flags (any one puts the template in the flagged list):
//   no-drive       forward top speed < 1.5 m/s
//   no-reverse     reverse speed < 0.5 m/s
//   weak-turn      |turned| < 30 deg in 2.5 s of full lock, from 6 m/s or more
//   wrong-way      turned < -5 deg (right stick turned left)
//   crab           straight-line slip > 10 deg. The turn's slip is reported,
//                  not flagged: retail slides too (the lab's FHSW Puma, 68 deg
//                  at full lock from 26 m/s, 2026-10-28; README)
//   rolls          |roll| or |pitch| > 60 deg at any point (flat ground)
//   not-level      settled |pitch| or |roll| > 8 deg
//   sinks          settled hull more than 0.5 m below the ground
//   floats         settled hull not grounded, or wheels > 0.3 m above ground
//
//   node surveys/census_ground_drive.mjs [--trees bf1942,fh] [--only <regex>]
//        [--json out.json] [--flagged]
//
// From tools/bf1942-models. No Chromium; about 30 ms a template.

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { installModuleHooks } from '../sim/env.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const viewerDir = join(here, '..', 'viewer');
installModuleHooks(viewerDir);
const load = rel => import(pathToFileURL(join(here, '..', rel)).href);
const THREE = await load('viewer/vendor/three.module.js');
const { readGlb } = await load('server/glb-tree.mjs');
const { buildSceneTree } = await load('server/glb-scene.mjs');
const { VehicleOccupancy } = await load('viewer/seats.js');
const { Aircraft } = await load('viewer/aircraft.js');
const { GroundVehicle } = await load('viewer/wheeled-vehicle.js');
const { TrackedVehicle } = await load('viewer/tracked-vehicle.js');
const { describeVehicleParts, wheelContactDepths } = await load('viewer/vehicle-bodies.js');

const DRIVE_CLASSES = { Aircraft, GroundVehicle, TrackedVehicle };
const DEG = 180 / Math.PI;
const DT = 1 / 60;
const TRACE = process.argv.includes('--trace');

const args = process.argv.slice(2);
const opt = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };

/** Every model tree: vanilla, then each mod directory. */
function trees() {
  const out = [{ id: 'bf1942', dir: join(viewerDir, 'models'), maps: join(viewerDir, 'maps') }];
  const mods = join(viewerDir, 'models', 'mods');
  for (const id of readdirSync(mods).sort()) {
    out.push({ id, dir: join(mods, id), maps: join(viewerDir, 'maps', 'mods', id) });
  }
  return out;
}

/** The base glb of every template in a tree: models.json's rows, else every
 *  `<Name>.glb` with no variant suffix. */
function templatesOf(tree) {
  const manifest = join(tree.dir, 'models.json');
  if (existsSync(manifest)) {
    return JSON.parse(readFileSync(manifest, 'utf8'))
      .filter(r => !['handweapon', 'soldier', 'air', 'sea'].includes(r.category))
      .map(r => ({ name: r.name, glb: join(tree.dir, r.glb), category: r.category }));
  }
  return readdirSync(tree.dir).filter(f => /^[^.]+\.glb$/.test(f))
    .map(f => ({ name: f.slice(0, -4), glb: join(tree.dir, f), category: null }));
}

/** A cheap look at the JSON chunk: has it springs and a land Engine, or (a
 *  propeller sled, `rootDriveKind`) a `c_ETPlane` on a `VCLand` hull? The
 *  page's own classification decides which of them it drives. */
function looksLand(json) {
  let springs = 0, land = false, plane = false, vcland = false;
  for (const n of json.nodes ?? []) {
    const e = n.extras;
    if (!e) continue;
    if (e.templateKind === 'Spring') springs++;
    if (e.templateKind === 'Engine' && /c_ET(Car|Tank)/.test(e.physics?.engineType ?? '')) land = true;
    if (e.templateKind === 'Engine' && e.physics?.engineType === 'c_ETPlane') plane = true;
    if (e.physics?.vehicleCategory === 'VCLand') vcland = true;
  }
  return springs > 0 && (land || (plane && vcland));
}

const forwardOf = (v, out = new THREE.Vector3()) => out.set(0, 0, -1).applyQuaternion(v.state.orientation);
const rightOf = (v, out = new THREE.Vector3()) => out.set(1, 0, 0).applyQuaternion(v.state.orientation);
const headingOf = v => { const f = forwardOf(v); return Math.atan2(f.x, -f.z); };
const pitchOf = v => Math.asin(Math.max(-1, Math.min(1, forwardOf(v).y))) * DEG;
const rollOf = v => Math.asin(Math.max(-1, Math.min(1, rightOf(v).y))) * DEG;
const upY = v => new THREE.Vector3(0, 1, 0).applyQuaternion(v.state.orientation).y;
const alongOf = v => v.state.velocity.dot(forwardOf(v));
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
/** Horizontal slip angle: between the hull's heading and its ground track. */
function slipOf(v) {
  const vel = v.state.velocity;
  const sp = Math.hypot(vel.x, vel.z);
  if (sp < 1) return 0;
  const f = forwardOf(v);
  const sign = Math.sign(f.x * vel.x + f.z * vel.z) || 1;
  return wrap(Math.atan2(sign * vel.x, -sign * vel.z) - Math.atan2(f.x, -f.z)) * DEG;
}

/** Lowest point of the springs' wheels and of the collision meshes, in the
 *  hull root's frame. */
function bottoms(root, groups) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const p = new THREE.Vector3();
  let wheel = Infinity, hull = Infinity;
  root.traverse(o => {
    if (!o.isMesh || !o.geometry?.attributes?.position) return;
    const pos = o.geometry.attributes.position;
    let under = false, skip = false;
    for (let a = o; a && a !== root; a = a.parent) {
      const kind = a.userData?.templateKind ?? '';
      if (kind === 'Spring') under = true;
      // An effect's sprite, and a part the engine never drops on the terrain
      // (`c_CGLandscape`, COL-20: FHSW's BulletCatcher cubes 19-24 m down).
      if (/Effect|Particle|Emitter/.test(kind) || ((groups?.[a.name.toLowerCase()] ?? 0) & 2)) skip = true;
    }
    if (skip) return;
    const m = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
    for (let i = 0; i < pos.count; i++) {
      p.fromBufferAttribute(pos, i).applyMatrix4(m);
      if (under) wheel = Math.min(wheel, p.y);
      else hull = Math.min(hull, p.y);
    }
  });
  return { wheel, hull };
}

function build(root, collisionMeshes, y, tables) {
  const occ = new VehicleOccupancy(root, DRIVE_CLASSES);
  if (!['ground', 'tank'].includes(occ.rootKind)) return { kind: occ.rootKind, drive: null };
  occ.setActiveSeat(occ.rootId);
  const drive = occ.ensureDrive(null, {
    cockpit: false, groundHeight: () => 0, waterLevel: -1000, collisionMeshes,
  });
  if (drive) {
    // The page's and the room's adoption (`hull-bodies.js` `adoptDrivenBody`,
    // `level-instance.mjs` `mountIntoSeat`): each wheel's contact depth off
    // its col0 probe, and its probe's material.
    root.updateMatrixWorld(true);
    const spec = describeVehicleParts(root, collisionMeshes);
    if (spec) wheelContactDepths(drive, spec, tables);
    drive.state.position.set(0, y, 0);
    drive.state.orientation.identity();
    drive.state.velocity.set(0, 0, 0);
  }
  return { kind: occ.rootKind, drive };
}

function step(v, seconds, inputs, each) {
  const ticks = Math.round(seconds / DT);
  for (let i = 0; i < ticks; i++) {
    for (const [k, val] of Object.entries(inputs)) v.setInput(k, val);
    v.integrate(DT);
    if (each) each(v);
  }
}

const r2 = n => Number.isFinite(n) ? Math.round(n * 100) / 100 : null;

function measure(glbPath, collisionMeshes, tables) {
  const { json, bin } = readGlb(glbPath);
  if (!looksLand(json)) return null;
  // Each scenario gets a fresh tree: the drive poses the nodes it owns.
  const fresh = () => {
    const { root } = buildSceneTree(json, bin);
    return root.children.length === 1 ? root.children[0] : root;
  };
  const probe = fresh();
  probe.position.set(0, 0, 0); probe.quaternion.identity(); probe.updateMatrixWorld(true);
  const b = bottoms(probe, collisionMeshes?.groups);
  const lowest = Math.min(b.wheel, b.hull);
  const dropY = Number.isFinite(lowest) ? 0.15 - lowest : 1;
  const start = () => {
    const root = fresh();
    root.position.set(0, 0, 0); root.quaternion.identity();
    return build(root, collisionMeshes, dropY, tables);
  };
  const out = { kind: null };
  let extreme = 0;
  const track = v => { extreme = Math.max(extreme, Math.abs(rollOf(v)), Math.abs(pitchOf(v)), upY(v) < 0 ? 180 : 0); };

  // settle
  const s = start();
  out.kind = s.kind;
  if (!s.drive) return out;
  const v = s.drive;
  out.wheels = v.wheels?.length ?? 0;
  out.driven = v.wheels.filter(w => w.driven).length;
  out.steered = v.wheels.filter(w => w.steered).length;
  let tick = 0;
  step(v, 3, { c_PIThrottle: 0, c_PIYaw: 0 }, x => {
    track(x);
    if (TRACE && tick++ % 6 === 0) console.error('settle', (tick / 60).toFixed(2), r2(x.state.position.y), r2(pitchOf(x)), r2(rollOf(x)),
      x.wheels.map(w => `${w.node.name}:${r2(w.load ?? 0)}`).join(' '));
  });
  out.settle = {
    pitch: r2(pitchOf(v)), roll: r2(rollOf(v)), grounded: !!v.state.grounded, y: r2(v.state.position.y),
    hullBelow: r2(-(v.state.position.y + b.hull)), wheelGap: r2(v.state.position.y + b.wheel),
  };
  // forward, continuing from the settled pose
  const h0 = headingOf(v);
  let top = 0, crab = 0;
  step(v, 8, { c_PIThrottle: 1, c_PIYaw: 0 }, x => {
    track(x); top = Math.max(top, alongOf(x));
    if (alongOf(x) > 3) crab = Math.max(crab, Math.abs(slipOf(x)));
  });
  out.forward = { top: r2(top), drift: r2(wrap(headingOf(v) - h0) * DEG), crab: r2(crab) };

  // turn: fresh, 4 s throttle then 2.5 s right lock
  const t = start().drive;
  step(t, 2, { c_PIThrottle: 0, c_PIYaw: 0 }, track);
  step(t, 4, { c_PIThrottle: 1, c_PIYaw: 0 }, track);
  const speed0 = alongOf(t);
  const th0 = headingOf(t);
  let turned = 0, prev = th0, tslip = 0, troll = 0;
  step(t, 2.5, { c_PIThrottle: 1, c_PIYaw: 1 }, x => {
    track(x);
    const h = headingOf(x); turned += wrap(h - prev); prev = h;
    if (Math.hypot(x.state.velocity.x, x.state.velocity.z) > 4) tslip = Math.max(tslip, Math.abs(slipOf(x)));
    troll = Math.max(troll, Math.abs(rollOf(x)));
  });
  out.turn = { speed: r2(speed0), turned: r2(turned * DEG), slip: r2(tslip), roll: r2(troll), endSpeed: r2(alongOf(t)) };

  // reverse: fresh, from rest
  const rv = start().drive;
  step(rv, 2, { c_PIThrottle: 0, c_PIYaw: 0 }, track);
  let back = 0;
  step(rv, 6, { c_PIThrottle: -1, c_PIYaw: 0 }, x => { track(x); back = Math.max(back, -alongOf(x)); });
  out.reverse = { top: r2(back) };
  out.extreme = r2(extreme);

  const flags = [];
  if (top < 1.5) flags.push('no-drive');
  if (back < 0.5) flags.push('no-reverse');
  if (top >= 1.5) {
    if (out.turn.turned < -5) flags.push('wrong-way');
    // A crawler (a crew-pushed gun, a TOG, a Karl) turns at its walking
    // pace; full lock at 2 m/s is not a turn to judge.
    else if (Math.abs(out.turn.turned) < 30 && out.turn.speed >= 6) flags.push('weak-turn');
    // Only the straight line's slip. The turn's is the server's own law:
    // the lab's Puma on desert_hill slid 68 degrees at full lock from
    // 26 m/s and the page's drive holds it to a millimetre an ack through
    // the slide (tests/test_vehicle_law.py PumaLawTests); a Kubelwagen at
    // 19 m/s slips 1 degree on both. The census flagged 46-89 degrees on
    // the Puma, sdkfz232, Technicals, DPV and Forklift as `crab`.
    if (crab > 10) flags.push('crab');
  }
  if (extreme > 60) flags.push('rolls');
  if (Math.abs(out.settle.pitch) > 8 || Math.abs(out.settle.roll) > 8) flags.push('not-level');
  if (out.settle.hullBelow > 0.5) flags.push('sinks');
  if (!out.settle.grounded || out.settle.wheelGap > 0.3) flags.push('floats');
  out.flags = flags;
  return out;
}

const wantTrees = opt('--trees')?.split(',') ?? null;
const only = opt('--only') ? new RegExp(opt('--only'), 'i') : null;
const report = { date: new Date().toISOString().slice(0, 10), trees: {} };
for (const tree of trees()) {
  if (wantTrees && !wantTrees.includes(tree.id)) continue;
  const cmPath = join(tree.maps, '_shared', 'collision-meshes.json');
  const collisionMeshes = existsSync(cmPath) ? JSON.parse(readFileSync(cmPath, 'utf8')) : null;
  if (collisionMeshes && !collisionMeshes.mobility) {
    const mob = join(tree.maps, '_shared', 'part-mobility.json');
    if (existsSync(mob)) collisionMeshes.mobility = JSON.parse(readFileSync(mob, 'utf8')).mobility;
  }
  const dmgPath = join(tree.maps, '_shared', 'damage.json');
  const tables = existsSync(dmgPath) ? JSON.parse(readFileSync(dmgPath, 'utf8')) : null;
  const t = { templates: 0, land: 0, flagged: 0, failed: [], byFlag: {}, rows: {} };
  for (const tpl of templatesOf(tree)) {
    if (only && !only.test(tpl.name)) continue;
    if (!existsSync(tpl.glb)) continue;
    t.templates++;
    let row;
    try { row = measure(tpl.glb, collisionMeshes, tables); } catch (e) {
      t.failed.push(`${tpl.name}: ${e.message}`);
      if (process.env.CENSUS_DEBUG) console.error(e.stack);
      continue;
    }
    if (!row || !row.settle) continue;
    t.land++;
    if (row.flags.length) {
      t.flagged++;
      for (const f of row.flags) (t.byFlag[f] ??= []).push(tpl.name);
    }
    if (row.flags.length || !args.includes('--flagged')) t.rows[tpl.name] = row;
  }
  report.trees[tree.id] = t;
  const by = Object.entries(t.byFlag).map(([f, l]) => `${f} ${l.length}`).join(', ');
  console.error(`${tree.id}: ${t.land} land hulls of ${t.templates}; flagged ${t.flagged}${by ? ` (${by})` : ''}; failed ${t.failed.length}`);
}
const json = JSON.stringify(report, null, 1);
const dest = opt('--json');
if (dest === '-') process.stdout.write(json);
else if (dest) writeFileSync(dest, json);
