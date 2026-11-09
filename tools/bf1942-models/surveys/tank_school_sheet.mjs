#!/usr/bin/env node
// The tank school's sheet (features/battle-schools, tank-matchup.md): each
// tank of a model tree driven on flat ground through the page's own tracked
// drive, for the matchup screen's DRIVE and STEADINESS panels.
//
// The drive is the server's per-tick law (`viewer/tracked-vehicle.js`,
// TANK-18..TANK-25), the same one `census_ground_drive.mjs` drives, read off
// the published glb the way the room server reads it. For each tank:
//
//   drive    top speed and reverse speed; seconds to cover 5 m forward and
//            5 m back from rest (the peek); a 90-degree turn from rest on
//            throttle and full lock, and on the move at top speed
//   steady   how far the hull rocks and for how long: a hard stop from top
//            speed (reverse throttle until stopped, then hands off), letting
//            go at top speed, the main gun fired straight ahead and across
//            the hull at rest (one tick of `-forward x fireingForce` at the
//            gun, FA-19, `viewer/gun-recoil.js`), a full-lock turn at speed
//            and a pull-away. `peak` is the largest swing from the resting
//            attitude in degrees, `still` when no pitch or roll moves faster
//            than 0.5 deg/s, `left` where it comes to rest against its
//            resting attitude (a hull that falls asleep mid-swing freezes
//            there), `swings` the half-cycles past 0.2 degrees
//   traces   pitch (roll for the broadside shot) at 15 samples a second, for
//            the panel to play back
//
//   node surveys/tank_school_sheet.mjs [--models <dir>] [--maps <dir>]
//        [--mod bf1942] [--out viewer/tank-school/bf1942.json]
//        [--fetch https://mesh.bfstats.io/]
//
// `--models` is a tree's models directory (its models.json and glbs) and
// `--maps` its maps directory (`_shared/collision-meshes.json`,
// `part-mobility.json`, `damage.json`, `vehicle-ai.json`); both default to
// the viewer's own. With `--fetch`, whatever of those and of the tanks' glbs
// is missing is downloaded from the published trees into those directories
// first (a mod's paths from `models/mods.json`), so any tree can be
// measured without a local extraction:
//
//   node surveys/tank_school_sheet.mjs --mod desertcombat --fetch https://mesh.bfstats.io/ \
//        --models ~/.cache/bfstats-tank-school/desertcombat/models \
//        --maps ~/.cache/bfstats-tank-school/desertcombat/maps
//
// The tanks are the tree's own by `tank-arena.js` `isTank` with its AI data.
// A wheeled hull (Desert Combat's EE-9) is driven too, its shot's push spent
// on its velocity and spin; a gun with no `fireingForce` shoves nothing and
// its hull is measured standing still. From tools/bf1942-models.
// No Chromium; about a second a tank.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
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
const { isTank } = await load('viewer/tank-arena.js');

const DRIVE_CLASSES = { Aircraft, GroundVehicle, TrackedVehicle };
const DEG = 180 / Math.PI;
const DT = 1 / 60;
const TRACE_HZ = 15;

const args = process.argv.slice(2);
const opt = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const modelsDir = resolve(opt('--models') ?? join(viewerDir, 'models'));
const mapsDir = resolve(opt('--maps') ?? join(viewerDir, 'maps'));
const modId = opt('--mod') ?? 'bf1942';
const outPath = resolve(opt('--out') ?? join(viewerDir, 'tank-school', `${modId}.json`));
const site = opt('--fetch');

const r2 = n => (Number.isFinite(n) ? Math.round(n * 100) / 100 : null);
const forwardOf = v => new THREE.Vector3(0, 0, -1).applyQuaternion(v.state.orientation);
const rightOf = v => new THREE.Vector3(1, 0, 0).applyQuaternion(v.state.orientation);
const headingOf = v => { const f = forwardOf(v); return Math.atan2(f.x, -f.z); };
const pitchOf = v => Math.asin(Math.max(-1, Math.min(1, forwardOf(v).y))) * DEG;
const rollOf = v => Math.asin(Math.max(-1, Math.min(1, rightOf(v).y))) * DEG;
const alongOf = v => v.state.velocity.dot(forwardOf(v));
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));

/** Lowest wheel and lowest hull point in the root's frame, to drop it on its springs. */
function lowest(root, groups) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const p = new THREE.Vector3();
  let low = Infinity;
  root.traverse(o => {
    if (!o.isMesh || !o.geometry?.attributes?.position) return;
    for (let a = o; a && a !== root; a = a.parent) {
      const kind = a.userData?.templateKind ?? '';
      if (/Effect|Particle|Emitter/.test(kind) || ((groups?.[a.name.toLowerCase()] ?? 0) & 2)) return;
    }
    const m = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
    const pos = o.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) low = Math.min(low, p.fromBufferAttribute(pos, i).applyMatrix4(m).y);
  });
  return low;
}

/** The main gun: the FireArms node with the largest `fireingForce`, or the
 *  first that fires a shell. */
function mainGun(root) {
  let best = null;
  root.traverse(o => {
    const e = o.userData ?? {};
    if (e.templateKind !== 'FireArms') return;
    const fa = e.fireArms ?? {};
    const shell = fa.projectile?.kind === 'shell';
    const force = Number(fa.fireingForce) || 0;
    const score = (shell ? 1000 : 0) + force;
    if (!best || score > best.score) best = { node: o, force, score, shell };
  });
  return best?.shell ? best : null;
}

/** The yaw bundle the gun sits under (the turret), outermost. */
function turretOf(gun, root) {
  let out = null;
  for (let a = gun.parent; a && a !== root; a = a.parent) {
    if (a.userData?.templateKind === 'RotationalBundle' && a.userData?.rig?.axes?.yaw) out = a;
  }
  return out;
}

function measure(glbPath, collisionMeshes, tables) {
  const { json, bin } = readGlb(glbPath);
  const fresh = () => { const { root } = buildSceneTree(json, bin); return root.children.length === 1 ? root.children[0] : root; };
  const probe = fresh();
  probe.position.set(0, 0, 0); probe.quaternion.identity();
  const dropY = 0.15 - lowest(probe, collisionMeshes?.groups);
  const start = () => {
    const root = fresh();
    root.position.set(0, 0, 0); root.quaternion.identity();
    const occ = new VehicleOccupancy(root, DRIVE_CLASSES);
    if (occ.rootKind !== 'tank' && occ.rootKind !== 'ground') return null;
    occ.setActiveSeat(occ.rootId);
    const drive = occ.ensureDrive(null, { cockpit: false, groundHeight: () => 0, waterLevel: -1000, collisionMeshes });
    if (!drive) return null;
    root.updateMatrixWorld(true);
    const spec = describeVehicleParts(root, collisionMeshes);
    if (spec) wheelContactDepths(drive, spec, tables);
    drive.state.position.set(0, dropY, 0);
    drive.state.orientation.identity();
    drive.state.velocity.set(0, 0, 0);
    return drive;
  };
  const step = (v, seconds, inputs, each) => {
    const ticks = Math.round(seconds / DT);
    for (let i = 0; i < ticks; i++) {
      for (const [k, val] of Object.entries(typeof inputs === 'function' ? inputs() : inputs)) v.setInput(k, val);
      v.integrate(DT);
      each?.(v);
    }
  };
  const settled = () => { const v = start(); if (v) step(v, 3, { c_PIThrottle: 0, c_PIYaw: 0 }); return v; };
  const rest = settled();
  if (!rest) return null;
  const p0 = pitchOf(rest), r0 = rollOf(rest);

  /** Rock a hull for `seconds` under `inputs`; the trace of `axis`. */
  const rock = (v, seconds, inputs, axis = 'pitch') => {
    let t = 0, peak = 0, still = 0, swings = 0, prevSign = 0, prevP = pitchOf(v), prevR = rollOf(v);
    const trace = [];
    const every = Math.round(1 / DT / TRACE_HZ);
    step(v, seconds, inputs, x => {
      t += DT;
      const dp = pitchOf(x) - p0, dr = rollOf(x) - r0;
      peak = Math.max(peak, Math.abs(axis === 'pitch' ? dp : dr));
      if (Math.abs(pitchOf(x) - prevP) / DT > 0.5 || Math.abs(rollOf(x) - prevR) / DT > 0.5) still = t;
      prevP = pitchOf(x); prevR = rollOf(x);
      const d = axis === 'pitch' ? dp : dr;
      const sg = Math.sign(d);
      if (Math.abs(d) > 0.2 && sg) { if (prevSign && sg !== prevSign) swings++; prevSign = sg; }
      if (Math.round(t / DT) % every === 0) trace.push(Math.round(d * 100) / 100);
    });
    const left = axis === 'pitch' ? pitchOf(v) - p0 : rollOf(v) - r0;
    return { summary: { peak: r2(peak), still: r2(still), left: r2(left), swings }, trace };
  };

  const out = { drive: {}, steady: {}, traces: {} };
  // Drive.
  { const v = settled(); const x0 = v.state.position.clone(); let t = 0, t5 = null;
    step(v, 10, { c_PIThrottle: 1, c_PIYaw: 0 }, x => { t += DT; if (t5 == null && x.state.position.distanceTo(x0) >= 5) t5 = t; });
    out.drive.top = r2(alongOf(v)); out.drive.forward5 = r2(t5); }
  { const v = settled(); const x0 = v.state.position.clone(); let t = 0, t5 = null;
    step(v, 10, { c_PIThrottle: -1, c_PIYaw: 0 }, x => { t += DT; if (t5 == null && x.state.position.distanceTo(x0) >= 5) t5 = t; });
    out.drive.reverse = r2(-alongOf(v)); out.drive.back5 = r2(t5); }
  for (const [key, pre] of [['turnFromRest', 0], ['turnOnTheMove', 6]]) {
    const v = settled(); if (pre) step(v, pre, { c_PIThrottle: 1, c_PIYaw: 0 });
    let prev = headingOf(v), turned = 0, t = 0, t90 = null;
    step(v, 8, { c_PIThrottle: 1, c_PIYaw: 1 }, x => { t += DT; const h = headingOf(x); turned += wrap(h - prev); prev = h; if (t90 == null && Math.abs(turned) * DEG >= 90) t90 = t; });
    out.drive[key] = r2(t90);
  }
  // Steadiness.
  { const v = settled(); step(v, 8, { c_PIThrottle: 1, c_PIYaw: 0 });
    let stopped = null, t = 0;
    const r = rock(v, 10, () => { t += DT; if (stopped == null && alongOf(v) <= 0.1) stopped = t; return { c_PIThrottle: stopped == null ? -1 : 0, c_PIYaw: 0 }; });
    out.steady.hardStop = { ...r.summary, stoppedAt: r2(stopped) }; out.traces.hardStop = { axis: 'pitch', hz: TRACE_HZ, values: r.trace }; }
  { const v = settled(); step(v, 8, { c_PIThrottle: 1, c_PIYaw: 0 });
    const r = rock(v, 10, { c_PIThrottle: 0, c_PIYaw: 0 });
    out.steady.coast = r.summary; out.traces.coast = { axis: 'pitch', hz: TRACE_HZ, values: r.trace }; }
  { const v = settled(); step(v, 6, { c_PIThrottle: 1, c_PIYaw: 0 });
    let peakRoll = 0, peakPitch = 0;
    step(v, 3, { c_PIThrottle: 1, c_PIYaw: 1 }, x => { peakRoll = Math.max(peakRoll, Math.abs(rollOf(x) - r0)); peakPitch = Math.max(peakPitch, Math.abs(pitchOf(x) - p0)); });
    out.steady.turn = { roll: r2(peakRoll), pitch: r2(peakPitch) }; }
  { const v = settled(); let peak = 0;
    step(v, 4, { c_PIThrottle: 1, c_PIYaw: 0 }, x => { peak = Math.max(peak, Math.abs(pitchOf(x) - p0)); });
    out.steady.pullAway = { pitch: r2(peak) }; }
  // The shot, straight ahead and across the hull.
  const gunProbe = (() => { const root = fresh(); root.position.set(0, 0, 0); root.quaternion.identity(); return mainGun(root); })();
  out.fireingForce = gunProbe?.force ?? 0;
  for (const [key, yaw, axis] of [['fireAhead', 0, 'pitch'], ['fireAcross', 90, 'roll']]) {
    // Every hull is measured, whatever its gun. A gun that declares no
    // `fireingForce` (Desert Combat's AT-5 and chain guns) shoves nothing:
    // the hull is driven on with no push, and stays where it rests. A wheeled
    // hull's drive has no accumulator to post the push into, so the shot's
    // one tick is spent on its velocity and spin directly, as the tracked
    // law spends its own: `a dt`, and `(r x a) dt` over the box inertia in
    // the hull's frame.
    const root = fresh(); root.position.set(0, 0, 0); root.quaternion.identity();
    const gun = mainGun(root) ?? (() => { let any = null; root.traverse(o => { if (!any && o.userData?.templateKind === 'FireArms') any = { node: o, force: 0 }; }); return any; })();
    const v = settled();
    if (gun && out.fireingForce > 0) {
      const turret = turretOf(gun.node, root);
      if (turret && yaw) turret.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -yaw / DEG));
      root.updateMatrixWorld(true);
      const m = gun.node.matrixWorld.elements;
      const gunAt = new THREE.Vector3(m[12], m[13], m[14]);
      const back = new THREE.Vector3(m[8], m[9], m[10]).normalize();   // +Z is back out of the barrel
      const q = v.state.orientation, pos = v.state.position;
      const at = gunAt.clone().applyQuaternion(q).add(pos);
      const a = back.clone().applyQuaternion(q).multiplyScalar(out.fireingForce);
      const torque = new THREE.Vector3().crossVectors(at.clone().sub(pos), a);
      if (v.law) {
        v.law.acc.add(a);
        v.law.racc.add(torque);
      } else if (v._inertia) {
        const tick = 1 / 30;
        v.state.velocity.addScaledVector(a, tick);
        const tb = torque.applyQuaternion(q.clone().invert());
        v.state.angularVelocity.x += tb.x / v._inertia.x * tick;
        v.state.angularVelocity.y += tb.y / v._inertia.y * tick;
        v.state.angularVelocity.z += tb.z / v._inertia.z * tick;
      }
    }
    const r = rock(v, 8, { c_PIThrottle: 0, c_PIYaw: 0 }, axis);
    out.steady[key] = r.summary; out.traces[key] = { axis, hz: TRACE_HZ, values: r.trace };
  }
  return out;
}

// --- fetching a published tree -----------------------------------------------
async function download(url, file) {
  if (existsSync(file)) return true;
  const res = await fetch(url, { headers: { 'User-Agent': 'bfstats-tank-school-sheet' } });
  if (!res.ok) return false;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  return true;
}
let paths = { models: 'models', maps: 'maps' };
if (site) {
  const base = site.replace(/\/?$/, '/');
  const mods = await (await fetch(`${base}models/mods.json`)).json();
  const entry = (mods.mods ?? mods).find(m => m.id === modId);
  if (!entry) throw new Error(`no mod ${modId} on ${base}`);
  paths = entry.paths;
  await download(`${base}${paths.models}/models.json`, join(modelsDir, 'models.json'));
  for (const f of ['collision-meshes.json', 'part-mobility.json', 'damage.json', 'vehicle-ai.json']) {
    await download(`${base}${paths.maps}/_shared/${f}`, join(mapsDir, '_shared', f));
  }
}

const rows = JSON.parse(readFileSync(join(modelsDir, 'models.json'), 'utf8'));
const shared = join(mapsDir, '_shared');
const ai = existsSync(join(shared, 'vehicle-ai.json')) ? JSON.parse(readFileSync(join(shared, 'vehicle-ai.json'), 'utf8')).vehicles ?? null : null;
const collisionMeshes = existsSync(join(shared, 'collision-meshes.json')) ? JSON.parse(readFileSync(join(shared, 'collision-meshes.json'), 'utf8')) : null;
if (collisionMeshes && !collisionMeshes.mobility && existsSync(join(shared, 'part-mobility.json'))) {
  collisionMeshes.mobility = JSON.parse(readFileSync(join(shared, 'part-mobility.json'), 'utf8')).mobility;
}
const tables = existsSync(join(shared, 'damage.json')) ? JSON.parse(readFileSync(join(shared, 'damage.json'), 'utf8')) : null;

const sheet = { mod: modId, made: 'surveys/tank_school_sheet.mjs', tanks: {} };
for (const row of rows.filter(r => isTank(r, ai)).sort((a, b) => a.name.localeCompare(b.name))) {
  const glb = join(modelsDir, row.glb);
  if (site && !existsSync(glb)) {
    // The tree's own file, else the content store's (a tree whose glbs the
    // volume keeps by hash), else vanilla's (a mod's tree holds what it adds).
    const base = site.replace(/\/?$/, '/');
    const ok = await download(`${base}${paths.models}/${row.glb}`, glb)
      || (row.sha && await download(`${base}glbs/${row.sha}.glb`, glb))
      || await download(`${base}models/${row.glb}`, glb);
    if (!ok) { console.error(`${row.name}: no glb on ${base}`); continue; }
  }
  if (!existsSync(glb)) { console.error(`${row.name}: no glb at ${glb}`); continue; }
  try {
    const m = measure(glb, collisionMeshes, tables);
    if (m) sheet.tanks[row.name] = m;
    else console.error(`${row.name}: not a land drive`);
  } catch (e) {
    console.error(`${row.name}: ${e.message}`);
  }
}
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(sheet)}\n`);
console.error(`${Object.keys(sheet.tanks).length} tanks -> ${outPath}`);
