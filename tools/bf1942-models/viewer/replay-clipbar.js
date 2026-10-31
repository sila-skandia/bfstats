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
// Everything about the clip's time is done here, with one grammar on every
// lane (features/replay-creator-view, "Keyframes on the strip"): a press
// goes there and a drag scrubs, a drag on a thing moves it, a right-click
// (a long press on touch) offers what can be done to whatever is under it.
// The clip's ends drag to trim and its top rail slides it; the camera lane
// carries numbered keyframes, added with the + at the playhead or K, that a
// take's auto camera glides into; a drag on the speed lane paints a slow
// stretch. The header is Play, Export and Done.

import { fmt } from './replay-creator-panel.js';
import { nameAt } from './replay-recording.js';
import { RAMP_SPEEDS, keysIn, rampSpanOf, ramping, screenSeconds, speedWord } from './replay-shot.js';
import { END_MOVES, KEY_MOVES, moveLabel } from './replay-camtrack.js';
import { SHOT_STYLES, isMelee, styleLabel } from './replay-shotstyle.js';

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

/** Seconds a slow stretch painted with a drag must cover to be kept: less
 *  is a click on the lane, which goes there. */
export const PAINT_MIN = 0.15;
/** A touch held this long without moving opens the lane's menu. */
const LONG_PRESS_MS = 550;

/**
 * What films each stretch of the clip, for the camera lane: `[{ kind, t0,
 * t1, label, title, icon }]` over `span`, with `keys` the keyframes inside
 * it in time order, each perhaps carrying its own `move` (replay-camtrack.js
 * KEY_MOVES to the next, END_MOVES after the last). `auto` names the take's
 * shot style when its auto camera films the clip's start (`autoId` its id),
 * else null: the camera as it is, or `hand`. `moveStyle` is the clip's move
 * for keyframes with none of their own. Kinds: 'auto' (the shot style),
 * 'plain' (no camera of the clip's own), 'move' (keyframe to keyframe),
 * 'hold' (on one keyframe), 'end' (the last keyframe's move to the end).
 * `icon` names the glyph that says what the camera does (MOVE_ICONS).
 */
export function cameraSegments(span, keys, { auto = null, autoId = 'chase', hand = false, moveStyle = 'glide' } = {}) {
  if (!span) return [];
  const n = keys.length;
  const segs = [];
  const add = (kind, t0, t1, label, title, icon = null) => {
    if (t1 - t0 > 1e-3) segs.push({ kind, t0, t1, label, title, icon });
  };
  if (!n) {
    if (auto) add('auto', span.t0, span.t1, `Auto · ${auto}`, 'The shot style films the clip. Right-click for another style, or add a keyframe', `style:${autoId}`);
    else add('plain', span.t0, span.t1, hand ? 'Your camera, by hand' : 'The camera as it is',
      'Add a keyframe (+ or K) to give the clip a camera of its own');
    return segs;
  }
  const first = keys[0];
  const last = keys[n - 1];
  if (auto) add('auto', span.t0, first.t, `${auto}, glides into 1`, 'The shot style films the clip up to keyframe 1, then glides into it', `style:${autoId}`);
  else add('hold', span.t0, first.t, 'holds 1', 'Before keyframe 1 the camera sits on it', 'hold');
  for (let i = 0; i < n - 1; i++) {
    const move = keys[i].move && keys[i].move !== 'hold' && KEY_MOVES.some(([m]) => m === keys[i].move) ? keys[i].move : moveStyle;
    const label = move === 'cut' ? `holds ${i + 1}, cuts to ${i + 2}` : `${moveLabel(move)} ${i + 1} → ${i + 2}`;
    add('move', keys[i].t, keys[i + 1].t, label, `${KEY_MOVES.find(([m]) => m === move)?.[2] ?? ''}. Right-click keyframe ${i + 1} or here to change it`, move);
  }
  const end = last.move && END_MOVES.some(([m]) => m === last.move) ? last.move : 'hold';
  if (end === 'hold') add('hold', last.t, span.t1, `holds ${n}`, `After keyframe ${n} the camera sits on it. Right-click keyframe ${n} for a move to the end`, 'hold');
  else add('end', last.t, span.t1, moveLabel(end), `${END_MOVES.find(([m]) => m === end)?.[2] ?? ''}. Right-click keyframe ${n} to change it`, end);
  return segs;
}

/**
 * The glyphs that say what the camera does, drawn in a 24 x 24 box with
 * the current colour's stroke: the moves between keyframes and after the
 * last (replay-camtrack.js KEY_MOVES, END_MOVES) and the shot styles
 * (`style:<id>`, replay-shotstyle.js).
 */
export const MOVE_ICONS = Object.freeze({
  glide: 'M3 12h16M14 7l5 5-5 5',
  orbit: 'M4 17a8 8 0 0 1 16 0M17 14l3 3 3-3',
  orbit360: 'M19 12a7 7 0 1 1-2.05-4.95M17 3v4.2h4.2',
  whip: 'M8 12h13M16 7l5 5-5 5M2 8h5M3 12h3M2 16h5',
  cut: 'M3 6h7v12H3zM14 6h7v12h-7z',
  hold: 'M5 6h14v12H5zM10 10v4M14 10v4',
  spin: 'M3 15a9 4 0 1 0 18 0a9 4 0 1 0-18 0M12 5v10',
  push: 'M9 9h6v6H9zM2 2l5 5M22 2l-5 5M2 22l5-5M22 22l-5-5',
  pull: 'M9 9h6v6H9zM7 7 2 2M17 7l5-5M7 17l-5 5M17 17l5 5M2 6V2h4M18 2h4v4M2 18v4h4M22 18v4h-4',
  crane: 'M12 19V4M7 9l5-5 5 5M4 21h16',
  'style:chase': 'M2 12h11M9 8l4 4-4 4M19 12m-2.5 0a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0',
  'style:orbit': 'M12 12m-2.5 0a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0M4 12a8 8 0 1 0 2.4-5.7M6 2v4.5h4.5',
  'style:side': 'M3 8h14M13 4l4 4-4 4M3 18h3M9 18h3M15 18h3',
  'style:reverse': 'M22 12H10M14 8l-4 4 4 4M4.5 12m-2.5 0a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0',
  'style:fixed': 'M3 7h12v10H3zM15 10l6-3v10l-6-3',
});

/** The glyph for `id` as an inline SVG, or null for none. */
export function moveIcon(id) {
  const d = MOVE_ICONS[id];
  if (!d || typeof document === 'undefined') return null;
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'rc-cb-icon');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', d);
  svg.append(path);
  return svg;
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
    this.menu = null;              // { title, items } for the right-click chooser
    injectStyle();
    const bar = el('div', 'rc-cb');
    bar.hidden = true;
    const head = el('div', 'rc-cb-head');
    this.title = el('span', 'rc-cb-title', 'Clip');
    this.clock = el('span', 'rc-cb-clock');
    this.where = el('span', 'rc-cb-where');
    this.playBtn = this.button('Play', 'Play the clip from its start, looping (P); Pause holds it', () => {
      const player = creator.player;
      if (player.playing) {
        player.playing = false;
        creator.rangePlaying = false;
      } else creator.playRange();
      this.sync(player.time, true);
    }, 'rc-cb-play');
    this.exportBtn = this.button('Export', 'The frame to record in, record the clip, keep it', () => {
      if (!this.pop.hidden && this.popKind === 'export') this.closePop();
      else this.openPop('export', 100);
    }, 'rc-cb-export');
    const done = this.button('Done', 'Close the clip and go back to where you were in the round (Esc)', () => creator.closeEditor(), 'rc-cb-back');
    head.append(this.title, this.clock, this.where, el('span', 'rc-cb-gap'), this.playBtn, this.exportBtn, done);

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
    // The +, riding the playhead on the camera lane while paused in the clip:
    // a keyframe of the view on screen here (K). One meaning, always.
    this.pin = el('button', 'rc-cb-pin', '+');
    this.pin.type = 'button';
    this.pin.hidden = true;
    this.pin.title = 'Keyframe the view on screen here (K)';
    this.pin.setAttribute('aria-label', 'Keyframe the view on screen here');
    this.pin.addEventListener('pointerdown', e => e.stopPropagation());
    this.pin.addEventListener('click', e => {
      e.stopPropagation();
      try { creator.keyframeHere(); } catch (error) { console.warn('creator: a keyframe', error); }
      this.sync(creator.player.time, true);
    });
    // The chooser a right-click opens, and Export's.
    this.pop = el('div', 'rc-cb-pop');
    this.pop.hidden = true;
    this.pop.addEventListener('pointerdown', e => e.stopPropagation());
    this.pop.addEventListener('contextmenu', e => e.preventDefault());
    this.onOutside = e => {
      if (!this.pop.hidden && !this.pop.contains(e.target) && !e.target.closest?.('.rc-cb-export')) this.closePop();
    };
    document.addEventListener('pointerdown', this.onOutside, true);
    // The rail along the clip's top edge: a drag slides the whole clip.
    this.grip = el('i', 'rc-cb-grip');
    this.grip.title = 'Drag to slide the whole clip earlier or later: its keyframes and slow motion go with it';
    strip.append(this.ticks, this.ctxL, this.ctxR, this.band, ...Object.values(this.lanes), this.inH, this.outH, this.grip, this.knob, this.pin);
    this.strip = strip;
    // The legend: what each lane is.
    const legend = el('div', 'rc-cb-legend');
    for (const [label, title] of [
      ['', ''],
      ['Clip', 'The clip and what happens in it. Drag its ends to trim, its top rail to slide it; right-click for more'],
      ['Camera', 'What films each part of the clip. + at the playhead (K) adds a keyframe; right-click for styles and moves'],
      ['Speed', 'Where the clip plays slowly. Drag across the lane to slow a stretch; right-click it for how slow'],
    ]) {
      const l = el('span', '', label);
      l.title = title;
      legend.append(l);
    }
    const body = el('div', 'rc-cb-body');
    body.append(legend, strip);
    this.hint = el('p', 'rc-cb-hint', 'Right-click a lane for options · drag to move · + keyframes the view');
    bar.append(head, body, this.hint, this.pop);
    this.el = bar;
    this.bindScrub();
    this.bindMenu();
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
    this.menu = null;
    this.creator.ui?.root?.classList.remove('rc-pop-open');
  }

  /** Open the chooser: `menu` (a right-click's, `this.menu`) or `export`,
   *  over the strip at `x` (a percentage of it). */
  openPop(kind, x) {
    this.popKind = kind;
    this.popX = x;
    this.pop.hidden = false;
    // Over the creator's panel, which comes later in the page.
    this.creator.ui?.root?.classList.add('rc-pop-open');
    this.fillPop();
  }

  /** The right-click chooser for whatever is at `clientX`, `clientY`. */
  openMenuAt(clientX, clientY, target = null) {
    const menu = this.menuAt(clientX, clientY, target);
    if (!menu) return;
    this.menu = menu;
    this.creator.ui.activity?.();
    this.openPop('menu', parseFloat(this.pct(this.timeAt(clientX))));
  }

  /** `{ title, items }` for a right-click: which lane, which thing on it. */
  menuAt(clientX, clientY, target) {
    const creator = this.creator;
    const span = creator.span;
    if (!span) return null;
    const t = this.timeAt(clientX);
    const lane = this.laneAt(clientY);
    const at = `${t < span.t0 ? '-' : '+'}${fmt(Math.abs(t - span.t0))}`;
    const item = (label, run, { on = false, rule = false, key = '' } = {}) => ({ label, run, on, rule, key });
    const inside = t >= span.t0 - 1e-3 && t <= span.t1 + 1e-3;
    if (lane === 'camera') {
      const keyEl = target?.closest?.('.rc-cb-key');
      const key = keyEl ? this.keyOfMark.get(keyEl) : null;
      if (key) {
        const inKeys = keysIn(creator.keys, span);
        const n = inKeys.indexOf(key) + 1;
        const tail = [
          item('Look through it', () => creator.lookAtKey(key), { rule: Boolean(n) }),
          item('Replace with the view on screen', () => creator.replaceKey(key)),
          item('Delete', () => creator.deleteKey(key)),
        ];
        if (!n) return { title: 'Keyframe outside the clip', items: tail };
        return { title: `Keyframe ${n} · ${fmt(key.t - span.t0)}`, items: [...this.moveItems(key, inKeys, n), ...tail] };
      }
      if (!inside) {
        return { title: 'Outside the clip', items: [item(t < span.t0 ? 'Start the clip here' : 'End the clip here', () => creator.setEnd(t < span.t0 ? 'in' : 'out', t))] };
      }
      const seg = this.segs?.find(sg => t >= sg.t0 - 1e-3 && t <= sg.t1 + 1e-3) ?? null;
      const keyHere = item('Keyframe the view here', () => creator.keyframeHere(t), { rule: true, key: 'K' });
      if (seg?.kind === 'auto' || (seg?.kind === 'plain' && creator.takeInside(span))) {
        const styles = SHOT_STYLES.filter(([id]) => id !== 'fixed' || creator.rounds.angle).map(([id, label]) =>
          ({ ...item(label, () => creator.setShotStyle(id), { on: !creator.takeHeld && creator.rounds.style === id }), icon: `style:${id}` }));
        return {
          title: 'Auto camera · the shot style',
          items: [...styles, keyHere, item('Suggest angles here', () => creator.suggest())],
        };
      }
      if (seg?.kind === 'move' || seg?.kind === 'end' || (seg?.kind === 'hold' && seg.t0 > span.t0 + 1e-3)) {
        // The stretch belongs to the keyframe it starts on.
        const inKeys = keysIn(creator.keys, span);
        const i = inKeys.findIndex(k => Math.abs(k.t - seg.t0) < 1e-3);
        if (i >= 0) {
          return {
            title: `Keyframe ${i + 1} · how the camera goes on`,
            items: [...this.moveItems(inKeys[i], inKeys, i + 1), keyHere, item('Delete every keyframe', () => creator.clearKeys())],
          };
        }
      }
      return {
        title: `Camera · ${at}`,
        items: [
          item('Keyframe the view here', () => creator.keyframeHere(t), { key: 'K' }),
          ...(creator.keys.length ? [item('Delete every keyframe', () => creator.clearKeys(), { rule: true })] : []),
        ],
      };
    }
    if (lane === 'speed') {
      const slow = creator.ownSlow() ? rampSpanOf(creator.ramp, span) : null;
      if (slow && t >= slow.t0 - 0.05 && t <= slow.t1 + 0.05) {
        const comesBack = creator.rounds.bulletTime && creator.autoFilms(span);
        return {
          title: `Your slow motion · ${speedWord(creator.ramp.speed)}`,
          items: [
            ...RAMP_SPEEDS.filter(v => v < 1).map(v => item(`${speedWord(v)} speed`, () => creator.setSlowRange(slow.t0, slow.t1, v),
              { on: creator.ramp.speed === v })),
            item(comesBack ? 'Remove it: the kill shot\'s bullet time comes back' : 'Back to normal speed', () => creator.clearSlow(), { rule: true }),
          ],
        };
      }
      const auto = creator.autoSlow(span);
      if (auto && t >= auto.t0 - 0.05 && t <= auto.t1 + 0.05) {
        return {
          title: 'Bullet time · automatic',
          items: [
            ...[['subtle', 'Subtle'], ['strong', 'Strong'], ['extreme', 'Extreme']].map(([id, label]) =>
              item(label, () => creator.setBulletTime(id), { on: auto.pace === id })),
            item('Off: normal speed', () => creator.setBulletTime('off')),
            item('Make it my own slow motion (1/4)', () => creator.setSlowRange(auto.t0, auto.t1, 0.25), { rule: true }),
          ],
        };
      }
      const action = creator.clipAction;
      return {
        title: 'Speed · normal',
        items: [
          item('Slow down from here', () => creator.setSlowRange(t, Math.min(span.t1, t + 1.2), 0.25)),
          ...(action ? [item('Slow the action', () => creator.setSlowRange(action.t0, action.t1, 0.25))] : []),
          item('Slow the whole clip to 1/2', () => creator.setSlowRange(span.t0, span.t1, 0.5)),
        ],
      };
    }
    const take = creator.take ?? creator.takeInside(span);
    return {
      title: `Clip · ${at}`,
      items: [
        item('Start the clip here', () => creator.setEnd('in', t)),
        item('End the clip here', () => creator.setEnd('out', t)),
        item('Play from here', () => creator.playFrom(t)),
        ...(take ? [item('Fit the clip to the kill', () => creator.fitToKill(), { rule: true })] : []),
      ],
    };
  }

  /** The moves a keyframe can make, for its menu: to keyframe `n + 1`, or,
   *  from the last, to the clip's end. Each with its glyph, the current one
   *  ticked. */
  moveItems(key, inKeys, n) {
    const creator = this.creator;
    const next = inKeys[n] ?? null;
    const list = next ? KEY_MOVES : END_MOVES;
    const current = next
      ? (KEY_MOVES.some(([m]) => m === key.move) ? key.move : creator.moveStyle)
      : (END_MOVES.some(([m]) => m === key.move) ? key.move : 'hold');
    return [
      { heading: true, label: next ? `To keyframe ${n + 1}` : 'To the end of the clip' },
      ...list.map(([id, label]) => ({ label, icon: id, on: current === id, run: () => creator.setKeyMove(key, id) })),
    ];
  }

  fillPop() {
    const creator = this.creator;
    const pop = this.pop;
    pop.textContent = '';
    const entry = (label, on, run, { rule = false, key = '', cls = '', icon = null } = {}) => {
      const b = el('button', `rc-cb-item${on ? ' on' : ''}${rule ? ' rule' : ''}${cls ? ` ${cls}` : ''}`);
      b.type = 'button';
      b.append(el('i', 'rc-cb-mark', on ? '✓' : ''));
      const glyph = moveIcon(icon);
      if (glyph) b.append(glyph);
      b.append(el('span', '', label));
      if (key) b.append(el('kbd', '', key));
      b.addEventListener('click', e => {
        e.stopPropagation();
        this.closePop();
        try { run(); } catch (error) { console.warn('creator: the clip menu', error); }
        this.sync(creator.player.time, true);
      });
      pop.append(b);
    };
    if (this.popKind === 'menu' && this.menu) {
      pop.append(el('b', 'rc-cb-pop-title', this.menu.title));
      for (const it of this.menu.items) {
        if (it.heading) pop.append(el('span', 'rc-cb-pop-head', it.label));
        else entry(it.label, it.on, it.run, { rule: it.rule, key: it.key, icon: it.icon });
      }
    } else if (this.popKind === 'export') {
      pop.append(el('b', 'rc-cb-pop-title', 'Frame'));
      for (const [id, label] of EXPORT_FRAMES) {
        const b = el('button', `rc-cb-item${creator.prefs.frame === id ? ' on' : ''}`);
        b.type = 'button';
        b.append(el('i', 'rc-cb-mark', creator.prefs.frame === id ? '✓' : ''), el('span', '', label));
        b.addEventListener('click', e => {
          e.stopPropagation();
          creator.setPref('frame', id);
          this.fillPop();
        });
        pop.append(b);
      }
      const span = creator.span;
      const secs = span ? screenSeconds(creator.ramp, span, span.t0, span.t1) : 0;
      entry(creator.recorder ? 'Stop recording' : `Record the clip · about ${Math.round(secs)} s`, false, () => {
        if (creator.recorder) creator.stopRecording(false);
        else creator.record();
      }, { rule: true, cls: 'rec' });
      entry('Keep the clip', false, () => creator.saveClip());
      pop.append(el('p', 'rc-cb-pop-note', 'Records the 3D view alone with its sound, in the frame picked, as it plays: slow motion takes its time.'));
    }
    // Over what it is about, kept on the strip.
    const r = this.strip.getBoundingClientRect();
    const w = pop.offsetWidth || 240;
    const left = this.popKind === 'export'
      ? r.width - w
      : clamp((this.popX / 100) * r.width - 12, 0, Math.max(0, r.width - w));
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

  /** Which lane is at `clientY`: 'events', 'camera' or 'speed'. */
  laneAt(clientY) {
    for (const name of ['speed', 'camera']) {
      const r = this.lanes[name].getBoundingClientRect();
      if (clientY >= r.top - 1) return name;
    }
    return 'events';
  }

  // --- the pointer -------------------------------------------------------------------------

  /** Right-click anywhere on the strip offers what can be done there. */
  bindMenu() {
    this.strip.addEventListener('contextmenu', e => {
      e.preventDefault();
      e.stopPropagation();
      try { this.openMenuAt(e.clientX, e.clientY, e.target); } catch (error) { console.warn('creator: the clip menu', error); }
    });
  }

  /** A press on the strip scrubs, through the round timeline's own scrub, so
   *  the replay pauses its clock and lands the seek in the frame as it does
   *  for the round's bar. On the speed lane a drag paints a slow stretch
   *  instead. A touch held still opens the lane's menu. */
  bindScrub() {
    const creator = this.creator;
    const timeline = creator.ui.timeline;
    let press = null;
    const end = () => {
      this.strip.removeEventListener('pointermove', move);
      this.strip.removeEventListener('pointerup', up);
      this.strip.removeEventListener('pointercancel', up);
      clearTimeout(press?.timer);
      if (press?.mode === 'scrub') timeline.scrubbing = false;
      this.strip.classList.remove('scrubbing');
    };
    const move = e => {
      if (!press) return;
      if (Math.hypot(e.clientX - press.x, e.clientY - press.y) > 8) clearTimeout(press.timer);
      const t = this.timeAt(e.clientX);
      if (press.mode === 'scrub') timeline.scrubTo = t;
      else this.paintTo(press, t);
    };
    const up = e => {
      if (!press) return;
      const p = press;
      move(e);
      end();
      press = null;
      if (p.mode === 'paint') {
        const span = creator.span;
        const a = Math.min(p.t0, p.t1 ?? p.t0);
        const b = Math.max(p.t0, p.t1 ?? p.t0);
        if (span && b - a >= PAINT_MIN) creator.setSlowRange(a, b, 0.25);
        else creator.player.seek(p.t0);
        this.paint = null;
        this.sync(creator.player.time, true);
      } else timeline.scrubTo = this.timeAt(e.clientX);
    };
    this.strip.addEventListener('pointerdown', e => {
      if (e.button !== 0 || this.dragging || e.target.closest('.rc-cb-h, .rc-cb-mk, .rc-cb-key, .rc-cb-grip, .rc-cb-pin, .rc-cb-seg.slow')) return;
      e.preventDefault();
      creator.ui.activity?.();
      this.closePop();
      const t = this.timeAt(e.clientX);
      const span = creator.span;
      const paint = this.laneAt(e.clientY) === 'speed' && span && t >= span.t0 && t <= span.t1;
      press = { x: e.clientX, y: e.clientY, mode: paint ? 'paint' : 'scrub', t0: t, t1: null };
      if (e.pointerType === 'touch') {
        const target = e.target;
        press.timer = setTimeout(() => {
          if (!press) return;
          end();
          press = null;
          this.paint = null;
          try { this.openMenuAt(e.clientX, e.clientY, target); } catch (error) { console.warn('creator: the clip menu', error); }
        }, LONG_PRESS_MS);
      }
      if (press.mode === 'scrub') {
        timeline.scrubbing = true;
        timeline.scrubTo = t;
        this.strip.classList.add('scrubbing');
        // With keyframes, the camera rides them as the playhead goes.
        try { creator.scrubPreview(); } catch (error) { console.warn('creator: the move preview', error); }
      }
      try { this.strip.setPointerCapture(e.pointerId); } catch {}
      this.strip.addEventListener('pointermove', move);
      this.strip.addEventListener('pointerup', up);
      this.strip.addEventListener('pointercancel', up);
    });
  }

  /** The slow stretch being painted, drawn as the drag goes. */
  paintTo(press, t) {
    const span = this.creator.span;
    if (!span) return;
    press.t1 = clamp(t, span.t0, span.t1);
    this.paint = { t0: Math.min(press.t0, press.t1), t1: Math.max(press.t0, press.t1) };
    this.sync(this.creator.player.time, true);
  }

  /** A slow stretch dragged: its body moves it, a grip at either end
   *  resizes it. The strip is not redrawn under the drag -- that would throw
   *  away the bar being held, and the drag with it -- only the held bar moves,
   *  and the stretch is set on the drop. `own` false is the take's automatic
   *  bullet time: moved or resized, it becomes the clip's own slow motion. */
  bindSlow(seg, slow, { own = true } = {}) {
    const creator = this.creator;
    const strip = this.strip;
    seg.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();
      this.closePop();
      creator.ui.activity?.();
      const edge = e.target.closest('.rc-cb-slowgrip')?.dataset.end ?? 'body';
      const grab = this.timeAt(e.clientX);
      const span = creator.span;
      let next = { t0: slow.t0, t1: slow.t1 };
      let moved = false;
      this.dragging = true;
      seg.classList.add('held');
      const move = ev => {
        const t = this.timeAt(ev.clientX);
        if (!moved && Math.abs(t - grab) < 0.02) return;
        moved = true;
        if (edge === 'in') next = { t0: clamp(Math.min(t, slow.t1 - PAINT_MIN), span.t0, span.t1), t1: slow.t1 };
        else if (edge === 'out') next = { t0: slow.t0, t1: clamp(Math.max(t, slow.t0 + PAINT_MIN), span.t0, span.t1) };
        else {
          const len = slow.t1 - slow.t0;
          const a = clamp(slow.t0 + (t - grab), span.t0, span.t1 - len);
          next = { t0: a, t1: a + len };
        }
        seg.style.left = this.pct(next.t0);
        seg.style.width = `${((next.t1 - next.t0) / (this.window.w1 - this.window.w0)) * 100}%`;
      };
      const up = ev => {
        move(ev);
        strip.removeEventListener('pointermove', move);
        strip.removeEventListener('pointerup', up);
        strip.removeEventListener('pointercancel', up);
        this.dragging = false;
        seg.classList.remove('held');
        try {
          if (moved) creator.setSlowRange(next.t0, next.t1, own ? creator.ramp.speed : 0.25);
        } catch (error) { console.warn('creator: the slow motion', error); }
        this.sync(creator.player.time, true);
      };
      try { strip.setPointerCapture(e.pointerId); } catch {}
      strip.addEventListener('pointermove', move);
      strip.addEventListener('pointerup', up);
      strip.addEventListener('pointercancel', up);
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

  /** The rail dragged: the clip slid by the time under the pointer since
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
    const playLabel = creator.player.playing ? 'Pause' : 'Play';
    if (this.playBtn.textContent !== playLabel) this.playBtn.textContent = playLabel;
    this.exportBtn.classList.toggle('on', Boolean(creator.recorder));
    const slow = this.paint ?? (creator.ownSlow() ? rampSpanOf(creator.ramp, span) : null);
    const autoSlow = this.paint || slow ? null : creator.autoSlow(span);
    const action = creator.clipAction;
    const take = creator.take;
    const auto = creator.autoFilms(span) ? styleLabel(creator.rounds.style) : null;
    const sig = [span.t0, span.t1, this.window.w0, this.window.w1, slow?.t0, slow?.t1, action?.t0, action?.t1,
      creator.keys.map(k => k.t).join(','), take?.f?.t, take?.kill?.t, auto, creator.takeHeld, creator.ramp.speed,
      creator.moveStyle, Boolean(this.paint), autoSlow?.t0, autoSlow?.t1, autoSlow?.pace, creator.rounds.style,
      creator.keys.map(k => k.move ?? '').join(',')].join('|');
    if (!force && sig === this.sig) return;
    // A bar held in a drag is moved by the drag itself (`bindSlow`).
    if (this.dragging) return;
    this.sig = sig;
    const { w0, w1 } = this.window;
    this.ctxL.style.left = '0';
    this.ctxL.style.width = this.pct(span.t0);
    this.ctxR.style.left = this.pct(span.t1);
    this.ctxR.style.right = '0';
    this.band.style.left = this.pct(span.t0);
    this.band.style.width = `${((span.t1 - span.t0) / (w1 - w0)) * 100}%`;
    this.inH.style.left = this.pct(span.t0);
    this.outH.style.left = this.pct(span.t1);
    this.grip.style.left = this.pct(span.t0);
    this.grip.style.width = this.band.style.width;
    this.title.textContent = take ? 'Kill shot' : 'Clip';
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

    // CLIP: the action under the take's shot and kill, the round's other
    // kills in view.
    if (action) node('events', 'i', 'rc-cb-action', '', action.t0, action.t1, 'The action: from the shot to just after the kill');
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

    // CAMERA: what films each stretch, and the keyframes on it.
    const inside = keysIn(creator.keys, span);
    this.segs = cameraSegments(span, inside, { auto, autoId: creator.rounds.style, hand: creator.takeHeld, moveStyle: creator.moveStyle });
    for (const sg of this.segs) {
      const seg = node('camera', 'span', `rc-cb-seg ${sg.kind}${sg.icon ? ` m-${sg.icon.replace(':', '-')}` : ''}`, '', sg.t0, sg.t1, sg.title);
      const glyph = moveIcon(sg.icon);
      if (glyph) seg.append(glyph);
      seg.append(el('span', '', sg.label));
    }
    this.keyOfMark = new WeakMap();
    for (const key of creator.keys) {
      if (key.t < w0 || key.t > w1) continue;
      const i = inside.indexOf(key);
      const k = node('camera', 'button', `rc-cb-key${i < 0 ? ' out' : ''}`, '', key.t, null,
        i < 0 ? 'A keyframe outside the clip: the camera does not use it' : `Keyframe ${i + 1}: click to look through it, drag to move it, right-click for more`);
      k.append(el('b', '', i < 0 ? '' : String(i + 1)));
      this.keyOfMark.set(k, key);
      this.bindKey(k, key);
    }

    // SPEED: what slows the clip, exactly as it plays: the clip's own slow
    // stretch (painted, or being painted), else the take's automatic bullet
    // time, else normal speed.
    const grips = seg => {
      for (const end of ['in', 'out']) {
        const g = el('i', `rc-cb-slowgrip ${end}`);
        g.dataset.end = end;
        seg.append(g);
      }
      return seg;
    };
    if (slow) {
      const seg = node('speed', 'span', `rc-cb-seg slow${this.paint ? ' painting' : ''}`, '',
        slow.t0, slow.t1, 'Slow motion: drag to move it, drag an end to resize it, right-click for how slow');
      seg.append(el('b', '', `${speedWord(this.paint && !creator.ownSlow() ? 0.25 : creator.ramp.speed)} slow`));
      if (!this.paint) this.bindSlow(grips(seg), slow);
    } else if (autoSlow) {
      const seg = node('speed', 'span', 'rc-cb-seg slow auto', '', autoSlow.t0, autoSlow.t1,
        'The kill shot slows itself here (bullet time). Drag it or its ends to make it your own; right-click for how much');
      seg.append(el('b', '', `Bullet time · auto`));
      this.bindSlow(grips(seg), autoSlow, { own: false });
    } else {
      node('speed', 'span', 'rc-cb-seg plain', 'normal speed · drag here to slow a stretch down', span.t0, span.t1);
    }
    if (!this.pop.hidden && this.popKind === 'export') this.fillPop();
  }

  /** The + at the playhead: shown inside the clip while it is paused and the
   *  playhead is not on a keyframe already. */
  placePin(t, span) {
    const creator = this.creator;
    const inside = t >= span.t0 - 1e-3 && t <= span.t1 + 1e-3;
    const onKey = creator.keys.some(k => Math.abs(k.t - t) < 0.03);
    const show = inside && !onKey && !creator.player.playing && !creator.ui.timeline.scrubbing;
    if (this.pin.hidden === show) this.pin.hidden = !show;
    if (!show) return;
    const at = this.pct(t);
    if (this.pin.style.left !== at) this.pin.style.left = at;
  }

  /** A keyframe's diamond: a click looks through it, a drag moves it. */
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
        } catch (error) { console.warn('creator: a keyframe', error); }
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

/** Export's frames: the creator's frame guide (`prefs.frame`), which the
 *  recording is cropped to. */
export const EXPORT_FRAMES = Object.freeze([
  ['none', 'Full view · YouTube'],
  ['916', '9:16 · Shorts'],
  ['239', '2.39:1 · cinema'],
  ['185', '1.85:1'],
]);

function injectStyle() {
  if (document.getElementById('rc-cb-style')) return;
  const style = el('style');
  style.id = 'rc-cb-style';
  style.textContent = STYLE;
  document.head.appendChild(style);
}

const STYLE = `
/* The clip editor: the round's timeline gives way to the clip alone. */
.rp-root.rc-editing { --rp-bar-h: 176px; }
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
.rc-cb-play { min-width: 58px; justify-content: center; }
.rc-cb-export, .rc-cb-export:hover { border-color: var(--rp-gold); background: var(--rp-gold); color: #17150f; }
.rc-cb-export:hover { filter: brightness(1.12); }
.rp-root.rc-pop-open .rp-bar { z-index: 5; }
.rc-cb-export.on { background: #c9352a; border-color: #ff7a6e; color: #fff; }
.rc-cb-back { border-color: var(--rp-gold); color: var(--rp-gold); }
.rc-cb-hint { margin: 3px 0 0 54px; color: var(--rp-muted); font: 800 9px var(--rp-font); letter-spacing: .1em; text-transform: uppercase; opacity: .8; }
.rc-cb-body { display: grid; grid-template-columns: 54px minmax(0, 1fr); margin-top: 3px; }
.rc-cb-legend { display: grid; grid-template-rows: 13px 20px 20px 24px; padding-top: 2px; }
.rc-cb-legend span { color: var(--rp-muted); font: 800 9px/20px var(--rp-font); letter-spacing: .12em; text-transform: uppercase; cursor: help; }
.rc-cb-legend span:last-child { line-height: 24px; }
.rc-cb-strip { position: relative; height: 80px; border-radius: 4px; background: rgba(0, 0, 0, .32); cursor: pointer; touch-action: none; }
/* The lanes, one under the other, the time along the top. */
.rc-cb-ticks { position: absolute; left: 0; right: 0; top: 0; height: 13px; pointer-events: none; }
.rc-cb-ticks i { position: absolute; top: 9px; width: 1px; height: 71px; background: rgba(255, 255, 255, .06); }
.rc-cb-ticks i.major { background: rgba(255, 255, 255, .13); }
.rc-cb-ticks i[data-label]::after { content: attr(data-label); position: absolute; top: -9px; left: 3px;
  color: var(--rp-muted); font: 9px var(--rp-mono); white-space: nowrap; }
.rc-cb-lane { position: absolute; left: 0; right: 0; pointer-events: none; }
.rc-cb-lane > * { pointer-events: auto; }
.rc-cb-events { top: 15px; height: 18px; }
.rc-cb-camera { top: 35px; height: 18px; border-top: 1px solid rgba(255, 255, 255, .05); }
.rc-cb-speed { top: 55px; height: 24px; border-top: 1px solid rgba(255, 255, 255, .05); }
.rc-cb-ctx { position: absolute; top: 0; bottom: 0; pointer-events: none;
  background: repeating-linear-gradient(135deg, rgba(0, 0, 0, .35) 0 6px, rgba(0, 0, 0, .15) 6px 12px); }
.rc-cb-band { position: absolute; top: 0; bottom: 0; background: rgba(232, 195, 90, .08); pointer-events: none; }
.rc-cb-action { position: absolute; bottom: 0; height: 3px; background: var(--rp-gold); opacity: .85; border-radius: 2px; }
.rc-cb-h { position: absolute; top: -3px; bottom: -3px; width: 6px; margin-left: -3px; border-radius: 3px; background: var(--rp-gold);
  cursor: ew-resize; touch-action: none; box-shadow: 0 0 0 1px rgba(0, 0, 0, .5); z-index: 2; }
.rc-cb-h::after { content: ''; position: absolute; inset: 0 -8px; }
.rc-cb-grip { position: absolute; top: -4px; height: 6px; border-radius: 3px; z-index: 2; background: var(--rp-gold);
  cursor: grab; touch-action: none; box-shadow: 0 0 0 1px rgba(0, 0, 0, .5); }
.rc-cb-grip:hover { filter: brightness(1.2); }
.rc-cb-grip:active { cursor: grabbing; }
.rc-cb-grip::after { content: ''; position: absolute; inset: -4px 0 -3px; }
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
  font: 700 9px/14px var(--rp-font); letter-spacing: .08em; text-transform: uppercase; white-space: nowrap; text-overflow: ellipsis;
  pointer-events: none; }
.rc-cb-seg.auto { background: rgba(110, 170, 220, .1); box-shadow: inset 0 0 0 1px rgba(110, 170, 220, .55); color: var(--rp-ink); }
.rc-cb-seg.plain { background: rgba(255, 255, 255, .05); color: var(--rp-muted); }
.rc-cb-seg.hold { background: rgba(232, 195, 90, .1); color: var(--rp-muted); }
.rc-cb-seg.move { padding: 0 11px; background: linear-gradient(90deg, rgba(232, 195, 90, .55), rgba(232, 195, 90, .3)); color: #17150f; }
.rc-cb-seg.move.m-cut { background: linear-gradient(90deg, rgba(232, 195, 90, .12) 0 calc(100% - 3px), var(--rp-gold) calc(100% - 3px)); color: var(--rp-ink); }
.rc-cb-seg.move.m-whip { background: linear-gradient(90deg, rgba(232, 195, 90, .12) 0 55%, rgba(232, 195, 90, .7)); color: var(--rp-ink); }
.rc-cb-seg.end { padding: 0 11px; background: linear-gradient(90deg, rgba(232, 195, 90, .45), rgba(232, 195, 90, .12)); color: var(--rp-ink); }
.rc-cb-camera .rc-cb-seg { display: flex; align-items: center; gap: 4px; }
.rc-cb-camera .rc-cb-seg span { overflow: hidden; text-overflow: ellipsis; }
.rc-cb-icon { flex: none; width: 12px; height: 12px; fill: none; stroke: currentColor; stroke-width: 2.4; stroke-linecap: round; stroke-linejoin: round; }
.rc-cb-item .rc-cb-icon { width: 16px; height: 16px; stroke-width: 2; color: var(--rp-gold); }
.rc-cb-pop-head { padding: 6px 9px 2px; color: var(--rp-muted); font: 800 9px var(--rp-font); letter-spacing: .12em; text-transform: uppercase; }
.rc-cb-speed .rc-cb-seg { top: 2px; height: 20px; line-height: 20px; }
.rc-cb-speed .rc-cb-seg.plain { background: none; opacity: .7; }
.rc-cb-seg.slow { overflow: visible; padding: 0 14px; background: rgba(110, 170, 220, .5); color: #fff; pointer-events: auto;
  cursor: grab; touch-action: none; }
.rc-cb-seg.slow b { display: block; overflow: hidden; text-overflow: ellipsis; font-weight: 800; pointer-events: none; }
.rc-cb-seg.slow:hover { filter: brightness(1.15); }
.rc-cb-seg.slow.held { cursor: grabbing; filter: brightness(1.25); box-shadow: 0 0 0 1px #fff; }
.rc-cb-seg.slow.auto { background: rgba(110, 170, 220, .18); box-shadow: inset 0 0 0 1px rgba(110, 170, 220, .75); color: var(--rp-ink); }
.rc-cb-seg.slow.painting { background: rgba(110, 170, 220, .25); box-shadow: inset 0 0 0 1px rgba(110, 170, 220, .8); }
/* A slow stretch's ends: wide grips, inside and a little outside the bar. */
.rc-cb-slowgrip { position: absolute; top: -2px; bottom: -2px; width: 14px; cursor: ew-resize; touch-action: none; }
.rc-cb-slowgrip.in { left: -5px; }
.rc-cb-slowgrip.out { right: -5px; }
.rc-cb-slowgrip::after { content: ''; position: absolute; top: 4px; bottom: 4px; left: 5px; width: 4px; border-radius: 2px; background: rgba(255, 255, 255, .85); }
.rc-cb-speed { cursor: crosshair; }
.rc-cb-key { position: absolute; top: 1px; width: 16px; height: 16px; margin-left: -8px; padding: 0; border: 0; background: none;
  cursor: grab; touch-action: none; z-index: 1; }
.rc-cb-key::before { content: ''; position: absolute; inset: 2px; transform: rotate(45deg); background: #17150f; border: 1.5px solid var(--rp-gold); }
.rc-cb-key b { position: relative; color: var(--rp-gold); font: 800 9px/16px var(--rp-font); }
.rc-cb-key:hover::before { background: var(--rp-gold); }
.rc-cb-key:hover b { color: #17150f; }
.rc-cb-key.out { opacity: .45; }
/* The +, riding the playhead on the camera lane: a keyframe here. */
.rc-cb-pin { position: absolute; top: 34px; width: 20px; height: 20px; margin-left: -10px; padding: 0; border: 1.5px solid var(--rp-gold);
  border-radius: 50%; background: #17150f; color: var(--rp-gold); font: 800 14px/16px var(--rp-font); text-align: center;
  cursor: pointer; z-index: 4; box-shadow: 0 2px 8px rgba(0, 0, 0, .6); }
.rc-cb-pin:hover, .rc-cb-pin:focus-visible { background: var(--rp-gold); color: #17150f; outline: none; }
.rc-cb-pin[hidden] { display: none; }
/* The right-click chooser, and Export's. */
.rc-cb-pop { position: absolute; bottom: calc(100% + 6px); z-index: 6; display: flex; flex-direction: column; gap: 1px; padding: 5px;
  min-width: 220px; background: var(--rp-plate-menu); border: 1px solid var(--rp-edge); border-radius: 6px; box-shadow: 0 8px 24px rgba(0, 0, 0, .55); }
.rc-cb-pop[hidden] { display: none; }
.rc-cb-pop-title { padding: 5px 8px 4px; color: var(--rp-gold); font: 800 10px var(--rp-font); letter-spacing: .14em; text-transform: uppercase; white-space: nowrap; }
.rc-cb-item { display: flex; align-items: center; gap: 8px; min-height: 30px; padding: 0 9px; border: 0; border-radius: 4px; background: none;
  color: var(--rp-ink); font: 12px var(--rp-font); text-align: left; white-space: nowrap; cursor: pointer; }
.rc-cb-item:hover, .rc-cb-item:focus-visible { background: rgba(255, 255, 255, .08); outline: none; }
.rc-cb-item.rule { margin-top: 4px; box-shadow: 0 -1px 0 var(--rp-edge); border-radius: 0 0 4px 4px; }
.rc-cb-item span { flex: 1; }
.rc-cb-item kbd { color: var(--rp-muted); font: 10px var(--rp-mono); }
.rc-cb-mark { width: 12px; color: var(--rp-gold); font-style: normal; }
.rc-cb-item.rec .rc-cb-mark::before { content: ''; display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #ff5b4d; }
.rc-cb-pop-note { margin: 4px 8px 3px; max-width: 250px; color: var(--rp-muted); font: 11px/1.35 var(--rp-font); white-space: normal; }
@container rp-bar (max-width: 610px) { .rc-cb-where, .rc-cb-hint { display: none; } .rc-cb-body { grid-template-columns: 0 minmax(0, 1fr); } .rc-cb-legend { visibility: hidden; } }
`;
