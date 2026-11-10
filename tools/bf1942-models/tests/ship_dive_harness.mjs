// A submarine's dive through `viewer/ship.js`, headless (`test_ship_dive.py`).
//
// The hull is the recorded Daihatsu of `ship_law_daihatsu_wake.json.gz` (its
// table, Engine and rudders) with its four floaters swapped for eight of the
// Gato's: `GatoFloater` (`setHullHeight 3.3`, `setFloatMinLift 0.8275`,
// `setFloatMaxLift 1.6275`, a RotationalBundle on `c_PIPitch` with
// `setMinRotation 0/0/0`, `setMaxRotation 0/50/0`, `setMaxSpeed 0/2/0`,
// `setAcceleration 0/1/0` and no `setAutomaticReset`), typed in from
// `Objects/Vehicles/Sea/Gato/Physics.con`. SHIP-7 makes the dive depth a
// property of the floats alone (lift is an acceleration: `8 x 1.5 x 1.2275 =
// |g|` at `t = 0.5`), so the depth a hull settles at needs no Gato mass.
//
//   node ship_dive_harness.mjs <fixture.json.gz>
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VIEWER = path.join(HERE, '..', 'viewer');
const { installModuleHooks } = await import(path.join(HERE, '..', 'sim', 'env.mjs'));
installModuleHooks(VIEWER);
const imp = (name) => import(pathToFileURL(path.join(VIEWER, name)).href);
const THREE = await imp('vendor/three.module.js');
const { Ship } = await imp('ship.js');

const [fixturePath] = process.argv.slice(2);
const FIX = JSON.parse(zlib.gunzipSync(fs.readFileSync(fixturePath)).toString('utf8'));

const GATO_FLOATER = {
  templateKind: 'FloatingBundle', control: FIX.template,
  physics: { hullHeight: 3.3, floatMaxLift: 1.6275, floatMinLift: 0.8275 },
  rig: {
    axes: { pitch: { input: 'c_PIPitch', min: 0, max: 50, free: false, driver: 'position', maxSpeed: 2, direction: 1, acceleration: 1 } },
    automaticReset: false, control: FIX.template,
  },
};
const FLOAT_Y = -0.099;
const FLOAT_XZ = [[1.2, 2], [-1.2, 2], [1.2, -2.5], [-1.2, -2.5], [1.2, 0], [-1.2, 0], [1.2, 4], [-1.2, -4]];

function hullNode() {
  const root = new THREE.Object3D();
  root.name = FIX.template;
  root.userData = { templateKind: 'PlayerControlObject', control: FIX.template, physics: FIX.physics };
  for (const n of FIX.nodes) {
    if (n.userData?.templateKind === 'FloatingBundle') continue;
    const o = new THREE.Object3D();
    o.name = n.name;
    o.position.fromArray(n.position);
    o.quaternion.fromArray(n.quaternion);
    o.userData = { ...n.userData, name: n.name };
    root.add(o);
  }
  FLOAT_XZ.forEach(([x, z], i) => {
    const o = new THREE.Object3D();
    o.name = `GatoFloater_${i}`;
    o.position.set(x, FLOAT_Y, z);
    o.userData = { ...structuredClone(GATO_FLOATER), name: o.name };
    root.add(o);
  });
  root.updateMatrixWorld(true);
  return root;
}

function make() {
  const ship = new Ship(hullNode(), null, { cockpit: false, spec: FIX.spec, waterLevel: FIX.waterLevel });
  ship.autoFirstPerson = false;
  ship.groundHeight = () => -1e4;
  ship.state.position.set(0, FIX.waterLevel, 0);
  return ship;
}

/** The float plane's depth under the sea: `water + H - nodeY`, at `t`'s own
 *  reference (`body-float.js` `submersion`). */
const _arm = new THREE.Vector3();
const floatDepth = ship => {
  let sum = 0;
  for (const f of ship.floats) {
    _arm.copy(f.local).applyQuaternion(ship.state.orientation);
    sum += FIX.waterLevel + 3.3 - (ship.state.position.y + _arm.y);
  }
  return sum / ship.floats.length;
};

function drive(ship, seconds, inputs) {
  for (const [name, value] of Object.entries(inputs)) ship.setInput(name, value);
  const ticks = Math.round(seconds * 30);
  for (let i = 0; i < ticks; i++) ship.integrate(1 / 30);
}

const out = {};

// Asleep with no way on (TANK-21), then the key: a float whose angle term is
// not 0 wakes the root (SUB-7), so she goes down with no throttle.
{
  const ship = make();
  drive(ship, 6, { c_PIThrottle: 0, c_PIPitch: 0 });
  const asleepY = ship.state.position.y;
  const slept = ship.law.sleepiness;
  drive(ship, 5, { c_PIPitch: 1 });
  out.asleep = { slept, sleepiness: ship.law.sleepiness, setpoint: ship.diveSetpoint, moved: ship.state.position.y - asleepY };
}

// Stopped under water: no way on for a minute at her setpoint, she stays
// awake, and the other arrow brings her back to the surface.
{
  const ship = make();
  drive(ship, 6, { c_PIThrottle: 0, c_PIPitch: 0 });
  drive(ship, 6, { c_PIPitch: 1 });
  drive(ship, 60, { c_PIPitch: 0 });
  out.stoppedDeep = { setpoint: ship.diveSetpoint, depth: floatDepth(ship), sleepiness: ship.law.sleepiness };
  drive(ship, 10, { c_PIPitch: -1 });
  drive(ship, 60, { c_PIPitch: 0 });
  out.stoppedSurfaced = { setpoint: ship.diveSetpoint, depth: floatDepth(ship) };
}

// Under way: down to a setpoint, held, and back up.
{
  const ship = make();
  drive(ship, 6, { c_PIThrottle: 0.3, c_PIPitch: 0 });
  out.surface = { depth: floatDepth(ship), setpoint: ship.diveSetpoint };
  drive(ship, 6, { c_PIPitch: 1 });
  out.pressed = { setpoint: ship.diveSetpoint, angles: ship.floats.map(f => f.angle) };
  drive(ship, 60, { c_PIPitch: 0 });
  out.held = { setpoint: ship.diveSetpoint, depth: floatDepth(ship), vy: ship.state.velocity.y };
  drive(ship, 30, { c_PIPitch: 1 });
  out.bottomed = { setpoint: ship.diveSetpoint };
  drive(ship, 40, { c_PIPitch: -1 });
  drive(ship, 60, { c_PIPitch: 0 });
  out.surfaced = { setpoint: ship.diveSetpoint, depth: floatDepth(ship) };
}

// A ship with no trimmed float has no setpoint.
{
  const root = new THREE.Object3D();
  root.userData = { templateKind: 'PlayerControlObject', control: FIX.template, physics: FIX.physics };
  for (const n of FIX.nodes) {
    const o = new THREE.Object3D();
    o.name = n.name;
    o.position.fromArray(n.position);
    o.userData = { ...n.userData, name: n.name };
    root.add(o);
  }
  root.updateMatrixWorld(true);
  const ship = new Ship(root, null, { cockpit: false, spec: FIX.spec, waterLevel: FIX.waterLevel });
  out.daihatsu = { setpoint: ship.diveSetpoint };
}

process.stdout.write(JSON.stringify(out) + '\n');
