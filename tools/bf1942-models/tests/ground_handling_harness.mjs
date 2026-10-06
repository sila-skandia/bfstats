// The viewer's land drives against the real game's, on Desert Combat's own
// glbs: prints one JSON blob for `tests/test_ground_handling.py`.
//
//   node tests/ground_handling_harness.mjs <viewer assets dir>
//
// Three comparisons, each with the input retail's hull actually had:
//
//   lock     Twenty full-lock episodes the lab recorded with bots at AI LOD 0
//            (`fixtures/dc_lock_episodes.json.gz`: DPV, Humvee, Humvee_TOW,
//            BRDM-2 and Technical_Recoilless, four each, the longest locks
//            entered at 8 m/s or more). Each row carries the hull's position
//            and rotation on the server's tick, its steered wheels' recorded
//            angle and its engine's throttle servo. The viewer's car is
//            brought to the recorded speed 0.3 s before the lock and then
//            handed the same servo and wheel angle tick by tick. Both sides go
//            through `lab/dc_truth.py`'s own estimator (velocity over 0.25 s,
//            the heading at the window's start), so a yaw rate or a slip
//            angle means the same thing on each.
//   cruise   The AI's tank law (`bot-vehicle.js tankControl`, AI-45) toward a
//            point dead ahead at the hull's `aiTemplatePlugIn.maxSpeed`: the
//            lab's "top speeds" for DC's tanks are this law, not the drive's
//            ceiling.
//   pivot    Full throttle and full lock from rest, 2 s to wind up and 3 s
//            measured: the turn a bot makes on the spot.
//
// The ground is flat and analytic and its friction the mean of a default
// wheel material and sand (0.5 * (1.0 + 0.8)); the lab's rounds were on
// El Alamein's and Guadalcanal's own.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VIEWER = path.join(HERE, '..', 'viewer');
const { installModuleHooks } = await import(path.join(HERE, '..', 'sim', 'env.mjs'));
installModuleHooks(VIEWER);
const imp = name => import(pathToFileURL(path.join(VIEWER, name)).href);
const THREE = await imp('vendor/three.module.js');
const { GLTFLoader } = await imp('vendor/loaders/GLTFLoader.js');
const { GroundVehicle } = await imp('wheeled-vehicle.js');
const { TrackedVehicle } = await imp('tracked-vehicle.js');
const { classifyRoot } = await imp('seat-survey.js');
const { tankControl } = await imp('bot-vehicle.js');

const [assets] = process.argv.slice(2);
const MODELS = path.join(assets, 'models', 'mods', 'desertcombat');
const COLLISION = JSON.parse(fs.readFileSync(
  path.join(assets, 'maps', 'mods', 'desertcombat', '_shared', 'collision-meshes.json'), 'utf8'));
const FIXTURE = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(HERE, 'fixtures', 'dc_lock_episodes.json.gz'))));
const DT = 1 / 30;
const SAND = +(process.env.GROUND_FRICTION || 0.8);
const round = (v, p = 3) => +v.toFixed(p);

/** A glb with its images, textures and samplers dropped (node decodes none). */
function stripGlb(data) {
  let offset = 12, json = null, bin = null;
  while (offset + 8 <= data.length) {
    const length = data.readUInt32LE(offset), type = data.readUInt32LE(offset + 4);
    offset += 8;
    if (type === 0x4e4f534a) json = JSON.parse(data.toString('utf8', offset, offset + length));
    else if (type === 0x4e4942) bin = data.subarray(offset, offset + length);
    offset += length;
  }
  delete json.images; delete json.textures; delete json.samplers;
  for (const m of json.materials || []) {
    const p = m.pbrMetallicRoughness || {};
    delete p.baseColorTexture; delete p.metallicRoughnessTexture;
    delete m.normalTexture; delete m.occlusionTexture; delete m.emissiveTexture; delete m.extensions;
  }
  for (const k of ['extensionsUsed', 'extensionsRequired']) {
    if (json[k]) json[k] = json[k].filter(n => !/texture/i.test(n));
  }
  const pad = (b, f) => Buffer.concat([b, Buffer.alloc((4 - b.length % 4) % 4, f)]);
  const chunk = (b, t) => { const h = Buffer.alloc(8); h.writeUInt32LE(b.length, 0); h.writeUInt32LE(t, 4); return [h, b]; };
  const body = Buffer.concat([...chunk(pad(Buffer.from(JSON.stringify(json)), 0x20), 0x4e4f534a),
    ...(bin ? chunk(pad(Buffer.from(bin), 0), 0x4e4942) : [])]);
  const head = Buffer.alloc(12);
  head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + body.length, 8);
  const out = Buffer.concat([head, body]);
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength);
}

async function build(name) {
  const buf = stripGlb(fs.readFileSync(path.join(MODELS, `${name}.glb`)));
  const gltf = await new Promise((resolve, reject) => new GLTFLoader().parse(buf, 'file:///', resolve, reject));
  const root = gltf.scene.children[0];
  const Cls = classifyRoot(root) === 'tank' ? TrackedVehicle : GroundVehicle;
  const drive = new Cls(root, null, {
    cockpit: false, groundHeight: () => 0, surfaceFriction: () => SAND, collisionMeshes: COLLISION,
  });
  drive.state.position.set(0, 1.5, 0);
  for (let i = 0; i < 90; i++) { drive.setInput('c_PIThrottle', 0); drive.integrate(DT); }
  return drive;
}
const forwardOf = d => new THREE.Vector3(0, 0, -1).applyQuaternion(d.state.orientation);
const wrap = a => { while (a > 180) a -= 360; while (a < -180) a += 360; return a; };

/** BF1942's quaternion applied to a vector (the recorder's frame, +Z forward). */
function qrot([x, y, z, w], [vx, vy, vz]) {
  const ix = w * vx + y * vz - z * vy, iy = w * vy + z * vx - x * vz;
  const iz = w * vz + x * vy - y * vx, iw = -x * vx - y * vy - z * vz;
  return [ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z,
    iz * w + iw * -z + ix * -y - iy * -x];
}

/** `dc_truth.states`: velocity over 0.25 s, the heading and the yaw at the
 *  window's start. Rows are `{t, p, f}`, `f` the hull's forward. */
function windowed(rows) {
  const out = [];
  for (let i = 0; i < rows.length; i++) {
    const a = rows[i];
    let j = i;
    while (j < rows.length - 1 && rows[j].t < a.t + 0.25) j++;
    const b = rows[j];
    const dt = b.t - a.t;
    if (dt < 0.15) continue;
    const v = [0, 1, 2].map(k => (b.p[k] - a.p[k]) / dt);
    const h0 = Math.atan2(a.f[0], a.f[2]) * 180 / Math.PI;
    const h1 = Math.atan2(b.f[0], b.f[2]) * 180 / Math.PI;
    const level = Math.hypot(v[0], v[2]);
    out.push({
      t: a.t,
      forward: v[0] * a.f[0] + v[1] * a.f[1] + v[2] * a.f[2],
      yaw: Math.abs(wrap(h1 - h0)) / dt,
      slip: level < 1 ? null : Math.abs(wrap(Math.atan2(v[0], v[2]) * 180 / Math.PI - h0)),
    });
  }
  return out;
}

const median = values => {
  if (!values.length) return null;
  const s = [...values].sort((x, y) => x - y);
  return s[Math.floor((s.length - 1) / 2)];
};

// --- lock -------------------------------------------------------------------
const GLB = {
  DesertPatrolVehicle: 'DesertPatrolVehicle', Humvee: 'Humvee', Humvee_Tow: 'Humvee_Tow',
  BRDM2: 'BRDM2', Technical_Recoilless: 'Technical_Recoilless',
};
const lock = {};
for (const episode of FIXTURE.episodes) {
  const samples = episode.samples;
  const retail = windowed(samples.map(s => ({ t: s[0], p: s.slice(1, 4), f: qrot(s.slice(4, 8), [0, 0, 1]) })));
  const first = samples.findIndex(s => s[0] >= -0.3);
  const start = retail.find(r => r.t >= samples[first][0]) ?? retail[0];
  const drive = await build(GLB[episode.tmpl]);
  for (let i = 0; i < 30 * 40 && forwardOf(drive).dot(drive.state.velocity) < start.forward; i++) {
    drive.setInput('c_PIThrottle', 1);
    drive.integrate(DT);
  }
  drive.state.velocity.copy(forwardOf(drive).multiplyScalar(start.forward));
  drive.state.angularVelocity.set(0, 0, 0);
  // The surface the steered wheels pose from and the tyres read their angle
  // off: written each tick to the recorded wheel angle, as a fraction of the
  // lock, in the lock's own direction.
  let key = null;
  for (const k of drive.servoAxes().keys()) if (k.includes('/c_PIYaw/') && k.endsWith('/yaw')) key = k;
  const sign = Math.sign(samples.find(s => s[0] >= 0)?.[8] || 1);
  const rows = [];
  for (let i = first + 1; i < samples.length; i++) {
    const prev = samples[i - 1];
    const dt = Math.max(1 / 60, Math.min(0.1, samples[i][0] - prev[0]));
    const steer = prev[8] == null ? 0 : Math.max(-1, Math.min(1, prev[8] * sign / episode.maxSteer));
    drive.setInput('c_PIThrottle', prev[9] ?? 0);
    drive.setInput('c_PIYaw', steer);
    if (key) drive.state.surfaces.set(key, steer);
    drive.integrate(dt);
    const f = forwardOf(drive);
    // The viewer's -Z forward mapped onto the recorder's +Z: a reflection
    // through the XY plane leaves every angle's magnitude as it was.
    rows.push({ t: samples[i][0], p: [drive.state.position.x, drive.state.position.y, -drive.state.position.z],
      f: [f.x, f.y, -f.z] });
  }
  const viewer = windowed(rows);
  const inLock = r => r.t >= 0 && r.t <= episode.lockEnd;
  const entry = (lock[episode.tmpl] ||= { episodes: 0, retailYaw: [], viewerYaw: [], retailSlip: [], viewerSlip: [],
    viewerYawMax: 0, retailYawMax: 0, perEpisode: [] });
  entry.episodes += 1;
  const lr = retail.filter(inLock), lv = viewer.filter(inLock);
  const at = (list, t) => list.reduce((best, r) => Math.abs(r.t - t) < Math.abs(best.t - t) ? r : best, list[0]);
  entry.perEpisode.push({
    round: episode.round.slice(0, 15), t0: episode.t0, entry: round(start.forward, 2),
    retail: { yaw: round(median(lr.map(r => r.yaw)), 1), slip: round(median(lr.map(r => r.slip ?? 0)), 1),
      exit: round(at(retail, episode.lockEnd).forward, 2) },
    viewer: { yaw: round(median(lv.map(r => r.yaw)), 1), slip: round(median(lv.map(r => r.slip ?? 0)), 1),
      exit: round(at(viewer, episode.lockEnd).forward, 2) },
  });
  for (const r of retail.filter(inLock)) {
    entry.retailYaw.push(r.yaw);
    if (r.slip != null) entry.retailSlip.push(r.slip);
    entry.retailYawMax = Math.max(entry.retailYawMax, r.yaw);
  }
  for (const r of viewer.filter(inLock)) {
    entry.viewerYaw.push(r.yaw);
    if (r.slip != null) entry.viewerSlip.push(r.slip);
    entry.viewerYawMax = Math.max(entry.viewerYawMax, r.yaw);
  }
}
const lockSummary = {};
for (const [tmpl, e] of Object.entries(lock)) {
  lockSummary[tmpl] = {
    episodes: e.episodes, samples: e.retailYaw.length,
    retailYaw: round(median(e.retailYaw), 2), viewerYaw: round(median(e.viewerYaw), 2),
    retailSlip: round(median(e.retailSlip), 2), viewerSlip: round(median(e.viewerSlip), 2),
    retailYawMax: round(e.retailYawMax, 2), viewerYawMax: round(e.viewerYawMax, 2),
    perEpisode: e.perEpisode,
  };
}

// --- cruise -----------------------------------------------------------------
// `aiTemplatePlugIn.maxSpeed`, Objects/Vehicles/Land/<hull>/AI/Objects.con in
// DC's OBJECTS.rfa.
const MAX_SPEED = { T72: 12, M1A1: 15, BMP2: 17, M2A3: 20 };
const cruise = {};
for (const [name, maxSpeed] of Object.entries(MAX_SPEED)) {
  const drive = await build(name);
  const target = forwardOf(drive).multiplyScalar(3000).add(drive.state.position);
  const speeds = [];
  let steer = 0;
  for (let i = 0; i < 30 * 30; i++) {
    const f = forwardOf(drive), v = drive.state.velocity, p = drive.state.position;
    // The page's own call (`bot-route.js steerToward`): a THREE yaw rate
    // about +y turns the heading toward a negative angle.
    const c = tankControl({ forward: [f.x, f.z], velocity: [v.x, v.z], toTarget: [target.x - p.x, target.z - p.z],
      maxSpeed, yawRate: -drive.state.angularVelocity.y });
    drive.setInput('c_PIThrottle', c.throttle);
    drive.setInput('c_PIYaw', c.steer);
    drive.integrate(DT);
    if (i >= 30 * 20) { speeds.push(f.dot(v)); steer += Math.abs(c.steer); }
  }
  cruise[name] = { maxSpeed, speed: round(median(speeds), 2), gear: drive.gear, revs: round(drive.revs, 3),
    meanSteer: round(steer / speeds.length, 4) };
  // The drive's own ceiling, the same hull held at full throttle.
  const flat = await build(name);
  for (let i = 0; i < 30 * 25; i++) { flat.setInput('c_PIThrottle', 1); flat.integrate(DT); }
  cruise[name].fullThrottle = round(forwardOf(flat).dot(flat.state.velocity), 2);
}

// --- pivot ------------------------------------------------------------------
const pivot = {};
for (const name of ['T72', 'M1A1', 'BMP2', 'M2A3']) {
  const drive = await build(name);
  const heading = () => { const f = forwardOf(drive); return Math.atan2(-f.x, -f.z) * 180 / Math.PI; };
  for (let i = 0; i < 60; i++) { drive.setInput('c_PIThrottle', 1); drive.setInput('c_PIYaw', 1); drive.integrate(DT); }
  let turned = 0, prev = heading();
  for (let i = 0; i < 90; i++) {
    drive.setInput('c_PIThrottle', 1); drive.setInput('c_PIYaw', 1); drive.integrate(DT);
    const h = heading(); turned += wrap(h - prev); prev = h;
  }
  pivot[name] = { yawRate: round(Math.abs(turned) / 3, 2), speed: round(drive.state.velocity.length(), 2) };
}

// --- critical ---------------------------------------------------------------
// A driver holding full throttle through the page's own seat tick
// (`world-vehicle-tick.js` `vehicleTick`), with the page's `DamageableVehicle`
// off the glb's armour standing in for `World.occupiedDamageable`. Into
// critical the Engine's running byte is cleared and latched (PHY-14: 0x14
// from `Armor::status`), so the drivetrain's revs are held at 0 and the hull
// stops; a re-boarding mid-critical is undone on the next tick; out of
// critical (0x13) the occupied engine starts again.
const { vehicleTick } = await imp('world-vehicle-tick.js');
const { bufferInput } = await imp('world-input.js');
const { DamageableVehicle } = await imp('vehicle-damage.js');
const critical = {};
for (const name of ['Humvee', 'T72']) {
  const drive = await build(name);
  const hull = new DamageableVehicle(drive.node.userData.armor);
  const seat = {
    id: 'driver', kind: 'ground', vehicle: drive,
    occupancy: { turret: null, isActiveRoot: () => true, applyTurrets() {}, activeFireArmsNodes: () => [] },
    gate: { blocked: false, rotationalScale: 1 }, buffer: [], pending: null, held: null,
    stick: { roll: 0, pitch: 0 }, groups: [], manned: [],
  };
  const world = { occupiedDamageable: () => hull, falling: null, fireStateFor: () => null, guns: null };
  const integrators = new Map([[drive, seat]]);
  const phase = seconds => {
    for (let i = 0; i < Math.round(seconds * 30); i++) {
      bufferInput(seat, { forward: 1 });
      vehicleTick(world, seat, DT, integrators);
    }
    return { running: drive.engineRunning, revs: round(drive.revs, 3),
      speed: round(forwardOf(drive).dot(drive.state.velocity), 2) };
  };
  const driving = phase(4);
  hull.damage(hull.hitPoints - hull.criticalDamage + 1);
  const crippled = phase(4);
  drive.engineRunning = true;
  phase(1 / 30);
  const reboarded = drive.engineRunning;
  hull.heal(hull.maxHitPoints);
  const recovered = phase(3);
  critical[name] = { driving, crippled, reboarded, recovered, wasCritical: hull.criticalDamage != null };
}

console.log(JSON.stringify({ lock: lockSummary, cruise, pivot, critical }));
