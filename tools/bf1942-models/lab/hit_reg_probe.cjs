// Hit registration, timed end to end on the live page: a headless map.html
// through a probe sidecar deploys, aims at a named player (a standing
// `lab/hit_target.mjs`), and fires taps. It logs, on the page's own clock:
//
//   trig   each press of the trigger (and its release)
//   out    each input word the page sends (seq)
//   ack    each ack row (seq, tick, iq, sidecar t)
//   f      the server's rounds the sidecar saw (sidecar t)
//   hit    each hitMark row as it reaches the page
//   hud    each frame where the HUD's CrossHair/HitIndicationTime rose
//
// and writes them as one JSON file for `lab/hit_reg_check.py`.
//
//   node lab/hit_target.mjs 127.0.0.1:14568 tgt1 2 1      (in the background)
//   node sidecar/sidecar.mjs 127.0.0.1:14568 --name hrp1 --team 2 --ws 17962 ...
//   python3 serve_viewer.py 5296
//   flock /tmp/claude-1000/bfstats-headless.lock node lab/hit_reg_probe.cjs out.json
//   python3 lab/hit_reg_check.py out.json
//
// Env: VPORT (viewer port, 5296), WS (sidecar ws port, 17962), TARGET (name,
// tgt1), TAPS (12), HOLD (ms a tap holds, 120), GAP (ms between taps, 900),
// FLAG (deploy flag index), EXTRA (more query, e.g. `&inputPace=slot` for the old pacing A/B),
// PLAYWRIGHT (module path).
const fs = require('fs');
const { chromium } = require(process.env.PLAYWRIGHT || '/home/dylan/projects/skandia/bfstats/ui/node_modules/playwright');
const PORT = process.env.VPORT || 5296;
const WS = process.env.WS || '17962';
const OUT = process.argv[2] || 'hitreg.json';
const TARGET = process.env.TARGET || 'tgt1';
const TAPS = Number(process.env.TAPS || 12);
const HOLD = Number(process.env.HOLD || 120);
const GAP = Number(process.env.GAP || 900);
const EXTRA = process.env.EXTRA || '';
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

function instrument() {
  const H = window.__hr = { out: [], inn: [], trig: [], hud: [], pace: [] };
  const NWS = window.WebSocket;
  window.WebSocket = class extends NWS {
    constructor(...a) {
      super(...a);
      this.addEventListener('message', (ev) => {
        const p = performance.now();
        const text = typeof ev.data === 'string' ? ev.data : new TextDecoder().decode(new Uint8Array(ev.data));
        for (const line of text.split('\n')) {
          if (!line) continue;
          let r; try { r = JSON.parse(line); } catch { continue; }
          if (r.k === 'ack') H.inn.push({ p, k: 'ack', seq: r.seq, tick: r.tick, iq: r.iq, t: r.t });
          else if (r.k === 'f') H.inn.push({ p, k: 'f', t: r.t, pid: r.pid ?? null, id: r.id });
          else if (r.k === 'e' && r.e === 'hitMark') H.inn.push({ p, k: 'hit', t: r.t });
          else if (r.k === 's') H.inn.push({ p, k: 's', t: r.t, tick: r.tick });
        }
      });
    }
    send(data) {
      const u = data instanceof Uint8Array ? data : (data instanceof ArrayBuffer ? new Uint8Array(data) : null);
      if (u && u[0] === 2) H.out.push({ p: performance.now(), seq: u[1] | (u[2] << 8) | (u[3] << 16) | (u[4] << 24) });
      return super.send(data);
    }
  };
  setInterval(() => { try { const n = window.__net?.(); if (n) H.pace.push({ p: performance.now(), scale: n.timeScale, iq: n.inputQueue }); } catch {} }, 250);
  let last = 0;
  const watch = () => {
    const v = window.__hudVars?.()?.['CrossHair/HitIndicationTime'];
    if (Number.isFinite(v)) { if (v > last + 1e-6) H.hud.push({ p: performance.now(), v }); last = v; }
    requestAnimationFrame(watch);
  };
  requestAnimationFrame(watch);
}

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--use-angle=vulkan', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.addInitScript(instrument);
    await page.goto(`http://127.0.0.1:${PORT}/map.html?mod=bf1942&map=wake&shots=1&sidecar=ws%3A%2F%2F127.0.0.1%3A${WS}&team=2${EXTRA}`);
    for (let i = 0; i < 240; i++) {
      const ok = await page.evaluate(() => !!(window.__net?.().connected && window.__deploy?.flags.length)).catch(() => false);
      if (ok) break;
      if (i % 5 === 4) { await page.keyboard.press('Enter').catch(() => {}); await page.mouse.click(631, 527).catch(() => {}); }
      await delay(1000);
    }
    for (let tries = 0; tries < 8; tries++) {
      // FLAG: the deploy flag's index (its spawn group is index + 1): the
      // target's group puts the two at one spawn.
      await page.evaluate((flag) => {
        const d = window.__deploy; d.setTeam(2);
        const f = (flag != null ? d.flags[flag] : null) ?? d.flags.find((x) => x.team === 2 && x.spawns > 0) ?? d.flags[0];
        d.select(f.name); d.setKit('assault'); d.spawn();
      }, process.env.FLAG != null ? Number(process.env.FLAG) : null);
      let alive = false;
      for (let k = 0; k < 30 && !alive; k++) { await delay(300); alive = await page.evaluate(() => !!(window.__soldier() && window.__net().self?.alive && window.__net().ack > 0)); }
      if (alive) break;
    }
    await delay(2500);
    // Aim at the target's chest: turn through the page's own look path
    // (`__lookDelta`, 0.120 deg a count) until the camera is on him.
    const aim = async () => page.evaluate((name) => {
      const n = window.__net();
      const slot = Object.entries(n.remoteNames).find(([, v]) => v === name)?.[0];
      if (slot == null) return { err: 'no target', names: n.remoteNames };
      const r = n.remote(Number(slot));
      if (!r) return { err: 'no row' };
      const c = window.__camera; c.updateMatrixWorld();
      const e = c.matrixWorld.elements;
      const eye = [e[12], e[13], e[14]];
      const fwd = [-e[8], -e[9], -e[10]];
      const tgt = [r.x, r.y + 1.2, r.z];
      const dx = tgt[0] - eye[0], dy = tgt[1] - eye[1], dz = tgt[2] - eye[2];
      const dist = Math.hypot(dx, dy, dz);
      const yawT = Math.atan2(-dx, -dz), yawC = Math.atan2(-fwd[0], -fwd[2]);
      const pitT = Math.asin(dy / dist), pitC = Math.asin(fwd[1]);
      let dyaw = (yawT - yawC) * 180 / Math.PI; while (dyaw > 180) dyaw -= 360; while (dyaw < -180) dyaw += 360;
      const dpit = (pitT - pitC) * 180 / Math.PI;
      return { dist, dyaw, dpit, slot: Number(slot) };
    }, TARGET);
    let a = null;
    // Walk up to him first (W, steering by the same look), so a rifle's
    // spread does not decide the hits: within NEAR metres.
    const NEAR = Number(process.env.NEAR || 15);
    for (let k = 0; k < 120; k++) {
      a = await aim();
      if (a.err) { await delay(500); continue; }
      if (a.dist <= NEAR) break;
      await page.evaluate(([x]) => { window.__lookDelta(x, 0); window.__keys.add('KeyW'); }, [Math.round(-a.dyaw / 0.12)]);
      await delay(300);
    }
    await page.evaluate(() => window.__keys.delete('KeyW'));
    // A life the page took up from an earlier run may have an empty magazine.
    await page.evaluate(() => window.__reload?.());
    await delay(3500);
    for (let k = 0; k < 40; k++) {
      a = await aim();
      if (a.err) { await delay(500); continue; }
      if (Math.abs(a.dyaw) < 0.15 && Math.abs(a.dpit) < 0.15) break;
      const cx = Math.round(-a.dyaw / 0.12), cy = Math.round(-a.dpit / 0.12);
      await page.evaluate(([x, y]) => window.__lookDelta(x, y), [cx, cy]);
      await delay(250);
    }
    console.log('aim', JSON.stringify(a));
    const weapon = () => page.evaluate(() => { const w = window.__handWeapon?.(); const n = window.__net(); return w && { name: w.name, rounds: w.rounds, mags: w.mags, reloading: w.reloading, alive: n.self?.alive, hp: n.self?.hp }; });
    console.log('weapon', JSON.stringify(await weapon()));
    for (let b = 0; b < TAPS; b++) {
      a = await aim();
      if (!a.err && (Math.abs(a.dyaw) > 0.15 || Math.abs(a.dpit) > 0.15)) {
        await page.evaluate(([x, y]) => window.__lookDelta(x, y), [Math.round(-a.dyaw / 0.12), Math.round(-a.dpit / 0.12)]);
        await delay(300);
      }
      await page.evaluate(() => { window.__hr.trig.push({ p: performance.now(), on: 1 }); window.__setTrigger(true); });
      await delay(HOLD);
      await page.evaluate(() => { window.__hr.trig.push({ p: performance.now(), on: 0 }); window.__setTrigger(false); });
      await delay(GAP);
    }
    console.log('weapon after', JSON.stringify(await weapon()));
    const res = await page.evaluate(() => ({ ...window.__hr, slot: window.__net().slot, net: { inputQueue: window.__net().inputQueue, timeScale: window.__net().timeScale } }));
    res.aim = a;
    fs.writeFileSync(OUT, JSON.stringify(res));
    console.log('wrote', OUT, 'words', res.out.length, 'rows', res.inn.length, 'hud rises', res.hud.length);
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
