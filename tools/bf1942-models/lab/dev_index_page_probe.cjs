// The page's own rounds against the server's draws (ledger DEV-14): a
// headless map.html through a probe sidecar deploys with the assault kit,
// lies down and fires taps, and the page logs the input index it drew each
// round at (`__net().inputDraws`, input-index.js). The server's recorder,
// built with Game+0x68 beside each `f` row (`gi`, wire.md section 42), says
// the index the server drew the same round at; `lab/dev_index_check.py
// --page` reads the two against each other.
//
//   node sidecar/sidecar.mjs 127.0.0.1:14568 --name devpg1 --team 2 --ws 17971
//   python3 serve_viewer.py 5296
//   flock /tmp/claude-1000/bfstats-headless.lock node lab/dev_index_page_probe.cjs page.json
//   python3 lab/dev_index_check.py --page page.json <run>/server/replay_*.ndjson
//
// Env: VPORT (5296), WS (17971), TAPS (15), GAP (ms between taps, 1200),
// HOLD (ms a tap holds, 60), PLAYWRIGHT (module path).
const fs = require('fs');
const { chromium } = require(process.env.PLAYWRIGHT || '/home/dylan/projects/skandia/bfstats/ui/node_modules/playwright');
const PORT = process.env.VPORT || 5296;
const WS = process.env.WS || '17971';
const OUT = process.argv[2] || 'devindex-page.json';
const TAPS = Number(process.env.TAPS || 15);
const GAP = Number(process.env.GAP || 1200);
const HOLD = Number(process.env.HOLD || 60);
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

function instrument() {
  const H = window.__dx = { acks: [], out: [], trig: [] };
  const NWS = window.WebSocket;
  window.WebSocket = class extends NWS {
    constructor(...a) {
      super(...a);
      this.addEventListener('message', (ev) => {
        const text = typeof ev.data === 'string' ? ev.data : new TextDecoder().decode(new Uint8Array(ev.data));
        for (const line of text.split('\n')) {
          if (!line || !line.includes('"ack"')) continue;
          let r; try { r = JSON.parse(line); } catch { continue; }
          if (r.k === 'ack') H.acks.push({ p: performance.now(), seq: r.seq, serial: r.serial, ai: r.ai });
        }
      });
    }
    send(data) {
      const u = data instanceof Uint8Array ? data : (data instanceof ArrayBuffer ? new Uint8Array(data) : null);
      if (u && u[0] === 2) H.out.push({ p: performance.now(), seq: u[1] | (u[2] << 8) | (u[3] << 16) | (u[4] << 24) });
      return super.send(data);
    }
  };
}

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--use-angle=vulkan', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.addInitScript(instrument);
    await page.goto(`http://127.0.0.1:${PORT}/map.html?mod=bf1942&map=wake&shots=1&sidecar=ws%3A%2F%2F127.0.0.1%3A${WS}&team=2`);
    for (let i = 0; i < 240; i++) {
      const ok = await page.evaluate(() => !!(window.__net?.().connected && window.__deploy?.flags.length)).catch(() => false);
      if (ok) break;
      if (i % 5 === 4) { await page.keyboard.press('Enter').catch(() => {}); await page.mouse.click(631, 527).catch(() => {}); }
      await delay(1000);
    }
    let alive = false;
    for (let tries = 0; tries < 8 && !alive; tries++) {
      await page.evaluate(() => {
        const d = window.__deploy; d.setTeam(2);
        const f = d.flags.find((x) => x.team === 2 && x.spawns > 0) ?? d.flags[0];
        d.select(f.name); d.setKit('assault'); d.spawn();
      });
      for (let k = 0; k < 30 && !alive; k++) { await delay(300); alive = await page.evaluate(() => !!(window.__soldier() && window.__net().self?.alive && window.__net().ack > 0)); }
    }
    console.log('alive', alive);
    await delay(2500);
    await page.keyboard.press('z');
    await delay(3000);
    const weapon = () => page.evaluate(() => { const w = window.__handWeapon?.(); return w && { name: w.name, rounds: w.rounds }; });
    console.log('weapon', JSON.stringify(await weapon()));
    for (let b = 0; b < TAPS; b++) {
      await page.evaluate(() => { window.__dx.trig.push({ p: performance.now(), on: 1 }); window.__setTrigger(true); });
      await delay(HOLD);
      await page.evaluate(() => { window.__dx.trig.push({ p: performance.now(), on: 0 }); window.__setTrigger(false); });
      await delay(GAP);
    }
    console.log('weapon after', JSON.stringify(await weapon()));
    const res = await page.evaluate(() => ({ ...window.__dx, draws: window.__net().inputDraws, slot: window.__net().slot }));
    fs.writeFileSync(OUT, JSON.stringify(res));
    console.log('wrote', OUT, 'draws', res.draws.length, 'acks', res.acks.length);
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
