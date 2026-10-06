// A seat gun's rounds through the page's own launch path, under node: every
// round `GunFire.fireShot` puts in the air, measured in its launch frame.
//
// The law (ledger DEV-9, DEV-11, DEV-12, AI-145): each round of a plain
// FireArms is pushed off its line by `u x total / 100` on the frame's up and
// right rows, `u` uniform in (-1, +1] per axis for a human and a fixed point
// for a bot; the total is `minDev + fire` (+ a bot's AI term), stored once a
// tick, so the first round of a burst flies at the floor.
//
// argv[2] is a JSON spec: `{ cases: [{ name, stats }] }`, each `stats` a
// FireArms node's `fireArms` block (out of a glb, or the .con's numbers).
// Same pattern as `replay_hud_harness.mjs`: the viewer's modules imported in
// place through `sim/env.mjs`'s hooks, one JSON report on stdout.

import path from 'node:path';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { installModuleHooks, viewerDir } from '../sim/env.mjs';
import { mulberry32 } from '../sim/rng.mjs';

const viewer = viewerDir();
installModuleHooks(viewer);
const imp = name => import(pathToFileURL(path.join(viewer, name)).href);
const [THREE, { GunFire }, { FireState }, { seatConeOf }, { BOT_DEVIATION_POINTS }, { cameraLaunch },
  { createVehicleHud }] = await Promise.all([
  imp('vendor/three.module.js'), imp('gunfire.js'), imp('fire-state.js'), imp('seat-cone.js'),
  imp('bot-deviation.js'), imp('gun-groups.js'), imp('vehicle-hud.js'),
]);

const spec = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const TICK = 1 / 30;
const r4 = v => Math.round(v * 1e4) / 1e4;
const AI_TERM = 0.3125;   // AI-68's held-target term at skill 0.75: 5 x 0.25 x 0.25

/** A fresh page: one scene, the guns, the states, the hook as map.html wires it. */
function page(seed = 1) {
  const scene = new THREE.Scene();
  const guns = new GunFire({ scene, camera: new THREE.PerspectiveCamera(), viewportHeight: () => 720 });
  guns.rand = mulberry32(seed);
  const states = new Map();
  const firers = new Map();   // group -> player id
  const bots = new Map();     // player id -> a stand-in Bot: `deviation.aiPending`
  guns.coneOf = seatConeOf({
    stateOf: node => states.get(node) ?? null,
    firerOf: group => firers.get(group) ?? null,
    botOf: id => bots.get(id) ?? null,
  });
  guns.onShot = (group, rounds) => states.get(group.node)?.registerShot(rounds);
  // Every round's velocity the moment it leaves, and the cone it left in.
  const launched = [];
  const ask = guns.coneOf;
  let lastCone = null;
  guns.coneOf = (group, barrel) => {
    const cone = ask(group, barrel);
    lastCone = cone ? { total: cone.total, bot: !!cone.dice } : null;
    return cone;
  };
  const push = guns.tracers.push.bind(guns.tracers);
  guns.tracers.push = (...items) => {
    for (const t of items) launched.push({ v: t.velocity.clone(), cone: lastCone, group: t.group });
    return push(...items);
  };
  return { scene, guns, states, firers, bots, launched };
}

/** A hull at an arbitrary attitude carrying one FireArms node with `barrels`
 *  muzzles (each turned a little, as a wing pair is), collected the way a seat
 *  collects (`SEAT_GUN_OPTIONS`). */
function mount(p, stats, { barrels = 1, attitude = [0.17, 0.7, 0.26], firer = 'human' } = {}) {
  const hull = new THREE.Group();
  hull.rotation.set(...attitude, 'YXZ');
  hull.position.set(10, 2, -5);
  const node = new THREE.Object3D();
  node.name = 'gun';
  node.userData.fireArms = stats;
  hull.add(node);
  for (let i = 0; i < barrels; i++) {
    const m = new THREE.Object3D();
    m.userData.muzzle = true;
    m.position.set(i * 0.4, 0, -1);
    m.rotation.set(0, i * 0.01, 0);
    node.add(m);
  }
  p.scene.add(hull);
  hull.updateMatrixWorld(true);
  const [group] = p.guns.collect(hull, { replace: false, speedScale: 1, maxRange: 1e9,
                                         roundLifetime: 'data', tracerLength: 'data' });
  p.states.set(node, new FireState(stats));
  if (firer != null) p.firers.set(group, firer);
  return { hull, node, group, state: p.states.get(node) };
}

/** A round's offset off its frame's line, hundredths of a radian per axis. */
function offsets(v, q) {
  const f = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
  const r = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
  const u = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
  const fwd = v.dot(f);
  return { up: (v.dot(u) / fwd) * 100, right: (v.dot(r) / fwd) * 100 };
}

function muzzleFrame(muzzle) {
  muzzle.updateWorldMatrix(true, false);
  return muzzle.getWorldQuaternion(new THREE.Quaternion());
}

/** Single rounds a second apart, each at a cold barrel: the floor's square. */
function floorRounds(stats, n, firer = 'human') {
  const p = page(7);
  const g = mount(p, stats, { firer });
  if (firer && firer !== 'human') p.bots.set(firer, { deviation: { aiPending: AI_TERM } });
  const q = muzzleFrame(g.group.muzzles[0]);
  const rows = [];
  for (let i = 0; i < n; i++) {
    g.state.step(1);
    p.guns.fireShot(g.group);
    const round = p.launched.at(-1);
    const o = offsets(round.v, q);
    const total = round.cone?.total ?? 0;
    rows.push({ up: o.up, right: o.right, total });
  }
  return rows;
}

/** A held trigger, stepped as the world steps it: the state a tick, the guns
 *  a tick. Each round: its tick, the total it left in, its offsets. */
function burst(stats, seconds, firer = 'human') {
  const p = page(11);
  const g = mount(p, stats, { firer });
  if (firer && firer !== 'human') p.bots.set(firer, { deviation: { aiPending: AI_TERM } });
  const q = muzzleFrame(g.group.muzzles[0]);
  const rows = [];
  const ticks = Math.round(seconds * 30);
  for (let tick = 0; tick < ticks; tick++) {
    g.state.step(TICK);
    p.guns.setFiring(g.group, true);
    const before = p.launched.length;
    p.guns.advance(TICK);
    for (const round of p.launched.slice(before)) {
      const o = offsets(round.v, q);
      rows.push({ tick, total: r4(round.cone?.total ?? 0), up: o.up, right: o.right });
    }
  }
  return rows;
}

function summary(rows) {
  const u = [];
  let corners = 0;
  let outside = 0;
  let maxU = 0;
  let radial = 0;
  for (const r of rows) {
    if (!(r.total > 0)) continue;
    const a = r.up / r.total;
    const b = r.right / r.total;
    u.push(a, b);
    if (Math.abs(a) > 0.5 && Math.abs(b) > 0.5) corners++;
    if (Math.abs(a) > 1 + 1e-6 || Math.abs(b) > 1 + 1e-6) outside++;
    maxU = Math.max(maxU, Math.abs(a), Math.abs(b));
  }
  for (const r of rows) radial += r.up ** 2 + r.right ** 2;
  const bins = new Array(10).fill(0);
  for (const x of u) bins[Math.min(9, Math.floor((x + 1) * 5))]++;
  const meanAbs = u.reduce((s, x) => s + Math.abs(x), 0) / Math.max(1, u.length);
  // The largest gap between the empirical CDF of u and the uniform's.
  const sorted = [...u].sort((x, y) => x - y);
  let ks = 0;
  sorted.forEach((x, i) => { ks = Math.max(ks, Math.abs((i + 1) / sorted.length - (x + 1) / 2)); });
  return {
    n: rows.length, outside, maxU: r4(maxU), meanAbs: r4(meanAbs), corners: r4(corners / Math.max(1, rows.length)),
    ks: r4(ks), bins,
    maxOffset: r4(Math.max(0, ...rows.map(r => Math.max(Math.abs(r.up), Math.abs(r.right))))),
    // Root-mean-square angle off the line, degrees.
    rmsDeg: r4(Math.sqrt(radial / Math.max(1, rows.length)) * 0.01 * 180 / Math.PI),
  };
}

const out = { cases: {} };
for (const c of spec.cases) {
  const floor = floorRounds(c.stats, c.floorRounds ?? 2000);
  const held = burst(c.stats, c.burstSeconds ?? 3);
  out.cases[c.name] = {
    floor: summary(floor),
    floorTotal: r4(floor[0]?.total ?? 0),
    burst: { ...summary(held), totals: held.map(r => r.total), ticks: held.map(r => r.tick),
             maxTotal: r4(Math.max(0, ...held.map(r => r.total))) },
  };
}

// A bot on the Sherman's hull Browning: every round on one point of the square
// (AI-145), the AI term on the FireArms' own total.
{
  const browning = spec.cases.find(c => c.name === 'Browning')?.stats;
  const p = page(3);
  const g = mount(p, browning, { firer: 'bot-1' });
  p.bots.set('bot-1', { deviation: { aiPending: AI_TERM } });
  const q = muzzleFrame(g.group.muzzles[0]);
  const rows = [];
  for (let tick = 0; tick < 60; tick++) {
    g.state.step(TICK);
    p.guns.setFiring(g.group, true);
    const before = p.launched.length;
    p.guns.advance(TICK);
    for (const round of p.launched.slice(before)) {
      const o = offsets(round.v, q);
      rows.push({ tick, total: round.cone.total, uUp: o.up / round.cone.total, uRight: o.right / round.cone.total });
    }
  }
  // Two barrels of one pull: barrel i takes point i.
  const twin = mount(p, { ...browning, roundOfFire: 10 }, { barrels: 2, firer: 'bot-1' });
  const before = p.launched.length;
  twin.state.step(1);
  p.guns.fireShot(twin.group);
  const pull = p.launched.slice(before).map((round, i) => {
    const o = offsets(round.v, muzzleFrame(twin.group.muzzles[i]));
    return [r4(o.up / round.cone.total), r4(o.right / round.cone.total)];
  });
  out.bot = {
    first: rows[0] && { total: r4(rows[0].total), uUp: r4(rows[0].uUp), uRight: r4(rows[0].uRight) },
    spreadUp: r4(Math.max(...rows.map(r => r.uUp)) - Math.min(...rows.map(r => r.uUp))),
    spreadRight: r4(Math.max(...rows.map(r => r.uRight)) - Math.min(...rows.map(r => r.uRight))),
    n: rows.length,
    ticks: rows.map(r => r.tick),
    totals: rows.map(r => r4(r.total)),
    pull,
    points: BOT_DEVIATION_POINTS.slice(0, 2).map(([a, b]) => [r4(a), r4(b)]),
  };
}

// A coax that fires from the seat camera (`cameraLaunch`), the hull rolled
// 25 degrees: the square stands on the camera's own up and right.
{
  const coax = spec.cases.find(c => c.name === 'Coaxial_browning')?.stats;
  const p = page(5);
  const g = mount(p, { ...coax, fireInCameraDof: true }, { firer: 'bot-2', attitude: [0, 0.4, 0.44] });
  p.bots.set('bot-2', { deviation: { aiPending: 0 } });
  const camera = new THREE.Object3D();
  camera.position.set(0, 1.2, 0.3);
  g.hull.add(camera);
  g.hull.updateMatrixWorld(true);
  g.group.aimRay = cameraLaunch(g.node, camera);
  g.state.step(1);
  p.guns.fireShot(g.group);
  const round = p.launched.at(-1);
  const camQ = camera.getWorldQuaternion(new THREE.Quaternion());
  const own = offsets(round.v, camQ);
  // The same round against a frame built from the line and world up.
  const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camQ);
  const level = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(
    new THREE.Vector3(), dir, new THREE.Vector3(0, 1, 0)));
  const flat = offsets(round.v, level);
  const t = round.cone.total;
  out.camera = { total: r4(t), own: [r4(own.up / t), r4(own.right / t)], level: [r4(flat.up / t), r4(flat.right / t)] };
}

// The cross and the round: the vehicle HUD's deviation at the moment of a
// pull is the total the pull's round left in (DEV-12).
{
  const coax = spec.cases.find(c => c.name === 'Coaxial_browning')?.stats;
  const p = page(9);
  const g = mount(p, coax);
  const hud = createVehicleHud({
    replayAim: null, mannedActive: () => true, fireStateFor: n => p.states.get(n),
    occupancy: { activeHud: () => ({ crossHairType: 'CHTCrossHair' }), activeFireArmsNodes: () => [g.node],
                 isActiveRoot: () => false },
  });
  const pairs = [];
  for (let tick = 0; tick < 75; tick++) {
    g.state.step(TICK);
    p.guns.setFiring(g.group, tick < 60);
    const cross = hud.crosshairAim().deviation;
    const before = p.launched.length;
    p.guns.advance(TICK);
    for (const round of p.launched.slice(before)) pairs.push([r4(cross), r4(round.cone.total)]);
  }
  out.cross = { pairs, agree: pairs.every(([a, b]) => a === b) };
}

// A replayed round has no firer the page can name: it flies down its line.
{
  const browning = spec.cases.find(c => c.name === 'Browning')?.stats;
  const p = page(13);
  const g = mount(p, browning, { firer: null });
  const q = muzzleFrame(g.group.muzzles[0]);
  g.state.step(1);
  p.guns.fireShot(g.group);
  const o = offsets(p.launched.at(-1).v, q);
  out.replay = { up: r4(o.up), right: r4(o.right) };
}

// Without the hook (the model browser) a seat gun is as it was: no cone.
{
  const browning = spec.cases.find(c => c.name === 'Browning')?.stats;
  const p = page(17);
  p.guns.coneOf = null;
  const g = mount(p, browning);
  const q = muzzleFrame(g.group.muzzles[0]);
  g.state.step(1);
  p.guns.fireShot(g.group);
  const o = offsets(p.launched.at(-1).v, q);
  out.noHook = { up: r4(o.up), right: r4(o.right) };
}

process.stdout.write(JSON.stringify(out));
