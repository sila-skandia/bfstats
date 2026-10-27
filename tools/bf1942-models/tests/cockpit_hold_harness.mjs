// The Inside view takes a seat's exterior away before its interior lands
// (ledger LOD-2; vehicle-base.js `holdExterior`). One JSON report on stdout;
// `tests/test_cockpit_hold.py` asserts on it.

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { installModuleHooks, viewerDir } from '../sim/env.mjs';

const viewer = viewerDir();
installModuleHooks(viewer);
const imp = name => import(pathToFileURL(path.join(viewer, name)).href);
const [THREE, { Vehicle, insideViewExterior }] = await Promise.all([
  imp('vendor/three.module.js'), imp('vehicle-base.js'),
]);

const node = (name, userData = {}, children = []) => {
  const obj = new THREE.Group();
  obj.name = name;
  obj.userData = userData;
  for (const child of children) obj.add(child);
  return obj;
};

/** FHSW's Ju87D as `Ju87D.glb` has it: the outer DistCompareSelector2 LOD,
 *  the pilot's cockpit LodObject holding the fuselage alone, and the rear
 *  gunner's nested PlayerControlObject with a cockpit LodObject of its own. */
function stuka() {
  const fuselage = node('StukaCockpitExternal', { templateKind: 'SimpleObject', control: 'Ju87D' });
  const gunnerExternal = node('RearGunExternal', { templateKind: 'SimpleObject', control: 'StukaRearGunControl' });
  const gunner = node('StukaRearGunControl', { templateKind: 'PlayerControlObject', control: 'StukaRearGunControl' }, [
    node('lodRearGunCockpit', { templateKind: 'LodObject', control: 'StukaRearGunControl', selectorKind: 'DistCompareSelector' }, [gunnerExternal]),
  ]);
  const prop = node('StukaPropellerStatic', { templateKind: 'SimpleObject', control: 'Ju87D' });
  const root = node('Ju87D', { templateKind: 'PlayerControlObject', control: 'Ju87D' }, [
    node('lodJu87D', { templateKind: 'LodObject', control: 'Ju87D', selectorKind: 'DistCompareSelector2' }, [
      node('Ju87DComplex', { templateKind: 'Bundle', control: 'Ju87D' }, [
        node('lodStukaCockpit', { templateKind: 'LodObject', control: 'Ju87D', selectorKind: 'DistCompareSelector' }, [fuselage]),
        node('StukaEngine', { templateKind: 'Engine', control: 'Ju87D' }, [
          node('lodStukaPropeller', { templateKind: 'LodObject', control: 'Ju87D', selectorKind: 'CompareSelector' }, [prop]),
        ]),
        gunner,
      ]),
    ]),
  ]);
  return { root, fuselage, gunnerExternal, prop };
}

const results = {};
const names = list => list.map(n => n.name);
const realFetch = globalThis.fetch;

{
  const { root } = stuka();
  results.exterior = {
    pilot: names(insideViewExterior(root, 'Ju87D')),
    gunner: names(insideViewExterior(root, 'StukaRearGunControl')),
    stranger: names(insideViewExterior(root, 'nobody')),
  };
}

// The glb in the air: the fetch never answers.
{
  globalThis.fetch = () => new Promise(() => {});
  const { root, fuselage, gunnerExternal, prop } = stuka();
  const plane = new Vehicle(root, null, { modelsBase: 'http://localhost/models/' });
  const shown = () => [fuselage.visible, gunnerExternal.visible, prop.visible];
  const out = { entered: shown() };
  plane.setFirstPerson(false);
  out.outside = shown();
  plane.setFirstPerson(true);
  out.inside = shown();
  plane.seatControl = 'StukaRearGunControl';
  plane.setFirstPerson(true);
  out.gunner = shown();
  results.pending = out;
}

// No interior to be had: the exterior comes back.
{
  globalThis.fetch = () => Promise.reject(new Error('404'));
  const { root, fuselage } = stuka();
  const plane = new Vehicle(root, null, { modelsBase: 'http://localhost/models/' });
  const entered = fuselage.visible;
  const got = await plane.cockpitReady;
  results.missing = { entered, landed: fuselage.visible, got, pending: plane.cockpitPending };
}

globalThis.fetch = realFetch;
process.stdout.write(JSON.stringify(results));
process.exit(0);
