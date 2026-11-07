// Dogfight: the dogfight school's scene (features/dogfight-school, "The
// briefing"). A Spitfire sits on a Bf109's tail. The 109 jinks, sliding up or
// down off the Spitfire's line; the Spitfire follows a beat behind. A burst
// fired while the 109 is still moving goes where it was, behind its tail. A
// burst fired once it has steadied, aimed a little ahead of its nose (the
// lead), lands: sparks on the fuselage. Three hits and it trails smoke; six
// and it rolls over and goes down, and a kill mark is painted on the row
// under the Spitfire. Eight marks and the row is painted over and starts again.
//
// Sprites (scripts/render-loader-sprites.sh, "the dogfight"): vanilla's
// Spitfire and BF109, gear and propellers left out (the props are drawn as
// discs here), side-on from a little behind.

import { tracer, puff } from './kit.js';

// --- the sprites and their marks (CSS px in the sprite) --------------------------
const SPIT = { w: 131, h: 46.5, prop: [122.3, 27.6], guns: [[74.1, 37.1], [93.7, 24.3]], tail: [4.4, 13.1] };
const BF = { w: 103.5, h: 31, prop: [98.6, 15.1], centre: [58.5, 15.5], tail: [10.8, 10.8] };
/** Where each sits on the stage when on its line. */
const SPIT_AT = { left: 20, top: 58 };
const BF_AT = { left: 236, top: 44 };

/** The 109's weave: the offsets, px up (-) or down, its jinks move it between. */
export const JINK = [-13, 0, 12];
/** How far the Spitfire follows a jink (it cuts the corner), and how late. */
export const FOLLOW = 0.6;
const JINK_MS = 760;
/** Hits that start the smoke, and hits that bring it down. */
export const SMOKING = 3;
export const DOWN = 6;
/** Kill marks on the row before it is painted over. */
export const TALLY = 8;
/** Pixels the aim leads ahead of the 109's middle. */
export const LEAD = 22;

/** Where the `i`th kill mark sits: a row low on the stage, under the Spitfire. */
export function markSlot(i) {
  return { x: 22 + i * 21, y: 128 };
}

/**
 * Where a round aimed at the 109 when it sat at offset `aimedAt` crosses the
 * 109, when it now sits at `now`: the miss in pixels (0 is through its
 * middle). A burst fired while it jinks is aimed at where it was.
 */
export function missBy(aimedAt, now) {
  return Math.abs(aimedAt - now);
}
/** A round lands when it crosses within this of the 109's middle line. */
export const HIT_BAND = 6;

/** Each plane's box on the stage at a jink offset, and the tally's, for the tests. */
export function boxes(bfY = 0) {
  const spitY = bfY * FOLLOW;
  return {
    spit: { left: SPIT_AT.left, top: SPIT_AT.top + spitY, right: SPIT_AT.left + SPIT.w, bottom: SPIT_AT.top + spitY + SPIT.h },
    bf: { left: BF_AT.left, top: BF_AT.top + bfY, right: BF_AT.left + BF.w, bottom: BF_AT.top + bfY + BF.h },
    marks: Array.from({ length: TALLY }, (_, i) => markSlot(i)),
  };
}

const css = `
.df-cloud { top: 0; left: 0; border-radius: 50%; pointer-events: none;
  background: radial-gradient(ellipse at 50% 55%, rgba(226, 222, 204, .2), rgba(226, 222, 204, .07) 45%, transparent 70%);
  animation: df-cloud linear infinite; }
@keyframes df-cloud { from { transform: translateX(420px); } to { transform: translateX(-220px); } }
.df-haze { left: -40px; right: -40px; top: 104px; height: 70px;
  background: radial-gradient(ellipse 50% 45% at 50% 70%, rgba(163, 156, 108, .13), transparent 75%); }
.df-air { inset: 0; animation: df-sway 5.2s ease-in-out infinite alternate; transform-origin: 50% 55%; }
@keyframes df-sway { from { transform: translateY(-4px) rotate(-1deg); } to { transform: translateY(5px) rotate(1.2deg); } }
.df-air > * { position: absolute; }
.df-spw { left: ${SPIT_AT.left}px; top: ${SPIT_AT.top}px; width: ${SPIT.w}px; height: ${SPIT.h}px;
  transition: transform 1s cubic-bezier(.45, 0, .3, 1) .22s; }
.df-bfw { left: ${BF_AT.left}px; top: ${BF_AT.top}px; width: ${BF.w}px; height: ${BF.h}px;
  transition: transform ${JINK_MS}ms cubic-bezier(.45, 0, .3, 1), opacity .6s ease; }
.df-spw > *, .df-bfw > * { position: absolute; }
.df-plane { left: 0; top: 0; width: 100%; height: 100%; }
.df-spw.kick .df-plane { animation: df-kick 90ms ease-out; }
@keyframes df-kick { 0% { transform: translateX(-1px); filter: brightness(1.15); } 100% { transform: none; filter: none; } }
.df-prop { border-radius: 50%;
  background: radial-gradient(ellipse, rgba(232, 228, 210, .42), rgba(232, 228, 210, .12) 55%, transparent 72%);
  animation: df-prop 80ms steps(2, end) infinite; }
@keyframes df-prop { 0% { opacity: .55; transform: scaleY(1); } 100% { opacity: .9; transform: scaleY(.93); } }
.df-flash { width: 8px; height: 8px; margin: -4px 0 0 -4px; border-radius: 50%; opacity: 0;
  background: radial-gradient(circle, #fff6d8, #ffd77a 40%, rgba(255, 170, 60, 0) 72%); }
.df-flash.on { animation: df-flash 80ms steps(2, end); }
@keyframes df-flash { 0% { opacity: 1; transform: scale(1.3); } 100% { opacity: .2; transform: scale(.8); } }
.df-spark { width: 5px; height: 5px; margin: -2.5px 0 0 -2.5px; border-radius: 50%;
  background: radial-gradient(circle, #fffbe8, #ffd77a 45%, rgba(255, 140, 40, 0) 75%); }
.df-mark { width: 17px; height: 5.1px; opacity: .78;
  filter: brightness(0) invert(.86) sepia(.35); transition: opacity .5s ease, transform .5s ease; }
.df-mark.new { filter: brightness(0) invert(.95) sepia(.5) drop-shadow(0 0 3px rgba(255, 210, 110, .9)); }
.df-mark.gone { opacity: 0; transform: translateY(5px); }
`;

export default {
  id: 'dogfight',
  title: 'Dogfight',
  words: 'Loading',
  sub: 'The server is taking its time. The Spitfire stays on their tail.',
  tactic: 'Hold fire while the target jinks; fire when it steadies, leading its nose.',
  css,
  mount(stage, kit) {
    // Clouds go by at three speeds: the pair is moving, not hanging.
    [[46, 34, 96, 7.5, -1.5], [92, 18, 64, 11, -6], [20, 54, 140, 16, -11]].forEach(([top, h, w, s, at]) => {
      const c = kit.div('df-cloud', { top, width: w, height: h });
      c.style.animationDuration = `${s}s`;
      c.style.animationDelay = `${at}s`;
      stage.append(c);
    });
    stage.append(kit.div('df-haze'));
    const air = kit.div('df-air');
    stage.append(air);

    const plane = (cls, art, spec) => {
      const wrap = kit.div(cls);
      const img = document.createElement('img');
      img.className = 'df-plane';
      img.src = kit.sprite(art);
      img.alt = '';
      img.decoding = 'async';
      const ph = spec.h * 0.72;
      const prop = kit.div('df-prop', { left: spec.prop[0] - 2.5, top: spec.prop[1] - ph / 2, width: 5, height: ph });
      wrap.append(img, prop);
      air.append(wrap);
      return wrap;
    };
    const spit = plane('df-spw', 'dogfight-spitfire.webp', SPIT);
    const bf = plane('df-bfw', 'dogfight-bf109.webp', BF);
    const flashes = SPIT.guns.map(([x, y]) => {
      const f = kit.div('df-flash', { left: x, top: y });
      spit.append(f);
      return f;
    });

    const marks = [];
    let bfY = 0, spitY = 0, hits = 0, smoking = false, down = false, moving = false;

    const gunAt = i => ({ x: SPIT_AT.left + SPIT.guns[i][0], y: SPIT_AT.top + SPIT.guns[i][1] + spitY });
    const bfMiddle = y => ({ x: BF_AT.left + BF.centre[0], y: BF_AT.top + BF.centre[1] + y });

    function mark(fresh) {
      const slot = markSlot(marks.length);
      const m = document.createElement('img');
      m.className = `df-mark${fresh ? ' new' : ''}`;
      m.src = kit.sprite('dogfight-bf109.webp');
      m.alt = '';
      kit.place(m, { left: slot.x - 8.5, top: slot.y - 2.5 });
      stage.append(m);
      marks.push(m);
      if (fresh) kit.after(900, () => m.classList.remove('new'));
    }

    function spark() {
      const s = kit.div('df-spark', { left: BF.centre[0] + (Math.random() - 0.3) * 30, top: BF.centre[1] + (Math.random() - 0.5) * 8 });
      bf.append(s);
      kit.fly(s, [{ transform: 'scale(1.4)', opacity: 1 }, { transform: 'scale(.4)', opacity: 0 }], { duration: 220, easing: 'ease-out' });
    }

    /** The smoke off a hit 109, a puff every so often from its tail. */
    async function smoke() {
      while (smoking && kit.running) {
        const p = { x: BF_AT.left + BF.tail[0] + 4, y: BF_AT.top + BF.tail[1] + bfY + 2 };
        puff(air, p, { dx: -34 - Math.random() * 10, dy: -3 - Math.random() * 4, size: 7, grow: 2.6, ms: 1100,
          colour: hits >= DOWN - 1 ? 'rgba(40, 38, 32, .55)' : 'rgba(150, 146, 132, .42)' });
        await kit.wait(150);
      }
    }

    /** It jinks: up or down off the line. The Spitfire follows, late. */
    async function jink() {
      const choices = JINK.filter(y => y !== bfY);
      bfY = choices[Math.floor(Math.random() * choices.length)];
      moving = true;
      bf.style.transform = `translateY(${bfY}px)`;
      spitY = bfY * FOLLOW;
      spit.style.transform = `translateY(${spitY}px)`;
      // A snap burst while it moves: aimed where it was, it goes behind it.
      if (Math.random() < 0.35) { await kit.wait(120); await burst(2, true); }
      await kit.wait(JINK_MS + 80);
      moving = false;
    }

    /** One burst: both gun groups, `n` rounds. A round lands only when the
     *  109 has not moved off the line it was aimed along (`missBy`). */
    async function burst(n, snap = false) {
      const aimedAt = snap ? (bfY === 0 ? JINK[0] : 0) : bfY;
      for (let r = 0; r < n && !down; r++) {
        kit.restart(spit, 'kick');
        flashes.forEach(f => kit.restart(f, 'on'));
        const aim = bfMiddle(aimedAt);
        for (const i of [0, 1]) {
          const a = gunAt(i);
          const b = { x: aim.x + LEAD + (Math.random() - 0.5) * 6, y: aim.y + (Math.random() - 0.5) * 5 };
          // On past the 109 and off the stage.
          const k = 420 / Math.max(1, b.x - a.x);
          tracer(air, a, { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k }, { ms: 260, length: 26 });
        }
        if (!snap && !moving && missBy(aimedAt, bfY) <= HIT_BAND && Math.random() < 0.55) {
          kit.after(70, () => { if (!down) spark(); });
          hits++;
          if (hits >= SMOKING && !smoking) { smoking = true; smoke(); }
          if (hits >= DOWN) { kit.after(160, shootDown); return; }
        }
        await kit.wait(95);
      }
    }

    /** Six hits: it rolls over and goes down, trailing black smoke; its
     *  mark is painted on the row, and the next one comes in. */
    async function shootDown() {
      if (down) return;
      down = true;
      const fall = bf.animate([
        { transform: `translateY(${bfY}px) rotate(0deg)` },
        { transform: `translate(30px, ${bfY + 30}px) rotate(14deg)`, offset: 0.35 },
        { transform: `translate(70px, ${bfY + 110}px) rotate(34deg)`, opacity: 0 },
      ], { duration: 1700, easing: 'cubic-bezier(.4, 0, .9, .6)', fill: 'forwards' });
      await kit.wait(1700);
      smoking = false;
      mark(true);
      await kit.wait(700);
      fall.cancel();
      hits = 0;
      bfY = 0;
      spitY = 0;
      spit.style.transform = 'translateY(0)';
      // The next one slides in from ahead, faded up.
      bf.style.transition = 'none';
      bf.style.transform = 'translate(70px, -6px)';
      bf.style.opacity = '0';
      void bf.getBoundingClientRect();
      bf.style.transition = '';
      bf.style.transform = 'translateY(0)';
      bf.style.opacity = '1';
      await kit.wait(1000);
      down = false;
    }

    /** A full row is painted over, last mark first, and starts again. */
    async function paintOver() {
      marks.slice().reverse().forEach((m, i) => kit.after(i * 60, () => m.classList.add('gone')));
      const gone = marks.splice(0);
      await kit.wait(gone.length * 60 + 600);
      gone.forEach(m => m.remove());
    }

    return {
      get count() { return marks.length; },
      get hits() { return hits; },
      /** Where the fight stands, for the gallery and the tests. */
      get state() { return { bfY, spitY, hits, smoking, down, moving }; },
      async play() {
        await kit.wait(300);
        for (;;) {
          if (marks.length >= TALLY) await paintOver();
          if (down) { await kit.wait(200); continue; }
          if (Math.random() < 0.5) await jink();
          if (!down) await burst(3 + Math.floor(Math.random() * 3));
          await kit.wait(380 + Math.random() * 380);
        }
      },
      still() { while (marks.length < 3) mark(false); },
    };
  },
};
