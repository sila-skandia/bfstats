// The spawn screen's selection on the live page, retail's way (ledger
// SPAWNGRP-12, features/udp-sidecar/browser.md "No spawn point until a
// click"): a headless map.html through a probe sidecar
//
//   1. waits on the deploy screen with nothing chosen and commits: no spawn
//      row may reach the sidecar, no body may stand, the screen closes;
//   2. reopens it (Caps Lock), clicks a ring with the real mouse, presses
//      DONE: the server stands him on that group;
//   3. suicides (the screen's SUICIDE) and touches nothing: the page asks for
//      the committed group again and the server stands him there at a wave;
//   4. watches the server's spawn table against the screen's offer for
//      WATCH_S seconds (bots take flags on a co-op lab): every sample's
//      offered flags must be the flags a group of which the table draws for
//      his side, whatever the page's own capture state says.
//
//   node sidecar/sidecar.mjs 127.0.0.1:14728 --name ss1 --team 2 --ws 18122 > ss.log
//   python3 serve_viewer.py 5520
//   flock /tmp/claude-1000/bfstats-headless.lock node lab/spawn_select_probe.cjs out.json
//
// Env: VPORT (5520), WS (18122), MAP (wake), TEAM (2), FLAG (a flag name to
// click; else the first offered with points), WATCH_S (240), PLAYWRIGHT.
const fs = require('fs');
const { chromium } = require(process.env.PLAYWRIGHT || '/home/dylan/projects/skandia/bfstats/ui/node_modules/playwright');
const PORT = process.env.VPORT || 5520;
const WS = process.env.WS || '18122';
const MAP = process.env.MAP || 'wake';
const TEAM = Number(process.env.TEAM || 2);
const WATCH_S = Number(process.env.WATCH_S || 240);
const OUT = process.argv[2] || 'spawnselect.json';
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--use-angle=vulkan', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const res = { steps: {}, watch: [], log: [] };
  const save = () => fs.writeFileSync(OUT, JSON.stringify(res, null, 1));
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    page.on('console', (m) => { const t = m.text(); if (/error|deploy:/i.test(t)) res.log.push(t.slice(0, 300)); });
    // Every action row the page sends the sidecar, timed: a spawn row is the
    // page asking for a spawn group.
    await page.addInitScript(() => {
      const sent = window.__sentRows = [];
      const t0 = performance.now();
      const send = WebSocket.prototype.send;
      WebSocket.prototype.send = function (data) {
        // `netcode-client.js` `action`: MSG_ACTION, then the row's JSON.
        if (data instanceof Uint8Array && data.length > 2 && data[1] === 0x7b) {
          try {
            const r = JSON.parse(new TextDecoder().decode(data.subarray(1)));
            sent.push({ t: Math.round(performance.now() - t0), type: r.type, group: r.spawnGroup ?? null });
          } catch { /* not a row */ }
        }
        return send.call(this, data);
      };
    });
    const rows = () => page.evaluate(() => window.__sentRows.filter((r) => r.type === 'spawn' || r.type === 'suicide'));
    await page.goto(`http://127.0.0.1:${PORT}/map.html?mod=bf1942&map=${MAP}&shots=1&sidecar=ws%3A%2F%2F127.0.0.1%3A${WS}&team=${TEAM}`);
    const ev = (fn, arg) => page.evaluate(fn, arg);
    const snap = () => ev(() => {
      const d = window.__deploy;
      const s = window.__soldier?.();
      return { open: d.open, unchosen: d.unchosen, choice: d.choice, committed: d.committed, team: d.team,
        offered: d.offered.map((i) => d.flags[i]?.name), hud: window.__respawnHud?.(),
        alive: !!(s && window.__net?.().self?.alive), at: s ? [s.x, s.y, s.z].map((v) => Math.round(v * 10) / 10) : null };
    });
    // The level, the briefing and the server's table. Nothing that could
    // commit the screen is pressed once it is up (Enter is the commit).
    for (let i = 0; i < 300; i++) {
      const ok = await ev(() => !!(window.__net?.().connected && window.__deploy?.open && window.__deploy.served
        && window.__deploy.offered.length)).catch(() => false);
      if (ok) break;
      const briefing = await ev(() => !!document.querySelector('[data-state="briefing"]')).catch(() => false);
      if (briefing && i % 3 === 2) await page.mouse.click(631, 527).catch(() => {});
      await delay(1000);
    }
    await delay(1500);
    res.steps.opened = await snap();
    if (!res.steps.opened.open) throw new Error('the deploy screen never opened');
    if (res.steps.opened.team !== TEAM) await ev((t) => window.__deploy.setTeam(t), TEAM);

    // 1. No click: the commit spawns nobody and asks for nothing.
    res.steps.commitUnchosen = { returned: await ev(() => window.__deploy.spawn()) };
    await delay(8000);
    Object.assign(res.steps.commitUnchosen, await snap(), { rows: await rows() });
    save();

    // 2. Reopen, click a ring with the mouse, DONE.
    await page.keyboard.press('CapsLock');
    await delay(800);
    res.steps.reopened = await snap();
    const flag = await ev(([want, team]) => {
      const d = window.__deploy;
      const offered = d.offered.map((i) => d.flags[i]);
      return (want && offered.find((f) => f.name === want)?.name)
        ?? offered.find((f) => f.team === team && f.spawns > 0 && !f.inactive)?.name ?? offered[0]?.name;
    }, [process.env.FLAG || null, TEAM]);
    const ring = await ev((name) => window.__deploy.ringAt(name), flag);
    res.steps.ring = { flag, ring };
    if (!ring) throw new Error(`no ring drawn for ${flag}`);
    await page.mouse.click(ring.x, ring.y);
    await delay(400);
    res.steps.clicked = await snap();
    await page.click('#deploy-resume');
    let alive = false;
    for (let k = 0; k < 120 && !alive; k++) { await delay(500); alive = (await snap()).alive; }
    res.steps.spawned = { alive, ...(await snap()),
      spots: await ev((name) => window.__deploy.flags.find((f) => f.name === name)?.spots, flag) };
    save();
    if (!alive) throw new Error('no spawn after the click');
    await delay(3000);

    // 3. Suicide and touch nothing.
    await page.keyboard.press('CapsLock');
    await delay(800);
    await page.click('#deploy-suicide');
    let died = false;
    for (let k = 0; k < 40 && !died; k++) { await delay(250); died = !(await snap()).alive; }
    res.steps.died = { died, ...(await snap()) };
    const t0 = Date.now();
    let back = false;
    const during = [];
    for (let k = 0; k < 160 && !back; k++) {
      await delay(500);
      const s = await snap();
      if (k % 2 === 0) during.push({ t: Math.round((Date.now() - t0) / 100) / 10, open: s.open, hud: s.hud?.SpawnText ?? null, timer: s.hud?.Timer ?? null });
      back = s.alive;
    }
    res.steps.respawned = { back, seconds: (Date.now() - t0) / 1000, during, ...(await snap()), rows: await rows(),
      spots: await ev((name) => window.__deploy.flags.find((f) => f.name === name)?.spots, flag) };
    save();

    // 4. The offer against the server's table, as bots take flags.
    const tw = Date.now();
    while ((Date.now() - tw) / 1000 < WATCH_S) {
      const row = await ev((team) => {
        const d = window.__deploy;
        const served = d.served ?? [];
        const offered = d.offered.map((i) => d.flags[i]?.name).sort();
        const expect = served.filter((f) => f.groups.some((g) => g.team === team && g.active)).map((f) => f.name).sort();
        // A flag whose groups the table names none of falls back to the
        // page's own team.
        const unknown = served.filter((f) => !f.groups.some((g) => g.active != null)).map((f) => f.name);
        return { team: d.team, offered, expect, unknown,
          land: served.filter((f) => !f.groups.some((g) => g.group >= 64))
            .map((f) => [f.name, f.team, f.groups.map((g) => `${g.group}:${g.team}${g.active ? '+' : '-'}`).join(' ')]) };
      }, TEAM);
      row.t = Math.round((Date.now() - tw) / 1000);
      row.match = JSON.stringify(row.offered) === JSON.stringify(row.expect.concat(row.unknown).sort());
      res.watch.push(row);
      save();
      await delay(5000);
    }
  } catch (e) {
    res.error = String(e && e.stack || e);
  } finally {
    save();
    await browser.close();
  }
})();
