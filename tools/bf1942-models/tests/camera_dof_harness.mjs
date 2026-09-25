// Drives `viewer/camera-dof.js` outside a browser and prints one JSON blob:
// which guns fire from the seat's camera (`fireInCameraDof`, lnxded
// `FireArms::Fire` 0x0828a1c1) and which Camera node that is. The module
// imports nothing, so plain node loads it from the viewer tree in place.

import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const viewer = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../viewer');
const { firesFromCamera, seatCameraOf } = await import(pathToFileURL(path.join(viewer, 'camera-dof.js')).href);

/** A scene-graph node with just what `seatCameraOf` reads. */
function node(name, userData = {}, children = []) {
  const n = { name, userData, children, parent: null };
  for (const c of children) c.parent = n;
  n.traverse = fn => { fn(n); for (const c of n.children) c.traverse(fn); };
  return n;
}

// The T-34 as the level bake has it: the coax and the camera under the gun
// base, the whole under the root PCO; a second PCO (a hull MG seat) with its
// own camera beside them.
const coax = node('Coaxial_MG42_1', { templateKind: 'FireArms', control: 'T34' });
const barrel = node('T34GunBarrel', { templateKind: 'FireArms', control: 'T34' });
const camera = node('T34Camera', { templateKind: 'Camera', control: 'T34' });
const hullMg = node('MG42', { templateKind: 'FireArms', control: 'T34_PCO1' });
const hullCam = node('T34Camera2', { templateKind: 'Camera', control: 'T34_PCO1' });
const gunBase = node('T34GunBase', { templateKind: 'RotationalBundle', control: 'T34' }, [barrel, coax, camera]);
const pco1 = node('T34_PCO1', { templateKind: 'PlayerControlObject', control: 'T34_PCO1' }, [hullMg, hullCam]);
node('T34', { templateKind: 'PlayerControlObject', control: 'T34' }, [gunBase, pco1]);
const orphan = node('Browning', { templateKind: 'FireArms', control: 'vehicle' });

const out = {
  fires: {
    coaxBaked: firesFromCamera(null, 'Coaxial_MG42_1'),
    coaxModel: firesFromCamera({}, 'Coaxial_MG42'),
    shermanCoax: firesFromCamera({}, 'Coaxial_browning'),
    pintle: firesFromCamera({}, 'MG42_2'),
    t34Cannon: firesFromCamera({}, 'T34GunBarrel'),
    tigerCannon: firesFromCamera({}, 'TigerGunBarrel_1'),
    shermanCannon: firesFromCamera({}, 'ShermanGunBarrel'),
    wingGuns: firesFromCamera({}, 'BF109Guns'),
    grantGun: firesFromCamera({}, 'M3GrantGun'),
    declaredOn: firesFromCamera({ fireInCameraDof: true }, 'T34GunBarrel'),
    declaredOff: firesFromCamera({ fireInCameraDof: false }, 'Coaxial_MG42'),
    unnamed: firesFromCamera({}, null),
  },
  camera: {
    coax: seatCameraOf(coax)?.name ?? null,
    hullMg: seatCameraOf(hullMg)?.name ?? null,
    orphan: seatCameraOf(orphan)?.name ?? null,
  },
};
console.log(JSON.stringify(out));
