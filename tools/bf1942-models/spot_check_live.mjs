// A look at levels as players get them: load each on the live site (or any
// viewer URL), spawn on foot, walk, board the nearest vehicle and drive it,
// and save a frame at every stage with the page errors and 404s beside them.
// Not an audit: it judges nothing, it shows. The behaviour audit is
// audit_behaviour.mjs; this is for a human to look at the pictures.
//
//   flock /tmp/claude-1000/chromium.lock node spot_check_live.mjs \
//     --mod fhsweurope --levels meuse_river_line-1944,berlin-1945 --out /tmp/spot
//
// Playwright comes from ui/node_modules (NODE_PATH, as for shoot.mjs).
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(resolve(HERE, '../../ui/package.json'));
const { chromium } = require('playwright');

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : d; };
const MOD = arg('mod', 'bf1942');
const LEVELS = arg('levels', '').split(',').map(s => s.trim()).filter(Boolean);
const BASE = arg('url', 'https://play.bfstats.io');
const OUT = resolve(arg('out', '/tmp/claude-1000/spot-check'));
const W = Number(arg('w', 1280)), H = Number(arg('h', 720));
const TEAM = Number(arg('team', 1));
if (!LEVELS.length) { console.error('--levels a,b,c is required'); process.exit(2); }

const log = (...a) => console.error('[spot]', ...a);

/** Run `n` frames of the page's own loop at the capture size. */
async function step(page, n) {
  for (let left = n; left > 0; left -= 60) {
    await page.evaluate(([c, w, h]) => { for (let i = 0; i < c; i++) window.__renderOnce(w, h); },
      [Math.min(60, left), W, H]);
  }
}

/** One more frame, read back in the same task so the drawing buffer is still there. */
async function shot(page, file) {
  const data = await page.evaluate(([w, h]) => {
    window.__renderOnce(w, h);
    return window.__renderer.domElement.toDataURL('image/jpeg', 0.85);
  }, [W, H]);
  await writeFile(file, Buffer.from(data.split(',')[1], 'base64'));
  return file;
}

/** Stand up on foot at a flag of `team`, the side's own flags first. */
async function spawn(page, team) {
  const names = await page.evaluate(team => {
    const d = window.__deploy;
    if (d.team !== team) d.setTeam(team);
    const open = d.flags.filter(f => f.spawns > 0 && !f.inactive);
    const side = f => f.side ?? f.team;
    return [...open.filter(f => side(f) === team), ...open.filter(f => side(f) !== team)].map(f => f.name);
  }, team);
  for (const name of names) {
    const ok = await page.evaluate(([name, team]) => {
      const d = window.__deploy;
      if (!d.open) return false;
      if (d.team !== team) d.setTeam(team);
      return d.select(name) !== false && d.spawn();
    }, [name, team]);
    if (!ok) continue;
    await step(page, 60);
    const where = await page.evaluate(() => ({ hull: !!window.__hull?.(), swim: !!window.__soldier?.()?.swimming }));
    if (!where.hull && !where.swim) return name;
    // A seat or the sea: die and try the next flag.
    await page.evaluate(() => window.__damage?.(1e6));
    for (let i = 0; i < 40 && !await page.evaluate(() => window.__deploy.open); i++) await step(page, 30);
  }
  return null;
}

async function checkLevel(browser, level) {
  const dir = resolve(OUT, level);
  await mkdir(dir, { recursive: true });
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  const errors = [], missing = [], frames = {};
  page.on('pageerror', e => errors.push(e.message.slice(0, 300)));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text().slice(0, 300)); });
  page.on('response', r => { if (r.status() >= 400) missing.push(`${r.status()} ${r.url().replace(BASE, '')}`); });
  const t0 = Date.now();
  const report = { level, url: null, flag: null, vehicle: null, seconds: 0 };
  try {
    report.url = `${BASE}/map.html?mod=${MOD}&map=${encodeURIComponent(level)}&team=${TEAM}&botCount=0&shots=1&noaudio=1`;
    await page.goto(report.url, { waitUntil: 'load', timeout: 300000 });
    await page.evaluate(() => document.querySelector('.ld-brief-btn')?.click());
    await page.waitForFunction(() => window.__renderOnce && window.__deploy && window.__scene, null, { timeout: 300000 });
    await step(page, 20);
    await page.evaluate(() => window.__setOnFoot?.(true));
    await step(page, 20);

    report.flag = await spawn(page, TEAM);
    if (!report.flag) throw new Error('no flag stood the soldier up');
    // The first-person rig streams in after the spawn: wait (wall clock) for
    // the hand weapon to have its arms before the first frame.
    for (let i = 0; i < 40; i++) {
      const hw = await page.evaluate(() => { try { return window.__handWeapon?.() || null; } catch { return null; } });
      report.hand = hw ? { name: hw.name, rig: hw.rig, viewmodel: hw.viewmodel, group: hw.hasGroup } : null;
      if (hw?.viewmodel && hw?.hasGroup) break;
      await step(page, 15);
      await page.waitForTimeout(500);
    }
    frames.spawn = await shot(page, `${dir}/1-spawn.jpg`);

    // Walk: look about the way the spawn faces, then forward for ~3 s.
    await page.evaluate(() => window.__keys.add('KeyW'));
    await step(page, 180);
    await page.evaluate(() => window.__keys.delete('KeyW'));
    frames.walk = await shot(page, `${dir}/2-walk.jpg`);

    // The nearest vehicle standing on the field.
    const me = await page.evaluate(() => window.__soldier?.()?.pos ?? null);
    const pick = await page.evaluate(me => {
      // Something to drive: a hull with real hit points, not a barrel, a
      // crate, a spawner dummy or a kill cage.
      const junk = /cage|barrel|crate|dummy|spawn|ammo|supply|repair|plank|mine|wire|sandbag|hedgehog/i;
      const list = (window.__vehicles?.() ?? []).filter(v => v.pos && !v.destroyed && !v.wrecked && !v.absent
        && !v.held && (v.max ?? 0) >= 100 && !junk.test(`${v.template ?? ''} ${v.name ?? ''}`));
      const d = v => me ? Math.hypot(v.x - me[0], v.z - me[2]) : 0;
      list.sort((a, b) => d(a) - d(b));
      return list[0] ? { owner: list[0].owner, name: list[0].name, template: list[0].template, pos: list[0].pos } : null;
    }, me);
    if (pick) {
      report.vehicle = pick.template ?? pick.name;
      await page.evaluate(([x, y, z]) => { window.__setFly?.(true); window.__teleport(x + 4, y + 2, z, 0); }, pick.pos);
      await step(page, 6);
      let ok = await page.evaluate(o => window.__enterOwner(o), pick.owner);
      if (!ok) {
        await page.evaluate(([x, y, z]) => window.__teleport(x + 1.5, y + 1, z, 0), pick.pos);
        await step(page, 6);
        ok = await page.evaluate(name => {
          const near = window.__nearEntry?.();
          const node = window.__scene.getObjectByName(name);
          return !!(node && window.__enterSeat(node, near?.seatId ?? null));
        }, pick.name);
      }
      report.entered = !!ok;
      await step(page, 30);
      frames.vehicle = await shot(page, `${dir}/3-vehicle.jpg`);
      if (ok) {
        await page.evaluate(() => window.__keys.add('KeyW'));
        await step(page, 240);
        await page.evaluate(() => window.__keys.delete('KeyW'));
        report.moved = await page.evaluate(([x, , z]) => {
          const h = window.__hull?.();
          const o = h?.axes?.origin;
          return o ? +Math.hypot(o[0] - x, o[2] - z).toFixed(1) : null;
        }, pick.pos);
        frames.drive = await shot(page, `${dir}/4-drive.jpg`);
      }
    }
  } catch (e) {
    report.failed = String(e.message || e).slice(0, 300);
    try { frames.failed = await shot(page, `${dir}/x-failed.jpg`); } catch { /* no renderer yet */ }
  }
  report.seconds = Math.round((Date.now() - t0) / 1000);
  report.frames = frames;
  report.errors = [...new Set(errors)];
  report.missing = [...new Set(missing)];
  await page.close().catch(() => {});
  await writeFile(`${dir}/report.json`, JSON.stringify(report, null, 1));
  log(level, report.failed ? `FAILED ${report.failed}` : `flag ${report.flag}, vehicle ${report.vehicle} entered ${report.entered} moved ${report.moved} m`,
    `errors ${report.errors.length}, 404s ${report.missing.length}, ${report.seconds}s`);
  return report;
}

const browser = await chromium.launch({
  args: ['--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist'],
});
const reports = [];
for (const level of LEVELS) reports.push(await checkLevel(browser, level));
await browser.close();
await writeFile(resolve(OUT, 'summary.json'), JSON.stringify(reports, null, 1));
log(`frames under ${OUT}`);
