// The pairing playtest's browser player (features/udp-sidecar/pairing-playtest.md): a headless
// map.html on a sidecar that the session steers one command at a time while the owner watches
// from the retail client. Append one JSON command per line to $PILOT_DIR/cmds.ndjson; each result
// (and the player's state after it) is appended to $PILOT_DIR/out.log.
//   env: PILOT_DIR (default /tmp/bfstats-pilot), VIEWER (http://localhost:5292), SIDECAR_WS
//        (ws://127.0.0.1:17970), MAP (el_alamein)
// Kinds (each may carry `after`, ms to wait before reporting):
//  {k:'deploy', team, flag, kit}  {k:'keys', down:['KeyW'], ms} (held keys: W A S D, ControlLeft crouch,
//  Space jump)  {k:'tap', key:'z'} (keydown keys: z prone, r reload)  {k:'look', dx, dy} (one frame:
//  spread a large look over several, or it snaps)  {k:'fire', ms}  {k:'e'} (use)  {k:'chat', text, team}
//  (keep it short: typed a character a rendered frame)  {k:'shot', name}  {k:'eval', js} (async ok)
//  {k:'face', x, z}  {k:'quit'}
const { chromium } = require(require('path').resolve(__dirname, '../../../ui/node_modules/playwright'));
const fs = require('fs');
const SP = process.env.PILOT_DIR || '/tmp/bfstats-pilot';
fs.mkdirSync(SP, { recursive: true });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const T0 = Date.now();
const out = (...a) => fs.appendFileSync(SP + '/out.log', ((Date.now() - T0) / 1000).toFixed(1) + ' ' + a.join(' ') + '\n');
(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', e => out('PAGEERROR', String(e).slice(0, 300)));
  page.on('dialog', d => { out('DIALOG', d.type(), d.message().slice(0, 200)); d.dismiss().catch(() => {}); });
  page.setDefaultTimeout(20000);
  await page.goto(`${process.env.VIEWER || 'http://localhost:5292'}/map.html?mod=bf1942&map=${process.env.MAP || 'el_alamein'}&mode=CoOp&shots=1&sidecar=${encodeURIComponent(process.env.SIDECAR_WS || 'ws://127.0.0.1:17970')}&team=2`);
  for (let i = 0; i < 150; i++) { if (await page.evaluate(() => !!(window.__net?.().connected && window.__deploy?.flags?.length))) break; await sleep(2000); }
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => /ready/i.test(x.textContent)); b?.click(); }); await page.mouse.click(631, 527); await sleep(1000); await page.evaluate(() => { const s = window.__soldier?.(); });
  out('ready', JSON.stringify(await page.evaluate(() => window.__deploy.flags.map(f => [f.name, f.team, f.spawns]))));
  const state = () => page.evaluate(() => { const s = window.__soldier(), n = window.__net(); return { pos: s && [+s.x.toFixed(1), +s.y.toFixed(1), +s.z.toFixed(1)], yaw: s && +(s.yaw * 180 / Math.PI).toFixed(0), pitch: s && +(s.pitch * 180 / Math.PI).toFixed(1), stance: s?.stance, alive: !!n.self?.alive, hp: n.self?.hp, seat: window.__seat?.(), corr: n.corrections, err: n.correction?.error, remotes: n.remoteNames }; });
  let done = 0;
  for (;;) {
    let lines = [];
    try { lines = fs.readFileSync(SP + '/cmds.ndjson', 'utf8').split('\n').filter(Boolean); } catch {}
    for (; done < lines.length; done++) {
      let c; try { c = JSON.parse(lines[done]); } catch { out('bad cmd', lines[done]); continue; }
      try {
        const watchdog = setTimeout(() => out('SLOW', c.k), 15000);
        if (c.k === 'deploy') {
          await page.evaluate(([team, flag, kit]) => { window.__deploy.setTeam(team); const f = window.__deploy.flags; let i = flag ? f.findIndex(x => x.name === flag) : -1; if (i < 0) i = f.findIndex(x => x.team === team && x.spawns > 0); window.__deploy.select(i); window.__deploy.setKit(kit || 'assault'); window.__deploy.spawn(); }, [c.team ?? 2, c.flag ?? null, c.kit ?? null]);
          for (let i = 0; i < 40; i++) { await sleep(500); if (await page.evaluate(() => window.__soldier() && window.__net().self?.alive)) break; }
        } else if (c.k === 'keys') {
          await page.evaluate((ks) => ks.forEach(k => window.__keys.add(k)), c.down); await sleep(c.ms ?? 1000); await page.evaluate((ks) => ks.forEach(k => window.__keys.delete(k)), c.down);
        } else if (c.k === 'tap') {
          await page.keyboard.press(c.key);
        } else if (c.k === 'look') {
          await page.evaluate(([dx, dy]) => window.__lookDelta(dx, dy), [c.dx ?? 0, c.dy ?? 0]);
        } else if (c.k === 'face') {
          for (let i = 0; i < 20; i++) { const d = await page.evaluate(([x, z]) => { const s = window.__soldier(); let e = Math.atan2(x - s.x, z - s.z) - s.yaw; e = Math.atan2(Math.sin(e), Math.cos(e)); return e; }, [c.x, c.z]); if (Math.abs(d) < 0.01) break; await page.evaluate((px) => window.__lookDelta(px, 0), d / -0.00212); await sleep(120); }
        } else if (c.k === 'fire') {
          await page.evaluate(() => window.__setTrigger(true)); await sleep(c.ms ?? 600); await page.evaluate(() => window.__setTrigger(false));
        } else if (c.k === 'e') {
          await page.evaluate(() => window.__seatToggle());
        } else if (c.k === 'chat') {
          await page.keyboard.press(c.team ? 'KeyL' : 'KeyK'); await sleep(200); await page.keyboard.type(c.text, { delay: 30 }); await page.keyboard.press('Enter');
        } else if (c.k === 'eval') {
          out('eval', JSON.stringify(await page.evaluate(c.js)).slice(0, 1500));
        } else if (c.k === 'shot') {
          await page.screenshot({ path: SP + '/' + (c.name || 'shot') + '.png' });
        } else if (c.k === 'quit') { await browser.close(); process.exit(0); }
        clearTimeout(watchdog);
        await sleep(c.after ?? 300);
        out(c.k, JSON.stringify(c), '=>', JSON.stringify(await state()));
      } catch (e) { out('ERR', c.k, String(e).slice(0, 300)); }
    }
    await sleep(250);
  }
})().catch(e => { out('FAIL', String(e)); process.exit(1); });
