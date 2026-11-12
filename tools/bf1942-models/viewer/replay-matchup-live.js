// The replay's spotlight on a kill (features/replay-matchup): Spotlight on a
// kill in the round's timeline jumps to just before it and plays it with the
// two lit. The rest of the view is dulled and the killer and the one they
// killed (with whoever rides with them) are drawn again over it at full
// colour, their rounds fly as tracers (replay-tracers.js), every hit's damage
// rises over whoever took it, and a strip over the view keeps both sides' hit
// points as they fall. It lets go a few seconds after the kill. Break it down
// on the strip freezes the round there for the match-up's breakdown
// (replay-matchup-view.js).
//
// The dulling is one more pass after the page's render, before the followed
// player's arms (replay.js `renderViewmodel`): a dark sheet over the frame,
// then the two drawn again, alone, through a small scene of their own that
// holds them, the level's lights and their rounds for the one render (their
// matrices as the page's render left them). The depth the first render left
// is kept, so a hill in front of one of them still hides it.

import * as THREE from 'three';
import { HOLD, KILL_FREEZE, LEAD, assignDrops, fightEpisodes, fightOfKill, hasPlayer, healthOf, labelOf, orient, peopleOf, roundsBetween, sideOf } from './replay-matchup.js';
import { flightOf, gunSpecOf } from './replay-matchup-strike.js';
import { motionAt, poseAt } from './replay-kinematics.js';
import { prettyTank } from './tank-arena.js';
import { TRACER_HIT, TRACER_LIFE, TRACER_MISS, Tracers } from './replay-tracers.js';
import { decodePlayerName } from './vehicle-players.js';

/** How far the rest of the view is dulled, at full strength. */
const DIM = 0.66;
const DIM_COLOUR = 0x15161a;
/** How fast the dulling comes and goes, a share a second. */
const FADE = 5;
/** Seconds before the kill the spotlight starts, and at least this long
 *  before the killing round left. */
export const SPOT_LEAD = 5;
const SPOT_ROUND_LEAD = 2;
/** Seconds a round that missed flies on past the one it was fired at. */
const MISS_ON = 0.4;
/** Seconds a hit's damage shows over whoever took it. */
const POP = 1.4;
/** Rounds drawn at once: a streak, its line in up to eight pieces, a flash. */
const MAX_ROUNDS = 240;
/** Seconds between looks at whether the Accuracy rebuild has changed. */
const BOARD_EVERY = 1;

const STYLE = `
.rm-live { position: absolute; left: 50%; top: 10px; transform: translateX(-50%); display: none; align-items: center; gap: 8px;
  width: max-content; max-width: calc(100% - 24px); padding: 4px 4px 4px 10px; pointer-events: auto;
  border: 1px solid var(--rp-edge); border-radius: 8px; background: var(--rp-plate-deep);
  box-shadow: 0 8px 26px rgba(0, 0, 0, .45); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); }
.rm-root.on:not(.frozen) .rm-live.lit { display: flex; }
.rm-live-k { flex: none; color: var(--rp-khaki); font: 800 9px/1.2 var(--rp-font); letter-spacing: .22em; }
.rm-live-fight { display: flex; align-items: center; gap: 10px; min-width: 0; }
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
/* The replay's own name tags give way to the two's while a kill is lit, and
   the fronts' tabs (replay-highlights.js), in the same place, to the strip. */
.rp-root.rm-spot .rp-tags { opacity: 0; pointer-events: none; }
.rp-root.rm-spot .rp-hl-fronts { display: none; }
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

export class MatchupSpotlight {
  constructor(matchup) {
    this.matchup = matchup;
    this.player = matchup.player;
    this.episodes = null;
    this.board = null;
    this.boardAt = -Infinity;
    // The kill lit: `{ raw, kill, from, until, faced }`, or null.
    this.pin = null;
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
    this.againBtn = ui.button('rm-live-again', null, 'Watch it again from just before the kill', () => this.again(), 'Again');
    this.goBtn = ui.button('rm-live-go', null, 'Freeze here and break the fight down: every round, every plate, the two taken apart',
      () => this.matchup.breakdownLive(), 'Break it down');
    const off = ui.button('rm-live-off', 'close', 'Let go of this kill', () => this.release());
    this.strip.append(el('span', 'rm-live-k', 'SPOTLIGHT'), fight, this.againBtn, this.goBtn, off);
    for (const type of ['pointerdown', 'wheel', 'click', 'dblclick']) this.strip.addEventListener(type, e => e.stopPropagation());
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
    // The kill lit stays lit: its fight found again.
    if (this.pin) {
      const k = this.pin.kill;
      const same = fightOfKill(this.episodes, k.t, k.victimPid);
      if (same) {
        this.pin.raw = same;
        if (this.raw) this.setFight(same, p.time, true);
      }
    }
  }

  /**
   * Light the kill of `victimPid` at `t`: to just before it, the camera on
   * one of the two (the one followed, else the killer), playing. False when
   * the recording places nobody who could have made it.
   */
  spotlight(t, victimPid) {
    const p = this.player;
    this.ensureEpisodes(true);
    const raw = fightOfKill(this.episodes, t, victimPid);
    if (!raw) return false;
    const kill = raw.kill;
    if (!hasPlayer(raw, p.followPid) && Number.isInteger(kill.killerPid)) p.ui.follow(kill.killerPid);
    if (p.highlights?.auto || p.camera?.mode === 'free') p.ui.setMode('orbit');
    this.pin = { raw, kill, from: kill.t, until: kill.t + HOLD, faced: false };
    this.setFight(raw, kill.t - KILL_FREEZE);
    // From before the kill, and before the round that made it.
    const killer = this.rounds.filter(r => r.kind === 'hit' && r.at === kill.victim && r.arrival <= kill.t + 0.1).at(-1);
    this.pin.from = Math.max(0, Math.min(kill.t - SPOT_LEAD, killer ? killer.f.t - SPOT_ROUND_LEAD : Infinity));
    this.raw = null;
    p.seek(this.pin.from);
    p.playing = true;
    return true;
  }

  /** The kill lit, once more from the start. */
  again() {
    if (!this.pin) return;
    this.pin.faced = false;
    this.player.seek(this.pin.from);
    this.player.playing = true;
  }

  /** Let go of the kill: the view comes back up. */
  release() {
    this.pin = null;
  }

  /** The breakdown is open: nothing drawn, the kill kept. */
  suspend() {
    this.raw = null;
    this.fight = null;
    this.shownFight = null;
    this.dim = 0;
    this.rounds = [];
    this.tagsEl.textContent = '';
    this.tagNodes = null;
    this.pops = [];
    this.strip.classList.remove('lit');
    this.player.ui.root.classList.remove('rm-spot');
    if (this.gl) this.gl.tracers.group.visible = false;
  }

  /** The switch off: the kill let go, nothing drawn. */
  end() {
    this.pin = null;
    this.suspend();
    this.lit = [];
    this.litAt = -Infinity;
  }

  /** Each frame while the switch is on and nothing is frozen. */
  update(t, dt) {
    const pin = this.pin;
    // A play or a seek past the kill's last seconds lets it go; a seek back
    // into them, or a scrub about inside, keeps it.
    if (pin && (t > pin.until || t < pin.from - 1)) this.pin = null;
    if (!this.pin && !this.raw && this.dim === 0) return;
    if (this.pin) this.ensureEpisodes();
    const raw = this.pin?.raw ?? null;
    if (raw !== this.raw) this.setFight(raw, t);
    const step = dt > 0 ? Math.min(dt, 0.1) : 1 / 60;
    this.dim += ((raw ? 1 : 0) - this.dim) * Math.min(1, step * FADE);
    if (!raw && this.dim < 0.01) this.dim = 0;
    // What is drawn is the last fight while it fades out.
    if (raw) this.shownFight = this.fight;
    else if (this.dim === 0) this.shownFight = null;
    const p = this.player;
    p.ui.root.classList.toggle('rm-spot', Boolean(raw));
    this.strip.classList.toggle('lit', Boolean(raw));
    // The orbit turns to the other once it has settled on the one it follows.
    if (this.pin && !this.pin.faced && this.fight && --this.pin.faceIn <= 0) {
      this.pin.faced = true;
      this.faceOther(this.fight, t);
    }
    if (raw) {
      this.layoutStrip();
      this.renderStrip(t);
    }
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
      console.warn('replay: the spotlight could not work out the rounds between them', error);
      this.rounds = [];
    }
    this.buildTags(this.fight, t);
    // Two frames on: the orbit has gone over to the one it follows.
    if (this.pin && !this.pin.faced) this.pin.faceIn = 2;
  }

  /** The orbit swings once to behind the followed player, looking at the
   *  other, when the other is off the screen. Only the orbit the viewer is
   *  steering themselves, not Auto's director. */
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
      r.steps = r.spec?.gravity > 0 && r.span > 0.3 ? 8 : 1;
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
    if (!fight) return;
    if (this.stripKey !== 'fight') {
      this.stripKey = 'fight';
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
    const tracers = new Tracers(MAX_ROUNDS * 10, { name: 'spotlight rounds', size: 10 });
    // The pass's own scene: what it holds is lent to it for the one render
    // (`render`), each thing's parent left as it is.
    const spot = new THREE.Scene();
    spot.matrixWorldAutoUpdate = false;
    spot.matrixAutoUpdate = false;
    this.gl = { quadScene, quadCam, quad, tracers, spot };
    return this.gl;
  }

  /** The two's rounds at `t`, as the shot lines draw every round: in the air
   *  a streak, then the line each left, fading. */
  updateRounds(t) {
    if (!this.gl && !this.rounds.length) return;
    const tracers = this.ensureGl().tracers;
    tracers.begin();
    for (const r of this.rounds) {
      const age = t - r.f.t;
      if (!(age >= 0) || age > r.span + TRACER_LIFE) continue;
      const k = Math.min(1, 2 * (1 - Math.max(0, age - r.span) / TRACER_LIFE));
      tracers.flight((s, out) => r.flight.at(s, out), r.span, age, r.kind === 'hit' ? TRACER_HIT : TRACER_MISS, { k, steps: r.steps });
    }
    tracers.end();
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
    spot.children = [...this.lightsOf(scene), ...this.rootsOf(fight, this.player.time), gl.tracers.group];
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
      this.gl.quad.geometry.dispose();
      this.gl.quad.material.dispose();
      this.gl.tracers.dispose();
      this.gl = null;
    }
    this.strip.remove();
    this.tagsEl.remove();
  }
}
