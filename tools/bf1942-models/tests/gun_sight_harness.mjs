// A gun with no drivetrain grafts its sight as a driven hull grafts its
// cockpit: `graftCockpitInto` (vehicle-base.js) takes every seat's interior
// and `FixedSubject` (vehicle-camera.js) shows the one whose seat is looked
// out of. One JSON report on stdout; `tests/test_gun_sight.py` asserts on it.

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { installModuleHooks, viewerDir } from '../sim/env.mjs';

const viewer = viewerDir();
installModuleHooks(viewer);
const imp = name => import(pathToFileURL(path.join(viewer, name)).href);
const [THREE, { graftCockpitInto, applyCockpitSwaps }, { FixedSubject }] = await Promise.all([
  imp('vendor/three.module.js'), imp('vehicle-base.js'), imp('vehicle-camera.js'),
]);

const node = (name, userData = {}, children = []) => {
  const obj = new THREE.Group();
  obj.name = name;
  obj.userData = userData;
  for (const child of children) obj.add(child);
  return obj;
};

/** FH's PaK 38 as a level places it, with a loader's seat beside the gunner's. */
function gun() {
  const external = node('pak38CockpitExternal', { control: 'pak38' });
  const host = node('lodpak38Cockpit_1', { control: 'pak38' }, [external]);
  const loaderHost = node('lodLoaderCockpit', { control: 'pak38Loader' });
  const root = node('pak38_1', { control: 'pak38' }, [host, loaderHost]);
  return { root, host, external, loaderHost };
}

/** `pak38.cockpit.glb`: the same walk pruned to the first-person halves. */
function cockpit() {
  const internal = node('pak38CockpitInternal', { control: 'pak38' });
  const loaderInternal = node('LoaderCockpitInternal', { control: 'pak38Loader' });
  return {
    internal, loaderInternal,
    scene: node('scene', {}, [node('pak38', { control: 'pak38' }, [
      node('lodpak38Cockpit', {
        control: 'pak38',
        lodAlternative: { selected: 'pak38CockpitInternal', replaces: ['pak38CockpitExternal'] },
      }, [internal]),
      node('lodLoaderCockpit', {
        control: 'pak38Loader',
        lodAlternative: { selected: 'LoaderCockpitInternal', replaces: [] },
      }, [loaderInternal]),
    ])]),
  };
}

const results = {};
const shown = (...nodes) => nodes.map(n => n.visible);

{
  const { root, host, external, loaderHost } = gun();
  const { internal, loaderInternal, scene } = cockpit();
  const swaps = graftCockpitInto(root, scene);
  results.graft = {
    swaps: swaps.map(s => s.control),
    parents: [internal.parent === host, loaderInternal.parent === loaderHost],
    marked: [internal, loaderInternal].map(n => n.userData.cockpitInterior === true),
    // [gunner's interior, its exterior, loader's interior]
    grafted: shown(internal, external, loaderInternal),
  };
  applyCockpitSwaps(swaps, true, 'pak38');
  results.graft.gunner = shown(internal, external, loaderInternal);
  applyCockpitSwaps(swaps, true, 'pak38Loader');
  results.graft.loader = shown(internal, external, loaderInternal);
  applyCockpitSwaps(swaps, false, 'pak38');
  results.graft.outside = shown(internal, external, loaderInternal);
}

{
  const { root, external } = gun();
  const { internal, loaderInternal, scene } = cockpit();
  const subject = new FixedSubject(root);
  const asked = [];
  const load = (n, file, base, prepare) => {
    asked.push([n === root, file, typeof prepare]);
    return Promise.resolve(graftCockpitInto(n, scene));
  };
  // Inside before the sight lands, as a seat taken is.
  subject.setFirstPerson(true);
  const loaded = await subject.loadCockpit(load, undefined, () => {});
  const out = { asked, loaded: loaded === subject, inside: shown(internal, external, loaderInternal) };
  subject.setFirstPerson(false);
  out.outside = shown(internal, external, loaderInternal);
  subject.seatControl = 'pak38Loader';
  subject.setFirstPerson(true);
  out.loaderSeat = shown(internal, external, loaderInternal);
  results.subject = out;
}

// A gun left before its sight lands is seen from outside when it does, and a
// fetch that throws costs the sight and nothing else.
{
  const { root, external } = gun();
  const { internal, scene } = cockpit();
  const subject = new FixedSubject(root);
  let land;
  const pending = subject.loadCockpit(() => new Promise(resolve => { land = resolve; }));
  subject.setFirstPerson(false);
  land(graftCockpitInto(root, scene));
  await pending;
  results.left = shown(internal, external);

  const broken = new FixedSubject(gun().root);
  const warn = console.warn;
  let warned = 0;
  console.warn = () => { warned += 1; };
  let threw = null;
  let got;
  try { got = await broken.loadCockpit(() => Promise.reject(new Error('no'))); } catch (error) { threw = String(error); }
  console.warn = warn;
  broken.setFirstPerson(true);
  results.broken = { threw, got, warned, swaps: broken.swaps.length };
}

process.stdout.write(JSON.stringify(results));
