#!/usr/bin/env node
// Does everything the page mounts on a soldier wear the level's paint? A
// level's `textureManager.alternativePath` folders repaint the models that
// were extracted with no level loaded (ledger LOAD-3, `level-skin.js`); this
// counts, per surface in the live scene, the colour maps still holding an
// image the level reads from another file (`unpainted`) and those holding the
// level's file (`painted`). One headless Chromium, closed at the end.
//
//   node levelpaint.cjs --base http://localhost:5412 --mod fhsw --map battle_of_foy
//   node levelpaint.cjs --base http://localhost:5426 --mod bf1942 --map tobruk --wreck 6
//   node levelpaint.cjs --mod fhsw --map arnhem-1944 \
//     --replay replays/20261013-212407-fhsw-arnhem-coop-rec/replay_1791890719.ndjson
//
// Surfaces: the first-person arms (the control: painted since 3d54df9e),
// bots on foot (`bot <name>`), a kit laid on the ground for each side
// (`kitDrop`), the body in a seat (`seatPose`, from the nearest hull the
// probe can enter), the multiplayer room's remote soldiers (`remote soldier`)
// and anything else (`other`: placed vehicles, deployables, rounds). With
// `--replay` the level is the recording's and the bots are its players.
// Exit 0 when no surface but `other` holds an unpainted map, 1 otherwise,
// 2 when the level has no skin row.
const path = require('node:path');
const fs = require('node:fs');
const { parseArgs, withPage, sleep } = require('./pageprobe.cjs');

const opts = require.main !== module ? {} : parseArgs({ base: 'http://localhost:5412', mod: 'fhsw', map: 'battle_of_foy', bots: 4, replay: '',
  seat: true, deploy: '', wreck: 0, code: '', out: '', w: 960, h: 600 });

function count() {
  return (async () => {
    const tree = window.__probeTree, level = window.__probeLevel;
    const skins = await (await fetch(`${tree}/viewmodels/skins.json`)).json();
    const row = skins.levels?.[level];
    if (!row) return { error: `no skin row for ${level} in ${tree}` };
    const key = n => String(n ?? '').replace(/\\/g, '/').toLowerCase();
    const K = new Set(Object.keys(row.textures).map(key));
    const V = new Set(Object.values(row.textures).map(key));
    const surfaces = {};
    const surfaceOf = o => {
      for (let p = o; p; p = p.parent) {
        if (/^wreck:/.test(p.name)) return 'wreck';
        if (p.userData?.kitDrop != null) return 'kitDrop';
        if (p.userData?.deployed != null) return 'deployed';
        if (p.userData?.seatPose) return 'seatPose';
        if (/^remote soldier /.test(p.name)) return 'remoteSoldier';
        if (/^replay round /.test(p.name)) return 'replayRound';
        if (/^bot /.test(p.name)) return 'bot';
      }
      return 'other';
    };
    const add = (surface, o, painted, name) => {
      const s = surfaces[surface] ??= { meshes: 0, painted: 0, unpainted: 0, unpaintedImages: {} };
      if (painted === true) s.painted++;
      else if (painted === false) {
        s.unpainted++; s.unpaintedImages[name] = (s.unpaintedImages[name] || 0) + 1;
        // Which object: the topmost named ancestor under the scene.
        let top = o; while (top.parent && top.parent.parent) top = top.parent;
        const at = [top.name, o.parent?.parent?.name, o.parent?.name].filter(Boolean).join(' / ');
        (s.unpaintedObjects ??= {})[at] = (s.unpaintedObjects[at] || 0) + 1;
      }
    };
    const seen = new Set();
    const visit = (root, forced) => root?.traverse(o => {
      if (!o.isMesh || seen.has(o)) return;
      seen.add(o);
      const surface = forced ?? surfaceOf(o);
      (surfaces[surface] ??= { meshes: 0, painted: 0, unpainted: 0, unpaintedImages: {} }).meshes++;
      for (const m of [o.material].flat()) {
        const n = key(m?.map?.name);
        if (!n) continue;
        if (K.has(n) && !V.has(n)) add(surface, o, false, n);
        else if (V.has(n) || K.has(key(m.name))) add(surface, o, true, n);
      }
    });
    visit(window.__rig?.(), 'arms');
    visit(window.__scene);
    return { level, images: K.size, surfaces };
  })();
}

async function main() {
  return withPage({ base: opts.base, w: opts.w, h: opts.h, code: opts.code }, async probe => {
    const { ev, step } = probe;
    const params = { mod: opts.mod, map: opts.map, botCount: String(opts.replay ? 0 : opts.bots) };
    if (opts.replay) params.replay = opts.replay;
    await probe.open(params);
    await ev(([tree, level]) => { window.__probeTree = tree; window.__probeLevel = level; },
      [opts.mod === 'bf1942' ? 'models' : `models/mods/${opts.mod}`, opts.map.toLowerCase()]);
    const notes = {};
    if (opts.replay) {
      // Let the recording's players come on.
      for (let i = 0; i < 20; i++) { await step(30); await sleep(500); }
    } else {
      notes.spawn = await probe.spawn(2);
      await probe.settleWeapon(null, 300);
      // A kit of each side on the ground at his feet: every row of the
      // level's two sides, laid out a metre apart.
      notes.laid = await ev(async ([mapsBase, level]) => {
        const s = window.__soldier();
        const lo = await (await fetch(`${mapsBase}/_shared/loadouts.json`)).json();
        const row = lo.levels?.[level] ?? {};
        const kits = [1, 2].flatMap(t => Object.values(row[t]?.slots ?? {}));
        return kits.map((kit, i) => ({ kit, at: window.__kitDrops.layDown(kit, s.x + 2 + i, s.y + 1, s.z + 2) }));
      }, [opts.mod === 'bf1942' ? 'maps' : `maps/mods/${opts.mod}`, opts.map.toLowerCase()]);
      for (let i = 0; i < 4; i++) { await step(20); await sleep(300); }
      if (opts.deploy) {
        // `--deploy team:kitRow`: respawn with that kit, raise its deployable
        // item and use it where he stands (a horse, an MG tripod, a mortar).
        const [team, kit] = opts.deploy.split(':');
        await ev(() => window.__damage?.(1e6));
        await step(30);
        notes.deploySpawn = await probe.spawn(Number(team), kit);
        await probe.settleWeapon(null, 300);
        notes.deploy = await ev(async () => {
          const dep = window.__deployables?.table?.();
          const names = new Set(Object.keys(dep?.weapons ?? {}).map(n => n.toLowerCase()));
          const slot = (window.__kitRotation().slots || []).find(s => names.has(String(s.weapon).toLowerCase()));
          if (!slot) return { error: 'no deployable item in the kit', slots: window.__kitRotation().slots };
          window.__selectKitWeapon(slot.slot);
          return { slot };
        });
        for (let i = 0; i < 10; i++) { await step(20); await sleep(200); }
        await ev(() => window.__setTrigger(true));
        await step(90);
        await ev(() => window.__setTrigger(false));
        for (let i = 0; i < 15; i++) { await step(20); await sleep(300); }
        notes.deployed = await ev(() => window.__deployables?.placed?.());
      }
      if (opts.seat && opts.seat !== 'false') {
        // The nearest hull with a seat this side may take, entered, and the
        // chase view so the body in the seat is drawn.
        notes.seat = await ev(() => {
          const s = window.__soldier();
          const v = window.__vehicles().filter(v => v.pos && !v.destroyed)
            .sort((a, b) => Math.hypot(a.pos[0] - s.x, a.pos[2] - s.z) - Math.hypot(b.pos[0] - s.x, b.pos[2] - s.z));
          for (const h of v.slice(0, 6)) {
            window.__setFly?.(true);
            window.__teleport(h.pos[0] + 3, h.pos[1] + 1, h.pos[2], 0);
            if (window.__enterOwner(h.owner)) return { entered: h.name, template: h.template ?? null };
          }
          return { entered: null };
        });
        for (let i = 0; i < 10; i++) { await step(20); await sleep(300); }
        if (notes.seat.entered) {
          await ev(() => window.__setView?.('chase'));
          for (let i = 0; i < 10; i++) { await step(20); await sleep(300); }
          notes.seat.soldier = await ev(() => window.__seatSoldier?.());
        }
      }
    }
    if (Number(opts.wreck) > 0) {
      // `--wreck N`: destroy the first N hulls the level placed, and count the
      // wrecks the page stood in their place (`vehicle-wrecks.js`
      // `placeWreck`, from the models tree, painted by `wearPagePaint`).
      notes.wrecked = await ev(n => window.__vehicles().filter(v => !v.destroyed).slice(0, n)
        .map(v => ({ owner: v.owner, name: v.name, hit: window.__damageVehicle(v.owner, 1e6) && true })),
      Number(opts.wreck));
      for (let i = 0; i < 15; i++) { await step(20); await sleep(300); }
    }
    notes.kitMeshes = await ev(() => window.__kitDrops?.meshes?.() ?? null);
    const result = await ev(count);
    if (result.error) { console.log(JSON.stringify(result)); return 2; }
    const failures = [];
    for (const [surface, s] of Object.entries(result.surfaces)) {
      if (surface !== 'other' && s.unpainted) failures.push(`${surface}: ${s.unpainted} unpainted (${Object.keys(s.unpaintedImages).join(', ')})`);
    }
    const report = { mod: opts.mod, map: opts.map, replay: opts.replay || null, notes, ...result, failures, pageErrors: probe.errors.slice(0, 10) };
    console.log(JSON.stringify(report, null, 1));
    if (opts.out) {
      fs.mkdirSync(opts.out, { recursive: true });
      fs.writeFileSync(path.join(opts.out, `paint-${opts.map}${opts.replay ? '-replay' : ''}.json`), JSON.stringify(report, null, 1));
      await probe.capture(path.join(opts.out, `paint-${opts.map}${opts.replay ? '-replay' : ''}.jpg`));
    }
    return failures.length ? 1 : 0;
  });
}

if (require.main === module) main().then(code => process.exit(code), e => { console.error(e); process.exit(2); });
module.exports = { countPaint: count };
