// `viewer/world-damage.js` `inWaterOwners`: a hull is wet when ANY collidable
// part's lowest col0 vertex is under the sea (`checkVsTerrain` per part,
// routed to the nearest Armor; ledger HP-21), so a seaplane whose pontoon
// rides in the sea is billed `hpLostWhileDamageFromWater` (FHSWEurope Biak's
// Catfish, as in retail), and one clear of it is not.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { installModuleHooks, viewerDir } from '../sim/env.mjs';

const viewer = viewerDir();
installModuleHooks(viewer);
const { inWaterOwners } = await import(pathToFileURL(path.join(viewer, 'world-damage.js')).href);

const WATER = 65;
// A part: four col0 vertices at `low` (world y), around the hull's origin.
const part = (node, low) => ({
  node, kind: 'body',
  shape: { layers: [{ vertices: [0, low - 66.97, 0, 1, low - 66.97, 0, 0, low - 66.97, 1,
                                  1, low - 66.97, 1] }] },
  offset: [0, 0, 0],
  worldVertex(_layer, _i, out) { out[0] = 0; out[1] = low; out[2] = 0; return out; },
});
function entry(fuselageLow, pontoonLow) {
  const fuselage = part('fuselage', fuselageLow), pontoon = part('pontoon', pontoonLow);
  return { parked: { body: { pos: [0, 66.97, 0] } }, driven: null, parts: [fuselage, pontoon],
           spec: { waterPart: { node: 'fuselage' } } };
}
const world = {
  collider: { waterLevel: WATER, surfaceHeight: () => WATER },
  positions: new Map(),
  isWrecked: () => false,
  bodyWorld: { entries: new Map([[1, entry(65.54, 64.13)], [2, entry(64.5, 64.13)], [3, entry(65.54, 65.2)]]),
               get(owner) { return this.entries.get(owner); } },
};
const wet = inWaterOwners(world);
process.stdout.write(JSON.stringify({ floating: wet.has(1), sunk: wet.has(2), clear: wet.has(3) }));
