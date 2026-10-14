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
const samples = undersideSamples([quad], { size: [4, 4, 30], hullCentre: [0, 0] });
out.vertexCount = 4;
out.sampleCount = samples.length / 3;
const grid = [];
for (let i = 12; i < samples.length; i += 3) grid.push([samples[i], +samples[i + 1].toFixed(3), samples[i + 2]]);
out.gridXs = [...new Set(grid.map(p => p[0]))].sort((a, b) => a - b);
out.midship = grid.find(p => p[0] === 0 && Math.abs(p[2]) < 1e-9)?.[1] ?? null;
out.bow = grid.find(p => p[0] === 0 && p[2] === -15)?.[1] ?? null;
out.stern = grid.find(p => p[0] === 0 && p[2] === 15)?.[1] ?? null;
out.none = undersideSamples([], {});

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
process.stdout.write(JSON.stringify(out));
