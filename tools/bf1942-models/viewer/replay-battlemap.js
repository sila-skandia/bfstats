// The replay's battle map (M; features/round-replay-highlights): the
// level's own map art with the round drawn live on it -- every player where
// the recording has him (hollow where he was only last seen), the fights as
// heat, the shots as tracers, the kills where they fell, the flags in their
// owners' colours, and the ring of what the recording could see -- the way a
// modern replay's tactical map (PUBG's, CS2's 2D radar) shows a whole round
// at once. Click a player to follow him, a fight to watch it, anywhere else
// to fly the free camera there. Beside it: the fights burning now, who is on
// a streak, the vehicles in play and who stands apart; and the round's top
// plays, one click from being watched, or all of them as a reel.

import { contested, headingAt, toView } from './replay-battles.js';
import { controlledAt, lifeAt, positionAt } from './replay-recording.js';
import { pointsAt } from './replay-chapters.js';
import { medalSvg, tierColour } from './replay-callouts.js';

/** The recording's reach past the level's view distance (the server's
 *  cut measured 407-416 m for Kursk's 400, ~520 for Wake's 500). */
const RANGE_SLACK = 1.04;
/** Tracers drawn for rounds this young, seconds, and this long, metres. */
const TRACER_AGE = 0.45;
const TRACER_LEN = 45;
const TRACER_HEAVY = 90;
const HEAVY = /GunBarrel|Cannon|Bomb|Rocket|Torpedo|shreck|Bazooka|Flak|Mortar|Hatsuzuki|Fletcher|Destroyer/i;
/** Kills stay marked this long, seconds. */
const KILL_AGE = 10;
/** The list beside the map is refreshed this often, seconds. */
const LIST_TICK = 0.25;
/** A drag of more than this is a pan, not a click, pixels. */
const CLICK_SLOP = 4;
const ZOOM_MAX = 5;
/** A fight's glow at most this wide however far in the map is, pixels. */
const HEAT_MAX_PX = 120;

const TEAM_RGB = { 1: [247, 52, 49], 2: [75, 126, 252], 0: [176, 176, 170] };
const rgba = (team, a) => {
  const [r, g, b] = TEAM_RGB[team === 1 || team === 2 ? team : 0];
  return `rgba(${r}, ${g}, ${b}, ${a})`;
};

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const fmt = s => {
  const v = Math.max(0, Math.floor(s));
  return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`;
};

// The list's icons, 16x16.
const ICON = {
  fight: '<path d="M1 13l2.5 2.5 3-3L4 10z"/><path d="M4.6 11.2l9.5-9.5.9.9-9.5 9.5z"/><path d="M15 13l-2.5 2.5-3-3L12 10z"/><path d="M11.4 11.2 1.9 1.7l-.9.9 9.5 9.5z"/>',
  map: '<path d="M1.5 3.6 5.5 2l5 1.6 4-1.6v10.4l-4 1.6-5-1.6-4 1.6z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M5.5 2v10.4M10.5 3.6V14" stroke="currentColor" stroke-width="1.2"/>',
  streak: '<path d="M8 1c1.9 2.7 4.1 4.3 3.7 8-.3 2.8-2 5-3.7 5-2 0-3.8-1.7-3.8-4.1 0-2.1 1.3-3.1 2.2-4.6.4 1.6 1 2.3 1.8 2.6.4-2 .1-4.4-.2-6.9z"/>',
  lead: '<path d="M1.8 12.5h12.4l1-7.6-3.9 3L8 2.5 4.7 7.9l-3.9-3z"/>',
  lone: '<circle cx="8" cy="5" r="2.6"/><path d="M3.4 14.5c.3-3.2 2.1-5 4.6-5s4.3 1.8 4.6 5z"/>',
  behind: '<path d="M3 1.5h1.6v13H3z"/><path d="M4.6 2h8.6l-2.4 3 2.4 3H4.6z"/>',
  far: '<circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="2 2"/><circle cx="8" cy="8" r="1.8"/>',
  nest: '<circle cx="8" cy="8" r="5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M8 1v4M8 11v4M1 8h4M11 8h4" stroke="currentColor" stroke-width="1.6"/>',
  tank: '<path d="M1.5 9h13v3.5h-13zM4 5.5h6.5V9H4zM10.5 6.6h4.5v1.3h-4.5z"/>',
  car: '<path d="M2 8.5l1.6-3.6h7.2l2.6 3.6H15v3H1v-3zM4 13a1.3 1.3 0 1 0 0-.1zM12 13a1.3 1.3 0 1 0 0-.1z"/>',
  air: '<path d="M8 1l1.2 5 5.8 2.2v1.3L9.1 8.6 8.7 12.5l1.9 1.3V15L8 14.2 5.4 15v-1.2l1.9-1.3-.4-3.9-5.9.9V8.2L6.8 6z"/>',
  sea: '<path d="M1 9.5h14l-2.2 3.5H3.2zM5 6.5h5V9.5H5zM7 3.5h1.3v3H7z"/>',
  gun: '<path d="M3 10h7v4H3zM6 9l7.5-5 .8 1.2L7.2 10z"/>',
  soldier: '<circle cx="8" cy="4.5" r="2.3"/><path d="M5 15l.7-5.8L4 9l1-3.3h6L12 9l-1.7.2L11 15H9.1L8 10.5 6.9 15z"/>',
  play: '<path d="M4.5 2.5v11l9-5.5z"/>',
};
const icon = name => `<svg viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">${ICON[name] ?? ''}</svg>`;

/** Who is in a fight, by side; a fight known only by the hits it made (a
 *  hull losing points to someone out of the recording's range) says so. */
function sides(hl, s) {
  const count = team => s.pids.filter(pid => hl.team(pid) === team).length;
  const axis = count(1);
  const allies = count(2);
  return axis || allies ? `Axis ${axis} · Allies ${allies}` : 'vehicles under fire';
}

const STANDOUT_WORD = {
  lone: 'Lone wolf',
  behind: 'Behind enemy lines',
  far: 'Far from the fight',
  nest: 'Sniper nest',
};

export class ReplayBattleMap {
  constructor(highlights) {
    this.hl = highlights;
    this.ui = highlights.ui;
    this.player = highlights.player;
    this.ctx = highlights.ctx;
    this.open = false;
    this.zoom = 1;
    this.center = [0.5, 0.5];
    this.hits = [];
    this.hover = null;          // what the pointer is over on the map
    this.listHover = null;      // the list row the pointer is over: { kind, id }
    this.listClock = LIST_TICK;
    this.listKeys = {};
    this.tab = 'now';
    this.build();
  }

  // --- building -----------------------------------------------------------------

  build() {
    const ui = this.ui;
    this.panel = el('div', 'rp-panel rp-bm');
    const head = el('div', 'rp-panel-head');
    const title = el('span', '', 'Battle map');
    const legend = el('span', 'rp-bm-legend');
    legend.innerHTML = '<span><i style="background:rgb(247,52,49)"></i>Axis</span>'
      + '<span><i style="background:rgb(75,126,252)"></i>Allies</span>'
      + '<span><i style="background:radial-gradient(circle,#ffb040,#e0503c)"></i>Fighting</span>'
      + '<span><i style="background:transparent;border:1.5px solid #3a3a2c"></i>Last seen</span>';
    const close = ui.button('', 'close', 'Close (M)', () => this.close());
    head.append(title, legend, close);
    const body = el('div', 'rp-bm-body');
    this.view = el('div', 'rp-bm-view');
    this.canvas = el('canvas');
    this.tip = el('div', 'rp-bm-tip');
    const hint = el('div', 'rp-bm-hint', 'Click a player to follow him, a fight to watch it, the ground to fly there. Wheel zooms, drag pans.');
    this.view.append(this.canvas, this.tip, hint);
    const side = el('div', 'rp-bm-side');
    const tabs = el('div', 'rp-bm-tabs');
    this.tabNow = ui.button('on', null, 'Now', () => this.setTab('now'), 'Now');
    this.tabPlays = ui.button('', null, 'Highlights', () => this.setTab('plays'), 'Highlights');
    tabs.append(this.tabNow, this.tabPlays);
    this.paneNow = el('div', 'rp-bm-pane');
    this.sections = {};
    for (const [key, heading] of [['battles', 'Battles now'], ['streaks', 'On a streak'], ['vehicles', 'Vehicles'],
      ['standouts', 'Standing apart']]) {
      const sec = el('div', 'rp-bm-sec');
      const list = el('div');
      sec.append(el('h4', '', heading), list);
      this.paneNow.append(sec);
      this.sections[key] = list;
    }
    this.panePlays = el('div', 'rp-bm-pane');
    this.panePlays.hidden = true;
    this.buildPlays();
    side.append(tabs, this.paneNow, this.panePlays);
    body.append(this.view, side);
    this.panel.append(head, body);
    ui.board.after(this.panel);

    // The bar's own button for it.
    this.button = ui.button('', null, 'Battle map (M)', () => this.toggle(),
      `${icon('map')}<span class="rp-hide-narrow">Map</span>`);
    ui.playersBtn.before(this.button);

    side.addEventListener('click', e => {
      const row = e.target.closest?.('[data-kind]');
      if (!row) return;
      e.stopPropagation();
      this.activate(row.dataset.kind, row.dataset.id);
    });
    side.addEventListener('pointerover', e => {
      const row = e.target.closest?.('[data-kind]');
      this.listHover = row ? { kind: row.dataset.kind, id: row.dataset.id } : null;
    });
    side.addEventListener('pointerleave', () => { this.listHover = null; });
    this.panel.addEventListener('pointerdown', e => e.stopPropagation());
    this.bindCanvas();
    this.sizes = new ResizeObserver(() => this.fit());
    this.sizes.observe(this.view);
  }

  buildPlays() {
    const plays = this.hl.model.plays;
    const bar = el('div', 'rp-bm-play');
    const go = this.ui.button('', 'play', 'Play the highlights', () => {
      this.close();
      this.hl.playReel(0);
    }, 'Play the highlights');
    const shown = plays.filter(p => p.fresh).length;
    bar.append(go, el('span', '', shown ? `${shown} plays` : 'no plays the recording saw'));
    go.disabled = !shown;
    const list = el('div');
    this.playDetails = [];
    plays.forEach((p, i) => {
      const row = el('button', `rp-bm-row${p.fresh ? '' : ' far'}`);
      row.type = 'button';
      if (!p.fresh) row.title = "Beyond the recording player's view distance: the recording has only where he was last seen";
      row.dataset.kind = 'play';
      row.dataset.id = String(i);
      const ic = el('span', 'ic');
      ic.innerHTML = p.best ? medalSvg(p.best) : icon('fight');
      ic.style.color = p.best ? tierColour(p.score) : '#f0913c';
      const tx = el('span', 'tx');
      tx.append(el('b', `t${this.hl.team(p.pid)}`, `${p.title}: ${this.hl.name(p.pid)}`));
      const detail = el('span');
      this.playDetails.push({ node: detail, play: p });
      tx.append(detail);
      row.append(ic, tx, el('time', '', fmt(p.t)));
      list.append(row);
    });
    this.panePlays.append(bar, list);
  }

  setTab(tab) {
    this.tab = tab;
    this.paneNow.hidden = tab !== 'now';
    this.panePlays.hidden = tab !== 'plays';
    this.tabNow.classList.toggle('on', tab === 'now');
    this.tabPlays.classList.toggle('on', tab === 'plays');
    if (tab === 'plays') this.fillPlayDetails();
  }

  /** The plays' lines, in the lexicon's words once it has loaded. */
  fillPlayDetails() {
    for (const { node, play } of this.playDetails ?? []) {
      const also = play.medals.filter(m => m !== play.best).map(m => m.label);
      const text = play.best ? `${this.hl.describe(play.best)}${also.length ? ` · ${[...new Set(also)].join(', ')}` : ''}`
        : `${this.hl.model.placeOf(play.pos)}${play.battle?.kills ? `, ${play.battle.kills} down` : ''}`;
      if (node.textContent !== text) node.textContent = text;
    }
  }

  // --- open and shut ----------------------------------------------------------------

  toggle() {
    if (this.open) this.close();
    else this.show();
  }

  show() {
    const root = this.ui.root;
    // One overlay in the middle at a time.
    root.classList.remove('board-open', 'help-open');
    this.ui.playersBtn.classList.remove('on');
    this.open = true;
    root.classList.add('map-open');
    this.button.classList.add('on');
    this.listKeys = {};
    this.listClock = LIST_TICK;
    this.fit();
    if (this.tab === 'plays') this.fillPlayDetails();
  }

  close() {
    if (!this.open) return;
    this.open = false;
    this.ui.root.classList.remove('map-open');
    this.button.classList.remove('on');
    this.tip.style.display = 'none';
    this.hover = null;
  }

  /** A row of the list: a player followed, a fight watched, a play replayed. */
  activate(kind, id) {
    const hl = this.hl;
    if (kind === 'player') {
      this.close();
      hl.follow(Number(id));
    } else if (kind === 'battle') {
      const track = hl.model.battles.find(b => b.id === Number(id));
      if (!track) return;
      this.close();
      hl.watchBattle(track);
    } else if (kind === 'play') {
      const play = hl.model.plays[Number(id)];
      if (!play) return;
      this.close();
      hl.replay(play.pid, play.t0);
    }
  }

  // --- the map's frame ------------------------------------------------------------------

  fit() {
    const w = this.view.clientWidth;
    const h = this.view.clientHeight;
    if (!w || !h) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.dpr = dpr;
    this.cw = w;
    this.ch = h;
    const bw = Math.round(w * dpr);
    const bh = Math.round(h * dpr);
    if (this.canvas.width !== bw || this.canvas.height !== bh) {
      this.canvas.width = bw;
      this.canvas.height = bh;
    }
  }

  /** The level's projection onto its map art (`extras.minimap.worldToImage`,
   *  u and v 0..1 from the top left for the viewer's x and z), else a square
   *  round the control points and every recorded position. */
  projection() {
    const m = this.ctx.mapProjection?.();
    if (Array.isArray(m) && m.length >= 6 && (m[0] || m[1])) return m;
    if (this.fallback) return this.fallback;
    let x0 = Infinity; let x1 = -Infinity; let z0 = Infinity; let z1 = -Infinity;
    const grow = p => {
      x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]);
      z0 = Math.min(z0, p[2]); z1 = Math.max(z1, p[2]);
    };
    for (const p of this.hl.model.points) if (p.pos) grow(p.pos);
    for (const life of this.player.rec.lives) {
      if (!life.keys.length || (!life.soldier && life.kit)) continue;
      grow(toView(life.keys[0].p));
      grow(toView(life.keys[life.keys.length - 1].p));
    }
    if (!Number.isFinite(x0)) { x0 = 0; x1 = 1024; z0 = 0; z1 = 1024; }
    const size = Math.max(x1 - x0, z1 - z0) * 1.15 + 50;
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    this.fallback = [1 / size, 0, 0.5 - cx / size, 0, 1 / size, 0.5 - cz / size];
    return this.fallback;
  }

  /** The art's side on screen and its top left, CSS pixels. */
  frame() {
    const side = Math.min(this.cw, this.ch) * this.zoom;
    return { side, x0: this.cw / 2 - this.center[0] * side, y0: this.ch / 2 - this.center[1] * side };
  }

  toScreen(pos, f = this.frame(), m = this.projection()) {
    const u = m[0] * pos[0] + m[1] * pos[2] + m[2];
    const v = m[3] * pos[0] + m[4] * pos[2] + m[5];
    return [f.x0 + u * f.side, f.y0 + v * f.side];
  }

  /** Screen back to the level: `[x, y, z]` in the viewer's frame (y unknown,
   *  0). */
  toWorld(px, py) {
    const f = this.frame();
    const m = this.projection();
    const u = (px - f.x0) / f.side - m[2];
    const v = (py - f.y0) / f.side - m[5];
    const det = m[0] * m[4] - m[1] * m[3];
    if (!det) return null;
    return [(u * m[4] - m[1] * v) / det, 0, (m[0] * v - m[3] * u) / det];
  }

  /** The map art's grid square under a place, the way the art letters it:
   *  A-H across, 1-8 down (map-surfaces.js `gridRef`); null off the art. */
  gridRef(pos) {
    const m = this.projection();
    const u = m[0] * pos[0] + m[1] * pos[2] + m[2];
    const v = m[3] * pos[0] + m[4] * pos[2] + m[5];
    if (!(u >= 0 && u <= 1 && v >= 0 && v <= 1)) return null;
    return `${'ABCDEFGH'[Math.min(7, Math.floor(u * 8))]}${Math.min(7, Math.floor(v * 8)) + 1}`;
  }

  /** A ground direction `[dx, dz]` as a screen angle (y down). */
  screenAngle(dir, m = this.projection()) {
    return Math.atan2(m[3] * dir[0] + m[4] * dir[1], m[0] * dir[0] + m[1] * dir[1]);
  }

  /** Metres as screen pixels, along the art's u axis. */
  metres(d, f = this.frame(), m = this.projection()) {
    return d * Math.hypot(m[0], m[3]) * f.side;
  }

  // --- the pointer ----------------------------------------------------------------------

  bindCanvas() {
    const c = this.canvas;
    let drag = null;
    const local = e => {
      const r = c.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    };
    c.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      const [x, y] = local(e);
      drag = { id: e.pointerId, x, y, sx: x, sy: y, moved: false };
      try { c.setPointerCapture(e.pointerId); } catch {}
    });
    c.addEventListener('pointermove', e => {
      const [x, y] = local(e);
      this.ui.activity();
      if (drag && e.pointerId === drag.id) {
        if (!drag.moved && Math.hypot(x - drag.sx, y - drag.sy) > CLICK_SLOP) {
          drag.moved = true;
          c.classList.add('dragging');
        }
        if (drag.moved) {
          const side = Math.min(this.cw, this.ch) * this.zoom;
          this.center[0] -= (x - drag.x) / side;
          this.center[1] -= (y - drag.y) / side;
          this.clampCenter();
        }
        drag.x = x;
        drag.y = y;
        return;
      }
      this.pointer = [x, y];
    });
    const up = e => {
      if (!drag || e.pointerId !== drag.id) return;
      const click = !drag.moved;
      drag = null;
      c.classList.remove('dragging');
      try { c.releasePointerCapture(e.pointerId); } catch {}
      if (click && e.type === 'pointerup') this.pick(...local(e));
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    c.addEventListener('pointerleave', () => {
      this.pointer = null;
      this.hover = null;
      this.tip.style.display = 'none';
    });
    c.addEventListener('wheel', e => {
      e.preventDefault();
      e.stopPropagation();
      const [x, y] = local(e);
      const before = this.frame();
      const u = (x - before.x0) / before.side;
      const v = (y - before.y0) / before.side;
      const scale = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1;
      this.zoom = Math.min(ZOOM_MAX, Math.max(1, this.zoom * Math.exp(-e.deltaY * scale * 0.001)));
      // The point under the pointer stays under it.
      const side = Math.min(this.cw, this.ch) * this.zoom;
      this.center[0] = u - (x - this.cw / 2) / side;
      this.center[1] = v - (y - this.ch / 2) / side;
      this.clampCenter();
    }, { passive: false });
    c.addEventListener('dblclick', () => {
      this.zoom = 1;
      this.center = [0.5, 0.5];
    });
  }

  clampCenter() {
    const half = 0.5 / this.zoom;
    for (const i of [0, 1]) this.center[i] = Math.min(1 - half + 0.25, Math.max(half - 0.25, this.center[i]));
    if (this.zoom <= 1) this.center = [0.5, 0.5];
  }

  /** What is under a screen point: a player, then a fight, then a flag. */
  hitAt(x, y) {
    let best = null;
    for (const h of this.hits) {
      const d = Math.hypot(h.x - x, h.y - y);
      if (d > h.r) continue;
      const rank = h.type === 'player' ? 0 : h.type === 'battle' ? 1 : 2;
      if (!best || rank < best.rank || (rank === best.rank && d < best.d)) best = { h, d, rank };
    }
    return best?.h ?? null;
  }

  pick(x, y) {
    const h = this.hitAt(x, y);
    if (h?.type === 'player') {
      this.close();
      this.hl.follow(h.pid);
      return;
    }
    if (h?.type === 'battle') {
      this.close();
      this.hl.watchBattle(h.track);
      return;
    }
    const at = h?.type === 'point' ? h.pos : this.toWorld(x, y);
    if (!at) return;
    this.close();
    this.hl.flyTo(at);
  }

  // --- per frame ------------------------------------------------------------------------

  update(t, dt) {
    if (!this.open) return;
    if (!this.cw) this.fit();
    if (!this.cw) return;
    this.draw(t);
    this.listClock += dt;
    if (this.listClock >= LIST_TICK) {
      this.listClock = 0;
      this.renderLists(t);
    }
    this.updateTip(t);
  }

  /** Where the recording player's client was at `t`: the centre of what the
   *  recording could see. */
  recorderAt(t) {
    const pid = this.player.recordingPid;
    if (pid === null || pid === undefined) return null;
    const w = this.hl.model.where(pid, t);
    if (w.pos) return w.pos;
    const rec = this.player.rec;
    const nid = controlledAt(rec, pid, t);
    const life = nid !== null ? lifeAt(rec, nid, t) : null;
    const p = life ? positionAt(life, t) : null;
    return p ? toView(p) : null;
  }

  draw(t) {
    const g = this.canvas.getContext('2d');
    const dpr = this.dpr;
    const W = this.cw;
    const H = this.ch;
    const f = this.frame();
    const m = this.projection();
    const model = this.hl.model;
    const rec = this.player.rec;
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 260);
    this.hits = [];
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#0b0d0c';
    g.fillRect(0, 0, W, H);

    // The art, or a grid where there is none.
    const art = this.ctx.mapArt?.();
    if (art?.width) {
      g.globalAlpha = 0.92;
      g.imageSmoothingEnabled = true;
      g.drawImage(art, f.x0, f.y0, f.side, f.side);
      g.globalAlpha = 1;
    } else {
      g.strokeStyle = 'rgba(200, 194, 152, .12)';
      g.lineWidth = 1;
      for (let i = 0; i <= 8; i++) {
        const k = i / 8;
        g.beginPath();
        g.moveTo(f.x0 + k * f.side, f.y0);
        g.lineTo(f.x0 + k * f.side, f.y0 + f.side);
        g.moveTo(f.x0, f.y0 + k * f.side);
        g.lineTo(f.x0 + f.side, f.y0 + k * f.side);
        g.stroke();
      }
    }

    // What the recording could see: the rest of the level dimmed.
    const range = this.ctx.viewDistance?.();
    const centre = Number.isFinite(range) && range > 0 ? this.recorderAt(t) : null;
    if (centre) {
      const [cx, cy] = this.toScreen(centre, f, m);
      const r = this.metres(range * RANGE_SLACK, f, m);
      g.beginPath();
      g.rect(0, 0, W, H);
      g.arc(cx, cy, r, 0, Math.PI * 2, true);
      g.fillStyle = 'rgba(4, 5, 4, .5)';
      g.fill('evenodd');
      g.beginPath();
      g.arc(cx, cy, r, 0, Math.PI * 2);
      g.setLineDash([5, 5]);
      g.strokeStyle = 'rgba(232, 195, 90, .45)';
      g.lineWidth = 1.2;
      g.stroke();
      g.setLineDash([]);
      g.font = '700 9px Trebuchet MS, sans-serif';
      g.fillStyle = 'rgba(232, 195, 90, .7)';
      g.textAlign = 'center';
      g.fillText('RECORDED RANGE', cx, cy - r - 5);
    }

    // The fights, as heat.
    const battles = this.hl.battlesAt(t);
    g.globalCompositeOperation = 'lighter';
    for (const { track, s } of battles) {
      const [x, y] = this.toScreen(s.pos, f, m);
      // At least a fingertip across however far out the map is, growing
      // with the heat, and pulsing.
      const r = Math.min(HEAT_MAX_PX, Math.max(18 + Math.min(22, s.heat * 0.6), this.metres(s.r * 1.8, f, m))) * (1 + 0.08 * pulse);
      // Paler as it grows, so a close look still shows the men in it.
      const a = Math.min(0.95, 0.4 + s.heat / 30) * Math.min(1, 55 / r);
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      if (contested(s)) {
        grad.addColorStop(0, `rgba(255, 196, 90, ${a})`);
        grad.addColorStop(0.45, `rgba(240, 110, 50, ${a * 0.6})`);
        grad.addColorStop(1, 'rgba(200, 50, 30, 0)');
      } else {
        const team = s.teams[1] >= s.teams[2] ? 1 : 2;
        grad.addColorStop(0, rgba(team, a * 0.8));
        grad.addColorStop(1, rgba(team, 0));
      }
      g.fillStyle = grad;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
      this.hits.push({ type: 'battle', track, s, x, y, r: Math.max(14, r * 0.7) });
    }
    g.globalCompositeOperation = 'source-over';
    // A ring round each fight that swells as it burns, like a ping.
    for (const h of this.hits) {
      if (h.type !== 'battle') continue;
      const k = (performance.now() / 1400 + h.track.id * 0.37) % 1;
      g.beginPath();
      g.arc(h.x, h.y, h.r * (0.5 + k * 0.9), 0, Math.PI * 2);
      g.strokeStyle = contested(h.s) ? `rgba(255, 200, 120, ${0.55 * (1 - k)})` : rgba(h.s.teams[1] >= h.s.teams[2] ? 1 : 2, 0.5 * (1 - k));
      g.lineWidth = 1.5;
      g.stroke();
    }
    const hot = this.listHover?.kind === 'battle' ? Number(this.listHover.id) : this.hover?.type === 'battle' ? this.hover.track.id : null;
    for (const h of this.hits) {
      if (h.type !== 'battle' || h.track.id !== hot) continue;
      g.beginPath();
      g.arc(h.x, h.y, h.r / 0.6, 0, Math.PI * 2);
      g.strokeStyle = 'rgba(255, 230, 170, .9)';
      g.lineWidth = 1.5;
      g.stroke();
    }

    // The flags, in their owners' colours.
    const held = pointsAt(rec, t);
    g.textAlign = 'center';
    for (const p of model.points) {
      if (!p.pos) continue;
      const [x, y] = this.toScreen(p.pos, f, m);
      const team = held.find(h => h.name === p.name)?.team ?? 0;
      g.fillStyle = 'rgba(10, 10, 9, .8)';
      g.beginPath();
      g.arc(x, y, 7.5, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = rgba(team, 0.95);
      g.lineWidth = 1.6;
      g.stroke();
      g.fillStyle = rgba(team, 1);
      g.fillRect(x - 2.5, y - 4.5, 1.4, 9);
      g.beginPath();
      g.moveTo(x - 1.1, y - 4.5);
      g.lineTo(x + 4, y - 2.5);
      g.lineTo(x - 1.1, y - 0.5);
      g.closePath();
      g.fill();
      g.font = '700 9px Trebuchet MS, sans-serif';
      g.fillStyle = 'rgba(238, 236, 217, .85)';
      g.fillText(model.display(p.name).toUpperCase(), x, y + 17);
      this.hits.push({ type: 'point', pos: p.pos, name: p.name, team, x, y, r: 9 });
    }

    // Rounds in the air.
    const fires = rec.fires;
    let i = this.fireIndex(t - TRACER_AGE);
    g.lineCap = 'round';
    for (; i < fires.length && fires[i].t <= t; i++) {
      const fire = fires[i];
      if (fire.feedOnly || !Array.isArray(fire.pos) || !Array.isArray(fire.dir)) continue;
      const dx = fire.dir[0];
      const dz = -fire.dir[2];
      const flat = Math.hypot(dx, dz);
      if (flat < 0.05) continue;
      const age = (t - fire.t) / TRACER_AGE;
      const len = HEAVY.test(fire.weapon ?? '') ? TRACER_HEAVY : TRACER_LEN;
      const from = toView(fire.pos);
      const a = this.toScreen(from, f, m);
      const b = this.toScreen([from[0] + (dx / flat) * len, 0, from[2] + (dz / flat) * len], f, m);
      const team = this.hl.team(fire.pid);
      g.strokeStyle = team ? rgba(team, 0.8 * (1 - age)) : `rgba(255, 236, 190, ${0.7 * (1 - age)})`;
      g.lineWidth = 1.2;
      g.beginPath();
      g.moveTo(a[0], a[1]);
      g.lineTo(b[0], b[1]);
      g.stroke();
    }

    // The kills, where they fell.
    for (const e of model.activity) {
      if (e.kind !== 'kill' || e.t > t || t - e.t > KILL_AGE) continue;
      const [x, y] = this.toScreen(e.pos, f, m);
      const age = (t - e.t) / KILL_AGE;
      const s = 4.5;
      g.strokeStyle = rgba(e.team, 1 - age * 0.8);
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(x - s, y - s); g.lineTo(x + s, y + s);
      g.moveTo(x + s, y - s); g.lineTo(x - s, y + s);
      g.stroke();
      if (t - e.t < 1.2) {
        const k = (t - e.t) / 1.2;
        g.beginPath();
        g.arc(x, y, 5 + k * 16, 0, Math.PI * 2);
        g.strokeStyle = `rgba(255, 240, 200, ${0.7 * (1 - k)})`;
        g.lineWidth = 1.5;
        g.stroke();
      }
    }

    // Everyone.
    const follow = this.player.followPid;
    const leader = this.hl.leaderAt(t)?.pid ?? null;
    const listPid = this.listHover?.kind === 'player' ? Number(this.listHover.id) : null;
    const hoverPid = this.hover?.type === 'player' ? this.hover.pid : null;
    const labels = [];
    for (const pid of this.hl.director.pids) {
      const w = model.where(pid, t);
      if (!w.pos) continue;
      const [x, y] = this.toScreen(w.pos, f, m);
      if (x < -20 || y < -20 || x > W + 20 || y > H + 20) continue;
      const kind = w.state === 'vehicle' ? (model.kindOf(w.life) ?? 'vehicle') : 'soldier';
      const dir = headingAt(w.life, w.fresh ? t : w.seen);
      const angle = dir ? this.screenAngle(dir, m) : null;
      const streak = this.hl.streakOf(pid, t);
      const alpha = w.fresh ? 1 : 0.4;
      if (streak >= 2 && w.fresh) {
        g.beginPath();
        g.arc(x, y, 9 + 2.5 * pulse, 0, Math.PI * 2);
        g.strokeStyle = `rgba(240, 145, 60, ${0.45 + 0.35 * pulse})`;
        g.lineWidth = 2;
        g.stroke();
      }
      this.drawMark(g, kind, x, y, angle, w.team, alpha, !w.fresh);
      const mine = pid === follow;
      if (mine || pid === listPid || pid === hoverPid) {
        g.beginPath();
        g.arc(x, y, kind === 'soldier' ? 8 : 11, 0, Math.PI * 2);
        g.strokeStyle = mine ? '#e8c35a' : 'rgba(255, 255, 255, .9)';
        g.lineWidth = 2;
        g.stroke();
      }
      if (pid === leader) this.drawCrown(g, x, y - (kind === 'soldier' ? 11 : 14));
      if (mine || streak >= 3 || pid === listPid || pid === hoverPid) {
        labels.push({ x, y, text: `${this.hl.name(pid)}${streak >= 2 ? `  ${streak}` : ''}`, team: w.team, mine });
      }
      this.hits.push({ type: 'player', pid, w, x, y, r: kind === 'soldier' ? 8 : 11 });
    }
    g.font = '700 11px Trebuchet MS, sans-serif';
    g.textAlign = 'left';
    for (const l of labels) {
      const text = l.text;
      const tw = g.measureText(text).width;
      g.fillStyle = 'rgba(10, 10, 9, .75)';
      g.fillRect(l.x + 11, l.y - 8, tw + 8, 15);
      g.fillStyle = l.mine ? '#f3e2a8' : l.team === 1 ? '#ffb0b0' : l.team === 2 ? '#b8ccff' : '#e6e6e6';
      g.fillText(text, l.x + 15, l.y + 3.5);
    }

    // The camera, where it is and where it looks.
    const cam = this.ctx.camera;
    if (cam) {
      const [x, y] = this.toScreen([cam.position.x, 0, cam.position.z], f, m);
      const d = cam.getWorldDirection(new cam.position.constructor());
      const a = this.screenAngle([d.x, d.z], m);
      g.save();
      g.translate(x, y);
      g.rotate(a);
      const fov = 0.5;
      const grad = g.createRadialGradient(0, 0, 0, 0, 0, 34);
      grad.addColorStop(0, 'rgba(255, 255, 255, .5)');
      grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
      g.fillStyle = grad;
      g.beginPath();
      g.moveTo(0, 0);
      g.arc(0, 0, 34, -fov, fov);
      g.closePath();
      g.fill();
      g.fillStyle = '#fff';
      g.beginPath();
      g.arc(0, 0, 2.5, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }
  }

  /** The first round at or after `t`. */
  fireIndex(t) {
    const fires = this.player.rec.fires;
    let lo = 0;
    let hi = fires.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (fires[mid].t < t) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /** A player's mark: a dot for a man, a shape for what he rides, turned to
   *  his heading; hollow where he was only last seen. */
  drawMark(g, kind, x, y, angle, team, alpha, hollow) {
    g.save();
    g.translate(x, y);
    if (angle !== null) g.rotate(angle);
    g.beginPath();
    switch (kind) {
      case 'soldier':
        g.arc(0, 0, 4.2, 0, Math.PI * 2);
        break;
      case 'tank':
        g.rect(-6.5, -4.5, 13, 9);
        break;
      case 'car':
        g.rect(-5.5, -3.2, 11, 6.4);
        break;
      case 'air':
        g.moveTo(8, 0); g.lineTo(-2, -8); g.lineTo(-1, -1.5); g.lineTo(-7, -3.5);
        g.lineTo(-6, 0); g.lineTo(-7, 3.5); g.lineTo(-1, 1.5); g.lineTo(-2, 8);
        g.closePath();
        break;
      case 'sea':
        g.moveTo(10, 0); g.lineTo(6, -4); g.lineTo(-9, -4); g.lineTo(-9, 4); g.lineTo(6, 4);
        g.closePath();
        break;
      case 'gun':
        g.rect(-4, -4, 8, 8);
        break;
      default:
        g.moveTo(0, -6); g.lineTo(6, 0); g.lineTo(0, 6); g.lineTo(-6, 0);
        g.closePath();
    }
    if (hollow) {
      g.strokeStyle = rgba(team, alpha + 0.2);
      g.lineWidth = 1.6;
      g.stroke();
    } else {
      g.fillStyle = rgba(team, alpha);
      g.fill();
      g.strokeStyle = 'rgba(0, 0, 0, .85)';
      g.lineWidth = 1.2;
      g.stroke();
    }
    // A man's facing, and a gun's barrel.
    if (angle !== null && !hollow) {
      g.beginPath();
      if (kind === 'soldier') { g.moveTo(3, 0); g.lineTo(9, 0); }
      else if (kind === 'tank' || kind === 'gun') { g.moveTo(3, 0); g.lineTo(12, 0); }
      g.strokeStyle = rgba(team, alpha);
      g.lineWidth = 2;
      g.stroke();
    }
    g.restore();
  }

  drawCrown(g, x, y) {
    g.save();
    g.translate(x, y);
    g.fillStyle = '#e8c35a';
    g.strokeStyle = 'rgba(0, 0, 0, .8)';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(-5, 3); g.lineTo(5, 3); g.lineTo(6, -3); g.lineTo(2.5, -0.5); g.lineTo(0, -4.5);
    g.lineTo(-2.5, -0.5); g.lineTo(-6, -3);
    g.closePath();
    g.fill();
    g.stroke();
    g.restore();
  }

  // --- the tooltip ------------------------------------------------------------------------

  updateTip(t) {
    if (!this.pointer) return;
    const [x, y] = this.pointer;
    const h = this.hitAt(x, y);
    this.hover = h;
    this.canvas.classList.toggle('over', Boolean(h && h.type !== 'point'));
    if (!h) {
      this.tip.style.display = 'none';
      return;
    }
    let html = '';
    const hl = this.hl;
    const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
    if (h.type === 'player') {
      const w = h.w;
      const what = w.state === 'vehicle' ? hl.model.display(w.life?.tmpl) : 'on foot';
      const streak = hl.streakOf(h.pid, t);
      const seen = w.fresh ? '' : `<br>last seen ${fmt(t - w.seen)} ago, out of the recording's range`;
      html = `<b class="t${w.team}">${esc(hl.name(h.pid))}</b>${esc(what)}${streak >= 2 ? ` · streak ${streak}` : ''}${seen}<br>Click to follow`;
    } else if (h.type === 'battle') {
      const s = h.s;
      const since = fmt(t - h.track.start);
      html = `<b>${esc(hl.model.placeOf(s.pos))}</b>${contested(s) ? 'Battle' : 'Gunfire'}: ${esc(sides(hl, s))}`
        + `${s.kills ? ` · ${s.kills} down` : ''}<br>for ${since} · click to watch`;
    } else {
      html = `<b class="t${h.team}">${esc(hl.model.display(h.name))}</b>${h.team === 1 ? 'Axis' : h.team === 2 ? 'Allies' : 'Neutral'} · click to fly there`;
    }
    if (this.tip.dataset.html !== html) {
      this.tip.dataset.html = html;
      this.tip.innerHTML = html;
    }
    this.tip.style.display = 'block';
    const tw = this.tip.offsetWidth;
    const th = this.tip.offsetHeight;
    this.tip.style.left = `${Math.min(this.cw - tw - 6, x + 14)}px`;
    this.tip.style.top = `${Math.max(6, Math.min(this.ch - th - 6, y - th - 8))}px`;
  }

  // --- the lists ----------------------------------------------------------------------------

  row(kind, id, iconHtml, title, detail, number, opts = {}) {
    const b = el('button', `rp-bm-row${opts.me ? ' me' : ''}`);
    b.type = 'button';
    b.dataset.kind = kind;
    b.dataset.id = String(id);
    const ic = el('span', `ic ${opts.iconClass ?? ''}`.trim());
    ic.innerHTML = iconHtml;
    const tx = el('span', 'tx');
    tx.append(el('b', opts.team ? `t${opts.team}` : '', title));
    if (detail) tx.append(el('span', '', detail));
    if (opts.heat !== undefined) {
      const bar = el('span', 'rp-bm-heatbar');
      const fill = el('i');
      fill.style.width = `${Math.round(opts.heat * 100)}%`;
      bar.append(fill);
      tx.append(bar);
    }
    b.append(ic, tx, el('span', `nb${opts.hot ? ' hot' : ''}`, number ?? ''));
    return b;
  }

  fill(key, rows, empty) {
    const list = this.sections[key];
    const sig = JSON.stringify(rows.map(r => r.sig));
    if (this.listKeys[key] === sig) return;
    this.listKeys[key] = sig;
    list.textContent = '';
    if (!rows.length) {
      list.append(el('div', 'none', empty));
      return;
    }
    for (const r of rows) list.append(r.node());
  }

  renderLists(t) {
    if (this.tab !== 'now') return;
    const hl = this.hl;
    const model = hl.model;
    const follow = this.player.followPid;

    // The fights.
    const battles = hl.battlesAt(t).filter(b => b.s.heat >= 3).slice(0, 5);
    const top = Math.max(1, ...battles.map(b => b.s.heat));
    this.fill('battles', battles.map(({ track, s }) => {
      const detail = `${sides(hl, s)} · ${fmt(t - track.start)}`;
      const place = model.placeOf(s.pos);
      const heat = s.heat / top;
      return {
        sig: [track.id, place, detail, Math.round(heat * 10), s.kills],
        node: () => this.row('battle', track.id, icon('fight'), `${contested(s) ? 'Battle' : 'Gunfire'}: ${place}`, detail,
          s.kills ? `${s.kills} down` : '', { heat, iconClass: 'fight' }),
      };
    }), 'No fighting right now');

    // On a streak, and the leader.
    const leader = hl.leaderAt(t);
    const streaks = [];
    for (const pid of hl.director.pids) {
      const n = hl.streakOf(pid, t);
      if (n >= 2 || pid === leader?.pid) streaks.push({ pid, n });
    }
    streaks.sort((a, b) => b.n - a.n);
    this.fill('streaks', streaks.slice(0, 6).map(({ pid, n }) => {
      const w = model.where(pid, t);
      const lead = pid === leader?.pid;
      const what = w.state === 'vehicle' ? model.display(w.life?.tmpl) : w.state === 'foot' ? 'on foot' : w.state === 'dead' ? 'dead' : '';
      const detail = `${lead ? `Kill leader, ${leader.kills} kills` : ''}${lead && what ? ' · ' : ''}${what}`;
      return {
        sig: [pid, n, detail, pid === follow],
        node: () => this.row('player', pid, icon(lead ? 'lead' : 'streak'), hl.name(pid), detail, n ? String(n) : '',
          { team: hl.team(pid), me: pid === follow, hot: n >= 3, iconClass: lead ? 'gold' : 'fight' }),
      };
    }), 'Nobody has two kills in one life yet');

    // The vehicles with someone in them.
    const vehicles = hl.vehiclesAt(t).slice(0, 6);
    this.fill('vehicles', vehicles.map(v => {
      const driver = v.crew[0].pid;
      const kind = model.kindOf(v.life) ?? 'tank';
      const hp = v.max && v.hp !== null ? `${Math.max(0, Math.round((v.hp / v.max) * 100))}%` : '';
      const crew = `${hl.name(driver)}${v.crew.length > 1 ? ` +${v.crew.length - 1}` : ''}${hp ? ` · ${hp}` : ''}${v.fresh ? '' : ' · out of range'}`;
      return {
        sig: [v.life.nid, crew, v.kills, driver === follow],
        node: () => this.row('player', driver, icon(ICON[kind] ? kind : 'tank'), model.display(v.life.tmpl), crew,
          v.kills ? `${v.kills} ${v.kills === 1 ? 'kill' : 'kills'}` : '', { team: hl.team(driver), me: v.crew.some(c => c.pid === follow) }),
      };
    }), 'Nobody in a vehicle');

    // Who stands apart.
    const standouts = hl.standoutsAt(t).slice(0, 6);
    this.fill('standouts', standouts.map(({ pid, run }) => {
      const d = run.detail ?? {};
      const detail = run.kind === 'behind' ? `${STANDOUT_WORD.behind} at ${model.display(d.point)}`
        : run.kind === 'lone' ? `${STANDOUT_WORD.lone}${d.d ? `, ${d.d} m from his side` : ''}`
          : run.kind === 'far' ? `${STANDOUT_WORD.far}${d.d ? `, ${d.d} m` : ''}`
            : STANDOUT_WORD.nest;
      return {
        sig: [pid, run.kind, detail, pid === follow],
        node: () => this.row('player', pid, icon(run.kind), hl.name(pid), detail, fmt(t - run.start),
          { team: hl.team(pid), me: pid === follow }),
      };
    }), model.standouts ? 'Everyone is with his side' : 'Waiting for the vehicles to load');
  }

  dispose() {
    this.sizes.disconnect();
    this.panel.remove();
    this.button.remove();
  }
}
