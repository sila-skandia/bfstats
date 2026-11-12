// The `EngineTemplate` constructor defaults an engine keeps when its `.con`
// omits `setDifferential`, `setTorque` or `setNoPropellerEffectAtSpeed`
// (lnxded `0x0823f230`: 10, 60, 100), through each table that reads an
// engine: `aircraftSpec`, `shipSpec` and `VectoredEngine`. Driven by
// `test_engine_defaults.py`.
import * as THREE from 'three';
import { aircraftSpec } from './aircraft.js';
import { shipSpec } from './ship-spec.js';
import { VectoredEngine } from './vectored-engines.js';

function root(name, engineType) {
  const r = new THREE.Object3D();
  r.name = name;
  r.userData = { templateKind: 'PlayerControlObject', control: name,
                 physics: { mass: 2000, drag: 0.1, inertiaModifier: [1, 1, 1] } };
  const hull = new THREE.Mesh(new THREE.BoxGeometry(4, 2, 8));
  hull.userData = { templateKind: 'Bundle' };
  r.add(hull);
  const engine = new THREE.Object3D();
  engine.name = `${name}Engine`;
  // Nothing but the type: every other word is left to the constructor.
  engine.userData = { templateKind: 'Engine', control: name, physics: { engineType } };
  r.add(engine);
  return r;
}

const plane = aircraftSpec(root('Bare', 'c_ETPlane'));
const ship = shipSpec(root('BareBoat', 'c_ETShip'));
const vectored = new VectoredEngine({ id: 'bare' });
const pick = e => ({ differential: e.differential, torque: e.torque,
                     noPropellerEffectAtSpeed: e.noPropellerEffectAtSpeed });
console.log(JSON.stringify({
  plane: pick(plane.engines[0]),
  ship: pick(ship.engines[0]),
  vectored: { ratio: vectored.ratio, torque: vectored.torque, fadeSpeed: vectored.fadeSpeed },
}));
