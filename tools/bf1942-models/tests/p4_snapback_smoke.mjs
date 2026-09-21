// The P4 correction done-bar, and the regression test for the snap-back
// defect: one real page, one real room server over real TCP, a sustained walk
// on the page's own animation loop, and the divergence the wire actually shows.
//
//   node tests/p4_snapback_smoke.mjs [--seconds 14] [--map aberdeen]
//
// What it pins (features/netcode-play-multiplayer/SNAPBACK.md):
//
//   * the prediction and the authority spawn the SAME body — same spawn point,
//     same facing. Before the fix the authority advanced the flag's spawn index
//     on every deploy row while the page did not, so the two stood 45 m and
//     17.7 deg apart on Aberdeen's British_Base;
//   * |authority - prediction| stays bounded over a sustained walk. Before the
//     fix it was a sawtooth from 0 to the 4 m grace and back, every ~2 s, for
//     as long as the player walked (12 hard teleports in 25 s, measured);
//   * NO hard correction fires at all. A hard correction is a teleport, and in
//     a healthy room walking in a straight line there is no event to teleport
//     for;
//   * the error measured at the acknowledged tick — the honest prediction
//     error, with the input latency taken out — stays in centimetres.
//
// The walk runs on the REAL animation loop, not `__renderOnce`: the defect is a
// disagreement between the client's own clock and the room's wall clock, and
// stepping the page's clock by hand is exactly the relationship under test.
// Headless chromium renders Aberdeen at ~12 fps under software GL, which is a
// harder case than the owner's machine, not an easier one.
//
// Requires the ui tree's Playwright (chromium) and a `node_modules/three`
// standing (server/README.md). Exit code 0 = the bar held.

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVER = path.join(ROOT, 'server', 'server.mjs');
const VIEWER = path.join(ROOT, 'viewer');
const { bootStatic } = await import(path.join(ROOT, 'tests', 'p2_two_browser_smoke.mjs'));
const { chromium } = require(path.join(ROOT, '..', '..', 'ui', 'node_modules', 'playwright'));

const args = process.argv.slice(2);
const opt = (flag, fallback) => {
  const at = args.indexOf(flag);
  return at >= 0 ? args[at + 1] : fallback;
};
const SECONDS = Number(opt('--seconds', '14'));
const MAP = opt('--map', 'aberdeen');

/** The bars. Each is a measured number with a metre of headroom, not a tuning. */
const MAX_HARD_CORRECTIONS = 0;
/** The authority is behind the prediction by the input latency and nothing
 *  else: 2-3 unacknowledged ticks of the 6 m/s run table is 0.4-0.6 m, and the
 *  measured steady state is exactly that. 2 m is generous; the defect drove
 *  this to the 4 m grace and held it there. */
const MAX_WIRE_GAP_M = 2.0;
/** The honest error, measured where both sides ran the same words.
 *
 *  Two bars, because there are two regimes. The join has a real transient: the
 *  page spawns and starts walking, and the authority spawns when the deploy row
 *  lands, a few ticks later and from rest, so the first acknowledged snapshots
 *  are legitimately ~1.2 m apart (measured) and spending that is the correction
 *  law's whole job. Then it settles on 0.000 m and stays there, which is the bar
 *  that matters: a divergence that is being GENERATED shows up here, and the
 *  defect drove it to the 4 m grace over and over. */
const MAX_ACKED_ERROR_M = 2.0;
const MAX_STEADY_ACKED_ERROR_M = 0.25;
/** The share of the run treated as the join transient. */
const TRANSIENT_SHARE = 0.25;
/** Same spawn point, same facing. */
const MAX_YAW_GAP_DEG = 1.0;
/** A walk that did not happen proves nothing. */
const MIN_TRAVEL_M = 20;

async function freePort() {
  const net = await import('node:net');
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}
const PORT = Number(opt('--port', 0)) || await freePort();
const STATIC = Number(opt('--static', 0)) || await freePort();
const sleep = ms => new Promise(r => setTimeout(r, ms));

const kids = [];
let browser = null;
let statics = null;

function boot() {
  const child = spawn('node', [SERVER, '--port', String(PORT), '--viewer', VIEWER,
    '--default-level', MAP], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', d => {
    const s = String(d);
    if (/listening|room /.test(s)) process.stdout.write(`[srv] ${s}`);
  });
  child.stderr.on('data', d => {
    const s = String(d);
    if (!/^level /m.test(s)) process.stdout.write(`[srv] ${s}`);
  });
  kids.push(child);
}

function teardown() {
  for (const child of kids) { try { child.kill('SIGKILL'); } catch { /* gone */ } }
  try { browser?.close(); } catch { /* gone */ }
  try { statics?.close(); } catch { /* gone */ }
}

async function main() {
  boot();
  statics = bootStatic(STATIC, VIEWER, PORT);
  let up = false;
  for (let i = 0; i < 300 && !up; i++) {
    try { up = (await fetch(`http://127.0.0.1:${PORT}/netcode/rooms`)).ok; } catch { /* not yet */ }
    if (!up) await sleep(200);
  }
  if (!up) throw new Error('the room server never came up');

  browser = await chromium.launch({
    headless: true,
    args: ['--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
  });
  const ctx = await browser.newContext({ viewport: { width: 640, height: 400 } });
  const page = await ctx.newPage();
  page.on('pageerror', err =>
    process.stdout.write(`[page] PAGEERROR: ${err.message.slice(0, 300)}\n`));
  page.on('console', msg => {
    if (msg.type() === 'error') process.stdout.write(`[page] ${msg.text().slice(0, 250)}\n`);
  });

  await page.goto(`http://127.0.0.1:${STATIC}/map.html?room=p4snap&name=P4&map=${MAP}&shots=1`);
  let joined = false;
  for (let i = 0; i < 240 && !joined; i++) {
    joined = await page.evaluate(() =>
      typeof window.__net === 'function' && window.__net().connected).catch(() => false);
    if (!joined) await sleep(500);
  }
  if (!joined) throw new Error('the page never joined the room');

  await page.waitForFunction(() => window.__deploy && window.__deploy.open, null,
    { timeout: 120_000 });
  let spawned = false;
  for (let i = 0; i < 400 && !spawned; i++) {
    const ok = await page.evaluate(() => window.__deploy.spawn());
    spawned = ok && await page.evaluate(() => window.__soldier() !== null);
    if (!spawned) await sleep(250);
  }
  if (!spawned) throw new Error('deploy never committed');

  const start = await page.evaluate(() => ({
    x: window.__soldier().x, z: window.__soldier().z,
    sent: window.__net().sent,
  }));
  // The deploy row names which of the flag's spawn points the page used — the
  // whole fix on the wire.
  const spawnRow = start.sent.find(r => r.type === 'spawn');
  if (!Number.isInteger(spawnRow?.spawnIndex)) {
    throw new Error(`the deploy row carried no spawnIndex: ${JSON.stringify(spawnRow)}`);
  }

  // The walk: hold W for SECONDS of wall time and sample the wire at 10 Hz.
  await page.evaluate(() => { window.__keys.add('KeyW'); });
  const samples = [];
  const until = Date.now() + SECONDS * 1000;
  while (Date.now() < until) {
    const row = await page.evaluate(() => {
      const net = window.__net();
      const s = window.__soldier();
      if (!net.self || !s) return null;
      return {
        gap: Math.hypot(net.self.x - s.x, net.self.z - s.z),
        yawGap: Math.abs(net.self.yaw - s.yaw * 180 / Math.PI),
        ack: net.ack, pending: net.pending,
        corrections: net.corrections, hard: net.hardCorrections,
        error: net.correction ? net.correction.error : 0,
      };
    }).catch(() => null);
    if (row) samples.push(row);
    await sleep(100);
  }
  await page.evaluate(() => { window.__keys.delete('KeyW'); });
  const end = await page.evaluate(() => ({
    x: window.__soldier().x, z: window.__soldier().z,
    net: window.__net(),
  }));

  if (samples.length < 20) throw new Error(`only ${samples.length} samples of the wire`);
  const travel = Math.hypot(end.x - start.x, end.z - start.z);
  const gapMax = Math.max(...samples.map(s => s.gap));
  const gapMean = samples.reduce((a, s) => a + s.gap, 0) / samples.length;
  const yawMax = Math.max(...samples.map(s => s.yawGap));
  const errorMax = Math.max(...samples.map(s => s.error));
  const steady = samples.slice(Math.ceil(samples.length * TRANSIENT_SHARE));
  const steadyErrorMax = Math.max(...steady.map(s => s.error));
  const steadyGapMax = Math.max(...steady.map(s => s.gap));
  const hard = end.net.hardCorrections;
  const report = {
    seconds: SECONDS, map: MAP,
    spawnIndexOnTheWire: spawnRow.spawnIndex,
    travel: +travel.toFixed(2),
    wireGapMax: +gapMax.toFixed(3), wireGapMean: +gapMean.toFixed(3),
    ackedErrorMax: +errorMax.toFixed(3),
    steadyAckedErrorMax: +steadyErrorMax.toFixed(3),
    steadyWireGapMax: +steadyGapMax.toFixed(3),
    yawGapMaxDeg: +yawMax.toFixed(4),
    corrections: end.net.corrections, hardCorrections: hard,
    ack: end.net.ack, sentSeq: end.net.sentSeq,
    samples: samples.length,
  };
  process.stdout.write(`${JSON.stringify(report, null, 1)}\n`);

  const failures = [];
  if (travel < MIN_TRAVEL_M) failures.push(`walked only ${travel.toFixed(1)} m`);
  if (hard > MAX_HARD_CORRECTIONS) {
    failures.push(`${hard} hard corrections (teleports) in ${SECONDS} s`);
  }
  if (gapMax > MAX_WIRE_GAP_M) {
    failures.push(`|authority - prediction| reached ${gapMax.toFixed(2)} m`);
  }
  if (errorMax > MAX_ACKED_ERROR_M) {
    failures.push(`the acknowledged error reached ${errorMax.toFixed(2)} m`);
  }
  if (steadyErrorMax > MAX_STEADY_ACKED_ERROR_M) {
    failures.push(`the acknowledged error was still ${steadyErrorMax.toFixed(2)} m `
      + `after the join transient - a divergence is being generated`);
  }
  if (yawMax > MAX_YAW_GAP_DEG) {
    failures.push(`the facing gap reached ${yawMax.toFixed(2)} deg`);
  }
  // The authority must actually be acknowledging: a run where nothing was
  // acknowledged would pass every bound above by doing nothing at all.
  if (!(end.net.ack > 0) || end.net.corrections < 5) {
    failures.push(`the authority acknowledged ${end.net.ack} words over ${end.net.corrections} corrections`);
  }
  if (failures.length) throw new Error(failures.join('; '));

  process.stdout.write(`P4 snapback smoke OK — walked ${travel.toFixed(1)} m, `
    + `wire gap <= ${gapMax.toFixed(2)} m, acked error <= ${errorMax.toFixed(3)} m `
    + `(${steadyErrorMax.toFixed(3)} m once settled), `
    + `facing gap <= ${yawMax.toFixed(3)} deg, 0 teleports\n`);
}

const isMain = process.argv[1]?.endsWith('p4_snapback_smoke.mjs');
if (isMain) {
  process.on('SIGTERM', () => { teardown(); process.exit(130); });
  process.on('SIGINT', () => { teardown(); process.exit(130); });
  main()
    .catch(error => {
      console.error(`P4 snapback smoke FAILED: ${error.message}`);
      process.exitCode = 1;
    })
    .finally(teardown);
}
