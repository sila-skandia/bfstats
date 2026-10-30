// Battle markers over the replay's 3D view (features/round-replay-
// highlights): the fights burning elsewhere, each marked where it is --
// pinned over it when it is in view, held at the edge of the screen with an
// arrow toward it when it is not -- the way modern shooters mark an
// objective. A click watches the fight. The fight the followed player is in
// is not marked: the camera is already there.
//
// Since features/round-replay-fronts a marker is a front's (replay-fronts.js):
// "Sawmill · 8 fighting", where its fight is, so the free camera can find a
// fight through fog that hides it from 200 m (Bocage). A burning battle at no
// front keeps its own marker, as before. Enter in the free camera goes into
// the front the view faces (`facing`).

import { contested } from './replay-battles.js';
import { fightAt, heatAt, LIVE_HEAT, peopleAt } from './replay-fronts.js';

/** At most this many markers, the hottest fights; none below MIN_HEAT. */
const MAX_MARKS = 4;
/** A front's head count is read this often, seconds. */
const COUNT_TICK = 0.5;
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
      if (node?.front) this.hl.watchFront(node.front);
      else if (node?.track) this.hl.watchBattle(node.track);
    });
    this.counts = new Map();
    this.countAt = -Infinity;
  }

  /** What is marked at `t`: each burning front's fight, then any burning
   *  battle at none of them, hottest first. `{ key, pos, heat, front?,
   *  track?, s? }`. */
  wanted(t) {
    const model = this.hl.model;
    const out = [];
    const fronts = model.fronts.fronts;
    for (const front of fronts) {
      const heat = heatAt(front, t);
      if (heat < LIVE_HEAT) continue;
      const fight = fightAt(front, model.battles, model.points, t);
      out.push({ key: `front:${front.id}`, pos: fight.pos, r: fight.r, heat, front });
    }
    for (const { track, s } of this.hl.battlesAt(t)) {
      if (s.heat < MIN_HEAT) continue;
      const atFront = this.hl.frontNear(s.pos);
      if (atFront && fronts.includes(atFront)) continue;
      out.push({ key: `battle:${track.id}`, pos: s.pos, r: s.r, heat: s.heat, track, s });
    }
    return out.sort((a, b) => b.heat - a.heat);
  }

  /** How many are in each front's fight, read every COUNT_TICK seconds of
   *  the round. */
  countOf(front, pos, t) {
    if (Math.abs(t - this.countAt) >= COUNT_TICK) {
      this.counts.clear();
      this.countAt = t;
    }
    let n = this.counts.get(front.id);
    if (n === undefined) {
      n = peopleAt(this.hl.player.rec, pos, t, { where: this.hl.model.where }).length;
      this.counts.set(front.id, n);
    }
    return n;
  }

  /** The front whose fight is nearest the middle of the view, in front of
   *  the camera, or null: what Enter goes into from the free camera. */
  facing(t = this.hl.player.time) {
    const camera = this.hl.player.ctx.camera;
    const V = camera.position.constructor;
    const v = new V();
    let best = null;
    for (const w of this.wanted(t)) {
      if (!w.front) continue;
      v.set(w.pos[0], w.pos[1], w.pos[2]);
      v.project(camera);
      if (v.z > 1 || Math.abs(v.x) > 1.2 || Math.abs(v.y) > 1.2) continue;
      const d = Math.hypot(v.x, v.y);
      if (!best || d < best.d) best = { front: w.front, d };
    }
    return best?.front ?? null;
  }

  update(t, hidden) {
    const seen = new Set();
    if (!hidden) {
      const player = this.hl.player;
      const camera = player.ctx.camera;
      const V = camera.position.constructor;
      if (!this.v) this.v = new V();
      const v = this.v;
      // The stage's size as the bar keeps it (replay-ui.js `measure`), not
      // read off the page every frame.
      const width = this.ui.stageW ?? this.ui.stage.clientWidth;
      const height = this.ui.stageH ?? this.ui.stage.clientHeight;
      const keepOut = this.keepOut(width, height);
      const target = player.camera.mode === 'free' ? null : player.camera.target?.point ?? null;
      const here = player.camera.mode === 'free' ? null : this.hl.currentFront(t);
      let shown = 0;
      for (const w of this.wanted(t)) {
        if (shown >= MAX_MARKS) break;
        if (w.front && w.front === here) continue;
        if (target && Math.hypot(target.x - w.pos[0], target.z - w.pos[2]) < w.r + HERE) continue;
        shown++;
        seen.add(w.key);
        const ground = player.ctx.groundHeight?.(w.pos[0], w.pos[2]);
        const y = Math.max(Number.isFinite(ground) ? ground : -Infinity, w.pos[1]) + LIFT;
        v.set(w.pos[0], y, w.pos[2]);
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
        // The box markers keep to: the view less the bar under it and the
        // fronts' tabs over it.
        const top = Math.max(EDGE, keepOut.tabs + EDGE);
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
        // A front's name stays whole on screen at the edge.
        if (w.front && !inside) {
          const half = (w.front.name.length * 6.5 + 14) / 2;
          x = Math.min(width - half - 4, Math.max(half + 4, x));
        }
        let node = this.nodes.get(w.key);
        if (!node) {
          const mark = document.createElement('button');
          mark.type = 'button';
          mark.className = 'rp-hl-mark';
          mark.innerHTML = `<span class="rp-hl-mark-icon">${ARROW}${ICON}</span>`
            + '<span class="rp-hl-mark-label"></span><small></small>';
          this.layer.append(mark);
          node = { el: mark, label: mark.querySelector('.rp-hl-mark-label'), small: mark.querySelector('small'),
                   arrow: mark.querySelector('.rp-hl-mark-arrow'), text: '', dist: '' };
          this.nodes.set(w.key, node);
        }
        node.track = w.track ?? null;
        node.front = w.front ?? null;
        let colour = '#f0913c';
        let text;
        if (w.front) {
          const n = this.countOf(w.front, w.pos, t);
          text = inside && n ? `${w.front.name} · ${n} fighting` : w.front.name;
        } else {
          const s = w.s;
          const fight = contested(s);
          if (!fight) colour = s.teams[1] >= s.teams[2] ? 'rgb(247, 52, 49)' : 'rgb(75, 126, 252)';
          const people = s.pids.length;
          text = `${fight ? 'Battle' : 'Gunfire'}${people > 1 ? ` · ${people}` : ''}`;
        }
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
        node.el.title = w.front ? `${w.front.name}: click to watch the fight from above` : `${this.hl.model.placeOf(w.pos)}: click to watch`;
        node.el.classList.toggle('edge', !inside);
        node.el.classList.toggle('front', Boolean(w.front));
        node.arrow.style.transform = inside ? '' : `rotate(${angle}rad)`;
        node.el.style.transform = `translate(${x.toFixed(1)}px, ${yPx.toFixed(1)}px) translate(-50%, -13px)`;
        node.el.style.opacity = String(Math.min(1, 0.7 + w.heat / 40).toFixed(2));
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
    const tabs = this.hl.tabs && !this.hl.tabs.hidden ? this.hl.tabs.getBoundingClientRect() : null;
    this.kept = {
      at: now, w: width, h: height,
      bar: (this.ui.bar?.offsetHeight ?? 80) + 16,
      tabs: tabs && tabs.height ? tabs.bottom - stage.top : 0,
      minimap: r && r.width ? { left: r.left - stage.left, bottom: r.bottom - stage.top } : null,
    };
    return this.kept;
  }

  dispose() {
    this.layer.remove();
    this.nodes.clear();
  }
}
