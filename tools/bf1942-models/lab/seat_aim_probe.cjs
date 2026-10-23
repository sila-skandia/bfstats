// A seated gun traversed and fired from the live page, against the server's
// own turret at each acknowledged tick: the page boards a free hull through
// the server, takes a seat, pans at a steady hand, and logs every ack's
// correction (`__net().seatAimCorrection`: the server's bundle angle less the
// page's at that tick, per axis) and the hit marks.
//
//   node sidecar/sidecar.mjs 127.0.0.1:14568 --name sa1 --team 2 --ws 17962 --out run.ndjson
//   python3 serve_viewer.py 5296
//   flock /tmp/claude-1000/bfstats-headless.lock node lab/seat_aim_probe.cjs out.json
//
// Env: VPORT, WS, HULL (template regex, Sherman), SEAT (seat index, 1: the
// pintle), RATE (look counts a frame, 6), SECS (pan time, 40), FLAG.
const fs = require('fs');
const { chromium } = require(process.env.PLAYWRIGHT || '/home/dylan/projects/skandia/bfstats/ui/node_modules/playwright');
const PORT = process.env.VPORT || 5296;
const WS = process.env.WS || '17962';
const OUT = process.argv[2] || 'seataim.json';
const HULL = process.env.HULL || 'sherman';
const SEAT = Number(process.env.SEAT ?? 1);
const RATE = Number(process.env.RATE || 6);
const SECS = Number(process.env.SECS || 40);
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

function instrument() {
  const H = window.__sa = { fix: [], hit: [], frames: 0, pan: 0, dir: 1 };
  const NWS = window.WebSocket;
  window.WebSocket = class extends NWS {
    constructor(...a) {
      super(...a);
      this.addEventListener('message', (ev) => {
        const text = typeof ev.data === 'string' ? ev.data : new TextDecoder().decode(new Uint8Array(ev.data));
        if (text.includes('"hitMark"')) H.hit.push(performance.now());
      });
    }
  };
  let lastAck = null;
  const frame = () => {
    H.frames++;
    const n = window.__net?.();
    const c = n?.seatAimCorrection;
    if (c && c.ack !== lastAck) {
      lastAck = c.ack;
      H.fix.push({ p: performance.now(), ack: c.ack, deltas: c.deltas, panning: H.pan, firing: !!H.firing });
    }
    if (H.pan) window.__lookDelta(H.pan * H.dir, 0);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--use-angle=vulkan', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    page.on('console', (m) => { const t = m.text(); if (/seat|board|enter/i.test(t)) console.log('[page]', t.slice(0, 160)); });
    await page.addInitScript(instrument);
    await page.goto(`http://127.0.0.1:${PORT}/map.html?mod=bf1942&map=wake&shots=1&sidecar=ws%3A%2F%2F127.0.0.1%3A${WS}&team=2${process.env.EXTRA || ''}`);
    for (let i = 0; i < 240; i++) {
      const ok = await page.evaluate(() => !!(window.__net?.().connected && window.__deploy?.flags.length)).catch(() => false);
      if (ok) break;
      if (i % 5 === 4) { await page.keyboard.press('Enter').catch(() => {}); await page.mouse.click(631, 527).catch(() => {}); }
      await delay(1000);
    }
    let alive = false;
    for (let tries = 0; tries < 10 && !alive; tries++) {
      await page.evaluate((flag) => {
        const d = window.__deploy; d.setTeam(2);
        const f = (flag != null ? d.flags[flag] : null) ?? d.flags.find((x) => x.team === 2 && x.spawns > 0) ?? d.flags[0];
        d.select(f.name); d.setKit('assault'); d.spawn();
      }, process.env.FLAG != null ? Number(process.env.FLAG) : null);
      for (let k = 0; k < 30 && !alive; k++) { await delay(300); alive = await page.evaluate(() => !!(window.__soldier() && window.__net().self?.alive && window.__net().ack > 0)); }
    }
    await delay(2000);
    // The nearest free hull, walked to and boarded through the server.
    const pick = () => page.evaluate((re) => {
      const n = window.__net(); const s = window.__soldier(); const rx = new RegExp(re, 'i');
      let best = null;
      for (const h of n.hulls) {
        if (!h.live || !rx.test(h.template || '')) continue;
        const r = window.__sidecarPose(h.id, performance.now());
        if (!r || r.occupied) continue;
        const d = Math.hypot(r.x - s.x, r.z - s.z);
        if (!best || d < best.d) best = { id: h.id, template: h.template, d, x: r.x, z: r.z };
      }
      return best;
    }, HULL);
    let boarded = false;
    let lastD = Infinity, stuck = 0;
    for (let k = 0; k < 400 && !boarded; k++) {
      const h = await pick();
      if (!h) { await delay(500); continue; }
      // Blocked (a wall between): sidestep along it for a while.
      if (h.d > 3.5 && h.d > lastD - 0.2) stuck++; else stuck = 0;
      lastD = h.d;
      if (stuck >= 6) {
        const side = Math.floor(k / 60) % 2 ? 'KeyA' : 'KeyD';
        await page.evaluate((key) => { window.__keys.add(key); window.__keys.add('KeyW'); }, side);
        await delay(1800);
        await page.evaluate((key) => window.__keys.delete(key), side);
        stuck = 0; lastD = Infinity;
        continue;
      }
      if (k % 20 === 0) console.log('hull', JSON.stringify(h));
      if (h.d > 3.5) {
        await page.evaluate(([x, z]) => {
          const s = window.__soldier(); const c = window.__camera; c.updateMatrixWorld();
          const e = c.matrixWorld.elements; const fwd = [-e[8], -e[10]];
          let dy = (Math.atan2(-(x - s.x), -(z - s.z)) - Math.atan2(-fwd[0], -fwd[1])) * 180 / Math.PI;
          while (dy > 180) dy -= 360; while (dy < -180) dy += 360;
          // A big turn first, standing; then walk with small corrections.
          if (Math.abs(dy) > 20) { window.__keys.delete('KeyW'); window.__lookDelta(Math.round(-dy / 0.12), 0); return dy; }
          window.__lookDelta(Math.max(-60, Math.min(60, Math.round(-dy / 0.12))), 0); window.__keys.add('KeyW');
          return dy;
        }, [h.x, h.z]).then((dy) => { if (k % 20 === 0) console.log('steer', dy.toFixed(1)); });
        await delay(250);
      } else {
        await page.evaluate(() => { window.__keys.delete('KeyW'); window.__seatToggle(); });
        await delay(1500);
        boarded = await page.evaluate(() => !!window.__seat().onboard);
      }
    }
    await page.evaluate(() => window.__keys.delete('KeyW'));
    console.log('boarded', boarded, JSON.stringify(await page.evaluate(() => window.__seat())));
    if (!boarded) throw new Error('could not board');
    for (let k = 0; k < 10; k++) {
      const s = await page.evaluate(() => window.__seat());
      if (s.seat === SEAT) break;
      await page.evaluate((n) => window.__switchSeat(n), SEAT);
      await delay(1500);
    }
    console.log('seat', JSON.stringify(await page.evaluate(() => ({ seat: window.__seat(), aim: window.__net().seatAim }))));
    await delay(1500);
    if (process.env.TARGET) {
      // TARGET: a standing player (`lab/hit_target.mjs`); the crosshair is
      // put on his chest through the seat's own aim and one tap fired, again
      // and again: the server's HitFromPos on him says where the round went.
      const aim = () => page.evaluate((name) => {
        const n = window.__net();
        const slot = Object.entries(n.remoteNames).find(([, v]) => v === name)?.[0];
        if (slot == null) return { err: 'no target' };
        const r = n.remote(Number(slot), performance.now());
        if (!r) return { err: 'no row' };
        const c = window.__camera; c.updateMatrixWorld();
        const e = c.matrixWorld.elements;
        const eye = [e[12], e[13], e[14]], fwd = [-e[8], -e[9], -e[10]];
        const dx = r.x - eye[0], dy = r.y + 1.2 - eye[1], dz = r.z - eye[2];
        const dist = Math.hypot(dx, dy, dz);
        let dyaw = (Math.atan2(-dx, -dz) - Math.atan2(-fwd[0], -fwd[2])) * 180 / Math.PI;
        while (dyaw > 180) dyaw -= 360; while (dyaw < -180) dyaw += 360;
        const dpit = (Math.asin(dy / dist) - Math.asin(fwd[1])) * 180 / Math.PI;
        return { dist, dyaw, dpit };
      }, process.env.TARGET);
      const taps = Number(process.env.TAPS || 15);
      const log = [];
      for (let t = 0; t < taps; t++) {
        let a = null;
        for (let k = 0; k < 30; k++) {
          a = await aim();
          if (a.err) { await delay(500); continue; }
          if (Math.abs(a.dyaw) < 0.1 && Math.abs(a.dpit) < 0.1) break;
          await page.evaluate(([x, y]) => window.__lookDelta(x, y), [Math.round(-a.dyaw / 0.12), Math.round(-a.dpit / 0.12)]);
          await delay(300);
        }
        await delay(400);
        a = await aim();
        const at = Date.now();
        await page.evaluate(() => window.__setSeatFire(true));
        await delay(Number(process.env.HOLD || 60));
        await page.evaluate(() => window.__setSeatFire(false));
        await delay(1200);
        log.push({ at, ...a });
        console.log('tap', JSON.stringify({ at, ...a }));
      }
      const res = await page.evaluate(() => ({ fix: window.__sa.fix, hit: window.__sa.hit, seat: window.__seat(), aim: window.__net().seatAim }));
      res.taps = log;
      fs.writeFileSync(OUT, JSON.stringify(res));
      console.log('wrote', OUT, 'taps', log.length, 'marks', res.hit.length);
      return;
    }
    const end = Date.now() + SECS * 1000;
    let b = 0;
    while (Date.now() < end) {
      // Pan one way for 1.5 s, still for 0.5 s, back the other way; fire
      // through the middle of each pan.
      await page.evaluate(([rate]) => { window.__sa.pan = rate; window.__sa.dir *= -1; }, [RATE]);
      await delay(400);
      await page.evaluate(() => { window.__sa.firing = true; window.__setSeatFire(true); });
      await delay(700);
      await page.evaluate(() => { window.__sa.firing = false; window.__setSeatFire(false); });
      await delay(400);
      await page.evaluate(() => { window.__sa.pan = 0; });
      await delay(500);
      b++;
    }
    const res = await page.evaluate(() => ({ fix: window.__sa.fix, hit: window.__sa.hit, frames: window.__sa.frames, seat: window.__seat(), aim: window.__net().seatAim }));
    fs.writeFileSync(OUT, JSON.stringify(res));
    console.log('wrote', OUT, 'acks', res.fix.length, 'pans', b);
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
