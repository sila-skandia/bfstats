#!/usr/bin/env node
// The tank school's pairings across games and mods (features/battle-schools,
// "Checked across the mods"): for each tree, the tanks its arenas offer
// (`viewer/tank-arena.js`), each tank's main gun (`pickMainGun`), and what
// each gun does to the other's hull: how many of its plate materials take
// damage and the shots to kill from the front, side and rear
// (`viewer/tank-armour.js`), or why it does nothing (no gun found, a round
// the damage table lacks, no hit faces, or no line for the pair: the last is
// the game's armour, the others a hole in what was extracted).
//
// It reads the published trees from mesh.bfstats.io (models.json, maps.json,
// _shared/vehicle-ai.json and damage.json, and each tank's glb), cached in
// <cache dir>, so it needs no local extraction.
//
//   node surveys/tank_school_pairs.mjs <cache dir> bf1942,xpack1,fh,fhsw,...
//
// Writes <cache dir>/../tank-pairs.json and prints a line per pairing.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { installModuleHooks } from '../sim/env.mjs';
const T = join(dirname(fileURLToPath(import.meta.url)), '..') + '/';
installModuleHooks(T + 'viewer');
const load = rel => import(pathToFileURL(T + rel).href);
const { buildSceneTree } = await load('server/glb-scene.mjs');
const A = await load('viewer/tank-arena.js');
const R = await load('viewer/tank-armour.js');
const CACHE = process.argv[2];
const MODS = process.argv[3].split(',');
const SITE = 'https://mesh.bfstats.io/';
mkdirSync(CACHE, { recursive: true });
async function get(path, kind = 'json') {
  const f = `${CACHE}/${path.replace(/[\/]/g, '__')}`;
  if (!existsSync(f)) {
    const r = await fetch(SITE + path, { headers: { 'User-Agent': 'bfstats-tank-school-sweep' } });
    if (!r.ok) return null;
    writeFileSync(f, Buffer.from(await r.arrayBuffer()));
  }
  const b = readFileSync(f);
  return kind === 'json' ? JSON.parse(b.toString('utf8')) : b;
}
function parseGlb(buf) {
  const n = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + n).toString('utf8'));
  const off = 20 + n; const bl = buf.readUInt32LE(off);
  return { json, bin: buf.subarray(off + 8, off + 8 + bl) };
}
const mods = (await get('models/mods.json')).mods ?? await get('models/mods.json');
const out = {};
for (const id of MODS) {
  const m = mods.find(x => x.id === id); if (!m) { console.log(id, 'no such mod'); continue; }
  const [rows, levels, aiDoc, tables] = await Promise.all([get(`${m.paths.models}/models.json`), get(`${m.paths.maps}/maps.json`), get(`${m.paths.maps}/_shared/vehicle-ai.json`), get(`${m.paths.maps}/_shared/damage.json`)]);
  if (!rows) { console.log(`\n=== ${id}: no models.json`); continue; }
  const ai = aiDoc?.vehicles ?? null;
  const arenas = A.arenasFrom(rows, levels ? levels.map(l => l.name) : null, ai);
  const byName = new Map(rows.map(r => [r.name, r]));
  const tanks = new Map();
  async function tank(name) {
    if (tanks.has(name)) return tanks.get(name);
    const row = byName.get(name);
    let buf = await get(`${m.paths.models}/${row.glb}`, 'bin');
    if (!buf && row.sha) buf = await get(`glbs/${row.sha}.glb`, 'bin');
    if (!buf) buf = await get(`models/${row.glb}`, 'bin');
    if (!buf) { const t = { name, error: 'no glb' }; tanks.set(name, t); return t; }
    const { json, bin } = parseGlb(buf);
    const root = buildSceneTree(json, bin).root;
    const fire = []; let hp = Number(row.hitpoints);
    root.traverse(o => { if (o.userData?.templateKind === 'FireArms') fire.push(o); if (o.userData?.armor?.hitpoints) hp = Number(o.userData.armor.hitpoints); });
    const wanted = A.mainGunName(row, ai);
    const gun = A.pickMainGun(fire, wanted);
    const faces = R.collisionFaces(root);
    const mats = [...new Set(faces.map(f => f.material))];
    const t = { name, root, hp, wanted, gun: gun?.name ?? null, shell: gun?.userData?.fireArms?.projectile?.material ?? null,
      speed: gun?.userData?.fireArms?.velocity ?? null, faces: faces.length, mats, equip: ai?.[name]?.equipmentType ?? null, worth: ai?.[name]?.basicTemp ?? null };
    tanks.set(name, t); return t;
  }
  const res = { arenas: arenas.length, tanks: {}, pairs: [] };
  const seenPair = new Set();
  for (const a of arenas.slice(0, 8)) {
    const al = a.allied.slice(0, 2), ax = a.axis.slice(0, 2);
    for (const x of al) for (const y of ax) {
      if (x.template === y.template) continue;
      const key = `${x.template}|${y.template}`; if (seenPair.has(key)) continue; seenPair.add(key);
      const tx = await tank(x.template), ty = await tank(y.template);
      const one = (att, def) => {
        if (att.error || def.error) return { why: att.error || def.error };
        if (att.shell == null) return { why: `no main gun found (wanted ${att.wanted})` };
        const shellRow = tables?.materials?.[att.shell];
        if (!shellRow) return { why: `shell material ${att.shell} not in the damage table` };
        const price = R.pricer(tables, att.shell);
        if (!def.faces) return { why: 'target has no collision faces' };
        const priced = def.mats.map(mm => [mm, Math.round(price(mm) * 10) / 10]);
        const hurt = priced.filter(p => p[1] > 0);
        const noDef = def.mats.filter(mm => mm != null && !tables.materials?.[mm]);
        const rose = R.bearingShots(def.root, price, def.hp, { bearings: [0, 90, 180], step: 0.2 });
        const r = rose ? [0, 90, 180].map(b => rose[b]?.shots ?? '-').join('/') : '-';
        return { hurt: hurt.length, of: priced.length, priced, noDef, rose: r,
          why: hurt.length ? null : (noDef.length === priced.length ? 'target plates not in the damage table' : `no damage line for shell ${att.shell} (${shellRow.label ?? ''}) against any plate`) };
      };
      res.pairs.push({ arena: a.name, a: x.template, b: y.template, aOnB: one(tx, ty), bOnA: one(ty, tx) });
    }
  }
  for (const [n, t] of tanks) res.tanks[n] = { gun: t.gun, wanted: t.wanted, shell: t.shell, speed: t.speed, hp: t.hp, faces: t.faces, mats: t.mats, equip: t.equip, worth: t.worth, error: t.error };
  res.allTanks = [...new Set(arenas.flatMap(a => a.tanks.map(t => t.template)))];
  out[id] = res;
  console.log(`\n=== ${id}: ${arenas.length} arenas, ${res.allTanks.length} tanks`);
  console.log('tanks:', res.allTanks.slice(0, 60).join(', '));
  for (const p of res.pairs) {
    const f = s => s.why && !s.hurt ? `NONE (${s.why})` : `${s.hurt}/${s.of} plates, shots f/s/r ${s.rose}`;
    console.log(`  [${p.arena}] ${p.a} -> ${p.b}: ${f(p.aOnB)} | ${p.b} -> ${p.a}: ${f(p.bOnA)}`);
  }
  for (const [n, t] of Object.entries(res.tanks)) if (!t.gun || !t.faces) console.log(`  !! ${n}: gun ${t.gun} (wanted ${t.wanted}) faces ${t.faces}`);
}
writeFileSync(`${CACHE}/../tank-pairs.json`, JSON.stringify(out, (k, v) => (k === 'root' ? undefined : v), 1));
