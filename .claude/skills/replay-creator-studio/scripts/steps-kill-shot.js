// An example steps file for studio-probe.cjs: Bocage's 5:06 kill shot
// (SoldierHEad's MG 42 on Smokeya) opened in the studio, a lead-in keyframe
// and a lead-out keyframe set to cut, played through with the camera measured
// against each part every frame, then recorded.
//
//   node studio-probe.cjs --steps steps-kill-shot.js --out kill-shot.json
//
// Copy it and change the steps; keep the habits in it:
// - pause before pressing Play: Play is a play/pause toggle;
// - do not click the view to focus it: a click follows whoever is under it;
// - measure in the page (distances, clock speed, overlayState), and look at
//   the screenshots and the recorded file's frames (ffmpeg) as well.

const killShot = async (page, sleep) => {
  await page.evaluate(() => {
    const r = window.replay;
    const c = r.creator;
    // Start clean: kept slow motion and keyframes from storage would change the take.
    c.ramp.in = null; c.ramp.out = null; c.ramp.speed = 1;
    c.keys = [];
    const kill = r.rec.kills.find(k => k.kind === 'kill' && k.killer === 21 && k.t > 300 && k.t < 312);
    r.seek(kill.t - 6);
    r.follow(21);
    c.killShotAt(kill.t, kill.victim);
  });
  await sleep(800);
};

const state = page => page.evaluate(() => {
  const c = window.replay.creator;
  return {
    studio: c.studio.open, frame: c.prefs.frame, edits: c.edits,
    lane: [...c.clipbar.el.querySelectorAll('.rc-cb-camera .rc-cb-seg')].map(n => n.textContent.trim()),
    keys: c.keys.map(k => ({ t: k.t, move: k.move ?? null })),
    guard: window.replay.guard?.report?.() ?? null,
  };
});

module.exports = [
  ['open', async (page, sleep) => {
    await killShot(page, sleep);
    await page.click('.rc-cb-studio');
    await sleep(1500);
    return state(page);
  }, 0, true],
  ['keyframes', async (page, sleep) => {
    const at = await page.evaluate(() => ({ shot: window.replay.creator.fxKill.shot, kill: window.replay.creator.fxKill.kill }));
    await page.evaluate(t => { window.replay.playing = false; window.replay.seek(t - 1.2); }, at.shot);
    await sleep(300);
    await page.evaluate(() => [...document.querySelectorAll('.st-cams .st-segbtn')].find(b => /Free fly/.test(b.textContent)).click());
    await page.evaluate(() => { const cam = window.replay.camera; cam.free.pos.y += 12; cam.free.pos.x -= 15; cam.free.pitch = -0.5; });
    await sleep(300);
    await page.keyboard.press('KeyK');
    await page.evaluate(t => { window.replay.seek(t + 1.6); const cam = window.replay.camera; cam.free.pos.y += 25; cam.free.pitch = -0.9; }, at.kill);
    await sleep(300);
    await page.keyboard.press('KeyK');
    await page.evaluate(() => window.replay.creator.setHandover('out', 'cut'));
    await sleep(500);
    return state(page);
  }, 0, true],
  ['play', async (page, sleep) => {
    await page.evaluate(() => { window.replay.playing = false; window.replay.creator.rangePlaying = false; });
    await sleep(200);
    await page.click('.st-play');
    // Each frame: the clock, the round cam's state, and how far the camera
    // is from each keyframe and from the chase's own placement.
    return page.evaluate(() => new Promise(resolve => {
      const r = window.replay;
      const c = r.creator;
      const [k1, k2] = c.keys;
      const cam = r.ctx.camera;
      const d = (p, q) => Math.round(Math.hypot(p.x - q[0], p.y - q[1], p.z - q[2]) * 100) / 100;
      const frames = [];
      const t0 = performance.now();
      let last = r.time;
      const tick = () => {
        const t = r.time;
        frames.push({ t: Math.round(t * 1000) / 1000, speed: r.speed, round: c.rounds.state,
          k1: d(cam.position, k1.pos), k2: d(cam.position, k2.pos), chase: d(cam.position, c.rounds.camPos.toArray()) });
        if ((t < last - 1 && frames.length > 20) || performance.now() - t0 > 45000) {
          resolve({ shot: c.fxKill.shot, k1: k1.t, k2: k2.t, frames });
          return;
        }
        last = t;
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }));
  }, 0, false],
  ['record', async (page, sleep) => {
    await page.evaluate(() => { window.replay.playing = false; });
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
