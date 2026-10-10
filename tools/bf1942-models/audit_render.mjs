// Rendered smoke for audit_mod.py: draw what the viewer draws and count the
// pixels that say "something is wrong".
//
//   flock /tmp/claude-1000/chromium.lock \
//     node audit_render.mjs --mod fh --url http://localhost:5303 [--levels] [--max 400]
//
// Models: every vehicle template a baked level places (and, with `--all`, the
// whole manifest) is shown on the model page and its frame read back. A model's
// pixels are the ones that differ from the corner pixel; the verdict is the
// share of them that are pure white, pure magenta or pure black. A pale grey
// ship does not trip it: it must be 255/255/255 within 2 counts.
// Levels (`--levels`): three fixed vantage points per baked level (the three
// first control points, 60 m up, looking at the flag) on `map.html?shots=1`.
//
// One headless Chromium at a time (the owner plays on the same machine): wrap
// the run in `flock /tmp/claude-1000/chromium.lock`. Serve the viewer on a port
// of your own, never 5273.
//
// Exit status 1 when any frame is flagged.

import { chromium } from '../../ui/node_modules/playwright/index.mjs';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : d; };
const flag = n => process.argv.includes(`--${n}`);
const mod = arg('mod', 'fh');
const base = arg('url', 'http://localhost:5303');
const out = arg('out', `audit-render-${mod}`);
const maxModels = Number(arg('max', 100000));
const WHITE_SHARE = Number(arg('white', 0.35));
const MAGENTA_SHARE = Number(arg('magenta', 0.05));
const BLACK_SHARE = Number(arg('black', 0.6));

const mapsRoot = mod === 'bf1942' ? 'viewer/maps' : `viewer/maps/mods/${mod}`;
const levels = existsSync(mapsRoot)
  ? readdirSync(mapsRoot, { withFileTypes: true })
      .filter(d => d.isDirectory() && existsSync(`${mapsRoot}/${d.name}/scene.json`)).map(d => d.name)
  : [];

const placed = new Set();
for (const lv of levels) {
  const sc = JSON.parse(await readFile(`${mapsRoot}/${lv}/scene.json`, 'utf8'));
  for (const s of sc.objectSpawns || []) if (s.vehicle) placed.add(s.vehicle.toLowerCase());
}

await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  args: ['--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 820, height: 500 } });
page.on('pageerror', e => console.error('page error:', e.message));
const modQuery = mod === 'bf1942' ? '' : `?mod=${mod}`;
await page.goto(`${base}/${modQuery}`, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__modelInspector?.getCurrent());

// A second, tiny page used only to decode a PNG into pixel counts.
const analyser = await browser.newPage();
await analyser.setContent('<canvas id=c></canvas>');
async function analyse(png) {
  return analyser.evaluate(async b64 => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.getElementById('c');
    c.width = img.width; c.height = img.height;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    const bg = [d[0], d[1], d[2]];
    let model = 0, white = 0, magenta = 0, black = 0;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], gch = d[i + 1], b = d[i + 2];
      if (Math.abs(r - bg[0]) + Math.abs(gch - bg[1]) + Math.abs(b - bg[2]) < 12) continue;
      model++;
      if (r >= 253 && gch >= 253 && b >= 253) white++;
      else if (r >= 240 && b >= 240 && gch <= 20) magenta++;
      else if (r <= 2 && gch <= 2 && b <= 2) black++;
    }
    return { model, white, magenta, black };
  }, png.toString('base64'));
}

const flagged = [];
const rows = [];
const models = await page.evaluate(() => window.__modelInspector.manifest.map(e => ({
  index: e.index, name: e.name, category: e.category,
  extent: e.dimensions?.maxExtent ?? 0, tris: e.triangles ?? 0,
  variant: Math.max(0, e.variants.findIndex(v => v.glb === e.glb)),
})));
const wanted = models.filter(m => flag('all')
  ? m.category !== 'soldier'
  : placed.has(m.name.toLowerCase())).slice(0, maxModels);
const canvas = page.locator('main canvas');
for (const m of wanted) {
  try {
    await page.evaluate(([i, v]) => window.__modelInspector.showVariant(i, v), [m.index, m.variant]);
    await page.evaluate(() => window.__modelInspector.setPortrait(true));
    await page.waitForTimeout(160);
    const png = await canvas.screenshot();
    const r = await analyse(png);
    const n = Math.max(1, r.model);
    const row = { name: m.name, model: r.model,
      white: r.white / n, magenta: r.magenta / n, black: r.black / n };
    rows.push(row);
    // an empty model is the static audit's finding (`model-draws-nothing`);
    // a composite hundreds of metres across is a few pixels at thumbnail scale
    const tiny = r.model < 200 && m.tris > 0 && m.extent < 80;
    if (tiny || row.white > WHITE_SHARE || row.magenta > MAGENTA_SHARE || row.black > BLACK_SHARE) {
      flagged.push(row);
      await writeFile(`${out}/${m.name.replace(/[^a-z0-9]+/gi, '-')}.png`, png);
    }
  } catch (err) {
    flagged.push({ name: m.name, error: err.message });
  }
}

if (flag('levels')) {
  for (const lv of levels) {
    const sc = JSON.parse(await readFile(`${mapsRoot}/${lv}/scene.json`, 'utf8'));
    const lp = await browser.newPage({ viewport: { width: 800, height: 500 } });
    lp.on('pageerror', e => console.error('page error:', e.message));
    await lp.goto(`${base}/map.html?${mod === 'bf1942' ? '' : `mod=${mod}&`}map=${lv}&shots=1&sound=off`,
      { waitUntil: 'load' });
    try {
      await lp.waitForFunction(() => window.__renderOnce && window.__camera, null, { timeout: 120000 });
    } catch { flagged.push({ name: `level:${lv}`, error: 'no hooks' }); await lp.close(); continue; }
    // the briefing card covers the frame until it is dismissed
    await lp.locator('text=READY').first().click({ timeout: 3000 }).catch(() => {});
    await lp.waitForTimeout(500);
    const pts = (sc.controlPoints || []).slice(0, 3);
    for (const [i, cp] of pts.entries()) {
      const [x, y, z] = cp.position;
      await lp.evaluate(([x, y, z]) => {
        const c = window.__camera;
        c.position.set(x + 40, y + 45, -z + 40);
        c.lookAt(x, y, -z);
        window.__renderOnce(800, 500);
      }, [x, y, z]);
      const png = await lp.screenshot();
      const r = await analyse(png);
      const n = Math.max(1, r.model);
      const row = { name: `level:${lv}:cp${i}`, model: r.model,
        white: r.white / n, magenta: r.magenta / n, black: r.black / n };
      rows.push(row);
      if (row.magenta > MAGENTA_SHARE || row.white > 0.5) {
        flagged.push(row);
        await writeFile(`${out}/level-${lv}-cp${i}.png`, png);
      }
    }
    await lp.close();
  }
}

await browser.close();
console.log(`rendered ${rows.length} frames (${wanted.length} models${flag('levels') ? `, ${levels.length} levels` : ''}); flagged ${flagged.length}`);
for (const f of flagged) {
  console.log(f.error ? `  ${f.name}: ${f.error}`
    : `  ${f.name}: ${f.model} px, white ${(f.white * 100).toFixed(0)}%, magenta ${(f.magenta * 100).toFixed(0)}%, black ${(f.black * 100).toFixed(0)}%`);
}
process.exit(flagged.length ? 1 : 0);
