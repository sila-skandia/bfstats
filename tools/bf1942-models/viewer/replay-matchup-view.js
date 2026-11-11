// The replay's match-up (features/replay-matchup): the round frozen on two
// things that fought, every round that passed between them hanging in the
// air where it flew, and the two taken apart side by side, each painted by
// what the other's gun does to it, with every real hit pinned where it
// struck. Opened from the replay bar's menu (More, Match-up); nothing of it
// runs until then.
//
// What it is made of:
// - the fights near the playhead and the rounds between two things
//   (replay-matchup.js, pure);
// - where each round struck a hull, rebuilt and checked against the recorded
//   hit points (replay-matchup-strike.js);
// - the faces priced by the other's gun, the tank school's arithmetic
//   (tank-armour.js) and its bands;
// - the parts flown apart the way the model viewer's part inspector does it
//   (model-parts-index.js `popVector`).
//
// It says what happened and what the numbers allowed, never who should have
// won (features/battle-schools, "Lesson from the model browser: no verdict").

import * as THREE from 'three';
import { clone as skeletonClone } from './vendor/utils/SkeletonUtils.js';
import { OrbitControls } from './vendor/controls/OrbitControls.js';
import {
  BODY_PARTS, PAD, armourAgainst, aspectWords, assignDrops, bodyPartFor, endingWords, fightsNear, healthOf,
  labelOf, peopleOf, roundsBetween, seenFrom, sideOf, sideWords, tallyOf,
} from './replay-matchup.js';
import { HullCaster, flightOf, gunSpecOf, priceOf, tablesOf } from './replay-matchup-strike.js';
import { BANDS, CATCHER, IMMUNE, bandOf, bearingShots, faceName } from './tank-armour.js';
import { shotsFor } from './armour-damage.js';
import { motionAt, poseAt } from './replay-kinematics.js';
import { prettyTank } from './tank-arena.js';
import { buildPartIndex, hasGeometry, popVector } from './model-parts-index.js';
import { fmtClock } from './replay-timeline.js';
import { decodePlayerName } from './vehicle-players.js';

/** A name as players see it (stored names are raw: CLAUDE.md, names). */
const shown = names => String(names ?? '').split(', ').map(n => decodePlayerName(n)).join(', ');

/** What each round's colour means, in the replay's tokens. */
const ROUND_COLOURS = Object.freeze({
  hit: 0xf0913c,     // did damage
  glanced: 0x7fd0e4, // met the hull and did none
  near: 0xa39c6c,    // passed by
  odd: 0xe8c35a,     // a hit whose place could not be rebuilt for certain
});
/** Seconds a pin pulses when its row is picked. */
const PULSE = 1.4;
/** How far the parts fly, a share of the model's size, for depth 1 and below. */
const SPREAD = [0.26, 0.16];
/** Seconds the take-apart takes, and the stagger between depths. */
const FLY = 0.55;
const STAGGER = 0.14;

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
const esc = text => String(text ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const fmt = v => (v === null || v === undefined || !Number.isFinite(v) ? '?' : Number.isInteger(v) ? String(v) : v.toFixed(1));
const teamClass = team => (team === 1 ? 'is-axis' : team === 2 ? 'is-allies' : '');
const hex = n => `#${n.toString(16).padStart(6, '0')}`;

const STYLE = `
.rm-root { position: absolute; inset: 0; pointer-events: none; display: none; z-index: 6; }
.rm-root.on { display: block; }
.rm-vignette { position: absolute; inset: 0; pointer-events: none;
  background: radial-gradient(ellipse at 42% 46%, transparent 38%, rgba(8, 8, 6, .55) 100%); }
.rm-vignette::after { content: ''; position: absolute; inset: 0;
  background: repeating-linear-gradient(0deg, rgba(255, 255, 255, .018) 0 1px, transparent 1px 3px); }
.rm-stamp { flex: none; padding: 3px 7px; border-radius: 3px; background: var(--rp-khaki-ink); color: var(--rp-khaki);
  font: 800 9px/1.2 var(--rp-font); letter-spacing: .2em; white-space: nowrap; }
.rm-stamp b { color: var(--rp-ink); font-family: var(--rp-mono); letter-spacing: 0; margin-left: 6px; }
/* The game's own layers would draw over the stage. */
html:has(.rm-stage.on) #hud-canvas, html:has(.rm-stage.on) #comms-canvas, html:has(.rm-stage.on) #minimap,
html:has(.rm-stage.on) #crosshair, html:has(.rm-stage.on) #scout-canvas, html:has(.rm-stage.on) #side,
html:has(.rm-stage.on) .map-controls-fab { visibility: hidden !important; }
.rm-tags { position: absolute; inset: 0; pointer-events: none; }
.rm-tag { position: absolute; transform: translate(-50%, -100%); padding: 3px 7px 4px; border-left: 2px solid var(--rp-edge-strong);
  background: var(--rp-plate-deep); font: 700 11px/1.25 var(--rp-font); white-space: nowrap; }
.rm-tag small { display: block; color: var(--rp-muted); font: 10px/1.3 var(--rp-mono); }
.rm-tag.is-axis { border-color: var(--rp-axis); }
.rm-tag.is-allies { border-color: var(--rp-allies); }
.rm-tag.rm-range { transform: translate(-50%, -50%); border: 1px solid var(--rp-edge); color: var(--rp-khaki); font: 700 11px var(--rp-mono); }

.rm-panel { position: absolute; top: 12px; right: 12px; bottom: calc(var(--rp-bar-h) + 22px); width: min(400px, calc(100% - 24px));
  display: flex; flex-direction: column; pointer-events: auto; border: 1px solid var(--rp-edge); border-radius: 8px;
  background: var(--rp-plate-deep); box-shadow: 0 10px 32px rgba(0, 0, 0, .5); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
  overflow: hidden; -webkit-user-select: text; user-select: text; }
.rm-head { display: flex; align-items: center; gap: 8px; padding: 0 4px 0 12px; height: 32px; flex: none; background: var(--rp-khaki);
  color: var(--rp-khaki-ink); font: 800 11px/1 var(--rp-font); letter-spacing: .2em; }
.rm-head span { flex: 1; }
.rm-head .rp-btn { color: var(--rp-khaki-ink); height: 26px; }
.rm-head .rp-btn:hover { background: rgba(0, 0, 0, .12); border-color: transparent; }
.rm-body { flex: 1 1 auto; overflow-y: auto; padding: 10px 12px 14px; overscroll-behavior: contain; }
.rm-eyebrow { margin: 14px 0 6px; color: var(--rp-muted); font: 800 9px/1.3 var(--rp-font); letter-spacing: .2em; text-transform: uppercase; }
.rm-eyebrow:first-child { margin-top: 2px; }
.rm-fights { display: flex; flex-direction: column; gap: 3px; max-height: 196px; overflow-y: auto; overscroll-behavior: contain; }
.rm-fight { appearance: none; display: grid; grid-template-columns: 1fr auto; gap: 2px 8px; width: 100%; padding: 6px 8px; margin: 0;
  border: 1px solid transparent; border-radius: 5px; background: rgba(255, 255, 255, .04); color: var(--rp-ink); text-align: left;
  font: 700 11px/1.3 var(--rp-font); cursor: pointer; }
.rm-fight:hover { border-color: var(--rp-edge); }
.rm-fight.on { border-color: var(--rp-edge-strong); background: rgba(163, 156, 108, .16); }
.rm-fight small { grid-column: 1 / -1; color: var(--rp-muted); font: 10px/1.3 var(--rp-mono); }
.rm-fight i { font-style: normal; color: var(--rp-muted); font-weight: 400; }
.rm-vs { display: grid; grid-template-columns: 1fr 22px 1fr; gap: 6px; align-items: stretch; }
.rm-vs > b { align-self: center; text-align: center; color: var(--rp-khaki); font: 800 10px var(--rp-font); letter-spacing: .12em; }
.rm-side { min-width: 0; padding: 7px 8px 8px; border: 1px solid var(--rp-edge); border-top: 2px solid var(--rp-edge-strong); border-radius: 5px;
  background: rgba(0, 0, 0, .22); }
.rm-side.is-axis { border-top-color: var(--rp-axis); }
.rm-side.is-allies { border-top-color: var(--rp-allies); }
.rm-who { font: 800 12px/1.25 var(--rp-font); overflow-wrap: anywhere; }
.rm-what { color: var(--rp-muted); font: 700 10px/1.3 var(--rp-font); letter-spacing: .08em; text-transform: uppercase; }
.rm-hp { margin: 6px 0 2px; height: 5px; border-radius: 3px; background: rgba(255, 255, 255, .12); position: relative; overflow: hidden; }
.rm-hp i, .rm-hp em { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 3px; }
.rm-hp i { background: rgba(169, 195, 106, .35); }
.rm-hp em { background: var(--rp-life); }
.rm-stat { display: flex; justify-content: space-between; align-items: baseline; gap: 6px; font: 10px/1.5 var(--rp-mono); color: var(--rp-muted); }
.rm-stat span { flex: none; }
.rm-stat b { min-width: 0; color: var(--rp-ink); font-weight: 600; text-align: right; }
.rm-words { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 6px; font: 12px/1.45 var(--rp-font); }
.rm-words li { padding-left: 10px; border-left: 2px solid var(--rp-edge); }
.rm-words li.is-end { border-color: var(--rp-gold); }
.rm-slice { display: block; width: 100%; height: auto; margin-top: 2px; border: 1px solid var(--rp-edge); border-radius: 5px; background: rgba(0, 0, 0, .25); }
.rm-key { display: flex; flex-wrap: wrap; gap: 4px 12px; margin-top: 6px; color: var(--rp-muted); font: 10px/1.4 var(--rp-font); }
.rm-key span { display: inline-flex; align-items: center; gap: 5px; }
.rm-key i { width: 10px; height: 3px; border-radius: 2px; }
.rm-key.is-faces i { width: 10px; height: 10px; border-radius: 2px; }
.rm-actions { display: flex; gap: 6px; flex: none; padding: 8px 12px 10px; border-top: 1px solid var(--rp-edge); }
.rm-actions .rp-btn { flex: 1; height: 32px; border-color: var(--rp-edge-strong); background: rgba(0, 0, 0, .3); }
.rm-actions .rp-btn.rm-go { background: var(--rp-khaki); color: var(--rp-khaki-ink); border-color: var(--rp-khaki); }
.rm-wait { color: var(--rp-muted); font: 11px/1.4 var(--rp-font); }

.rm-stage { position: absolute; inset: 0; display: none; pointer-events: auto; background:
  radial-gradient(ellipse at 50% 40%, #2e2e26, #0c0c0a 75%); z-index: 2; }
.rm-stage.on { display: block; }
.rm-stage canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; touch-action: none; }
.rm-stage-head { position: absolute; left: 0; right: 0; top: 0; display: flex; align-items: center; gap: 10px; padding: 10px 12px;
  pointer-events: none; }
.rm-stage-head > * { pointer-events: auto; }
.rm-stage-title { flex: 1; color: var(--rp-khaki); font: 800 11px/1.3 var(--rp-font); letter-spacing: .22em; }
.rm-stage-title b { color: var(--rp-ink); letter-spacing: .04em; margin-left: 6px; }
.rm-stage-head .rp-btn { border-color: var(--rp-edge); background: var(--rp-plate-deep); height: 30px; }
.rm-cols { position: absolute; left: 0; right: 0; bottom: 12px; display: grid; grid-template-columns: 1fr 1fr; gap: 12px; padding: 0 12px;
  pointer-events: none; }
.rm-col { pointer-events: auto; max-height: 34vh; overflow-y: auto; padding: 8px 10px; border: 1px solid var(--rp-edge); border-radius: 6px;
  background: var(--rp-plate-deep); font: 11px/1.4 var(--rp-font); overscroll-behavior: contain; }
.rm-col h3 { margin: 0 0 2px; font: 800 12px/1.3 var(--rp-font); }
.rm-col h3 small { display: block; color: var(--rp-muted); font: 700 10px/1.4 var(--rp-font); letter-spacing: .06em; text-transform: uppercase; }
.rm-col p { margin: 4px 0; color: var(--rp-muted); }
.rm-rows { display: flex; flex-direction: column; gap: 1px; margin-top: 6px; }
.rm-row { appearance: none; display: grid; grid-template-columns: 10px 44px 1fr auto; gap: 8px; align-items: center; padding: 4px 4px; margin: 0;
  border: 0; border-radius: 3px; background: none; color: var(--rp-ink); text-align: left; font: 11px/1.3 var(--rp-font); cursor: pointer; }
.rm-row:hover, .rm-row.on { background: rgba(255, 255, 255, .07); }
.rm-row i { width: 8px; height: 8px; border-radius: 50%; }
.rm-row time { color: var(--rp-muted); font: 10px var(--rp-mono); }
.rm-row b { font: 600 11px var(--rp-mono); }
.rm-row small { grid-column: 3 / -1; color: var(--rp-muted); font: 10px/1.3 var(--rp-font); }
.rm-pins { position: absolute; inset: 0; pointer-events: none; }
.rm-pin { position: absolute; transform: translate(-50%, -130%); padding: 1px 4px; border-radius: 3px; background: rgba(12, 12, 10, .85);
  color: #f0913c; font: 700 10px var(--rp-mono); white-space: nowrap; }
.rm-pin.is-glanced { color: var(--rp-air); }
.rm-pin.is-odd { color: var(--rp-gold); }
.rm-legend { position: absolute; right: 12px; top: 50px; padding: 6px 8px; border: 1px solid var(--rp-edge); border-radius: 6px;
  background: var(--rp-plate-deep); pointer-events: none; }
.rm-legend .rm-key { flex-direction: column; margin: 0; gap: 3px; }
.rm-caption { position: absolute; transform: translateX(-50%); color: var(--rp-muted); font: 800 10px/1.3 var(--rp-font); letter-spacing: .14em;
  text-transform: uppercase; white-space: nowrap; pointer-events: none; }
@media (max-width: 720px) {
  .rm-panel { top: auto; left: 8px; right: 8px; width: auto; bottom: calc(var(--rp-bar-h) + 14px); max-height: 52vh; }
  .rm-cols { grid-template-columns: 1fr; gap: 6px; bottom: 8px; padding: 0 8px; }
  .rm-col { max-height: 19vh; padding: 6px 8px; }
  .rm-legend { top: 52px; left: 8px; right: 8px; padding: 5px 7px; }
  .rm-legend .rm-key { flex-direction: row; flex-wrap: wrap; gap: 3px 10px; }
  .rm-legend .rm-key + .rm-key { margin-top: 3px !important; }
  .rm-stage-title b { display: none; }
}
`;

/** Every mesh of `root`, in traversal order: a clone's meshes line up with
 *  its original's, one for one. */
function meshesOf(root) {
  const out = [];
  root.traverse(o => { if (o.isMesh) out.push(o); });
  return out;
}

/** What a round's colour is, from what came of it. */
function roundColour(r) {
  if (r.kind === 'hit') return r.strike && (r.strike.status === 'unexplained' || r.strike.status === 'approximate') ? ROUND_COLOURS.odd : ROUND_COLOURS.hit;
  return r.struck ? ROUND_COLOURS.glanced : ROUND_COLOURS.near;
}

/** A round's status in words. */
function statusWords(r) {
  if (r.kind !== 'hit') {
    if (!r.struck) return `missed by ${fmt(Math.round(r.miss * 10) / 10)} m`;
    return r.struck.damage > 0.5 ? `met a plate it can hurt (${fmt(r.struck.damage)}), but the recording has no drop` : 'struck, no damage';
  }
  const words = statusOf(r);
  return r.inferred ? `${words} (passed through just before a drop no other round took)` : words;
}

function statusOf(r) {
  const s = r.strike?.status;
  if (s === 'matched') return 'matches the recorded hit points';
  if (s === 'solved') return `matches ${fmt(r.strike.offset)} m off its path`;
  if (s === 'unexplained') return 'no plate on its path costs the recorded drop';
  if (s === 'approximate') return 'its path missed the hull: nearest plate shown';
  if (r.part) return `${r.part.part.label}, ${fmt(r.part.expected)} for a hit there`;
  return 'recorded drop';
}

export class ReplayMatchup {
  constructor(player) {
    this.player = player;
    this.on = false;
    this.fights = [];
    this.fight = null;
    this.view = null;
    this.pending = null;
    if (!document.getElementById('rm-style')) {
      const style = el('style');
      style.id = 'rm-style';
      style.textContent = STYLE;
      document.head.appendChild(style);
    }
    this.root = el('div', 'rm-root');
    this.vignette = el('div', 'rm-vignette');
    this.stamp = el('div', 'rm-stamp');
    this.tags = el('div', 'rm-tags');
    this.buildPanel();
    this.stage = new MatchupStage(this);
    this.root.append(this.vignette, this.tags, this.panel, this.stage.el);
    player.ui.root.append(this.root);
    // Stop the replay's own input layer taking a drag or a wheel on the panel.
    for (const node of [this.panel, this.stage.el]) {
      for (const type of ['pointerdown', 'wheel', 'click', 'dblclick']) node.addEventListener(type, e => e.stopPropagation());
    }
    this.menuItem = player.ui.menuItem?.('', 'matchup', 'Match-up', '', () => this.toggle()) ?? null;
  }

  buildPanel() {
    this.panel = el('section', 'rm-panel');
    this.panel.setAttribute('aria-label', 'Match-up');
    const head = el('div', 'rm-head');
    head.append(el('span', '', 'MATCH-UP'), this.stamp);
    const close = this.player.ui.button('', 'close', 'Close the match-up (Esc)', () => this.close());
    head.append(close);
    this.body = el('div', 'rm-body');
    this.actions = el('div', 'rm-actions');
    this.apartBtn = this.player.ui.button('rm-go', null, 'Take them apart, side by side', () => this.takeApart(), 'Take them apart');
    this.backBtn = this.player.ui.button('', null, 'Back to the round', () => this.close(), 'Back to the round');
    this.actions.append(this.apartBtn, this.backBtn);
    this.panel.append(head, this.body, this.actions);
  }

  toggle() {
    if (this.on) this.close();
    else this.start();
  }

  /** Freeze the round on the best fight near the playhead. */
  start() {
    const p = this.player;
    const t = p.time;
    const board = p.accuracy?.() ?? [];
    const shots = board.flatMap(e => e.shots ?? []);
    this.shotOf = new Map(shots.map(s => [s.f, s]));
    this.fights = fightsNear(p.rec, shots, p.kills, t, { follow: p.followPid }).slice(0, 8);
    if (!this.fights.length) {
      p.ui.flash('No fight here to match up: it needs two that hit each other, or a kill, within 30 s', 2800);
      return;
    }
    this.on = true;
    this.resumeAt = t;
    // Whatever focus the page had (the dogfight school's two), back on close.
    this.prevFocus = p.focus ? { nids: [...p.focus.nids], pids: [...p.focus.pids] } : null;
    p.playing = false;
    this.root.classList.add('on');
    p.ui.root.classList.add('rm-open');
    this.pick(this.fights[0]);
  }

  /** Freeze on `fight`. */
  pick(fight) {
    const p = this.player;
    this.stage.hide();
    this.clearWorld();
    this.fight = fight;
    this.view = null;
    p.seek(fight.moment);
    p.playing = false;
    const people = new Set([...peopleOf(p.rec, fight.a, fight.moment), ...peopleOf(p.rec, fight.b, fight.moment)]);
    p.setFocus({ nids: [fight.a.nid, fight.b.nid], pids: [...people] });
    // Built once the frame has drawn both where they were at the moment.
    this.pending = { fight, frames: 2 };
    this.renderBoard();
  }

  close() {
    if (!this.on) return;
    const p = this.player;
    this.on = false;
    this.pending = null;
    this.stage.hide(true);
    this.clearWorld();
    p.setFocus(this.prevFocus ?? null);
    this.prevFocus = null;
    this.root.classList.remove('on');
    p.ui.root.classList.remove('rm-open');
    this.tags.textContent = '';
    this.tagNodes = null;
    this.fight = null;
    this.view = null;
  }

  /** Esc: the stage first, then the match-up. */
  key(e, once) {
    if (!this.on) return undefined;
    if (e.code === 'Escape') {
      if (once) {
        if (this.stage.on) this.stage.hide();
        else this.close();
      }
      return true;
    }
    if (this.stage.on && ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'Space'].includes(e.code)) return true;
    return undefined;
  }

  /** Each frame, last in the replay's: build what waits on the frame, follow
   *  the two with their tags, and draw the stage. Play or a seek away ends
   *  the freeze. */
  update(t, dt) {
    if (!this.on) return;
    const p = this.player;
    if (p.playing || (this.fight && Math.abs(t - this.fight.moment) > 0.5 && !this.pending)) {
      this.close();
      return;
    }
    if (this.pending && --this.pending.frames <= 0) {
      const { fight } = this.pending;
      this.pending = null;
      try {
        this.build(fight);
      } catch (error) {
        console.warn('replay: the match-up could not be built', error);
        this.body.querySelector('.rm-wait')?.replaceChildren('The match-up could not be worked out for this fight.');
      }
    }
    this.placeTags();
    this.stage.frame(dt);
  }


  /** The things' places at the moment, view frame. */
  placeOf(life, t) {
    const hull = life.soldier ? null : this.player.hulls.get(life);
    if (hull?.root) return hull.root.getWorldPosition(new THREE.Vector3());
    const pose = poseAt(life, t);
    return pose ? new THREE.Vector3(pose.p[0], pose.p[1], pose.p[2]) : null;
  }

  /** Work out the fight: its rounds, where each struck, the words, the
   *  drawing, the camera. */
  build(fight) {
    const p = this.player;
    const rec = p.rec;
    const m = fight.moment;
    const tables = tablesOf(p);
    const from = Math.min(fight.first, m) - PAD - 2;
    const to = Math.max(fight.last, m) + PAD;
    const speedOf = (f, shooter) => gunSpecOf(p, shooter, f.weapon)?.speed ?? null;
    // A round that got there after the other was dead struck a wreck.
    const rounds = assignDrops(roundsBetween(rec, fight.a, fight.b, from, to, { shotOf: f => this.shotOf.get(f), speedOf }))
      .filter(r => !(healthOf(r.at, r.arrival - 0.05).hp <= 0));
    const casters = new Map();
    const casterOf = life => {
      if (life.soldier) return null;
      if (!casters.has(life)) {
        const hull = p.hullOf(life);
        casters.set(life, hull?.root ? new HullCaster(p, hull, m) : null);
      }
      return casters.get(life);
    };
    for (const r of rounds) {
      r.spec = gunSpecOf(p, r.shooter, r.f.weapon);
      if (r.at.soldier) {
        if (r.kind === 'hit' && r.drop && r.spec && tables) {
          r.part = bodyPartFor(r.drop.amount, priceOf(r.spec, tables, r.along), { killed: r.drop.after <= 0 });
        }
        continue;
      }
      // A round that passed further off than the hull is big met nothing.
      const caster = casterOf(r.at);
      if (!caster || (r.kind === 'near' && r.miss > 12)) continue;
      try {
        r.strike = caster.strike(r, r.spec, tables);
      } catch (error) {
        console.warn('replay: a match-up round could not be cast', error);
        r.strike = null;
      }
      if (r.kind === 'near' && r.strike) r.struck = { damage: r.strike.damage };
    }
    const sides = ['a', 'b'].map(key => this.sideFacts(fight, key, rounds, tables));
    this.view = { fight, rounds, sides, tables, casters };
    this.drawWorld();
    this.frameCamera();
    this.renderBoard();
    // What each could see of the other, priced: a grid of rays over the
    // other's hull, worked out after the board is up.
    setTimeout(() => {
      if (this.view?.fight !== fight) return;
      for (const [i, side] of this.view.sides.entries()) {
        const other = this.view.sides[1 - i];
        try { side.seen = this.seenOf(side, other); } catch (error) { console.warn('replay: the match-up aspect', error); }
      }
      this.renderBoard();
    }, 30);
  }

  /** One side's facts: who, what, their gun, their rounds, their health. */
  sideFacts(fight, key, rounds, tables) {
    const p = this.player;
    const life = fight[key];
    const m = fight.moment;
    const label = labelOf(p.rec, life, m, prettyTank);
    const mine = rounds.filter(r => r.by === key);
    // The gun that paints the other: the most dangerous one this side fired
    // at them (a Tiger's 88, not the coaxial gun it fired more of), else
    // their main gun.
    const used = new Map();
    for (const r of mine) if (r.spec?.material !== null && r.spec?.material !== undefined) used.set(r.spec, (used.get(r.spec) ?? 0) + 1);
    const other = fight[key === 'a' ? 'b' : 'a'];
    const worst = spec => this.worstAgainst(spec, other, tables);
    let gun = [...used.entries()].sort((x, y) => worst(y[0]) - worst(x[0]) || y[1] - x[1])[0]?.[0] ?? null;
    if (!gun && !life.soldier) gun = this.mainGunOf(life);
    const health = healthOf(life, m);
    const end = healthOf(life, Math.max(fight.last, m) + PAD);
    return {
      key, life, ...label, team: sideOf(p.rec, life, m), gun, rounds: mine, tally: tallyOf(mine),
      health, end, seen: null,
    };
  }

  /** The most a square hit from `spec`'s round costs `life`: its worst plate
   *  for a hull, a chest hit for a soldier. */
  worstAgainst(spec, life, tables) {
    if (!spec || !tables) return 0;
    const price = priceOf(spec, tables, 0);
    if (life.soldier) return price(41);
    const hull = this.player.hulls.get(life);
    let most = 0;
    hull?.root?.traverse(o => {
      if (!o.isMesh || !o.geometry?.userData?.collision) return;
      most = Math.max(most, price(Number(o.geometry.userData.defenseMaterial)) || 0);
    });
    return most;
  }

  /** A hull's main gun, when it fired nothing at the other: its FireArms
   *  whose round costs the most. */
  mainGunOf(life) {
    const p = this.player;
    const model = p.hullModels?.get(life.tmpl)?.normal;
    const tables = tablesOf(p);
    let best = null;
    model?.traverse(o => {
      if (!o.userData?.fireArms || !o.name) return;
      const spec = gunSpecOf(p, life, o.name);
      if (!spec || spec.material === null || spec.material === undefined) return;
      const damage = Number(tables?.materials?.[spec.material]?.damage) || 0;
      const kind = String(o.userData.fireArms.projectile?.kind ?? '');
      const score = damage + (kind === 'shell' ? 1000 : 0);
      if (!best || score > best.score) best = { spec, score };
    });
    return best?.spec ?? null;
  }

  /** What `side` saw of `other` at the moment, priced by its gun. */
  seenOf(side, other) {
    const p = this.player;
    const m = this.view.fight.moment;
    const view = seenFrom(side.life, other.life, m, poseAt);
    if (!view) return null;
    const seen = { aspect: aspectWords(view.bearing), range: view.range, bearing: view.bearing, elevation: view.elevation, share: null, hits: null };
    const hull = other.life.soldier ? null : p.hulls.get(other.life);
    const tables = this.view.tables;
    if (hull?.root && side.gun && tables) {
      const rest = this.restClone(hull);
      const price = priceOf(side.gun, tables, view.range);
      const hp = other.life.maxhp || other.health.max || 100;
      const rose = bearingShots(rest, price, hp, { bearings: [view.bearing], elevation: view.elevation, step: 0.25 });
      const at = rose?.[view.bearing];
      if (at) {
        seen.share = at.share;
        seen.hits = at.share > 0 ? at.hurtShots : null;
      }
    }
    return seen;
  }

  /** A copy of `hull` as it stands at the moment, at its own origin. */
  restClone(hull) {
    const clone = skeletonClone(hull.root);
    clone.position.set(0, 0, 0);
    clone.quaternion.identity();
    clone.updateMatrixWorld(true);
    return clone;
  }

  // --- the round, frozen ---------------------------------------------------------

  clearWorld() {
    if (this.world) {
      this.world.parent?.remove(this.world);
      this.world.traverse(o => {
        o.geometry?.dispose?.();
        if (o.material) [o.material].flat().forEach(mat => mat.dispose?.());
      });
      this.world = null;
    }
  }

  /** Every round between them, where it flew, coloured by what came of it;
   *  each strike a bead where it landed. */
  drawWorld() {
    this.clearWorld();
    const { rounds, fight } = this.view;
    const group = new THREE.Group();
    group.name = 'match-up';
    const positions = [];
    const colours = [];
    const colour = new THREE.Color();
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const beads = [];
    for (const r of rounds) {
      const flight = flightOf(r.f, r.spec, r.shooter && !r.shooter.soldier ? motionAt(r.shooter, r.f.t)?.velocity ?? null : null);
      const end = r.strike?.point ?? null;
      const span = Math.max(0.05, r.arrival - r.f.t);
      const steps = r.spec?.gravity > 0 && span > 0.4 ? 18 : 1;
      colour.setHex(roundColour(r));
      // Rounds after the frozen moment are drawn fainter: they are still to come.
      const k = r.f.t > fight.moment + 0.05 ? 0.4 : 1;
      for (let i = 0; i < steps; i++) {
        flight.at((span * i) / steps, a);
        if (i === steps - 1 && end) b.copy(end);
        else flight.at((span * (i + 1)) / steps, b);
        positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
        colours.push(colour.r * k, colour.g * k, colour.b * k, colour.r * k, colour.g * k, colour.b * k);
      }
      if (end) beads.push({ at: end, colour: roundColour(r) });
    }
    if (positions.length) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
      const lines = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({
        vertexColors: true, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false,
      }));
      lines.renderOrder = 998;
      lines.frustumCulled = false;
      group.add(lines);
    }
    const bead = new THREE.SphereGeometry(0.22, 12, 8);
    for (const { at, colour: c } of beads) {
      const mesh = new THREE.Mesh(bead, new THREE.MeshBasicMaterial({ color: c, depthTest: false, transparent: true }));
      mesh.position.copy(at);
      mesh.renderOrder = 999;
      group.add(mesh);
    }
    // The line between them at the moment, on the ground's level of each.
    const pa = this.placeOf(fight.a, fight.moment);
    const pb = this.placeOf(fight.b, fight.moment);
    if (pa && pb) {
      const geometry = new THREE.BufferGeometry().setFromPoints([pa.clone().setY(pa.y + 1.2), pb.clone().setY(pb.y + 1.2)]);
      const line = new THREE.Line(geometry, new THREE.LineDashedMaterial({ color: 0xeeecd9, dashSize: 2, gapSize: 1.4, transparent: true, opacity: 0.55, depthTest: false }));
      line.computeLineDistances();
      line.renderOrder = 997;
      group.add(line);
    }
    group.updateMatrixWorld(true);
    this.player.ctx.scene.add(group);
    this.world = group;
  }

  /** The free camera off to one side of the two, high enough to see the
   *  rounds' arcs between them. */
  frameCamera() {
    const { fight } = this.view;
    const pa = this.placeOf(fight.a, fight.moment);
    const pb = this.placeOf(fight.b, fight.moment);
    if (!pa || !pb) return;
    const p = this.player;
    const mid = pa.clone().add(pb).multiplyScalar(0.5);
    const d = pb.clone().sub(pa);
    const dist = Math.max(4, d.length());
    const side = new THREE.Vector3(d.z, 0, -d.x).normalize();
    if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
    // The side the camera already is, so the cut is short.
    const cam = p.ctx.camera.position;
    if (side.dot(cam.clone().sub(mid)) < 0) side.negate();
    const back = Math.min(900, dist * 0.8 + 22);
    const pos = mid.clone().addScaledVector(side, back).add(new THREE.Vector3(0, Math.min(400, dist * 0.32 + 9), 0));
    // The panel covers the right of the view (the bottom on a phone): the
    // camera looks past the two so they sit in what is left.
    const toMid = mid.clone().sub(pos);
    const right = new THREE.Vector3().crossVectors(toMid, new THREE.Vector3(0, 1, 0)).normalize();
    const phone = this.root.clientWidth <= 720;
    const aim = phone ? mid.clone().add(new THREE.Vector3(0, -toMid.length() * 0.22, 0))
      : mid.clone().addScaledVector(right, toMid.length() * 0.2);
    const look = aim.sub(pos).normalize();
    p.ui.setMode('free');
    p.camera.free.pos.copy(pos);
    p.camera.free.yaw = Math.atan2(-look.x, -look.z);
    p.camera.free.pitch = Math.asin(Math.max(-1, Math.min(1, look.y)));
  }

  /** The two's tags over the view, and the range between them. */
  placeTags() {
    const fight = this.fight;
    if (!fight) return;
    const p = this.player;
    const camera = p.ctx.camera;
    const w = this.root.clientWidth;
    const h = this.root.clientHeight;
    const project = (v, node) => {
      const s = v.clone().project(camera);
      const shown = s.z > -1 && s.z < 1 && Math.abs(s.x) < 1.2 && Math.abs(s.y) < 1.2;
      node.style.display = shown ? '' : 'none';
      if (shown) node.style.transform = `translate(${((s.x + 1) / 2) * w}px, ${((1 - s.y) / 2) * h}px) translate(-50%, -100%)`;
    };
    if (!this.tagNodes || this.tagNodes.fight !== fight) {
      this.tags.textContent = '';
      const make = key => {
        const life = fight[key];
        const label = labelOf(p.rec, life, fight.moment, prettyTank);
        const node = el('div', `rm-tag ${teamClass(sideOf(p.rec, life, fight.moment))}`);
        node.innerHTML = `${esc(shown(label.who))}<small>${esc(label.what)}</small>`;
        node.style.left = '0'; node.style.top = '0';
        this.tags.append(node);
        return node;
      };
      const range = el('div', 'rm-tag rm-range');
      range.style.left = '0'; range.style.top = '0';
      this.tags.append(range);
      this.tagNodes = { fight, a: make('a'), b: make('b'), range };
      this.stamp.innerHTML = `FROZEN<b>${esc(fmtClock(fight.moment))}</b>`;
    }
    const pa = this.placeOf(fight.a, fight.moment);
    const pb = this.placeOf(fight.b, fight.moment);
    if (pa) project(pa.clone().setY(pa.y + (fight.a.soldier ? 2.4 : 4)), this.tagNodes.a);
    if (pb) project(pb.clone().setY(pb.y + (fight.b.soldier ? 2.4 : 4)), this.tagNodes.b);
    if (pa && pb) {
      this.tagNodes.range.textContent = `${Math.round(pa.distanceTo(pb))} m`;
      const mid = pa.clone().add(pb).multiplyScalar(0.5).setY((pa.y + pb.y) / 2 + 1.2);
      project(mid, this.tagNodes.range);
      this.tagNodes.range.style.transform += ' translate(0, 50%)';
    }
  }

  // --- the panel ----------------------------------------------------------------------

  renderBoard() {
    const p = this.player;
    const body = this.body;
    body.textContent = '';
    const list = el('div', 'rm-fights');
    body.append(el('div', 'rm-eyebrow', `Fights near ${fmtClock(this.resumeAt ?? p.time)}`), list);
    const name = n => shown(n);
    for (const fight of this.fights) {
      const a = labelOf(p.rec, fight.a, fight.moment, prettyTank);
      const b = labelOf(p.rec, fight.b, fight.moment, prettyTank);
      const row = el('button', `rm-fight${fight === this.fight ? ' on' : ''}`);
      row.type = 'button';
      row.innerHTML = `<span>${esc(name(a.who))} <i>${esc(a.what)}</i> vs ${esc(name(b.who))} <i>${esc(b.what)}</i></span>`
        + `<span>${fight.kill ? 'KILL' : ''}</span>`
        + `<small>hits ${fight.hits.a} : ${fight.hits.b} · ${fmtClock(fight.first)} to ${fmtClock(fight.last)}</small>`;
      row.addEventListener('click', () => this.pick(fight));
      list.append(row);
    }
    const view = this.view;
    if (!view || view.fight !== this.fight) {
      body.append(el('div', 'rm-wait', 'Working out the rounds between them...'));
      this.apartBtn.disabled = true;
      return;
    }
    this.apartBtn.disabled = view.sides.every(s => s.life.soldier);
    const [A, B] = view.sides;
    body.append(el('div', 'rm-eyebrow', 'The two'));
    const vs = el('div', 'rm-vs');
    vs.append(this.sideCard(A), el('b', '', 'VS'), this.sideCard(B));
    body.append(vs);

    body.append(el('div', 'rm-eyebrow', 'What happened'));
    const words = el('ul', 'rm-words');
    const tables = view.tables;
    for (const [side, other] of [[A, B], [B, A]]) {
      const armour = this.armourOf(side, other);
      for (const line of sideWords({ who: name(side.who), gun: side.gun?.label ?? null, tally: side.tally, armour, seen: side.seen },
        { who: name(other.who), what: other.what })) {
        words.append(el('li', '', line));
      }
      if (other.life.soldier && side.gun && tables) {
        const price = priceOf(side.gun, tables, side.seen?.range ?? 0);
        const parts = BODY_PARTS.map(part => `${part.label} ${fmt(Math.round(price(part.material) * 10) / 10)}`);
        words.append(el('li', '', `A hit from their ${side.gun.label} costs a soldier ${parts.join(', ')} of 30.`));
      }
    }
    const ground = this.groundWords();
    if (ground) words.append(el('li', '', ground));
    words.append(el('li', 'is-end', endingWords(view.fight, { who: name(A.who) }, { who: name(B.who) }, prettyTank)));
    body.append(words);

    body.append(el('div', 'rm-eyebrow', 'The ground between them'));
    body.append(this.sliceSvg());
    const key = el('div', 'rm-key');
    key.innerHTML = [['hit', 'did damage'], ['glanced', 'struck, no damage'], ['near', 'missed'], ['odd', 'hit, place uncertain']]
      .map(([k, label]) => `<span><i style="background:${hex(ROUND_COLOURS[k])}"></i>${label}</span>`).join('');
    body.append(key);
  }

  sideCard(side) {
    const p = this.player;
    const card = el('div', `rm-side ${teamClass(side.team)}`);
    const name = shown(side.who);
    card.append(el('div', 'rm-who', name), el('div', 'rm-what', side.what));
    const { hp, max } = side.health;
    const endHp = side.end.hp;
    if (Number.isFinite(hp) && max) {
      const bar = el('div', 'rm-hp');
      bar.innerHTML = `<i style="width:${Math.max(0, Math.min(100, (hp / max) * 100))}%"></i>`
        + `<em style="width:${Math.max(0, Math.min(100, ((Number.isFinite(endHp) ? endHp : hp) / max) * 100))}%"></em>`;
      card.append(bar);
    }
    const stat = (k, v) => {
      const row = el('div', 'rm-stat');
      row.append(el('span', '', k), el('b', '', v));
      card.append(row);
    };
    stat('HP', Number.isFinite(hp) ? `${fmt(hp)}${Number.isFinite(endHp) && endHp !== hp ? ` to ${fmt(endHp)}` : ''} of ${fmt(max)}` : '?');
    stat('Gun', side.gun?.label ?? (side.life.soldier ? 'hand weapon' : 'none seen'));
    stat('Fired', String(side.tally.fired));
    stat('Did damage', String(side.tally.hit));
    stat('Struck, none', String(side.tally.glanced));
    stat('Missed', String(side.tally.missed));
    return card;
  }

  /** What `side`'s gun does to `other`'s armour materials, for the words. */
  armourOf(side, other) {
    const tables = this.view.tables;
    if (other.life.soldier || !side.gun || !tables) return null;
    const hull = this.player.hulls.get(other.life);
    if (!hull?.root) return null;
    const materials = [];
    hull.root.traverse(o => {
      if (!o.isMesh || !o.geometry?.userData?.collision) return;
      for (let a = o; a; a = a.parent) if (CATCHER.test(a.name ?? '')) return;
      materials.push(Number(o.geometry.userData.defenseMaterial));
    });
    if (!materials.length) return null;
    const price = priceOf(side.gun, tables, side.seen?.range ?? 0);
    return armourAgainst(materials, price, m => tables.materials?.[m]?.label ?? '');
  }

  /** The ground's profile along the line between them, sampled. */
  profile() {
    const { fight } = this.view;
    const pa = this.placeOf(fight.a, fight.moment);
    const pb = this.placeOf(fight.b, fight.moment);
    const ground = this.player.ctx.groundHeight;
    if (!pa || !pb || !ground) return null;
    const n = 72;
    const points = [];
    for (let i = 0; i <= n; i++) {
      const k = i / n;
      const x = pa.x + (pb.x - pa.x) * k;
      const z = pa.z + (pb.z - pa.z) * k;
      const y = ground(x, z, Math.max(pa.y, pb.y) + 200);
      points.push({ s: k, y: Number.isFinite(y) ? y : null });
    }
    return { pa, pb, points, range: pa.distanceTo(pb) };
  }

  /** Whether the ground cuts the line between their guns, in words. */
  groundWords() {
    const prof = this.profile();
    if (!prof || prof.range < 15) return null;
    const { fight, sides } = this.view;
    if (fight.a.soldier !== fight.b.soldier) return null;
    const ya = prof.pa.y + (fight.a.soldier ? 1.6 : 2);
    const yb = prof.pb.y + (fight.b.soldier ? 1.6 : 2);
    let worst = null;
    for (const pt of prof.points) {
      // Not the ground under either of them.
      if (pt.y === null || pt.s * prof.range < 8 || (1 - pt.s) * prof.range < 8) continue;
      const line = ya + (yb - ya) * pt.s;
      const clear = line - pt.y;
      if (!worst || clear < worst.clear) worst = { clear, s: pt.s };
    }
    if (!worst) return null;
    const name = s => shown(s.who);
    const at = Math.round(worst.s * prof.range);
    if (worst.clear < 0) return `The ground rises across the line between them ${at} m from ${name(sides[0])}: they were firing over a crest.`;
    return `Open ground between them: the line between them clears it by ${fmt(Math.round(worst.clear * 10) / 10)} m at its closest, ${at} m from ${name(sides[0])}.`;
  }

  /** The cut through the ground along the line between them: the two at
   *  their heights and every round's path laid on it. */
  sliceSvg() {
    const W = 360, H = 130, M = 10;
    const svgNs = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNs, 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('class', 'rm-slice');
    svg.setAttribute('role', 'img');
    const prof = this.profile();
    if (!prof) {
      svg.setAttribute('aria-label', 'No ground to draw');
      return svg;
    }
    const { rounds, sides } = this.view;
    const { pa, pb, range } = prof;
    const dir = pb.clone().sub(pa).setY(0);
    const flat = Math.max(1e-3, dir.length());
    dir.divideScalar(flat);
    // Every point of a round on the cut: its distance along, its height.
    const paths = [];
    const v = new THREE.Vector3();
    for (const r of rounds) {
      const flight = flightOf(r.f, r.spec, r.shooter && !r.shooter.soldier ? motionAt(r.shooter, r.f.t)?.velocity ?? null : null);
      const span = Math.max(0.05, r.arrival - r.f.t);
      const pts = [];
      for (let i = 0; i <= 16; i++) {
        flight.at((span * i) / 16, v);
        if (i === 16 && r.strike?.point) v.copy(r.strike.point);
        pts.push({ s: v.clone().sub(pa).dot(dir) / flat, y: v.y });
      }
      paths.push({ pts, colour: hex(roundColour(r)) });
    }
    const ys = [pa.y, pb.y, ...prof.points.map(pt => pt.y).filter(Number.isFinite), ...paths.flatMap(path => path.pts.map(pt => pt.y))];
    let lo = Math.min(...ys) - 2;
    let hi = Math.max(...ys) + 3;
    // The cut is drawn to scale up to 6x tall: a flat 400 m fight still
    // shows its humps.
    const span = Math.max(hi - lo, (range / 6) * ((H - 2 * M) / (W - 2 * M)));
    hi = lo + span;
    const sx = s => M + Math.max(-0.1, Math.min(1.1, s)) * (W - 2 * M);
    const sy = y => H - M - ((y - lo) / (hi - lo)) * (H - 2 * M);
    const ground = prof.points.filter(pt => pt.y !== null);
    const parts = [];
    if (ground.length) {
      const d = ground.map((pt, i) => `${i ? 'L' : 'M'}${sx(pt.s).toFixed(1)},${sy(pt.y).toFixed(1)}`).join(' ');
      parts.push(`<path d="${d} L${sx(ground[ground.length - 1].s).toFixed(1)},${H} L${sx(ground[0].s).toFixed(1)},${H} Z" fill="rgba(163,156,108,.22)" stroke="#a39c6c" stroke-width="1"/>`);
    }
    for (const path of paths) {
      const d = path.pts.map((pt, i) => `${i ? 'L' : 'M'}${sx(pt.s).toFixed(1)},${sy(pt.y).toFixed(1)}`).join(' ');
      parts.push(`<path d="${d}" fill="none" stroke="${path.colour}" stroke-width="1.1" opacity=".85"/>`);
    }
    const colourOf = side => (side.team === 1 ? '#ff5959' : side.team === 2 ? '#6699ff' : '#eeecd9');
    const mark = (s, y, side, anchor) => {
      const x = sx(s);
      return `<rect x="${(x - 4).toFixed(1)}" y="${(sy(y) - 8).toFixed(1)}" width="8" height="8" fill="${colourOf(side)}"/>`
        + `<text x="${x.toFixed(1)}" y="${(sy(y) - 12).toFixed(1)}" fill="#eeecd9" font-size="9" font-family="Trebuchet MS, sans-serif" text-anchor="${anchor}">${esc(side.what)}</text>`;
    };
    parts.push(mark(0, pa.y, sides[0], 'start'), mark(1, pb.y, sides[1], 'end'));
    parts.push(`<text x="${W / 2}" y="${H - 3}" fill="#a9a690" font-size="9" font-family="ui-monospace, monospace" text-anchor="middle">${Math.round(range)} m${Math.abs(pb.y - pa.y) > 1 ? `, ${Math.round(pb.y - pa.y) > 0 ? '+' : ''}${Math.round(pb.y - pa.y)} m` : ''}</text>`);
    svg.innerHTML = parts.join('');
    svg.setAttribute('aria-label', `The ground between them over ${Math.round(range)} m, with each round's path`);
    return svg;
  }

  takeApart() {
    if (!this.view) return;
    this.stage.show(this.view);
  }

  dispose() {
    this.close();
    this.stage.dispose();
    this.root.remove();
  }
}

/**
 * The two taken apart side by side on a stage of their own: each hull's
 * collision faces painted by the band of hits the other's gun needs there
 * (the tank school's bands), its paint faded to a ghost, its parts flown out
 * from the middle, and every round that met it pinned where it struck. Each
 * is turned so the camera looks at it from where the other was.
 */
class MatchupStage {
  constructor(matchup) {
    this.matchup = matchup;
    this.on = false;
    this.el = el('div', 'rm-stage');
    this.canvas = el('canvas');
    this.pinsEl = el('div', 'rm-pins');
    const head = el('div', 'rm-stage-head');
    this.title = el('div', 'rm-stage-title');
    const ui = matchup.player.ui;
    this.apartBtn = ui.button('', null, 'Put them back together', () => this.setApart(!this.apart), 'Put back together');
    const reset = ui.button('', null, 'Back to where each saw the other from', () => this.resetView(), 'As they saw it');
    const close = ui.button('', 'close', 'Back to the frozen round (Esc)', () => this.hide());
    head.append(this.title, this.apartBtn, reset, close);
    this.legend = el('div', 'rm-legend');
    this.cols = el('div', 'rm-cols');
    this.captions = el('div', 'rm-pins');
    this.el.append(this.canvas, this.captions, this.pinsEl, head, this.legend, this.cols);
    this.renderer = null;
    this.items = [];
    this.pins = [];
    this.apart = true;
    this.clock = 0;
  }

  ensureRenderer() {
    if (this.renderer) return;
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.05, 2000);
    this.scene.add(new THREE.HemisphereLight(0xf2efdc, 0x2a2a22, 1.5));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(6, 12, 9);
    this.scene.add(sun);
    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.sizes = new ResizeObserver(() => this.resize());
    this.sizes.observe(this.el);
  }

  resize() {
    if (!this.renderer) return;
    const w = this.el.clientWidth;
    const h = this.el.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.on) this.layout();
  }

  /** Put the fight's two on the stage. */
  show(view) {
    this.ensureRenderer();
    this.clear();
    this.view = view;
    const player = this.matchup.player;
    const name = s => shown(s);
    const [A, B] = view.sides;
    this.title.innerHTML = `TAKEN APART<b>${esc(name(A.who))} vs ${esc(name(B.who))}</b>`;
    const placed = [];
    for (const [i, side] of view.sides.entries()) {
      const other = view.sides[1 - i];
      placed.push(this.place(side, other, i));
    }
    this.placed = placed;
    this.items = placed.filter(Boolean);
    this.legend.innerHTML = '<div class="rm-key is-faces">'
      + [...BANDS, IMMUNE].map(b => `<span><i style="background:${b.color}"></i>${esc(b.id === 'immune' ? 'no damage' : `${b.label} to destroy`)}</span>`).join('')
      + '</div><div class="rm-key" style="margin-top:6px">'
      + [['hit', 'did damage'], ['glanced', 'struck, no damage'], ['odd', 'place uncertain']]
        .map(([k, label]) => `<span><i style="background:${hex(ROUND_COLOURS[k])};height:8px;width:8px;border-radius:50%"></i>${label}</span>`).join('')
      + '</div>';
    this.renderCols();
    this.on = true;
    this.el.classList.add('on');
    this.setApart(true);
    this.resize();
  }

  /** Where the two stand: side by side, or one above the other on a screen
   *  taller than it is wide; and the band of the screen they are framed in,
   *  between the head and the rows under them. */
  layout() {
    const placed = this.placed ?? [];
    if (!placed.length) return;
    const w = this.el.clientWidth;
    const h = this.el.clientHeight;
    if (!w || !h) return;
    const portrait = w / h < 0.9;
    const sizes = placed.map(item => item?.size ?? 0);
    const heights = placed.map(item => (item ? item.height * 1.5 : 0));
    // Taken apart, a hull's parts reach about half its size again.
    const reach = sizes.map(v => v * 1.45);
    if (portrait) {
      const gap = Math.max(...heights, 2) * 0.2;
      if (placed[1]) placed[1].holder.position.set(0, 0, 0);
      if (placed[0]) placed[0].holder.position.set(0, (placed[1] ? heights[1] + gap : 0), 0);
      this.spanW = Math.max(...reach, 4);
      this.spanH = heights[0] + heights[1] + (placed[0] && placed[1] ? gap : 0);
      this.centreY = this.spanH / 2;
    } else {
      const gap = Math.max(...sizes, 2) * 0.35;
      const total = reach[0] + reach[1] + gap;
      let x = -total / 2;
      for (const [i, item] of placed.entries()) {
        if (item) item.holder.position.set(x + reach[i] / 2, 0, 0);
        x += reach[i] + gap;
      }
      this.spanW = Math.max(total, 4);
      this.spanH = Math.max(...heights, 2);
      this.centreY = this.spanH * 0.4;
    }
    for (const item of placed) item?.holder.updateMatrixWorld(true);
    // The band between the head (and on a phone the legend under it) and
    // the rows: the view is offset so the two sit in its middle.
    const box = this.el.getBoundingClientRect();
    const legend = this.legend.getBoundingClientRect();
    const top = Math.max(56, legend.width > w * 0.6 ? legend.bottom - box.top + 6 : 56);
    const cols = this.cols.getBoundingClientRect();
    const bottom = cols.height ? cols.top - box.top - 18 : h - 12;
    this.band = Math.max(0.25, (bottom - top) / h);
    this.camera.setViewOffset(w, h, 0, h / 2 - (top + bottom) / 2, w, h);
    this.camera.updateProjectionMatrix();
    this.resetView();
  }

  /** One side on the stage: a copy of its hull at the frozen moment, painted
   *  by `other`'s gun, its rounds' strikes pinned. Null for a soldier. */
  place(side, other, index) {
    const player = this.matchup.player;
    if (side.life.soldier) return null;
    const hull = player.hulls.get(side.life);
    if (!hull?.root) return null;
    const live = meshesOf(hull.root);
    const clone = skeletonClone(hull.root);
    clone.position.set(0, 0, 0);
    clone.quaternion.identity();
    const copies = meshesOf(clone);
    const twin = new Map(live.map((mesh, i) => [mesh, copies[i]]));
    const tables = this.view.tables;
    const price = other.gun && tables ? priceOf(other.gun, tables, other.seen?.range ?? 0) : null;
    const hp = side.life.maxhp || side.health.max || 100;
    const materials = [];
    clone.traverse(o => {
      const d = o.userData ?? {};
      if (d.effect || d.tracerMesh || d.projectileMesh || d.projectileTrail) { o.visible = false; return; }
      if (o.isPoints || o.isLine || o.isSprite) { o.visible = false; return; }
      if (!o.isMesh) return;
      let caught = false;
      for (let a = o; a; a = a.parent) if (CATCHER.test(a.name ?? '')) caught = true;
      if (o.geometry?.userData?.collision) {
        if (caught) { o.visible = false; return; }
        const material = Number(o.geometry.userData.defenseMaterial);
        const damage = price ? price(material) : null;
        const band = damage === null ? { color: '#7d7d6a' } : bandOf(shotsFor(hp, damage));
        o.material = new THREE.MeshLambertMaterial({
          color: band.color, emissive: band.color, emissiveIntensity: 0.3, flatShading: true, side: THREE.DoubleSide,
          transparent: true, opacity: 0.9, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
        });
        o.userData.rmFace = { material, damage, band };
        o.visible = true;
        // The replay's loader hides each collision node (replay-assets.js),
        // and a hidden parent hides its faces.
        for (let a = o.parent; a && a !== clone; a = a.parent) {
          if (a.userData?.collision || /collision/i.test(a.name ?? '')) a.visible = true;
        }
        o.renderOrder = 1;
        materials.push(o.material);
      } else if (o.visible !== false) {
        const source = [o.material].flat()[0];
        const ghost = new THREE.MeshBasicMaterial({ color: 0xd8d4bc, map: source?.map ?? null, transparent: true, opacity: 0.16, depthWrite: false });
        o.material = ghost;
        o.renderOrder = 2;
        materials.push(ghost);
      }
    });
    // The parts, flown out from the middle (the part inspector's way).
    clone.updateMatrixWorld(true);
    const box = new THREE.Box3();
    clone.traverse(o => {
      if (o.isMesh && o.visible && o.geometry) {
        o.geometry.computeBoundingBox?.();
        if (o.geometry.boundingBox) box.union(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld));
      }
    });
    const size = box.isEmpty() ? 4 : box.getSize(new THREE.Vector3()).length();
    const centre = box.isEmpty() ? new THREE.Vector3() : box.getCenter(new THREE.Vector3());
    const partIndex = buildPartIndex(clone);
    const parts = [];
    let deepest = 1;
    for (const part of partIndex.parts) {
      if (part.depth < 1 || !hasGeometry(part)) continue;
      const node = part.node;
      const own = new THREE.Box3().setFromObject(node);
      if (own.isEmpty()) continue;
      const c = own.getCenter(new THREE.Vector3());
      const v = popVector(centre.toArray(), c.toArray(), size, SPREAD[Math.min(1, part.depth - 1)]);
      // Into the parent's frame: the offset is a direction and a length.
      const parent = node.parent;
      const world0 = node.getWorldPosition(new THREE.Vector3());
      const there = parent.worldToLocal(world0.clone().add(new THREE.Vector3(...v)));
      const here = parent.worldToLocal(world0.clone());
      parts.push({ node, home: node.position.clone(), pop: there.sub(here), depth: part.depth });
      deepest = Math.max(deepest, part.depth);
    }
    // The strikes, each on its own mesh's copy where it landed.
    const pinGeo = new THREE.SphereGeometry(Math.max(0.05, Math.min(0.2, size * 0.012)), 14, 10);
    const geometries = [pinGeo];
    for (const r of other.rounds) {
      if (!r.strike || r.at !== side.life) continue;
      const mesh = twin.get(r.strike.mesh);
      if (!mesh) continue;
      const colour = roundColour(r);
      const material = new THREE.MeshBasicMaterial({ color: colour, depthTest: false, transparent: true });
      materials.push(material);
      const pin = new THREE.Mesh(pinGeo, material);
      pin.position.copy(r.strike.local);
      pin.renderOrder = 10;
      mesh.add(pin);
      const length = Math.max(0.4, size * 0.09);
      const rodGeo = new THREE.BufferGeometry().setFromPoints([r.strike.local.clone().addScaledVector(r.strike.dirLocal, -length), r.strike.local.clone()]);
      geometries.push(rodGeo);
      const rodMat = new THREE.LineBasicMaterial({ color: colour, depthTest: false, transparent: true, opacity: 0.9 });
      materials.push(rodMat);
      const rod = new THREE.Line(rodGeo, rodMat);
      rod.renderOrder = 10;
      mesh.add(rod);
      this.pins.push({ r, pin, side: index, node: this.pinLabel(r) });
    }
    // Turned so the camera sees it from where the other was.
    const holder = new THREE.Group();
    const spin = new THREE.Group();
    spin.add(clone);
    holder.add(spin);
    const seen = seenFrom(other.life, side.life, this.view.fight.moment, poseAt);
    if (seen) spin.rotation.y = -Math.atan2(seen.local[0], seen.local[2]);
    clone.position.sub(new THREE.Vector3(centre.x, box.isEmpty() ? 0 : box.min.y, centre.z));
    this.scene.add(holder);
    const caption = el('div', 'rm-caption', `${side.what}, as ${shown(other.who)} saw it`);
    this.captions.append(caption);
    return {
      side, holder, clone, parts, deepest, size: Math.max(2, Math.hypot(box.max.x - box.min.x, box.max.z - box.min.z) || size * 0.8),
      height: box.isEmpty() ? 2 : box.max.y - box.min.y, materials, geometries, caption,
    };
  }

  pinLabel(r) {
    const node = el('div', `rm-pin${r.kind !== 'hit' ? ' is-glanced' : r.strike && ['unexplained', 'approximate'].includes(r.strike.status) ? ' is-odd' : ''}`);
    node.textContent = r.kind === 'hit' ? `-${fmt(r.drop?.amount ?? r.strike?.damage)}` : '0';
    this.pinsEl.append(node);
    return node;
  }

  /** The two columns under the stage: each side's strikes, one row each. */
  renderCols() {
    const player = this.matchup.player;
    const name = s => shown(s);
    const tables = this.view.tables;
    this.cols.textContent = '';
    for (const [i, side] of this.view.sides.entries()) {
      const other = this.view.sides[1 - i];
      const col = el('div', 'rm-col');
      const h = el('h3', '', name(side.who));
      h.append(el('small', '', `${side.what}${other.gun ? `, painted by their ${other.gun.label}` : ''}`));
      col.append(h);
      const against = other.rounds.filter(r => r.at === side.life && (r.kind === 'hit' || r.struck || r.part));
      if (side.life.soldier) {
        col.append(el('p', '', 'On foot: a soldier has no plates. Each hit below is matched to the body part whose price is the recorded drop.'));
      } else if (!against.length) {
        col.append(el('p', '', 'Nothing of theirs struck it that the recording saw.'));
      }
      const rows = el('div', 'rm-rows');
      for (const r of against) {
        const row = el('button', 'rm-row');
        row.type = 'button';
        const plate = r.strike ? faceName(r.strike.material, tables) : r.part ? r.part.part.label : '';
        const amount = r.kind === 'hit' ? `-${fmt(r.drop?.amount ?? r.strike?.damage)}` : '0';
        row.innerHTML = `<i style="background:${hex(roundColour(r))}"></i><time>${esc(fmtClock(r.arrival))}</time>`
          + `<span>${esc(plate)}${r.strike ? ` <span style="color:var(--rp-muted)">${Math.round(Math.acos(Math.min(1, r.strike.cos)) * 180 / Math.PI)} deg off square</span>` : ''}</span><b>${esc(amount)}</b>`
          + `<small>${esc(statusWords(r))}${r.strike && r.kind === 'hit' ? `; the plate's price ${fmt(r.strike.damage)}` : ''}</small>`;
        row.addEventListener('click', () => this.pulse(r));
        rows.append(row);
      }
      col.append(rows);
      this.cols.append(col);
    }
  }

  pulse(r) {
    for (const pin of this.pins) if (pin.r === r) pin.pulse = PULSE;
  }

  setApart(on) {
    this.apart = on;
    this.flyT = 0;
    this.apartBtn.textContent = on ? 'Put back together' : 'Take apart';
  }

  /** Where each sees the other from: straight on, a little above, the two
   *  filling the band between the head and the rows. */
  resetView() {
    if (!this.camera || !this.spanW) return;
    const tan = Math.tan((this.camera.fov * Math.PI) / 360);
    const aspect = this.camera.aspect || 1.6;
    const fitW = (this.spanW * 1.08) / (2 * tan * aspect);
    const fitH = (this.spanH * 1.15) / (2 * tan * (this.band ?? 1));
    const dist = Math.max(fitW, fitH, 5);
    this.camera.position.set(0, this.centreY + dist * 0.2, dist);
    this.controls.target.set(0, this.centreY, 0);
    this.controls.update();
  }

  /** A frame of the stage. */
  frame(dt) {
    if (!this.on || !this.renderer) return;
    this.flyT += dt;
    for (const item of this.items) {
      for (const part of item.parts) {
        const k = Math.max(0, Math.min(1, (this.flyT - (part.depth - 1) * STAGGER) / FLY));
        const ease = 1 - (1 - k) ** 3;
        const out = this.apart ? ease : 1 - ease;
        part.node.position.copy(part.home).addScaledVector(part.pop, out);
      }
      item.holder.updateMatrixWorld(true);
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    const w = this.el.clientWidth;
    const h = this.el.clientHeight;
    const v = new THREE.Vector3();
    for (const pin of this.pins) {
      pin.pin.getWorldPosition(v);
      const s = v.project(this.camera);
      const shown = s.z > -1 && s.z < 1;
      pin.node.style.display = shown ? '' : 'none';
      if (shown) pin.node.style.transform = `translate(${((s.x + 1) / 2) * w}px, ${((1 - s.y) / 2) * h}px) translate(-50%, -130%)`;
      if (pin.pulse > 0) {
        pin.pulse = Math.max(0, pin.pulse - dt);
        pin.pin.scale.setScalar(1 + 1.6 * Math.abs(Math.sin(pin.pulse * 7)));
      } else if (pin.pin.scale.x !== 1) pin.pin.scale.setScalar(1);
    }
    for (const item of this.items) {
      item.holder.getWorldPosition(v);
      v.y -= 0.2;
      const s = v.project(this.camera);
      item.caption.style.left = `${((s.x + 1) / 2) * w}px`;
      item.caption.style.top = `${((1 - s.y) / 2) * h + 8}px`;
    }
  }

  clear() {
    for (const item of this.items) {
      item.holder.parent?.remove(item.holder);
      for (const m of item.materials) m.dispose?.();
      for (const g of item.geometries) g.dispose?.();
    }
    this.items = [];
    this.pins = [];
    this.pinsEl.textContent = '';
    this.captions.textContent = '';
  }

  hide(release = false) {
    this.on = false;
    this.el.classList.remove('on');
    this.clear();
    if (release) this.dispose();
  }

  dispose() {
    this.clear();
    this.sizes?.disconnect();
    this.controls?.dispose();
    this.renderer?.dispose();
    this.renderer = null;
    this.sizes = null;
    this.controls = null;
  }
}
