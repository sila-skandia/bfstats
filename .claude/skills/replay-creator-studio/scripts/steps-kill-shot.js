// An example steps file for studio-probe.cjs: Bocage's 5:06 kill shot
// (SoldierHEad's MG 42 on Smokeya) opened in the studio; camera 1 set by its
// icon and given an end camera, its part looped with the camera measured
// against both views every frame; a hand-over looped; Clear and Ctrl+Z; the
// clip recorded.
//
//   node studio-probe.cjs --steps steps-kill-shot.js --out kill-shot.json
//
// Copy it and change the steps; keep the habits in it:
// - pause before pressing Play: Play is a play/pause toggle;
// - do not click the view to focus it: a click follows whoever is under it;
// - drive the strip with the mouse at the elements' rects, as a creator would;
// - measure in the page (distances, clock speed, which camera films, the
//   part looping), and look at the screenshots and the recorded file's
//   frames (ffmpeg) as well.

const pause = async (page, sleep) => {
  await page.evaluate(() => { window.replay.playing = false; window.replay.creator.rangePlaying = false; });
  await sleep(250);
};

const rect = (page, sel, i = 0) => page.evaluate(([sel, i]) => {
  const n = document.querySelectorAll(sel)[i];
  if (!n) return null;
  const r = n.getBoundingClientRect();
  return { cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
}, [sel, i]);

// The clip's cameras, the icons on their blocks, what loops and the band's words.
const state = page => page.evaluate(() => {
  const c = window.replay.creator;
  return {
    cams: c.camList().map(k => ({ cam: k.cam, at: k.at ?? null, into: k.into ?? null, end: Boolean(k.end), move: k.move ?? null })),
    icons: [...document.querySelectorAll('.rc-cb-camera .rc-cb-camicon')].map(n => n.className.replace('rc-cb-camicon ', '')),
    part: c.part ? { t0: +c.part.t0.toFixed(3), t1: +c.part.t1.toFixed(3), label: c.part.label, live: c.part.live } : null,
    placing: c.placing ? { i: c.placing.i, which: c.placing.which } : null,
    playing: window.replay.playing,
    band: document.querySelector('.rc-cb-part')?.hidden === false ? document.querySelector('.rc-cb-partpill').textContent : null,
  };
});

// The free camera flown while placing: moved and turned.
const fly = async (page, sleep, dx, dy, yaw) => {
  await page.evaluate(([dx, dy, yaw]) => {
    const cam = window.replay.camera;
    cam.free.pos.x += dx; cam.free.pos.y += dy; cam.free.yaw += yaw; cam.free.pitch = -0.35;
  }, [dx, dy, yaw]);
  await sleep(300);
};

// Every frame for `ms`: the clock, the camera filming, the round cam's state,
// and the distance to camera 1's view (dA) and its end camera (dB).
const watch = (page, ms) => page.evaluate(ms => new Promise(resolve => {
  const r = window.replay;
  const c = r.creator;
  const out = [];
  const t0 = performance.now();
  const first = c.camList()[0];
  const d = (p, q) => (q ? Math.round(Math.hypot(p.x - q[0], p.y - q[1], p.z - q[2]) * 100) / 100 : null);
  const tick = () => {
    const cam = r.ctx.camera;
    out.push({ t: +r.time.toFixed(4), speed: +r.speed.toFixed(3), cam: c.track?.active?.cam ?? null, round: c.rounds.state,
      dA: d(cam.position, first?.view?.pos), dB: d(cam.position, first?.end?.pos), part: Boolean(c.part) });
    if (performance.now() - t0 > ms) resolve(out);
    else requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}), ms);

module.exports = [
  ['open', async (page, sleep) => {
    await page.evaluate(() => {
      const r = window.replay;
      const c = r.creator;
      // Start clean: kept slow motion and cameras from storage would change the clip.
      c.ramp.in = null; c.ramp.out = null; c.ramp.speed = 1; c.cams = null;
      const kill = r.rec.kills.find(k => k.kind === 'kill' && k.killer === 21 && k.t > 300 && k.t < 312);
      r.seek(kill.t - 6);
      c.killShotAt(kill.t, kill.victim);
      c.studio.show();
    });
    await sleep(4500);
    await pause(page, sleep);
    return state(page);
  }, 0, true],
  ['setCamera', async (page, sleep) => {
    // Camera 1's icon: the clip pauses, the free camera starts on its view.
    const ic = await rect(page, '.rc-cb-camera .rc-cb-camicon', 0);
    await page.mouse.click(ic.cx, ic.cy);
    await sleep(700);
    const during = await state(page);
    await fly(page, sleep, -12, 9, 0.5);
    await page.click('.rc-place-use');
    await sleep(500);
    return { during, after: await state(page) };
  }, 0, false],
  ['endCamera', async (page, sleep) => {
    await pause(page, sleep);
    const icons = await page.evaluate(() => [...document.querySelectorAll('.rc-cb-camera .rc-cb-camicon')].map(n => n.className));
    const ic = await rect(page, '.rc-cb-camera .rc-cb-camicon', icons.findIndex(c => / end/.test(c)));
    await page.mouse.click(ic.cx, ic.cy);
    await sleep(700);
    await fly(page, sleep, 18, -4, -0.8);
    await page.keyboard.press('Enter');
    await sleep(400);
    // The part loops: dA grows from 0 as dB falls to 0 by the shot.
    const frames = await watch(page, 7000);
    return { state: await state(page), frames: frames.filter((f, k) => k % 8 === 0) };
  }, 0, true],
  ['loopHandOver', async (page, sleep) => {
    const ho = await rect(page, '.rc-cb-camera .rc-cb-ho', 0);
    await page.mouse.click(ho.cx, ho.cy);
    await sleep(400);
    const items = await page.evaluate(() => [...document.querySelectorAll('.rc-cb-pop .rc-cb-item')].map(n => n.textContent));
    const r = await rect(page, '.rc-cb-pop .rc-cb-item', items.findIndex(t => /Loop it/.test(t)));
    await page.mouse.click(r.cx, r.cy);
    await sleep(300);
    const frames = await watch(page, 9000);
    return { items, state: await state(page), loops: frames.filter((f, k) => k > 0 && f.t < frames[k - 1].t - 0.2).length };
  }, 0, false],
  ['wholeClip', async (page, sleep) => {
    const b = await rect(page, '.rc-cb-partall');
    await page.mouse.click(b.cx, b.cy);
    await sleep(600);
    return state(page);
  }, 0, false],
  ['clearAndUndo', async (page, sleep) => {
    await pause(page, sleep);
    await page.click('.st-top .st-menuwrap .st-btn');
    await sleep(300);
    const items = await page.evaluate(() => [...document.querySelectorAll('.st-menuitem b')].map(n => n.textContent));
    const r = await rect(page, '.st-menuitem', 0);
    await page.mouse.click(r.cx, r.cy);
    await sleep(600);
    await pause(page, sleep);
    const cleared = await state(page);
    await page.keyboard.down('Control');
    await page.keyboard.press('KeyZ');
    await page.keyboard.up('Control');
    await sleep(400);
    return { items, cleared, undone: await state(page) };
  }, 0, false],
  ['record', async (page, sleep) => {
    await pause(page, sleep);
    await page.click('.st-top .st-rec-btn');
    const done = await page.evaluate(() => new Promise(resolve => {
      const t0 = performance.now();
      const tick = () => {
        if (!window.replay.creator.recorder || performance.now() - t0 > 90000) resolve({ ms: Math.round(performance.now() - t0) });
        else setTimeout(tick, 250);
      };
      setTimeout(tick, 1000);
    }));
    await sleep(2500);
    return done;
  }, 0, false],
];
