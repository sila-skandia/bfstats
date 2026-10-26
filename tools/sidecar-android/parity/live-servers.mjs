// Writes core/src/commonTest/resources/parity/live-servers.json from the
// desktop tray app's server list code (tools/sidecar-desktop/src/servers.js
// and map-image.js), which LiveServers.kt ports for the Android app's list:
// each body as the live list API might send it, normalised and sorted, the
// map image addresses and the name decoding. LiveServersTest.kt matches it.
//   node parity/live-servers.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { RES, HERE } from './lib/tables.mjs';

const require = createRequire(import.meta.url);
const DESKTOP = path.resolve(HERE, '../../sidecar-desktop/src');
const { normalise, sortServers, decodeName } = require(path.join(DESKTOP, 'servers.js'));
const { mapImageUrl, mapSlug } = require(path.join(DESKTOP, 'map-image.js'));

const srv = (o) => ({ ip: '1.2.3.4', port: 14567, name: 'x', numPlayers: 0, maxPlayers: 32, ...o });
const bodies = {
  typical: { servers: [
    srv({ name: 'Zulu', numPlayers: 3, mapId: 'BF1942', gameId: 'bf1942', mapName: 'Wake', gameType: 'coop', anticheat: true, password: false,
      roundTimeRemain: 600, tickets1: 120, tickets2: 99, teams: [{ index: 1, label: ' Axis ' }, { index: 2, label: 'Allies' }], country: 'DE' }),
    srv({ name: 'alpha', ip: '1.2.3.5', numPlayers: 3 }),
    srv({ name: 'Bravo', ip: '1.2.3.6' }),
    srv({ name: 'bravo', ip: '1.2.3.7' }),
    srv({ name: '[TAG] Server', ip: '1.2.3.8' }),
    srv({ name: '=DC= Desert', ip: '1.2.3.9', gameId: 'DesertCombat', mapName: 'El Alamein' }),
    srv({ name: '1st Server', ip: '1.2.3.10' }),
    srv({ name: 'Ápex', ip: '1.2.3.11' }),
    srv({ name: 'apex', ip: '1.2.3.12' }),
    srv({ name: 'Charlie 10', ip: '1.2.3.13' }),
    srv({ name: 'Charlie 9', ip: '1.2.3.14' }),
    srv({ name: 'beta', ip: '1.2.3.15', numPlayers: 12, maxPlayers: 64 }),
  ] },
  cyrillic: { servers: [srv({ name: 'Ñåðâåð Ðîññèè' }), srv({ name: 'Mixed Ñåðâåð', ip: '2.2.2.2' }), srv({ name: '', ip: '3.3.3.3' })] },
  odd: { servers: [
    null, 5, 'x', srv({ ip: 7 }), srv({ port: '14567' }), srv({ port: 14567.5 }), srv({ ip: '4.4.4.4', name: null }),
    srv({ ip: '4.4.4.5', name: 1942, numPlayers: '7', maxPlayers: null, tickets1: '12', tickets2: '', roundTimeRemain: 12.7, country: 'de', gameId: 5,
      teams: [{ index: 1, label: '' }, { index: 2, label: 'A very long team label indeed, too long' }, null], anticheat: 'true', password: 1 }),
    srv({ ip: '4.4.4.6', mapName: 'Kursk (Day 2)', gameId: 'BF1942' }),
    srv({ ip: '4.4.4.7', mapName: "Gold Beach - D'Day!", gameId: ' XPack1 ' }),
    srv({ ip: '4.4.4.8', mapName: 'Operation  Market\tGarden', gameId: 'FH' }),
  ] },
  noServers: {},
  notAList: { servers: { a: 1 } },
};

const out = { cases: {}, images: [], slugs: [], names: [] };
for (const [name, body] of Object.entries(bodies)) {
  const text = JSON.stringify(body);
  out.cases[name] = { body: text, servers: sortServers(normalise(JSON.parse(text))) };
}
for (const [g, m] of [['bf1942', 'Wake'], ['', 'Wake'], ['bf1942', ''], [null, null], ['FH Sw', 'Kursk (Day 2)'], ['bf1942', "D'Day ~ !*"], ['dc', 'Été Map'], ['x', 'a/b?c#d&e=f+g%h']]) {
  out.images.push([g, m, mapImageUrl(g, m)]);
}
for (const m of ['  Battle of the Bulge ', 'Market Garden', 'A　B', null]) out.slugs.push([m, mapSlug(m)]);
for (const n of ['Ñåðâåð', 'plain', '', null, 'Ñåðâåð ok ok ok ok', '€ƒ…', 'Ö']) out.names.push([n, decodeName(n)]);
fs.writeFileSync(path.join(RES, 'live-servers.json'), JSON.stringify(out));
console.log(`${Object.keys(out.cases).length} bodies, ${out.images.length} images`);
