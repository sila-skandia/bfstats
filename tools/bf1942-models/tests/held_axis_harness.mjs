// `viewer/vehicle-base.js`: a RotationalBundle that is not `setAutomaticReset`
// keeps the angle its key left it at (GUN-2), as FH's ammo selectors need; a
// stick surface still centres, and an aircraft's key channels keep the servo.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { installModuleHooks, viewerDir } from '../sim/env.mjs';

const viewer = viewerDir();
installModuleHooks(viewer);
const THREE = await import(pathToFileURL(path.join(viewer, 'vendor', 'three.module.js')).href);
const { Vehicle, axisAngle } = await import(pathToFileURL(path.join(viewer, 'vehicle-base.js')).href);

// The SU-122's selector and a surface on the same key, the surface centring.
const selector = { axes: { roll: { input: 'c_PIPitch', min: -180, max: 0, free: false, driver: 'position',
  maxSpeed: 900000, direction: 1, acceleration: 90000000 } }, automaticReset: false, control: 'SU122' };
const flap = { axes: { roll: { input: 'c_PIRoll', min: -20, max: 20, free: false, driver: 'position',
  maxSpeed: 60, direction: 1, acceleration: 60 } }, automaticReset: true, control: 'SU122' };
function hull() {
  const root = new THREE.Group();
  root.name = 'SU122';
  root.userData = { control: 'SU122' };
  const a = new THREE.Group(); a.name = 'SU122GunSelector';
  a.userData = { templateKind: 'RotationalBundle', rig: selector };
  const b = new THREE.Group(); b.name = 'Flap';
  b.userData = { templateKind: 'RotationalBundle', rig: flap };
  root.add(a, b);
  return root;
}
// Each part's angle through its own servo entry (`Vehicle.servoKey`): a held
// part has one of its own.
const angleOf = (vehicle, name, axis) => {
  const part = vehicle.parts.find(p => p.node.name === name);
  const spec = part.axes[axis];
  const key = vehicle.servoKey(part, axis, spec);
  return axisAngle(spec, vehicle.state.surfaces.get(key) ?? 0);
};
const degrees = (vehicle, input) =>
  angleOf(vehicle, input === 'c_PIPitch' ? 'SU122GunSelector' : 'Flap', 'roll');
const run = (vehicle, steps) => {
  const out = [];
  for (const [pitch, roll, seconds] of steps) {
    vehicle.setInput('c_PIPitch', pitch);
    vehicle.setInput('c_PIRoll', roll);
    for (let t = 0; t < seconds; t += 1 / 30) vehicle.advanceSurfaces(1 / 30);
    out.push([+degrees(vehicle, 'c_PIPitch').toFixed(1), +degrees(vehicle, 'c_PIRoll').toFixed(1)]);
  }
  return out;
};
const steps = [[-1, 1, 0.5], [0, 0, 1], [1, 0, 0.1], [0, 0, 1], [-1, 0, 0.05], [0, 0, 1]];
const land = new Vehicle(hull(), null, { cockpit: false });
const air = new Vehicle(hull(), null, { cockpit: false });
air.holdsKeyAxes = false;

// An FH horse (FHSW `Cavalry_Arisaka`): the free `Horse_wheelshake` claims the
// `c_PIThrottle` pitch entry first, then the held legs on the same key. A held
// leg keeps its own register: S takes `horse_leg_FL1_rot0` (0..20, a negative
// acceleration) to 20 and it stays there on release, and `horse_leg_FR1_rot0`
// (-10..0) to its own bound; the wheelshake still follows the key.
function horse() {
  const root = new THREE.Group();
  root.name = 'Cavalry_Arisaka';
  root.userData = { control: 'Cavalry_Arisaka' };
  const part = (name, axes, automaticReset = false) => {
    const n = new THREE.Group(); n.name = name;
    n.userData = { templateKind: 'rotationalbundle', rig: { axes, automaticReset, control: 'Cavalry_Arisaka' } };
    root.add(n);
  };
  part('Horse_wheelshake', { pitch: { input: 'c_PIThrottle', min: null, max: null, free: true, driver: 'position',
    maxSpeed: 900, direction: 1, acceleration: 1000 } });
  part('horse_leg_FL1_rot0', { pitch: { input: 'c_PIThrottle', min: 0, max: 20, free: false, driver: 'position',
    maxSpeed: 450, direction: -1, acceleration: 1000 } });
  part('horse_leg_FR1_rot0', { pitch: { input: 'c_PIThrottle', min: -10, max: 0, free: false, driver: 'position',
    maxSpeed: 450, direction: 1, acceleration: 1000 } });
  return root;
}
const legs = new Vehicle(horse(), null, { cockpit: false });
const gait = [];
for (const [throttle, seconds] of [[-1, 0.5], [0, 1], [1, 0.5], [0, 1]]) {
  legs.setInput('c_PIThrottle', throttle);
  for (let t = 0; t < seconds; t += 1 / 30) legs.advanceSurfaces(1 / 30);
  gait.push(['horse_leg_FL1_rot0', 'horse_leg_FR1_rot0', 'Horse_wheelshake']
    .map(name => +angleOf(legs, name, 'pitch').toFixed(1)));
}
process.stdout.write(JSON.stringify({ land: run(land, steps), air: run(air, steps), horse: gait }));
