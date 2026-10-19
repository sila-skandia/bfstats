#!/usr/bin/env node
// Replay-driven asset audit: play shared recordings headless and report every
// asset the page asked for and did not get, classified by owning extractor and
// split live-missing vs locally-missing.
//
//   flock /tmp/claude-1000/chromium.lock \
//     node audit_replay_assets.mjs [--recent N] [--recording <slug|url>]... \
//          [--base https://play.bfstats.io] [--local <viewer dir>] \
//          [--json out.json] [--accepted file.json] \
//          [--speed 30] [--max-minutes 12] [--headed]
//
// A recording is a feed slug (`8uv24yb8hp`), a `/stats/recordings/<slug>.ndjson`
// path, or a whole `map.html?...&replay=...` address; `--recent N` takes the
// N newest cards from the feed at `--base`. Each one is played forward at
// `--speed` on `map.html` and every response of 400 or worse is kept.
//
// Classification (the `owner` of each finding) follows the viewer tree:
// `models/**` to extract_models / extract_level_variants / extract_pose /
// extract_viewmodel / sound and thumb extractors, `maps/**` to the level bake
// or the shared-tree extractors, `textures/**` and `glbs/**` to the
// optimise_mesh stores. The page falls back through the model trees (mod's,
// then vanilla's), so one missing file 404s once per tree: those collapse to
// one finding naming every probed tree. Severity is the live-vs-local split:
//   major `asset.extraction-gap`   absent locally too: the pipeline missed it
//   minor `asset.unpublished`      present locally, 404 live: publish pending
//   minor `asset.follows-base-gap` a wreck/cockpit probe of a template no
//                                  manifest lists: fix the base model's gap
//   info  `asset.optional-probe`   a cockpit or wreck the manifest says was
//                                  never exported (no `cockpit`, no `variants`
//                                  row of configuration `wreck`)
//   info  `api.error`              a `/stats/*` response, not an asset
//
// Output (`--json`): { base, recordings: [{slug, mod, level, url, duration_s,
// played_s, notFound, gaps, unpublished}], findings: [{check, recording, mod,
// level, severity, cause_key, template_or_kit, path, status, local, owner,
// evidence, accepted}] }. Exit 1 on any unaccepted major, 2 when the run could
// not be staged. `--accepted` rows match like audit_behaviour.mjs's: check +
// cause_key (+ template_or_kit, + path), each carrying `evidence`.
//
// One headless Chromium at a time (the caller wraps the run in flock).
// Never port 5273: this audit starts no server, it reads `--base` as given.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

// ------------------------------------------------------------ classification
//
// Pure: path in, owning extractor out. The suffix set mirrors what the
// exporters write beside a model (`Name.cockpit.glb`, `Name.wreck.glb`,
// `Name.<Level>.glb` for level paint, `poses/A__B.pose.glb`).
const VARIANTS = { cockpit: 'cockpit glb (extract_models.py)', wreck: 'wreck glb (extract_models.py)' };

/** What a viewer path is and which extractor owns it:
 *  `{ kind, owner, template, modTree }`. `path` is origin-relative, no query. */
export function classifyAssetPath(path) {
  const p = path.replace(/^\//, '');
  const mod = /^(?:models|maps)\/mods\/([^/]+)\//.exec(p)?.[1] ?? null;
  const out = (kind, owner, template = null) => ({ kind, owner, template, modTree: mod ?? 'vanilla' });
  if (/^stats\//.test(p)) return out('api', 'the /stats API, not an asset');
  if (/favicon\.ico$/.test(p)) return out('page', 'the page itself');
  let m;
  if ((m = /^models\/(?:mods\/[^/]+\/)?viewmodels\/(.+)$/.exec(p))) {
    return out('viewmodel', 'first-person rig (extract_viewmodel.py)', m[1].replace(/\.glb(\.gz)?$/, ''));
  }
  if ((m = /^models\/(?:mods\/[^/]+\/)?poses\/([^/]+)\.pose\.glb/.exec(p))) {
    return out('pose', 'kit pose (extract_pose.py --kit-poses)', m[1]);
  }
  if ((m = /^models\/(?:mods\/[^/]+\/)?sounds\/(.+)$/.exec(p))) {
    return out('sound', 'weapon/vehicle sound (extract_weapon_sounds.py / extract_vehicle_sounds.py)', m[1]);
  }
  if ((m = /^models\/(?:mods\/[^/]+\/)?thumbs\/(.+)$/.exec(p))) {
    return out('thumb', 'model thumbnail (pipeline thumbs stage)', m[1]);
  }
  if ((m = /^models\/(?:mods\/[^/]+\/)?([^/]+)\.([^./]+)\.glb/.exec(p))) {
    const [, template, suffix] = m;
    if (VARIANTS[suffix]) return out(suffix, VARIANTS[suffix], template);
    return out('level-variant', 'level paint variant (extract_level_variants.py)', `${template}.${suffix}`);
  }
  if ((m = /^models\/(?:mods\/[^/]+\/)?([^/]+)\.glb/.exec(p))) {
    return out('model', 'model glb (extract_models.py)', m[1]);
  }
  if (/^models\/(?:mods\/[^/]+\/)?models\.json/.test(p)) return out('manifest', 'models manifest (extract_models.py)');
  if ((m = /^maps\/(?:mods\/[^/]+\/)?_shared\/(.+)$/.exec(p))) {
    const rest = m[1];
    const shared = [
      [/^effects\.glb/, 'effect', 'shared effects (extract_effects.py)'],
      [/^effects\.sounds\.json/, 'effect', 'effect sounds (extract_effects.py)'],
      [/^loadouts\.json/, 'loadout', 'kit loadouts (extract_loadouts.py)'],
      [/^damage\.json/, 'data', 'damage tables (extract_map.py shared pass)'],
      [/^sounds\//, 'sound', 'soldier sounds (extract_soldier_sounds.py)'],
      [/^voices\//, 'voice', 'voices (extract_soldier_voices.py / extract_capture_voices.py)'],
      [/^hud\//, 'hud', 'HUD pack (extract_hud_mods.py)'],
      [/^load\//, 'loading', 'loading screens (extract_loading_assets.py)'],
      [/^trees/, 'trees', 'tree billboards (extract_tree_billboards.py)'],
      [/^(music|movies)\//, 'menu', 'menu music/movie (extract_menu_music.py / extract_menu_movie.py)'],
    ];
    for (const [re, kind, owner] of shared) if (re.test(rest)) return out(kind, owner, rest);
    return out('shared', 'shared tree (mod_pipeline.py shared stages)', rest);
  }
  if ((m = /^maps\/(?:mods\/[^/]+\/)?([^/]+)\/(.+)$/.exec(p))) {
    const [, level, rest] = m;
    return out('level', `level bake ${level} (extract_map.py)`, `${level}/${rest}`);
  }
  if (/^maps\/(?:mods\/[^/]+\/)?maps\.json/.test(p)) return out('manifest', 'level list (extract_maps_all.py)');
  if (/^textures\//.test(p)) return out('texture', 'shared texture store (optimise_mesh.py)');
  if (/^glbs\//.test(p)) return out('glb-store', 'shared glb store (optimise_mesh.py)');
  if (/\.(js|mjs|html|css)(\?|$)/.test(p)) return out('page', 'viewer code, not an asset');
  return out('other', 'unclassified; read the path');
}

/** One 404'd asset, routed: severity, cause and evidence from what the path
 *  is, whether any probed tree has it locally (`present`), and the merged
 *  manifests' word (`listed` glb stems, `hasWreck` stems with a wreck
 *  variant, `noCockpit` `<stem>.cockpit.glb` names — all lower case; stems,
 *  because `Flak18/36_towedgun` exports as `Flak18_36_towedgun.glb` and the
 *  stem is what a 404'd path carries).
 *  Pure, so the smoke test pins the routing without a browser. */
export function routeFinding({ path, status, trees = [path], present = false,
                               listed = new Set(), hasWreck = new Set(), noCockpit = new Set() }) {
  const cls = classifyAssetPath(path);
  if (cls.kind === 'page') return null;
  const f = { template_or_kit: cls.template ?? '-', path, status,
    local: present ? 'present' : 'absent', owner: cls.owner };
  if (cls.kind === 'api') {
    return { ...f, severity: 'info', cause_key: 'api.error', local: null, evidence: `${status} ${path}` };
  }
  const probed = trees.length > 1 ? ` (probed as ${trees.join(', ')})` : '';
  const base = String(cls.template ?? '').replace(/\.(cockpit|wreck)$/, '').toLowerCase();
  if (cls.kind === 'cockpit' && noCockpit.has(`${base}.cockpit.glb`)) {
    return { ...f, severity: 'info', cause_key: 'asset.optional-probe',
      evidence: `${status} ${path}; the manifest says ${base} has no cockpit` };
  }
  if (cls.kind === 'wreck' && listed.has(base) && !hasWreck.has(base)) {
    return { ...f, severity: 'info', cause_key: 'asset.optional-probe',
      evidence: `${status} ${path}; no manifest lists a wreck for ${base}: none was exported, probed by design` };
  }
  if ((cls.kind === 'wreck' || cls.kind === 'cockpit') && !listed.has(base)) {
    return { ...f, severity: 'minor', cause_key: 'asset.follows-base-gap',
      evidence: `${status} ${path}; ${base} is in no manifest at all — fix the base model's gap first` };
  }
  if (present) {
    return { ...f, severity: 'minor', cause_key: 'asset.unpublished',
      evidence: `${status} live, present locally: publish pending${probed}` };
  }
  return { ...f, severity: 'major', cause_key: 'asset.extraction-gap',
    evidence: `${status} live and absent locally (${cls.kind}): the pipeline never wrote it${probed}` };
}

/** A recording argument: a slug, a `/stats/recordings/<slug>.ndjson` path, or
 *  a whole `map.html?...` address. Returns `{ slug, mod, level }` (mod/level
 *  null when the argument does not carry them). */
export function parseRecordingArg(text) {
  const s = String(text).trim();
  let m;
  if ((m = /[?&]replay=([^&]+)/.exec(s))) {
    const replay = decodeURIComponent(m[1]);
    const slug = /\/stats\/recordings\/([a-z0-9]+)\.ndjson/.exec(replay)?.[1] ?? null;
    return {
      slug,
      mod: /[?&]mod=([^&]+)/.exec(s)?.[1] ?? null,
      level: /[?&]map=([^&]+)/.exec(s)?.[1] ?? null,
    };
  }
  if ((m = /\/stats\/recordings\/([a-z0-9]+)(\.ndjson)?$/.exec(s))) return { slug: m[1], mod: null, level: null };
  if (/^[a-z0-9]{4,}$/.test(s)) return { slug: s, mod: null, level: null };
  return { slug: null, mod: null, level: null };
}

// ----------------------------------------------------------------- the audit
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : d; };
const args = (n) => process.argv.flatMap((a, i) => (a === `--${n}` ? [process.argv[i + 1]] : []));
const flag = n => process.argv.includes(`--${n}`);
const log = (...a) => console.error('[replay-assets]', ...a);
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  const BASE = arg('base', 'https://play.bfstats.io').replace(/\/$/, '');
  const LOCAL = resolve(arg('local', resolve(HERE, 'viewer')));
  const OUT = arg('json', null);
  const SPEED = Number(arg('speed', 30));
  const MAX_MS = Number(arg('max-minutes', 12)) * 60000;
  const ACCEPTED_FILE = arg('accepted', resolve(HERE, 'audit_replay_assets_accepted.json'));
  const accepted = existsSync(ACCEPTED_FILE) ? JSON.parse(await readFile(ACCEPTED_FILE, 'utf8')) : [];

  // The recordings to play: named ones, then the feed's newest.
  const wanted = args('recording').map(parseRecordingArg).filter(r => r.slug);
  const recent = Number(arg('recent', wanted.length ? 0 : 3));
  if (recent > 0) {
    const feed = await fetch(`${BASE}/stats/recordings?page=1&pageSize=${recent}&sort=recent`).then(r => r.json());
    for (const item of feed.items.slice(0, recent)) {
      if (!wanted.some(w => w.slug === item.slug)) wanted.push({ slug: item.slug, mod: item.mod, level: item.level });
    }
  }
  if (!wanted.length) { log('nothing to play: pass --recording or --recent'); process.exit(2); }
  for (const w of wanted) {
    if (w.mod && w.level) continue;
    const detail = await fetch(`${BASE}/stats/recordings/${w.slug}`).then(r => (r.ok ? r.json() : null));
    if (!detail) { log(`the feed does not know ${w.slug}`); process.exit(2); }
    w.mod ??= detail.mod; w.level ??= detail.level;
  }

  // The manifests that make a cockpit or wreck 404 a probe, not a gap: the
  // page probes `<T>.cockpit.glb` for every flown hull and `<T>.wreck.glb`
  // for every destroyed one, and the manifest is the exporter's own word on
  // whether the file was ever written (`cockpit`, and a `variants` row of
  // configuration `wreck`). Read from the audited origin first (it is the
  // thing under audit), the local tree second. Merged across the trees the
  // page falls back through: a wreck either tree holds would have been found.
  // Keyed by glb stem, not template name: a slash-named template
  // (`Flak18/36_towedgun`) exports as `Flak18_36_towedgun.glb`, and the stem
  // is what a 404'd path carries.
  const listed = new Set();        // glb stems, lower case
  const hasWreck = new Set();
  const noCockpit = new Set();
  const manifestFor = async mod => {
    const rel = mod && mod !== 'bf1942' ? `models/mods/${mod}/models.json` : 'models/models.json';
    let rows = await fetch(`${BASE}/${rel}`).then(r => (r.ok ? r.json() : null)).catch(() => null);
    if (!rows) { try { rows = JSON.parse(await readFile(resolve(LOCAL, rel), 'utf8')); } catch { rows = null; } }
    for (const e of rows ?? []) {
      if (!e.glb) continue;
      const stem = e.glb.replace(/\.glb$/, '').toLowerCase();
      listed.add(stem);
      if (!e.cockpit) noCockpit.add(`${stem}.cockpit.glb`);
      if ((e.variants ?? []).some(v => v?.configuration === 'wreck')) hasWreck.add(stem);
    }
  };
  await manifestFor('bf1942');
  for (const mod of new Set(wanted.map(w => w.mod).filter(m => m && m !== 'bf1942'))) await manifestFor(mod);

  // Playwright lives in `ui/node_modules`, which a fresh worktree does not
  // have: fall back to the main checkout's, found through the same
  // `BF_VIEWER_MAIN` anchor `link_viewer_assets.sh` uses.
  const mainViewer = process.env.BF_VIEWER_MAIN ?? '/home/dylan/projects/skandia/bfstats/tools/bf1942-models/viewer';
  const playwright = [
    resolve(HERE, '../../ui/node_modules/playwright/index.mjs'),
    resolve(mainViewer, '../../../ui/node_modules/playwright/index.mjs'),
  ].find(existsSync);
  if (!playwright) { log('playwright not found: install ui/node_modules or set BF_VIEWER_MAIN'); process.exit(2); }
  const { chromium } = await import(pathToFileURL(playwright).href);
  const browser = await chromium.launch({
    headless: !flag('headed'),
    args: ['--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist',
      '--autoplay-policy=no-user-gesture-required'],
  });

  const findings = [];
  const isAccepted = f => accepted.find(a => a.evidence && a.check === f.check
    && (!a.cause_key || a.cause_key === f.cause_key)
    && (!a.template_or_kit || String(a.template_or_kit).toLowerCase() === String(f.template_or_kit).toLowerCase())
    && (!a.path || a.path === f.path));
  const add = f => {
    const hit = isAccepted(f);
    f.accepted = !!hit;
    if (hit) f.accepted_evidence = hit.evidence;
    findings.push(f);
    return f;
  };

  const summaries = [];
  try {
    for (const { slug, mod, level } of wanted) {
      const url = `${BASE}/map.html?mod=${encodeURIComponent(mod)}&map=${encodeURIComponent(level)}`
        + `&replay=${encodeURIComponent(`/stats/recordings/${slug}.ndjson`)}&shots`;
      log('playing', slug, `${mod}/${level}`);
      const summary = { slug, mod, level, url, duration_s: 0, played_s: 0, notFound: 0, gaps: 0, unpublished: 0 };
      const bad = new Map();     // path -> status
      const pageErrors = [];
      const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
      page.on('pageerror', e => pageErrors.push(String(e.message).slice(0, 300)));
      page.on('response', r => {
        if (r.status() < 400) return;
        const u = new URL(r.url());
        if (u.origin !== new URL(BASE).origin) return;
        const path = decodeURIComponent(u.pathname).replace(/^\//, '');
        if (!bad.has(path)) bad.set(path, r.status());
      });
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 300000 });
        await page.waitForFunction(() => window.replay?.statusLine, null, { timeout: 300000, polling: 500 });
        summary.duration_s = Math.round(await page.evaluate(() => window.replay.rec.duration));
        await page.evaluate(s => { window.replay.speed = s; window.replay.playing = true; }, SPEED);
        const t0 = Date.now();
        let last = { t: 0, at: t0 };
        for (;;) {
          await sleep(2000);
          const { t, playing } = await page.evaluate(() => ({ t: window.replay.time, playing: window.replay.playing }));
          summary.played_s = Math.round(t);
          if (!playing || t >= summary.duration_s - 1) break;
          if (Date.now() - t0 > MAX_MS) { log(slug, `budget spent at ${Math.round(t)}s of ${summary.duration_s}s`); break; }
          if (t > last.t + 0.5) last = { t, at: Date.now() };
          else if (Date.now() - last.at > 45000) {
            add({ check: 'replay.stalled', recording: slug, mod, level, severity: 'info', cause_key: 'replay.stalled',
              template_or_kit: '-', path: null, status: null, local: null, owner: null,
              evidence: `playback stuck at ${Math.round(t)}s of ${summary.duration_s}s` });
            break;
          }
        }
        await sleep(3000);       // late responses settle
      } catch (e) {
        add({ check: 'replay.load', recording: slug, mod, level, severity: 'major', cause_key: 'replay.load-failed',
          template_or_kit: '-', path: null, status: null, local: null, owner: null,
          evidence: String(e.message).split('\n')[0].slice(0, 300) });
      }
      await page.close().catch(() => {});

      // The page falls back through the model trees (`replay-assets.js`
      // modelUrlList: the mod's, then vanilla's), so one missing model 404s
      // once per tree. One finding per model file, every probed tree on it.
      const grouped = new Map();   // group key -> { path, status, trees: [paths] }
      for (const [path, status] of [...bad].sort()) {
        const key = /^models\//.test(path) ? path.replace(/^models\/mods\/[^/]+\//, 'models/') : path;
        const row = grouped.get(key) ?? { path, status, trees: [] };
        if (/^models\/mods\//.test(path)) row.path = path;   // the mod tree's copy names the finding
        row.trees.push(path);
        grouped.set(key, row);
      }
      for (const { path, status, trees } of [...grouped.values()].sort((a, b) => a.path.localeCompare(b.path))) {
        const routed = routeFinding({ path, status, trees,
          present: trees.some(p => existsSync(resolve(LOCAL, p))), listed, hasWreck, noCockpit });
        if (!routed) continue;
        summary.notFound += trees.length;
        const f = add({ check: 'replay.asset', recording: slug, mod, level, ...routed });
        if (f.cause_key === 'asset.extraction-gap') summary.gaps += 1;
        if (f.cause_key === 'asset.unpublished') summary.unpublished += 1;
      }
      if (pageErrors.length) {
        add({ check: 'page.errors', recording: slug, mod, level, severity: 'info', cause_key: 'page.error',
          template_or_kit: '-', path: null, status: null, local: null, owner: null,
          evidence: [...new Set(pageErrors)].slice(0, 3).join(' | ') });
      }
      summaries.push(summary);
      log('done', JSON.stringify(summary));
      if (OUT) {       // a crashed later recording must not lose this one
        await mkdir(dirname(resolve(OUT)), { recursive: true });
        await writeFile(OUT, JSON.stringify({ base: BASE, local: LOCAL, recordings: summaries, findings }, null, 1));
      }
    }
  } finally {
    await browser.close().catch(() => {});
  }

  const out = { base: BASE, local: LOCAL, recordings: summaries, findings };
  if (OUT) { await mkdir(dirname(resolve(OUT)), { recursive: true }); await writeFile(OUT, JSON.stringify(out, null, 1)); }
  const by = {};
  for (const f of findings) by[`${f.severity}:${f.cause_key}`] = (by[`${f.severity}:${f.cause_key}`] || 0) + 1;
  const blocking = findings.filter(f => f.severity === 'major' && !f.accepted);
  console.log(JSON.stringify({ recordings: summaries, causes: by, blocking: blocking.length }, null, 1));
  process.exit(blocking.length ? 1 : 0);
}

// Importable for the tests: main runs only when invoked as a script.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(e => { console.error(e); process.exit(2); });
}
