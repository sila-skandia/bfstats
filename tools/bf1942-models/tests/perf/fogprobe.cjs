#!/usr/bin/env node
// The fog the page draws a level with, against the client's rule (ledger
// FOG-4, `bf42/level.py` `engine_set_view_distance`): per level, the scene
// fog's near and far, the water shader's pair, the far plane, and every
// material that compiled without the scene fog. One headless Chromium for all
// the levels, closed at the end (pageprobe.cjs).
//
//   node fogprobe.cjs --base http://localhost:5412 \
//     --levels bf1942:wake:75:450,bf1942:omaha_beach:25:250,fhsw:battle_of_foy:37.5:300 --out shots/
//
// `mod:map:start:end[:x:z:yaw]`, the two numbers the rule gives (omit them to
// only read). With `--out` and a view, a frame from the free camera 1.8 m
// over the ground at x, z looking along yaw, for setting beside a retail
// capture. Exit 0 when every
// level's fog matched within 0.01 m, 1 otherwise, 2 when nothing loaded.
const path = require('node:path');
const fs = require('node:fs');
const { parseArgs, withPage } = require('./pageprobe.cjs');

const opts = parseArgs({ base: 'http://localhost:5412',
  levels: 'bf1942:wake:75:450,bf1942:omaha_beach:25:250,fhsw:battle_of_foy:37.5:300', out: '', w: 1280, h: 720 });

async function main() {
  return withPage({ base: opts.base, w: opts.w, h: opts.h }, async probe => {
    const { ev, step } = probe;
    const rows = [], failures = [];
    for (const spec of opts.levels.split(',')) {
      const [mod, map, start, end, vx, vz, vyaw] = spec.split(':');
      await probe.open({ mod, map, botCount: '0' });
      await step(20);
      const r = await ev(() => {
        const s = window.__scene, fog = s.fog;
        let fogless = 0, fogged = 0; const examples = new Set();
        s.traverse(o => {
          if (!o.isMesh || !o.visible) return;
          for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
            if (!m) continue;
            if (m.fog === false || (m.isShaderMaterial && !m.fog && !m.uniforms?.fogNear)) { fogless++; if (examples.size < 8) examples.add(`${o.name}:${m.type}`); }
            else fogged++;
          }
        });
        const water = [];
        s.traverse(o => { const u = o.material?.uniforms; if (u?.fogNear) water.push([u.fogNear.value, u.fogFar.value]); });
        return { near: fog?.near ?? null, far: fog?.far ?? null, color: fog ? fog.color.getHexString() : null,
          cameraFar: window.__camera.far, water: water.slice(0, 3), fogged, fogless, foglessExamples: [...examples] };
      });
      const row = { mod, map, rule: start ? [Number(start), Number(end)] : null, ...r };
      rows.push(row);
      if (row.rule && (Math.abs(row.near - row.rule[0]) > 0.01 || Math.abs(row.far - row.rule[1]) > 0.01)) {
        failures.push(`${mod}/${map}: page fog ${row.near}..${row.far}, rule ${row.rule[0]}..${row.rule[1]}`);
      }
      for (const [n, f] of row.water) if (Math.abs(n - row.near) > 0.01 || Math.abs(f - row.far) > 0.01) failures.push(`${mod}/${map}: water fog ${n}..${f}`);
      if (opts.out && vx) {
        // A fixed view (`x:z:yaw`, the free camera 1.8 m over the ground),
        // for setting beside a retail capture of the same place.
        await ev(() => { window.__setOnFoot?.(false); window.__setFly?.(true); window.__deploy?.cancel?.(); });
        await step(30);
        const shot = await ev(([x, z, yaw, w, h]) => {
          const g = window.__groundAt?.(x, z);
          window.__camera.position.set(x, (Number.isFinite(g) ? g : 0) + 1.8, z);
          window.__look.yaw = yaw; window.__look.pitch = 0;
          for (let i = 0; i < 3; i++) window.__renderOnce(w, h, 1 / 60);
          return { ground: g, url: window.__renderer.domElement.toDataURL('image/jpeg', 0.85) };
        }, [Number(vx), Number(vz), Number(vyaw), opts.w, opts.h]);
        row.view = { x: Number(vx), z: Number(vz), yaw: Number(vyaw), ground: shot.ground };
        fs.mkdirSync(opts.out, { recursive: true });
        fs.writeFileSync(path.join(opts.out, `${mod}-${map}.jpg`), Buffer.from(shot.url.split(',')[1], 'base64'));
      }
    }
    const report = { rows, failures, pageErrors: probe.errors.slice(0, 10) };
    console.log(JSON.stringify(report, null, 1));
    if (opts.out) { fs.mkdirSync(opts.out, { recursive: true }); fs.writeFileSync(path.join(opts.out, 'fog.json'), JSON.stringify(report, null, 1)); }
    return rows.length ? (failures.length ? 1 : 0) : 2;
  });
}

main().then(code => process.exit(code), e => { console.error(e); process.exit(2); });
