// `viewer/world-damage.js` `inWaterOwners`: a hull is wet when a MOBILE part's
// lowest col0 vertex is under the sea (ledger HP-21): a `hasMobilePhysics 0`
// part's `checkVsTerrain` is empty, so FHSWEurope Biak's Catfish, its static
// pontoon 0.6 m under, is never billed, as the lab's server recording holds it
// at 170 HP; a driven hull is tested on its root alone.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { installModuleHooks, viewerDir } from '../sim/env.mjs';

const viewer = viewerDir();
installModuleHooks(viewer);
const { inWaterOwners } = await import(pathToFileURL(path.join(viewer, 'world-damage.js')).href);

const WATER = 65;
// A part: four col0 vertices at `low` (world y), around the hull's origin.
const part = (node, low, mobile = true, isRoot = false) => ({
  node, kind: 'body', mobile, isRoot,
  shape: { layers: [{ vertices: [0, low - 66.97, 0, 1, low - 66.97, 0, 0, low - 66.97, 1,
                                  1, low - 66.97, 1] }] },
  offset: [0, 0, 0],
  worldVertex(_layer, _i, out) { out[0] = 0; out[1] = low; out[2] = 0; return out; },
});
function entry(fuselageLow, pontoonLow, { pontoonMobile = false, driven = false } = {}) {
  const fuselage = part('fuselage', fuselageLow, true, true);
  const pontoon = part('pontoon', pontoonLow, pontoonMobile);
  return { parked: { body: { pos: [0, 66.97, 0] } },
           driven: driven ? { vehicle: { state: { position: { x: 0, y: 66.97, z: 0 } } } } : null,
           parts: [fuselage, pontoon] };
}
const world = {
  collider: { waterLevel: WATER, surfaceHeight: () => WATER },
  positions: new Map(),
  isWrecked: () => false,
  bodyWorld: { entries: new Map([[1, entry(65.54, 64.13)], [2, entry(64.5, 64.13)],
                                  [3, entry(65.54, 65.2)],
                                  [4, entry(65.54, 64.13, { pontoonMobile: true })],
                                  [5, entry(65.54, 64.13, { pontoonMobile: true, driven: true })]]),
               get(owner) { return this.entries.get(owner); } },
};
const wet = inWaterOwners(world);
process.stdout.write(JSON.stringify({ floating: wet.has(1), sunk: wet.has(2), clear: wet.has(3),
  mobilePart: wet.has(4), drivenMobilePart: wet.has(5) }));
