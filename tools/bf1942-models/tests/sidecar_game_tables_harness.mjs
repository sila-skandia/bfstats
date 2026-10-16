// test_sidecar_game_tables.py's node half: the sidecar's install-built tables
// (game-tables.mjs) and the body decoder's use of them. Prints one JSON line.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SIDECAR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../sidecar');
const { gameTables, cpNameOf } = await import(path.join(SIDECAR, 'game-tables.mjs'));
const { BodyDecoder } = await import(path.join(SIDECAR, 'body-decoder.mjs'));
const { classForTemplate } = await import(path.join(SIDECAR, 'template-class.mjs'));

const brief = (g) => ({ anim: g.animStates?.length ?? 0, first: g.animStates?.[0] ?? null, cpNames: g.cpNames });
const wake = brief(gameTables({ mod: 'bf1942', level: 'bf1942/levels/wake/', mode: 'coop.con' }));

// A fresh process would read the cache; here the memo answers, so read the
// cache files back directly to prove they were written and are valid.
const dir = process.env.SIDECAR_CACHE;
const cacheFile = path.join(dir, 'bf1942', 'wake-coop.json');
const cacheFiles = fs.existsSync(cacheFile);
const wakeCached = brief(JSON.parse(fs.readFileSync(cacheFile, 'utf8')).value);

// The body decoder sees the rows a session feeds it: ServerInfo, then SetLevel.
const dc = new BodyDecoder();
dc.note({ e: 'serverInfo', mapId: 'BF1942', mod: 'desertcombat', gameId: 'DC' });
dc.note({ e: 'setLevel', level: 'bf1942/levels/el_alamein/', mode: 'conquest.con' });
const dcBodies = {
  animStates: dc.animStates,
  cpTemplates: [...dc.cpTemplates].sort(),
  cpClass: classForTemplate('SouthOpenBase', dc.cpTemplates)?.objectClass ?? null,
};

const fixed = new BodyDecoder({ animStates: 1395 });
fixed.note({ e: 'serverInfo', mod: 'desertcombat' });
fixed.note({ e: 'setLevel', level: 'bf1942/levels/el_alamein/', mode: 'conquest.con' });

console.log(JSON.stringify({
  wake, wakeCached, cacheFiles, dcBodies,
  fixedBodies: fixed.animStates,
  noMod: gameTables({ mod: null, level: 'bf1942/levels/wake/' }),
  caseless: cpNameOf(wake.cpNames, 'allies_north_village') ?? null,
}));
