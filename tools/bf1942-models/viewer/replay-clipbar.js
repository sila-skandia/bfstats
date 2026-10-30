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
//
// The strip is three lanes, each named in a legend at its left, so what a
// control does is drawn where it does it: EVENTS (the shot, the kill, the
// action between), CAMERA (what films each stretch: the shot style, or the
// move the creator keyed -- holding A, flying A to B, holding B) and SPEED
// (where the clip runs slowly).
//
// The camera move and its slow motion are made here, where they happen (the
// 2026-10-31 simplicity review): one Pin view button rides the playhead on
// the camera lane and pins the move's start or end, whichever the moment is
// for; the move's segment and the speed lane open a small chooser (how it
// moves, how slow, over what, a preview); and a drag of the playhead across
// a pinned move rides it, so the pan is seen by scrubbing.

import { fmt } from './replay-creator-panel.js';
import { nameAt } from './replay-recording.js';
import { RAMP_SPEEDS, keysIn, rampSpanOf, ramping, speedWord } from './replay-shot.js';
import { MOVE_STYLES } from './replay-camtrack.js';
import { isMelee, styleLabel } from './replay-shotstyle.js';

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
    this.inH = el('i', 'rc-cb-h rc-cb-in');
    this.outH = el('i', 'rc-cb-h rc-cb-out');
    this.inH.title = 'The clip starts here: drag to trim';
    this.outH.title = 'The clip ends here: drag to trim';
    this.ticks = el('div', 'rc-cb-ticks');
    this.lanes = {
      events: el('div', 'rc-cb-lane rc-cb-events'),
      camera: el('div', 'rc-cb-lane rc-cb-camera'),
      speed: el('div', 'rc-cb-lane rc-cb-speed'),
    };
    this.knob = el('div', 'rc-cb-knob');
    // Pin view, riding the playhead on the camera lane (K).
    this.pin = el('button', 'rc-cb-pin');
    this.pin.type = 'button';
    this.pin.hidden = true;
    this.pin.addEventListener('pointerdown', e => e.stopPropagation());
    this.pin.addEventListener('click', e => {
      e.stopPropagation();
      try { creator.pinView(); } catch (error) { console.warn('creator: pinning a view', error); }
      this.sync(creator.player.time, true);
    });
    // The chooser a move's segment or the speed lane opens.
    this.pop = el('div', 'rc-cb-pop');
    this.pop.hidden = true;
    this.pop.addEventListener('pointerdown', e => e.stopPropagation());
    this.onOutside = e => {
      if (!this.pop.hidden && !this.pop.contains(e.target) && !e.target.closest?.('.rc-cb-seg.move, .rc-cb-speed .rc-cb-seg')) this.closePop();
    };
    document.addEventListener('pointerdown', this.onOutside, true);
    // A grip on the clip's top edge slides the whole clip, its ends and the
    // views pinned in it, earlier or later.
    this.grip = el('i', 'rc-cb-grip');
    this.grip.title = 'Drag to slide the whole clip earlier or later (its A and B go with it)';
    strip.append(this.ticks, this.ctxL, this.ctxR, this.band, ...Object.values(this.lanes), this.inH, this.outH, this.grip, this.knob, this.pin);
    this.strip = strip;
    // The legend: what each lane is.
    const legend = el('div', 'rc-cb-legend');
    for (const [label, title] of [
      ['', ''],
      ['Events', 'What happens: the shot, the kill, and the action between them (gold line)'],
      ['Camera', 'What films each part of the clip: the shot style, or your own move. Pin view at the playhead pins its start, then its end'],
      ['Speed', 'Where the clip plays in slow motion: click it to change'],
    ]) {
      const l = el('span', '', label);
      l.title = title;
      legend.append(l);
    }
    const body = el('div', 'rc-cb-body');
    body.append(legend, strip);
    bar.append(head, body, this.pop);
    this.el = bar;
    this.bindScrub();
    this.bindHandle(this.inH, 'in');
    this.bindHandle(this.outH, 'out');
    this.bindGrip();
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
    this.closePop();
  }

  // --- the chooser -------------------------------------------------------------------------

  closePop() {
    this.pop.hidden = true;
    this.popKind = null;
  }

  /** Open the chooser for the move (`move`) or the slow motion (`speed`)
   *  over the strip at `x` (a percentage of it). */
  openPop(kind, x) {
    if (!this.pop.hidden && this.popKind === kind) {
      this.closePop();
      return;
    }
    this.popKind = kind;
    this.popX = x;
    this.pop.hidden = false;
    this.fillPop();
  }

  fillPop() {
    const creator = this.creator;
    const pop = this.pop;
    pop.textContent = '';
    const row = (label, items, isOn, pick) => {
      const line = el('div', 'rc-cb-pop-row');
      line.append(el('span', 'rc-cb-pop-label', label));
      for (const [value, text, title] of items) {
        const b = this.button(text, title ?? '', () => {
          pick(value);
          this.fillPop();
        }, isOn(value) ? 'on' : '');
        line.append(b);
      }
      pop.append(line);
    };
    const speeds = RAMP_SPEEDS.map(v => [v, speedWord(v)]);
    const over = creator.slowOver();
    const slowNow = ramping(creator.ramp) ? creator.ramp.speed : 1;
    if (this.popKind === 'move') {
      pop.append(el('b', 'rc-cb-pop-title', 'Camera move, start to end'));
      row('Moves', MOVE_STYLES.map(([id, label, desc]) => [id, label, desc]), v => creator.moveStyle === v, v => creator.setMoveStyle(v));
      row('Speed', speeds, v => (over === 'move' ? slowNow === v : v === 1), v => creator.setSlow(v, 'move'));
      const line = el('div', 'rc-cb-pop-row');
      line.append(
        this.button('Preview', 'Play just the move, once, and stop on its end', () => { this.closePop(); creator.previewMove(); }, 'rc-cb-go'),
        this.button('Clear', 'Forget the start and the end: the shot style films the clip again', () => { this.closePop(); creator.clearKeys(); }),
      );
      pop.append(line, el('p', 'rc-cb-pop-note', 'Or drag the playhead across the move to see the pan at any moment.'));
    } else {
      pop.append(el('b', 'rc-cb-pop-title', 'Slow motion'));
      const a = creator.viewKey('a');
      const b = creator.viewKey('b');
      const choices = [
        creator.clipAction ? ['action', 'The action', 'From the shot to just after the kill'] : null,
        a && b ? ['move', 'The move', 'Between the move\'s start and end'] : null,
        ['clip', 'Whole clip', 'All of the clip'],
      ].filter(Boolean);
      const where = over ?? choices[0][0];
      row('Speed', speeds, v => slowNow === v, v => creator.setSlow(v, where));
      row('Over', choices, v => ramping(creator.ramp) && over === v, v => creator.setSlow(slowNow < 1 ? slowNow : 0.25, v));
    }
    // Over the segment it is about, kept on the strip.
    const r = this.strip.getBoundingClientRect();
    const w = pop.offsetWidth || 300;
    const left = clamp((this.popX / 100) * r.width - w / 2, 0, Math.max(0, r.width - w));
    pop.style.left = `${left + this.strip.offsetLeft}px`;
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
      if (e.button !== 0 || e.target.closest('.rc-cb-h, .rc-cb-mk, .rc-cb-key, .rc-cb-grip, .rc-cb-pin, .rc-cb-seg.move, .rc-cb-speed .rc-cb-seg')) return;
      e.preventDefault();
      this.creator.ui.activity?.();
      timeline.scrubbing = true;
      timeline.scrubTo = this.timeAt(e.clientX);
      this.strip.classList.add('scrubbing');
      this.closePop();
      // With a move pinned, the camera rides it as the playhead goes.
      try { this.creator.scrubPreview(); } catch (error) { console.warn('creator: the move preview', error); }
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

  /** The grip dragged: the clip slid by the time under the pointer since
   *  the press, its length kept, held inside the round. On the drop the
   *  strip re-fits and the clip plays from its new start. */
  bindGrip() {
    const creator = this.creator;
    const grip = this.grip;
    grip.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();
      const start = this.timeAt(e.clientX);
      const t0 = creator.range.in;
      const t1 = creator.range.out;
      let by = 0;
      const move = ev => {
        by = this.timeAt(ev.clientX) - start;
        creator.slideClip(t0, t1, by, { preview: true });
        this.sync(creator.player.time, true);
      };
      const up = ev => {
        move(ev);
        grip.removeEventListener('pointermove', move);
        grip.removeEventListener('pointerup', up);
        grip.removeEventListener('pointercancel', up);
        try { creator.slideClip(t0, t1, by); } catch (error) { console.warn('creator: sliding the clip', error); }
        this.fit();
        this.sync(creator.player.time, true);
      };
      try { grip.setPointerCapture(e.pointerId); } catch {}
      grip.addEventListener('pointermove', move);
      grip.addEventListener('pointerup', up);
      grip.addEventListener('pointercancel', up);
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
    this.placePin(t, span);
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
      creator.keys.map(k => k.t).join(','), take?.f?.t, take?.kill?.t, creator.range.loop, creator.rounds.style,
      creator.takeHeld, creator.ramp.speed, creator.movesCamera, creator.moveStyle, creator.keys.map(k => k.role ?? '').join('')].join('|');
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
    this.grip.style.left = this.pct((span.t0 + span.t1) / 2);
    this.title.textContent = take ? 'Take' : 'Clip';
    const width = s => `${((s.t1 - s.t0) / (w1 - w0)) * 100}%`;
    const rec = creator.player.rec;
    const node = (lane, tag, cls, text, t0, t1 = null, title = '') => {
      const n = el(tag, cls, text);
      n.style.left = this.pct(t0);
      if (t1 !== null) n.style.width = width({ t0: Math.max(t0, w0), t1: Math.min(t1, w1) });
      if (title) n.title = title;
      this.lanes[lane].append(n);
      return n;
    };
    const go = (n, t0) => {
      n.addEventListener('pointerdown', e => e.stopPropagation());
      n.addEventListener('click', e => {
        e.stopPropagation();
        creator.player.seek(t0);
      });
    };
    for (const lane of Object.values(this.lanes)) lane.textContent = '';

    // Ticks, labelled from the clip's start.
    this.ticks.textContent = '';
    const step = tickStep(w1 - w0);
    for (let s0 = Math.ceil((w0 - span.t0) / step) * step; span.t0 + s0 <= w1 + 1e-6; s0 += step) {
      const tick = el('i', Math.abs(s0 % 1) < 1e-6 ? 'major' : '');
      tick.style.left = this.pct(span.t0 + s0);
      if (Math.abs(s0 % 1) < 1e-6) tick.dataset.label = `${s0 > 0 ? '+' : ''}${Math.round(s0)}`;
      this.ticks.append(tick);
    }

    // EVENTS: the action under the take's shot and kill, the round's other
    // kills in view.
    if (action) node('events', 'i', 'rc-cb-action', '', action.t0, action.t1, 'The action: from the shot to just after the kill. Camera moves and slow motion go here.');
    for (const k of creator.player.kills ?? rec.kills ?? []) {
      if (k.kind !== 'kill' || k.t < w0 || k.t > w1 || k === take?.kill) continue;
      go(node('events', 'button', 'rc-cb-mk other', '', k.t, null, `${nameAt(rec, k.killer, k.t)} kills ${nameAt(rec, k.victim, k.t)}`), k.t);
    }
    if (take?.f && take.f.t >= w0 && take.f.t <= w1) {
      go(node('events', 'button', 'rc-cb-mk shot', isMelee(take.f.weapon) ? 'Swing' : 'Shot', take.f.t, null,
        `${nameAt(rec, take.f.pid, take.f.t)} fires`), take.f.t);
    }
    if (take?.kill && take.kill.t >= w0 && take.kill.t <= w1) {
      go(node('events', 'button', 'rc-cb-mk kill', 'Kill', take.kill.t, null,
        `${nameAt(rec, take.kill.killer, take.kill.t)} kills ${nameAt(rec, take.kill.victim, take.kill.t)}`), take.kill.t);
    }

    // CAMERA: with two views kept inside the clip, the move between them and
    // the holds either side; else the shot style over the clip.
    const inside = keysIn(creator.keys, span);
    const va = creator.viewKey('a');
    const vb = creator.viewKey('b');
    if (creator.movesCamera) {
      const a = va.t;
      const b = vb.t;
      const how = { glide: ['glides A → B', 'The camera moves smoothly from view A to view B'],
        orbit: ['orbits A → B', 'The camera swings round the action from view A to view B'],
        cut: ['holds A, cuts to B', 'The camera stays on view A, then cuts to view B at B'] }[creator.moveStyle] ?? ['A → B', ''];
      if (a - span.t0 > 0.05) node('camera', 'span', 'rc-cb-seg hold', 'holds A', span.t0, a, 'Before A the camera sits on view A');
      const seg = node('camera', 'button', `rc-cb-seg move ${creator.moveStyle}`, how[0], a, b, `${how[1]}. Click for how it moves, how slow, and a preview`);
      seg.type = 'button';
      seg.addEventListener('click', e => {
        e.stopPropagation();
        this.openPop('move', parseFloat(this.pct((a + b) / 2)));
      });
      if (span.t1 - b > 0.05) node('camera', 'span', 'rc-cb-seg hold', 'holds B', b, span.t1, 'After B the camera sits on view B');
    } else {
      const style = creator.takeHeld ? 'Your camera, by hand' : take ? `${styleLabel(creator.rounds.style)} (shot style)` : 'The camera as it is';
      const aside = va && vb ? ' · your A → B move is off' : va ? ' · pin B for a move' : vb ? ' · pin A for a move' : '';
      node('camera', 'span', 'rc-cb-seg style', `${style}${aside}`, span.t0, span.t1,
        'Keep a view as A and another as B (Clip tab) to fly your own move instead');
    }
    // The views themselves: A, B and any between; outside the clip, dimmed.
    for (const key of creator.keys) {
      if (key.t < w0 || key.t > w1) continue;
      const i = inside.indexOf(key);
      const letter = key === va ? 'A' : key === vb ? 'B' : i < 0 ? '' : String(i + 1);
      const k = node('camera', 'button', `rc-cb-key${i < 0 ? ' out' : ''}`, '', key.t, null,
        i < 0 ? 'A view kept outside the clip: the move does not use it' : `View ${letter}: click to see it, drag to move it`);
      k.append(el('b', '', letter));
      this.bindKey(k, key);
    }

    // SPEED: the slow stretch, and normal speed elsewhere.
    const speedSeg = slow
      ? node('speed', 'button', 'rc-cb-seg slow', `${speedWord(creator.ramp.speed)} slow`, slow.t0, slow.t1, 'The clip plays slowly here, eased in and out. Click to change')
      : node('speed', 'button', 'rc-cb-seg plain', 'normal speed · click to slow down', span.t0, span.t1, 'Click to slow the action, the move or the whole clip');
    speedSeg.type = 'button';
    speedSeg.addEventListener('click', e => {
      e.stopPropagation();
      const at = slow ?? span;
      this.openPop('speed', parseFloat(this.pct((at.t0 + at.t1) / 2)));
    });
    if (!this.pop.hidden) this.fillPop();
  }

  /** Pin view at the playhead: shown inside the clip while it is paused, and
   *  saying what a press would do there. */
  placePin(t, span) {
    const creator = this.creator;
    const inside = t >= span.t0 - 1e-3 && t <= span.t1 + 1e-3;
    const show = inside && !creator.player.playing && !this.creator.ui.timeline.scrubbing;
    if (this.pin.hidden === show) this.pin.hidden = !show;
    if (!show) return;
    const a = creator.viewKey('a');
    const b = creator.viewKey('b');
    let text;
    if (!a) text = b && t >= b.t - 0.05 ? 'Move end here' : 'Pin start here';
    else if (!b) text = t <= a.t + 0.05 ? 'Move start here' : 'Pin end here';
    else text = Math.abs(t - a.t) <= Math.abs(t - b.t) ? 'Move start here' : 'Move end here';
    if (this.pin.textContent !== text) {
      this.pin.textContent = text;
      this.pin.title = `${text}: this moment and the view on screen (K)`;
    }
    const at = this.pct(t);
    if (this.pin.style.left !== at) this.pin.style.left = at;
    const right = parseFloat(at) > 78;
    this.pin.classList.toggle('flip', right);
  }

  /** A view's diamond: a click shows that view, a drag moves it in time. */
  bindKey(mark, key) {
    const creator = this.creator;
    mark.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();
      const x0 = e.clientX;
      let dragT = null;
      const move = ev => {
        if (dragT === null && Math.abs(ev.clientX - x0) <= 5) return;
        dragT = this.timeAt(ev.clientX);
        mark.style.left = this.pct(dragT);
      };
      const up = () => {
        mark.removeEventListener('pointermove', move);
        mark.removeEventListener('pointerup', up);
        mark.removeEventListener('pointercancel', up);
        try {
          if (dragT !== null) creator.moveKey(key, dragT);
          else creator.lookAtKey(key);
        } catch (error) { console.warn('creator: a view', error); }
        this.sync(creator.player.time, true);
      };
      try { mark.setPointerCapture(e.pointerId); } catch {}
      mark.addEventListener('pointermove', move);
      mark.addEventListener('pointerup', up);
      mark.addEventListener('pointercancel', up);
    });
  }

  dispose() {
    document.removeEventListener('pointerdown', this.onOutside, true);
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
.rp-root.rc-editing { --rp-bar-h: 152px; }
.rp-root.rc-editing .rp-tl, .rp-root.rc-editing .rp-lanes { display: none; }
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
.rc-cb-body { display: grid; grid-template-columns: 54px minmax(0, 1fr); margin-top: 3px; }
.rc-cb-legend { display: grid; grid-template-rows: 13px 20px 20px 16px; padding-top: 2px; }
.rc-cb-legend span { color: var(--rp-muted); font: 800 9px/20px var(--rp-font); letter-spacing: .12em; text-transform: uppercase; cursor: help; }
.rc-cb-legend span:last-child { line-height: 16px; }
.rc-cb-strip { position: relative; height: 72px; border-radius: 4px; background: rgba(0, 0, 0, .32); cursor: pointer; touch-action: none; }
/* The lanes, one under the other, the time along the top. */
.rc-cb-ticks { position: absolute; left: 0; right: 0; top: 0; height: 13px; pointer-events: none; }
.rc-cb-ticks i { position: absolute; top: 9px; width: 1px; height: 63px; background: rgba(255, 255, 255, .06); }
.rc-cb-ticks i.major { background: rgba(255, 255, 255, .13); }
.rc-cb-ticks i[data-label]::after { content: attr(data-label); position: absolute; top: -9px; left: 3px;
  color: var(--rp-muted); font: 9px var(--rp-mono); white-space: nowrap; }
.rc-cb-lane { position: absolute; left: 0; right: 0; pointer-events: none; }
.rc-cb-lane > * { pointer-events: auto; }
.rc-cb-events { top: 15px; height: 18px; }
.rc-cb-camera { top: 35px; height: 18px; border-top: 1px solid rgba(255, 255, 255, .05); }
.rc-cb-speed { top: 55px; height: 15px; border-top: 1px solid rgba(255, 255, 255, .05); }
.rc-cb-ctx { position: absolute; top: 0; bottom: 0; pointer-events: none;
  background: repeating-linear-gradient(135deg, rgba(0, 0, 0, .35) 0 6px, rgba(0, 0, 0, .15) 6px 12px); }
.rc-cb-band { position: absolute; top: 0; bottom: 0; background: rgba(232, 195, 90, .08); pointer-events: none; }
.rc-cb-action { position: absolute; bottom: 0; height: 3px; background: var(--rp-gold); opacity: .85; border-radius: 2px; }
.rc-cb-h { position: absolute; top: -3px; bottom: -3px; width: 6px; margin-left: -3px; border-radius: 3px; background: var(--rp-gold);
  cursor: ew-resize; touch-action: none; box-shadow: 0 0 0 1px rgba(0, 0, 0, .5); z-index: 2; }
.rc-cb-h::after { content: ''; position: absolute; inset: 0 -8px; }
.rc-cb-grip { position: absolute; top: -6px; width: 34px; height: 10px; margin-left: -17px; border-radius: 3px; z-index: 2;
  background: var(--rp-gold) repeating-linear-gradient(90deg, transparent 0 9px, rgba(0, 0, 0, .55) 9px 10px, transparent 10px 12px)
  content-box; padding: 0 2px; cursor: grab; touch-action: none; box-shadow: 0 0 0 1px rgba(0, 0, 0, .5); }
.rc-cb-grip:active { cursor: grabbing; }
.rc-cb-grip::after { content: ''; position: absolute; inset: -5px -6px; }
.rc-cb-knob { position: absolute; top: -4px; bottom: -4px; width: 2px; margin-left: -1px; background: #fff; pointer-events: none;
  box-shadow: 0 0 6px rgba(255, 255, 255, .6); z-index: 3; }
.rc-cb-strip.outside .rc-cb-knob { background: var(--rp-muted); box-shadow: none; }
.rc-cb-mk { position: absolute; top: 1px; padding: 0 4px; border: 0; font: 800 9px/14px var(--rp-font); letter-spacing: .08em;
  text-transform: uppercase; white-space: nowrap; cursor: pointer; }
/* The shot's label ends at its moment and the kill's starts at its: a knife or
   a close shot puts the two on the same pixel. */
.rc-cb-mk.shot { background: rgba(232, 195, 90, .9); color: #17150f; transform: translateX(calc(-100% - 1px)); border-radius: 3px 0 0 3px; }
.rc-cb-mk.kill { background: #d9584b; color: #fff; transform: translateX(1px); border-radius: 0 3px 3px 0; }
.rc-cb-mk.other { width: 2px; height: 14px; padding: 0; margin-left: -1px; background: rgba(217, 88, 75, .55); }
/* What films each stretch. */
.rc-cb-seg { position: absolute; top: 2px; height: 14px; overflow: hidden; padding: 0 6px; box-sizing: border-box; border-radius: 3px;
  font: 700 9px/14px var(--rp-font); letter-spacing: .08em; text-transform: uppercase; white-space: nowrap; text-overflow: ellipsis; cursor: help; }
.rc-cb-seg.style { background: rgba(255, 255, 255, .07); color: var(--rp-ink); }
.rc-cb-seg.hold { background: rgba(232, 195, 90, .1); color: var(--rp-muted); }
.rc-cb-seg.move.cut { background: linear-gradient(90deg, rgba(232, 195, 90, .12) 0 calc(100% - 3px), var(--rp-gold) calc(100% - 3px)); color: var(--rp-ink); }
.rc-cb-seg.move { padding: 0 11px; text-align: center; background: linear-gradient(90deg, rgba(232, 195, 90, .55), rgba(232, 195, 90, .3)); color: #17150f; }
.rc-cb-speed .rc-cb-seg { top: 1px; height: 12px; line-height: 12px; }
.rc-cb-seg.slow { background: rgba(110, 170, 220, .45); color: #fff; }
.rc-cb-seg.plain { background: none; color: var(--rp-muted); opacity: .7; }
.rc-cb-key { position: absolute; top: 1px; width: 16px; height: 16px; margin-left: -8px; padding: 0; border: 0; background: none;
  cursor: grab; touch-action: none; z-index: 1; }
.rc-cb-key::before { content: ''; position: absolute; inset: 2px; transform: rotate(45deg); background: #17150f; border: 1.5px solid var(--rp-gold); }
.rc-cb-key b { position: relative; color: var(--rp-gold); font: 800 9px/16px var(--rp-font); }
.rc-cb-key:hover::before { background: var(--rp-gold); }
.rc-cb-key:hover b { color: #17150f; }
.rc-cb-key.out { opacity: .45; }
/* Pin view, riding the playhead on the camera lane. */
.rc-cb-pin { position: absolute; top: 34px; height: 20px; margin-left: 5px; padding: 0 8px; border: 1px solid var(--rp-gold); border-radius: 3px;
  background: #17150f; color: var(--rp-gold); font: 800 9px/18px var(--rp-font); letter-spacing: .1em; text-transform: uppercase;
  white-space: nowrap; cursor: pointer; z-index: 4; box-shadow: 0 2px 8px rgba(0, 0, 0, .6); }
.rc-cb-pin::before { content: '+ '; }
.rc-cb-pin:hover { background: var(--rp-gold); color: #17150f; }
.rc-cb-pin.flip { margin-left: 0; transform: translateX(calc(-100% - 5px)); }
.rc-cb-pin[hidden] { display: none; }
/* The move's segment and the speed lane are buttons that open the chooser. */
button.rc-cb-seg { border: 0; margin: 0; font-family: inherit; cursor: pointer; }
button.rc-cb-seg.move:hover, button.rc-cb-seg.slow:hover { filter: brightness(1.2); }
button.rc-cb-seg.plain:hover { color: var(--rp-ink); opacity: 1; background: rgba(255, 255, 255, .06); }
.rc-cb-pop { position: absolute; bottom: calc(100% + 6px); z-index: 6; display: flex; flex-direction: column; gap: 6px; padding: 9px 10px;
  min-width: 280px; background: var(--rp-plate-menu); border: 1px solid var(--rp-edge); border-radius: 6px; box-shadow: 0 8px 24px rgba(0, 0, 0, .55); }
.rc-cb-pop[hidden] { display: none; }
.rc-cb-pop-title { color: var(--rp-gold); font: 800 10px var(--rp-font); letter-spacing: .14em; text-transform: uppercase; }
.rc-cb-pop-row { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
.rc-cb-pop-label { width: 52px; color: var(--rp-muted); font: 800 9px var(--rp-font); letter-spacing: .1em; text-transform: uppercase; }
.rc-cb-pop .rc-cb-btn { height: 26px; }
.rc-cb-pop .rc-cb-go { border-color: var(--rp-gold); color: var(--rp-gold); }
.rc-cb-pop-note { margin: 0; color: var(--rp-muted); font: 11px/1.35 var(--rp-font); }
@container rp-bar (max-width: 610px) { .rc-cb-where, .rc-cb-from { display: none; } .rc-cb-body { grid-template-columns: 0 minmax(0, 1fr); } .rc-cb-legend { visibility: hidden; } }
`;
