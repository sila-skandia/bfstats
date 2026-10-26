// Writes core/src/test/resources/parity/body-decoder.json.gz: BodyDecoder
// (body-decoder.mjs) as the session and the rebuild drive it, record by
// record, with every decoded record printed whole (cls, body, pos, rot, seat):
//   - sessions: the committed rebuild inputs, rows and records in time order;
//   - the bodies of tests/sidecar_body_harness.mjs (a rotation-only body, a
//     soldier who stops);
//   - the level-table lookups of sidecar_template_table_harness.mjs and
//     sidecar_game_tables_harness.mjs (the decoder's tid names, a mod's
//     animation count and control points).
// Run against the committed tables (lib/tables.mjs), in a child per case so each
// starts as a fresh process.
//   node parity/body-decoder.mjs
import fs from 'node:fs';
import path from 'node:path';
import { RES, SIDECAR, HERE, gunzip, writeGz, ensureTables, scratchCache, runNode } from './lib/tables.mjs';

if (process.argv[2] === '--case') {
  const { BodyDecoder } = await import(path.join(SIDECAR, 'body-decoder.mjs'));
  const { classForTemplate } = await import(path.join(SIDECAR, 'template-class.mjs'));
  const which = process.argv[3];
  const out = [];
  if (which === 'harness') {
    const d = new BodyDecoder();
    d.note({ e: 'createObject', netId: 622, tid: 1754 });
    d.note({ e: 'control', pid: 1, netId: 622 });
    const recs = [
      { netId: 622, hex: 'fd39d1852c002492fcfffdfffdfffdfffdff05800800007e000000001000', bodyBits: 237, ref: [1004.2355346679688, 105.24522399902344, 843.558349609375] },
      { netId: 622, hex: '0400ff7f54acff7f', bodyBits: 64 },
    ];
    for (const r of recs) { d.decode(r); out.push(JSON.stringify(r)); }
    d.note({ e: 'control', pid: 2, netId: 1111 });
    const ref = [870, 97, 873];
    for (const r of [{ netId: 1111, hex: '0500d26b4989ac26b2856ad42689feff75fcffff01', bodyBits: 162, ref },
      { netId: 1111, hex: '05004c6e4989bc26b2850aca2689feff75fcffff01', bodyBits: 162, ref },
      { netId: 1111, hex: '6080ef8407', bodyBits: 37, ref }]) { d.decode(r); out.push(JSON.stringify(r)); }
  } else if (which === 'tables') {
    const dc = new BodyDecoder();
    dc.note({ e: 'serverInfo', mapId: 'BF1942', mod: 'bf1942', gameId: 'BF1942' });
    dc.note({ e: 'setLevel', level: 'bf1942/levels/el_alamein/', mode: 'coop.con' });
    dc.note({ e: 'createObject', netId: 700, tid: 2914 });
    out.push(JSON.stringify({ info700: dc.info(700), cls700: dc.classOf(700), animStates: dc.animStates, level: dc.level }));
    const d2 = new BodyDecoder();
    d2.note({ e: 'serverInfo', mapId: 'BF1942', mod: 'desertcombat', gameId: 'DC' });
    d2.note({ e: 'setLevel', level: 'bf1942/levels/el_alamein/', mode: 'conquest.con' });
    out.push(JSON.stringify({ animStates: d2.animStates, cpTemplates: [...d2.cpTemplates].sort(), cpClass: classForTemplate('SouthOpenBase', d2.cpTemplates)?.objectClass ?? null }));
    const fixed = new BodyDecoder({ animStates: 1395 });
    fixed.note({ e: 'serverInfo', mod: 'desertcombat' });
    fixed.note({ e: 'setLevel', level: 'bf1942/levels/el_alamein/', mode: 'conquest.con' });
    out.push(JSON.stringify({ fixed: fixed.animStates }));
    // A level nobody baked: the recorded fallback names, the vanilla specs.
    const d3 = new BodyDecoder();
    d3.note({ e: 'serverInfo', mod: 'bf1942' });
    d3.note({ e: 'setLevel', level: 'bf1942/levels/tobruk/', mode: 'coop.con' });
    for (const tid of [1571, 2916, 1754, 1325]) { d3.note({ e: 'createObject', netId: 5000 + tid, tid }); out.push(JSON.stringify({ tid, info: d3.info(5000 + tid), cls: d3.classOf(5000 + tid) })); }
  } else {
    // A session: rows and framed records in time order, as rebuild.mjs feeds them.
    const parse = (l) => { try { return JSON.parse(l); } catch { return null; } };
    const rec = gunzip(path.join(RES, 'rebuild', `${which}.rec.ndjson.gz`)).split('\n').filter(Boolean).map(parse).filter(Boolean);
    const review = gunzip(path.join(RES, 'rebuild', `${which}.review.ndjson.gz`)).split('\n').filter(Boolean).map(parse).filter(Boolean);
    const tl = [];
    for (const r of rec) if (r.k === 'e') tl.push([r.t ?? 0, 0, r]);
    for (const d of review) if (d.tag === 'ghost-record') tl.push([d.dt, 1, { netId: d.netId, action: d.action, bodyBits: d.bodyBits, hex: d.hex, ...(d.ref ? { ref: d.ref } : {}) }]);
    tl.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const anim = rec.find((r) => r.k === 'anim')?.states?.length ?? 0;
    const d = new BodyDecoder({ animStates: anim });
    let n = 0;
    for (const [, kind, x] of tl) {
      if (kind === 0) { d.note(x); continue; }
      if (x.action !== 1 || !x.hex) continue;
      let threw = null;
      try { d.decode(x); } catch (e) { threw = e.message; }
      if (n++ % 8 === 0) out.push(JSON.stringify(threw ? { threw } : x));
    }
  }
  fs.writeFileSync(process.argv[4], JSON.stringify(out));
  process.exit(0);
}

ensureTables();
const cases = {};
for (const which of ['harness', 'tables', 'run', 'm3a1', 'zero_sherman', 'player_stats', 'fire_line', 'detonate']) {
  const cache = scratchCache(which !== 'harness');
  const file = path.join(cache, 'out.json');
  runNode([path.join(HERE, 'body-decoder.mjs'), '--case', which, file], cache);
  cases[which] = JSON.parse(fs.readFileSync(file, 'utf8'));
  fs.rmSync(cache, { recursive: true, force: true });
}
writeGz(path.join(RES, 'body-decoder.json.gz'), JSON.stringify(cases));
console.log(Object.entries(cases).map(([k, v]) => `${k} ${v.length}`).join(', '));
