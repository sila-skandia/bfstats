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
const degrees = (vehicle, input, axis = 'roll') => {
  const spec = vehicle.servoAxes().get(`SU122/${input}/${axis}`);
  return axisAngle(spec, vehicle.state.surfaces.get(`SU122/${input}/${axis}`) ?? 0);
};
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
process.stdout.write(JSON.stringify({ land: run(land, steps), air: run(air, steps) }));
