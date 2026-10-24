// Fast swings on a seated gun from the live page, against the server's own
// turret at every acknowledged tick (features/udp-sidecar/wire.md section 40).
//
// The page boards a free hull through the server (as `seat_aim_probe.cjs`),
// takes a seat, and swings the gun hard both ways in yaw and pitch, with
// rests between, as a player swinging onto a target does. It logs, per
// rendered frame, the page's own rig (each axis's angle and speed register)
// and, per ack, the server's bundles (`__net().seatAim`: the server's angle
// at the acked tick and the page's present one) and the correction the page
// applied (`seatAimCorrection`: the server's angle less the page's AT the
// acked tick, per axis). `lab/seat_swing_check.py` reads the output.
//
//   node sidecar/sidecar.mjs 127.0.0.1:14568 --name ss1 --team 2 --ws 17992 --out ss.ndjson
//   python3 serve_viewer.py 5297
//   flock /tmp/claude-1000/bfstats-headless.lock node lab/seat_swing_probe.cjs out.json
//
// Env: VPORT (5297), WS (17992), HULL (template regex, defgun), SEAT (0),
// RATE (counts a frame in a swing, 40), SECS (60), EXTRA (map.html params,
// e.g. `&seatAimSync=0` for the old law).
const fs = require('fs');
const { chromium } = require(process.env.PLAYWRIGHT || '/home/dylan/projects/skandia/bfstats/ui/node_modules/playwright');
const PORT = process.env.VPORT || 5297;
const WS = process.env.WS || '17992';
const OUT = process.argv[2] || 'seatswing.json';
const HULL = process.env.HULL || 'defgun';
const SEAT = Number(process.env.SEAT ?? 0);
const RATE = Number(process.env.RATE || 40);
const ENTER_FAR = Number(process.env.ENTER_FAR || 8);
const SECS = Number(process.env.SECS || 60);
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

function instrument() {
  const H = window.__ss = { frames: [], acks: [], plan: null, step: 0 };
  let lastAck = null;
  // The DRAWN gun against the server's: each rig node's rotation relative to
  // the hull root, against the server's joint row for the part of the same
  // name (the control state's bundles, as the sidecar writes them). An angle
  // between two orientations, so it sees a pose the rig's numbers do not (a
  // rest taken from an already-turned node).
  const drawnVsServer = (n, rig) => {
    try {
      const occ = window.__seatOccupancy();
      const id = n.seatAim?.vehicle ?? null;
      const pose = id != null ? window.__sidecarPose(id) : null;
      if (!occ?.root || !pose?.joints?.length) return null;
      const Q = occ.root.quaternion.constructor;
      const rq = occ.root.getWorldQuaternion(new Q()).invert();
      return rig.axes.map((a) => {
        const nm = String(a.node?.name || '').replace(/_\d+$/, '').toLowerCase();
        const j = pose.joints.find((x) => String(x.name || '').toLowerCase() === nm);
        if (!j?.q) return null;
        const rel = rq.clone().multiply(a.node.getWorldQuaternion(new Q()));
        const dot = Math.min(1, Math.abs(rel.x * j.q[0] + rel.y * j.q[1] + rel.z * j.q[2] + rel.w * j.q[3]));
        return +(2 * Math.acos(dot) * 180 / Math.PI).toFixed(3);
      });
    } catch (e) { return String(e); }
  };
  // The drawn view's heading and pitch, degrees, page frame. With the hull
  // still, heading + traverse and pitch + elevation hold constant for as
  // long as the rig measures from the parts' rest: a rig built on a turned
  // part shows as a step in them at re-entry.
  // In the hull's own frame, so a hull that turns or tips under the gun
  // (a tank on its springs) does not read as an offset.
  const camAim = () => {
    const c = window.__camera; if (!c) return null;
    c.updateMatrixWorld();
    const e = c.matrixWorld.elements;
    let f = [-e[8], -e[9], -e[10]];
    const root = window.__seatOccupancy?.()?.root;
    if (root) {
      root.updateMatrixWorld();
      const r = root.matrixWorld.elements;
      // The hull's axes (columns), normalised; the camera's forward on them.
      const ax = [0, 4, 8].map((k) => { const v = [r[k], r[k + 1], r[k + 2]]; const n = Math.hypot(...v) || 1; return v.map((x) => x / n); });
      f = ax.map((a) => a[0] * f[0] + a[1] * f[1] + a[2] * f[2]);
    }
    return [+(Math.atan2(-f[0], -f[2]) * 180 / Math.PI).toFixed(3), +(Math.asin(Math.max(-1, Math.min(1, f[1]))) * 180 / Math.PI).toFixed(3)];
  };
  const frame = () => {
    const n = window.__net?.();
    const rig = window.__seatOccupancy?.()?.turret ?? null;
    if (rig && H.plan) {
      const [dx, dy] = H.plan[H.step] ?? [0, 0];
      if (H.step < H.plan.length) H.step++;
      if (dx || dy) window.__lookDelta(dx, dy);
      H.frames.push({ p: performance.now(), dx, dy,
        axes: rig.axes.map((a) => [a.axisName, +a.angle.toFixed(4), +a.speed.toFixed(4)]) });
      const c = n?.seatAimCorrection;
      if (c && c.ack !== lastAck) {
        lastAck = c.ack;
        const s = n.seatAim;
        H.acks.push({ p: performance.now(), ack: c.ack, deltas: c.deltas,
          rows: s?.rows ?? null, bundles: s?.bundles ?? null,
          drawn: drawnVsServer(n, rig), cam: camAim() });
      }
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

// One swing schedule, in frames (about 60 a second headless at best, fewer
// under load: what matters is the counts, which the page sums per frame).
function plan(rate) {
  const p = [];
  const hold = (n, dx, dy) => { for (let i = 0; i < n; i++) p.push([dx, dy]); };
  for (let rep = 0; rep < 3; rep++) {
    hold(25, rate, 0); hold(90, 0, 0);            // a fast swing right, then let it settle
    hold(40, -rate, 0); hold(90, 0, 0);           // a longer one back
    hold(12, rate, Math.round(rate / 3)); hold(8, -rate, 0); hold(90, 0, 0); // a flick and a reversal
    hold(20, 0, Math.round(rate / 2)); hold(60, 0, 0);   // down hard (to the stop)
    hold(30, 0, -Math.round(rate / 2)); hold(60, 0, 0);  // up past level
    hold(60, Math.round(rate / 4), 0); hold(90, 0, 0);  // a steady pan
  }
  return p;
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
    const spawn = async () => {
      let alive = false;
      for (let tries = 0; tries < 10 && !alive; tries++) {
        await page.evaluate((flag) => {
          const d = window.__deploy; d.setTeam(2);
          const f = (flag != null ? d.flags[flag] : null) ?? d.flags.find((x) => x.team === 2 && x.spawns > 0) ?? d.flags[0];
          d.select(f.name); d.setKit('assault'); d.spawn();
        }, process.env.FLAG ? Number(process.env.FLAG) : null);
        for (let k = 0; k < 30 && !alive; k++) { await delay(300); alive = await page.evaluate(() => !!(window.__soldier() && window.__net().self?.alive && window.__net().ack > 0)); }
      }
      await delay(2000);
    };
    await spawn();
    const tried = new Map();   // hull id -> doors tried; a gun whose door never answers is passed over
    const pick = () => page.evaluate(([re, skip]) => {
      const n = window.__net(); const s = window.__soldier(); const rx = new RegExp(re, 'i');
      if (!s || !n.self?.alive) return { dead: true };
      let best = null;
      for (const h of n.hulls) {
        if (!h.live || !rx.test(h.template || '') || skip.includes(h.id)) continue;
        const r = window.__sidecarPose(h.id, performance.now());
        if (!r || r.occupied) continue;
        const d = Math.hypot(r.x - s.x, r.z - s.z);
        if (!best || d < best.d) best = { id: h.id, template: h.template, d, x: r.x, z: r.z };
      }
      return best;
    }, [HULL, [...tried].filter(([, n]) => n >= 5).map(([id]) => id)]);
    const board = async () => {
      let boarded = false;
      let lastD = Infinity, stuck = 0;
      for (let k = 0; k < 2000 && !boarded; k++) {
        const h = await pick();
        if (h?.dead) { await spawn(); continue; }
        if (!h) { await delay(500); continue; }
        if (h.d > 3.5 && h.d > lastD - 0.2) stuck++; else stuck = 0;
        lastD = h.d;
        if (stuck >= 6 && h.d < ENTER_FAR) {
          // Blocked within reach of a big gun's door (an emplacement's walls):
          // try the door from here.
          await page.evaluate(() => { window.__keys.delete('KeyW'); window.__seatToggle(); });
          await delay(1500);
          boarded = await page.evaluate(() => !!window.__seat().onboard);
          tried.set(h.id, (tried.get(h.id) ?? 0) + 1);
          stuck = 0;
          continue;
        }
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
            if (Math.abs(dy) > 20) { window.__keys.delete('KeyW'); window.__lookDelta(Math.round(-dy / 0.12), 0); return dy; }
            window.__lookDelta(Math.max(-60, Math.min(60, Math.round(-dy / 0.12))), 0); window.__keys.add('KeyW');
            return dy;
          }, [h.x, h.z]);
          await delay(250);
        } else {
          await page.evaluate(() => { window.__keys.delete('KeyW'); window.__seatToggle(); });
          await delay(1500);
          boarded = await page.evaluate(() => !!window.__seat().onboard);
        }
      }
      await page.evaluate(() => window.__keys.delete('KeyW'));
      return boarded;
    };
    let boarded = await board();
    console.log('boarded', boarded, JSON.stringify(await page.evaluate(() => window.__seat())));
    if (!boarded) throw new Error('could not board');
    for (let k = 0; k < 10 && SEAT; k++) {
      const s = await page.evaluate(() => window.__seat());
      if (s.seat === SEAT) break;
      await page.evaluate((n) => window.__switchSeat(n), SEAT);
      await delay(1500);
    }
    await delay(2000);
    console.log('seat', JSON.stringify(await page.evaluate(() => ({ seat: window.__seat(), aim: window.__net().seatAim }))));
    await page.evaluate((p) => { window.__ss.plan = p; window.__ss.step = 0; }, plan(RATE));
    const end = Date.now() + SECS * 1000;
    while (Date.now() < end) {
      await delay(1000);
      const done = await page.evaluate(() => window.__ss.step >= window.__ss.plan.length);
      if (done) break;
    }
    if (process.env.REENTER !== '0') {
      // Out, a pause while the server's rows pose the gun as it was left,
      // and back in: the second rig is built on a node that is not at rest.
      await page.evaluate(() => { window.__ss.mark = (window.__ss.mark || []).concat([{ p: performance.now(), what: 'exit' }]); window.__seatToggle(); });
      await delay(4000);
      const again = await board();
      console.log('re-boarded', again);
      await delay(2000);
      await page.evaluate((p) => { window.__ss.mark.push({ p: performance.now(), what: 'reenter' }); window.__ss.plan = p; window.__ss.step = 0; }, plan(RATE));
      const end2 = Date.now() + SECS * 1000;
      while (Date.now() < end2) {
        await delay(1000);
        if (await page.evaluate(() => window.__ss.step >= window.__ss.plan.length)) break;
      }
    }
    await delay(2000);
    const res = await page.evaluate(() => ({ marks: window.__ss.mark || [], frames: window.__ss.frames, acks: window.__ss.acks, seat: window.__seat(),
      fixes: window.__net().seatAimFixes }));
    fs.writeFileSync(OUT, JSON.stringify(res));
    console.log('wrote', OUT, 'frames', res.frames.length, 'acks', res.acks.length);
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
