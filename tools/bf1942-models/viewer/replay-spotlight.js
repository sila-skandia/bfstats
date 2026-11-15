// The replay's spotlight on a kill (features/replay-spotlight): Spotlight on
// a kill in the round's timeline jumps to just before it and plays it with
// the two lit. The rest of the view is dulled and the killer and the one they
// killed (with whoever rides with them) are drawn again over it at full
// colour, their rounds fly as tracers (replay-tracers.js), every hit's damage
// rises over whoever took it, and a strip over the view keeps both sides' hit
// points as they fall. It lets go a few seconds after the kill.
//
// The dulling is one more pass after the page's render, before the followed
// player's arms (replay.js `renderViewmodel`): a dark sheet over the frame,
// then the two drawn again, alone, through a small scene of their own that
// holds them, the level's lights and their rounds for the one render (their
// matrices as the page's render left them). The depth the first render left
// is kept, so a hill in front of one of them still hides it.

import * as THREE from 'three';
import {
  HOLD, KILL_FREEZE, LEAD, assignDrops, fightEpisodes, fightOfKill, hasPlayer, healthOf, labelOf, orient, peopleOf, roundsBetween, sideOf,
} from './replay-spotlight-fights.js';
import { flightOf, roundOf } from './replay-round-flight.js';
import { motionAt, poseAt } from './replay-kinematics.js';
import { prettyTank } from './tank-arena.js';
import { TRACER_HIT, TRACER_LIFE, TRACER_MISS, Tracers } from './replay-tracers.js';
import { decodePlayerName } from './vehicle-players.js';
import { nameAt, teamAt } from './replay-recording.js';

/** How far the rest of the view is dulled, at full strength. */
const DIM = 0.66;
const DIM_COLOUR = 0x15161a;
/** How fast the dulling comes and goes, a share a second. */
const FADE = 5;
/** Seconds before the kill the spotlight starts, and at least this long
 *  before the killing round left. */
export const SPOT_LEAD = 5;
const SPOT_ROUND_LEAD = 2;
/** Radians the other's direction may drift from where the orbit last turned
 *  to before it turns again. */
const FACE_DRIFT = 0.4;
/** Seconds a round that missed flies on past the one it was fired at. */
const MISS_ON = 0.4;
/** Seconds a hit's damage shows over whoever took it. */
const POP = 1.4;
/** Rounds drawn at once: a streak, its line in up to eight pieces, a flash. */
const MAX_ROUNDS = 240;
/** Seconds between looks at whether the Accuracy rebuild has changed. */
const BOARD_EVERY = 1;
/** Pixels a side of the strip's portraits; seconds between their renders. */
const PORTRAIT = 128;
const PORTRAIT_EVERY = 0.12;
/** The portrait's camera: its field of view (degrees), and how far off the
 *  line to the other one it stands and above it (radians). */
const PORTRAIT_FOV = 30;
const PORTRAIT_YAW = 0.6;
const PORTRAIT_PITCH = 0.32;

const STYLE = `
.rs-root { position: absolute; inset: 0; pointer-events: none; z-index: 6; }
.rs-strip { position: absolute; left: 50%; top: 10px; transform: translateX(-50%); display: none; align-items: center; gap: 8px;
  width: max-content; max-width: calc(100% - 24px); padding: 4px 4px 4px 10px; pointer-events: auto;
  border: 1px solid var(--rp-edge); border-radius: 8px; background: var(--rp-plate-deep);
  box-shadow: 0 8px 26px rgba(0, 0, 0, .45); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); }
.rs-strip.lit { display: flex; }
.rs-strip-k { flex: none; color: var(--rp-khaki); font: 800 9px/1.2 var(--rp-font); letter-spacing: .22em; }
.rs-strip-fight { display: flex; align-items: center; gap: 10px; min-width: 0; }
/* Each side is a button: its portrait, its name and hit points. A click
   follows that one; the one followed is lit in its side's colour. */
.rs-strip-side { --rs-team: var(--rp-edge-strong); display: flex; align-items: center; gap: 7px; min-width: 0; max-width: 230px;
  margin: 0; padding: 3px 8px 3px 3px; border: 1px solid transparent; border-radius: 7px; background: transparent; color: var(--rp-ink);
  font: inherit; text-align: left; cursor: pointer; transition: background-color .15s, border-color .15s, opacity .15s; opacity: .72; }
.rs-strip-side.right { flex-direction: row-reverse; padding: 3px 3px 3px 8px; text-align: right; }
.rs-strip-side.is-axis { --rs-team: var(--rp-axis); }
.rs-strip-side.is-allies { --rs-team: var(--rp-allies); }
.rs-strip-side:hover { opacity: 1; background: rgba(255, 255, 255, .06); }
.rs-strip-side:focus-visible { outline: 2px solid var(--rp-khaki); outline-offset: 1px; }
.rs-strip-side.is-on { opacity: 1; border-color: var(--rs-team); background: color-mix(in srgb, var(--rs-team) 16%, transparent); }
.rs-strip-text { min-width: 0; }
.rs-face { position: relative; flex: none; width: 44px; height: 44px; border-radius: 6px; overflow: hidden;
  background: radial-gradient(circle at 50% 38%, rgba(255, 255, 255, .16), rgba(0, 0, 0, .35) 72%), color-mix(in srgb, var(--rs-team) 30%, #16171a);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, .1); }
.rs-strip-side.is-on .rs-face { box-shadow: inset 0 0 0 2px var(--rs-team), 0 0 12px color-mix(in srgb, var(--rs-team) 55%, transparent); }
.rs-face canvas { position: static; display: block; width: 100%; height: 100%; }
.rs-role { display: block; color: var(--rs-team); font: 800 8px/1.2 var(--rp-font); letter-spacing: .2em; text-transform: uppercase; }
.rs-role:empty { display: none; }
.rs-strip-swap { flex: none; display: block; margin: 2px auto 0; color: var(--rp-muted); }
.rs-strip-side b { display: block; max-width: 150px; font: 700 12px/1.25 var(--rp-font); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rs-strip-side small { display: block; color: var(--rp-muted); font: 700 9px/1.3 var(--rp-font); letter-spacing: .08em; text-transform: uppercase;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rs-strip-hp { display: block; width: 110px; max-width: 100%; height: 4px; margin-top: 3px; border-radius: 2px; background: rgba(255, 255, 255, .14);
  overflow: hidden; }
.rs-strip-side.right .rs-strip-hp { margin-left: auto; }
.rs-strip-hp em { display: block; height: 100%; background: var(--rp-life); transition: width .25s ease-out; }
.rs-strip-side.right .rs-strip-hp em { margin-left: auto; }
.rs-strip-hp.low em { background: var(--rp-gold); } .rs-strip-hp.gone em { width: 0 !important; }
.rs-strip-mid { flex: none; text-align: center; }
.rs-strip-mid b { display: block; font: 700 14px/1.1 var(--rp-mono); color: var(--rp-ink); font-variant-numeric: tabular-nums; }
.rs-strip-mid small { display: block; color: var(--rp-muted); font: 700 9px/1.4 var(--rp-font); letter-spacing: .12em; white-space: nowrap; }
.rs-strip .rp-btn { flex: none; height: 28px; border-color: var(--rp-edge); }
.rs-strip .rp-btn[hidden] { display: none; }
/* The fronts' tabs (replay-highlights.js), in the same place, give way to
   the strip while a kill is lit. */
.rp-root.rs-lit .rp-hl-fronts { display: none; }
/* Where the page's minimap would cover it (a phone, a narrow window), the
   strip keeps to its left (\`layoutStrip\`). */
.rs-strip.is-left { left: 12px; transform: none; }
.rs-tags { position: absolute; inset: 0; pointer-events: none; }
.rs-tag { position: absolute; left: 0; top: 0; display: none; padding: 2px 7px 3px; border-left: 2px solid var(--rp-edge-strong);
  background: rgba(14, 14, 12, .82); font: 700 11px/1.25 var(--rp-font); white-space: nowrap; will-change: transform; }
.rs-tag.is-axis { border-color: var(--rp-axis); } .rs-tag.is-allies { border-color: var(--rp-allies); }
.rs-tag small { display: block; color: var(--rp-muted); font: 10px/1.3 var(--rp-mono); }
.rs-tag .rs-strip-hp { width: 64px; height: 3px; }
.rs-tag i { display: none; position: absolute; left: 50%; top: 50%; width: 0; height: 0; margin: -5px 0 0 -4px;
  border-left: 9px solid currentColor; border-top: 5px solid transparent; border-bottom: 5px solid transparent; }
.rs-tag.is-off { padding: 2px 6px; opacity: .92; }
.rs-tag.is-off small, .rs-tag.is-off .rs-strip-hp { display: none; }
.rs-tag.is-off i { display: block; }
.rs-tag.is-axis i { color: var(--rp-axis); } .rs-tag.is-allies i { color: var(--rp-allies); }
.rs-pop { position: absolute; left: 0; top: 0; display: none; color: var(--rp-fire); font: 800 13px/1 var(--rp-mono);
  text-shadow: 0 1px 2px rgba(0, 0, 0, .9), 0 0 8px rgba(240, 145, 60, .45); white-space: nowrap; will-change: transform, opacity; }
.rs-pop.is-end { color: var(--rp-gold); font: 800 11px/1 var(--rp-font); letter-spacing: .16em; }
@media (max-width: 720px) {
  .rs-strip { top: 8px; left: 8px; right: 8px; transform: none; width: auto; max-width: none; flex-wrap: wrap; gap: 4px 8px; }
  .rs-strip-k { display: none; }
  .rs-strip-fight { flex: 1 1 100%; justify-content: space-between; }
  .rs-strip-side { max-width: 42vw; }
  .rs-face { width: 36px; height: 36px; }
  .rs-strip-hp { width: 64px; }
  .rs-strip .rp-btn { flex: 1 1 0; }
  .rs-strip .rp-btn.rs-strip-off { flex: none; }
  .rs-strip.is-left { left: 8px; right: auto; }
}
@media (prefers-reduced-motion: reduce) { .rs-strip-hp em, .rs-strip-side { transition: none; } }
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
const _w = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

/** The box round what `roots` draw: their shown meshes' own bounds, world
 *  frame. Not `Box3.expandByObject`, which counts hidden helpers too (a
 *  hull's group sits at the origin, and boxed it the portrait framed the
 *  whole level). */
const _mb = new THREE.Box3();
function visibleBox(roots, box) {
  box.makeEmpty();
  for (const root of roots) {
    root.traverseVisible(o => {
      if (!o.isMesh || !o.geometry) return;
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      box.union(_mb.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld));
    });
  }
  return box;
}

export class ReplaySpotlight {
  constructor(player) {
    this.player = player;
    this.episodes = null;
    this.board = null;
    this.boardAt = -Infinity;
    // The kill lit: `{ raw, kill, from, until, faced, faceIn, yaw, steered }`,
    // or null.
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
    if (!document.getElementById('rs-spot-style')) {
      const style = el('style');
      style.id = 'rs-spot-style';
      style.textContent = STYLE;
      document.head.appendChild(style);
    }
    this.buildStrip();
    this.tagsEl = el('div', 'rs-tags');
    this.tagNodes = null;
    this.pops = [];
    this.root = el('div', 'rs-root');
    this.root.append(this.tagsEl, this.strip);
    player.ui.root.append(this.root);
  }

  buildStrip() {
    const ui = this.player.ui;
    this.strip = el('div', 'rs-strip');
    this.strip.setAttribute('role', 'status');
    this.sides = ['a', 'b'].map((key, i) => {
      const node = el('button', `rs-strip-side${i ? ' right' : ''}`);
      node.type = 'button';
      node.setAttribute('aria-pressed', 'false');
      const face = el('span', 'rs-face');
      const canvas = el('canvas');
      canvas.width = canvas.height = PORTRAIT;
      face.append(canvas);
      const text = el('span', 'rs-strip-text');
      const role = el('span', 'rs-role');
      const name = el('b');
      const what = el('small');
      const hp = el('span', 'rs-strip-hp');
      const bar = el('em');
      hp.append(bar);
      text.append(role, name, what, hp);
      node.append(face, text);
      node.addEventListener('click', () => this.followSide(key));
      return { key, node, face, canvas, role, name, what, hp, bar };
    });
    const mid = el('div', 'rs-strip-mid');
    this.score = el('b', '', '0 : 0');
    this.midLine = el('small', '', 'HITS');
    mid.append(this.score, this.midLine);
    // Between the two, what a click on either does.
    mid.insertAdjacentHTML('beforeend', '<svg class="rs-strip-swap" width="18" height="10" viewBox="0 0 18 10" aria-hidden="true">'
      + '<path d="M1 3h14l-3-2.5M17 7H3l3 2.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>');
    const fight = el('div', 'rs-strip-fight');
    fight.append(this.sides[0].node, mid, this.sides[1].node);
    this.againBtn = ui.button('rs-strip-again', null, 'Watch it again from just before the kill', () => this.again(), 'Again');
    const off = ui.button('rs-strip-off', 'close', 'Let go of this kill', () => this.release());
    this.stripK = el('span', 'rs-strip-k', 'SPOTLIGHT');
    this.strip.append(this.stripK, fight, this.againBtn, off);
    for (const type of ['pointerdown', 'wheel', 'click', 'dblclick']) this.strip.addEventListener(type, e => e.stopPropagation());
    // Used, it is kept: a pointer over the strip or a press on it holds the
    // kill on screen, and once it has been pressed the kill plays on a loop
    // until the cross lets it go. Without it the strip went the moment the
    // kill's last seconds ran out, under a pointer on its way to the other
    // side ("I click the victim and try to click again but it auto hides").
    this.strip.addEventListener('pointerenter', () => { this.hovered = true; });
    this.strip.addEventListener('pointerleave', () => { this.hovered = false; });
    this.strip.addEventListener('pointerdown', () => this.hold());
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
   * Spotlight on a kill in the timeline: the kill of `victimPid` at `t` from
   * just before it, the camera on one of the two (the one followed, else the
   * killer), playing. False, and said, when the recording places nobody who
   * could have made it.
   */
  light(t, victimPid) {
    const p = this.player;
    this.ensureEpisodes(true);
    const raw = fightOfKill(this.episodes, t, victimPid);
    if (!raw) {
      p.ui.flash('Nothing to light for that kill: the recording places no one who made it', 2800);
      return false;
    }
    const kill = raw.kill;
    if (!hasPlayer(raw, p.followPid) && Number.isInteger(kill.killerPid)) p.ui.follow(kill.killerPid);
    if (p.highlights?.auto || p.camera?.mode === 'free') p.ui.setMode('orbit');
    this.pin = { raw, kill, from: kill.t, until: kill.t + HOLD, faced: false };
    this.stripK.textContent = 'SPOTLIGHT';
    this.stripK.removeAttribute('title');
    this.setFight(raw, kill.t - KILL_FREEZE);
    // From before the kill, and before the round that made it.
    const killer = this.rounds.filter(r => r.kind === 'hit' && r.at === kill.victim && r.arrival <= kill.t + 0.1).at(-1);
    this.pin.from = Math.max(0, Math.min(kill.t - SPOT_LEAD, killer ? killer.f.t - SPOT_ROUND_LEAD : Infinity));
    this.raw = null;
    p.seek(this.pin.from);
    p.playing = true;
    return true;
  }

  /** The players of the kill lit, both sides, or null with none lit: the
   *  replay's name tags (replay-ui.js `updateTags`) keep theirs on however
   *  far off, and let everyone else's go. */
  litPids(t) {
    const fight = this.raw ? this.fight : null;
    if (!fight) return null;
    const rec = this.player.rec;
    const pids = new Set([...peopleOf(rec, fight.a, t), ...peopleOf(rec, fight.b, t)]);
    for (const pid of [fight.kill?.killerPid, fight.kill?.victimPid]) if (Number.isInteger(pid)) pids.add(pid);
    return pids;
  }

  /** The kill lit, once more from the start. */
  again() {
    if (!this.pin) return;
    this.pin.faced = false;
    this.pin.steered = false;
    this.pin.yaw = undefined;
    this.player.seek(this.pin.from);
    this.player.playing = true;
  }

  /** The kill lit kept on a loop until the cross lets it go: the strip was
   *  used (a side picked, Again). */
  hold() {
    if (!this.pin || this.pin.held) return;
    this.pin.held = true;
    this.stripK.textContent = 'ON LOOP';
    this.stripK.title = 'The kill plays again from the start until you close it';
  }

  /** Which side of the lit fight the replay follows: 'a', 'b' or null. */
  followedSide(t = this.player.time) {
    const fight = this.fight;
    const pid = this.player.followPid;
    if (!fight || !Number.isInteger(pid)) return null;
    for (const key of ['a', 'b']) if (peopleOf(this.player.rec, fight[key], t).includes(pid)) return key;
    const k = fight.kill;
    if (k && pid === k.killerPid) return fight.a === k.killer ? 'a' : 'b';
    if (k && pid === k.victimPid) return fight.a === k.killer ? 'b' : 'a';
    return null;
  }

  /** The one on `key`'s side of the strip followed (the shooter or the
   *  victim, a click on their portrait), the orbit turned to the other. */
  followSide(key) {
    const fight = this.fight;
    if (!fight || !fight[key]) return;
    const p = this.player;
    const life = fight[key];
    const k = fight.kill;
    let pid = peopleOf(p.rec, life, p.time)[0];
    if (!Number.isInteger(pid) && k) pid = life === k.killer ? k.killerPid : k.victimPid;
    if (!Number.isInteger(pid)) return;
    if (p.camera?.mode === 'free') p.ui.setMode('orbit');
    p.ui.follow(pid);
    if (this.pin) {
      this.pin.faced = false;
      this.pin.faceIn = 2;
      this.pin.steered = false;
      this.pin.yaw = undefined;
    }
    this.portraitAt = -Infinity;
  }

  /** Let go of the kill: the view comes back up. */
  release() {
    this.pin = null;
  }

  /** Nothing drawn. */
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
    this.player.ui.root.classList.remove('rs-lit');
    if (this.gl) this.gl.tracers.group.visible = false;
  }

  /** The kill let go, nothing drawn. */
  end() {
    this.pin = null;
    this.suspend();
    this.lit = [];
    this.litAt = -Infinity;
  }

  /** Each frame, last in the replay's: the kill lit, while there is one. */
  update(t, dt) {
    const pin = this.pin;
    // A play or a seek past the kill's last seconds lets it go; a seek back
    // into them, or a scrub about inside, keeps it.
    // Played past its end while held (the strip used) or under the pointer,
    // it starts again; a seek away still lets it go.
    const ran = pin && t > pin.until && this.lastT !== undefined && this.lastT <= pin.until && t - this.lastT < 1;
    this.lastT = t;
    if (ran && (pin.held || this.hovered)) {
      this.again();
      this.lastT = pin.from;
      return;
    }
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
    p.ui.root.classList.toggle('rs-lit', Boolean(raw));
    this.strip.classList.toggle('lit', Boolean(raw));
    // The orbit turns to the other once it has settled on the one it follows.
    if (this.pin && !this.pin.faced && this.fight && --this.pin.faceIn <= 0) {
      this.pin.faced = true;
      this.faceOther(this.fight, t);
    } else if (this.pin?.faced && this.fight) {
      this.faceOther(this.fight, t, FACE_DRIFT);
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
    this.portraitAt = -Infinity;
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

  /**
   * The orbit swings round to behind the followed player, looking at the
   * other, so both are in the view: once as the kill is lit, then again
   * whenever the other's direction drifts more than `drift` from where it
   * last turned to. A recording holds a far player's last place until they
   * come back into its range: an M6's victim stood 400 m from where they
   * were, and jumped behind the camera once the recording caught up. Only
   * the orbit the viewer is steering themselves, not Auto's director, and
   * never again once the viewer has turned it themselves.
   */
  faceOther(fight, t, drift = 0) {
    const p = this.player;
    const c = p.camera;
    const pin = this.pin;
    if (c?.mode !== 'orbit' || p.highlights?.auto || !Number.isFinite(c.yaw) || pin?.steered) return;
    // Turned since the last swing, and not by the swing: the viewer's.
    if (pin && pin.yaw !== undefined && Math.abs(c.yaw - pin.yaw) > 1e-6) {
      pin.steered = true;
      return;
    }
    // From whichever of the two is followed, to the other.
    const own = this.followedSide(t);
    if (!own) return;
    const a = this.placeOf(fight[own], t, new THREE.Vector3());
    const b = a ? this.placeOf(fight[own === 'a' ? 'b' : 'a'], t, new THREE.Vector3()) : null;
    if (!b) return;
    const dx = a.x - b.x;
    const dz = a.z - b.z;
    if (Math.hypot(dx, dz) < 1) return;
    const want = Math.atan2(dx, dz);
    const turn = Math.atan2(Math.sin(want - c.yaw), Math.cos(want - c.yaw));
    if (Math.abs(turn) <= drift) return;
    c.yaw += turn;
    if (pin) pin.yaw = c.yaw;
  }

  /** Every round between the two over the fight, with its flight. */
  roundsOf(fight, raw) {
    const p = this.player;
    const speedOf = (f, shooter) => roundOf(p, shooter, f.weapon)?.speed ?? null;
    const rounds = assignDrops(roundsBetween(p.rec, fight.a, fight.b, raw.first - LEAD - 2, raw.last + HOLD,
      { shotOf: f => this.shotOf?.get(f), speedOf }));
    for (const r of rounds) {
      const round = roundOf(p, r.shooter, r.f.weapon);
      const platform = r.shooter && !r.shooter.soldier ? motionAt(r.shooter, r.f.t)?.velocity ?? null : null;
      r.flight = flightOf(r.f, round, platform);
      r.span = Math.max(0.02, r.arrival - r.f.t) + (r.kind === 'hit' ? 0 : MISS_ON);
      r.steps = round?.gravity > 0 && r.span > 0.3 ? 8 : 1;
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
    const root = this.root.getBoundingClientRect();
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
        // A hull with nobody aboard (a man killed beside an empty jeep): the
        // kill's own man on that side, by name and side.
        const k = fight.kill;
        const own = k && !peopleOf(p.rec, life, fight.first).length ? (life === k.killer ? k.killerPid : k.victimPid) : null;
        if (Number.isInteger(own)) label.who = nameAt(p.rec, own, k.t) || label.who;
        const team = sideOf(p.rec, life, fight.first) || (Number.isInteger(own) ? teamAt(p.rec, own, k.t) : 0);
        const side = this.sides[i];
        side.node.className = `rs-strip-side${i ? ' right' : ''} ${teamClass(team)}`;
        side.soldier = label.soldier;
        side.name.textContent = shown(label.who);
        side.what.textContent = label.what;
        side.role.textContent = fight.kill ? (life === fight.kill.killer ? 'Shooter' : 'Victim') : '';
        side.node.title = `Follow ${shown(label.who)}`;
      }
    }
    const own = this.followedSide(t);
    for (const side of this.sides) {
      const on = side.key === own;
      if (side.node.classList.contains('is-on') !== on) {
        side.node.classList.toggle('is-on', on);
        side.node.setAttribute('aria-pressed', String(on));
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
      const node = el('div', `rs-tag ${teamClass(sideOf(p.rec, life, fight.first))}`);
      node.append(el('i'), document.createTextNode(shown(label.who)), el('small', '', label.what));
      const hp = el('span', 'rs-strip-hp');
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
    // Behind the camera by where it is from the camera, not by its projected
    // depth, which is past 1 for anything beyond the far plane too: an
    // opponent 400 m off in front of an M6 was put at the bottom edge.
    const behind = _w.copy(v).applyMatrix4(camera.matrixWorldInverse).z > 0;
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
    const root = this.root.getBoundingClientRect();
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
    const w = this.root.clientWidth;
    const h = this.root.clientHeight;
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
      // On the screen, the replay's own name tag is theirs when it drew one
      // (replay-ui.js `litTagged`); this one is for the edge, and for whoever
      // it does not tag (the dead, the first person's other side).
      const tagged = s.on && peopleOf(this.player.rec, tag.life, t).some(pid => this.player.ui.litTagged?.has(pid));
      tag.node.style.display = tagged ? 'none' : 'block';
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
        pop = el('div', `rs-pop${end ? ' is-end' : ''}`, end ? (r.at.soldier ? 'KILLED' : 'DESTROYED') : `−${Math.round(drop.amount)}`);
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
    return [...this.rootsOfSide(fight, fight.a, t), ...this.rootsOfSide(fight, fight.b, t)];
  }

  /** What one of the two (`life`) is drawn as: its hull and everyone in it,
   *  and on the victim's side the victim, still drawn falling for a moment
   *  after the kill. */
  rootsOfSide(fight, life, t) {
    const p = this.player;
    const roots = [];
    const pids = new Set();
    if (!life.soldier) {
      const hull = p.hulls?.get(life);
      if (hull?.group) roots.push(hull.group);
    }
    for (const pid of peopleOf(p.rec, life, t)) pids.add(pid);
    const k = fight.kill;
    if (k && life !== k.killer && Number.isInteger(k.victimPid) && hasPlayer(fight.raw, k.victimPid)) pids.add(k.victimPid);
    const bodies = p.soldiers?.bodies;
    const visuals = bodies?.botVisuals;
    for (const pid of pids) {
      // A dead man lies as a corpse of his own, apart from the living bodies.
      const corpse = bodies?.corpseOf?.(`replay:${pid}`);
      if (corpse && !roots.includes(corpse)) roots.push(corpse);
      const vis = visuals?.get(`replay:${pid}`);
      if (!vis) continue;
      if (vis.group && vis.group !== corpse) roots.push(vis.group);
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
      // The strip's two portraits, from the same lights; a nicety.
      try {
        this.renderPortraits(renderer, gl, fight);
      } catch (error) {
        if (!this.portraitWarned) console.warn('replay: the spotlight portraits', error);
        this.portraitWarned = true;
        this.portraitsOff = true;
      }
    } finally {
      spot.children = [];
      renderer.shadowMap.autoUpdate = saved.shadowAuto;
      renderer.shadowMap.needsUpdate = saved.shadowNeeds;
      renderer.autoClear = saved.autoClear;
      renderer.info.autoReset = saved.infoReset;
    }
    return true;
  }

  /**
   * Each side's portrait on the strip: that one alone (`rootsOfSide`), lit as
   * the page lit it, from a little aside of the line to the other one and
   * above, so a shooter is seen facing his victim and the victim facing him.
   * Drawn into a small target of its own every `PORTRAIT_EVERY` and read back
   * into the side's canvas; the page's frame is untouched.
   */
  renderPortraits(renderer, gl, fight) {
    if (this.portraitsOff || !this.strip.classList.contains('lit')) return;
    const now = performance.now() / 1000;
    if (now - (this.portraitAt ?? -Infinity) < PORTRAIT_EVERY || this.portraitBusy) return;
    this.portraitAt = now;
    const t = this.player.time;
    const webgpu = Boolean(renderer.isWebGPURenderer);
    gl.portraits ??= ['a', 'b'].map(() => {
      const Target = webgpu ? THREE.RenderTarget : THREE.WebGLRenderTarget;
      const target = new Target(PORTRAIT, PORTRAIT, { depthBuffer: true, samples: webgpu ? 1 : 4 });
      target.texture.colorSpace = THREE.SRGBColorSpace;
      return target;
    });
    gl.portraitCam ??= new THREE.PerspectiveCamera(PORTRAIT_FOV, 1, 0.05, 4000);
    gl.portraitPixels ??= new Uint8Array(PORTRAIT * PORTRAIT * 4);
    const cam = gl.portraitCam;
    const spot = gl.spot;
    const lights = this.lightsOf(this.player.ctx.scene);
    const box = gl.portraitBox ??= new THREE.Box3();
    const centre = _a;
    const size = _b;
    const savedTarget = renderer.getRenderTarget();
    const savedColour = renderer.getClearColor(new THREE.Color());
    const savedAlpha = renderer.getClearAlpha();
    const reads = [];
    const shown = [];
    try {
      spot.fog = null;
      renderer.setClearColor(0x000000, 0);
      ['a', 'b'].forEach((key, i) => {
        const side = this.sides[i];
        const life = fight[key];
        // Hidden ones too: the one followed in first person is hidden from
        // the page's view, and one off the screen culled. Shown for this
        // render only.
        let roots = this.rootsOfSide(fight, life, t);
        // An empty hull beside the kill's man (killed by a jeep he had left):
        // the man, not the jeep.
        const hull = !life.soldier ? this.player.hulls?.get(life)?.group : null;
        if (hull && roots.length > 1 && !peopleOf(this.player.rec, life, t).length) roots = roots.filter(r => r !== hull);
        for (const root of roots) {
          if (root.visible) continue;
          root.visible = true;
          shown.push(root);
        }
        visibleBox(roots, box);
        if (!roots.length || box.isEmpty()) {
          this.paintFigure(side);
          return;
        }
        box.getCenter(centre);
        box.getSize(size);
        // A man on foot by his drawn pelvis, a man's height around it (his
        // mesh's bounds are its bind pose, not where his limbs are); a box
        // past any hull's size has caught something else, and is framed on
        // where the one is instead.
        const footPid = life.soldier ? life.pid : null;
        const pelvis = Number.isInteger(footPid) ? this.player.soldiers?.pelvisOf?.(footPid, _w) : null;
        const own = pelvis ?? (size.length() > 60 ? this.placeOf(life, t, _w)?.setY(_w.y + 0.9) : null);
        if (own) centre.copy(own).setY(own.y + 0.15);
        const radius = own ? 1.25 : Math.max(0.6, size.length() / 2);
        // Towards the other one, swung aside (each its own way) and up.
        const other = this.placeOf(fight[key === 'a' ? 'b' : 'a'], t, _v);
        let yaw = other ? Math.atan2(other.x - centre.x, other.z - centre.z) : 0;
        yaw += key === 'a' ? PORTRAIT_YAW : -PORTRAIT_YAW;
        const dist = radius / Math.sin(THREE.MathUtils.degToRad(PORTRAIT_FOV) / 2) * 1.05;
        const flat = Math.cos(PORTRAIT_PITCH) * dist;
        cam.position.set(centre.x + Math.sin(yaw) * flat, centre.y + Math.sin(PORTRAIT_PITCH) * dist, centre.z + Math.cos(yaw) * flat);
        cam.lookAt(centre);
        cam.near = Math.max(0.05, dist - radius * 2);
        cam.far = dist + radius * 4;
        cam.updateProjectionMatrix();
        cam.updateMatrixWorld();
        spot.children = [...lights, ...roots];
        const target = gl.portraits[i];
        renderer.setRenderTarget(target);
        renderer.clear();
        renderer.render(spot, cam);
        if (webgpu) {
          reads.push(renderer.readRenderTargetPixelsAsync(target, 0, 0, PORTRAIT, PORTRAIT)
            .then(pixels => this.paintPortrait(side, pixels, false)));
        } else {
          renderer.readRenderTargetPixels(target, 0, 0, PORTRAIT, PORTRAIT, gl.portraitPixels);
          this.paintPortrait(side, gl.portraitPixels, true);
        }
      });
    } finally {
      for (const root of shown) root.visible = false;
      spot.children = [];
      renderer.setRenderTarget(savedTarget);
      renderer.setClearColor(savedColour, savedAlpha);
    }
    if (reads.length) {
      this.portraitBusy = true;
      Promise.all(reads).catch(() => { this.portraitsOff = true; }).finally(() => { this.portraitBusy = false; });
    }
  }

  /** Read-back pixels into a side's canvas, bottom row first where `flip`. */
  paintPortrait(side, pixels, flip) {
    const ctx = side.canvas.getContext('2d');
    if (!ctx || !pixels) return;
    side.image ??= ctx.createImageData(PORTRAIT, PORTRAIT);
    const out = side.image.data;
    const row = PORTRAIT * 4;
    for (let y = 0; y < PORTRAIT; y++) {
      const from = (flip ? PORTRAIT - 1 - y : y) * row;
      out.set(pixels.subarray(from, from + row), y * row);
    }
    // The page's shaders do not all write alpha: anything drawn is opaque,
    // and only what the clear left is the plate behind.
    for (let i = 0; i < out.length; i += 4) {
      out[i + 3] = out[i] || out[i + 1] || out[i + 2] || out[i + 3] ? 255 : 0;
    }
    ctx.putImageData(side.image, 0, 0);
    side.figure = false;
  }

  /** A side with nothing drawn to portray (the recorder's own soldier is
   *  drawn as his arms, a body not yet in): a figure in its side's colour. */
  paintFigure(side) {
    const kind = side.soldier === false ? 'hull' : 'soldier';
    if (side.figure === kind) return;
    side.figure = kind;
    const ctx = side.canvas.getContext('2d');
    if (!ctx) return;
    const s = PORTRAIT / 48;
    ctx.clearRect(0, 0, PORTRAIT, PORTRAIT);
    ctx.save();
    ctx.scale(s, s);
    ctx.fillStyle = getComputedStyle(side.node).getPropertyValue('--rs-team').trim() || '#a8a58c';
    ctx.globalAlpha = 0.85;
    ctx.fill(new Path2D(kind === 'hull'
      // A hull: a tank's body, turret and gun.
      ? 'M6 30h36l-3 7H9z M10 24h24l3 6H8z M17 17h12l3 7H15z M29 19h14v2H29z'
      // A soldier: head, helmet brim, shoulders and chest.
      : 'M24 9a6 6 0 1 1 0 12a6 6 0 1 1 0-12z M15 15h18v2H15z M11 40c0-8 6-13 13-13s13 5 13 13z'));
    ctx.restore();
  }

  dispose() {
    this.end();
    for (const target of this.gl?.portraits ?? []) target.dispose();
    if (this.gl) {
      this.gl.quad.geometry.dispose();
      this.gl.quad.material.dispose();
      this.gl.tracers.dispose();
      this.gl = null;
    }
    this.root.remove();
  }
}
