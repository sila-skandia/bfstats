// The clip editor (features/replay-creator-view, "The clip editor"): while a
// clip is being worked on, the round's timeline gives way to a strip of the
// clip alone and a few seconds either side of it. The clip is the recording
// for as long as it is open -- its ends drag with room to grow, the shot and
// the kill it is of are marked, the slow stretch and the camera keys sit on
// it, and the playhead loops inside it. Back to the round puts the playhead,
// the man followed and the camera back where they were.
//
// The round's timeline is percentages of a round that runs minutes; a clip of
// six seconds is a sliver of it, and a take that loops right at the kill with
// nothing either side reads as cut short. Here it is the whole width.

import { fmt } from './replay-creator-panel.js';
import { nameAt } from './replay-recording.js';
import { rampSpanOf, ramping } from './replay-shot.js';
import { isMelee } from './replay-shotstyle.js';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Seconds of the round shown either side of the clip: some of its length,
 *  never so little the ends cannot be dragged out, never so much the clip is
 *  a sliver again. */
export const CONTEXT_MIN = 3;
export const CONTEXT_MAX = 10;

/** The stretch of the round the strip spans: `{ w0, w1 }`. */
export function clipWindow(t0, t1, duration) {
  const pad = clamp((t1 - t0) * 0.6, CONTEXT_MIN, CONTEXT_MAX);
  return { w0: Math.max(0, t0 - pad), w1: Math.min(duration, t1 + pad) };
}

/** Seconds between the strip's ticks, for a window this long. */
export function tickStep(span) {
  return span <= 6 ? 0.5 : span <= 14 ? 1 : span <= 30 ? 2 : 5;
}

/** Whether the playhead crossed the out point playing forward this frame:
 *  the loop's cue. A playhead put past it by hand has not crossed it. */
export function crossedOut(prev, t, out) {
  return prev !== null && prev < out && t >= out && t - prev < 1;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export class ClipBar {
  constructor(creator) {
    this.creator = creator;
    this.window = null;
    this.sig = '';
    injectStyle();
    const bar = el('div', 'rc-cb');
    bar.hidden = true;
    const head = el('div', 'rc-cb-head');
    this.title = el('span', 'rc-cb-title', 'Clip');
    this.clock = el('span', 'rc-cb-clock');
    this.where = el('span', 'rc-cb-where');
    this.loopBtn = this.button('Loop', 'Round again at the out point', () => creator.toggleLoop());
    this.fromIn = this.button('From the start', 'Play the clip from its in point (P)', () => creator.playRange(), 'rc-cb-from');
    const back = this.button('Back to the round', 'Close the clip and go back to where you were (Esc)', () => creator.closeEditor(), 'rc-cb-back');
    head.append(this.title, this.clock, this.where, el('span', 'rc-cb-gap'), this.fromIn, this.loopBtn, back);

    const strip = el('div', 'rc-cb-strip');
    this.ctxL = el('div', 'rc-cb-ctx');
    this.ctxR = el('div', 'rc-cb-ctx');
    this.band = el('div', 'rc-cb-band');
    this.slow = el('div', 'rc-cb-slow');
    this.action = el('div', 'rc-cb-action');
    this.inH = el('i', 'rc-cb-h rc-cb-in');
    this.outH = el('i', 'rc-cb-h rc-cb-out');
    this.inH.title = 'Drag the clip\'s start';
    this.outH.title = 'Drag the clip\'s end';
    this.ticks = el('div', 'rc-cb-ticks');
    this.marks = el('div', 'rc-cb-marks');
    this.knob = el('div', 'rc-cb-knob');
    strip.append(this.ticks, this.ctxL, this.ctxR, this.band, this.slow, this.action, this.marks, this.inH, this.outH, this.knob);
    this.strip = strip;
    bar.append(head, strip);
    this.el = bar;
    this.bindScrub();
    this.bindHandle(this.inH, 'in');
    this.bindHandle(this.outH, 'out');
  }

  button(label, title, fn, className = '') {
    const b = el('button', `rp-btn rc-cb-btn ${className}`.trim(), label);
    b.type = 'button';
    b.title = title;
    b.addEventListener('click', e => {
      e.stopPropagation();
      try { fn(); } catch (error) { console.warn('creator: the clip editor', error); }
    });
    return b;
  }

  get open() {
    return !this.el.hidden;
  }

  /** Open on the clip as it stands, the strip fitted round it. */
  show() {
    const span = this.creator.span;
    if (!span) return false;
    this.fit(span);
    this.el.hidden = false;
    this.sig = '';
    this.sync(this.creator.player.time, true);
    return true;
  }

  hide() {
    this.el.hidden = true;
  }

  /** The strip's span round the clip's ends. */
  fit(span = this.creator.span) {
    if (span) this.window = clipWindow(span.t0, span.t1, this.creator.player.rec.duration);
  }

  pct(t) {
    const { w0, w1 } = this.window;
    return `${clamp(((t - w0) / Math.max(1e-6, w1 - w0)) * 100, 0, 100)}%`;
  }

  timeAt(clientX) {
    const r = this.strip.getBoundingClientRect();
    const { w0, w1 } = this.window;
    return clamp(w0 + ((clientX - r.left) / Math.max(1, r.width)) * (w1 - w0), w0, w1);
  }

  // --- the pointer -------------------------------------------------------------------------

  /** A press on the strip scrubs, through the round timeline's own scrub, so
   *  the replay pauses its clock and lands the seek in the frame as it does
   *  for the round's bar. */
  bindScrub() {
    const timeline = this.creator.ui.timeline;
    const move = e => {
      timeline.scrubTo = this.timeAt(e.clientX);
    };
    const up = e => {
      this.strip.removeEventListener('pointermove', move);
      this.strip.removeEventListener('pointerup', up);
      this.strip.removeEventListener('pointercancel', up);
      timeline.scrubbing = false;
      timeline.scrubTo = this.timeAt(e.clientX);
      this.strip.classList.remove('scrubbing');
    };
    this.strip.addEventListener('pointerdown', e => {
      if (e.button !== 0 || e.target.closest('.rc-cb-h, .rc-cb-mk')) return;
      e.preventDefault();
      this.creator.ui.activity?.();
      timeline.scrubbing = true;
      timeline.scrubTo = this.timeAt(e.clientX);
      this.strip.classList.add('scrubbing');
      try { this.strip.setPointerCapture(e.pointerId); } catch {}
      this.strip.addEventListener('pointermove', move);
      this.strip.addEventListener('pointerup', up);
      this.strip.addEventListener('pointercancel', up);
    });
  }

  /** An end dragged. The strip does not re-fit under the pointer; on the
   *  drop it re-fits, so an end dragged to the strip's edge has room to go
   *  further the next time, and the take starts again from the start. */
  bindHandle(handle, which) {
    const creator = this.creator;
    handle.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();
      const gap = 0.3;
      const move = ev => {
        const t = this.timeAt(ev.clientX);
        if (which === 'in') creator.range.in = Math.min(t, creator.range.out - gap);
        else creator.range.out = Math.max(t, creator.range.in + gap);
        creator.syncRange();
        this.sync(creator.player.time, true);
      };
      const up = ev => {
        move(ev);
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        handle.removeEventListener('pointercancel', up);
        this.fit();
        creator.rangeChanged(`${which === 'in' ? 'In' : 'Out'} ${fmt(creator.range[which])}`);
        creator.replayClip();
        this.sync(creator.player.time, true);
      };
      try { handle.setPointerCapture(e.pointerId); } catch {}
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
      handle.addEventListener('pointercancel', up);
    });
  }

  // --- drawing -----------------------------------------------------------------------------

  /** The playhead every frame; the rest when the clip, its keys or its slow
   *  motion changed (or `force`). */
  sync(t, force = false) {
    if (!this.open || !this.window) return;
    const creator = this.creator;
    const span = creator.span;
    if (!span) return;
    this.knob.style.left = this.pct(t);
    const rel = t - span.t0;
    const clock = `${rel < 0 ? '-' : ''}${fmt(Math.abs(rel))} / ${fmt(span.t1 - span.t0)}`;
    if (this.clock.textContent !== clock) this.clock.textContent = clock;
    const outside = t < span.t0 - 0.05 || t > span.t1 + 0.05;
    this.strip.classList.toggle('outside', outside);
    const where = `round ${fmt(t)}${outside ? ' · outside the clip' : ''}`;
    if (this.where.textContent !== where) this.where.textContent = where;
    const slow = ramping(creator.ramp) ? rampSpanOf(creator.ramp, span) : null;
    const action = creator.clipAction;
    const take = creator.take;
    const sig = [span.t0, span.t1, this.window.w0, this.window.w1, slow?.t0, slow?.t1, action?.t0, action?.t1,
      creator.keys.map(k => k.t).join(','), take?.f?.t, take?.kill?.t, creator.range.loop].join('|');
    if (!force && sig === this.sig) return;
    this.sig = sig;
    this.loopBtn.classList.toggle('on', creator.range.loop);
    const { w0, w1 } = this.window;
    this.ctxL.style.left = '0';
    this.ctxL.style.width = this.pct(span.t0);
    this.ctxR.style.left = this.pct(span.t1);
    this.ctxR.style.right = '0';
    this.band.style.left = this.pct(span.t0);
    this.band.style.width = `${((span.t1 - span.t0) / (w1 - w0)) * 100}%`;
    this.inH.style.left = this.pct(span.t0);
    this.outH.style.left = this.pct(span.t1);
    const place = (node, s) => {
      node.hidden = !s;
      if (!s) return;
      node.style.left = this.pct(s.t0);
      node.style.width = `${((s.t1 - s.t0) / (w1 - w0)) * 100}%`;
    };
    place(this.slow, slow);
    place(this.action, action);
    this.title.textContent = take ? 'Take' : 'Clip';

    // Ticks, labelled from the clip's start.
    this.ticks.textContent = '';
    const step = tickStep(w1 - w0);
    for (let s = Math.ceil((w0 - span.t0) / step) * step; span.t0 + s <= w1 + 1e-6; s += step) {
      const tick = el('i', Math.abs(s % 1) < 1e-6 ? 'major' : '');
      tick.style.left = this.pct(span.t0 + s);
      if (Math.abs(s % 1) < 1e-6) tick.dataset.label = `${s > 0 ? '+' : ''}${Math.round(s)}`;
      this.ticks.append(tick);
    }

    // What happens in it: the take's shot and kill, the other kills in view,
    // the camera keys.
    this.marks.textContent = '';
    const rec = creator.player.rec;
    const mark = (t0, cls, label, title, onClick = null) => {
      const m = el(onClick ? 'button' : 'span', `rc-cb-mk ${cls}`, label);
      if (onClick) {
        m.type = 'button';
        m.addEventListener('click', e => {
          e.stopPropagation();
          onClick();
        });
      }
      m.style.left = this.pct(t0);
      m.title = title;
      this.marks.append(m);
    };
    for (const k of creator.player.kills ?? rec.kills ?? []) {
      if (k.kind !== 'kill' || k.t < w0 || k.t > w1 || k === take?.kill) continue;
      mark(k.t, 'other', '', `${nameAt(rec, k.killer, k.t)} kills ${nameAt(rec, k.victim, k.t)}`, () => creator.player.seek(k.t));
    }
    if (take?.f && take.f.t >= w0 && take.f.t <= w1) {
      mark(take.f.t, 'shot', isMelee(take.f.weapon) ? 'Swing' : 'Shot', `${nameAt(rec, take.f.pid, take.f.t)} fires`, () => creator.player.seek(take.f.t));
    }
    if (take?.kill && take.kill.t >= w0 && take.kill.t <= w1) {
      mark(take.kill.t, 'kill', 'Kill', `${nameAt(rec, take.kill.killer, take.kill.t)} kills ${nameAt(rec, take.kill.victim, take.kill.t)}`,
        () => creator.player.seek(take.kill.t));
    }
    for (const key of creator.keys) {
      if (key.t < w0 || key.t > w1) continue;
      mark(key.t, 'key', '', 'A camera key: go there', () => creator.player.seek(key.t));
    }
  }

  dispose() {
    this.el.remove();
  }
}

function injectStyle() {
  if (document.getElementById('rc-cb-style')) return;
  const style = el('style');
  style.id = 'rc-cb-style';
  style.textContent = STYLE;
  document.head.appendChild(style);
}

const STYLE = `
/* The clip editor: the round's timeline gives way to the clip alone. */
.rp-root.rc-editing .rp-tl { display: none; }
.rc-cb { position: relative; padding: 2px 0 4px; }
.rc-cb[hidden] { display: none; }
.rc-cb-head { display: flex; align-items: center; gap: 10px; min-height: 24px; }
.rc-cb-title { color: var(--rp-gold); font: 800 10px var(--rp-font); letter-spacing: .16em; text-transform: uppercase;
  padding: 2px 7px; border: 1px solid var(--rp-gold); border-radius: 3px; }
.rc-cb-clock { color: var(--rp-ink); font: 600 12px var(--rp-mono); white-space: nowrap; }
.rc-cb-where { color: var(--rp-muted); font: 11px var(--rp-mono); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.rc-cb-gap { flex: 1; }
.rc-cb-btn { height: 22px; padding: 0 8px; font-size: 10px; white-space: nowrap; }
.rc-cb-back { border-color: var(--rp-gold); color: var(--rp-gold); }
.rc-cb-strip { position: relative; height: 40px; margin-top: 3px; border-radius: 4px; background: rgba(0, 0, 0, .32);
  cursor: pointer; touch-action: none; }
.rc-cb-ticks i { position: absolute; bottom: 0; width: 1px; height: 5px; background: rgba(255, 255, 255, .18); pointer-events: none; }
.rc-cb-ticks i.major { height: 9px; background: rgba(255, 255, 255, .32); }
.rc-cb-ticks i[data-label]::after { content: attr(data-label); position: absolute; bottom: 10px; left: 3px;
  color: var(--rp-muted); font: 9px var(--rp-mono); white-space: nowrap; }
.rc-cb-ctx { position: absolute; top: 0; bottom: 0; pointer-events: none;
  background: repeating-linear-gradient(135deg, rgba(0, 0, 0, .35) 0 6px, rgba(0, 0, 0, .15) 6px 12px); }
.rc-cb-band { position: absolute; top: 0; bottom: 0; background: rgba(232, 195, 90, .14); border-top: 2px solid rgba(232, 195, 90, .7);
  pointer-events: none; }
.rc-cb-slow { position: absolute; top: 2px; height: 6px; background: rgba(232, 195, 90, .4); pointer-events: none; }
.rc-cb-action { position: absolute; bottom: 0; height: 3px; background: var(--rp-gold); opacity: .8; pointer-events: none; }
.rc-cb-slow[hidden], .rc-cb-action[hidden] { display: none; }
.rc-cb-h { position: absolute; top: -3px; bottom: -3px; width: 6px; margin-left: -3px; border-radius: 3px; background: var(--rp-gold);
  cursor: ew-resize; touch-action: none; box-shadow: 0 0 0 1px rgba(0, 0, 0, .5); }
.rc-cb-h::after { content: ''; position: absolute; inset: 0 -8px; }
.rc-cb-knob { position: absolute; top: -4px; bottom: -4px; width: 2px; margin-left: -1px; background: #fff; pointer-events: none;
  box-shadow: 0 0 6px rgba(255, 255, 255, .6); }
.rc-cb-strip.outside .rc-cb-knob { background: var(--rp-muted); box-shadow: none; }
.rc-cb-mk { position: absolute; top: 9px; transform: translateX(-50%); padding: 0 4px; border: 0; border-radius: 3px;
  font: 800 9px/14px var(--rp-font); letter-spacing: .08em; text-transform: uppercase; white-space: nowrap; cursor: pointer; }
/* The shot's label ends at its moment and the kill's starts at its: a knife or
   a close shot puts the two on the same pixel. */
.rc-cb-mk.shot { background: rgba(232, 195, 90, .9); color: #17150f; transform: translateX(calc(-100% - 1px)); border-radius: 3px 0 0 3px; }
.rc-cb-mk.kill { background: #d9584b; color: #fff; transform: translateX(1px); border-radius: 0 3px 3px 0; }
.rc-cb-mk.other { top: 14px; width: 2px; height: 12px; padding: 0; background: rgba(217, 88, 75, .55); }
.rc-cb-mk.key { top: 26px; width: 8px; height: 8px; padding: 0; background: rgba(20, 20, 17, .9); border: 1.5px solid var(--rp-gold);
  transform: translateX(-50%) rotate(45deg); }
@container rp-bar (max-width: 610px) { .rc-cb-where, .rc-cb-from { display: none; } }
`;
