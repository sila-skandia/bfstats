// The round's fronts along the replay's timeline (features/round-replay-
// fronts): a lane per front over the scrubber, each how hard the fighting at
// that place burned at every moment of the round (replay-fronts.js), with the
// round's top plays as gold pips on the lane of the front they happened at.
// A click on a lane goes to that front at that moment, on the fight cam
// (replay-highlights.js `watchFront`). It replaces the one heat strip that
// summed the whole level and said when, never where.

import { heatAt, LIVE_HEAT, nearestPoint } from './replay-fronts.js';
import { whereIs } from './replay-battles.js';
import { fmtClock } from './replay-timeline.js';

/** A lane's height, pixels. */
const LANE_H = 10;
/** The lanes' smoothing, in buckets either side. */
const SMOOTH = 1;
/** The lanes' labels and the live dots are refreshed this often, seconds. */
const TICK = 0.25;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export class ReplayLanes {
  constructor(highlights) {
    this.hl = highlights;
    this.ui = highlights.ui;
    const { fronts } = highlights.model.fronts;
    this.el = el('div', 'rp-lanes');
    this.el.hidden = !fronts.length;
    this.duration = Math.max(0.001, highlights.player.rec.duration);
    this.lanes = fronts.map(front => {
      const row = el('button', 'rp-lane');
      row.type = 'button';
      row.tabIndex = -1;
      const canvas = el('canvas');
      canvas.setAttribute('aria-hidden', 'true');
      const label = el('span', 'rp-lane-name', front.name);
      row.append(canvas, label);
      row.setAttribute('aria-label', `${front.name}: how hard it was fought over the round. Click a moment to watch the fight there.`);
      this.el.append(row);
      return { front, row, canvas, label, values: this.smooth(front.lane), live: false, on: false };
    });
    this.head = el('i', 'rp-lanes-head');
    this.hover = el('i', 'rp-lanes-hover');
    this.tip = el('span', 'rp-lanes-tip');
    this.el.append(this.head, this.hover, this.tip);
    // The plays, each on its front's lane (where its man was), else none.
    const { rec, kills } = highlights.player;
    this.plays = [];
    for (const play of highlights.model.plays) {
      const w = whereIs(rec, play.pid, play.t - 0.05, kills);
      const at = w.pos ?? play.pos ?? null;
      const point = at ? nearestPoint(highlights.model.points, at) : null;
      const lane = point ? this.lanes.find(l => l.front.id === point.id) : null;
      if (lane) this.plays.push({ play, lane });
    }
    const timeline = highlights.ui.timeline;
    timeline.el.before(this.el);
    // The timeline marks the followed player's own events from now on: the
    // lanes say where everyone's fighting was (replay-timeline.js `layout`).
    timeline.lanesShown = fronts.length > 0;
    timeline.layout();
    this.el.addEventListener('pointerdown', e => this.onDown(e));
    this.el.addEventListener('pointermove', e => this.onMove(e));
    this.el.addEventListener('pointerleave', () => {
      this.hover.style.display = 'none';
      this.tip.style.display = 'none';
    });
    this.resize = new ResizeObserver(() => this.draw());
    this.resize.observe(this.el);
    this.drawnFor = '';
    this.clock = -Infinity;
  }

  /** Read the lanes' state on the next frame. */
  refresh() {
    this.clock = -Infinity;
  }

  smooth(raw) {
    const out = new Float32Array(raw.length);
    let max = 0;
    for (let i = 0; i < raw.length; i++) {
      let sum = 0;
      let w = 0;
      for (let j = -SMOOTH; j <= SMOOTH; j++) {
        const v = raw[i + j];
        if (v === undefined) continue;
        const k = 1 - Math.abs(j) / (SMOOTH + 1);
        sum += v * k;
        w += k;
      }
      out[i] = w ? sum / w : 0;
      max = Math.max(max, out[i]);
    }
    this.max = Math.max(this.max ?? 0, max);
    return out;
  }

  timeAt(clientX) {
    const r = this.el.getBoundingClientRect();
    return Math.min(this.duration, Math.max(0, ((clientX - r.left) / Math.max(1, r.width)) * this.duration));
  }

  onDown(e) {
    if (e.button !== 0) return;
    const row = e.target.closest?.('.rp-lane');
    const lane = this.lanes.find(l => l.row === row);
    if (!lane) return;
    e.preventDefault();
    e.stopPropagation();
    this.ui.activity();
    this.hl.watchFront(lane.front, this.timeAt(e.clientX));
  }

  onMove(e) {
    this.ui.activity();
    const r = this.el.getBoundingClientRect();
    const row = e.target.closest?.('.rp-lane');
    const lane = this.lanes.find(l => l.row === row);
    const x = Math.min(r.width, Math.max(0, e.clientX - r.left));
    this.hover.style.display = 'block';
    this.hover.style.left = `${x}px`;
    if (!lane) {
      this.tip.style.display = 'none';
      return;
    }
    const t = this.timeAt(e.clientX);
    this.tip.textContent = `${lane.front.name} at ${fmtClock(t)}: click to watch`;
    this.tip.style.display = 'block';
    const w = this.tip.offsetWidth;
    this.tip.style.left = `${Math.min(r.width - w, Math.max(0, x - w / 2))}px`;
  }

  /** Every lane, at this width: the fighting as bars, the plays as pips. All
   *  lanes share one scale, so a lane that looks quieter was. */
  draw() {
    const width = this.el.clientWidth;
    if (!width) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const key = `${width}x${dpr}`;
    if (key === this.drawnFor) return;
    this.drawnFor = key;
    const { bucket } = this.hl.model.fronts;
    const max = this.max || 1;
    for (const lane of this.lanes) {
      const c = lane.canvas;
      c.width = Math.round(width * dpr);
      c.height = Math.round(LANE_H * dpr);
      const g = c.getContext('2d');
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, width, LANE_H);
      const step = (bucket / this.duration) * width;
      g.fillStyle = 'rgba(240, 145, 60, .85)';
      lane.values.forEach((v, i) => {
        if (v <= 0) return;
        // A square root keeps a front's quiet stretches visible beside the
        // round's peak.
        const h = Math.max(1, Math.sqrt(v / max) * LANE_H);
        g.fillRect(i * step, LANE_H - h, Math.max(1, step - 0.5), h);
      });
    }
    for (const { play, lane } of this.plays) {
      const g = lane.canvas.getContext('2d');
      const px = (play.t / this.duration) * width;
      g.fillStyle = '#e8c35a';
      g.strokeStyle = 'rgba(0, 0, 0, .8)';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(px, 0.5);
      g.lineTo(px + 3.5, 4);
      g.lineTo(px, 7.5);
      g.lineTo(px - 3.5, 4);
      g.closePath();
      g.fill();
      g.stroke();
    }
  }

  update(t, dt) {
    if (!this.drawnFor) this.draw();
    const k = `${((t / this.duration) * 100).toFixed(3)}%`;
    if (k !== this.headAt) {
      this.headAt = k;
      this.head.style.left = k;
    }
    // On the page's clock, not the round's: paused, a lane still lights as
    // the replay goes to it.
    const now = performance.now() / 1000;
    if (now - this.clock < TICK) return;
    this.clock = now;
    const current = this.hl.currentFront(t);
    for (const lane of this.lanes) {
      const live = heatAt(lane.front, t) >= LIVE_HEAT;
      const on = lane.front === current;
      if (live !== lane.live) lane.row.classList.toggle('live', (lane.live = live));
      if (on !== lane.on) lane.row.classList.toggle('on', (lane.on = on));
    }
  }

  dispose() {
    this.resize.disconnect();
    this.el.remove();
    const timeline = this.ui.timeline;
    timeline.lanesShown = false;
    timeline.layout();
  }
}
