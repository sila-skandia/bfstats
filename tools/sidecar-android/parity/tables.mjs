// Writes core/src/commonTest/resources/parity/tables.json.gz: the level tables
// without an install, as tests/sidecar_level_tables_harness.mjs,
// sidecar_template_table_harness.mjs and sidecar_game_tables_harness.mjs
// drive them:
//   - level-tables.mjs: the mod/level/mode keys and URLs, and prepareLevel
//     against a stand-in for mesh.bfstats.io (a scripted fetch the Kotlin
//     test ports line for line): the download, the memo, a conditional GET
//     answered 304 and 200, offline (hung, refused), a copy baked by other
//     code, a level not published, a garbled document, downloads off;
//   - template-table.mjs, game-tables.mjs, names.mjs: lookups with the
//     committed tables and without (every recorded templates/<level>.json);
//   - template-class.mjs: classes for names, with and without tables.
//   node parity/tables.mjs
import fs from 'node:fs';
import path from 'node:path';
import { RES, SIDECAR, HERE, writeGz, ensureTables, scratchCache, runNode } from './lib/tables.mjs';

const BASE = 'http://mesh.test/';

if (process.argv[2] === '--prepare') {
  process.env.SIDECAR_TABLES_URL = BASE;
  const L = await import(path.join(SIDECAR, 'level-tables.mjs'));
  const { templateTable, levelTemplates, TEMPLATE_TABLE_VERSION } = await import(path.join(SIDECAR, 'template-table.mjs'));
  const { gameTables } = await import(path.join(SIDECAR, 'game-tables.mjs'));
  const { namesForLevel } = await import(path.join(SIDECAR, 'names.mjs'));
  const out = [];
  const put = (label, v) => out.push([label, JSON.stringify(v ?? null)]);
  const noMs = (r) => { const { ms, ...rest } = r; return rest; };

  // ---- the stand-in server ----
  const served = new Map();
  const state = (level) => { if (!served.has(level)) served.set(level, { rev: 1, v: TEMPLATE_TABLE_VERSION }); return served.get(level); };
  const baked = (level, mode) => {
    const { rev, v } = state(level);
    const names = ['ObjectManagerCamera', 'BlueFlag', 'RedFlag', 'Sherman', 'Tiger', rev === 1 ? 'TestTank' : `TestTank${rev}`];
    return {
      format: 1, mod: 'bf1942', level, mode,
      tids: { v, mod: 'bf1942', level, mode, names, classes: ['Camera', 'Flag', 'Flag', 'PlayerControlObject', 'PlayerControlObject', 'PlayerControlObject'], specs: {}, hulls: {}, soldiers: {} },
      animStates: [[0, 'Idle', 0], [1, 'Run', 0], [2, 'Prone', 0]].slice(0, rev === 1 ? 3 : 2),
      cpNames: { ALLIES_base: 'Airfield' },
    };
  };
  const requests = [];
  const conditional = [];
  let down = false, refused = false;
  const reply = (status, headers, body) => ({ status, ok: status >= 200 && status < 300, headers: { get: (k) => headers[k.toLowerCase()] ?? null }, text: async () => body });
  const fetchImpl = async (url, { headers = {} } = {}) => {
    const p = url.startsWith(BASE) ? url.slice(BASE.length - 1) : url;
    requests.push(p);
    if (refused) throw new TypeError('fetch failed');
    if (down) throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    const m = p.match(/^\/maps(?:\/mods\/([^/]+))?\/([^/]+)\/sidecar\/([^/]+)\.json$/);
    if (m && m[2] === 'slow') throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    if (m && m[2] === 'garbled') return reply(200, {}, '{"format":99}');
    if (m && ['wake', 'el_alamein', 'anzio', 'berlin', 'oldcode'].includes(m[2])) {
      const { rev, v } = state(m[2]);
      const etag = `W/"${m[2]}-${rev}-${v}"`;
      const lastModified = new Date(Date.UTC(2026, 9, 25, 3, rev)).toUTCString();
      const inm = headers['If-None-Match'] ?? null;
      const ims = headers['If-Modified-Since'] ?? null;
      const fresh = inm ? inm === etag : (ims ? ims === lastModified : false);
      conditional.push([p, inm, ims, fresh ? 304 : 200]);
      if (fresh) return reply(304, { etag, 'last-modified': lastModified }, '');
      return reply(200, { etag, 'last-modified': lastModified }, JSON.stringify(baked(m[2], m[3])));
    }
    return reply(404, {}, 'not found');
  };
  const prep = (args, opts = {}) => L.prepareLevel(args, { fetchImpl, ...opts }).then(noMs);

  const wake = { mod: 'bf1942', level: 'bf1942/levels/wake/', mode: 'coop.con' };
  put('version', TEMPLATE_TABLE_VERSION);
  put('before', { table: templateTable(wake), anim: gameTables(wake).animStates });
  put('first', await prep(wake));
  put('cacheFile', path.relative(process.env.SIDECAR_CACHE, L.bakedCacheFile(wake)));
  const t = templateTable(wake);
  put('after', {
    count: t?.count ?? 0, tid5: t?.tidNames?.['5'] ?? null, cls3: t?.tidClasses?.['3'] ?? null, layouts: !!levelTemplates(wake),
    anim: gameTables(wake).animStates?.length ?? 0, cp: gameTables(wake).cpNames?.ALLIES_base ?? null,
    named: (() => { const n = namesForLevel(wake.level, { mod: wake.mod, mode: wake.mode }); return { computed: n.computed, tid4: n.tidNames['4'] ?? null }; })(),
  });
  const n1 = requests.length;
  put('again', await prep(wake));
  put('requestsForAgain', requests.length - n1);
  L.resetLevelTables();
  put('revalidate304', { r: await prep(wake), c: conditional.at(-1), tid5: templateTable(wake)?.tidNames?.['5'] ?? null });
  state('wake').rev = 2;
  L.resetLevelTables();
  put('revalidate200', { r: await prep(wake), c: conditional.at(-1), tid5: templateTable(wake)?.tidNames?.['5'] ?? null, anim: gameTables(wake).animStates?.length ?? 0 });
  L.resetLevelTables();
  down = true;
  put('offlineHung', { r: await prep(wake, { revalidateMs: 300 }), tid5: templateTable(wake)?.tidNames?.['5'] ?? null });
  down = false;
  L.resetLevelTables();
  refused = true;
  put('offlineRefused', await prep(wake, { revalidateMs: 300 }));
  refused = false;
  {
    const old = { mod: 'bf1942', level: 'oldcode', mode: 'coop' };
    state('oldcode').v = 'other-code';
    put('oldFirst', await prep(old));
    put('oldBefore', L.readBaked(old)?.tids?.v ?? null);
    state('oldcode').v = TEMPLATE_TABLE_VERSION;
    L.resetLevelTables();
    put('otherCode', { r: await prep(old), c: conditional.at(-1), after: L.readBaked(old)?.tids?.v === TEMPLATE_TABLE_VERSION });
  }
  state('wake').rev = 1;
  L.resetLevelTables();
  put('back', await prep(wake));
  put('xpack', await prep({ mod: 'XPack1', level: 'bf1942/levels/Anzio/', mode: 'CoOp.con' }));
  put('missing', await prep({ mod: 'bf1942', level: 'bf1942/levels/no_such_level/', mode: 'conquest.con' }));
  put('missingTable', templateTable({ mod: 'bf1942', level: 'bf1942/levels/no_such_level/', mode: 'conquest.con' }));
  put('missingNamed', namesForLevel('bf1942/levels/no_such_level/', { mod: 'bf1942', mode: 'conquest.con' }).computed);
  put('slow', await prep({ mod: 'bf1942', level: 'slow', mode: 'coop' }, { timeoutMs: 300 }));
  put('garbled', await prep({ mod: 'bf1942', level: 'garbled', mode: 'coop' }));
  put('noFetch', await prep({ mod: 'bf1942', level: 'berlin', mode: 'conquest' }, { fetchImpl: null }));
  process.env.SIDECAR_TABLES_URL = 'off';
  put('off', await L.prepareLevel({ mod: 'bf1942', level: 'berlin', mode: 'ctf' }, { fetchImpl }).then(noMs));
  put('noArgs', await L.prepareLevel({ mod: null, level: 'wake' }, { fetchImpl }).then(noMs));
  put('requests', requests);
  put('conditional', conditional);
  put('cache', fs.readdirSync(process.env.SIDECAR_CACHE, { recursive: true }).filter((f) => f.endsWith('.json')).sort());
  put('wakeDoc', JSON.parse(fs.readFileSync(L.bakedCacheFile(wake), 'utf8')));
  fs.writeFileSync(process.argv[3], JSON.stringify(out));
  process.exit(0);
}

if (process.argv[2] === '--lookups') {
  const L = await import(path.join(SIDECAR, 'level-tables.mjs'));
  const { templateTable, levelTemplates } = await import(path.join(SIDECAR, 'template-table.mjs'));
  const { gameTables, cpNameOf } = await import(path.join(SIDECAR, 'game-tables.mjs'));
  const { namesForLevel, tidNamesFromRecording } = await import(path.join(SIDECAR, 'names.mjs'));
  const { classForTemplate, classFromTemplateClass, controlPointTemplates } = await import(path.join(SIDECAR, 'template-class.mjs'));
  const out = [];
  const put = (label, v) => out.push([label, JSON.stringify(v ?? null)]);
  // Keys and URLs.
  const LV = ['bf1942/levels/Market_Garden/', 'bf1942\\levels\\Market_Garden\\', 'market garden', '  Wake  ', '', null, 'a/b/c//', 'El Alamein'];
  const MD = ['CoOp.con', 'GPM_CQ', '', null, 'objective', 'co-op', 'TeamDeathMatch', 'gpm_objectivemode', 'CTF'];
  const MOD = ['bf1942', 'BF1942', 'XPack1', 'DC_Final', 'Desert Combat!', '', null, 'FHSW'];
  put('levelKey', LV.map((x) => L.levelKey(x)));
  put('modeKey', MD.map((x) => L.modeKey(x)));
  put('modKey', MOD.map((x) => L.modKey(x)));
  put('treeFor', MOD.map((x) => L.treeFor(x)));
  put('urls', MOD.flatMap((mod) => LV.slice(0, 4).map((level, i) => L.tablesUrl({ mod, level, mode: MD[i] }, i % 2 ? 'https://mesh.example' : 'https://mesh.example/'))));
  put('validBaked', [null, {}, { format: 1 }, { format: 1, tids: { names: ['a', 'b'], classes: [], specs: {}, hulls: {}, soldiers: {} } },
    { format: 2, tids: { names: ['a', 'b'], classes: [], specs: {}, hulls: {}, soldiers: {} } }, { format: 1, tids: { names: ['a'], classes: [], specs: {}, hulls: {}, soldiers: {} } }].map((j) => L.validBaked(j)));
  // The committed tables, by every spelling a session hands over.
  const ASK = [['bf1942', 'bf1942/levels/wake/', 'coop.con'], ['BF1942', 'Wake', 'CoOp'], ['bf1942', 'el_alamein', 'coop'],
    ['desertcombat', 'bf1942/levels/el_alamein/', 'conquest.con'], ['bf1942', 'bf1942/levels/wake/', 'conquest.con'], ['bf1942', 'tobruk', 'coop'], [null, 'wake', 'coop'], ['bf1942', null, 'coop']];
  for (const [mod, level, mode] of ASK) {
    const t = templateTable({ mod, level, mode });
    const lt = levelTemplates({ mod, level, mode });
    const g = gameTables({ mod, level, mode });
    put(`table ${mod} ${level} ${mode}`, t ? { count: t.count, mod: t.mod, level: t.level, mode: t.mode, tids: ['0', '1', '5', '100', '1571', '2914', '2916', '3601'].map((k) => [t.tidNames[k] ?? null, t.tidClasses[k] ?? null]) } : null);
    put(`layouts ${mod} ${level} ${mode}`, lt ? { specs: Object.keys(lt.specs).length, sherman: lt.specs.Sherman ?? null, hulls: Object.keys(lt.hulls).length, m3a1: lt.hulls.M3A1 ?? null, soldiers: lt.soldiers } : null);
    put(`game ${mod} ${level} ${mode}`, { anim: g.animStates?.length ?? null, first: g.animStates?.[0] ?? null, last: g.animStates?.at(-1) ?? null, cpNames: g.cpNames, downloaded: g.downloaded ?? null });
  }
  put('gameNoLevel', gameTables({ mod: 'bf1942' }));
  // namesForLevel for every recorded level, computed or not.
  const levels = fs.readdirSync(path.join(SIDECAR, 'templates')).map((f) => f.replace(/\.json$/, '')).sort();
  for (const lv of [...levels, 'no_such_level', '']) {
    for (const [mod, mode] of [['bf1942', 'coop.con'], [null, null]]) {
      const n = namesForLevel(`bf1942/levels/${lv}/`, { mod, mode });
      put(`names ${lv} ${mod}`, { computed: n.computed, tidNames: n.tidNames, tidClasses: n.tidClasses ? Object.keys(n.tidClasses).length : null, anim: n.animStates?.length ?? null, cpNames: n.cpNames });
    }
  }
  put('fromRecording', tidNamesFromRecording([
    JSON.stringify({ e: 'setLevel', level: 'bf1942/levels/wake/' }), JSON.stringify({ e: 'serverInfo', mod: 'bf1942' }), 'garbage',
    JSON.stringify({ k: 'e', e: 'createObject', tid: 12, tmpl: 'Sherman' }), JSON.stringify({ k: 'o', tid: 3, tmpl: 'Zero' }),
    JSON.stringify({ k: 'anim', states: [[0, 'a', 0]] }), JSON.stringify({ k: 'cp', tmpl: 'X', name: 'Village' })].join('\n')));
  // Classes.
  const NAMES = ['Sherman', 'sherman', 'M3A1', 'GermanSoldier', 'GrenadeAlliesProjectile', 'MultiPlayerFreeCamera', 'Jap_AT', 'US_Assault_Desert',
    'ALLIES_north_village', 'allies_north_village', 'Flag', null, '', 'NothingAtAll', 'Medic', 'xMedic', 'Scout_Winter'];
  const cps = controlPointTemplates('wake', { ALLIES_north_village: 'Village', AXIS_base: 'Base' });
  put('cpTemplates', [...cps]);
  put('classes', NAMES.map((n) => [classForTemplate(n, cps), classForTemplate(n, null), classForTemplate(n, cps, 'Bundle'), classForTemplate(n, null, 'lodobject'), classForTemplate(n, null, 'NoSuchClass')]));
  put('fromClass', ['Wing', 'wing', 'HANDFIREARMS', 'Particle', '', null, 'x'].map((c) => classFromTemplateClass(c)));
  put('cpNameOf', [[{ ALLIES_base: 'Airfield' }, 'ALLIES_base'], [{ ALLIES_base: 'Airfield' }, 'allies_BASE'], [{ ALLIES_base: 'Airfield' }, 'x'], [null, 'x'], [{ a: 'b' }, ''], [{ a: null, A: 'z' }, 'a']]
    .map(([m, t]) => cpNameOf(m, t) ?? 'undefined'));
  fs.writeFileSync(process.argv[3], JSON.stringify(out));
  process.exit(0);
}

ensureTables();
const result = {};
for (const [mode, tables] of [['--prepare', false], ['--lookups', true], ['--lookups', false]]) {
  const cache = scratchCache(tables);
  const file = path.join(cache, 'out.json.tmp');
  runNode([path.join(HERE, 'tables.mjs'), mode, file], cache);
  result[`${mode.slice(2)}${mode === '--lookups' ? (tables ? 'Tables' : 'Bare') : ''}`] = JSON.parse(fs.readFileSync(file, 'utf8'));
  fs.rmSync(cache, { recursive: true, force: true });
}
writeGz(path.join(RES, 'tables.json.gz'), JSON.stringify(result));
console.log(Object.entries(result).map(([k, v]) => `${k} ${v.length}`).join(', '));
