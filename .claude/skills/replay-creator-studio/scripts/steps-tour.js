// The studio's tour walked as a creator would, for studio-probe.cjs: the
// studio opened fresh (the tour offered), Take the tour, and each step done
// with the mouse on what the tour lights -- a kill opened, a camera swapped,
// a hand-over dragged, a camera set by its icon, slow motion dragged from
// the tray, a look, the lower third, a recording -- each step's result the
// tour's own state, so a step that did not move on shows in the report.
//
// It is also the script of the tutorial videos: with `--video` the probe
// captures the page, and a drawn pointer shows where each click lands
// (a headless page draws none of its own). make-tour-videos.sh runs it.
//
//   node studio-probe.cjs --steps steps-tour.js --out tour.json [--video dir]

let last = { x: 800, y: 450 };
const LINGER = 2600;

const pause = async (page, sleep) => {
  await page.evaluate(() => { window.replay.playing = false; window.replay.creator.rangePlaying = false; });
  await sleep(250);
};

// The pointer drawn over the page, and a ring where it presses: it follows
// the mouse the probe moves, and draws nothing a recording of the clip sees.
const drawPointer = page => page.evaluate(() => {
  if (document.getElementById('tour-pointer')) return;
  const p = document.createElement('div');
  p.id = 'tour-pointer';
  p.innerHTML = '<svg viewBox="0 0 24 24" width="26" height="26"><path d="M4 2l15 11-7 1.2L8.6 21z" fill="#fff" stroke="#111" stroke-width="1.6" stroke-linejoin="round"/></svg>';
  Object.assign(p.style, { position: 'fixed', left: '0', top: '0', zIndex: 2147483647, pointerEvents: 'none', transform: 'translate(-100px,-100px)',
    filter: 'drop-shadow(0 2px 3px rgba(0,0,0,.6))' });
  document.documentElement.append(p);
  const style = document.createElement('style');
  style.textContent = '.tour-press{position:fixed;width:34px;height:34px;margin:-17px 0 0 -17px;border:3px solid #e8c35a;border-radius:50%;'
    + 'pointer-events:none;z-index:2147483646;animation:tour-press .5s ease-out forwards}'
    + '@keyframes tour-press{from{transform:scale(.3);opacity:1}to{transform:scale(1.4);opacity:0}}';
  document.head.append(style);
  addEventListener('pointermove', e => { p.style.transform = `translate(${e.clientX - 4}px,${e.clientY - 2}px)`; }, true);
  addEventListener('pointerdown', e => {
    const r = document.createElement('i');
    r.className = 'tour-press';
    r.style.left = `${e.clientX}px`;
    r.style.top = `${e.clientY}px`;
    document.documentElement.append(r);
    setTimeout(() => r.remove(), 600);
  }, true);
});

// A move takes `ms` or so: each step waits on a frame of a heavy page, so
// few steps (a step every ~90 ms), or a drag crawls across the video.
const glide = async (page, x, y, ms = 650) => {
  const steps = Math.max(5, Math.round(ms / 90));
  await page.mouse.move(x, y, { steps });
  last = { x, y };
};

const click = async (page, sleep, at) => {
  if (!at) throw new Error('nothing to click');
  await glide(page, at.cx, at.cy);
  await sleep(180);
  await page.mouse.down();
  await sleep(90);
  await page.mouse.up();
};

const drag = async (page, sleep, from, to, ms = 1100) => {
  await glide(page, from.cx, from.cy);
  await sleep(200);
  await page.mouse.down();
  await sleep(120);
  await glide(page, to.cx, to.cy, ms);
  await sleep(200);
  await page.mouse.up();
};

// The centre of the first match of `sel` (with `text` in it, if given).
const rect = (page, sel, text = null) => page.evaluate(([sel, text]) => {
  const n = [...document.querySelectorAll(sel)].find(m => !m.closest('[hidden]') && (!text || m.textContent.includes(text)));
  if (!n) return null;
  n.scrollIntoView?.({ block: 'nearest' });
  const r = n.getBoundingClientRect();
  return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, w: r.width, h: r.height };
}, [sel, text]);

// What the ring is on now.
const lit = page => page.evaluate(() => {
  const r = document.querySelector('.stt-ring');
  if (!r || r.hidden) return null;
  const b = r.getBoundingClientRect();
  return { cx: b.left + b.width / 2, cy: b.top + b.height / 2, w: b.width, h: b.height };
});

const tour = page => page.evaluate(() => {
  const t = window.replay.creator.studio.tour;
  const card = document.querySelector('.stt-card');
  return {
    step: card?.dataset.step ?? null, state: card?.dataset.state ?? null, running: Boolean(t?.running),
    words: card?.querySelector('.stt-words')?.textContent ?? null,
    kill: t?.ctx?.kill ? { t: t.ctx.kill.t, killer: t.ctx.kill.killerName, victim: t.ctx.kill.victimName, distance: t.ctx.kill.distance } : null,
  };
});

// Until the tour's card is on step `id` (it moves on by itself), or `ms`.
const until = (page, id, ms = 6000) => page.waitForFunction(id => document.querySelector('.stt-card')?.dataset.step === id, id, { timeout: ms, polling: 100 })
  .then(() => true, () => false);

const next = async (page, sleep) => click(page, sleep, await rect(page, '.stt-card .stt-btn', 'Next') ?? await rect(page, '.stt-card .stt-btn', 'Finish'));

// One step: what is done, then whether the tour went on to `then` by itself.
const step = (fn, then, { linger = LINGER, auto = true } = {}) => async (page, sleep) => {
  const before = await tour(page);
  const out = await fn(page, sleep);
  const moved = auto ? await until(page, then, 9000) : null;
  await sleep(linger);
  return { before, out: out ?? null, movedOn: moved, after: await tour(page) };
};

module.exports = [
  ['open', async (page, sleep) => {
    await drawPointer(page);
    await page.mouse.move(last.x, last.y);
    await page.evaluate(() => {
      try { localStorage.removeItem('bf42.replay.studioTour'); } catch {}
      const r = window.replay;
      const c = r.creator;
      c.ramp.in = null; c.ramp.out = null; c.ramp.speed = 1; c.cams = null;
      if (!c.on) c.toggle(true);
      r.seek(Math.min(r.rec.duration - 20, 290));
      c.studio.show();
    });
    await sleep(LINGER);
    return tour(page);
  }, 0, true],
  ['offer', step(async (page, sleep) => {
    await click(page, sleep, await rect(page, '.stt-card .stt-btn', 'Take the tour'));
  }, 'kill', { linger: 1800 }), 0, false],
  ['kill', step(async (page, sleep) => {
    await sleep(800);
    await click(page, sleep, await lit(page));
    await sleep(600);
    return page.evaluate(() => window.replay.creator.camList().map(c => c.cam));
  }, 'cameras', { linger: 4500 }), 0, true],
  ['cameras', step(async (page, sleep) => {
    await glide(page, (await lit(page)).cx, (await lit(page)).cy, 900);
    await sleep(3500);
    await next(page, sleep);
  }, 'swap', { linger: 800 }), 0, false],
  ['swap', step(async (page, sleep) => {
    await click(page, sleep, await rect(page, '.rc-cb-cam[data-i="1"]'));
    await sleep(1200);
    await click(page, sleep, await rect(page, '.rc-cb-pop .rc-cb-card', 'From the victim'));
    await sleep(300);
    return page.evaluate(() => window.replay.creator.camList().map(c => c.cam));
  }, 'handover', { linger: 4500 }), 0, true],
  ['handover', step(async (page, sleep) => {
    const cut = await rect(page, '.rc-cb-cut[data-i="1"]');
    await drag(page, sleep, cut, { cx: cut.cx + 55, cy: cut.cy });
    await sleep(300);
    return page.evaluate(() => ({ at: window.replay.creator.camList()[1]?.at ?? null, part: window.replay.creator.part?.label ?? null }));
  }, 'place', { linger: 4500 }), 0, true],
  ['place', step(async (page, sleep) => {
    await click(page, sleep, await rect(page, '.rc-cb-cam[data-i="0"] .rc-cb-camicon.start'));
    await sleep(1500);
    const placing = await tour(page);
    // Flown with the keys, as the card says: a little up, back and aside,
    // the shooter still in the frame.
    for (const [key, ms] of [['KeyE', 180], ['KeyS', 220], ['KeyD', 160]]) {
      await page.keyboard.down(key);
      await sleep(ms);
      await page.keyboard.up(key);
      await sleep(250);
    }
    await sleep(800);
    await click(page, sleep, await rect(page, '.rc-place-use'));
    await sleep(300);
    return { placing, cam0: await page.evaluate(() => window.replay.creator.camList()[0]?.cam) };
  }, 'slow', { linger: 4500 }), 0, true],
  ['slow', step(async (page, sleep) => {
    const chip = await rect(page, '.st-chip[data-tray="slow"]');
    const to = await page.evaluate(() => {
      const c = window.replay.creator;
      const bar = c.clipbar;
      const t = Math.max(c.span.t0, (c.fxKill.shot ?? c.fxKill.kill) - 0.25);
      const s = bar.strip.getBoundingClientRect();
      const lane = bar.lanes.speed.getBoundingClientRect();
      return { cx: s.left + s.width * bar.at(t) + 6, cy: lane.top + lane.height / 2, t };
    });
    await drag(page, sleep, chip, to, 1400);
    await sleep(300);
    return { to, ramp: await page.evaluate(() => ({ ...window.replay.creator.ramp })) };
  }, 'look', { linger: 4000 }), 0, true],
  ['look', step(async (page, sleep) => {
    await sleep(600);
    await click(page, sleep, await rect(page, '.st-recipe[data-recipe="frag"]'));
    await sleep(300);
    return page.evaluate(() => window.replay.creator.edits.grade);
  }, 'text', { linger: 4000 }), 0, true],
  ['text', step(async (page, sleep) => {
    const l = await lit(page);
    if (l) await glide(page, l.cx, l.cy, 900);
    await sleep(3500);
    await next(page, sleep);
  }, 'record', { linger: 800 }), 0, false],
  ['record', step(async (page, sleep) => {
    await pause(page, sleep);
    await sleep(600);
    await click(page, sleep, await rect(page, '[data-tour="record"]'));
    const started = await page.waitForFunction(() => Boolean(window.replay.creator.recorder), null, { timeout: 8000, polling: 100 }).then(() => true, () => false);
    // Out of the way of the picture while it records.
    await glide(page, 4, 4, 300);
    const done = await page.evaluate(() => new Promise(resolve => {
      const t0 = performance.now();
      const tick = () => {
        if (!window.replay.creator.recorder || performance.now() - t0 > 120000) resolve(Math.round(performance.now() - t0));
        else setTimeout(tick, 250);
      };
      setTimeout(tick, 1000);
    }));
    return { started, ms: done };
  }, 'end', { linger: 4500 }), 0, true],
  ['end', step(async (page, sleep) => {
    await sleep(1500);
    await next(page, sleep);
    await sleep(500);
  }, null, { linger: 1500, auto: false }), 0, true],
];
