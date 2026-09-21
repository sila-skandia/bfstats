// Headless proof of the bail-out path on the real page.
//
//   node bailcheck.mjs [--url ...] [--deploy 1.5] [--alt 120] [--pitch 0]
//
// Steps the page's own `frame()` through `__renderOnce` in short batches (the
// briefing's SwiftShader rule) and reads `__parachute()` back between them.

import { chromium } from '/home/dylan/projects/skandia/bfstats/ui/node_modules/playwright/index.mjs';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
};

const URL = arg('url', 'http://localhost:5332/map.html?mod=bf1942&map=wake&shots');
const DEPLOY_AT = Number(arg('deploy', 1.5));   // seconds after the bail-out
const ALT = Number(arg('alt', 120));            // metres above the ground
const PITCH = Number(arg('pitch', 0));          // look pitch, radians
const DT = 0.1;                                 // __renderOnce's own clamp
const PER_BATCH = 10;                           // 1 s of simulated time

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
page.on('pageerror', (e) => console.error('page error:', e.message));
page.on('console', (m) => {
  if (m.type() === 'error') console.error('console:', m.text());
});

await page.goto(URL, { waitUntil: 'networkidle', timeout: 180000 });
await page.waitForFunction(() => !!window.__renderOnce && !!window.__setOnFoot,
  null, { timeout: 180000 });

await page.evaluate(() => window.__setOnFoot(true));
await page.evaluate(() => { try { window.__deploy?.spawn?.(); } catch {} });
await page.evaluate(() => window.__renderOnce(640, 400, 1 / 60));

const step = async (frames, dt) => page.evaluate(
  ([n, d]) => { for (let i = 0; i < n; i++) window.__renderOnce(640, 400, d); },
  [frames, dt]);
const read = async () => page.evaluate(() => window.__parachute());

// Where the ground is under the spawn, so the drop is a stated height.
const start = await read();
const groundY = start.y - (start.height ?? 0);

await page.evaluate(([y, p]) => {
  window.__bailOut(0, y, 0, Math.PI / 2, 80, 0, 0);
  if (p) window.__lookDelta?.(0, 0);
  return true;
}, [groundY + ALT, PITCH]);
// The look the free-fall term steers on. `bailOut` zeroes the pitch, so a
// non-zero one is asked for through the page's own look pump.
if (PITCH) {
  const degrees = (PITCH * 180) / Math.PI;
  await page.evaluate((d) => { window.__lookDelta(0, d * 20); }, degrees);
}

const trace = [];
let t = 0;
let deployed = false;
for (let batch = 0; batch < 200; batch++) {
  await step(PER_BATCH, DT);
  t += PER_BATCH * DT;
  const s = await read();
  trace.push({ t: +t.toFixed(3), ...s });
  if (!deployed && s.state === 'falling' && t >= DEPLOY_AT) {
    await page.evaluate(() => window.__setDeploy(true));
    await step(2, DT);
    await page.evaluate(() => window.__setDeploy(false));
    t += 2 * DT;
    deployed = true;
    trace.push({ t: +t.toFixed(3), note: 'ripcord', ...(await read()) });
  }
  if (s.grounded && t > 1) break;
  await new Promise((r) => setTimeout(r, 25));
}
// A few more frames so the landing clip and its sound land in the log.
await step(5, DT);
trace.push({ t: +(t + 0.5).toFixed(3), note: 'after', ...(await read()) });

console.log(JSON.stringify({ groundY, alt: ALT, trace }, null, 1));
await browser.close();
