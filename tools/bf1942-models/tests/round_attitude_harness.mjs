// A round whose motor and fins sit on its centre of mass keeps its launch
// attitude, its motor pushes along the Engine's own row and its fins push by
// the aircraft's wing law (`viewer/rocket-motor.js`, `projectile-flight.js`
// `motorAxis`; FHSW's Norden bombs). Modules load in place through the
// runner's hooks (`sim/env.mjs`). Run by `tests/test_round_attitude.py`.

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { installModuleHooks, viewerDir } from '../sim/env.mjs';

const viewer = viewerDir();
installModuleHooks(viewer);
const imp = name => import(pathToFileURL(path.join(viewer, name)).href);
const [THREE, motor, { calculateLift }, { motorAxis }] = await Promise.all([
  import('three'), imp('rocket-motor.js'), imp('aircraft.js'), imp('projectile-flight.js'),
]);

const out = {};
const round = v => +v.toFixed(4);

// The round's copy of the wing law against the aircraft's.
const cases = [];
for (const [v, up, coeff] of [
  [[0, 0, -100], [0, 0.5, -0.866], 1.5],
  [[0, -40, -90], [0, 1, 0], 1.5],
  [[3, -150, -20], [0, 0.5, -0.866], 0.3],
  [[0, 0, -10], [0.6, 0.8, 0], 2.0],
]) {
  const ours = motor.wingLift(...v, ...up, coeff);
  const theirs = calculateLift(new THREE.Vector3(...v), new THREE.Vector3(...up), coeff);
  cases.push([round(ours), round(theirs)]);
}
out.lift = cases;
out.ceiling = round(motor.wingPush(0, 0, -100, 0, 0.5, -0.866, 1.5, 1200, -Infinity));
out.submerged = round(motor.wingPush(0, -5, 0, 0, 1, 0, 1.5, -1, 0) / motor.wingPush(0, -5, 0, 0, 1, 0, 1.5, 0, -Infinity));

const NORDEN = { parts: [
  { template: 'NordenBomb_Engine', kind: 'Engine', position: [0, 0, 0], rotation: [0, 30, 0],
    engineType: 'c_ETRocket', torque: 20, differential: 20 },
  { template: 'NordenBomb_wing', kind: 'Wing', position: [0, 0, 0], rotation: [0, 60, 0],
    wingLift: 0, flapLift: 1 },
] };
const FINNED = { parts: [{ template: 'Bomb_wing', kind: 'Wing', position: [0, 0, 1.2], wingLift: 0.2 }] };
out.onCentre = { norden: motor.partsOnCentre(NORDEN), finned: motor.partsOnCentre(FINNED),
  bare: motor.partsOnCentre({ parts: [] }) };
out.wings = motor.roundWingsOf(NORDEN, 14.7295379).map(w => ({ ...w, coeff: round(w.coeff) }));

// The motor's own row: 30 degrees under a level nose, in the round's held
// attitude or under its flight path.
const m = new motor.RocketMotor(NORDEN.parts[0]);
out.pitch = m.pitch;
const level = new THREE.Quaternion();
out.heldAxis = motorAxis(m, null, new THREE.Vector3(), level).toArray().map(round);
const yawed = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
out.heldAxisYawed = motorAxis(m, null, new THREE.Vector3(), yawed).toArray().map(round);
out.pathAxis = motorAxis(m, new THREE.Vector3(0, 0, -1), new THREE.Vector3()).toArray().map(round);
const plain = new motor.RocketMotor({ kind: 'Engine', engineType: 'c_ETRocket' });
out.plainAxis = motorAxis(plain, new THREE.Vector3(0, -0.6, -0.8), new THREE.Vector3()).toArray().map(round);

process.stdout.write(JSON.stringify(out));
