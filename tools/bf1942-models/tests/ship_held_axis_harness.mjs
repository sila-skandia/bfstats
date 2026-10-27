// A floating ship's own held key parts (GUN-2) under the server's tick law.
//
// FHSWEurope's Hamakaze and HMS_Laforey carry their front gun's round selector
// and its HUD needle on the root seat, rolled by the arrows (`c_PIPitch`):
// `HamakazeCannon_Invis_GunSelector` -180..0 and `Shipgun_AmmoNeedle_Rot`
// -90..0, neither `setAutomaticReset`. The root seat's rig leaves them to the
// drive (`vehicle-occupancy.js` `rigFor`), and the drive is `ship.js`
// `#integrateLaw`, whose `shipTick` turned only the Engine and the rudders: the
// parts never moved while she floated (`veh.selector-dead`, 2026-10-28).
//
// This builds the lab Daihatsu from `fixtures/ship_law_daihatsu_wake.json.gz`
// (the same hull `ship_law_harness.mjs` replays), hangs the Hamakaze's two
// parts on it as extracted, holds ArrowDown, lets go, holds ArrowUp, and
// reports each part's roll at every step, with the hull's pose beside the same
// run without the parts (the parts must not move the hull).
//
//   node ship_held_axis_harness.mjs <fixture.json.gz>
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

/** The two parts as `models/mods/fhsweurope/Hamakaze.glb` carries them. */
const held = (min) => ({
  templateKind: 'RotationalBundle', control: FIX.template,
  rig: { axes: { roll: { input: 'c_PIPitch', min, max: 0, free: false, driver: 'position',
    maxSpeed: 900000, direction: 1, acceleration: 90000000 } },
  automaticReset: false, control: FIX.template },
});
const PARTS = { GunSelector: held(-180), AmmoNeedle_Rot: held(-90) };

function make(withParts) {
  const root = new THREE.Object3D();
  root.name = FIX.template;
  root.userData = { templateKind: 'PlayerControlObject', control: FIX.template, physics: FIX.physics };
  for (const n of FIX.nodes) {
    const o = new THREE.Object3D();
    o.name = n.name;
    o.position.fromArray(n.position);
    o.quaternion.fromArray(n.quaternion);
    o.userData = { ...n.userData, name: n.name };
    root.add(o);
  }
  if (withParts) {
    for (const [name, userData] of Object.entries(PARTS)) {
      const o = new THREE.Object3D();
      o.name = name;
      o.position.set(0, 2, -3);
      o.userData = { ...userData, name };
      root.add(o);
    }
  }
  root.updateMatrixWorld(true);
  const ship = new Ship(root, null, { cockpit: false, spec: FIX.spec, waterLevel: FIX.waterLevel });
  ship.autoFirstPerson = false;
  ship.underside = Float32Array.from(FIX.underside);
  ship.sampleKeel = FIX.sampleKeel;
  // Deep water: the law's own tick, never the beaching model.
  ship.groundHeight = () => FIX.waterLevel - 500;
  ship.state.position.set(0, FIX.waterLevel, 0);
  return { ship, root };
}

const rollOf = (o) => +(new THREE.Euler().setFromQuaternion(o.quaternion, 'YXZ').z * 180 / Math.PI).toFixed(2);

function run(withParts) {
  const { ship, root } = make(withParts);
  const trace = [];
  const steps = [['rest', 0, 10], ['down', -1, 15], ['released', 0, 15], ['up', 1, 15], ['released2', 0, 15]];
  for (const [label, pitch, ticks] of steps) {
    ship.setInput('c_PIPitch', pitch);
    for (let i = 0; i < ticks; i++) ship.integrate(1 / 30);
    const row = { label, law: !!ship.law && !ship._beached };
    for (const name of Object.keys(PARTS)) {
      const o = root.getObjectByName(name);
      if (o) row[name] = rollOf(o);
    }
    row.position = ship.state.position.toArray().map(v => +v.toFixed(6));
    trace.push(row);
  }
  return trace;
}

console.log(JSON.stringify({ withParts: run(true), bare: run(false) }));
