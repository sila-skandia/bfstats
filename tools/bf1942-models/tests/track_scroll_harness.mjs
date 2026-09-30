// Drives `viewer/track-scroll.js` (and the drives that call it) under node and
// prints one JSON blob for `tests/test_track_scroll.py`.
//
// The modules are imported from the viewer tree in place through
// `sim/env.mjs`'s hooks (`three` resolves to the vendored build), so the files
// under test are the files the page loads.
//
// The tank is a Sherman as the level bakes it (`ground_harness.mjs`'s
// `shermanNode`, transcribed off Wake's scene.glb): each belt an
// `AnimatedBundle` under the Engine at x = -/+0.01 with its road wheels a
// metre out, plus one Mesh a belt with the material the exporter shares
// between both belts.

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { installModuleHooks, viewerDir } from '../sim/env.mjs';

const viewer = viewerDir();
installModuleHooks(viewer);
const imp = name => import(pathToFileURL(path.join(viewer, name)).href);
const [THREE, scroll, { TrackedVehicle }, { EngineState }] = await Promise.all([
  imp('vendor/three.module.js'), imp('track-scroll.js'), imp('tracked-vehicle.js'), imp('ground-engine.js'),
]);
const {
  TRACK_VISUAL_HZ, trackBelts, beltsOf, engineBeltRate, motionBeltRate, bodyMotion, motionBetween,
  advanceBelts, scrollBeltsByEngine, scrollBeltsByMotion, presentBelts,
} = scroll;

const results = {};
const r = (v, p = 1e6) => Math.round(v * p) / p;

function spring(name, parent, pos, grip, strength, damping) {
  const node = new THREE.Object3D();
  node.name = name;
  node.position.set(...pos);
  node.userData = { templateKind: 'Spring', physics: { grip, strength, damping } };
  parent.add(node);
  return node;
}

/** One shared material with a map, as GLTFLoader hands both belts one. */
function sharedBeltMaterial() {
  const map = new THREE.Texture();
  map.name = 'Sherman_Track';
  const material = new THREE.MeshLambertMaterial({ map });
  // A page's shading hook on the instance, which `clone()` drops.
  material.onBeforeCompile = () => {};
  material.customProgramCacheKey = () => 'bf-test';
  return material;
}

function shermanNode({ material = sharedBeltMaterial(), engineType = 'c_ETTank', speed = [0.006, 0] } = {}) {
  const root = new THREE.Object3D();
  root.name = 'Sherman';
  root.userData = {
    control: 'Sherman', templateKind: 'PlayerControlObject',
    physics: { mass: 25000, drag: 2, vehicleCategory: 'VCLand' },
  };
  const complex = new THREE.Object3D(); complex.name = 'ShermanComplex'; root.add(complex);
  const engine = new THREE.Object3D();
  engine.name = 'ShermanEngine';
  engine.userData = {
    templateKind: 'Engine',
    physics: {
      engineType, torque: 4, differential: 4, numberOfGears: 5,
      gearUp: 0.95, gearDown: 0.45, gearChangeTime: 0.05,
      maxRotation: [1, 0, 1], maxSpeed: [4, 0, 10], acceleration: [4, 0, 10],
    },
    rig: {
      control: 'Sherman', automaticReset: true,
      axes: {
        yaw: { input: 'c_PIYaw', min: -1, max: 1, free: false, driver: 'position', maxSpeed: 4, direction: 1 },
        roll: { input: 'c_PIThrottle', min: -1, max: 1, free: false, driver: 'position', maxSpeed: 10, direction: 1 },
      },
    },
  };
  complex.add(engine);
  const belts = {};
  for (const [side, x, wx] of [['L', -0.009, -0.999], ['R', 0.01, 1]]) {
    const track = new THREE.Object3D();
    track.name = `ShermanTrack${side}`;
    track.position.set(x, -0.799, 0);
    track.userData = { templateKind: 'AnimatedBundle', animatedTextureSpeed: speed };
    engine.add(track);
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
    mesh.name = `ShermanTrack${side}_mesh`;
    track.add(mesh);
    spring(`ShermanWheel${side}3Dummy`, track, [wx, 0.12, -2.05], 'c_PGFEngineDummyGrip', 0, 0);
    spring(`ShermanWheel${side}3`, track, [wx, 0.12, -1.2], 'c_PGFEngineGrip', 18, 4);
    spring(`ShermanWheel${side}3b`, track, [wx, 0.12, 1.249], 'c_PGFEngineGrip', 18, 4);
    spring(`ShermanWheel${side}3Dummy3`, track, [wx, 0.12, 2.049], 'c_PGFEngineDummyGrip', 0, 0);
    belts[side] = { track, mesh };
  }
  // A scrolling bundle NOT under an Engine: the engine gives it rate 0.
  const stray = new THREE.Object3D();
  stray.name = 'StrayBelt';
  stray.userData = { templateKind: 'AnimatedBundle', animatedTextureSpeed: [0.01, 0] };
  complex.add(stray);
  return { root, engine, belts, material };
}

// --- collection ---------------------------------------------------------------
{
  const { root, belts, material } = shermanNode();
  const found = trackBelts(root);
  const again = trackBelts(root);
  const L = found.find(b => b.node.name === 'ShermanTrackL');
  const R = found.find(b => b.node.name === 'ShermanTrackR');
  results.collect = {
    names: found.map(b => b.node.name),
    sideL: L.side, sideR: R.side,
    lateralL: r(L.lateral, 1e3), lateralR: r(R.lateral, 1e3),
    speed: L.speed,
    // Each belt got its own material and map; the shared one is untouched.
    ownMaterials: belts.L.mesh.material !== material && belts.R.mesh.material !== material
      && belts.L.mesh.material !== belts.R.mesh.material,
    ownMaps: belts.L.mesh.material.map !== material.map && belts.L.mesh.material.map !== belts.R.mesh.material.map,
    sameImage: belts.L.mesh.material.map.source === material.map.source,
    keptHooks: belts.L.mesh.material.onBeforeCompile === material.onBeforeCompile
      && belts.L.mesh.material.customProgramCacheKey === material.customProgramCacheKey,
    // A wheel is its own part: its material (none here) is never touched,
    // and the second walk reuses the first's clones.
    sameBeltsTwice: again[0] === found[0] && again[1] === found[1],
    cached: beltsOf(root) === beltsOf(root),
  };
}

// --- the engine's rate: ratio * diffRPM(side) --------------------------------
{
  const tank = new EngineState({ engineType: 'c_ETTank', differential: 4, numberOfGears: 5 });
  tank.gear = 1;
  tank.revs = 1;
  tank.steer = 0;
  const straight = [engineBeltRate(tank, -0.009), engineBeltRate(tank, 0.01)];
  tank.steer = 0.5;
  const right = [engineBeltRate(tank, -0.009), engineBeltRate(tank, 0.01)];
  tank.revs = 0;
  const stopped = [engineBeltRate(tank, -0.009), engineBeltRate(tank, 0.01)];
  tank.revs = 1.2;
  tank.steer = 0;
  const overrev = [engineBeltRate(tank, -0.009), engineBeltRate(tank, 0.01)];
  tank.revs = 1;
  const centred = engineBeltRate(tank, 0);
  const car = new EngineState({ engineType: 'c_ETCar', differential: 4, numberOfGears: 5 });
  car.gear = 1;
  car.revs = 1.2;
  car.steer = 0.5;
  const carRates = [engineBeltRate(car, -1), engineBeltRate(car, 1)];
  results.engineRate = {
    ratio: r(tank.ratio), straight: straight.map(v => r(v)), right: right.map(v => r(v)),
    stopped, overrev: overrev.map(v => r(v)), centred: r(centred), car: carRates.map(v => r(v)),
    none: engineBeltRate(null, 1),
  };
}

// --- the step -----------------------------------------------------------------
{
  const belt = () => {
    const map = new THREE.Texture();
    map.offset.set(0.25, 0);
    return { speed: [0.006, 0], side: 1, lateral: 1, offset: [0, 0], step: [0, 0], maps: [{ map, base: [0.25, 0] }] };
  };
  const one = belt();
  advanceBelts([one], 1 / 30, () => 10);
  const halves = belt();
  advanceBelts([halves], 1 / 60, () => 10);
  advanceBelts([halves], 1 / 60, () => 10);
  const frozen = belt();
  advanceBelts([frozen], 1 / 30, () => 0);
  advanceBelts([frozen], 0, () => 10);
  advanceBelts([frozen], -1, () => 10);
  const back = belt();
  advanceBelts([back], 1 / 30, () => -10);
  const long = belt();
  for (let i = 0; i < 30 * 600; i++) advanceBelts([long], 1 / 30, () => 15);
  results.step = {
    hz: TRACK_VISUAL_HZ,
    one: r(one.maps[0].map.offset.x), oneOffset: r(one.offset[0]),
    halves: r(halves.maps[0].map.offset.x),
    frozen: frozen.maps[0].map.offset.x,
    back: r(back.maps[0].map.offset.x),
    longOffset: long.offset[0],
    longMap: long.maps[0].map.offset.x,
  };
}

// --- motion -------------------------------------------------------------------
{
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
  // Yawed 90 degrees left, forward is -X; 5 m/s that way, turning left at 0.5 rad/s.
  const m = bodyMotion(q, new THREE.Vector3(-5, 0, 0), new THREE.Vector3(0, 0.5, 0));
  const pivotRates = [motionBeltRate(0, 0.5, -1), motionBeltRate(0, 0.5, 1)];
  const q0 = new THREE.Quaternion();
  const q1 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.05);
  const between = motionBetween(new THREE.Vector3(0, 0, 0), q0,
    new THREE.Vector3(0, 0, -0.5), q1, 0.1);
  const still = motionBetween(new THREE.Vector3(1, 2, 3), q0, new THREE.Vector3(1, 2, 3), q0, 0);
  results.motion = {
    forward: r(m.forward), yawRate: r(m.yawRate), pivot: pivotRates,
    betweenForward: r(between.forward, 1e4), betweenYaw: r(between.yawRate, 1e4),
    still,
  };
}

// --- the drives: a TrackedVehicle integrated, and presented -------------------
{
  const { root, belts } = shermanNode();
  const truck = new TrackedVehicle(root, null, { cockpit: false, groundHeight: () => 0 });
  truck.state.position.set(0, 0.6, 0);
  const offs = () => [belts.L.mesh.material.map.offset.x, belts.R.mesh.material.map.offset.x];
  // Parked: nobody integrates it, and an idle engine scrolls nothing.
  for (let i = 0; i < 30; i++) truck.integrate(1 / 30);
  const idle = offs();
  truck.setInput('c_PIThrottle', 1);
  for (let i = 0; i < 60; i++) truck.integrate(1 / 30);
  const driven = offs();
  const revs = truck.engine.revs;
  // Drawn between its last two ticks: half way back through the last step,
  // then the tick itself again. A root nobody stepped draws nothing.
  const belt = beltsOf(root)[0];
  const lastStep = belt.step[0];
  presentBelts(root, 0.5);
  const half = offs()[0];
  presentBelts(root, 1);
  const whole = offs()[0];
  presentBelts(new THREE.Object3D(), 0.5);
  results.presentAlpha = { lastStep: r(lastStep), half: r(half), whole: r(whole), tick: r(driven[0]) };
  // Hard right on the move: the left belt runs faster than the right.
  const before = offs();
  truck.setInput('c_PIYaw', 1);
  for (let i = 0; i < 30; i++) truck.integrate(1 / 30);
  const turned = offs();
  results.drive = {
    idle: idle.map(v => r(v)),
    driven: driven.map(v => r(v)),
    revs: r(revs),
    turnL: r(turned[0] - before[0]), turnR: r(turned[1] - before[1]),
  };
}
{
  const { root, belts } = shermanNode();
  const truck = new TrackedVehicle(root, null, { cockpit: false, groundHeight: () => 0 });
  const s = truck.state;
  s.position.set(0, 0.6, 0);
  // A replay pivots it left on the spot: the belts run against each other.
  s.velocity.set(0, 0, 0);
  s.angularVelocity.set(0, 0.8, 0);
  truck.presentKinematic(1 / 30, 0, true);
  const pivot = [belts.L.mesh.material.map.offset.x, belts.R.mesh.material.map.offset.x];
  // ...and drives it straight at 8 m/s: both the same way, the same amount.
  s.angularVelocity.set(0, 0, 0);
  s.velocity.set(0, 0, -8);
  const b0 = [belts.L.mesh.material.map.offset.x, belts.R.mesh.material.map.offset.x];
  truck.presentKinematic(1 / 30, 0, true);
  const b1 = [belts.L.mesh.material.map.offset.x, belts.R.mesh.material.map.offset.x];
  results.present = {
    pivotL: r(pivot[0]), pivotR: r(pivot[1]),
    straightL: r(b1[0] - b0[0]), straightR: r(b1[1] - b0[1]),
  };
}
{
  // A room's remote replica: no drive, only poses, 0.1 s apart.
  const { root, belts } = shermanNode();
  const group = new THREE.Group();
  group.add(root);
  const m = motionBetween(new THREE.Vector3(0, 0, 0), new THREE.Quaternion(),
    new THREE.Vector3(0, 0, -1), new THREE.Quaternion(), 0.1);
  scrollBeltsByMotion(group, m, 0.1);
  results.remote = {
    forward: r(m.forward), L: r(belts.L.mesh.material.map.offset.x), R: r(belts.R.mesh.material.map.offset.x),
  };
  // A hull whose Engine the caller has not got: nothing moves.
  scrollBeltsByEngine(group, null, 0.1);
  results.remote.afterNullEngine = r(belts.L.mesh.material.map.offset.x);
}

process.stdout.write(JSON.stringify(results));
