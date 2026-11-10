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
const [THREE, { graftCockpitInto, applyCockpitSwaps, distCompareRule }, { FixedSubject }] = await Promise.all([
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

// FHSW's sight ring: a `DistanceSelector` of 0.1 m at the spot the second
// inside view's eye stands on, 1.1 m ahead of the first's (ledger LOD-3).
{
  const external = node('pak38GunnerCockpitExternal', { control: 'pak38_AP' });
  const host = node('lodpak38GunnerCockpit', { control: 'pak38_AP' }, [external]);
  const root = node('pak38_AP', { control: 'pak38_AP' }, [host]);
  root.position.set(100, 20, -50);
  const ring = node('pak38GunnerCockpitInternal', { control: 'pak38_AP' });
  const scene = node('scene', {}, [node('lodpak38GunnerCockpit', {
    control: 'pak38_AP',
    lodAlternative: {
      selected: 'pak38GunnerCockpitInternal', replaces: ['pak38GunnerCockpitExternal'],
      selectorKind: 'DistanceSelector', distances: [0.1],
    },
  }, [ring])]);
  const subject = new FixedSubject(root);
  await subject.loadCockpit(n => Promise.resolve(graftCockpitInto(n, scene)));
  const eye = new THREE.Vector3();
  subject.viewEye = () => eye;
  const out = {};
  eye.set(100.1, 20.3, -51.1);
  subject.setFirstPerson(true);
  out.seatEye = shown(ring, external);
  eye.set(100, 20.05, -50);
  subject.setFirstPerson(true);
  out.sightEye = shown(ring, external);
  // Any view whose eye stands there sees it: the selector answers the
  // eye's distance and nothing else (LOD-3), as an aircraft gunner's second
  // inside view, which is no first-person view here, needs.
  subject.setFirstPerson(false);
  out.otherView = shown(ring, external);
  // An outside view's eye is metres off.
  eye.set(108, 23, -44);
  subject.setFirstPerson(false);
  out.outside = shown(ring, external);
  // No view to ask (a replay's hull): the interior follows the view alone.
  subject.viewEye = null;
  subject.setFirstPerson(true);
  out.noEye = shown(ring, external);
  results.near = out;
}

// BF1918's field guns: a lower-case `distcompareselector` of `[0.1]` and
// 0.6 (ledger LOD-8). The gunner's eye is 0.9 m from the reticule's LodObject;
// `OutsideHudOffset 0/0/1.65` puts the second inside view's 0.75 m from it,
// inside sqrt(0.6) = 0.775. The reticule is the second view's alone.
{
  const external = node('Frz75erGunnerCockpitExternal', { control: 'Frz75erGunner' });
  const host = node('Frz75erGunnerCockpit', { control: 'Frz75erGunner' }, [external]);
  const root = node('Frz75er', { control: 'Frz75er' }, [host]);
  root.position.set(140, 76, -713);
  const reticule = node('Frz75erGunnerCockpitInternal', { control: 'Frz75erGunner' });
  const scene = node('scene', {}, [node('Frz75erGunnerCockpit', {
    control: 'Frz75erGunner',
    lodAlternative: {
      selected: 'Frz75erGunnerCockpitInternal', replaces: ['Frz75erGunnerCockpitExternal'],
      selectorKind: 'distcompareselector', distances: [0.6], comparisons: [0.1],
    },
  }, [reticule])]);
  const subject = new FixedSubject(root);
  subject.seatControl = 'Frz75erGunner';
  await subject.loadCockpit(n => Promise.resolve(graftCockpitInto(n, scene)));
  const eye = new THREE.Vector3();
  subject.viewEye = () => eye;
  const out = {};
  eye.set(140, 76, -713.9);
  subject.setFirstPerson(true);
  out.seatEye = shown(reticule, external);
  eye.set(140, 76, -712.25);
  subject.setFirstPerson(true);
  out.sightEye = shown(reticule, external);
  // The compare value is 0 outside the Inside view (LOD-2): the eye's
  // reach alone is not enough, unlike a DistanceSelector's.
  subject.setFirstPerson(false);
  out.otherView = shown(reticule, external);
  subject.viewEye = null;
  subject.setFirstPerson(true);
  out.noEye = shown(reticule, external);
  results.compare = out;
}

// The rule's shapes, from the installed mods' selectors.
results.rule = {
  vanilla: distCompareRule({ selectorKind: 'DistCompareSelector', distances: [20], comparisons: [0.5] }),
  frz75er: distCompareRule({ selectorKind: 'distcompareselector', distances: [0.6], comparisons: [0.1] }),
  // FT17_Beute: two of each, the last distance is the selector's.
  ft17beute: distCompareRule({ selectorKind: 'DistCompareSelector', distances: [5, 1], comparisons: [0.5, 0.5] }),
  // FHSWEurope's filming Kate: no comparison, never the interior.
  none: distCompareRule({ selectorKind: 'DistCompareSelector', distances: [2000], comparisons: [] }),
  // FHSWEurope's sokol1000: 0 and 0, the view flip with no reach.
  zero: distCompareRule({ selectorKind: 'DistCompareSelector', distances: [0], comparisons: [0] }),
  // FHSWEurope's gramophone: a comparison of 1 is never passed by 1.
  one: distCompareRule({ selectorKind: 'DistCompareSelector', distances: [1], comparisons: [1] }),
  distance: distCompareRule({ selectorKind: 'DistanceSelector', distances: [0.1] }),
  second: distCompareRule({ selectorKind: 'DistCompareSelector2', distances: [200], comparisons: [0.1] }),
};

process.stdout.write(JSON.stringify(results));
