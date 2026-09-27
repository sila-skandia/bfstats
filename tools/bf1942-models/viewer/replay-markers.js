// Battle markers over the replay's 3D view (features/round-replay-
// highlights): the fights burning elsewhere, each marked where it is --
// pinned over it when it is in view, held at the edge of the screen with an
// arrow toward it when it is not -- the way modern shooters mark an
// objective. A click watches the fight. The fight the followed player is in
// is not marked: the camera is already there.

import { contested } from './replay-battles.js';

/** At most this many markers, the hottest fights; none below MIN_HEAT. */
const MAX_MARKS = 3;
const MIN_HEAT = 5;
/** A fight this close to the camera's target is the one being watched. */
const HERE = 45;
/** How far in from the view's edge an off-screen marker sits, pixels. */
const EDGE = 38;
/** A marker floats this far over the fight, metres. */
const LIFT = 7;

// The arrow an off-screen marker points with, turned about the icon.
const ARROW = '<svg class="rp-hl-mark-arrow" viewBox="-20 -20 40 40" aria-hidden="true"><path d="M13 -5L20 0 13 5z"/></svg>';
// A crossed pair of rifles, 16x16: stocks down, barrels up.
const ICON = '<svg viewBox="0 0 16 16" aria-hidden="true" fill="currentColor"><path d="M1 13l2.5 2.5 3-3L4 10z"/><path d="M4.6 11.2l9.5-9.5.9.9-9.5 9.5z"/><path d="M15 13l-2.5 2.5-3-3L12 10z"/><path d="M11.4 11.2 1.9 1.7l-.9.9 9.5 9.5z"/></svg>';

export class ReplayBattleMarkers {
  constructor(highlights) {
    this.hl = highlights;
    this.ui = highlights.ui;
    this.layer = document.createElement('div');
    this.layer.className = 'rp-hl-marks';
    this.ui.tags.after(this.layer);
    this.nodes = new Map();
    this.v = null;
    this.layer.addEventListener('click', e => {
      const mark = e.target.closest?.('.rp-hl-mark');
      if (!mark) return;
      e.stopPropagation();
      const node = [...this.nodes.values()].find(n => n.el === mark);
      if (node?.track) this.hl.watchBattle(node.track);
    });
  }

  update(t, hidden) {
    const seen = new Set();
    if (!hidden) {
      const player = this.hl.player;
      const camera = player.ctx.camera;
      const V = camera.position.constructor;
      if (!this.v) this.v = new V();
      const v = this.v;
      const width = this.ui.stage.clientWidth;
      const height = this.ui.stage.clientHeight;
      const keepOut = this.keepOut(width, height);
      const target = player.camera.mode === 'free' ? null : player.camera.target?.point ?? null;
      let shown = 0;
      for (const { track, s } of this.hl.battlesAt(t)) {
        if (shown >= MAX_MARKS) break;
        if (s.heat < MIN_HEAT) continue;
        if (target && Math.hypot(target.x - s.pos[0], target.z - s.pos[2]) < s.r + HERE) continue;
        shown++;
        seen.add(track.id);
        const ground = player.ctx.groundHeight?.(s.pos[0], s.pos[2]);
        const y = Math.max(Number.isFinite(ground) ? ground : -Infinity, s.pos[1]) + LIFT;
        v.set(s.pos[0], y, s.pos[2]);
        const distance = v.distanceTo(camera.position);
        v.project(camera);
        // Behind the camera the projection mirrors: point the arrow the
        // other way.
        const behind = v.z > 1;
        let x = (v.x + 1) / 2 * width;
        let yPx = (1 - v.y) / 2 * height;
        if (behind) {
          x = width - x;
          yPx = height - yPx;
        }
        // The box markers keep to: the view less the bar under it.
        const top = EDGE;
        const bottom = height - keepOut.bar - EDGE;
        const inside = !behind && x >= EDGE && x <= width - EDGE && yPx >= top && yPx <= bottom;
        let angle = 0;
        if (!inside) {
          const cx = width / 2;
          const cy = (top + bottom) / 2;
          let dx = x - cx;
          let dy = yPx - cy;
          if (behind && Math.hypot(dx, dy) < 1) dy = 1;
          angle = Math.atan2(dy, dx);
          // Onto the edge of the inset box, along the line from the centre.
          const sx = (width / 2 - EDGE) / Math.max(1e-6, Math.abs(dx));
          const sy = ((bottom - top) / 2) / Math.max(1e-6, Math.abs(dy));
          const k = Math.min(sx, sy);
          dx *= k;
          dy *= k;
          x = cx + dx;
          yPx = cy + dy;
        }
        // Not under the game's minimap: below it instead.
        const mm = keepOut.minimap;
        if (mm && x > mm.left - EDGE && yPx < mm.bottom + EDGE) yPx = mm.bottom + EDGE;
        let node = this.nodes.get(track.id);
        if (!node) {
          const mark = document.createElement('button');
          mark.type = 'button';
          mark.className = 'rp-hl-mark';
          mark.innerHTML = `<span class="rp-hl-mark-icon">${ARROW}${ICON}</span>`
            + '<span class="rp-hl-mark-label"></span><small></small>';
          this.layer.append(mark);
          node = { el: mark, track, label: mark.querySelector('.rp-hl-mark-label'), small: mark.querySelector('small'),
                   arrow: mark.querySelector('.rp-hl-mark-arrow'), text: '', dist: '' };
          this.nodes.set(track.id, node);
        }
        node.track = track;
        const fight = contested(s);
        const colour = fight ? '#f0913c' : s.teams[1] >= s.teams[2] ? 'rgb(247, 52, 49)' : 'rgb(75, 126, 252)';
        const people = s.pids.length;
        const text = `${fight ? 'Battle' : 'Gunfire'}${people > 1 ? ` · ${people}` : ''}`;
        if (node.text !== text) {
          node.text = text;
          node.label.textContent = text;
        }
        const dist = `${Math.round(distance)} m`;
        if (node.dist !== dist) {
          node.dist = dist;
          node.small.textContent = dist;
        }
        node.el.style.setProperty('--mk', colour);
        node.el.title = `${this.hl.model.placeOf(s.pos)}: click to watch`;
        node.el.classList.toggle('edge', !inside);
        node.arrow.style.transform = inside ? '' : `rotate(${angle}rad)`;
        node.el.style.transform = `translate(${x.toFixed(1)}px, ${yPx.toFixed(1)}px) translate(-50%, -13px)`;
        node.el.style.opacity = String(Math.min(1, 0.7 + s.heat / 40).toFixed(2));
        if (node.el.style.display) node.el.style.display = '';
      }
    }
    for (const [id, node] of this.nodes) {
      if (seen.has(id)) continue;
      node.el.remove();
      this.nodes.delete(id);
    }
  }

  /** What markers keep clear of: the replay's bar and the game's minimap
   *  (map.css `#minimap`), measured once a second, in stage pixels. */
  keepOut(width, height) {
    const now = performance.now();
    if (this.kept && now - this.kept.at < 1000 && this.kept.w === width && this.kept.h === height) return this.kept;
    const stage = this.ui.stage.getBoundingClientRect();
    const box = document.getElementById('minimap');
    const r = box && !box.hidden ? box.getBoundingClientRect() : null;
    this.kept = {
      at: now, w: width, h: height,
      bar: (this.ui.bar?.offsetHeight ?? 80) + 16,
      minimap: r && r.width ? { left: r.left - stage.left, bottom: r.bottom - stage.top } : null,
    };
    return this.kept;
  }

  dispose() {
    this.layer.remove();
    this.nodes.clear();
  }
}
