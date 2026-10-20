#!/usr/bin/env node
// Capture one level's asset set into `maps/<level>/assets.json`, the manifest
// `viewer/asset-prefetch.js` reads as a level opens
// (features/asset-batch-downloads).
//
//   node capture_level_assets.mjs --level aberdeen [--mod bf1942]
//        [--base http://127.0.0.1:5273] [--url <map.html?...>] [--out <path>]
//        [--quiet-ms 4000] [--timeout-ms 180000] [--dry-run]
//
// The set is not derivable from the tree without re-implementing the page's
// model resolution (which tree, which level paint, which cockpit/wreck
// variant, which pose), so it is recorded from the page itself: one headless
// load of the level on a local `serve_viewer.py`, every same-origin asset
// response kept. Paths are written root-absolute (`/textures/...`) because
// that is the URL the browser will later ask for, so the prefetch's fetch is a
// cache hit on the page's own request.
//
// Run against a LOCAL viewer, never the live host: the capture must see the
// files that will publish beside it. `--dry-run` prints the set and writes
// nothing.
//
// The page is served by `serve_viewer.py <port>` from the viewer directory;
// Playwright comes from `ui/node_modules`, found the same way
// `audit_replay_assets.mjs` finds it.

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const VIEWER = resolve(HERE, 'viewer');
const log = (...a) => console.error('[level-assets]', ...a);

const arg = (name, fallback = null) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : (process.argv[i + 1]?.startsWith('--') ? true : process.argv[i + 1]);
};
const flag = name => process.argv.includes(`--${name}`);

/** Asset trees the manifest covers. Page modules, the API and the recording
 *  are not a level's assets: they are the shell, and every page load has
 *  them already. */
function isLevelAsset(path) {
  return /^\/(?:textures|glbs)\//.test(path) || /^\/(?:models|maps)\//.test(path);
}

/** Keep the level's own directory, the shared trees it reads, and drop any
 *  other level's files (the feed's thumbnails name other maps). */
function belongsTo(path, mapsBase, dir) {
  if (!isLevelAsset(path)) return false;
  if (/^\/textures\/|^\/glbs\//.test(path)) return /^\/(?:textures|glbs)\/[a-f0-9]{2}\/[^/]+$/.test(path)
    || /^\/glbs\/[a-f0-9]{64}\.glb$/.test(path);
  if (path.startsWith('/models/')) return true;
  if (path.startsWith('/maps/_shared/')) return true;
  return path.startsWith(`/${mapsBase}/${dir}/`) || path.startsWith(`/${mapsBase}/_shared/`);
}

async function mapsRow(mod, level) {
  const mods = JSON.parse(await readFile(resolve(VIEWER, 'models', 'mods.json'), 'utf8'));
  const record = (mods.mods ?? []).find(m => m.id === mod);
  if (!record) throw new Error(`no mod "${mod}" in models/mods.json`);
  const mapsBase = record.paths?.maps ?? 'maps';
  const rows = JSON.parse(await readFile(resolve(VIEWER, mapsBase, 'maps.json'), 'utf8'));
  const wanted = String(level).toLowerCase();
  const row = (Array.isArray(rows) ? rows : []).find(r => {
    const name = String(r.name ?? '').toLowerCase();
    const dir = String(r.glb ?? '').split('/')[0].toLowerCase();
    return name === wanted || dir === wanted;
  });
  if (!row) throw new Error(`no level "${level}" in ${mapsBase}/maps.json`);
  const dir = String(row.glb ?? '').split('/')[0] || String(row.name).toLowerCase();
  return { mapsBase, dir, row };
}

const main = async () => {
  const mod = String(arg('mod', 'bf1942'));
  const level = String(arg('level') ?? '');
  if (!level) { log('--level <name> is required'); process.exit(2); }
  const base = String(arg('base', 'http://127.0.0.1:5273')).replace(/\/$/, '');
  const quietMs = Number(arg('quiet-ms', 4000));
  const timeoutMs = Number(arg('timeout-ms', 180000));
  const { mapsBase, dir, row } = await mapsRow(mod, level);
  const out = String(arg('out', resolve(VIEWER, mapsBase, dir, 'assets.json')));
  // `--url` captures whatever page shape the level is served through: a
  // replay (`map.html?...&replay=/stats/recordings/<slug>.ndjson`) loads the
  // vehicles and poses a plain open does not, and the manifest should cover
  // the page people actually open.
  const captureUrl = String(arg('url') ?? '');

  const mainViewer = process.env.BF_VIEWER_MAIN ?? VIEWER;
  const playwright = [
    resolve(HERE, '../../ui/node_modules/playwright/index.mjs'),
    resolve(mainViewer, '../../../ui/node_modules/playwright/index.mjs'),
  ].find(existsSync);
  if (!playwright) { log('playwright not found: install ui/node_modules or set BF_VIEWER_MAIN'); process.exit(2); }
  const { chromium } = await import(pathToFileURL(playwright).href);

  const origin = new URL(base).origin;
  const files = new Map();          // path -> bytes (as the server reported)
  const browser = await chromium.launch({
    headless: true,
    args: ['--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist',
      '--autoplay-policy=no-user-gesture-required'],
  });
  let lastAt = Date.now();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    page.on('response', response => {
      const url = new URL(response.url());
      if (url.origin !== origin) return;
      const path = decodeURIComponent(url.pathname);
      if (!belongsTo(path, mapsBase, dir)) return;
      if (response.status() >= 400) return;
      lastAt = Date.now();
      if (!files.has(path)) {
        const length = Number(response.headers()['content-length']);
        files.set(path, Number.isFinite(length) && length > 0 ? length : 0);
      }
    });
    const page_errors = [];
    page.on('pageerror', e => page_errors.push(String(e.message).slice(0, 300)));
    const url = captureUrl
      || `${base}/map.html?mod=${encodeURIComponent(mod)}&map=${encodeURIComponent(row.name)}`;
    log('opening', url);
    const startedAt = Date.now();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    // Quiet, not a fixed wait: a level's tail of loose textures and sounds
    // trickles in for a while after the map is up, and the point of the
    // manifest is to catch that tail too.
    for (;;) {
      await new Promise(r => setTimeout(r, 500));
      if (Date.now() - lastAt > quietMs) break;
      if (Date.now() - startedAt > timeoutMs) { log('budget spent, writing what arrived'); break; }
    }
    if (page_errors.length) log('page errors:', page_errors.slice(0, 3).join(' | '));
  } finally {
    await browser.close();
  }

  const list = [...files.keys()].sort();
  const bytes = [...files.values()].reduce((a, b) => a + b, 0);
  const manifest = {
    version: 1,
    level: row.name,
    mod,
    dir,
    captured: new Date().toISOString(),
    count: list.length,
    bytes,
    files: list,
  };
  log(`${list.length} assets, ${(bytes / 1e6).toFixed(1)} MB${bytes ? '' : ' (content-length absent: bytes unknown)'}`);
  // A page that never got going asks for nothing, and an empty manifest
  // published over a good one is a silent regression: refuse it instead.
  if (list.length < 10) {
    log(`only ${list.length} assets captured, the page did not load the level; nothing written`);
    process.exit(1);
  }
  if (flag('dry-run')) { console.log(JSON.stringify(manifest, null, 1)); return; }
  await writeFile(out, `${JSON.stringify(manifest, null, 1)}\n`);
  log('wrote', out);
};

main().catch(error => { log(String(error?.stack ?? error)); process.exit(1); });
