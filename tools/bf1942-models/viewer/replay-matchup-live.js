// The match-up while the round plays (features/replay-matchup): the fight on
// at the playhead brought to the front. The rest of the view is dulled and the
// two (with whoever rides with them) are drawn again over it at full colour,
// their rounds are drawn as they fly, coloured by what came of each, every
// hit's damage pops up over whoever took it, and a strip over the view keeps
// both sides' hit points as they fall. Break it down on the strip, or Match-up
// on a kill in the round's timeline, opens the frozen breakdown
// (replay-matchup-view.js).
//
// The dulling is one more pass after the page's render, before the followed
// player's arms (replay.js `renderViewmodel`): a dark sheet over the frame,
// then the two drawn again, alone, through a small scene of their own that
// holds them, the level's lights and their rounds for the one render (their
// matrices as the page's render left them). The depth the first render left
// is kept, so a hill in front of one of them still hides it.

import * as THREE from 'three';
import {
  HOLD, LEAD, assignDrops, fightEpisodes, fightOn, hasPlayer, healthOf, labelOf, nextFight, orient, peopleOf, roundsBetween, sideOf,
} from './replay-matchup.js';
import { flightOf, gunSpecOf } from './replay-matchup-strike.js';
import { motionAt, poseAt } from './replay-kinematics.js';
import { prettyTank } from './tank-arena.js';
import { fmtClock } from './replay-timeline.js';
import { nameAt } from './replay-recording.js';
import { decodePlayerName } from './vehicle-players.js';

/** How far the rest of the view is dulled, at full strength. */
const DIM = 0.66;
const DIM_COLOUR = 0x15161a;
/** How fast the dulling comes and goes, a share a second. */
const FADE = 5;
/** A round's streak: this many seconds of its flight, at most this long. */
const TAIL = 0.06;
const TAIL_MAX = 40;
/** Seconds a round that missed flies on past the one it was fired at. */
const MISS_ON = 0.4;
/** Seconds a hit's damage shows over whoever took it. */
const POP = 1.4;
/** Rounds drawn at once. */
const MAX_ROUNDS = 240;
/** Seconds between looks at whether the Accuracy rebuild has changed. */
const BOARD_EVERY = 1;
/** Colours: a round that did damage, one that missed or did none. */
const HIT = new THREE.Color(0xf0913c);
const MISS = new THREE.Color(0xd8d2a0);

const STYLE = `
.rm-live { position: absolute; left: 50%; top: 10px; transform: translateX(-50%); display: none; align-items: center; gap: 8px;
  width: max-content; max-width: calc(100% - 24px); padding: 4px 4px 4px 10px; pointer-events: auto;
  border: 1px solid var(--rp-edge); border-radius: 8px; background: var(--rp-plate-deep);
  box-shadow: 0 8px 26px rgba(0, 0, 0, .45); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); }
.rm-root.on:not(.frozen) .rm-live { display: flex; }
.rm-live-k { flex: none; color: var(--rp-khaki); font: 800 9px/1.2 var(--rp-font); letter-spacing: .22em; }
.rm-live-fight { display: none; align-items: center; gap: 10px; min-width: 0; }
.rm-live.has-fight .rm-live-fight { display: flex; }
.rm-live-none { color: var(--rp-muted); font: 11px/1.3 var(--rp-font); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.rm-live.has-fight .rm-live-none { display: none; }
.rm-live-side { min-width: 0; max-width: 190px; padding-left: 7px; border-left: 2px solid var(--rp-edge-strong); }
.rm-live-side.right { padding: 0 7px 0 0; border-left: 0; border-right: 2px solid var(--rp-edge-strong); text-align: right; }
.rm-live-side.is-axis { border-color: var(--rp-axis); }
.rm-live-side.is-allies { border-color: var(--rp-allies); }
.rm-live-side b { display: block; font: 700 12px/1.25 var(--rp-font); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rm-live-side small { display: block; color: var(--rp-muted); font: 700 9px/1.3 var(--rp-font); letter-spacing: .08em; text-transform: uppercase;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rm-live-hp { display: block; width: 110px; max-width: 100%; height: 4px; margin-top: 3px; border-radius: 2px; background: rgba(255, 255, 255, .14);
  overflow: hidden; }
.rm-live-side.right .rm-live-hp { margin-left: auto; }
.rm-live-hp em { display: block; height: 100%; background: var(--rp-life); transition: width .25s ease-out; }
.rm-live-side.right .rm-live-hp em { margin-left: auto; }
.rm-live-hp.low em { background: var(--rp-gold); } .rm-live-hp.gone em { width: 0 !important; }
.rm-live-mid { flex: none; text-align: center; }
.rm-live-mid b { display: block; font: 700 14px/1.1 var(--rp-mono); color: var(--rp-ink); font-variant-numeric: tabular-nums; }
.rm-live-mid small { display: block; color: var(--rp-muted); font: 700 9px/1.4 var(--rp-font); letter-spacing: .12em; white-space: nowrap; }
.rm-live .rp-btn { flex: none; height: 28px; border-color: var(--rp-edge); }
.rm-live .rp-btn.rm-live-go { background: var(--rp-khaki); color: var(--rp-khaki-ink); border-color: var(--rp-khaki); }
.rm-live .rp-btn[hidden] { display: none; }
/* The replay's own name tags give way to the two's while a fight is on, and
   the fronts' tabs (replay-highlights.js) to the strip while the mode is on:
   Next fight is the way to the fighting then. */
.rp-root.rm-spot .rp-tags { opacity: 0; pointer-events: none; }
.rp-root.rm-on:not(.rm-open) .rp-hl-fronts { display: none; }
/* Where the page's minimap would cover it (a phone, a narrow window), the
   strip keeps to its left (\`layoutStrip\`). */
.rm-live.is-left { left: 12px; transform: none; }
.rm-ltags { position: absolute; inset: 0; pointer-events: none; }
.rm-ltag { position: absolute; left: 0; top: 0; display: none; padding: 2px 7px 3px; border-left: 2px solid var(--rp-edge-strong);
  background: rgba(14, 14, 12, .82); font: 700 11px/1.25 var(--rp-font); white-space: nowrap; will-change: transform; }
.rm-ltag.is-axis { border-color: var(--rp-axis); } .rm-ltag.is-allies { border-color: var(--rp-allies); }
.rm-ltag small { display: block; color: var(--rp-muted); font: 10px/1.3 var(--rp-mono); }
.rm-ltag .rm-live-hp { width: 64px; height: 3px; }
.rm-ltag i { display: none; position: absolute; left: 50%; top: 50%; width: 0; height: 0; margin: -5px 0 0 -4px;
  border-left: 9px solid currentColor; border-top: 5px solid transparent; border-bottom: 5px solid transparent; }
.rm-ltag.is-off { padding: 2px 6px; opacity: .92; }
.rm-ltag.is-off small, .rm-ltag.is-off .rm-live-hp { display: none; }
.rm-ltag.is-off i { display: block; }
.rm-ltag.is-axis i { color: var(--rp-axis); } .rm-ltag.is-allies i { color: var(--rp-allies); }
.rm-pop { position: absolute; left: 0; top: 0; display: none; color: var(--rp-fire); font: 800 13px/1 var(--rp-mono);
  text-shadow: 0 1px 2px rgba(0, 0, 0, .9), 0 0 8px rgba(240, 145, 60, .45); white-space: nowrap; will-change: transform, opacity; }
.rm-pop.is-end { color: var(--rp-gold); font: 800 11px/1 var(--rp-font); letter-spacing: .16em; }
@media (max-width: 720px) {
  .rm-live { top: 8px; left: 8px; right: 8px; transform: none; width: auto; max-width: none; flex-wrap: wrap; gap: 4px 8px; }
  .rm-live-k { display: none; }
  .rm-live-fight { flex: 1 1 100%; justify-content: space-between; }
  .rm-live-side { max-width: 38vw; }
  .rm-live-hp { width: 72px; }
  .rm-live .rp-btn { flex: 1 1 0; }
  .rm-live .rp-btn.rm-live-off { flex: none; }
  .rm-live-none { flex: 1 1 100%; }
  .rm-live.is-left { left: 8px; right: auto; }
}
@media (prefers-reduced-motion: reduce) { .rm-live-hp em { transition: none; } }
`;

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
/** A name as players see it (stored names are raw: CLAUDE.md, names). */
const shown = names => String(names ?? '').split(', ').map(n => decodePlayerName(n)).join(', ');
const teamClass = team => (team === 1 ? 'is-axis' : team === 2 ? 'is-allies' : '');
const _v = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

/** A soft round spot for the rounds' heads. */
function glowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 32;
  const g = canvas.getContext('2d');
  const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,.7)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 32);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export class MatchupLive {
  constructor(matchup) {
    this.matchup = matchup;
    this.player = matchup.player;
    this.episodes = null;
    this.board = null;
    this.boardAt = -Infinity;
    this.raw = null;
    this.fight = null;
    this.shownFight = null;
    this.rounds = [];
    this.dim = 0;
    this.lit = [];
    this.litAt = -Infinity;
    this.edge = null;
    this.gl = null;
    if (!document.getElementById('rm-live-style')) {
      const style = el('style');
      style.id = 'rm-live-style';
      style.textContent = STYLE;
      document.head.appendChild(style);
    }
    this.buildStrip();
    this.tagsEl = el('div', 'rm-ltags');
    this.tagNodes = null;
    this.pops = [];
  }

  buildStrip() {
    const ui = this.player.ui;
    this.strip = el('div', 'rm-live');
    this.strip.setAttribute('role', 'status');
    this.sides = ['a', 'b'].map((key, i) => {
      const node = el('div', `rm-live-side${i ? ' right' : ''}`);
      const name = el('b');
      const what = el('small');
      const hp = el('span', 'rm-live-hp');
      const bar = el('em');
      hp.append(bar);
      node.append(name, what, hp);
      return { node, name, what, hp, bar };
    });
    const mid = el('div', 'rm-live-mid');
    this.score = el('b', '', '0 : 0');
    this.midLine = el('small', '', 'HITS');
    mid.append(this.score, this.midLine);
    const fight = el('div', 'rm-live-fight');
    fight.append(this.sides[0].node, mid, this.sides[1].node);
    this.none = el('div', 'rm-live-none', 'No fight on');
    this.goBtn = ui.button('rm-live-go', null, 'Freeze here and break the fight down: every round, every plate, the two taken apart',
      () => this.matchup.breakdownLive(), 'Break it down');
    this.nextBtn = ui.button('rm-live-next', null, 'Jump to just before the next fight', () => this.jumpNext(), 'Next fight');
    const off = ui.button('rm-live-off', 'close', 'Turn the match-up off', () => this.matchup.toggle());
    this.strip.append(el('span', 'rm-live-k', 'MATCH-UP'), fight, this.none, this.goBtn, this.nextBtn, off);
    for (const type of ['pointerdown', 'wheel', 'click', 'dblclick']) this.strip.addEventListener(type, e => e.stopPropagation());
  }

  /** Whether a player is followed, so only their fights count. */
  following() {
    const p = this.player;
    return p.camera?.mode !== 'free' && Number.isInteger(p.followPid);
  }

  /** The round's fights, again whenever the Accuracy rebuild has changed (a
   *  hull's model landing names its gun's rounds). */
  ensureEpisodes(force = false) {
    const now = performance.now() / 1000;
    if (!force && this.episodes && now - this.boardAt < BOARD_EVERY) return;
    this.boardAt = now;
    const p = this.player;
    const board = p.accuracy?.() ?? [];
    if (!force && this.episodes && board === this.board) return;
    this.board = board;
    const shots = board.flatMap(e => e.shots ?? []);
    this.shotOf = new Map(shots.map(s => [s.f, s]));
    this.episodes = fightEpisodes(p.rec, shots, p.kills);
    // The fight shown stays shown: its own object, found again.
    if (this.raw) {
      const same = this.episodes.find(raw => (raw.x === this.raw.x || raw.x === this.raw.y) && (raw.y === this.raw.x || raw.y === this.raw.y)
        && raw.first <= this.raw.last + 0.01 && raw.last >= this.raw.first - 0.01);
      this.raw = same ?? null;
      if (same) this.setFight(same, p.time, true);
    }
  }

  begin() {
    this.ensureEpisodes(true);
    this.raw = null;
    this.fight = null;
    this.dim = 0;
    this.stripKey = null;
  }

  end() {
    this.lit = [];
    this.litAt = -Infinity;
    this.raw = null;
    this.fight = null;
    this.shownFight = null;
    this.dim = 0;
    this.rounds = [];
    this.tagsEl.textContent = '';
    this.tagNodes = null;
    this.pops = [];
    this.player.ui.root.classList.remove('rm-spot');
    if (this.gl) this.gl.overlay.visible = false;
  }

  /** Each frame while the mode is on and nothing is frozen. */
  update(t, dt) {
    this.ensureEpisodes();
    const p = this.player;
    const raw = fightOn(this.episodes, t, { follow: p.followPid, current: this.raw, only: this.following() });
    if (raw !== this.raw) this.setFight(raw, t);
    const step = dt > 0 ? Math.min(dt, 0.1) : 1 / 60;
    this.dim += ((raw ? 1 : 0) - this.dim) * Math.min(1, step * FADE);
    if (!raw && this.dim < 0.01) this.dim = 0;
    // What is drawn is the last fight while it fades out.
    if (raw) this.shownFight = this.fight;
    else if (this.dim === 0) this.shownFight = null;
    p.ui.root.classList.toggle('rm-spot', Boolean(raw));
    this.layoutStrip();
    this.renderStrip(t);
    this.placeTags(t);
    this.updateRounds(t);
  }

  /** The fight `raw` brought to the front from `t`: its two, their rounds. */
  setFight(raw, t, keepSides = false) {
    const p = this.player;
    this.raw = raw;
    const previous = this.fight;
    this.fight = raw ? orient(p.rec, raw, t, p.followPid) : null;
    // A fight found again keeps its sides where they were.
    if (keepSides && previous && this.fight && this.fight.a !== previous.a) {
      const f = this.fight;
      this.fight = { ...f, a: f.b, b: f.a, hits: { a: f.hits.b, b: f.hits.a } };
    }
    this.stripKey = null;
    this.rounds = [];
    if (!this.fight) {
      this.tagsEl.textContent = '';
      this.tagNodes = null;
      return;
    }
    try {
      this.rounds = this.roundsOf(this.fight, raw);
    } catch (error) {
      console.warn('replay: the match-up could not work out the rounds between them', error);
      this.rounds = [];
    }
    this.buildTags(this.fight, t);
    if (!keepSides) this.faceOther(this.fight, t);
  }

  /** A fight coming on with the other off the screen: the orbit swings once
   *  to behind the followed player, looking at who they are fighting. Only
   *  the orbit the viewer is steering themselves, not Auto's director. */
  faceOther(fight, t) {
    const p = this.player;
    const c = p.camera;
    if (c?.mode !== 'orbit' || p.highlights?.auto || !Number.isFinite(c.yaw)) return;
    if (!peopleOf(p.rec, fight.a, t).includes(p.followPid)) return;
    const a = this.placeOf(fight.a, t, new THREE.Vector3());
    const b = a ? this.placeOf(fight.b, t, new THREE.Vector3()) : null;
    if (!b) return;
    const s = _v.copy(b).project(p.ctx.camera);
    if (s.z < 1 && Math.abs(s.x) < 0.9 && Math.abs(s.y) < 0.9) return;
    const dx = a.x - b.x;
    const dz = a.z - b.z;
    if (Math.hypot(dx, dz) < 1) return;
    const want = Math.atan2(dx, dz);
    c.yaw += Math.atan2(Math.sin(want - c.yaw), Math.cos(want - c.yaw));
  }

  /** Every round between the two over the fight, with its flight. */
  roundsOf(fight, raw) {
    const p = this.player;
    const speedOf = (f, shooter) => gunSpecOf(p, shooter, f.weapon)?.speed ?? null;
    const rounds = assignDrops(roundsBetween(p.rec, fight.a, fight.b, raw.first - LEAD - 2, raw.last + HOLD,
      { shotOf: f => this.shotOf?.get(f), speedOf }));
    for (const r of rounds) {
      r.spec = gunSpecOf(p, r.shooter, r.f.weapon);
      const platform = r.shooter && !r.shooter.soldier ? motionAt(r.shooter, r.f.t)?.velocity ?? null : null;
      r.flight = flightOf(r.f, r.spec, platform);
      r.span = Math.max(0.02, r.arrival - r.f.t) + (r.kind === 'hit' ? 0 : MISS_ON);
      r.tail = Math.min(TAIL, TAIL_MAX / Math.max(1, r.flight.speed));
    }
    return rounds;
  }

  /** Where `life` is drawn at `t`, view frame. */
  placeOf(life, t, out = new THREE.Vector3()) {
    const hull = life.soldier ? null : this.player.hulls?.get(life);
    if (hull?.root && hull.group?.visible !== false) return hull.root.getWorldPosition(out);
    const pose = poseAt(life, t);
    return pose ? out.set(pose.p[0], pose.p[1], pose.p[2]) : null;
  }

  // --- the strip ---------------------------------------------------------------------

  /** The strip clear of the page's minimap: where the two would meet (a
   *  phone, a narrow window), it keeps to the minimap's left. Twice a second. */
  layoutStrip() {
    const now = performance.now();
    if (now - (this.laidAt ?? -Infinity) < 500) return;
    this.laidAt = now;
    const root = this.matchup.root.getBoundingClientRect();
    const map = document.getElementById('minimap');
    const r = map?.getBoundingClientRect();
    const shown = r && r.width > 0 && r.height > 0 && getComputedStyle(map).visibility !== 'hidden' && getComputedStyle(map).display !== 'none';
    const room = shown && r.top - root.top < 90 && r.left > root.left + 120 ? Math.round(r.left - root.left - 10) : null;
    const strip = this.strip;
    const wasLeft = strip.classList.contains('is-left');
    // Back to the middle only with room to spare at the width it had there,
    // or it would go back and forth as its width changes.
    const width = wasLeft ? Math.max(strip.offsetWidth, this.middleWidth ?? 0) : strip.offsetWidth;
    if (!wasLeft) this.middleWidth = width;
    const left = room !== null && root.width / 2 + width / 2 > room - (wasLeft ? 20 : 0);
    strip.classList.toggle('is-left', left);
    const phone = root.width <= 720;
    strip.style.maxWidth = left ? `${room - (phone ? 8 : 12)}px` : '';
    strip.style.width = left && phone ? `${room - 8}px` : '';
  }

  renderStrip(t) {
    const p = this.player;
    const fight = this.fight;
    const following = this.following();
    if (!fight) {
      const next = nextFight(this.episodes, t, { follow: p.followPid, only: following });
      const who = following ? shown(nameAt(p.rec, p.followPid, t)) : '';
      const key = `none|${who}|${next ? next.first : ''}`;
      if (key !== this.stripKey) {
        this.stripKey = key;
        this.strip.classList.remove('has-fight');
        this.none.textContent = next
          ? `No fight on${who ? ` for ${who}` : ''}`
          : `No fight left in the round${who ? ` for ${who}` : ''}`;
        this.nextBtn.hidden = !next;
        if (next) this.nextBtn.lastChild.textContent = `Next fight ${fmtClock(Math.max(0, next.first - LEAD))}`;
        this.goBtn.hidden = true;
      }
      return;
    }
    if (this.stripKey === null || !this.stripKey.startsWith('fight')) {
      this.stripKey = 'fight';
      this.strip.classList.add('has-fight');
      this.goBtn.hidden = false;
      this.nextBtn.hidden = true;
      for (const [i, key] of ['a', 'b'].entries()) {
        const life = fight[key];
        const label = labelOf(p.rec, life, fight.first, prettyTank);
        const side = this.sides[i];
        side.node.className = `rm-live-side${i ? ' right' : ''} ${teamClass(sideOf(p.rec, life, fight.first))}`;
        side.name.textContent = shown(label.who);
        side.what.textContent = label.what;
      }
    }
    const hits = { a: 0, b: 0 };
    for (const r of this.rounds) if (r.kind === 'hit' && r.arrival <= t) hits[r.by]++;
    for (const [i, key] of ['a', 'b'].entries()) {
      const { hp, max } = healthOf(fight[key], t);
      const k = hp === null || !(max > 0) ? 1 : Math.max(0, Math.min(1, hp / max));
      const side = this.sides[i];
      const width = `${(k * 100).toFixed(1)}%`;
      if (side.bar.style.width !== width) side.bar.style.width = width;
      side.hp.classList.toggle('low', k > 0 && k <= 0.5);
      side.hp.classList.toggle('gone', hp !== null && hp <= 0);
    }
    const pa = this.placeOf(fight.a, t, _a);
    const pb = pa ? this.placeOf(fight.b, t, _b) : null;
    const range = pa && pb ? `${Math.round(pa.distanceTo(pb))} m` : '';
    const score = `${hits.a} : ${hits.b}`;
    if (this.score.textContent !== score) this.score.textContent = score;
    const line = range ? `HITS · ${range}` : 'HITS';
    if (this.midLine.textContent !== line) this.midLine.textContent = line;
  }

  /** To just before the next fight: the rounds that missed first, then the hits. */
  jumpNext() {
    const p = this.player;
    const next = nextFight(this.episodes, p.time, { follow: p.followPid, only: this.following() });
    if (!next) return;
    p.seek(Math.max(0, next.first - LEAD));
  }

  // --- the tags over the two ------------------------------------------------------------

  buildTags(fight, t) {
    const p = this.player;
    this.tagsEl.textContent = '';
    const make = key => {
      const life = fight[key];
      const label = labelOf(p.rec, life, fight.first, prettyTank);
      const node = el('div', `rm-ltag ${teamClass(sideOf(p.rec, life, fight.first))}`);
      node.append(el('i'), document.createTextNode(shown(label.who)), el('small', '', label.what));
      const hp = el('span', 'rm-live-hp');
      const bar = el('em');
      hp.append(bar);
      node.append(hp);
      this.tagsEl.append(node);
      return { node, hp, bar, arrow: node.firstChild, life };
    };
    this.tagNodes = { fight, a: make('a'), b: make('b') };
    this.pops = this.rounds.map(() => null);
    void t;
  }

  /** `v` (view frame) on the screen: `{ x, y, on, angle }`, kept inside the
   *  view's edges when it is off it, `angle` the way to it. */
  screenOf(v, w, h) {
    const camera = this.player.ctx.camera;
    const s = _v.copy(v).project(camera);
    let { x, y } = s;
    const behind = s.z > 1;
    if (behind) {
      x = -x;
      y = -y;
      if (Math.abs(x) < 1e-3 && Math.abs(y) < 1e-3) y = -1;
    }
    // On the screen, its tag kept whole inside the view's edges.
    if (!behind && Math.abs(x) <= 0.98 && Math.abs(y) <= 0.98) {
      return { x: Math.min(w - 60, Math.max(60, ((x + 1) / 2) * w)), y: ((1 - y) / 2) * h, on: true, angle: 0 };
    }
    const k = Math.max(Math.abs(x), Math.abs(y)) || 1;
    const top = 84;
    const bottom = this.bottomEdge(h);
    const px = Math.min(w - 60, Math.max(60, ((x / k + 1) / 2) * w));
    const py = Math.min(bottom, Math.max(top, ((1 - y / k) / 2) * h));
    return { x: px, y: py, on: false, angle: Math.atan2(-y, x) };
  }

  /** The lowest a tag held at the view's edge may sit: over the replay's bar
   *  and the player card. Read twice a second, not every frame. */
  bottomEdge(h) {
    const now = performance.now();
    if (this.edge && this.edge.h === h && now - this.edge.at < 500) return this.edge.bottom;
    const root = this.matchup.root.getBoundingClientRect();
    let top = h;
    for (const selector of ['.rp-bar', '.rp-card']) {
      const r = this.player.ui.root.querySelector(selector)?.getBoundingClientRect();
      if (r && r.height > 0 && r.top - root.top < top) top = r.top - root.top;
    }
    const bottom = Math.max(120, top - 26);
    this.edge = { h, at: now, bottom };
    return bottom;
  }

  placeTags(t) {
    const nodes = this.tagNodes;
    if (!nodes || nodes.fight !== this.fight || !this.fight) return;
    const w = this.matchup.root.clientWidth;
    const h = this.matchup.root.clientHeight;
    const places = {};
    for (const key of ['a', 'b']) {
      const tag = nodes[key];
      const at = this.placeOf(tag.life, t, new THREE.Vector3());
      if (!at) {
        tag.node.style.display = 'none';
        continue;
      }
      const base = this.screenOf(at, w, h);
      at.y += tag.life.soldier ? 2.2 : 3.6;
      const s = this.screenOf(at, w, h);
      // Close to the camera a point over them projects towards the horizon,
      // over whatever is beyond: the tag stays a short way above them.
      if (s.on && base.on) s.y = Math.min(base.y - 24, Math.max(s.y, base.y - Math.min(150, 0.2 * h)));
      places[key] = s;
      tag.node.style.display = 'block';
      tag.node.classList.toggle('is-off', !s.on);
      tag.node.style.transform = s.on
        ? `translate(${s.x.toFixed(1)}px, ${s.y.toFixed(1)}px) translate(-50%, -100%)`
        : `translate(${s.x.toFixed(1)}px, ${s.y.toFixed(1)}px) translate(-50%, -50%)`;
      if (!s.on) {
        // The arrow sits on the tag's side towards them.
        const dx = Math.cos(s.angle) * 0.5 + 0.5;
        const dy = Math.sin(s.angle) * 0.5 + 0.5;
        tag.arrow.style.left = `${(dx * 100).toFixed(0)}%`;
        tag.arrow.style.top = `${(dy * 100).toFixed(0)}%`;
        tag.arrow.style.transform = `translate(${(Math.cos(s.angle) * 10).toFixed(1)}px, ${(Math.sin(s.angle) * 10).toFixed(1)}px) rotate(${s.angle.toFixed(3)}rad)`;
      }
      const { hp, max } = healthOf(tag.life, t);
      const k = hp === null || !(max > 0) ? 1 : Math.max(0, Math.min(1, hp / max));
      tag.bar.style.width = `${(k * 100).toFixed(1)}%`;
      tag.hp.classList.toggle('low', k > 0 && k <= 0.5);
      tag.hp.classList.toggle('gone', hp !== null && hp <= 0);
    }
    this.placePops(t, places);
  }

  /** Each hit's damage over whoever took it, rising and fading for POP s. */
  placePops(t, places) {
    for (const [i, r] of this.rounds.entries()) {
      const drop = r.drop;
      const age = drop ? t - drop.t : -1;
      let pop = this.pops[i];
      const showing = drop && age >= 0 && age <= POP && places[r.by === 'a' ? 'b' : 'a'];
      if (!showing) {
        if (pop) pop.style.display = 'none';
        continue;
      }
      if (!pop) {
        const end = drop.after <= 0;
        pop = el('div', `rm-pop${end ? ' is-end' : ''}`, end ? (r.at.soldier ? 'KILLED' : 'DESTROYED') : `−${Math.round(drop.amount)}`);
        this.tagsEl.append(pop);
        this.pops[i] = pop;
      }
      const s = places[r.by === 'a' ? 'b' : 'a'];
      const k = age / POP;
      pop.style.display = 'block';
      pop.style.opacity = (1 - k * k).toFixed(2);
      pop.style.transform = `translate(${s.x.toFixed(1)}px, ${(s.y - (s.on ? 30 : 18) - 26 * k).toFixed(1)}px) translate(-50%, -100%)`;
    }
  }

  // --- the rounds in the air --------------------------------------------------------------

  ensureGl() {
    if (this.gl) return this.gl;
    const quadScene = new THREE.Scene();
    const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({
      color: DIM_COLOUR, transparent: true, opacity: DIM, depthTest: false, depthWrite: false, toneMapped: false,
    }));
    quad.position.z = -0.5;
    quad.frustumCulled = false;
    quadScene.add(quad);
    const overlay = new THREE.Group();
    overlay.name = 'match-up rounds';
    const linePositions = new THREE.BufferAttribute(new Float32Array(MAX_ROUNDS * 6), 3);
    const lineColours = new THREE.BufferAttribute(new Float32Array(MAX_ROUNDS * 6), 3);
    linePositions.setUsage(THREE.DynamicDrawUsage);
    lineColours.setUsage(THREE.DynamicDrawUsage);
    const lineGeometry = new THREE.BufferGeometry();
    lineGeometry.setAttribute('position', linePositions);
    lineGeometry.setAttribute('color', lineColours);
    const lines = new THREE.LineSegments(lineGeometry, new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
    }));
    const headPositions = new THREE.BufferAttribute(new Float32Array(MAX_ROUNDS * 3), 3);
    const headColours = new THREE.BufferAttribute(new Float32Array(MAX_ROUNDS * 3), 3);
    headPositions.setUsage(THREE.DynamicDrawUsage);
    headColours.setUsage(THREE.DynamicDrawUsage);
    const headGeometry = new THREE.BufferGeometry();
    headGeometry.setAttribute('position', headPositions);
    headGeometry.setAttribute('color', headColours);
    const heads = new THREE.Points(headGeometry, new THREE.PointsMaterial({
      size: 10, sizeAttenuation: false, map: glowTexture(), vertexColors: true, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, toneMapped: false,
    }));
    for (const node of [overlay, lines, heads]) {
      node.frustumCulled = false;
      node.matrixAutoUpdate = false;
    }
    lines.renderOrder = 10;
    heads.renderOrder = 11;
    overlay.add(lines, heads);
    overlay.visible = false;
    overlay.updateMatrixWorld(true);
    // The pass's own scene: what it holds is lent to it for the one render
    // (`render`), each thing's parent left as it is.
    const spot = new THREE.Scene();
    spot.matrixWorldAutoUpdate = false;
    spot.matrixAutoUpdate = false;
    this.gl = { quadScene, quadCam, quad, overlay, lines, heads, spot };
    return this.gl;
  }

  /** The rounds in the air at `t`: a streak each, its head a spot. */
  updateRounds(t) {
    if (!this.gl && !this.rounds.length) return;
    const gl = this.ensureGl();
    const lp = gl.lines.geometry.attributes.position.array;
    const lc = gl.lines.geometry.attributes.color.array;
    const hp = gl.heads.geometry.attributes.position.array;
    const hc = gl.heads.geometry.attributes.color.array;
    let n = 0;
    for (const r of this.rounds) {
      if (n >= MAX_ROUNDS) break;
      const age = t - r.f.t;
      if (!(age >= 0) || age > r.span + r.tail) continue;
      const head = Math.min(age, r.span);
      const tail = Math.min(Math.max(0, age - r.tail), r.span);
      r.flight.at(head, _a);
      r.flight.at(tail, _b);
      const c = r.kind === 'hit' ? HIT : MISS;
      lp.set([_b.x, _b.y, _b.z, _a.x, _a.y, _a.z], n * 6);
      lc.set([c.r * 0.15, c.g * 0.15, c.b * 0.15, c.r, c.g, c.b], n * 6);
      // Past its end only the tail is left, catching up.
      const lit = age <= r.span ? 1 : 0;
      hp.set([_a.x, _a.y, _a.z], n * 3);
      hc.set([c.r * lit, c.g * lit, c.b * lit], n * 3);
      n++;
    }
    gl.lines.geometry.setDrawRange(0, n * 2);
    gl.heads.geometry.setDrawRange(0, n);
    gl.lines.geometry.attributes.position.needsUpdate = true;
    gl.lines.geometry.attributes.color.needsUpdate = true;
    gl.heads.geometry.attributes.position.needsUpdate = true;
    gl.heads.geometry.attributes.color.needsUpdate = true;
    gl.overlay.visible = n > 0;
  }

  // --- the spotlight pass ------------------------------------------------------------------

  /** What the two are drawn as: their hulls, and every soldier in them. */
  rootsOf(fight, t) {
    const p = this.player;
    const roots = [];
    const pids = new Set();
    for (const life of [fight.a, fight.b]) {
      if (!life.soldier) {
        const hull = p.hulls?.get(life);
        if (hull?.group) roots.push(hull.group);
      }
      for (const pid of peopleOf(p.rec, life, t)) pids.add(pid);
    }
    // Whoever died in the fight is still drawn falling for a moment after.
    const k = fight.kill;
    if (k && Number.isInteger(k.victimPid) && hasPlayer(fight.raw, k.victimPid)) pids.add(k.victimPid);
    const visuals = p.soldiers?.bodies?.botVisuals;
    for (const pid of pids) {
      const vis = visuals?.get(`replay:${pid}`);
      if (!vis) continue;
      if (vis.group) roots.push(vis.group);
      if (vis.seat?.scene) roots.push(vis.seat.scene);
      if (vis.canopy?.scene) roots.push(vis.canopy.scene);
    }
    return roots;
  }

  /** The scene's lights, each one the page's render lit with (itself and
   *  every parent shown): looked for again every few seconds, as a level adds
   *  and takes away its own. */
  lightsOf(scene) {
    const now = performance.now();
    if (now - this.litAt < 3000) return this.lit;
    this.litAt = now;
    const lit = [];
    scene.traverseVisible(o => {
      if (o.isLight) lit.push(o);
    });
    this.lit = lit;
    return lit;
  }

  /** Whether the frame just drawn is dulled (the timeline keeps no frame of
   *  it then). */
  get dimmed() {
    return this.dim > 0.02;
  }

  /** After the page's render: the rest dulled, the two again over it.
   *  Returns whether it drew. */
  render() {
    const fight = this.shownFight;
    if (!fight || this.dim < 0.01) return false;
    const { renderer, scene, camera } = this.player.ctx;
    if (!renderer || !scene || !camera) return false;
    const gl = this.ensureGl();
    const spot = gl.spot;
    // Lent, not added: no parent is changed. The page's render has just set
    // every matrix, and this scene does not update them again.
    spot.children = [...this.lightsOf(scene), ...this.rootsOf(fight, this.player.time), gl.overlay];
    spot.fog = scene.fog ?? null;
    spot.environment = scene.environment ?? null;
    const saved = {
      autoClear: renderer.autoClear, shadowAuto: renderer.shadowMap.autoUpdate, shadowNeeds: renderer.shadowMap.needsUpdate,
      infoReset: renderer.info.autoReset,
    };
    try {
      renderer.autoClear = false;
      renderer.info.autoReset = false;
      gl.quad.material.opacity = DIM * this.dim;
      renderer.render(gl.quadScene, gl.quadCam);
      // The shadows as the page's render drew them.
      renderer.shadowMap.autoUpdate = false;
      renderer.shadowMap.needsUpdate = false;
      renderer.render(spot, camera);
    } finally {
      spot.children = [];
      renderer.shadowMap.autoUpdate = saved.shadowAuto;
      renderer.shadowMap.needsUpdate = saved.shadowNeeds;
      renderer.autoClear = saved.autoClear;
      renderer.info.autoReset = saved.infoReset;
    }
    return true;
  }

  dispose() {
    this.end();
    if (this.gl) {
      for (const node of [this.gl.quad, this.gl.lines, this.gl.heads]) {
        node.geometry.dispose();
        node.material.map?.dispose?.();
        node.material.dispose();
      }
      this.gl = null;
    }
    this.strip.remove();
    this.tagsEl.remove();
  }
}
