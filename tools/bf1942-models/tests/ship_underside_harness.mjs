// A ship grounds on its own col0 underside, not on its collision box's
// bottom face (`ship.js` `undersideSamples`, `Ship.useHullUnderside`).
// Copied beside `ship.mjs` by `test_ship_underside.py`, as `test_ship.py`
// does with `ship_harness.mjs`.
import * as THREE from 'three';
import { Ship, undersideSamples } from './ship.mjs';

// A 30 m boat whose box is 4 m deep (keel 2 m under the origin) and whose
// col0 underside is a quad sloping from 1.5 m deep at the bow (z -15) to
// 0.7 m at the stern (z +15), 3 m wide: an FHSW PT boat's shape, roughly.
const quad = {
  vertices: [-1.5, -1.5, -15, 1.5, -1.5, -15, 1.5, -0.7, 15, -1.5, -0.7, 15],
  faces: [0, 1, 2, 0, 2, 3],
};

const out = {};
const samples = undersideSamples([quad]);
out.sampleCount = samples.length / 3;
out.sternY = Math.max(...[1, 4, 7, 10].map(i => samples[i]));
out.few = undersideSamples([{ vertices: [0, -1, 0, 1, -1, 0, 0, -1, 1] }]).length / 3;
out.none = undersideSamples([]);

const hull = new THREE.Object3D();
hull.name = 'Boat';
hull.userData = { templateKind: 'PlayerControlObject', control: 'Boat',
  physics: { mass: 40000, drag: 0.44, vehicleCategory: 'VCSea' } };
const body = new THREE.Mesh(new THREE.BoxGeometry(4, 4, 30));
hull.add(body);
hull.position.set(0, 10, 0);
const scene = new THREE.Scene();
scene.add(hull);
scene.updateMatrixWorld(true);
const ship = new Ship(hull, scene, { waterLevel: 11, cockpit: false });
ship.autoFirstPerson = false;
// The box `ship-spec.js` measures off a real hull's tree, set here directly.
ship.spec.size = [4, 4, 30];
ship.spec.hullCentre = [0, 0];
ship.keel = -2;
// A shelf under the stern half at 8.9: 1.1 m under the origin, inside the
// box (2 m deep) but under the col0 stern (0.7 to 1.1 m deep over it).
ship.groundHeight = (_x, z) => (z > 0 ? 8.9 : 0);
const box = ship.deepestContact();
out.box = box ? +box.depth.toFixed(3) : null;
ship.useHullUnderside([quad]);
const col0 = ship.deepestContact();
out.col0 = col0 ? +col0.depth.toFixed(3) : null;
// A shelf that does reach the col0 stern still grounds her.
ship.groundHeight = (_x, z) => (z > 0 ? 9.5 : 0);
const shoal = ship.deepestContact();
out.shoal = shoal ? +shoal.depth.toFixed(3) : null;
// More than ten vertices: a rise under the middle alone, with bow and stern
// both more than R over the bed, is never tested (`clearOfTheBed`).
const long = { vertices: [] };
for (let k = 0; k < 12; k++) long.vertices.push(0, -1.5, -15 + k * (30 / 11));
ship.useHullUnderside([long]);
ship.groundHeight = (_x, z) => (Math.abs(z) < 3 ? 9.0 : 0);
const pre = ship.deepestContact();
out.midRiseSkipped = pre === null;
ship.groundHeight = (_x, z) => (Math.abs(z) < 3 ? 9.0 : 7.0);
const near = ship.deepestContact();
out.midRiseNearBed = near ? +near.depth.toFixed(3) : null;
process.stdout.write(JSON.stringify(out));
