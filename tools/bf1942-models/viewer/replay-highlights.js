// The replay's highlights (features/round-replay-highlights): what makes a
// recorded round worth watching, found and put in front of the viewer the
// way modern replay and spectator modes do it --
//
//   the battle map (M)     the level's map with everyone on it, the fights
//                          burning as heat, the shots as tracers, the kills
//                          as they fall; click a man, a fight or the ground
//                          to go there (replay-battlemap.js);
//   battle markers (B)     the fights you are not watching, marked over the
//                          view and at its edge (replay-markers.js);
//   callouts               the followed player's medals as they happen, and
//                          everyone else's in a ticker you can follow or
//                          replay from (replay-callouts.js);
//   the Auto camera (4)    a director that picks whom to follow, a few
//                          seconds ahead of the action (replay-director.js);
//   the highlight reel     the round's top plays, played back to back;
//   the heat strip         the round's intensity along the timeline
//                          (replay-heat.js).
//
// The findings are pure (replay-battles.js, replay-medals.js); this file
// builds them once for the round, wires the pieces to the replay's player
// and its chrome (replay.js, replay-ui.js), and owns the look they share.

import {
  activityOf, battlesAt, battlesOf, hullKillsOf, intensityOf, placeName, pointsOf, standoutAt, standoutsOf,
  vehiclesAt, whereIs,
} from './replay-battles.js';
import { bestStreakAt, describeMedal, leaderAt, leadersOf, medalsOf, streakAt, streaksOf, topPlays } from './replay-medals.js';
import { nameAt, teamAt } from './replay-recording.js';
import { ReplayDirector } from './replay-director.js';
import { ReplayBattleMap } from './replay-battlemap.js';
import { ReplayCallouts } from './replay-callouts.js';
import { ReplayBattleMarkers } from './replay-markers.js';
import { ReplayHeat } from './replay-heat.js';

/** How the Auto camera frames a fight: the orbit's zoom for a fight of
 *  radius r (metres) about a man on foot, and how fast it turns to face the
 *  action (seconds). A drag of the view keeps the director's hands off the
 *  orbit for USER_HOLD seconds. */
const AUTO_ZOOM = r => Math.min(2.6, Math.max(1.1, 0.9 + r / 30));
const AUTO_TURN = 1.6;
const AUTO_ZOOM_EASE = 1.2;
const USER_HOLD = 6;
/** A reel's play is left this long after its last moment, seconds. */
const REEL_TAIL = 0.5;
/** A play's shot: the orbit's zoom and pitch behind the man. */
const SHOT_ZOOM = 1.3;
const SHOT_PITCH = 0.38;

const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** The replay's reading of a hull, as the map draws it: air, sea, tank, car,
 *  gun, or null for what it cannot tell. */
function hullKind(hull) {
  switch (hull?.kind) {
    case 'air': return 'air';
    case 'ship': return 'sea';
    case 'tank': return 'tank';
    case 'ground': return 'car';
    case 'gun': return 'gun';
    default: return null;
  }
}

/**
 * The round, read once: `{ rec, kills, activity, battles, intensity, medals,
 * plays, streaks, leaders, points, hullKills, standouts (after the hulls
 * load), where(pid, t), placeOf(pos), display(key), kindOf(life) }`.
 */
export function buildModel(rec, { kills, chapters, serverRows = [], display = s => s, kindOf = () => null }) {
  const activity = activityOf(rec, kills, serverRows);
  const battles = battlesOf(activity, rec.duration);
  const points = pointsOf(rec);
  const medals = medalsOf(rec, kills, { chapters });
  const model = {
    rec, kills, activity, battles, points, medals,
    intensity: intensityOf(activity, rec.duration, Math.max(1, rec.duration / 600)),
    plays: topPlays(medals, { battles, activity }),
    streaks: streaksOf(kills),
    leaders: leadersOf(kills),
    hullKills: hullKillsOf(rec, kills),
    standouts: null,
    display,
    kindOf,
    placeOf: pos => placeName(pos, points, display),
  };
  // A play the recording could not see (its man beyond the recording
  // player's view distance) has only a frozen ghost to show: the reel
  // passes it by.
  for (const play of model.plays) play.fresh = whereIs(rec, play.pid, play.t - 0.1, kills).fresh;
  // Where everyone is, asked by the director, the map and the markers in the
  // same frame: once per player per frame.
  let cacheT = null;
  const cache = new Map();
  model.where = (pid, t) => {
    if (t !== cacheT) {
      cacheT = t;
      cache.clear();
    }
    let w = cache.get(pid);
    if (!w) {
      w = whereIs(rec, pid, t, kills);
      cache.set(pid, w);
    }
    return w;
  };
  return model;
}

export class ReplayHighlights {
  constructor(player) {
    this.player = player;
    this.ui = player.ui;
    this.ctx = player.ctx;
    const { rec } = player;
    injectStyle();
    const names = () => this.ctx.comms?.lexicon?.()?.names ?? null;
    const display = key => (key ? names()?.[key] ?? String(key).replace(/_/g, ' ') : '');
    this.model = buildModel(rec, {
      kills: player.kills,
      chapters: player.chapters,
      serverRows: player.serverRows,
      display,
      kindOf: life => hullKind(player.hulls.get(life)),
    });
    this.director = new ReplayDirector(this.model, { fallback: player.recordingPid });
    this.auto = false;
    this.lastDirected = null;
    this.userOrbitUntil = 0;
    this.reel = null;
    this.showMarkers = true;
    this.prevT = player.time;

    this.heat = new ReplayHeat(this);
    this.markers = new ReplayBattleMarkers(this);
    this.callouts = new ReplayCallouts(this);
    this.map = new ReplayBattleMap(this);
    this.buildChrome();
    this.onDragEnd = () => {
      if (this.auto) this.userOrbitUntil = performance.now() + USER_HOLD * 1000;
    };
    this.ui.input.addEventListener('pointerup', this.onDragEnd);
  }

  /** The Auto caption and the reel's plate, over the player card. */
  buildChrome() {
    this.autoTag = el('div', 'rp-hl-auto');
    this.autoTag.hidden = true;
    this.reelPlate = el('div', 'rp-hl-reel');
    this.reelPlate.hidden = true;
    this.reelText = el('span', 'rp-hl-reel-text');
    const skip = el('button', 'rp-btn', 'Next');
    skip.type = 'button';
    skip.title = 'Next play (.)';
    skip.addEventListener('click', e => { e.stopPropagation(); this.reelStep(1); });
    const stop = el('button', 'rp-btn', 'Stop');
    stop.type = 'button';
    stop.title = 'Stop the reel';
    stop.addEventListener('click', e => { e.stopPropagation(); this.stopReel(); });
    this.reelPlate.append(this.reelText, skip, stop);
    this.ui.card.after(this.autoTag, this.reelPlate);
  }

  // --- what the rest of the replay reads ------------------------------------------------

  /** `pid`'s kill streak at `t`. */
  streakOf(pid, t) {
    return streakAt(this.model.streaks, pid, t);
  }

  bestStreakOf(pid, t) {
    return bestStreakAt(this.model.streaks, pid, t);
  }

  /** The kill leader at `t`: `{ pid, kills }` or null. */
  leaderAt(t) {
    return leaderAt(this.model.leaders, t);
  }

  battlesAt(t) {
    return battlesAt(this.model.battles, t);
  }

  vehiclesAt(t) {
    return vehiclesAt(this.player.rec, t, this.model.hullKills);
  }

  /** Who stands apart at `t`: `[{ pid, run }]` (replay-battles.js
   *  `standoutsOf`), once the hulls have loaded and say who flies. */
  standoutsAt(t) {
    const standouts = this.model.standouts;
    if (!standouts) return [];
    const out = [];
    for (const pid of standouts.keys()) {
      const run = standoutAt(standouts, pid, t);
      if (run) out.push({ pid, run });
    }
    return out;
  }

  describe(medal) {
    return describeMedal(medal, this.player.rec, this.model.display);
  }

  /** `pid`'s name and side at recording time `t` (the playhead's by
   *  default): an id passes to the next player to join. */
  name(pid, t = this.player.time) {
    return nameAt(this.player.rec, pid, t);
  }

  team(pid, t = this.player.time) {
    return teamAt(this.player.rec, pid, t);
  }

  // --- going somewhere ---------------------------------------------------------------------

  /** Follow `pid` from the chrome: the page's own follow, and the director
   *  hands back. */
  follow(pid) {
    if (pid === null || pid === undefined) return;
    this.stopReel();
    this.setAuto(false, true);
    this.frameOn(pid);
    this.ui.syncMode();
  }

  /** The orbit on `pid`, close in behind him: out of the free camera the
   *  orbit would keep however far off the camera was. */
  frameOn(pid) {
    const camera = this.player.camera;
    if (camera.mode === 'free') {
      camera.setMode('orbit');
      camera.zoom = SHOT_ZOOM;
      camera.pitch = SHOT_PITCH;
    }
    this.ui.follow(pid);
  }

  /** Watch a play again: from `t0`, following `pid`. */
  replay(pid, t0) {
    this.stopReel();
    this.setAuto(false, true);
    this.player.seek(Math.max(0, t0));
    this.frameOn(pid);
    this.shot();
    this.player.playing = true;
    this.ui.syncMode();
  }

  /** A play's shot: the orbit close in behind him. */
  shot() {
    const camera = this.player.camera;
    if (camera.mode !== 'orbit') return;
    camera.zoom = SHOT_ZOOM;
    camera.pitch = SHOT_PITCH;
    camera.resetOrbit?.();
    camera.zoom = SHOT_ZOOM;
  }

  /** Watch a battle: whoever is doing most in it, with the orbit opened out
   *  to take the fight in; the free camera over it when nobody in it can be
   *  watched. */
  watchBattle(track, t = this.player.time) {
    const b = battlesAt([track], t)[0];
    const s = b?.s ?? track.samples[track.samples.length - 1];
    let best = null;
    for (const pid of s.pids) {
      const i = this.director.interest(pid, t);
      if (i.score > -Infinity && (!best || i.score > best.i.score)) best = { pid, i };
    }
    if (best) {
      this.follow(best.pid);
      this.player.camera.zoom = AUTO_ZOOM(s.r);
      this.ui.flash(`${this.model.placeOf(s.pos)}`);
      return;
    }
    this.flyTo(s.pos);
  }

  /** The free camera over a place on the level, looking north at it the way
   *  the map shows it. */
  flyTo(pos) {
    const camera = this.player.camera;
    this.stopReel();
    this.setAuto(false, true);
    camera.setMode('free');
    const ground = this.ctx.groundHeight?.(pos[0], pos[2]);
    const floor = Number.isFinite(ground) ? ground : pos[1];
    const back = 70;
    const up = 55;
    camera.free.pos.set(pos[0], floor + up, pos[2] + back);
    camera.free.yaw = 0;
    camera.free.pitch = -Math.atan2(up, back);
    this.ui.syncMode();
    const place = this.model.placeOf(pos);
    const grid = this.map.gridRef(pos);
    this.ui.flash([grid, place === 'Open ground' ? null : place].filter(Boolean).join(' · ') || place);
  }

  /** The battle markers over the view, off or on (B, or the bar's menu). */
  toggleMarkers() {
    this.showMarkers = !this.showMarkers;
    this.ui.flash(this.showMarkers ? 'Battle markers on' : 'Battle markers off');
  }

  // --- the Auto camera -----------------------------------------------------------------------

  setAuto(on, quiet = false) {
    if (on === this.auto) return;
    this.auto = on;
    this.director.reset();
    this.lastDirected = null;
    this.userOrbitUntil = 0;
    if (on) {
      this.stopReel();
      if (this.player.camera.mode !== 'orbit') this.player.camera.setMode('orbit');
    }
    this.autoTag.hidden = !on;
    if (!quiet) this.ui.flash(on ? 'Auto camera' : 'Auto off');
    this.ui.syncMode();
  }

  /** The director's turn: whom to follow, and the orbit turned to face what
   *  he is about to do. */
  direct(t, dt) {
    const player = this.player;
    const camera = player.camera;
    // Somebody chose a player, or a camera, by hand: the director hands back.
    if (camera.mode !== 'orbit' || (this.lastDirected !== null && player.followPid !== this.lastDirected)) {
      this.setAuto(false);
      return;
    }
    const d = this.director.update(t, player.followPid);
    if (d.pid === null) return;
    if (d.pid !== player.followPid) player.follow(d.pid);
    this.lastDirected = d.pid;
    const reason = d.reason ? `AUTO · ${d.reason}` : 'AUTO';
    if (this.autoTag.textContent !== reason) this.autoTag.textContent = reason;

    // The shot: the fight's size in the zoom, the camera behind him looking
    // at his next victim or the fight's heart. Where he is comes from the
    // recording, not the camera's last target: on a cut that is still the
    // man before.
    const me = this.model.where(d.pid, t);
    if (!me.pos || camera.looking || performance.now() < this.userOrbitUntil) return;
    const hull = me.state === 'vehicle';
    const want = d.battle ? (hull ? Math.min(1.6, AUTO_ZOOM(d.battle.s.r) * 0.7) : AUTO_ZOOM(d.battle.s.r)) : hull ? 1 : 1.2;
    camera.zoom += (want - camera.zoom) * (d.cut ? 1 : 1 - Math.exp(-dt / AUTO_ZOOM_EASE));
    let look = null;
    if (d.next) {
      const w = this.model.where(d.next.victim, t);
      if (w.fresh) look = w.pos;
    }
    if (!look && d.battle) look = d.battle.s.pos;
    if (!look) return;
    const dx = me.pos[0] - look[0];
    const dz = me.pos[2] - look[2];
    if (Math.hypot(dx, dz) < 8) return;
    const yaw = Math.atan2(dx, dz);
    camera.yaw += wrap(yaw - camera.yaw) * (d.cut ? 1 : 1 - Math.exp(-dt / AUTO_TURN));
  }

  // --- the highlight reel ------------------------------------------------------------------

  playReel(index = 0) {
    const plays = this.model.plays;
    if (!plays.some(p => p.fresh)) {
      this.ui.flash('No highlights');
      return;
    }
    this.setAuto(false, true);
    this.reel = { index: -1 };
    this.reelGo(Math.max(0, Math.min(plays.length - 1, index)));
  }

  /** The reel's play `index`, or the next one it can show in the direction
   *  it is going. */
  reelGo(index, dir = 1) {
    const plays = this.model.plays;
    while (plays[index] && !plays[index].fresh) index += dir;
    const play = plays[index];
    if (!play) {
      this.stopReel();
      this.ui.flash('End of the highlights');
      return;
    }
    this.reel.index = index;
    this.player.seek(play.t0);
    this.player.playing = true;
    if (this.player.camera.mode === 'pov') this.player.camera.setMode('orbit');
    this.frameOn(play.pid);
    this.shot();
    this.reel.pid = play.pid;
    this.reel.expect = play.t0;
    const what = play.kind === 'battle' ? `${play.title}: ${this.model.placeOf(play.pos)}` : play.title;
    this.reelText.textContent = `HIGHLIGHT ${index + 1}/${this.model.plays.length} · ${what} · ${this.name(play.pid, play.t)}`;
    this.reelPlate.hidden = false;
  }

  reelStep(dir) {
    if (!this.reel) return;
    if (dir < 0 && !this.model.plays.slice(0, this.reel.index).some(p => p.fresh)) return;
    this.reelGo(this.reel.index + dir, dir);
  }

  stopReel() {
    if (!this.reel) return;
    this.reel = null;
    this.reelPlate.hidden = true;
  }

  /** The reel goes on to its next play, and stops when the viewer takes the
   *  replay elsewhere (a seek, another player). */
  runReel(t) {
    const reel = this.reel;
    if (!reel) return;
    const play = this.model.plays[reel.index];
    if (Math.abs(t - reel.expect) > 1.5 || this.player.followPid !== reel.pid) {
      this.stopReel();
      return;
    }
    reel.expect = t;
    if (t >= play.t1 + REEL_TAIL) this.reelGo(reel.index + 1);
  }

  // --- the keys ----------------------------------------------------------------------------

  /** One key, before the replay's own map (replay-ui.js `key`): true when it
   *  is taken here, undefined when it is not one of these. */
  key(e, once) {
    switch (e.code) {
      case 'KeyM':
        if (once) this.map.toggle();
        return true;
      case 'KeyB':
        if (once) this.toggleMarkers();
        return true;
      case 'Digit4': case 'Numpad4':
        if (once) this.ui.setMode('auto');
        return true;
      case 'Comma': case 'Period':
        // In the reel, the marker keys step through its plays.
        if (!this.reel || e.shiftKey) return undefined;
        if (once) this.reelStep(e.code === 'Period' ? 1 : -1);
        return true;
      case 'Escape':
        if (this.map.open) {
          this.map.close();
          return true;
        }
        if (this.reel) {
          this.stopReel();
          return true;
        }
        return undefined;
      default:
        return undefined;
    }
  }

  // --- per frame ------------------------------------------------------------------------------

  /** Before the camera is placed: the director's pick and the reel, so the
   *  orbit centres on whom they chose in the same frame. */
  lead(t, dt) {
    if (this.auto) this.direct(t, dt);
    this.runReel(t);
  }

  /** After the chrome: the markers, the callouts, the map, the heat strip. */
  update(t, dt) {
    const player = this.player;
    if (!this.model.standouts && player.statusLine) {
      // Once the hulls are in: who flies is known, so pilots are not taken
      // for lone wolves.
      this.model.standouts = standoutsOf(player.rec, this.model.battles, {
        kills: player.kills, loadouts: this.ctx.loadouts?.() ?? null, kindOf: this.model.kindOf,
      });
    }
    const bare = this.ui.root.classList.contains('rp-bare');
    this.callouts.update(t, this.prevT, bare);
    this.markers.update(t, bare || !this.showMarkers || this.map.open);
    this.map.update(t, dt);
    this.heat.update(t);
    this.prevT = t;
  }

  dispose() {
    this.ui.input.removeEventListener('pointerup', this.onDragEnd);
    this.map.dispose();
    this.markers.dispose();
    this.callouts.dispose();
    this.heat.dispose();
    this.autoTag.remove();
    this.reelPlate.remove();
  }
}

// --- the look ------------------------------------------------------------------------------------
//
// The replay chrome's own (replay-ui.js): its plates, khaki strips and team
// colours, and the game's minimap tints for the map's marks (map-surfaces.js
// `MINIMAP_TEAM_TINT`).

const STYLE = `
.rp-root { --rp-hl-axis: rgb(247, 52, 49); --rp-hl-allies: rgb(75, 126, 252); --rp-hl-heat: #f0913c; }

/* The Auto caption and the reel's plate, over the player card. */
.rp-hl-auto, .rp-hl-reel { position: absolute; left: 50%; transform: translateX(-50%); pointer-events: none;
  bottom: calc(var(--rp-bar-h) + var(--rp-card-h) + 24px); max-width: calc(100% - 24px); white-space: nowrap; overflow: hidden;
  text-overflow: ellipsis; transition: opacity .35s ease; }
.rp-hl-auto { padding: 2px 9px; border-radius: 3px; background: rgba(12, 12, 10, .6); border: 1px solid var(--rp-edge);
  color: var(--rp-khaki); font: 800 10px/1.5 var(--rp-font); letter-spacing: .14em; }
.rp-hl-auto[hidden], .rp-hl-reel[hidden] { display: none; }
.rp-hl-reel { display: flex; align-items: center; gap: 4px; padding: 2px 3px 2px 10px; pointer-events: auto;
  background: var(--rp-plate-deep); border: 1px solid var(--rp-gold); border-radius: 6px;
  box-shadow: 0 0 0 1px rgba(232, 195, 90, .25), 0 6px 20px rgba(0, 0, 0, .45); }
.rp-hl-reel-text { color: var(--rp-gold); font: 800 10px/1.5 var(--rp-font); letter-spacing: .12em; overflow: hidden; text-overflow: ellipsis; }
.rp-hl-reel .rp-btn { height: 22px; }
.rp-root.rp-idle .rp-hl-auto { opacity: .55; }

/* The heat strip behind the timeline's marks. */
.rp-hl-heat { position: absolute; left: 0; top: 0; width: 100%; height: 19px; pointer-events: none; }

/* Battle markers over the view. */
.rp-hl-marks { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
.rp-hl-mark { position: absolute; left: 0; top: 0; display: flex; flex-direction: column; align-items: center; gap: 1px;
  padding: 0; margin: 0; border: 0; background: none; color: var(--rp-ink); cursor: pointer; pointer-events: auto;
  will-change: transform; font: 800 9px/1.2 var(--rp-font); letter-spacing: .12em; text-transform: uppercase;
  text-shadow: 0 1px 2px rgba(0, 0, 0, .9); }
.rp-hl-mark-icon { position: relative; width: 30px; height: 30px; display: grid; place-items: center; }
.rp-hl-mark-icon::before { content: ''; position: absolute; inset: 0; border-radius: 50%;
  background: radial-gradient(circle, var(--mk, #f0913c) 0 34%, transparent 70%); opacity: .55;
  animation: rp-hl-throb 1.3s ease-in-out infinite; }
.rp-hl-mark-icon svg { position: relative; width: 18px; height: 18px; color: #fff4dc; filter: drop-shadow(0 0 3px rgba(0, 0, 0, .8)); }
.rp-hl-mark-label { padding: 1px 5px; border-radius: 3px; background: rgba(10, 10, 9, .6); color: #ffe2b8; }
.rp-hl-mark small { padding: 0 4px; border-radius: 3px; background: rgba(10, 10, 9, .45); font: 600 10px/1.3 var(--rp-mono);
  letter-spacing: 0; text-transform: none; color: var(--rp-ink); }
.rp-hl-mark:hover .rp-hl-mark-icon::before { opacity: .9; }
.rp-hl-mark.edge .rp-hl-mark-label { display: none; }
.rp-hl-mark-icon svg.rp-hl-mark-arrow { position: absolute; left: 50%; top: 50%; width: 40px; height: 40px; margin: -20px 0 0 -20px;
  display: none; color: var(--mk, #f0913c); filter: drop-shadow(0 0 2px rgba(0, 0, 0, .9)); }
.rp-hl-mark.edge svg.rp-hl-mark-arrow { display: block; }
@keyframes rp-hl-throb { 0%, 100% { transform: scale(.82); } 50% { transform: scale(1.12); } }

/* Callouts: the followed player's medals, and the ticker of everyone's. */
.rp-hl-callouts { position: absolute; left: 50%; top: 9%; transform: translateX(-50%); display: flex; flex-direction: column;
  align-items: center; gap: 6px; pointer-events: none; }
.rp-hl-callout { display: flex; align-items: center; gap: 10px; padding: 6px 16px 6px 8px; border-radius: 8px;
  background: linear-gradient(90deg, rgba(14, 14, 12, .88), rgba(30, 30, 26, .72)); border: 1px solid var(--tier, #b9b38a);
  box-shadow: 0 0 22px -4px var(--tier, #b9b38a), 0 10px 28px rgba(0, 0, 0, .5);
  animation: rp-hl-stamp .42s cubic-bezier(.2, 1.5, .4, 1) both; }
.rp-hl-callout.out { animation: rp-hl-out .4s ease both; }
.rp-hl-callout b { display: block; color: var(--tier, #b9b38a); font: 900 20px/1 var(--rp-font); letter-spacing: .08em;
  text-transform: uppercase; text-shadow: 0 0 12px color-mix(in srgb, var(--tier, #b9b38a) 55%, transparent); }
.rp-hl-callout span { display: block; margin-top: 3px; color: var(--rp-ink); font: 12px/1.3 var(--rp-font); }
.rp-hl-callout .chips { display: flex; gap: 4px; margin-top: 4px; }
.rp-hl-callout .chips i { font: 800 9px/1.5 var(--rp-font); font-style: normal; letter-spacing: .1em; text-transform: uppercase;
  padding: 0 5px; border-radius: 2px; background: rgba(255, 255, 255, .1); color: var(--rp-muted); }
.rp-hl-medal { width: 42px; height: 42px; flex: none; color: var(--tier, #b9b38a); }
.rp-hl-medal svg { width: 42px; height: 42px; overflow: visible; }
.rp-hl-callout .rp-hl-medal { animation: rp-hl-glint 1.6s ease-out .2s both; }
@keyframes rp-hl-stamp { 0% { opacity: 0; transform: scale(1.35); filter: brightness(2); } 100% { opacity: 1; transform: scale(1); filter: none; } }
@keyframes rp-hl-out { to { opacity: 0; transform: translateY(-8px); } }
@keyframes rp-hl-glint { 0% { filter: drop-shadow(0 0 0 transparent) brightness(1.6); } 40% { filter: drop-shadow(0 0 9px currentColor) brightness(1.2); } 100% { filter: drop-shadow(0 0 3px currentColor); } }

.rp-hl-ticker { position: absolute; left: 12px; bottom: calc(var(--rp-bar-h) + 18px); display: flex; flex-direction: column-reverse;
  gap: 4px; width: min(430px, calc(50% - 150px)); pointer-events: none; }
.rp-hl-tick { display: flex; align-items: center; gap: 7px; padding: 3px 4px 3px 5px; border-radius: 6px; pointer-events: auto;
  background: rgba(16, 16, 14, .78); border: 1px solid var(--rp-edge); box-shadow: 0 4px 14px rgba(0, 0, 0, .35);
  animation: rp-hl-slide .3s ease-out both; font-size: 11px; min-width: 0; }
.rp-hl-tick.out { animation: rp-hl-out .4s ease both; }
.rp-hl-tick .rp-hl-medal, .rp-hl-tick .rp-hl-medal svg { width: 22px; height: 22px; }
.rp-hl-tick-text { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--rp-muted); }
.rp-hl-tick-text b { color: var(--tier, #b9b38a); font: 800 10px var(--rp-font); letter-spacing: .1em; text-transform: uppercase; margin-right: 5px; }
.rp-hl-tick-text .nm { font-weight: 700; color: var(--rp-ink); margin-right: 5px; }
.rp-hl-tick-text .nm.t1 { color: #ff9a9a; } .rp-hl-tick-text .nm.t2 { color: #a6c0ff; }
.rp-hl-tick .rp-btn { height: 20px; min-width: 0; padding: 0 6px; font-size: 9px; border-color: var(--rp-edge); }
@keyframes rp-hl-slide { from { opacity: 0; transform: translateX(-14px); } to { opacity: 1; transform: none; } }
.rp-root.rp-idle .rp-hl-ticker { bottom: 22px; }
/* In a first person the game's HUD owns the bottom band (its vehicle icon
   from 75% of the screen down, replay-hud.js): the ticker waits above it. */
html.replay-sight .rp-root.rp-idle .rp-hl-ticker { bottom: calc(25% + 10px); }
.rp-root.map-open .rp-hl-callouts, .rp-root.map-open .rp-hl-ticker { display: none; }

/* Streak marks on the name tags, the card and the board. */
.rp-hl-streak { display: inline-flex; align-items: center; gap: 2px; padding: 0 4px 0 2px; margin-left: 5px; border-radius: 8px;
  background: linear-gradient(90deg, rgba(240, 145, 60, .35), rgba(240, 90, 40, .15)); color: #ffc98a;
  font: 800 10px/1.45 var(--rp-mono); vertical-align: 1px; animation: rp-hl-ember 1.8s ease-in-out infinite; }
.rp-hl-streak svg { width: 10px; height: 10px; }
.rp-hl-lead { display: inline-flex; margin-left: 4px; color: var(--rp-gold); vertical-align: -1px; }
.rp-hl-lead svg { width: 11px; height: 11px; }
@keyframes rp-hl-ember { 0%, 100% { box-shadow: 0 0 0 0 rgba(240, 145, 60, 0); } 50% { box-shadow: 0 0 8px 1px rgba(240, 145, 60, .45); } }

/* The battle map. */
.rp-bm { position: absolute; left: 50%; top: 12px; transform: translateX(-50%); display: none; flex-direction: column;
  width: min(1180px, calc(100% - 24px)); height: calc(100% - var(--rp-bar-h) - 34px); min-height: 0; }
.rp-root.map-open .rp-bm { display: flex; }
.rp-bm-body { flex: 1 1 auto; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr) 300px; }
.rp-bm-view { position: relative; min-width: 0; min-height: 0; overflow: hidden; background: #0b0d0c; border-radius: 0 0 0 7px; }
.rp-bm-view canvas { position: absolute; inset: 0; width: 100%; height: 100%; z-index: auto; cursor: crosshair; touch-action: none; }
.rp-bm-view canvas.over { cursor: pointer; }
.rp-bm-view canvas.dragging { cursor: grabbing; }
.rp-bm-hint { position: absolute; left: 10px; bottom: 8px; color: var(--rp-muted); font: 10px/1.4 var(--rp-font); pointer-events: none;
  text-shadow: 0 1px 2px #000; }
.rp-bm-legend { display: flex; flex-wrap: wrap; gap: 3px 12px; align-items: center; margin-right: auto; margin-left: 16px;
  color: var(--rp-khaki-ink); font: 700 9px/1.4 var(--rp-font); letter-spacing: .08em; }
.rp-bm-legend i { display: inline-block; width: 8px; height: 8px; margin-right: 4px; border-radius: 50%; vertical-align: -1px; }
.rp-bm-tip { position: absolute; z-index: 2; padding: 5px 8px; max-width: 240px; pointer-events: none; display: none;
  background: var(--rp-plate-deep); border: 1px solid var(--rp-edge); border-radius: 5px; box-shadow: 0 6px 18px rgba(0, 0, 0, .5);
  font: 11px/1.35 var(--rp-font); color: var(--rp-muted); }
.rp-bm-tip b { display: block; color: var(--rp-ink); font-size: 12px; }
.rp-bm-tip b.t1 { color: #ff9a9a; } .rp-bm-tip b.t2 { color: #a6c0ff; }
.rp-bm-side { display: flex; flex-direction: column; min-height: 0; border-left: 1px solid var(--rp-edge); }
.rp-bm-tabs { display: flex; border-bottom: 1px solid var(--rp-edge); }
.rp-bm-tabs .rp-btn { flex: 1; border-radius: 0; height: 30px; }
.rp-bm-pane { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 2px 0 8px; }
.rp-bm-pane[hidden] { display: none; }
.rp-bm-sec h4 { margin: 8px 12px 3px; font: 800 10px var(--rp-font); letter-spacing: .14em; text-transform: uppercase; color: var(--rp-muted); }
.rp-bm-sec .none { margin: 0 12px 4px; color: var(--rp-muted); font-size: 11px; opacity: .7; }
.rp-bm-row { display: grid; grid-template-columns: 18px minmax(0, 1fr) auto; align-items: center; column-gap: 7px; width: 100%;
  padding: 4px 12px; margin: 0; border: 0; background: none; color: var(--rp-ink); font: 12px/1.3 var(--rp-font); text-align: left; cursor: pointer; }
.rp-bm-row:hover, .rp-bm-row.hot { background: rgba(255, 255, 255, .07); }
.rp-bm-row .ic { display: grid; place-items: center; color: var(--rp-muted); }
.rp-bm-row .ic svg { width: 14px; height: 14px; }
.rp-bm-row .tx { min-width: 0; }
.rp-bm-row .tx b { display: block; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rp-bm-row .tx b.t1 { color: #ff9a9a; } .rp-bm-row .tx b.t2 { color: #a6c0ff; }
.rp-bm-row .tx span { display: block; color: var(--rp-muted); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rp-bm-row .nb { font: 700 12px var(--rp-mono); color: var(--rp-muted); text-align: right; white-space: nowrap; }
.rp-bm-row .nb.hot { color: #ffc98a; }
.rp-bm-row.me { box-shadow: inset 2px 0 0 var(--rp-gold); background: rgba(232, 195, 90, .1); }
.rp-bm-row.far { opacity: .5; }
.rp-bm-heatbar { display: block; height: 3px; margin-top: 3px; border-radius: 2px; background: rgba(255, 255, 255, .1); overflow: hidden; }
.rp-bm-heatbar > i { display: block; height: 100%; background: linear-gradient(90deg, #e8c35a, #f0913c, #e0503c); }
.rp-bm-row .ic.fight { color: var(--rp-hl-heat); }
.rp-bm-row .ic.gold { color: var(--rp-gold); }
.rp-bm-play { display: flex; gap: 6px; align-items: center; padding: 8px 12px 4px; }
.rp-bm-play .rp-btn { border-color: var(--rp-gold); color: var(--rp-gold); }
.rp-bm-play span { color: var(--rp-muted); font-size: 11px; }
.rp-bm-row time { font: 11px var(--rp-mono); color: var(--rp-muted); }
@media (max-width: 720px) {
  .rp-bm { top: 6px; width: calc(100% - 12px); }
  .rp-bm-body { grid-template-columns: 1fr; grid-template-rows: minmax(0, 1.2fr) minmax(0, 1fr); }
  .rp-bm-side { border-left: 0; border-top: 1px solid var(--rp-edge); }
  .rp-bm-legend { display: none; }
  /* The width of the view, so over the card and the Auto caption, not on them. */
  .rp-hl-ticker { width: calc(100% - 24px); bottom: calc(var(--rp-bar-h) + var(--rp-card-h) + 52px); }
  .rp-hl-callout b { font-size: 16px; }
}
/* A phone on its side: the map beside its list, as on a desktop. */
@media (max-height: 500px) {
  .rp-bm { top: 6px; height: calc(100% - var(--rp-bar-h) - 20px); }
  .rp-bm-body { grid-template-columns: minmax(0, 1fr) 240px; grid-template-rows: minmax(0, 1fr); }
  .rp-bm-side { border-left: 1px solid var(--rp-edge); border-top: 0; }
  .rp-bm-legend { display: none; }
}
@media (pointer: coarse) {
  .rp-hl-reel .rp-btn { height: 34px; }
  .rp-hl-tick .rp-btn { height: 30px; padding: 0 9px; }
  .rp-bm-tabs .rp-btn { height: 38px; }
  .rp-bm-row { padding-top: 7px; padding-bottom: 7px; }
}
`;

function injectStyle() {
  if (document.getElementById('rp-hl-style')) return;
  const style = el('style');
  style.id = 'rp-hl-style';
  style.textContent = STYLE;
  document.head.appendChild(style);
}
