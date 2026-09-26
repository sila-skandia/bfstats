// The game's own message log in a replay. The recorded round's kill lines,
// flags taken and chat box are written into the page's log (comms.js,
// chat-log.js) as playback crosses them, so they read the way they do in
// play: `killer [weapon] victim` under the killer's flag, the capture line,
// the chat, and the centre message when the followed player is the one who
// died. The log's timers run on the recording's clock (map.html ticks it at
// `feedRate`), so a paused replay keeps its lines and a seek rebuilds what
// the log held at the new instant.
//
// And, in first person on the recording player, the game's hit-direction
// wash (`rec.hitsTaken`, HitFromPosEvent 0x3C, which only the damaged
// player's client ever receives) through the page's own HUD.

import { feedEvents, playerName, playerTeam, pointsAt } from './replay-chapters.js';

/** How far back a seek rebuilds the log from, recording seconds: longer
 *  than a line can stay up (chat-log.js: three kill lines at five seconds
 *  each, the chat section's timer restarted by every new line). */
const REBUILD_WINDOW = 60;

/** The log drops one line per tick past its timeout (chat-log.js `tick`),
 *  so a rebuild steps its timers no more than this at a time. */
const TICK = 0.25;

/** A kill this close behind a rebuilt instant still puts its centre message
 *  up for the followed player; an older one is only in the log. */
const LIVE = 1;

/** HitFromDir/HitFromDirAlpha's ceiling (hud.js `hitFromDirAlpha`). */
const MAX_WASH = 0.75;

export class ReplayFeed {
  constructor(player, kills) {
    this.player = player;
    this.comms = player.ctx.comms ?? null;
    this.events = feedEvents(player.rec, kills);
    this.hits = player.rec.hitsTaken ?? [];
    this.written = null;   // the recording time the log holds everything up to
    this.cursor = 0;       // the first event after `written`
    this.comms?.setRadioShown?.(false);
    this.comms?.clear?.();
  }

  /** The log no longer matches the clock (a seek): the next frame rebuilds. */
  invalidate() {
    this.written = null;
  }

  speaker(pid, local = false) {
    const { rec } = this.player;
    return { id: pid, name: playerName(rec, pid), team: playerTeam(rec, pid), local, vehicle: null, weapon: null };
  }

  /** One line (or two, for a team kill) into the page's log. */
  write(e, live) {
    const { comms } = this;
    if (e.type === 'kill') {
      const victim = this.speaker(e.victim, live && e.victim === this.player.followPid);
      const killer = e.killer === null || e.killer === undefined ? null : this.speaker(e.killer);
      comms.onKill(victim, killer, e.weapon ? { weapon: e.weapon } : null);
    } else if (e.type === 'capture') {
      // "Every point" is the recording's points as they stood after this one
      // fell, not the page's flags, which a replay never moves.
      const points = pointsAt(this.player.rec, e.t);
      const point = points.find(p => p.name === e.name)
        ?? { name: e.name, team: e.team, controlPointName: e.name };
      comms.onCapture(point, e.team, points);
    } else if (e.type === 'chat') {
      comms.chatLine?.(e.text, e.team);
    }
  }

  /** The first event after `t`. */
  indexAfter(t) {
    let lo = 0;
    let hi = this.events.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.events[mid].t <= t) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /** Step the log's timers by `dt` recording seconds. */
  advance(dt) {
    for (let left = dt; left > 1e-6; left -= TICK) this.comms.tick(Math.min(TICK, left));
  }

  /** What the log held at `t`: cleared, then the last minute's lines written
   *  in order with the timers stepped between them. */
  rebuild(t) {
    this.comms.clear();
    let clock = Math.max(0, t - REBUILD_WINDOW);
    for (let i = this.indexAfter(clock); i < this.events.length && this.events[i].t <= t; i++) {
      const e = this.events[i];
      this.advance(e.t - clock);
      this.write(e, t - e.t < LIVE);
      clock = e.t;
    }
    this.advance(t - clock);
    this.written = t;
    this.cursor = this.indexAfter(t);
  }

  /**
   * One frame at recording time `t`. `wash` is whether the view is the
   * recording player's own first person, where his hits are drawn.
   */
  update(t, wash = false) {
    if (!this.comms) return;
    if (this.written === null || t < this.written) {
      this.rebuild(t);
      return;
    }
    if (t === this.written) return;
    for (; this.cursor < this.events.length && this.events[this.cursor].t <= t; this.cursor++) {
      this.write(this.events[this.cursor], true);
    }
    if (wash && this.player.ctx.triggerHitIndicator) {
      for (const hit of this.hits) {
        if (hit.t <= this.written) continue;
        if (hit.t > t) break;
        // The recorded sector counts 45 degrees a step from ahead (0) round
        // to behind (4); the HUD's octant is the same compass from 1. Which
        // side 1-3 are is not confirmed (features/round-replay-ux): drawn
        // clockwise, as the HUD's own 2 (front-right) and 3 (right) are.
        this.player.ctx.triggerHitIndicator((hit.dir % 8) + 1, Math.min(MAX_WASH, Math.max(0, hit.strength / 255)));
      }
    }
    this.written = t;
  }

  dispose() {
    this.comms?.clear?.();
    this.comms?.setRadioShown?.(true);
  }
}
