// The yaw a wheeled hull answers D with, at a range of speeds, on flat
// ground: the real glb, the page's drive, `c_PIYaw` 1 after a straight run.
//   node surveys/probe_steer_at_speed.mjs --glb <path> [--collision <json>]
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
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
const args = process.argv.slice(2);
const opt = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const glb = resolve(opt('--glb'));
const colPath = opt('--collision');
const collisionMeshes = colPath && existsSync(colPath) ? JSON.parse(readFileSync(colPath, 'utf8')) : null;
const DT = 1 / 60, DEG = 180 / Math.PI;
const { json, bin } = readGlb(glb);
const fresh = () => { const { root } = buildSceneTree(json, bin); return root.children.length === 1 ? root.children[0] : root; };
const fwd = v => new THREE.Vector3(0, 0, -1).applyQuaternion(v.state.orientation);
const heading = v => { const f = fwd(v); return Math.atan2(f.x, -f.z); };
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
function start() {
  const root = fresh(); root.position.set(0, 0, 0); root.quaternion.identity();
  const occ = new VehicleOccupancy(root, { Aircraft, GroundVehicle, TrackedVehicle });
  occ.setActiveSeat(occ.rootId);
  const drive = occ.ensureDrive(null, { cockpit: false, groundHeight: () => 0, waterLevel: -1000, collisionMeshes });
  root.updateMatrixWorld(true);
  const spec = describeVehicleParts(root, collisionMeshes);
  if (spec) wheelContactDepths(drive, spec, collisionMeshes?.tables ?? null);
  drive.state.position.set(0, 1.0, 0); drive.state.orientation.identity(); drive.state.velocity.set(0, 0, 0);
  return { drive, kind: occ.rootKind, cls: drive.constructor.name };
}
const out = [];
for (const pre of [0, 2, 4, 6, 8, 12]) {
  const { drive: v, kind, cls } = start();
  for (let i = 0; i < 180; i++) { v.setInput('c_PIThrottle', 0); v.setInput('c_PIYaw', 0); v.integrate(DT); }
  for (let i = 0; i < pre * 60; i++) { v.setInput('c_PIThrottle', 1); v.setInput('c_PIYaw', 0); v.integrate(DT); }
  const speed = v.state.velocity.dot(fwd(v));
  let prev = heading(v), first = 0, total = 0;
  for (let i = 0; i < 120; i++) {
    v.setInput('c_PIThrottle', 1); v.setInput('c_PIYaw', 1); v.integrate(DT);
    const h = heading(v); const d = wrap(h - prev); prev = h; total += d; if (i < 30) first += d;
  }
  out.push({ kind, cls, pre, speed: +speed.toFixed(1), first05s_deg: +(first * DEG).toFixed(1), total2s_deg: +(total * DEG).toFixed(1) });
}
process.stdout.write(JSON.stringify(out, null, 1) + '\n');
