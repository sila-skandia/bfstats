// The hull and the seat the page holds, at the server's state (features/
// udp-sidecar/wire.md section 48): the live page boards a free hull through
// the server (as `seat_swing_probe.cjs`), and logs
//
//   1. the driver's hit points as the page has them (its HUD's Armor,
//      `__inputGate().occupied`) against the server's, then the same after
//      a hit-point row for the hull is handed to the client
//      (`__sidecarRow`: the lab will not shoot the hull on demand), and back;
//   2. in the gunner's seat (SEAT, default 1), the gun's rounds and
//      magazines as the page has them (`__occupancy.fireArms`) against the
//      server's (`__net().selfMags`), before and after a burst (FIRE_MS);
//   3. HOLD_MS: sat on in the seat, where the page draws the hull against the
//      server's pose, whether the server's entity for it stands, and how
//      every remote is drawn (`seatBody`: in his seat's own body); run
//      `lab/seat_probe.mjs` meanwhile to drive the hull or to sit in it.
//
// Env: VPORT, WS, HULL (template regex), AVOID (hull ids passed over), SEAT,
// FIRE_MS, HOLD_MS, FLAG.
//
//   node sidecar/sidecar.mjs 127.0.0.1:14858 --name sp1 --team 2 --ws 17958 --out sp.ndjson
//   python3 serve_viewer.py 5358
//   VPORT=5358 WS=17958 HULL=m3a1 flock <lock> node lab/seat_state_probe.cjs out.json
const fs = require('fs');
const { chromium } = require(process.env.PLAYWRIGHT || '/home/dylan/projects/skandia/bfstats/ui/node_modules/playwright');
const PORT = process.env.VPORT || 5358;
const WS = process.env.WS || '17958';
const OUT = process.argv[2] || 'seatstate.json';
const HULL = process.env.HULL || 'm3a1';
const SEAT = Number(process.env.SEAT ?? 1);
const FIRE_MS = Number(process.env.FIRE_MS ?? 1500);
const ENTER_FAR = Number(process.env.ENTER_FAR || 8);
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--use-angle=vulkan', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    page.on('console', (m) => { const t = m.text(); if (/seat|board|enter/i.test(t)) console.log('[page]', t.slice(0, 160)); });
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
    }, [HULL, [...tried].filter(([, n]) => n >= 5).map(([id]) => id).concat((process.env.AVOID ?? "").split(",").filter(Boolean).map(Number))]);
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
    await delay(2500);
    const look = () => page.evaluate(() => {
      const n = window.__net();
      const seat = window.__seat();
      const id = n.self?.vehicleId ?? null;
      const hull = id != null ? n.hulls.find((h) => h.id === id) : null;
      return { t: performance.now(), seat, id, seatIndex: n.self?.seatIndex ?? null,
        pageHp: window.__inputGate?.().occupied ?? null, serverHp: hull?.hp ?? null,
        guns: window.__occupancy?.fireArms?.map((g) => ({ name: g.name, ammo: g.ammo, magsLeft: g.magsLeft })) ?? null,
        selfMags: n.selfMags, ammoFixes: n.seatAmmoFixes,
        adopt: n.adoptNote, rehosted: n.seatRehosted, onEntity: n.seatOnEntity };
    });
    const res = { steps: [] };
    const step = async (what) => { const s = await look(); s.what = what; res.steps.push(s); console.log(what, JSON.stringify(s)); return s; };
    const d0 = await step('driver');
    if (d0.id != null) {
      await page.evaluate((id) => window.__sidecarRow({ k: 'a', t: 0, a: [[id, 63]] }), d0.id);
      await delay(600);
      await step('driver after hp 63');
      await page.evaluate((id) => window.__sidecarRow({ k: 'a', t: 0, a: [[id, 100]] }), d0.id);
      await delay(600);
      await step('driver after hp 100');
    }
    for (let k = 0; k < 10; k++) {
      const s = await page.evaluate(() => window.__seat());
      if (s.seat === SEAT) break;
      await page.evaluate((n) => window.__switchSeat(n), SEAT);
      await delay(1500);
    }
    await delay(1500);
    await step('gunner');
    await page.evaluate(() => window.__setSeatFire(true));
    for (let at = 0; at < FIRE_MS; at += 150) { await delay(150); await step('gunner firing'); }
    await page.evaluate(() => window.__setSeatFire(false));
    await step('gunner just released');
    for (let at = 0; at < 1500; at += 150) { await delay(150); await step('gunner after'); }
    await step('gunner settled');
    await delay(3000);
    await step('gunner later');
    // HOLD_MS: sit on in the gun while someone else may drive the hull,
    // logging where the page draws the hull against the server's pose and
    // whether the server's own entity for it stands (`__serverWorld`).
    const holdEnd = Date.now() + Number(process.env.HOLD_MS ?? 0);
    res.hold = [];
    while (Date.now() < holdEnd) {
      const h = await page.evaluate(() => {
        const occ = window.__seatOccupancy?.();
        const root = occ?.root;
        const n = window.__net();
        const id = n.self?.vehicleId ?? null;
        let drawn = null;
        if (root) { root.updateMatrixWorld(true); const e = root.matrixWorld.elements; drawn = [e[12], e[13], e[14]].map((v) => +v.toFixed(2)); }
        const s = id != null ? window.__sidecarPose(id, performance.now()) : null;
        const ent = (window.__serverWorld()?.entities ?? []).find((e) => e.id === id) ?? null;
        return { t: performance.now(), id, seat: window.__seat().seat, drawn,
          server: s ? [s.x, s.y, s.z].map((v) => +v.toFixed(2)) : null, occupied: s?.occupied ?? null,
          entity: ent ? { visible: ent.visible, meshes: ent.meshes } : null,
          remotes: (window.__remotes?.() ?? []).map((r) => ({ slot: r.slot, visible: r.visible, seatBody: r.seatBody })) };
      });
      res.hold.push(h);
      if (res.hold.length % 10 === 1) console.log('hold', JSON.stringify(h));
      await delay(500);
    }
    // A count the server's gun does not have, on an ack the page's rounds are
    // all behind: the page's gun takes it, and the next real ack puts it back.
    // The ack and a snapshot behind it in one go, read at once: the page
    // corrects on the snapshot, and the next real ack would replace the row.
    const injected = await page.evaluate(() => {
      const m = window.__net().selfMags;
      if (!m) return null;
      window.__sidecarRow({ k: 'ack', seq: m.ack, id: m.id, hmag: m.guns.map((g) => [g[0], 321, g[2]]) });
      window.__sidecarRow({ k: 's', o: [] });
      return { guns: window.__occupancy?.fireArms?.map((g) => ({ name: g.name, ammo: g.ammo })), fixes: window.__net().seatAmmoFixes };
    });
    res.injected = injected;
    console.log('injected', JSON.stringify(injected));
    await step('gunner after a 321 ack');
    await delay(1000);
    await step('gunner after the real acks');
    // Out again, so the sidecar's player is not left in the hull for the next run.
    await page.evaluate(() => window.__seatToggle());
    await delay(1500);
    await step('out');
    fs.writeFileSync(OUT, JSON.stringify(res));
    console.log('wrote', OUT);
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
