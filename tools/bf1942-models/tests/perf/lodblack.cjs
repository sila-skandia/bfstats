#!/usr/bin/env node
// Does a lightmapped building go dark as its LODs come in? One headless
// Chromium, closed at the end (pageprobe.cjs). Two readings per level:
//
//   bound        every mesh in the scene the page bound a lightmap to, and how
//                many of them carry lightmap UVs that are one point (the
//                vanilla far LODs whose second UV set is all 0, 0: bound,
//                they sample the atlas's unlit corner and draw black)
//   walks        per building instance, the camera stepped out from the
//                box (`--dists`, metres) at eye height, looking at the point
//                a cast from the eye lands on the building, and the mean
//                sRGB luminance of the 12 x 12 pixels about it
//
//   node lodblack.cjs --base http://localhost:5412 --map berlin --match '^citymesh3_m1(_\\d+)?$'
//   node lodblack.cjs --map wake --match '^guardtow_M1$' --out shots/
//
// A walk fails when a step past the first rung reads under `--ratio` (0.5)
// of the nearest step, or under 20 of 255. A facade the probe cannot see
// clear (the first hit of a cast to the box centre is not on the box) is
// skipped and said so. Exit 0 all held, 1 a failure, 2 nothing could be staged.
const path = require('node:path');
const fs = require('node:fs');
const { parseArgs, withPage } = require('./pageprobe.cjs');

const opts = parseArgs({ base: 'http://localhost:5412', mod: 'bf1942', map: 'berlin', match: '^citymesh3_m1(_\\d+)?$',
  dists: '6,10,14,18,24,32,45,60', instances: 4, ratio: 0.5, out: '', w: 960, h: 600 });

async function main() {
  return withPage({ base: opts.base, w: opts.w, h: opts.h }, async probe => {
    const { ev, step } = probe;
    await probe.open({ mod: opts.mod, map: opts.map, botCount: '0' });
    // The free camera; nothing of the player's in the frame.
    await ev(() => { window.__setOnFoot?.(false); window.__setFly?.(true); window.__deploy?.cancel?.(); });
    await step(30);
    const bound = await ev(() => {
      let meshes = 0, onePoint = 0; const names = new Map();
      window.__scene.traverse(o => {
        if (!o.isMesh) return;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        if (!mats.some(m => m?.lightMap)) return;
        meshes++;
        const uv = o.geometry?.getAttribute('uv1');
        let spread = false;
        if (uv) for (let i = 1; i < uv.count && !spread; i++) spread = Math.abs(uv.getX(i) - uv.getX(0)) > 1e-6 || Math.abs(uv.getY(i) - uv.getY(0)) > 1e-6;
        if (!spread) { onePoint++; names.set(o.name, (names.get(o.name) || 0) + 1); }
      });
      return { meshes, onePoint, examples: [...names.entries()].slice(0, 10) };
    });
    const walks = await ev(([pattern, max]) => {
      const T = window.__THREE, re = new RegExp(pattern, 'i'), out = [];
      window.__scene.traverse(o => { if (re.test(o.name) && out.length < max) out.push(o); });
      return out.map(o => {
        o.updateWorldMatrix(true, true);
        const box = new T.Box3().setFromObject(o, true);
        const c = box.getCenter(new T.Vector3()), s = box.getSize(new T.Vector3());
        return { name: o.name, centre: c.toArray(), size: s.toArray(), min: box.min.toArray(), max: box.max.toArray(),
        };
      });
    }, [opts.match, opts.instances]);
    if (!walks.length) { console.log(JSON.stringify({ map: opts.map, bound, error: `no node matches ${opts.match}` })); return 2; }
    const dists = opts.dists.split(',').map(Number);
    const failures = [];
    for (const wk of walks) {
      // A heading and a point on the box whose cast from the farthest step
      // lands on the box first: the probe looks at a surface of the building
      // itself, whatever its shape (a guard tower is mostly air).
      const pick = await ev(([wk, far]) => {
        const [cx, , cz] = wk.centre;
        const inBox = p => [0, 1, 2].every(i => p[i] > wk.min[i] - 0.3 && p[i] < wk.max[i] + 0.3);
        const heights = [wk.max[1] - 1.5, wk.min[1] + (wk.max[1] - wk.min[1]) * 0.5, wk.min[1] + 2];
        for (const ty of heights) for (let a = 0; a < 8; a++) {
          const yaw = a * Math.PI / 4, dx = Math.sin(yaw), dz = Math.cos(yaw);
          const half = Math.abs(dx) * wk.size[0] / 2 + Math.abs(dz) * wk.size[2] / 2;
          const ex = cx + dx * (half + far), ez = cz + dz * (half + far);
          const g = window.__groundAt?.(ex, ez);
          const ey = Number.isFinite(g) ? g + 1.8 : wk.min[1] + 1.8;
          const hit = window.__castRay([ex, ey, ez], [cx - ex, ty - ey, cz - ez], far + half + 20);
          if (hit && inBox(hit.point)) return { yaw, half, ty };
        }
        return null;
      }, [wk, dists[dists.length - 1]]);
      if (!pick) { wk.skipped = 'no clear line to the building'; continue; }
      Object.assign(wk, { yaw: pick.yaw, aimY: pick.ty, steps: [] });
      for (const d of dists) {
        const r = await ev(([wk, pick, d, w, h]) => {
          const [cx, , cz] = wk.centre, dx = Math.sin(pick.yaw), dz = Math.cos(pick.yaw);
          const ex = cx + dx * (pick.half + d), ez = cz + dz * (pick.half + d);
          const g = window.__groundAt?.(ex, ez);
          const ey = Number.isFinite(g) ? g + 1.8 : wk.min[1] + 1.8;
          const hit = window.__castRay([ex, ey, ez], [cx - ex, pick.ty - ey, cz - ez], d + pick.half + 20);
          const inBox = p => [0, 1, 2].every(i => p[i] > wk.min[i] - 0.3 && p[i] < wk.max[i] + 0.3);
          if (!hit || !inBox(hit.point)) return { d, occluded: true };
          const [px0, py0, pz0] = hit.point;
          window.__camera.position.set(ex, ey, ez);
          window.__look.yaw = Math.atan2(px0 - ex, pz0 - ez);
          window.__look.pitch = Math.atan2(py0 - ey, Math.hypot(px0 - ex, pz0 - ez));
          for (let i = 0; i < 3; i++) window.__renderOnce(w, h, 1 / 60);
          const c = document.createElement('canvas'); c.width = w; c.height = h;
          const g2 = c.getContext('2d'); g2.drawImage(window.__renderer.domElement, 0, 0, w, h);
          // The few pixels about the point the cast landed on.
          const px = g2.getImageData(Math.round(w / 2) - 6, Math.round(h / 2) - 6, 12, 12).data;
          let lum = 0; for (let i = 0; i < px.length; i += 4) lum += 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
          return { d, range: +hit.t.toFixed(1), lum: +(lum / (px.length / 4)).toFixed(1) };
        }, [wk, pick, d, probe.w, probe.h]);
        wk.steps.push(r);
        if (opts.out && !r.occluded) await probe.capture(path.join(opts.out, `${opts.map}-${wk.name}-${d}m.jpg`));
      }
      const seen = wk.steps.filter(s => !s.occluded);
      const near = seen[0]?.lum;
      for (const s of seen.slice(1)) {
        if (s.lum < 20 || s.lum < near * opts.ratio) failures.push(`${wk.name} at ${s.d} m: ${s.lum} against ${near} at ${seen[0].d} m`);
      }
    }
    if (bound.onePoint) failures.push(`${bound.onePoint} of ${bound.meshes} lightmapped meshes have one-point lightmap UVs`);
    const report = { map: opts.map, match: opts.match, bound, walks, failures, pageErrors: probe.errors.slice(0, 10) };
    console.log(JSON.stringify(report, null, 1));
    if (opts.out) { fs.mkdirSync(opts.out, { recursive: true }); fs.writeFileSync(path.join(opts.out, `${opts.map}.json`), JSON.stringify(report, null, 1)); }
    return failures.length ? 1 : walks.some(w => w.steps) ? 0 : 2;
  });
}

main().then(code => process.exit(code), e => { console.error(e); process.exit(2); });
