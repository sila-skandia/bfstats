// test_template_table.py's node half: the sidecar's computed template ids
// (template-table.mjs) and namesForLevel / the body decoder using them.
// Prints one JSON line. SIDECAR_CACHE points at a scratch directory.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SIDECAR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../sidecar');
const { templateTable } = await import(path.join(SIDECAR, 'template-table.mjs'));
const { namesForLevel } = await import(path.join(SIDECAR, 'names.mjs'));
const { BodyDecoder } = await import(path.join(SIDECAR, 'body-decoder.mjs'));

const pick = (t, ids) => Object.fromEntries(ids.map((i) => [i, t?.tidNames?.[i] ?? null]));
const wake = templateTable({ mod: 'bf1942', level: 'bf1942/levels/wake/', mode: 'coop.con' });
const alamein = templateTable({ mod: 'BF1942', level: 'el_alamein', mode: 'CoOp' });
const cacheFile = path.join(process.env.SIDECAR_CACHE, 'bf1942', 'wake-coop.tids.json');
const cached = fs.existsSync(cacheFile) ? JSON.parse(fs.readFileSync(cacheFile, 'utf8')) : null;

// The body decoder sees what a session feeds it: ServerInfo, then SetLevel.
const dc = new BodyDecoder();
dc.note({ e: 'serverInfo', mapId: 'BF1942', mod: 'bf1942', gameId: 'BF1942' });
dc.note({ e: 'setLevel', level: 'bf1942/levels/el_alamein/', mode: 'coop.con' });
dc.note({ e: 'createObject', netId: 700, tid: 2914 });

const named = namesForLevel('bf1942/levels/wake/', { mod: 'bf1942', mode: 'coop.con' });
const fallback = namesForLevel('bf1942/levels/wake/');

console.log(JSON.stringify({
  wake: { count: wake?.count ?? 0, ...pick(wake, ['0', '1', '2916', '3601', '3605']) },
  alamein: { count: alamein?.count ?? 0, ...pick(alamein, ['2914', '2916']) },
  cached: cached ? { names: cached.value.names.length, inputs: cached.inputs.length } : null,
  named: { computed: named.computed, n2916: named.tidNames['2916'] ?? null, n1: named.tidNames['1'] ?? null },
  fallback: { computed: fallback.computed, n2916: fallback.tidNames['2916'] ?? null, n1: fallback.tidNames['1'] ?? null },
  decoder: dc.info(700)?.tmpl ?? null,
  noLevel: templateTable({ mod: 'bf1942', level: 'bf1942/levels/no_such_level/', mode: 'coop.con' }),
}));
