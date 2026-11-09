// More text, placed effects, two slow stretches and the montage, driven
// with the mouse as a creator would (features/replay-creator-view, "More of
// everything").
const pause = async (page, sleep) => {
  await page.evaluate(() => { window.replay.playing = false; window.replay.creator.rangePlaying = false; });
  await sleep(250);
};
const rectOf = (page, sel, i = 0) => page.evaluate(([sel, i]) => {
  const n = document.querySelectorAll(sel)[i];
  if (!n) return null;
  const r = n.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
}, [sel, i]);
// Where on the strip a share of the clip is (0 its start, 1 its end), on a lane.
const laneAt = async (page, lane, share) => {
  const strip = await rectOf(page, '.rc-cb-strip');
  const l = await rectOf(page, `.rc-cb-${lane}`);
  const x = await page.evaluate(share => {
    const c = window.replay.creator;
    const b = c.clipbar;
    const s = c.span;
    const t = s.t0 + (s.t1 - s.t0) * share;
    return { t, pct: parseFloat(b.pct(t)) };
  }, share);
  return { x: strip.x + (strip.w * x.pct) / 100, y: l.cy, t: x.t };
};
const drag = async (page, from, to, steps = 12) => {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) await page.mouse.move(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps);
  await page.mouse.up();
};
const state = page => page.evaluate(() => {
  const c = window.replay.creator;
  const r = window.replay;
  const text = n => n.textContent.replace(/\s+/g, ' ').trim();
  return {
    t: +r.time.toFixed(3), playing: r.playing,
    title: c.edits.title, lower: c.edits.lower, texts: c.edits.texts, fx: c.edits.fx,
    ramp: { in: c.ramp.in, out: c.ramp.out, speed: c.ramp.speed, more: c.ramp.more ?? [] },
    textBars: [...document.querySelectorAll('.rc-cb-text .rc-cb-seg.txt')].map(n => ({ key: n.dataset.key, label: text(n), left: n.style.left, width: n.style.width })),
    fxMarks: [...document.querySelectorAll('.rc-cb-fx .rc-cb-fxm')].map(n => ({ cls: n.className, k: n.dataset.k ?? null, label: text(n), left: n.style.left })),
    slowBars: [...document.querySelectorAll('.rc-cb-speed .rc-cb-seg.slow')].map(n => ({ cls: n.className, label: text(n), left: n.style.left, width: n.style.width })),
    length: +(c.timing()?.clock.length ?? 0).toFixed(2),
    clips: c.clips.map(k => ({ name: k.name, thumb: k.thumb ? k.thumb.slice(0, 22) : null, in: +k.in.toFixed(2), out: +k.out.toFixed(2) })),
    montage: c.montage ? { i: c.montage.i, n: c.montage.list.length } : null,
    tab: c.studio.tab, moreRows: document.querySelectorAll('.st-more .st-group').length, cards: document.querySelectorAll('.st-card').length,
    placedRows: document.querySelectorAll('.st-list .st-item').length, montageBar: document.querySelector('.st-montagebar')?.hidden === false ? text(document.querySelector('.st-montagebar')) : null,
    focused: document.activeElement?.tagName === 'INPUT' ? (document.activeElement.placeholder || document.activeElement.value) : null,
    pop: document.querySelector('.rc-cb-pop')?.hidden === false ? text(document.querySelector('.rc-cb-pop')) : null,
  };
});
const chipDrop = async (page, sleep, id, lane, share) => {
  const chip = await rectOf(page, `.st-chip[data-tray="${id}"]`);
  const to = await laneAt(page, lane, share);
  await drag(page, { x: chip.cx, y: chip.cy }, to, 16);
  await sleep(500);
  return to;
};

module.exports = [
  ['open', async (page, sleep) => {
    await page.evaluate(() => {
      const r = window.replay;
      const c = r.creator;
      c.ramp.in = null; c.ramp.out = null; c.ramp.speed = 1; delete c.ramp.more; c.cams = null;
      c.clips = []; c.saveKept();
      const ms = c.moments();
      const good = ms.filter(m => m.from !== 'vehicle' && (m.distance ?? 0) >= 30 && (m.distance ?? 0) <= 200);
      const kill = [...(good.length ? good : ms)].sort((a, b) => b.score - a.score || a.t - b.t)[0];
      r.seek(kill.t - 6);
      c.killShotAt(kill.t, kill.victim);
      c.studio.show();
      c.setEdits({ texts: [], fx: [], title: { ...c.edits.title, on: false }, lower: { ...c.edits.lower, on: false }, flash: false, punch: false, shake: false, freeze: 0 });
    });
    await sleep(4500);
    await pause(page, sleep);
    return state(page);
  }, 0, true],
  ['tray', async (page, sleep) => page.evaluate(() => {
    const t = document.querySelector('.st-tray');
    const chips = [...t.querySelectorAll('.st-chip')].map(c => ({ id: c.dataset.tray, right: Math.round(c.getBoundingClientRect().right) }));
    return { client: t.clientWidth, scroll: t.scrollWidth, more: t.className, chips, win: innerWidth };
  }), 0, true],
  ['twoTitles', async (page, sleep) => {
    // Title from the tray, dropped at 20% of the clip; its words typed. Again at 55%.
    await chipDrop(page, sleep, 'title', 'text', 0.2);
    const s1 = await state(page);
    await page.keyboard.type('ONE');
    await page.keyboard.press('Enter');
    await sleep(300);
    await chipDrop(page, sleep, 'title', 'text', 0.55);
    const s2 = await state(page);
    await page.keyboard.type('TWO');
    await page.keyboard.press('Enter');
    await sleep(300);
    const s3 = await state(page);
    return { focused1: s1.focused, focused2: s2.focused, title: s3.title, texts: s3.texts, bars: s3.textBars, moreRows: s3.moreRows, tab: s3.tab };
  }, 0, true],
  ['lowerTwice', async (page, sleep) => {
    await chipDrop(page, sleep, 'lower', 'text', 0.1);
    await page.keyboard.press('Escape');
    await chipDrop(page, sleep, 'lower', 'text', 0.8);
    await page.keyboard.press('Escape');
    await sleep(300);
    const s = await state(page);
    return { lower: s.lower, texts: s.texts, bars: s.textBars, moreRows: s.moreRows };
  }, 0, true],
  ['dragSecondTitle', async (page, sleep) => {
    // The second title's bar dragged right by 80 px: it moves; the playhead does not.
    await pause(page, sleep);
    const before = await state(page);
    const bar = await rectOf(page, '.rc-cb-text .rc-cb-seg.txt[data-key="texts.0"]');
    await drag(page, { x: bar.cx, y: bar.cy }, { x: bar.cx + 80, y: bar.cy });
    await sleep(400);
    const after = await state(page);
    return { tBefore: before.t, tAfter: after.t, before: before.texts[0], after: after.texts[0], bars: after.textBars };
  }, 0, true],
  ['placedFx', async (page, sleep) => {
    // Hit effects dropped at 15% (clear of the kill): three marks there. Freeze at 85%: a placed freeze; the video grows a second.
    const before = await state(page);
    const a = await chipDrop(page, sleep, 'hitfx', 'fx', 0.15);
    const b = await chipDrop(page, sleep, 'freeze', 'fx', 0.85);
    const after = await state(page);
    return { lengthBefore: before.length, lengthAfter: after.length, fx: after.fx, marks: after.fxMarks, placedRows: after.placedRows, killT: await page.evaluate(() => window.replay.creator.fxKill.kill), dropA: a.t, dropB: b.t,
      killFlags: [after.title && null, await page.evaluate(() => { const e = window.replay.creator.edits; return [e.flash, e.punch, e.shake, e.freeze]; })] };
  }, 0, true],
  ['dragFreeze', async (page, sleep) => {
    await pause(page, sleep);
    const before = await state(page);
    const mark = await rectOf(page, '.rc-cb-fx .rc-cb-fxm.mark.freeze');
    await drag(page, { x: mark.cx, y: mark.cy }, { x: mark.cx - 60, y: mark.cy });
    await sleep(400);
    const after = await state(page);
    const k = before.fx.findIndex(f => f.kind === 'freeze');
    return { tBefore: before.t, tAfter: after.t, before: before.fx[k], after: after.fx[k], marks: after.fxMarks };
  }, 0, true],
  ['fxMenu', async (page, sleep) => {
    const at = await laneAt(page, 'fx', 0.5);
    await page.mouse.click(at.x, at.y, { button: 'right' });
    await sleep(400);
    const s = await state(page);
    await page.keyboard.press('Escape');
    await sleep(200);
    return { pop: s.pop };
  }, 0, true],
  ['hitChipClick', async (page, sleep) => {
    // Clicked, not dragged, Hit effects go on the kill.
    const chip = await rectOf(page, '.st-chip[data-tray="hitfx"]');
    await page.mouse.click(chip.cx, chip.cy);
    await sleep(400);
    const flags = await page.evaluate(() => { const e = window.replay.creator.edits; return [e.flash, e.punch, e.shake, e.fx.length]; });
    return { flags };
  }, 0, false],
  ['undo', async (page, sleep) => {
    const before = await state(page);
    await page.keyboard.press('Control+z');
    await sleep(300);
    const mid = await state(page);
    await page.keyboard.press('Control+z');
    await sleep(300);
    const after = await state(page);
    return { fxBefore: before.fx.length, flagsMid: await page.evaluate(() => { const e = window.replay.creator.edits; return [e.flash, e.punch, e.shake]; }), fxAfter: after.fx.length, marksAfter: after.fxMarks.length };
  }, 0, false],

  ['rail', async (page, sleep) => {
    // The gold rail dragged 150 px right: the clip slides with the hand; slow motion round the kill stays on it.
    await pause(page, sleep);
    const before = await page.evaluate(() => { const c = window.replay.creator; return { t0: c.span.t0, t1: c.span.t1, ramp: { in: c.ramp.in, out: c.ramp.out }, take: c.take?.f?.t ?? null }; });
    const grip = await rectOf(page, '.rc-cb-grip');
    const secondsPer150 = await page.evaluate(() => { const b = window.replay.creator.clipbar; const r = b.strip.getBoundingClientRect(); return b.timeAt(r.left + 150) - b.timeAt(r.left); });
    await drag(page, { x: grip.x + 40, y: grip.cy }, { x: grip.x + 190, y: grip.cy });
    await sleep(600);
    const after = await page.evaluate(() => { const c = window.replay.creator; return { t0: c.span.t0, t1: c.span.t1, ramp: { in: c.ramp.in, out: c.ramp.out }, take: c.take?.f?.t ?? null }; });
    return { before, after, slid: +(after.t0 - before.t0).toFixed(3), wanted: +secondsPer150.toFixed(3) };
  }, 0, true],
  ['iconPlacing', async (page, sleep) => {
    const ic = await rectOf(page, '.rc-cb-camera .rc-cb-camicon', 0);
    await page.mouse.click(ic.cx, ic.cy);
    await sleep(600);
    const placing = await page.evaluate(() => window.replay.creator.placing ? { i: window.replay.creator.placing.i, which: window.replay.creator.placing.which } : null);
    await page.keyboard.press('Escape');
    await sleep(400);
    return { placing, after: await page.evaluate(() => Boolean(window.replay.creator.placing)) };
  }, 0, true],
  ['autoBarDrag', async (page, sleep) => {
    // The kill shot's own bullet-time bar dragged 60 px: it becomes the clip's own slow motion, moved.
    await pause(page, sleep);
    const before = await page.evaluate(() => { const c = window.replay.creator; const a = c.autoSlow(c.span); return { auto: a ? { t0: a.t0, t1: a.t1 } : null, ramp: { in: c.ramp.in, out: c.ramp.out } }; });
    const bar = await rectOf(page, '.rc-cb-speed .rc-cb-seg.slow.auto');
    if (!bar) return { before, noBar: true };
    await drag(page, { x: bar.cx, y: bar.cy }, { x: bar.cx + 60, y: bar.cy });
    await sleep(600);
    const after = await page.evaluate(() => { const c = window.replay.creator; return { ramp: { in: c.ramp.in, out: c.ramp.out, speed: c.ramp.speed }, bars: [...document.querySelectorAll('.rc-cb-speed .rc-cb-seg.slow')].map(n => n.className) }; });
    await page.evaluate(() => window.replay.creator.clearSlow());
    await sleep(300);
    return { before, after };
  }, 0, true],
  ['markDrag', async (page, sleep) => {
    // A drag from the Shot mark scrubs; a click on the Kill mark goes to the kill.
    await pause(page, sleep);
    const t0 = await page.evaluate(() => window.replay.time);
    const shot = await rectOf(page, '.rc-cb-mk.shot');
    await drag(page, { x: shot.cx, y: shot.cy }, { x: shot.cx + 120, y: shot.cy });
    await sleep(400);
    const t1 = await page.evaluate(() => window.replay.time);
    const pop1 = await page.evaluate(() => document.querySelector('.rc-cb-pop')?.hidden === false);
    const kill = await rectOf(page, '.rc-cb-mk.kill');
    await page.mouse.click(kill.cx, kill.cy);
    await sleep(400);
    const t2 = await page.evaluate(() => ({ t: window.replay.time, hit: window.replay.creator.fxKill.kill }));
    return { t0: +t0.toFixed(3), afterDrag: +t1.toFixed(3), popAfterDrag: pop1, afterKillClick: t2 };
  }, 0, true],
  ['textClick', async (page, sleep) => {
    await page.evaluate(() => window.replay.creator.studio.setTab('look'));
    const bar = await rectOf(page, '.rc-cb-text .rc-cb-seg.txt[data-key="texts.0"]');
    await page.mouse.click(bar.cx, bar.cy);
    await sleep(400);
    const s = await state(page);
    await page.keyboard.press('Escape');
    return { tab: s.tab, focused: s.focused };
  }, 0, false],
  ['chooserPauses', async (page, sleep) => {
    await page.evaluate(() => { window.replay.playing = true; });
    await sleep(500);
    const cam = await rectOf(page, '.rc-cb-camera .rc-cb-cam', 1);
    await page.mouse.click(cam.x + cam.w * 0.6, cam.cy);
    await sleep(400);
    const s = await state(page);
    await page.keyboard.press('Escape');
    await sleep(200);
    return { playing: s.playing, pop: s.pop ? s.pop.slice(0, 80) : null };
  }, 0, true],
  ['trimWhileLoop', async (page, sleep) => {
    await page.evaluate(() => window.replay.creator.loopPart({ kind: 'cam', i: 1 }));
    await sleep(800);
    const partBefore = await page.evaluate(() => window.replay.creator.part?.label ?? null);
    const h = await rectOf(page, '.rc-cb-h.rc-cb-out');
    await drag(page, { x: h.cx, y: h.cy }, { x: h.cx + 50, y: h.cy });
    await sleep(800);
    const s = await page.evaluate(() => { const c = window.replay.creator; return { part: c.part?.label ?? null, playing: window.replay.playing, t: +window.replay.time.toFixed(2), t1: +c.span.t1.toFixed(2) }; });
    return { partBefore, ...s };
  }, 0, true],
  ['slowClick', async (page, sleep) => {
    // After twoSlows below runs this is moot; here, clicking the main slow bar opens its menu (set by the next step). Placeholder.
    return {};
  }, 0, false],
  ['twoSlows', async (page, sleep) => {
    // Painted across the Speed lane from 5% to 12%, then from 70% to 80%.
    await pause(page, sleep);
    const a0 = await laneAt(page, 'speed', 0.05);
    const a1 = await laneAt(page, 'speed', 0.12);
    await drag(page, a0, a1);
    await sleep(600);
    const s1 = await state(page);
    const b0 = await laneAt(page, 'speed', 0.7);
    const b1 = await laneAt(page, 'speed', 0.8);
    await drag(page, b0, b1);
    await sleep(600);
    const s2 = await state(page);
    await page.evaluate(() => window.replay.creator.studio.setTab('fx'));
    await sleep(300);
    const s3 = await state(page);
    return { first: s1.ramp, second: s2.ramp, bars: s2.slowBars, length: s2.length, fxTabRows: s3.placedRows };
  }, 0, true],
  ['slowBarClick', async (page, sleep) => {
    await pause(page, sleep);
    const bar = await rectOf(page, '.rc-cb-speed .rc-cb-seg.slow', 0);
    await page.mouse.click(bar.cx, bar.cy);
    await sleep(400);
    const s = await state(page);
    await page.keyboard.press('Escape');
    await sleep(200);
    return { pop: s.pop ? s.pop.slice(0, 120) : null, t: s.t };
  }, 0, true],
  ['keepTwo', async (page, sleep) => {
    await page.evaluate(() => {
      const c = window.replay.creator;
      c.saveClip();
    });
    await sleep(600);
    await page.evaluate(() => {
      const c = window.replay.creator;
      const s = c.span;
      c.setEnd('out', s.t0 + 3);
      c.setEdits({ texts: [], fx: [] });
      c.saveClip();
    });
    await sleep(600);
    await page.evaluate(() => window.replay.creator.studio.setTab('montage'));
    await sleep(400);
    return state(page);
  }, 0, true],
  ['reorder', async (page, sleep) => {
    // The second card dragged onto the first: it goes first.
    await page.dragAndDrop('.st-card[data-i="1"]', '.st-card[data-i="0"]');
    await sleep(400);
    const s = await state(page);
    return { clips: s.clips, cards: s.cards };
  }, 0, true],
  ['playMontage', async (page, sleep) => {
    await pause(page, sleep);
    const btn = await page.evaluateHandle(() => [...document.querySelectorAll('.st-btn')].find(b => b.textContent.trim() === 'Play the montage'));
    await btn.click();
    await sleep(1500);
    const s1 = await state(page);
    const trail = [];
    for (let i = 0; i < 40; i++) {
      await sleep(1000);
      const s = await state(page);
      trail.push({ i: s.montage?.i ?? null, t: s.t, playing: s.playing, bar: s.montageBar });
      if (!s.montage && i > 3) break;
    }
    return { start: { montage: s1.montage, bar: s1.montageBar, t: s1.t, playing: s1.playing }, trail };
  }, 0, true],
];
