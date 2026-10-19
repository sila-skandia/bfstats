#!/usr/bin/env node
// What the viewer DREW for a replay at a time: load the real page headless,
// seek, and read the drawn soldier bodies (window.replay.soldiers.bodies
// .debug().live: lower/upper animation clip, stance, weapon, visibility) plus
// the page's own replay warnings. Pair with body_states.mjs: data says crouch
// and the page draws Lb_Stand -> viewer defect; data cannot say -> recorder.
//
//   flock /tmp/claude-1000/chromium.lock node viewer_drawn.mjs \
//        --url 'https://play.bfstats.io/map.html?mod=<id>&map=<level>&replay=/stats/recordings/<slug>.ndjson&shots' \
//        --at <seconds> [--player <name substring> | --pid N] [--settle 4000]
//
// Always under the flock (one headless Chromium at a time), never port 5273.
// Output JSON: { time, statusLine, header: {animStates, stances}, followed,
// live: [ { id, soldier, lower, upper, stance, weapon, visible, seated } ],
// warnings: the page's console lines starting "replay:" }.

import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..', '..');
// Playwright lives in ui/node_modules; a fresh worktree has none until
// bootstrap-worktree.sh runs, so fall back to the main checkout's.
const roots = [REPO];
const main = REPO.split(`${path.sep}.claude${path.sep}worktrees${path.sep}`)[0];
if (main !== REPO) roots.push(main);
const { chromium } = (() => {
  for (const root of roots) {
    try { return createRequire(path.join(root, 'ui', 'package.json'))('playwright'); } catch { /* next */ }
  }
  throw new Error(`playwright not found under ${roots.map(r => path.join(r, 'ui')).join(' or ')} — run ./scripts/bootstrap-worktree.sh`);
})();

const args = process.argv.slice(2);
const opt = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const url = opt('url');
const at = Number(opt('at'));
if (!url || !Number.isFinite(at)) {
  console.error("usage: flock /tmp/claude-1000/chromium.lock node viewer_drawn.mjs --url '<map.html?...&replay=...&shots>' --at <s> [--player name | --pid N]");
  process.exit(2);
}
const wantName = opt('player')?.toLowerCase() ?? null;
const wantPid = opt('pid') ? Number(opt('pid')) : null;
const settle = Number(opt('settle', 4000));

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const warnings = [];
page.on('console', m => { if (m.text().startsWith('replay:')) warnings.push(m.text()); });
try {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 300000 });
  await page.waitForFunction(() => window.replay?.statusLine, null, { timeout: 300000, polling: 500 });
  const out = await page.evaluate(async ({ at, wantName, wantPid, settle }) => {
    const r = window.replay;
    let followed = null;
    if (wantPid !== null) followed = wantPid;
    else if (wantName) {
      // Pids are reused: match the session that holds the pid at --at
      // (replay-recording.js playerAt), falling back to the players map.
      const match = p => (p?.name ?? '').toLowerCase().includes(wantName);
      for (const [pid, sessions] of r.rec.sessions ?? []) {
        let holder = sessions[0];
        for (const s of sessions) { if (s.joinT > at) break; holder = s; }
        if (match(holder)) { followed = pid; break; }
      }
      if (followed === null) {
        for (const [pid, p] of r.rec.players ?? []) if (match(p)) { followed = pid; break; }
      }
    }
    r.playing = false;   // the page autoplays; pause, or the settle drifts past --at
    r.seek(at);
    if (followed !== null) r.follow(followed);
    // Let the frame loop run paused at t: the seek rebuilds every body.
    await new Promise(res => setTimeout(res, settle));
    const dbg = r.soldiers?.bodies?.debug?.() ?? { live: [], corpses: [] };
    return {
      time: r.time,
      statusLine: r.statusLine,
      followed,
      header: {
        animStates: (r.rec.animStates ?? []).filter(Boolean).length,
        animStatesSkipped: r.rec.animStatesSkipped ?? null,
        soldiersWithStances: r.rec.stances?.size ?? 0,
      },
      live: dbg.live.map(v => ({
        id: v.id, soldier: v.soldier, weapon: v.weapon, kit: v.kit,
        lower: v.lower, upper: v.upper, stance: v.stance,
        visible: v.visible, seated: v.seated, reloading: v.reloading,
      })),
      corpses: dbg.corpses.length,
    };
  }, { at, wantName, wantPid, settle });
  out.warnings = warnings;
  console.log(JSON.stringify(out, null, 1));
} finally {
  await browser.close();
}
