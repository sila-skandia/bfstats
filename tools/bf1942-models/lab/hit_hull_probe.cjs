// Shoot a manned hull (a bot's tank or plane) from the live page, the crosshair
// held on the hull as the page draws it, and log what the server did with
// every round: the page's own view of the shot, the server's rounds and the
// hull's server track, the hit marks. `lab/hit_hull_check.py` puts each server
// round against the server's hull to say which ones hit, and times the marks.
//
//   node sidecar/sidecar.mjs 127.0.0.1:14568 --name hh1 --team 2 --ws 17962 --out run.ndjson
//   python3 serve_viewer.py 5296
//   flock /tmp/claude-1000/bfstats-headless.lock node lab/hit_hull_probe.cjs out.json
//   python3 lab/hit_hull_check.py out.json run.ndjson
//
// Env: VPORT (5296), WS (17962), HULL (template regex, default any tank or
// plane), RANGE (m, 120), SECS (time spent shooting, 90), HOLD (burst ms,
// 400), GAP (ms between bursts, 600), AIMUP (metres above the hull's origin
// to aim, 1.0), LEADS (seconds ahead of the drawn hull, beyond the round's
// flight, one a burst in turn: `0,0.1,0.2`), SPEED (the round's m/s, 1000),
// FLAG (deploy flag index), PLAYWRIGHT (module path).
const fs = require('fs');
const { chromium } = require(process.env.PLAYWRIGHT || '/home/dylan/projects/skandia/bfstats/ui/node_modules/playwright');
const PORT = process.env.VPORT || 5296;
const WS = process.env.WS || '17962';
const OUT = process.argv[2] || 'hithull.json';
const HULL = process.env.HULL || 'sherman|chi-?ha|type|m3a1|zero|aichi|val|corsair|sbd|wildcat|hellcat';
const RANGE = Number(process.env.RANGE || 120);
const SECS = Number(process.env.SECS || 90);
const HOLD = Number(process.env.HOLD || 400);
const GAP = Number(process.env.GAP || 600);
const AIMUP = Number(process.env.AIMUP ?? 1.0);
// LEADS: the leads tried, seconds, one a burst in turn; SPEED: the round's
// speed for its flight time (the BAR's 1000 m/s).
const LEADS = (process.env.LEADS || '0').split(',').map(Number);
const SPEED = Number(process.env.SPEED || 1000);
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

function instrument() {
  const H = window.__hh = { out: [], inn: [], trig: [], hud: [], aim: [], target: null };
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
  let last = 0;
  const frame = () => {
    const p = performance.now();
    const v = window.__hudVars?.()?.['CrossHair/HitIndicationTime'];
    if (Number.isFinite(v)) { if (v > last + 1e-6) H.hud.push({ p, v }); last = v; }
    // The tracker: the camera onto the hull as drawn this frame.
    const id = H.target;
    if (id != null && window.__sidecarPose && window.__camera) {
      const r = window.__sidecarPose(id, p);
      const r0 = window.__sidecarPose(id, p - 50);
      if (r && r0) {
        const c = window.__camera; c.updateMatrixWorld();
        const e = c.matrixWorld.elements;
        const eye = [e[12], e[13], e[14]], fwd = [-e[8], -e[9], -e[10]];
        // LEAD: aim ahead of the hull as drawn by its drawn velocity times
        // (the lead under test + the round's flight to it).
        const v = [(r.x - r0.x) / 0.05, (r.y - r0.y) / 0.05, (r.z - r0.z) / 0.05];
        const d0 = Math.hypot(r.x - eye[0], r.y + H.aimUp - eye[1], r.z - eye[2]);
        const ahead = (H.lead || 0) + d0 / H.speed;
        const tgt = [r.x + v[0] * ahead, r.y + H.aimUp + v[1] * ahead, r.z + v[2] * ahead];
        const dx = tgt[0] - eye[0], dy = tgt[1] - eye[1], dz = tgt[2] - eye[2];
        const dist = Math.hypot(dx, dy, dz);
        const yawT = Math.atan2(-dx, -dz), yawC = Math.atan2(-fwd[0], -fwd[2]);
        let dyaw = (yawT - yawC) * 180 / Math.PI; while (dyaw > 180) dyaw -= 360; while (dyaw < -180) dyaw += 360;
        const dpit = (Math.asin(dy / dist) - Math.asin(Math.max(-1, Math.min(1, fwd[1])))) * 180 / Math.PI;
        H.aim.push({ p, t: r.t, x: r.x, y: r.y, z: r.z, eye, fwd, dist, dyaw, dpit, firing: !!H.firing, lead: H.lead || 0 });
        const cx = Math.round(-dyaw / 0.12), cy = Math.round(-dpit / 0.12);
        if (cx || cy) window.__lookDelta(cx, cy);
      }
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--use-angle=vulkan', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.addInitScript(instrument);
    await page.goto(`http://127.0.0.1:${PORT}/map.html?mod=bf1942&map=wake&shots=1&sidecar=ws%3A%2F%2F127.0.0.1%3A${WS}&team=2${process.env.EXTRA || ''}`);
    for (let i = 0; i < 240; i++) {
      const ok = await page.evaluate(() => !!(window.__net?.().connected && window.__deploy?.flags.length)).catch(() => false);
      if (ok) break;
      if (i % 5 === 4) { await page.keyboard.press('Enter').catch(() => {}); await page.mouse.click(631, 527).catch(() => {}); }
      await delay(1000);
    }
    await page.evaluate(([up, speed]) => { window.__hh.aimUp = up; window.__hh.speed = speed; }, [AIMUP, SPEED]);
    const spawn = async () => {
      for (let tries = 0; tries < 10; tries++) {
        await page.evaluate((flag) => {
          const d = window.__deploy; d.setTeam(2);
          const f = (flag != null ? d.flags[flag] : null) ?? d.flags.find((x) => x.team === 2 && x.spawns > 0) ?? d.flags[0];
          d.select(f.name); d.setKit('assault'); d.spawn();
        }, process.env.FLAG != null ? Number(process.env.FLAG) : null);
        for (let k = 0; k < 30; k++) {
          await delay(300);
          if (await page.evaluate(() => !!(window.__soldier() && window.__net().self?.alive && window.__net().ack > 0))) return true;
        }
      }
      return false;
    };
    console.log('spawned', await spawn());
    await delay(2000);
    const end = Date.now() + SECS * 1000;
    let lastPick = 0, burst = 0;
    while (Date.now() < end) {
      const alive = await page.evaluate(() => !!window.__net().self?.alive);
      if (!alive) { await page.evaluate(() => { window.__hh.target = null; window.__hh.firing = false; window.__setTrigger(false); }); await delay(3000); await spawn(); continue; }
      if (Date.now() - lastPick > 2000) {
        lastPick = Date.now();
        const pick = await page.evaluate(([re, range]) => {
          const n = window.__net(); const s = window.__soldier();
          const rx = new RegExp(re, 'i');
          let best = null;
          for (const h of n.hulls) {
            if (!h.live || !rx.test(h.template || '')) continue;
            const r = window.__sidecarPose(h.id, performance.now());
            if (!r || !r.occupied) continue;
            const d = Math.hypot(r.x - s.x, r.y - s.y, r.z - s.z);
            if (d <= range && (!best || d < best.d)) best = { id: h.id, template: h.template, d };
          }
          window.__hh.target = best?.id ?? null;
          if (best && !window.__hh.targets?.[best.id]) (window.__hh.targets ??= {})[best.id] = best.template;
          return best;
        }, [HULL, RANGE]);
        if (pick) console.log('target', JSON.stringify(pick));
      }
      const st = await page.evaluate(() => { const a = window.__hh.aim.at(-1); return window.__hh.target != null && a ? { dyaw: a.dyaw, dpit: a.dpit, dist: a.dist } : null; });
      if (st && Math.abs(st.dyaw) < 1 && Math.abs(st.dpit) < 1) {
        const w = await page.evaluate(() => window.__handWeapon?.());
        if (w && w.rounds === 0 && !w.reloading) { await page.evaluate(() => window.__reload?.()); await delay(3500); continue; }
        await page.evaluate((lead) => { window.__hh.lead = lead; }, LEADS[burst++ % LEADS.length]);
        await delay(250);
        await page.evaluate(() => { window.__hh.firing = true; window.__hh.trig.push({ p: performance.now(), on: 1, target: window.__hh.target, lead: window.__hh.lead }); window.__setTrigger(true); });
        await delay(HOLD);
        await page.evaluate(() => { window.__hh.firing = false; window.__hh.trig.push({ p: performance.now(), on: 0 }); window.__setTrigger(false); });
        await delay(GAP);
      } else await delay(200);
    }
    const res = await page.evaluate(() => ({ ...window.__hh, slot: window.__net().slot }));
    fs.writeFileSync(OUT, JSON.stringify(res));
    console.log('wrote', OUT, 'bursts', res.trig.filter((t) => t.on).length, 'marks', res.inn.filter((r) => r.k === 'hit').length, 'targets', JSON.stringify(res.targets ?? {}));
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
