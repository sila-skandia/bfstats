// The clip editor (features/replay-creator-view, "The clip editor"): while a
// clip is being worked on, the round's timeline gives way to a strip of the
// clip alone and a few seconds either side of it. The clip is the recording
// for as long as it is open -- its ends drag with room to grow, the shot and
// the kill it is of are marked, its cameras and its slow motion sit on it, and
// the playhead loops inside it. Back to the round puts the playhead, the man
// followed and the camera back where they were.
//
// The strip is laid out in the seconds of the video the clip makes, not the
// seconds of the round ("Cameras on the strip"): a kill shot's bullet time
// turns a tenth of a second of the round into two and a half of video, and
// that flight is where the cameras change. Slow motion takes the room it
// takes on screen; the clip's own clock (replay-clipclock.js) maps one to the
// other.
//
// The lanes, each named in a legend at its left: CLIP (the shot, the kill,
// the action between), CAMERA (the clip's cameras as blocks, each handing
// over to the next at a gold line: a cut, a glide or a whip), SPEED (where
// the clip runs slowly), and in the studio TEXT and FX.
//
// One grammar on every lane (features/replay-creator-view, "Keyframes on the
// strip"): a press goes there and a drag scrubs, a drag on a thing moves it,
// a right-click (a long press on touch) offers what can be done to whatever
// is under it. A click on a camera opens its chooser: pick another camera,
// place your own, how it moves, how it takes over. The studio's tray drops
// cameras, slow motion, text and effects onto the lanes (`dragOver`). The
// header is Studio, Play, Export and Done.

import { fmt } from './replay-creator-panel.js';
import { nameAt } from './replay-recording.js';
import { RAMP_SPEEDS, rampSpanOf, speedWord } from './replay-shot.js';
import { isMelee } from './replay-shotstyle.js';
import { FRAMES, TEXT_EASE, lowerStart } from './replay-studio-fx.js';
import {
  AB_MOVES, CAM_MIN, HAND_OVERS, HAND_OVER_LEN, MOTIONS, abMoveLabel, anchorAt, camGlyph, camLabel, camTitle, camsFor, handOverLabel, holdsEnd,
  motionLabel,
} from './replay-cuts.js';

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
/** Pixels a press may wander and still be a click. */
const CLICK_SLOP = 5;

/**
 * The Camera lane as drawn: `[{ i, cam, t0, t1, label, sub, glyph, into }]`
 * for the clip's cameras with their stretches (replay-cuts.js
 * `resolveCams`). `sub` says how one of yours moves.
 */
export function camLane(list) {
  return list.map(c => ({
    i: c.i, cam: c.cam, t0: c.t0, t1: c.t1, label: camLabel(c.cam), glyph: camGlyph(c.cam),
    sub: c.cam === 'placed'
      ? (c.end ? `${abMoveLabel(c.move)} to its end camera${holdsEnd(c) ? ', then holds' : ''}` : motionLabel(c.motion)) : 'automatic',
    into: c.i > 0 ? c.into ?? 'cut' : null, end: Boolean(c.end), tEnd: c.end ? c.tEnd ?? c.t1 : null,
  }));
}

/** Where on camera `c`'s block (camLane) its end camera sits, a share of
 *  the block in seconds of the video (`sx`): 1 at its end. */
export function endShare(c, sx) {
  const w = sx(c.t1) - sx(c.t0);
  if (!(w > 1e-6) || !Number.isFinite(c.tEnd)) return 1;
  return Math.min(1, Math.max(0, (sx(c.tEnd) - sx(c.t0)) / w));
}

/** The end camera's icon's place on its block: its right edge at `share`,
 *  never over the camera's own icon at the block's start. */
const endLeft = share => `max(${(share * 100).toFixed(3)}%, 60px)`;

/** What an end camera dragged to `at` is reached at, in words. */
export function endWords(at) {
  return at ? `End camera ${handOverWords(at).replace(/^./, ch => ch.toLowerCase())}, then held` : 'End camera as its part ends';
}

/** What a hand-over is kept at, in words, for the line being dragged. */
export function handOverWords(at) {
  if (!at) return 'From the clip\'s start';
  const s = v => `${Math.abs(v).toFixed(2)} s`;
  switch (at.ev) {
    case 'shot': return Math.abs(at.dt) < 1e-3 ? 'On the shot' : at.dt < 0 ? `${s(at.dt)} before the shot` : `${s(at.dt)} after the shot`;
    case 'flight': return `${Math.round(at.p * 100)}% of the way to the victim`;
    case 'hit': return Math.abs(at.dt) < 1e-3 ? 'As the round hits' : `${s(at.dt)} into the hit`;
    case 'down': return Math.abs(at.dt) < 1e-3 ? 'As the victim goes down' : `${s(at.dt)} after the victim goes down`;
    default: return 'At this moment of the round';
  }
}

/**
 * The glyphs that say what a camera does, drawn in a 24 x 24 box with the
 * current colour's stroke: the cameras (`cam:<id>`, the round ones by their
 * shot style, `style:<id>`), how one hands over (cut, glide, whip), how one
 * of yours moves, and the tray's slow motion, text and effects.
 */
export const MOVE_ICONS = Object.freeze({
  glide: 'M3 12h16M14 7l5 5-5 5',
  orbit: 'M4 17a8 8 0 0 1 16 0M17 14l3 3 3-3',
  orbit360: 'M19 12a7 7 0 1 1-2.05-4.95M17 3v4.2h4.2',
  whip: 'M8 12h13M16 7l5 5-5 5M2 8h5M3 12h3M2 16h5',
  cut: 'M3 6h7v12H3zM14 6h7v12h-7z',
  hold: 'M5 6h14v12H5zM10 10v4M14 10v4',
  still: 'M5 6h14v12H5zM10 10v4M14 10v4',
  track: 'M12 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0M12 2v4M12 18v4M2 12h4M18 12h4',
  spin: 'M3 15a9 4 0 1 0 18 0a9 4 0 1 0-18 0M12 5v10',
  push: 'M9 9h6v6H9zM2 2l5 5M22 2l-5 5M2 22l5-5M22 22l-5-5',
  pull: 'M9 9h6v6H9zM7 7 2 2M17 7l5-5M7 17l-5 5M17 17l5 5M2 6V2h4M18 2h4v4M2 18v4h4M22 18v4h-4',
  crane: 'M12 19V4M7 9l5-5 5 5M4 21h16',
  'style:chase': 'M2 12h11M9 8l4 4-4 4M19 12m-2.5 0a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0',
  'style:orbit': 'M12 12m-2.5 0a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0M4 12a8 8 0 1 0 2.4-5.7M6 2v4.5h4.5',
  'style:side': 'M3 8h14M13 4l4 4-4 4M3 18h3M9 18h3M15 18h3',
  'style:reverse': 'M22 12H10M14 8l-4 4 4 4M4.5 12m-2.5 0a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0',
  'style:fixed': 'M3 7h12v10H3zM15 10l6-3v10l-6-3',
  'cam:placed': 'M3 7h12v10H3zM15 10l6-3v10l-6-3M9 12m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0',
  'cam:eyes': 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0',
  'cam:shoulder': 'M14 7m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0M8 21v-4a6 6 0 0 1 12 0v4M2 9h6M5 6l3 3-3 3',
  'cam:front': 'M10 7m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0M4 21v-4a6 6 0 0 1 12 0v4M22 9h-5M19 6l-3 3 3 3',
  'cam:victim': 'M12 16m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0M3 10a9 5 0 0 1 18 0M18 7l3 3-3 3',
  'cam:free': 'M3 6h18v12H3zM8 21h8M12 18v3',
  // The game's cameras: a hull, and the camera behind it, ahead of it, or on
  // a tripod beside its path.
  'cam:gamechase': 'M12 11h9v5h-9zM14 11V9h4v2M2 9h5v4H2zM7 11l3-1v2z',
  'cam:gamefront': 'M3 11h9v5H3zM6 11V9h4v2M17 9h5v4h-5zM17 11l-3-1v2z',
  'cam:gameflyby': 'M2 18h11M9 15l4 3-4 3M17 4h5v4h-5zM17 6l-3-1v2zM19.5 8 18 14M19.5 8l1.5 6',
  'fx:fadein': 'M3 20 21 4v16z',
  'fx:fadeout': 'M3 4l18 16H3z',
  'fx:kill': 'M12 2v6M12 16v6M2 12h6M16 12h6M5 5l3.5 3.5M15.5 15.5 19 19M19 5l-3.5 3.5M8.5 15.5 5 19',
  'fx:slow': 'M12 13m-8 0a8 8 0 1 0 16 0a8 8 0 1 0-16 0M12 13V9M9 2h6',
  'fx:freeze': 'M12 2v20M3.3 7l17.4 10M3.3 17 20.7 7M9 4l3 3 3-3M9 20l3-3 3 3',
  'fx:flash': 'M13 2 4 14h7l-1 8 9-12h-7z',
  'fx:punch': 'M4 4h5M4 4v5M20 4h-5M20 4v5M4 20h5M4 20v-5M20 20h-5M20 20v-5M12 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0',
  'fx:shake': 'M9 4l-4 8 4 8M15 4l4 8-4 8',
  'txt:title': 'M5 5h14M12 5v14M8 19h8',
  'txt:lower': 'M3 15h18v5H3zM3 11h10',
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
    this.clock = null;
    this.sig = '';
    this.menu = null;              // { title, items } for the chooser
    this.camEls = [];              // the Camera lane's blocks, by camera
    injectStyle();
    const bar = el('div', 'rc-cb');
    bar.hidden = true;
    const head = el('div', 'rc-cb-head');
    this.title = el('span', 'rc-cb-title', 'Clip');
    this.clock_ = el('span', 'rc-cb-clock');
    this.where = el('span', 'rc-cb-where');
    this.playBtn = this.button('Play', 'Play the clip from its start, looping (P); Pause holds it', () => {
      const player = creator.player;
      if (player.playing) {
        player.playing = false;
        creator.rangePlaying = false;
      } else if (creator.part) creator.startPart();
      else creator.playRange();
      this.sync(player.time, true);
    }, 'rc-cb-play');
    this.exportBtn = this.button('Export', 'The frame to record in, record the clip, keep it', () => {
      if (!this.pop.hidden && this.popKind === 'export') this.closePop();
      else this.openPop('export', 100);
    }, 'rc-cb-export');
    const done = this.button('Done', 'Close the clip and go back to where you were in the round (Esc)', () => creator.closeEditor(), 'rc-cb-back');
    const studio = this.button('Studio', 'Edit the clip full screen: cameras, look, text, effects and export', () => creator.studio?.toggle(), 'rc-cb-studio');
    head.append(this.title, this.clock_, this.where, el('span', 'rc-cb-gap'), studio, this.playBtn, this.exportBtn, done);

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
      // The studio's: the text over the footage, and the effects.
      text: el('div', 'rc-cb-lane rc-cb-text'),
      fx: el('div', 'rc-cb-lane rc-cb-fx'),
    };
    this.knob = el('div', 'rc-cb-knob');
    // The chooser a click on a camera or a right-click opens, and Export's.
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
    this.grip.title = 'Drag to slide the whole clip earlier or later: its cameras and slow motion go with it';
    // Where a drag snapped to (`snap`), and where a drop from the tray lands.
    this.snapLine = el('i', 'rc-cb-snap');
    this.snapLine.hidden = true;
    this.dropLine = el('div', 'rc-cb-drop');
    this.dropLine.hidden = true;
    this.dropTip = el('span', 'rc-cb-droptip');
    this.dropLine.append(this.dropTip);
    // The words over a hand-over being dragged.
    this.tip = el('span', 'rc-cb-tip');
    this.tip.hidden = true;
    // A part of the clip playing over and over, and the way back to all of it.
    this.partBand = el('div', 'rc-cb-part');
    this.partBand.hidden = true;
    this.partPill = el('span', 'rc-cb-partpill');
    this.partWords = el('span', '', '');
    const whole = el('button', 'rc-cb-partall', 'Whole clip');
    whole.type = 'button';
    whole.title = 'Stop looping this part and play the whole clip (Esc stops it)';
    whole.addEventListener('pointerdown', e => e.stopPropagation());
    whole.addEventListener('click', e => {
      e.stopPropagation();
      try { creator.stopPart(); } catch (error) { console.warn('creator: a part', error); }
      this.sync(creator.player.time, true);
    });
    this.partPill.append(this.partWords, whole);
    this.partBand.append(this.partPill);
    strip.append(this.ticks, this.ctxL, this.ctxR, this.band, this.partBand, ...Object.values(this.lanes), this.inH, this.outH, this.grip, this.knob,
      this.snapLine, this.dropLine, this.tip);
    this.strip = strip;
    // The legend: what each lane is.
    const legend = el('div', 'rc-cb-legend');
    for (const [label, title] of [
      ['', ''],
      ['Clip', 'The clip and what happens in it. Drag its ends to trim, its top rail to slide it; right-click for more'],
      ['Camera', 'What films each part of the clip. Click a camera to pick another or place your own; drag the gold line between two to move the change'],
      ['Speed', 'Where the clip plays slowly. Drag across the lane to slow a stretch; right-click it for how slow'],
      ['Text', 'The title and the lower third over the footage. Drag to move them, their ends to resize; right-click to add'],
      ['FX', 'Fades, the flash, the zoom punch, the shake and the freeze on the kill. Right-click to switch them'],
    ]) {
      const l = el('span', label === 'Text' || label === 'FX' ? 'st-only' : label === 'Camera' ? 'cam' : '', label);
      l.title = title;
      legend.append(l);
    }
    const body = el('div', 'rc-cb-body');
    body.append(legend, strip);
    this.hint = el('p', 'rc-cb-hint', 'Click a camera to change it · drag the line between two · right-click for more');
    bar.append(head, body, this.hint, this.pop);
    this.el = bar;
    this.bindScrub();
    this.bindMenu();
    this.bindWheel();
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

  // --- the strip's clock: seconds of the video ----------------------------------------------

  /** Seconds of the video at round time `t` (the clip's clock); outside the
   *  clip, the round's own. */
  sx(t) {
    return this.clock ? this.clock.toScreen(t) : t;
  }

  /** Round time at `s` seconds of the video. */
  rt(s) {
    return this.clock ? this.clock.toRound(s) : s;
  }

  /** `t`'s place along the strip, 0 to 1 (not held to it). */
  at(t) {
    const { w0, w1 } = this.window;
    const a = this.sx(w0);
    return (this.sx(t) - a) / Math.max(1e-6, this.sx(w1) - a);
  }

  pct(t) {
    return `${clamp(this.at(t) * 100, 0, 100)}%`;
  }

  /** The width from `t0` to `t1`, as a share of the strip, held inside it. */
  widthOf(t0, t1) {
    const a = clamp(this.at(t0), 0, 1);
    const b = clamp(this.at(t1), 0, 1);
    return `${Math.max(0, b - a) * 100}%`;
  }

  timeAt(clientX) {
    const r = this.strip.getBoundingClientRect();
    const { w0, w1 } = this.window;
    const a = this.sx(w0);
    const b = this.sx(w1);
    const s = a + clamp((clientX - r.left) / Math.max(1, r.width), 0, 1) * (b - a);
    return clamp(this.rt(s), w0, w1);
  }

  // --- the chooser -------------------------------------------------------------------------

  closePop() {
    this.pop.hidden = true;
    this.popKind = null;
    this.menu = null;
    this.creator.ui?.root?.classList.remove('rc-pop-open');
  }

  /** Open the chooser: `menu` (`this.menu`) or `export`, over the strip at
   *  `x` (a percentage of it). */
  openPop(kind, x) {
    this.popKind = kind;
    this.popX = x;
    this.pop.hidden = false;
    // Over the creator's panel, which comes later in the page.
    this.creator.ui?.root?.classList.add('rc-pop-open');
    this.fillPop();
  }

  /** The chooser for whatever is at `clientX`, `clientY`. */
  openMenuAt(clientX, clientY, target = null) {
    const menu = this.menuAt(clientX, clientY, target);
    if (!menu) return;
    this.openMenu(menu, clientX);
  }

  openMenu(menu, clientX) {
    this.openMenuOn(menu, this.timeAt(clientX));
  }

  /** `menu` opened over moment `t` of the strip. */
  openMenuOn(menu, t) {
    if (!menu) return;
    this.menu = menu;
    this.creator.ui.activity?.();
    this.openPop('menu', this.at(t) * 100);
  }

  /** `{ title, items }` for a right-click: which lane, which thing on it. */
  menuAt(clientX, clientY, target) {
    const creator = this.creator;
    const span = creator.span;
    if (!span) return null;
    const t = this.timeAt(clientX);
    const lane = this.laneAt(clientY);
    const rel = this.sx(t) - this.sx(span.t0);
    const at = `${rel < 0 ? '-' : '+'}${fmt(Math.abs(rel))}`;
    const item = (label, run, { on = false, rule = false, key = '' } = {}) => ({ label, run, on, rule, key });
    const inside = t >= span.t0 - 1e-3 && t <= span.t1 + 1e-3;
    if (lane === 'camera') {
      if (!inside) {
        return { title: 'Outside the clip', items: [item(t < span.t0 ? 'Start the clip here' : 'End the clip here', () => creator.setEnd(t < span.t0 ? 'in' : 'out', t))] };
      }
      const cut = target?.closest?.('.rc-cb-cut');
      if (cut) return this.handOverMenu(Number(cut.dataset.i));
      return this.newCamMenu(t);
    }
    if (lane === 'text') {
      const e = creator.edits;
      const tt = t - span.t0;
      const onTitle = e.title.on && tt >= e.title.t - 0.05 && tt <= e.title.t + e.title.dur + 0.05;
      const ls = lowerStart(e, span, creator.fxKill.shot);
      const onLower = e.lower.on && tt >= ls - 0.05 && tt <= ls + e.lower.dur + 0.05;
      if (onTitle || onLower) {
        const which = onTitle ? 'title' : 'lower';
        return {
          title: onTitle ? 'Title' : 'Lower third',
          items: [
            item('Edit its words', () => creator.studio?.focus(which)),
            item('Remove', () => creator.setEdit(`${which}.on`, false), { rule: true }),
          ],
        };
      }
      return {
        title: `Text · ${at}`,
        items: [
          item('Add a title here', () => creator.addText('title', t)),
          item('Add a lower third here', () => creator.addText('lower', t)),
        ],
      };
    }
    if (lane === 'fx') {
      const e = creator.edits;
      const kill = creator.fxKill.kill;
      const toggle = (label, path, on, value) => item(label, () => creator.setEdit(path, on ? (typeof value === 'number' ? 0 : false) : value), { on });
      return {
        title: kill === null ? 'Effects · the clip has no kill' : 'Effects',
        items: [
          toggle('Fade in from black', 'fadeIn', e.fadeIn > 0, 0.5),
          toggle('Fade out to black', 'fadeOut', e.fadeOut > 0, 1),
          ...(kill === null ? [] : [
            { ...toggle('Flash as the round hits', 'flash', e.flash, true), rule: true },
            toggle('Zoom punch on the hit', 'punch', e.punch, true),
            toggle('Shake on the hit', 'shake', e.shake, true),
            toggle('Freeze on the hit (1 s)', 'freeze', e.freeze > 0, 1),
          ]),
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

  /** Camera `i`'s chooser: the cameras it can be (one of yours placed
   *  first), how one of yours moves, how it takes over, split it at `t`,
   *  take it away. */
  camMenu(i, t) {
    const creator = this.creator;
    const span = creator.span;
    const list = creator.camStretches(span);
    const c = list[i];
    if (!c) return null;
    const take = creator.autoFilms(span) ? creator.takeInside(span) : null;
    const s0 = this.sx(c.t0) - this.sx(span.t0);
    const s1 = this.sx(c.t1) - this.sx(span.t0);
    const items = [
      { cards: camsFor(take).map(id => ({ label: camLabel(id), title: camTitle(id), icon: camGlyph(id), on: c.cam === id,
        run: () => creator.setCamAt(i, id) })) },
    ];
    items.push({ chips: [
      { label: c.cam === 'placed' ? 'Set its camera' : 'Set the camera', title: 'Fly it where you want it and Use this view: it becomes your camera',
        icon: 'cam:placed', run: () => creator.placeCam(i, { which: 'start' }) },
      { label: c.end ? 'Set its end camera' : 'Add an end camera', title: 'A second view it moves to over its part',
        icon: 'glide', run: () => creator.placeCam(i, { which: 'end' }) },
      { label: 'Loop it', title: 'Play this camera\'s part over and over', icon: 'orbit360', run: () => creator.loopPart({ kind: 'cam', i }) },
    ] });
    if (c.cam === 'placed' && c.end) {
      items.push({ heading: true, label: 'To its end camera' });
      items.push({ chips: AB_MOVES.map(([id, label, title]) => ({ label, title, icon: id, on: (c.move ?? 'glide') === id,
        run: () => creator.setAbMoveAt(i, id) })) });
      items.push({ label: 'No end camera: hold its camera', run: () => creator.removeEndAt(i), icon: 'still' });
    } else if (c.cam === 'placed') {
      items.push({ heading: true, label: 'How it moves' });
      items.push({ chips: MOTIONS.map(([id, label, title]) => ({ label, title, icon: id, on: (c.motion ?? 'still') === id,
        run: () => creator.setMotionAt(i, id) })) });
    }
    if (i > 0) {
      items.push({ heading: true, label: `How it takes over from ${camLabel(list[i - 1].cam)}` });
      items.push({ chips: HAND_OVERS.map(([id, label, title]) => ({ label, title, icon: id, on: (c.into ?? 'cut') === id,
        run: () => creator.setHandOverAt(i, id) })) });
    }
    const inside = Number.isFinite(t) && t > c.t0 + CAM_MIN && t < c.t1 - CAM_MIN;
    if (inside) items.push({ label: 'Split it here', title: 'A second camera from here on: click it to pick what it films', run: () => creator.splitCamAt(t), icon: 'cut', rule: true });
    if (list.length > 1) items.push({ label: 'Take it away', run: () => creator.removeCamAt(i), rule: !inside });
    return { title: `Camera ${i + 1} · ${fmt(Math.max(0, s0))} to ${fmt(Math.max(0, s1))}`, items, wide: true };
  }

  /** A right-click on the Camera lane at `t`: a new camera from there (the
   *  one filming it is cut there and the new one films on to the next
   *  hand-over), or the camera under the pointer changed, looped or taken
   *  away. Close to a camera's start, the cards swap that camera instead. */
  newCamMenu(t) {
    const creator = this.creator;
    const span = creator.span;
    const list = creator.camStretches(span);
    if (!list.length) return null;
    let i = list.findIndex(c => t >= c.t0 - 1e-6 && t < c.t1);
    if (i < 0) i = list.length - 1;
    const c = list[i];
    const take = creator.autoFilms(span) ? creator.takeInside(span) : null;
    const at = Math.min(t, span.t1 - 0.05);
    const swap = at - c.t0 <= CAM_MIN;
    const rel = Math.max(0, this.sx(at) - this.sx(span.t0));
    const items = [
      { heading: true, label: swap ? `Camera ${i + 1} becomes` : `A new camera from ${fmt(rel)}, after ${camLabel(c.cam)}` },
      { cards: camsFor(take).map(id => ({ label: camLabel(id), title: camTitle(id), icon: camGlyph(id), on: swap && c.cam === id,
        run: () => creator.addCamAt(at, id) })) },
      { heading: true, label: `Camera ${i + 1} · ${camLabel(c.cam)}` },
      { chips: [
        { label: 'Change it', title: 'Its chooser: what it films, how it moves and takes over', icon: camGlyph(c.cam),
          run: () => this.openMenuOn(this.camMenu(i, t), t) },
        { label: 'Loop it', title: 'Play this camera\'s part over and over', icon: 'orbit360', run: () => creator.loopPart({ kind: 'cam', i }) },
        ...(list.length > 1 ? [{ label: 'Take it away', title: 'The camera before films on in its place', run: () => creator.removeCamAt(i) }] : []),
      ] },
    ];
    return { title: `Camera lane · ${fmt(rel)}`, items, wide: true };
  }

  /** The hand-over into camera `i`: a cut, a glide or a whip. */
  handOverMenu(i) {
    const creator = this.creator;
    const list = creator.camStretches();
    const c = list[i];
    if (!c || i < 1) return null;
    return {
      title: `${camLabel(list[i - 1].cam)} to ${camLabel(c.cam)} · ${handOverWords(c.at)}`,
      items: [
        ...HAND_OVERS.map(([id, label, title]) => ({ label, title, icon: id, on: (c.into ?? 'cut') === id, run: () => creator.setHandOverAt(i, id) })),
        { label: 'Loop it', title: 'Play this hand-over over and over', icon: 'orbit360', run: () => creator.loopPart({ kind: 'cut', i }), rule: true },
      ],
    };
  }

  fillPop() {
    const creator = this.creator;
    const pop = this.pop;
    pop.textContent = '';
    pop.classList.toggle('wide', Boolean(this.popKind === 'menu' && this.menu?.wide));
    const done = run => e => {
      e.stopPropagation();
      this.closePop();
      try { run(); } catch (error) { console.warn('creator: the clip menu', error); }
      this.sync(creator.player.time, true);
    };
    const entry = (label, on, run, { rule = false, key = '', cls = '', icon = null, title = '' } = {}) => {
      const b = el('button', `rc-cb-item${on ? ' on' : ''}${rule ? ' rule' : ''}${cls ? ` ${cls}` : ''}`);
      b.type = 'button';
      if (title) b.title = title;
      b.append(el('i', 'rc-cb-mark', on ? '✓' : ''));
      const glyph = moveIcon(icon);
      if (glyph) b.append(glyph);
      b.append(el('span', '', label));
      if (key) b.append(el('kbd', '', key));
      b.addEventListener('click', done(run));
      pop.append(b);
    };
    if (this.popKind === 'menu' && this.menu) {
      pop.append(el('b', 'rc-cb-pop-title', this.menu.title));
      for (const it of this.menu.items) {
        if (it.heading) pop.append(el('span', 'rc-cb-pop-head', it.label));
        else if (it.cards) {
          const grid = el('div', 'rc-cb-cards');
          for (const c of it.cards) {
            const b = el('button', `rc-cb-card${c.on ? ' on' : ''}`);
            b.type = 'button';
            b.title = c.title ?? '';
            const glyph = moveIcon(c.icon);
            if (glyph) b.append(glyph);
            b.append(el('span', '', c.label));
            b.addEventListener('click', done(c.run));
            grid.append(b);
          }
          pop.append(grid);
        } else if (it.chips) {
          const row = el('div', 'rc-cb-chips');
          for (const c of it.chips) {
            const b = el('button', `rc-cb-chip${c.on ? ' on' : ''}`);
            b.type = 'button';
            b.title = c.title ?? '';
            const glyph = moveIcon(c.icon);
            if (glyph) b.append(glyph);
            b.append(el('span', '', c.label));
            b.addEventListener('click', done(c.run));
            row.append(b);
          }
          pop.append(row);
        } else entry(it.label, it.on, it.run, { rule: it.rule, key: it.key, icon: it.icon, title: it.title });
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
      const secs = creator.screenLength();
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
    if (!span) return;
    this.clock = this.creator.timing(span)?.clock ?? null;
    this.window = clipWindow(span.t0, span.t1, this.creator.player.rec.duration);
  }

  /** The wheel over the strip zooms it round the pointer; Shift (or a
   *  sideways wheel) pans it, in seconds of the video. The zoom holds until
   *  the strip is fitted round the clip again (its ends moved, the clip
   *  slid). */
  bindWheel() {
    this.strip.addEventListener('wheel', e => {
      if (!this.window) return;
      e.preventDefault();
      e.stopPropagation();
      const d = this.creator.player.rec.duration;
      const lo = this.sx(0);
      const hi = this.sx(d);
      const a0 = this.sx(this.window.w0);
      const b0 = this.sx(this.window.w1);
      const span = b0 - a0;
      const pan = e.shiftKey ? e.deltaY || e.deltaX : Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : 0;
      let a;
      let b;
      if (pan) {
        const by = clamp((pan / 600) * span, lo - a0, hi - b0);
        a = a0 + by;
        b = b0 + by;
      } else {
        const at = this.sx(this.timeAt(e.clientX));
        const next = clamp(span * Math.exp(e.deltaY * 0.0015), 0.6, Math.max(0.6, hi - lo));
        a = at - (at - a0) * (next / span);
        b = a + next;
        if (a < lo) { b += lo - a; a = lo; }
        if (b > hi) { a -= b - hi; b = hi; }
      }
      this.window = { w0: clamp(this.rt(a), 0, d), w1: clamp(this.rt(b), 0, d) };
      this.sync(this.creator.player.time, true);
    }, { passive: false });
  }

  /** What a drag snaps to: the clip's ends, the shot, the hit, the man down,
   *  the hand-overs and the playhead. */
  snapMarks({ playhead = true } = {}) {
    const creator = this.creator;
    const span = creator.span;
    const m = creator.timing()?.moments;
    const marks = [span?.t0, span?.t1, m?.shot, m?.hit, m?.down, ...creator.camStretches().slice(1).map(c => c.t0)];
    if (playhead) marks.push(creator.player.time);
    return marks;
  }

  /** `t` snapped to what matters within a few pixels (`snapMarks`), less
   *  `skip`, the time being dragged from. Shows where it snapped. */
  snap(t, { skip = null, playhead = true, marks = null } = {}) {
    const w = this.strip.getBoundingClientRect().width || 1;
    const x = this.at(t) * w;
    let best = null;
    let bestD = 7;
    for (const m of marks ?? this.snapMarks({ playhead })) {
      if (!Number.isFinite(m) || (skip !== null && Math.abs(m - skip) < 1e-6)) continue;
      const d = Math.abs(this.at(m) * w - x);
      if (d <= bestD) {
        best = m;
        bestD = d;
      }
    }
    this.showSnap(best);
    return best ?? t;
  }

  showSnap(t) {
    const on = t !== null && t !== undefined;
    if (this.snapLine.hidden === on) this.snapLine.hidden = !on;
    if (on) this.snapLine.style.left = this.pct(t);
  }

  /** Which lane is at `clientY`. */
  laneAt(clientY) {
    for (const name of ['fx', 'text', 'speed', 'camera']) {
      const r = this.lanes[name].getBoundingClientRect();
      if (r.height > 0 && clientY >= r.top - 1) return name;
    }
    return 'events';
  }

  // --- the studio's tray -------------------------------------------------------------------

  /** A feature dragged from the studio's tray over `clientX`, `clientY`:
   *  the moment of the clip it would land at (snapped), the line drawn on
   *  its lane with `label`, or null off the strip. */
  dragOver(clientX, clientY, lane, label) {
    const span = this.creator.span;
    const r = this.strip.getBoundingClientRect();
    const over = span && this.window && clientX >= r.left - 4 && clientX <= r.right + 4 && clientY >= r.top - 40 && clientY <= r.bottom + 12;
    if (!over) {
      this.showDrop(null);
      this.showSnap(null);
      return null;
    }
    const t = clamp(this.snap(this.timeAt(clientX)), span.t0, span.t1);
    this.showDrop(t, lane, `${label} · ${fmt(Math.max(0, this.sx(t) - this.sx(span.t0)))}`);
    return t;
  }

  /** The drop line, on `lane`, or put away. */
  showDrop(t, lane = 'camera', text = '') {
    const on = t !== null && t !== undefined;
    this.dropLine.hidden = !on;
    if (!on) return;
    const l = this.lanes[lane] ?? this.lanes.camera;
    this.dropLine.style.left = this.pct(t);
    this.dropLine.style.top = `${l.offsetTop}px`;
    this.dropLine.style.height = `${l.offsetHeight}px`;
    this.dropTip.textContent = text;
    this.dropLine.classList.toggle('flip', this.at(t) > 0.7);
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
   *  for the round's bar; the clip's cameras film what is scrubbed to. A
   *  press on a camera that does not move is a click: its chooser opens. On
   *  the speed lane a drag paints a slow stretch instead. A touch held still
   *  opens the lane's menu. */
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
      if (Math.hypot(e.clientX - press.x, e.clientY - press.y) > CLICK_SLOP) {
        clearTimeout(press.timer);
        press.moved = true;
      }
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
        return;
      }
      timeline.scrubTo = this.timeAt(e.clientX);
      // A click on a camera: its chooser.
      if (!p.moved && p.cam !== null) {
        try {
          const menu = this.camMenu(p.cam, p.t0);
          if (menu) this.openMenu(menu, e.clientX);
        } catch (error) { console.warn('creator: a camera', error); }
      }
    };
    this.strip.addEventListener('pointerdown', e => {
      if (e.button !== 0 || this.dragging || e.target.closest('.rc-cb-h, .rc-cb-mk, .rc-cb-cut, .rc-cb-grip, .rc-cb-seg.slow, .rc-cb-seg.txt')) return;
      e.preventDefault();
      creator.ui.activity?.();
      this.closePop();
      const t = this.timeAt(e.clientX);
      const span = creator.span;
      const paint = this.laneAt(e.clientY) === 'speed' && span && t >= span.t0 && t <= span.t1;
      const camEl = e.target.closest('.rc-cb-cam');
      press = {
        x: e.clientX, y: e.clientY, mode: paint ? 'paint' : 'scrub', t0: t, t1: null, moved: false,
        cam: camEl ? Number(camEl.dataset.i) : null,
      };
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
        // The clip's cameras film the view as the playhead goes.
        try { creator.scrubPreview(); } catch (error) { console.warn('creator: the cameras', error); }
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

  /**
   * The hand-over into camera `c.i` dragged along: the line, the two cameras
   * either side of it and the words of what it is kept at (the shot, a share
   * of the round's flight, the hit, the man down) follow the pointer,
   * snapping to those moments; the drop keeps it. A press that does not move
   * opens how it takes over. The strip is not redrawn under the drag.
   */
  bindCut(cut, c, list) {
    const creator = this.creator;
    const strip = this.strip;
    cut.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();
      this.closePop();
      creator.ui.activity?.();
      const span = creator.span;
      const i = c.i;
      const lo = list[i - 1].t0 + CAM_MIN;
      const hi = (list[i + 1]?.t0 ?? span.t1) - CAM_MIN;
      const marks = this.snapMarks({ playhead: true }).filter(m => !(Number.isFinite(m) && Math.abs(m - c.t0) < 1e-6));
      const x0 = e.clientX;
      let t = c.t0;
      let moved = false;
      this.dragging = true;
      cut.classList.add('held');
      const moveIt = ev => {
        if (!moved && Math.abs(ev.clientX - x0) <= CLICK_SLOP) return;
        moved = true;
        t = clamp(this.snap(this.timeAt(ev.clientX), { marks }), lo, hi);
        cut.style.left = this.pct(t);
        const before = this.camEls[i - 1];
        const after = this.camEls[i];
        if (before) before.style.width = this.widthOf(list[i - 1].t0, t);
        if (after) {
          after.style.left = this.pct(t);
          after.style.width = this.widthOf(t, list[i].t1);
        }
        const m = creator.timing()?.moments;
        this.tip.hidden = false;
        this.tip.textContent = m ? handOverWords(anchorAt(t, m)) : '';
        this.tip.style.left = this.pct(t);
      };
      const up = ev => {
        moveIt(ev);
        strip.removeEventListener('pointermove', moveIt);
        strip.removeEventListener('pointerup', up);
        strip.removeEventListener('pointercancel', up);
        this.dragging = false;
        this.showSnap(null);
        this.tip.hidden = true;
        cut.classList.remove('held');
        try {
          if (moved) creator.moveHandOver(i, t);
          else {
            const menu = this.handOverMenu(i);
            if (menu) this.openMenu(menu, ev.clientX);
          }
        } catch (error) { console.warn('creator: a hand-over', error); }
        this.sync(creator.player.time, true);
      };
      try { strip.setPointerCapture(e.pointerId); } catch {}
      strip.addEventListener('pointermove', moveIt);
      strip.addEventListener('pointerup', up);
      strip.addEventListener('pointercancel', up);
    });
  }

  /** A slow stretch dragged: its body moves it, a grip at either end
   *  resizes it. The strip is not redrawn under the drag -- that would throw
   *  away the bar being held -- only the held bar moves, and the stretch is
   *  set on the drop, when the strip is laid out again by its new clock.
   *  `own` false is the take's automatic bullet time: moved or resized, it
   *  becomes the clip's own slow motion. */
  bindSlow(seg, slow, { own = true } = {}) {
    this.bindBar(seg, slow, next => this.creator.setSlowRange(next.t0, next.t1, own ? this.creator.ramp.speed : 0.25), { minLen: PAINT_MIN });
  }

  /** A bar on a lane dragged (a slow stretch, a title): its body moves it,
   *  a grip resizes it, inside the clip; `drop(next)` sets it. */
  bindBar(seg, at, drop, { minLen = 0.4 } = {}) {
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
      let next = { t0: at.t0, t1: at.t1 };
      let moved = false;
      this.dragging = true;
      seg.classList.add('held');
      const move = ev => {
        const t = this.timeAt(ev.clientX);
        if (!moved && Math.abs(t - grab) < 0.02) return;
        moved = true;
        if (edge === 'in') next = { t0: clamp(Math.min(this.snap(t, { skip: at.t0 }), at.t1 - minLen), span.t0, span.t1), t1: at.t1 };
        else if (edge === 'out') next = { t0: at.t0, t1: clamp(Math.max(this.snap(t, { skip: at.t1 }), at.t0 + minLen), span.t0, span.t1) };
        else {
          const len = at.t1 - at.t0;
          let a = clamp(at.t0 + (t - grab), span.t0, Math.max(span.t0, span.t1 - len));
          // The body snaps by whichever end comes nearer a mark.
          const s0 = this.snap(a, { skip: at.t0 });
          if (s0 !== a) a = s0;
          else {
            const s1 = this.snap(a + len, { skip: at.t1 });
            if (s1 !== a + len) a = s1 - len;
          }
          a = clamp(a, span.t0, Math.max(span.t0, span.t1 - len));
          next = { t0: a, t1: a + len };
        }
        seg.style.left = this.pct(next.t0);
        seg.style.width = this.widthOf(next.t0, next.t1);
      };
      const up = ev => {
        move(ev);
        strip.removeEventListener('pointermove', move);
        strip.removeEventListener('pointerup', up);
        strip.removeEventListener('pointercancel', up);
        this.dragging = false;
        this.showSnap(null);
        seg.classList.remove('held');
        try { if (moved) drop(next); } catch (error) { console.warn('creator: a bar on the strip', error); }
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
        const t = this.snap(this.timeAt(ev.clientX), { skip: creator.range[which] });
        if (which === 'in') creator.range.in = Math.min(t, creator.range.out - gap);
        else creator.range.out = Math.max(t, creator.range.in + gap);
        creator.syncRange();
        this.sync(creator.player.time, true);
      };
      const up = ev => {
        move(ev);
        this.showSnap(null);
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

  /** The playhead every frame; the rest when the clip, its cameras, its
   *  clock or its slow motion changed (or `force`). */
  sync(t, force = false) {
    if (!this.open || !this.window) return;
    const creator = this.creator;
    const span = creator.span;
    if (!span) return;
    const timing = creator.timing(span);
    // A bar or a hand-over held in a drag is moved by the drag itself.
    if (!this.dragging) this.clock = timing?.clock ?? null;
    this.knob.style.left = this.pct(t);
    const s0 = this.sx(span.t0);
    const rel = this.sx(t) - s0;
    const clock = `${rel < 0 ? '-' : ''}${fmt(Math.abs(rel))} / ${fmt(this.sx(span.t1) - s0)}`;
    if (this.clock_.textContent !== clock) this.clock_.textContent = clock;
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
    const list = creator.camStretches(span);
    const sig = [span.t0, span.t1, this.window.w0, this.window.w1, slow?.t0, slow?.t1, action?.t0, action?.t1, timing?.sig,
      take?.f?.t, take?.kill?.t, creator.takeHeld, creator.ramp.speed, Boolean(this.paint), autoSlow?.t0, autoSlow?.t1, autoSlow?.pace,
      JSON.stringify(list.map(c => [c.cam, c.t0, c.t1, c.into, c.motion, c.move, Boolean(c.end), c.tEnd, c.view?.pos?.[0], c.end?.pos?.[0]])),
      creator.placing?.i, creator.keyShots.size, creator.part?.t0, creator.part?.t1,
      JSON.stringify(creator.edits), creator.studio?.open].join('|');
    this.syncActive(t, list);
    if (!force && sig === this.sig) return;
    if (this.dragging) return;
    this.sig = sig;
    const { w0, w1 } = this.window;
    this.ctxL.style.left = '0';
    this.ctxL.style.width = this.pct(span.t0);
    this.ctxR.style.left = this.pct(span.t1);
    this.ctxR.style.right = '0';
    // Zoomed in, the clip may run off either edge: only what is in view.
    const v0 = Math.max(span.t0, w0);
    const v1 = Math.min(span.t1, w1);
    this.band.style.left = this.pct(v0);
    this.band.style.width = this.widthOf(v0, v1);
    this.inH.style.left = this.pct(span.t0);
    this.outH.style.left = this.pct(span.t1);
    this.inH.hidden = span.t0 < w0 || span.t0 > w1;
    this.outH.hidden = span.t1 < w0 || span.t1 > w1;
    this.grip.style.left = this.pct(v0);
    this.grip.style.width = this.band.style.width;
    this.title.textContent = take ? 'Kill shot' : 'Clip';
    const rec = creator.player.rec;
    const node = (lane, tag, cls, text, t0, t1 = null, title = '') => {
      const n = el(tag, cls, text);
      n.style.left = this.pct(t0);
      if (t1 !== null) n.style.width = this.widthOf(t0, t1);
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

    // Ticks, in seconds of the video from the clip's start.
    this.ticks.textContent = '';
    const sa = this.sx(w0);
    const sb = this.sx(w1);
    const step = tickStep(sb - sa);
    for (let s = Math.ceil((sa - s0) / step) * step; s0 + s <= sb + 1e-6; s += step) {
      const major = Math.abs(s - Math.round(s)) < 1e-6;
      const tick = el('i', major ? 'major' : '');
      tick.style.left = `${((s0 + s - sa) / Math.max(1e-6, sb - sa)) * 100}%`;
      if (major) tick.dataset.label = `${s > 0 ? '+' : ''}${Math.round(s)}`;
      this.ticks.append(tick);
    }

    // CLIP: the action under the take's shot and kill, the round's other
    // kills in view.
    const m = timing?.moments;
    const hit = creator.fxKill.kill;
    if (action) node('events', 'i', 'rc-cb-action', '', action.t0, action.t1, 'The action: from the shot to just after the kill');
    for (const k of creator.player.kills ?? rec.kills ?? []) {
      if (k.kind !== 'kill' || k.t < w0 || k.t > w1 || k === take?.kill) continue;
      go(node('events', 'button', 'rc-cb-mk other', '', k.t, null, `${nameAt(rec, k.killer, k.t)} kills ${nameAt(rec, k.victim, k.t)}`), k.t);
    }
    if (take?.f && take.f.t >= w0 && take.f.t <= w1) {
      go(node('events', 'button', 'rc-cb-mk shot', isMelee(take.f.weapon) ? 'Swing' : 'Shot', take.f.t, null,
        `${nameAt(rec, take.f.pid, take.f.t)} fires`), take.f.t);
    }
    if (take?.kill && Number.isFinite(hit) && hit >= w0 && hit <= w1) {
      // The round in the air between the two, as wide as it plays.
      if (m && hit > take.f.t) node('events', 'i', 'rc-cb-flight', '', take.f.t, hit, 'The round in flight');
      go(node('events', 'button', 'rc-cb-mk kill', 'Kill', hit, null,
        `The round hits: ${nameAt(rec, take.kill.killer, take.kill.t)} kills ${nameAt(rec, take.kill.victim, take.kill.t)}`), hit);
    }

    // CAMERA: the clip's cameras, and the hand-overs between them.
    this.camEls = [];
    for (const c of camLane(list)) {
      if (c.t1 - c.t0 <= 1e-6) {
        this.camEls.push(null);
        continue;
      }
      const b = node('camera', 'div', `rc-cb-cam c-${c.cam}${creator.placing?.i === c.i ? ' placing' : ''}`, undefined, c.t0, c.t1,
        `Camera ${c.i + 1}: ${c.label}. ${camTitle(c.cam)}. Click to change it`);
      b.dataset.i = String(c.i);
      const own = list[c.i];
      // Its camera: your own's picture, or the automatic one's glyph; a click
      // sets it (fly it, Use this view), and it becomes yours.
      b.append(this.camIcon(own.cam === 'placed' ? own.view : null, c.glyph, c.i, 'start',
        own.cam === 'placed' ? `Camera ${c.i + 1}'s camera: click to set it again` : `${c.label} is automatic: click to set the camera yourself`));
      const words = el('span', 'rc-cb-camwords');
      words.append(el('b', '', c.label));
      if (c.sub) words.append(el('small', '', c.sub));
      b.append(words);
      // Your own camera's end camera, or a + for one: it moves there, by
      // the moment the icon sits at, and holds it after. Both drag.
      if (own.cam === 'placed') {
        const share = endShare(c, t => this.sx(t));
        if (own.end && share < 1 - 1e-3) {
          const hold = el('i', 'rc-cb-camhold');
          hold.style.left = `${share * 100}%`;
          hold.title = 'Holds its end camera from here';
          b.append(hold);
        }
        const icon = this.camIcon(own.end ?? null, own.end ? 'cam:placed' : 'plus', c.i, 'end',
          own.end ? `End camera: it ${abMoveLabel(own.move).toLowerCase()}s here, then holds it. Drag it to when it should get there; click to set it again`
            : 'Add an end camera: drag it to when the camera should get there, or click to set it at the end of its part');
        icon.style.left = endLeft(share);
        // The words stop short of an end camera dragged over them.
        if (share < 1 - 1e-3) words.style.maxWidth = `max(0px, calc(${(share * 100).toFixed(3)}% - 70px))`;
        b.append(icon);
        this.bindEnd(icon, b, list[c.i]);
      } else b.append(el('i', 'rc-cb-caret'));
      this.camEls.push(b);
    }
    for (const c of camLane(list).slice(1)) {
      const len = HAND_OVER_LEN[c.into] ?? 0;
      if (len > 0) {
        const t1 = Math.min(c.t1, this.rt(this.sx(c.t0) + len));
        node('camera', 'i', `rc-cb-blend h-${c.into}`, '', c.t0, t1, `${handOverLabel(c.into)} into ${c.label}`);
      }
      const cut = node('camera', 'div', `rc-cb-cut h-${c.into}`, undefined, c.t0, null,
        `${handOverLabel(c.into)} to ${c.label}, ${handOverWords(list[c.i].at).toLowerCase()}: drag to move it, click for how`);
      cut.dataset.i = String(c.i);
      const ho = el('span', 'rc-cb-ho');
      const glyph = moveIcon(c.into);
      if (glyph) ho.append(glyph);
      cut.append(ho);
      this.bindCut(cut, c, list);
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

    // TEXT and FX, the studio's lanes (hidden on the round's bar).
    const e = creator.edits;
    const fxKill = creator.fxKill;
    const textBar = (which, label, t0, dur) => {
      const seg = node('text', 'span', `rc-cb-seg txt ${which}`, '', span.t0 + t0, span.t0 + t0 + dur,
        `${label}: drag to move it, an end to resize it, right-click to edit or remove it`);
      seg.append(el('b', '', label));
      this.bindBar(grips(seg), { t0: span.t0 + t0, t1: span.t0 + t0 + dur }, next => {
        creator.setEdit(which, { ...creator.edits[which], t: next.t0 - span.t0, dur: Math.max(TEXT_EASE * 2, next.t1 - next.t0) });
      });
    };
    if (e.title.on) textBar('title', `Title · ${e.title.text || '(no words)'}`, e.title.t, e.title.dur);
    if (e.lower.on) textBar('lower', `Lower third · ${e.lower.text || (creator.lowerLines()?.[0] ?? 'who killed whom')}`, lowerStart(e, span, fxKill.shot), e.lower.dur);
    if (!e.title.on && !e.lower.on) node('text', 'span', 'rc-cb-seg plain', 'no text · right-click to add a title or a lower third', span.t0, span.t1);
    const fxMark = (cls, label, t0, t1 = null, title = '') => {
      const n = node('fx', 'span', `rc-cb-fxm ${cls}`, '', t0, t1, title);
      const glyph = moveIcon(`fx:${cls}`);
      if (glyph) n.append(glyph);
      if (label) n.append(el('b', '', label));
      return n;
    };
    if (e.fadeIn > 0) fxMark('fadein', 'fade in', span.t0, span.t0 + e.fadeIn, 'Fades in from black');
    if (e.fadeOut > 0) fxMark('fadeout', 'fade out', span.t1 - e.fadeOut, span.t1, 'Fades out to black');
    if (fxKill.kill !== null && fxKill.kill >= span.t0 && fxKill.kill <= span.t1) {
      const on = [e.flash && 'flash', e.punch && 'punch', e.shake && 'shake', e.freeze > 0 && `freeze ${e.freeze} s`].filter(Boolean);
      if (on.length) fxMark('kill', on.join(' · '), fxKill.kill, null, 'As the round hits: right-click the lane to change');
    }
    if (!(e.fadeIn > 0) && !(e.fadeOut > 0) && !(e.flash || e.punch || e.shake || e.freeze > 0)) {
      node('fx', 'span', 'rc-cb-seg plain', 'no effects · right-click for fades and kill effects', span.t0, span.t1);
    }
    const part = creator.part;
    this.partBand.hidden = !part;
    if (part) {
      this.partBand.style.left = this.pct(part.t0);
      this.partBand.style.width = this.widthOf(part.t0, part.t1);
      this.partWords.textContent = `Looping ${part.label}`;
    }
    this.syncActive(t, list, true);
    if (!this.pop.hidden && this.popKind === 'export') this.fillPop();
  }

  /** A camera's camera on its block: the picture of a view of yours, else a
   *  glyph (dashed: automatic, or a + for an end camera to add). A click sets
   *  it (`ReplayCreator.placeCam`); the strip's scrub never sees the press. */
  camIcon(view, glyph, i, which, title) {
    const creator = this.creator;
    const b = el('button', `rc-cb-camicon ${which}${view ? ' set' : ''}${glyph === 'plus' ? ' add' : ''}`);
    b.type = 'button';
    b.title = title;
    b.setAttribute('aria-label', title);
    const shot = view ? creator.keyShot(view) : null;
    if (shot) {
      const pic = el('canvas', 'rc-cb-thumb');
      pic.width = 48;
      pic.height = 27;
      pic.getContext('2d').drawImage(shot, 0, 0, shot.width, shot.height, 0, 0, pic.width, pic.height);
      b.append(pic);
    } else if (glyph === 'plus') b.append(el('span', 'rc-cb-plus', '+'));
    else {
      const g = moveIcon(glyph);
      if (g) b.append(g);
    }
    b.addEventListener('pointerdown', e => e.stopPropagation());
    if (which === 'end') return b;
    b.addEventListener('click', e => {
      e.stopPropagation();
      this.closePop();
      try { creator.placeCam(i, { which }); } catch (error) { console.warn('creator: a camera', error); }
      this.sync(creator.player.time, true);
    });
    return b;
  }

  /**
   * Camera `c`'s end camera icon (or its +) dragged along its block: it goes
   * where the camera should get to its end camera, snapping to the shot, the
   * hit, the man down and the playhead, and the words say what it is kept
   * at. The drop keeps it and loops the part; the + dropped places the end
   * camera there. A press that does not move sets the end camera, as a
   * click on any camera's icon does.
   */
  bindEnd(icon, block, c) {
    const creator = this.creator;
    icon.addEventListener('click', e => e.stopPropagation());
    icon.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();
      this.closePop();
      creator.ui.activity?.();
      const lo = c.t0 + CAM_MIN;
      const hi = c.t1;
      const marks = this.snapMarks({ playhead: true });
      const x0 = e.clientX;
      let t = Number.isFinite(c.tEnd) ? c.tEnd : c.t1;
      let moved = false;
      this.dragging = true;
      icon.classList.add('held');
      const w = Math.max(1e-6, this.sx(c.t1) - this.sx(c.t0));
      let hold = block.querySelector('.rc-cb-camhold');
      const moveIt = ev => {
        if (!moved && Math.abs(ev.clientX - x0) <= CLICK_SLOP) return;
        moved = true;
        t = clamp(this.snap(this.timeAt(ev.clientX), { marks }), lo, hi);
        if (hi - t <= CAM_MIN) t = hi;
        const share = Math.min(1, Math.max(0, (this.sx(t) - this.sx(c.t0)) / w));
        icon.style.left = endLeft(share);
        const words = block.querySelector('.rc-cb-camwords');
        if (words) words.style.maxWidth = share < 1 - 1e-3 ? `max(0px, calc(${(share * 100).toFixed(3)}% - 70px))` : '';
        if (!hold) {
          hold = el('i', 'rc-cb-camhold');
          block.insertBefore(hold, icon);
        }
        hold.style.left = `${share * 100}%`;
        hold.hidden = share >= 1 - 1e-3;
        const m = creator.timing()?.moments;
        this.tip.hidden = false;
        this.tip.textContent = m ? endWords(hi - t <= CAM_MIN ? null : anchorAt(t, m)) : '';
        this.tip.style.left = this.pct(t);
      };
      const up = ev => {
        moveIt(ev);
        icon.removeEventListener('pointermove', moveIt);
        icon.removeEventListener('pointerup', up);
        icon.removeEventListener('pointercancel', up);
        this.dragging = false;
        this.showSnap(null);
        this.tip.hidden = true;
        icon.classList.remove('held');
        try {
          if (!moved) creator.placeCam(c.i, { which: 'end' });
          else if (c.end) creator.moveEndAt(c.i, t);
          else creator.placeCam(c.i, { which: 'end', endAt: t });
        } catch (error) { console.warn('creator: an end camera', error); }
        this.sync(creator.player.time, true);
      };
      try { icon.setPointerCapture(e.pointerId); } catch {}
      icon.addEventListener('pointermove', moveIt);
      icon.addEventListener('pointerup', up);
      icon.addEventListener('pointercancel', up);
    });
  }

  /** The camera filming the playhead lit. */
  syncActive(t, list, force = false) {
    const i = list.findIndex(c => t >= c.t0 - 1e-6 && t < c.t1);
    if (!force && i === this.activeCam) return;
    this.activeCam = i;
    for (const [j, b] of this.camEls.entries()) b?.classList.toggle('now', j === i);
  }

  dispose() {
    document.removeEventListener('pointerdown', this.onOutside, true);
    this.el.remove();
  }
}

/** Export's frames: the creator's frame guide (`prefs.frame`), which the
 *  recording is cropped to. */
export const EXPORT_FRAMES = FRAMES;

function injectStyle() {
  if (document.getElementById('rc-cb-style')) return;
  const style = el('style');
  style.id = 'rc-cb-style';
  style.textContent = STYLE;
  document.head.appendChild(style);
}

const STYLE = `
/* The clip editor: the round's timeline gives way to the clip alone. */
.rp-root.rc-editing { --rp-bar-h: 194px; }
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
.rc-cb-legend { display: grid; grid-template-rows: 15px 20px 36px 26px; }
.rc-cb-legend span { align-self: center; color: var(--rp-muted); font: 800 9px var(--rp-font); letter-spacing: .12em; text-transform: uppercase; cursor: help; }
.rc-cb-legend span.cam { color: var(--rp-ink); }
.rc-cb-strip { position: relative; height: 98px; border-radius: 4px; background: rgba(0, 0, 0, .32); cursor: pointer; touch-action: none; }
/* The lanes, one under the other, the time along the top. */
.rc-cb-ticks { position: absolute; left: 0; right: 0; top: 0; height: 13px; pointer-events: none; }
.rc-cb-ticks i { position: absolute; top: 9px; width: 1px; height: 89px; background: rgba(255, 255, 255, .06); }
.rc-cb-ticks i.major { background: rgba(255, 255, 255, .13); }
.rc-cb-ticks i[data-label]::after { content: attr(data-label); position: absolute; top: -9px; left: 3px;
  color: var(--rp-muted); font: 9px var(--rp-mono); white-space: nowrap; }
.rc-cb-lane { position: absolute; left: 0; right: 0; pointer-events: none; }
.rc-cb-lane > * { pointer-events: auto; }
.rc-cb-events { top: 15px; height: 18px; }
.rc-cb-camera { top: 35px; height: 34px; border-top: 1px solid rgba(255, 255, 255, .05); }
.rc-cb-speed { top: 71px; height: 24px; border-top: 1px solid rgba(255, 255, 255, .05); }
.rc-cb-ctx { position: absolute; top: 0; bottom: 0; pointer-events: none;
  background: repeating-linear-gradient(135deg, rgba(0, 0, 0, .35) 0 6px, rgba(0, 0, 0, .15) 6px 12px); }
.rc-cb-band { position: absolute; top: 0; bottom: 0; background: rgba(232, 195, 90, .08); pointer-events: none; }
.rc-cb-action { position: absolute; bottom: 0; height: 3px; background: var(--rp-gold); opacity: .85; border-radius: 2px; }
.rc-cb-flight { position: absolute; top: 4px; height: 10px; border-radius: 5px; pointer-events: none;
  background: repeating-linear-gradient(90deg, rgba(110, 170, 220, .55) 0 6px, rgba(110, 170, 220, .2) 6px 10px); }
.rc-cb-h { position: absolute; top: -3px; bottom: -3px; width: 6px; margin-left: -3px; border-radius: 3px; background: var(--rp-gold);
  cursor: ew-resize; touch-action: none; box-shadow: 0 0 0 1px rgba(0, 0, 0, .5); z-index: 2; }
.rc-cb-h::after { content: ''; position: absolute; inset: 0 -8px; }
.rc-cb-grip { position: absolute; top: -4px; height: 6px; border-radius: 3px; z-index: 2; background: var(--rp-gold);
  cursor: grab; touch-action: none; box-shadow: 0 0 0 1px rgba(0, 0, 0, .5); }
.rc-cb-grip:hover { filter: brightness(1.2); }
.rc-cb-grip:active { cursor: grabbing; }
.rc-cb-grip::after { content: ''; position: absolute; inset: -4px 0 -3px; }
.rc-cb-knob { position: absolute; top: -4px; bottom: -4px; width: 2px; margin-left: -1px; background: #fff; pointer-events: none;
  box-shadow: 0 0 6px rgba(255, 255, 255, .6); z-index: 4; }
.rc-cb-strip.outside .rc-cb-knob { background: var(--rp-muted); box-shadow: none; }
.rc-cb-mk { position: absolute; top: 1px; padding: 0 4px; border: 0; font: 800 9px/14px var(--rp-font); letter-spacing: .08em;
  text-transform: uppercase; white-space: nowrap; cursor: pointer; z-index: 1; }
/* The shot's label ends at its moment and the kill's starts at its: a knife or
   a close shot puts the two on the same pixel. */
.rc-cb-mk.shot { background: rgba(232, 195, 90, .9); color: #17150f; transform: translateX(calc(-100% - 1px)); border-radius: 3px 0 0 3px; }
.rc-cb-mk.kill { background: #d9584b; color: #fff; transform: translateX(1px); border-radius: 0 3px 3px 0; }
.rc-cb-mk.other { width: 2px; height: 14px; padding: 0; margin-left: -1px; background: rgba(217, 88, 75, .55); }
/* The clip's cameras: a block each, coloured by what it films. */
.rc-cb-cam { position: absolute; top: 2px; height: 30px; box-sizing: border-box; display: flex; align-items: center; gap: 6px; padding: 0 16px 0 4px;
  overflow: hidden; border-radius: 5px; color: #fff; cursor: pointer; touch-action: none; --c: 150, 150, 150;
  background: linear-gradient(180deg, rgba(var(--c), .5), rgba(var(--c), .3)); box-shadow: inset 0 0 0 1px rgba(var(--c), .9); }
.rc-cb-cam:hover { filter: brightness(1.18); }
.rc-cb-cam.now { box-shadow: inset 0 0 0 1px rgba(var(--c), 1), inset 0 -3px 0 rgba(255, 255, 255, .55); }
.rc-cb-cam.placing { box-shadow: inset 0 0 0 2px var(--rp-gold); animation: rc-cb-placing 1s ease-in-out infinite alternate; }
@keyframes rc-cb-placing { to { filter: brightness(1.35); } }
.rc-cb-cam.c-placed { --c: 232, 195, 90; color: #17150f; }
.rc-cb-cam.c-eyes, .rc-cb-cam.c-shoulder, .rc-cb-cam.c-front { --c: 196, 140, 70; }
.rc-cb-cam.c-chase, .rc-cb-cam.c-orbit, .rc-cb-cam.c-side { --c: 80, 150, 215; }
.rc-cb-cam.c-incoming { --c: 150, 110, 210; }
.rc-cb-cam.c-victim { --c: 205, 85, 75; }
.rc-cb-cam.c-free { --c: 125, 125, 115; }
.rc-cb-cam .rc-cb-icon { width: 16px; height: 16px; stroke-width: 2.2; }
.rc-cb-camwords { display: flex; flex-direction: column; min-width: 0; line-height: 1.1; }
.rc-cb-camwords b { font: 800 10px var(--rp-font); letter-spacing: .06em; text-transform: uppercase; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rc-cb-camwords small { font: 700 9px var(--rp-font); opacity: .8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rc-cb-caret { position: absolute; right: 6px; top: 12px; width: 5px; height: 5px; border-right: 1.5px solid currentColor;
  border-bottom: 1.5px solid currentColor; transform: rotate(45deg); opacity: .7; }
.rc-cb-thumb { position: static; inset: auto; flex: none; display: block; width: 36px; height: 20px; border-radius: 2px; background: #000; }
/* A camera's camera: click to set it. Solid gold when it is a view you set,
   dashed when the camera works it out itself; a + for an end camera to add. */
.rc-cb-camicon { flex: none; display: grid; place-items: center; min-width: 26px; height: 24px; padding: 1px; box-sizing: border-box;
  border: 1.5px dashed rgba(255, 255, 255, .7); border-radius: 4px; background: rgba(0, 0, 0, .35); color: #fff; cursor: pointer; }
.rc-cb-camicon .rc-cb-icon { width: 15px; height: 15px; stroke-width: 2.2; }
.rc-cb-camicon.set { border: 1.5px solid var(--rp-gold); }
/* The end camera sits where the camera gets to it, and drags; after it the
   block is hatched: the end camera held. */
.rc-cb-camicon.end { position: absolute; top: 3px; z-index: 2; transform: translateX(-100%); margin-left: -4px; cursor: ew-resize; touch-action: none; }
.rc-cb-camicon.end.held { border-color: #fff; border-style: solid; box-shadow: 0 0 0 2px rgba(255, 255, 255, .35); }
.rc-cb-camhold { position: absolute; top: 0; bottom: 0; right: 0; z-index: 1; pointer-events: none; border-left: 1.5px solid rgba(23, 21, 15, .55);
  background: repeating-linear-gradient(135deg, rgba(23, 21, 15, .22) 0 4px, transparent 4px 8px); }
.rc-cb-camhold[hidden] { display: none; }
.rc-cb-camicon.add { min-width: 22px; opacity: .75; }
.rc-cb-plus { font: 800 15px/1 var(--rp-font); }
.rc-cb-camicon:hover, .rc-cb-camicon:focus-visible { border-color: #fff; border-style: solid; background: var(--rp-gold); color: #17150f; opacity: 1; outline: none; }
.rc-cb-cam:has(.rc-cb-camicon.end) { padding-right: 34px; }
/* A part of the clip playing over and over. */
.rc-cb-part { position: absolute; top: 0; bottom: 0; z-index: 2; pointer-events: none; box-sizing: border-box;
  background: rgba(110, 231, 255, .08); border: 1.5px solid rgba(110, 231, 255, .85); border-radius: 4px; }
.rc-cb-part[hidden] { display: none; }
.rc-cb-partpill { position: absolute; right: 2px; top: 1px; height: 14px; display: flex; align-items: center; gap: 6px; padding: 0 2px 0 7px;
  border-radius: 3px; background: #0c2a33; color: #d9f8ff; white-space: nowrap; pointer-events: auto;
  font: 800 9px var(--rp-font); letter-spacing: .08em; text-transform: uppercase; }
.rc-cb-partall { height: 12px; padding: 0 6px; border: 0; border-radius: 2px; background: #6ee7ff; color: #0c2a33;
  font: 800 8px/12px var(--rp-font); letter-spacing: .06em; text-transform: uppercase; cursor: pointer; }
/* Where one camera hands over to the next: a gold line to drag, its glyph
   to click, and the glide or whip drawn as long as it takes. */
.rc-cb-blend { position: absolute; top: 2px; height: 30px; border-radius: 0 5px 5px 0; pointer-events: none;
  background: linear-gradient(90deg, rgba(255, 255, 255, .34), rgba(255, 255, 255, 0)); }
.rc-cb-blend.h-whip { background: linear-gradient(90deg, rgba(255, 255, 255, .05) 0 55%, rgba(255, 255, 255, .45)); }
.rc-cb-cut { position: absolute; top: -1px; height: 36px; width: 14px; margin-left: -7px; z-index: 3; cursor: ew-resize; touch-action: none; }
.rc-cb-cut::before { content: ''; position: absolute; left: 6px; top: 0; bottom: 0; width: 2px; border-radius: 1px; background: var(--rp-gold);
  box-shadow: 0 0 0 1px rgba(0, 0, 0, .55); }
.rc-cb-cut:hover::before, .rc-cb-cut.held::before { width: 4px; left: 5px; box-shadow: 0 0 8px rgba(232, 195, 90, .8); }
.rc-cb-ho { position: absolute; left: -2px; top: 9px; width: 18px; height: 18px; box-sizing: border-box; display: grid; place-items: center;
  border: 1.5px solid var(--rp-gold); border-radius: 50%; background: #17150f; color: var(--rp-gold); cursor: pointer; }
.rc-cb-ho .rc-cb-icon { width: 11px; height: 11px; stroke-width: 2.6; }
.rc-cb-cut:hover .rc-cb-ho { background: var(--rp-gold); color: #17150f; }
.rc-cb-tip { position: absolute; top: 26px; transform: translateX(-50%); padding: 3px 7px; border-radius: 4px; z-index: 6; white-space: nowrap;
  background: #17150f; border: 1px solid var(--rp-gold); color: var(--rp-gold); font: 800 10px var(--rp-font); letter-spacing: .04em; pointer-events: none; }
.rc-cb-tip[hidden] { display: none; }
.rc-cb-icon { flex: none; width: 12px; height: 12px; fill: none; stroke: currentColor; stroke-width: 2.4; stroke-linecap: round; stroke-linejoin: round; }
.rc-cb-item .rc-cb-icon { width: 16px; height: 16px; stroke-width: 2; color: var(--rp-gold); }
.rc-cb-pop-head { padding: 8px 9px 3px; color: var(--rp-muted); font: 800 9px var(--rp-font); letter-spacing: .12em; text-transform: uppercase; }
.rc-cb-speed .rc-cb-seg { top: 2px; height: 20px; line-height: 20px; }
.rc-cb-seg { position: absolute; overflow: hidden; padding: 0 6px; box-sizing: border-box; border-radius: 3px;
  font: 700 9px var(--rp-font); letter-spacing: .08em; text-transform: uppercase; white-space: nowrap; text-overflow: ellipsis; pointer-events: none; }
.rc-cb-seg.plain { background: rgba(255, 255, 255, .05); color: var(--rp-muted); }
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
/* The studio's lanes: shown only when the strip is in the studio. */
.rc-cb-text, .rc-cb-fx, .rc-cb-legend .st-only { display: none; }
.rc-cb.studio .rc-cb-text { display: block; top: 97px; height: 22px; border-top: 1px solid rgba(255, 255, 255, .05); }
.rc-cb.studio .rc-cb-fx { display: block; top: 121px; height: 22px; border-top: 1px solid rgba(255, 255, 255, .05); }
.rc-cb.studio .rc-cb-legend .st-only { display: block; }
.rc-cb.studio .rc-cb-legend { grid-template-rows: 15px 20px 36px 26px 24px 24px; }
.rc-cb.studio .rc-cb-strip { height: 146px; }
.rc-cb.studio .rc-cb-ticks i { height: 137px; }
.rc-cb.studio .rc-cb-head, .rc-cb.studio .rc-cb-hint { display: none; }
.rc-cb.studio .rc-cb-body { margin-top: 0; }
.rc-cb-text .rc-cb-seg, .rc-cb-fx .rc-cb-seg { top: 2px; height: 18px; line-height: 18px; }
.rc-cb-seg.txt { overflow: visible; padding: 0 14px; background: rgba(240, 145, 60, .5); color: #fff; pointer-events: auto; cursor: grab; touch-action: none; }
.rc-cb-seg.txt.lower { background: rgba(232, 195, 90, .55); color: #17150f; }
.rc-cb-seg.txt b { display: block; overflow: hidden; text-overflow: ellipsis; font-weight: 800; pointer-events: none; }
.rc-cb-seg.txt:hover { filter: brightness(1.15); }
.rc-cb-seg.txt.held { cursor: grabbing; box-shadow: 0 0 0 1px #fff; }
.rc-cb-fxm { position: absolute; top: 2px; height: 18px; display: flex; align-items: center; gap: 4px; padding: 0 6px; box-sizing: border-box;
  border-radius: 3px; color: var(--rp-ink); font: 700 9px/18px var(--rp-font); letter-spacing: .08em; text-transform: uppercase; white-space: nowrap; pointer-events: none; }
.rc-cb-fxm.fadein { background: linear-gradient(90deg, #000, rgba(0, 0, 0, 0)); box-shadow: inset 0 0 0 1px rgba(255, 255, 255, .25); }
.rc-cb-fxm.fadeout { background: linear-gradient(90deg, rgba(0, 0, 0, 0), #000); box-shadow: inset 0 0 0 1px rgba(255, 255, 255, .25); justify-content: flex-end; }
.rc-cb-fxm.kill { margin-left: -9px; color: #fff; text-shadow: 0 0 6px rgba(255, 255, 255, .7); }
.rc-cb-fxm .rc-cb-icon { width: 12px; height: 12px; }
.rc-cb-studio { border-color: var(--rp-gold); color: var(--rp-gold); }
.rc-cb-studio::before { content: ''; width: 10px; height: 10px; border: 1.5px solid currentColor; border-radius: 2px; box-sizing: border-box;
  box-shadow: inset 0 -3px 0 currentColor; }
.rc-cb-snap { position: absolute; top: 0; bottom: 0; width: 1px; margin-left: -0.5px; background: #6ee7ff; box-shadow: 0 0 6px #6ee7ff; pointer-events: none; z-index: 5; }
.rc-cb-snap[hidden] { display: none; }
.rc-cb-h[hidden] { display: none; }
/* A feature from the studio's tray about to land. */
.rc-cb-drop { position: absolute; width: 3px; margin-left: -1.5px; background: #6ee7ff; box-shadow: 0 0 10px #6ee7ff; pointer-events: none; z-index: 6; }
.rc-cb-drop[hidden] { display: none; }
.rc-cb-droptip { position: absolute; left: 7px; top: 50%; transform: translateY(-50%); padding: 3px 8px; border-radius: 4px; white-space: nowrap;
  background: #0c2a33; border: 1px solid #6ee7ff; color: #d9f8ff; font: 800 10px var(--rp-font); letter-spacing: .04em; }
.rc-cb-drop.flip .rc-cb-droptip { left: auto; right: 7px; }
/* The chooser, and Export's. */
.rc-cb-pop { position: absolute; bottom: calc(100% + 6px); z-index: 6; display: flex; flex-direction: column; gap: 1px; padding: 5px;
  min-width: 220px; max-width: 360px; background: var(--rp-plate-menu); border: 1px solid var(--rp-edge); border-radius: 6px; box-shadow: 0 8px 24px rgba(0, 0, 0, .55); }
.rc-cb-pop.wide { width: 340px; }
.rc-cb-pop[hidden] { display: none; }
.rc-cb-pop-title { padding: 5px 8px 4px; color: var(--rp-gold); font: 800 10px var(--rp-font); letter-spacing: .14em; text-transform: uppercase;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rc-cb-item { display: flex; align-items: center; gap: 8px; min-height: 30px; padding: 0 9px; border: 0; border-radius: 4px; background: none;
  color: var(--rp-ink); font: 12px var(--rp-font); text-align: left; white-space: nowrap; cursor: pointer; }
.rc-cb-item:hover, .rc-cb-item:focus-visible { background: rgba(255, 255, 255, .08); outline: none; }
.rc-cb-item.rule { margin-top: 4px; box-shadow: 0 -1px 0 var(--rp-edge); border-radius: 0 0 4px 4px; }
.rc-cb-item span { flex: 1; }
.rc-cb-item kbd { color: var(--rp-muted); font: 10px var(--rp-mono); }
.rc-cb-mark { width: 12px; color: var(--rp-gold); font-style: normal; }
.rc-cb-item.rec .rc-cb-mark::before { content: ''; display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #ff5b4d; }
.rc-cb-pop-note { margin: 4px 8px 3px; max-width: 250px; color: var(--rp-muted); font: 11px/1.35 var(--rp-font); white-space: normal; }
/* The cameras a camera can be, as cards; how it moves and takes over, as chips. */
.rc-cb-cards { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 4px; padding: 4px 3px; }
.rc-cb-card { display: flex; flex-direction: column; align-items: center; gap: 4px; min-height: 58px; padding: 7px 4px 6px; border: 1px solid var(--rp-edge);
  border-radius: 6px; background: rgba(255, 255, 255, .03); color: var(--rp-ink); font: 700 11px/1.2 var(--rp-font); text-align: center; cursor: pointer; }
.rc-cb-card .rc-cb-icon { width: 22px; height: 22px; stroke-width: 1.8; color: var(--rp-gold); }
.rc-cb-card:hover, .rc-cb-card:focus-visible { background: rgba(255, 255, 255, .09); border-color: var(--rp-gold); outline: none; }
.rc-cb-card.on { background: var(--rp-gold); border-color: var(--rp-gold); color: #17150f; }
.rc-cb-card.on .rc-cb-icon { color: #17150f; }
.rc-cb-chips { display: flex; flex-wrap: wrap; gap: 4px; padding: 2px 3px 4px; }
.rc-cb-chip { display: inline-flex; align-items: center; gap: 5px; height: 28px; padding: 0 9px; border: 1px solid var(--rp-edge); border-radius: 14px;
  background: none; color: var(--rp-ink); font: 700 11px var(--rp-font); cursor: pointer; white-space: nowrap; }
.rc-cb-chip .rc-cb-icon { width: 14px; height: 14px; stroke-width: 2; color: var(--rp-gold); }
.rc-cb-chip:hover, .rc-cb-chip:focus-visible { border-color: var(--rp-gold); outline: none; }
.rc-cb-chip.on { background: var(--rp-gold); border-color: var(--rp-gold); color: #17150f; }
.rc-cb-chip.on .rc-cb-icon { color: #17150f; }
/* Placing a camera of yours: over the view, out of the way of flying it. */
.rc-place { position: absolute; left: 50%; top: 14px; transform: translateX(-50%); z-index: 30; display: flex; align-items: center; gap: 10px;
  max-width: calc(100% - 32px); box-sizing: border-box; padding: 8px 8px 8px 14px; border: 1px solid var(--rp-gold, #e8c35a); border-radius: 8px;
  background: rgba(20, 20, 17, .92); box-shadow: 0 10px 30px rgba(0, 0, 0, .55); color: #eeecd9;
  font: 12px/1.35 'Trebuchet MS', 'Geist Variable', 'Segoe UI', system-ui, sans-serif; pointer-events: auto; }
.rc-place[hidden] { display: none; }
.rc-place-text { display: flex; flex-direction: column; min-width: 0; }
.rc-place-text b { color: #e8c35a; font-weight: 800; font-size: 11px; letter-spacing: .14em; text-transform: uppercase; }
.rc-place-how { color: #c9c6ad; }
.rc-place-text { flex: 1 1 auto; }
.rc-place .rp-btn { flex: none; width: auto; min-width: max-content; height: 32px; padding: 0 14px; font: 800 11px 'Trebuchet MS', 'Segoe UI', system-ui, sans-serif;
  letter-spacing: .06em; white-space: nowrap; }
.rc-place-use, .rc-place-use:hover { border-color: #e8c35a; background: #e8c35a; color: #17150f; font-weight: 800; }
.rc-place-cancel { border-color: rgba(200, 194, 152, .45); }
@container rp-bar (max-width: 610px) { .rc-cb-where, .rc-cb-hint { display: none; } .rc-cb-body { grid-template-columns: 0 minmax(0, 1fr); } .rc-cb-legend { visibility: hidden; } }
`;
