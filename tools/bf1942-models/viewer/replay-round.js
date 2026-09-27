// The round's own state as the recording has it, on the page's own flags and
// ticket counter: which side holds each control point, and both sides'
// tickets.
//
// A point's owner is replicated to every client (`ControlPointNetworkable`
// carries the team and nothing else), so the recording's `cp` records are
// the truth, and each flag is moved the way play moves it, through the
// page's `hoistCaptureFlag` (the cloth, the minimap marker, the flag bar).
//
// Tickets are the client's `ScoreManager`'s, recorded as `tk` from bf42plus
// `e692f14` on. A recording without them gets the page's own round
// (`round-state.js`, the rules TKT-1..TKT-5 read out of the server) run over
// the recorded deaths and points from the round's start, and says it is an
// estimate. A recording that joined mid-round cannot know what the tickets
// were at its join and shows none rather than a made-up count.
//
// Three.js-free, so `tests/replay_harness.mjs` runs it in node.

import { createRoundState, TICKET_BASE_PLAYERS } from './round-state.js';
import { pointsAt } from './replay-chapters.js';
import { teamAt } from './replay-recording.js';

/** The bleed's step, seconds: fine next to its 2 s countdowns. */
const STEP = 0.1;

/** Metres within which a recorded point is the level's point at that place. */
const NEAR = 60;

const lower = s => String(s ?? '').toLowerCase();

/**
 * Which of the level's control points each recorded one is: by template name
 * (the scene's `name`, whatever its case), then by the name the game shows
 * (`displayName`, the recording's `name`), then the nearest within 60 m (a
 * mode's layer can move a point: Wake co-op's beach flag). `entries` are the
 * level's `extras.controlPoints`, positions in the viewer's frame; the
 * recording's are BF1942's (z negated). Returns Map<recorded id, entry>.
 */
export function matchPoints(recorded, entries) {
  const out = new Map();
  const taken = new Set();
  const take = (point, entry) => { out.set(point.id, entry); taken.add(entry); };
  const free = () => entries.filter(e => !taken.has(e));
  for (const point of recorded) {
    const entry = free().find(e => lower(e.name) === lower(point.tmpl))
      ?? free().find(e => lower(e.displayName) === lower(point.name));
    if (entry) take(point, entry);
  }
  for (const point of recorded) {
    if (out.has(point.id) || !Array.isArray(point.pos)) continue;
    const at = [point.pos[0], point.pos[1], -point.pos[2]];
    let best = null;
    let bestDist = NEAR;
    for (const entry of free()) {
      const p = entry.position;
      if (!Array.isArray(p)) continue;
      const d = Math.hypot(p[0] - at[0], p[2] - at[2]);
      if (d < bestDist) { best = entry; bestDist = d; }
    }
    if (best) take(point, best);
  }
  return out;
}

/** Whether the recording saw its round begin: a PREGAME before the first
 *  PLAYING. A join mid-round is sent PLAYING straight away. */
export function coversRoundStart(rec) {
  return rec.roundStarted !== null && rec.roundStarted !== undefined;
}

/** A step function over `[{ t, v: [team1, team2] }]`: the last at or before
 *  `t`, the first before it starts, null for none. */
export function ticketsAt(timeline, t) {
  if (!timeline?.length) return null;
  let lo = 0;
  let hi = timeline.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (timeline[mid].t <= t) lo = mid + 1;
    else hi = mid;
  }
  return timeline[Math.max(0, lo - 1)].v;
}

/**
 * The page's own round, run over the recording from its start: the level's
 * counts and bleed rates scaled by the server's slot count, a ticket off the
 * dead player's side for every recorded death in play, and each side's bleed
 * on the recorded owners' `areaValue`s. `areaValueOf(point)` answers a
 * recorded point's weight. Null when the recording did not see its round
 * begin, or the level has no counts.
 */
export function estimateTickets(rec, { tickets, rates = null, maxPlayers = TICKET_BASE_PLAYERS, areaValueOf }) {
  if (!coversRoundStart(rec) || !tickets) return null;
  const round = createRoundState({ tickets, rates, maxPlayers });
  const start = rec.roundStarted;
  const end = Math.min(rec.duration, rec.roundEnded ?? Infinity);
  const teamOf = (pid, t) => teamAt(rec, pid, t);
  const deaths = rec.deaths.filter(d => d.t >= start && d.t < end).sort((a, b) => a.t - b.t);
  const timeline = [{ t: 0, v: [round.tickets[1], round.tickets[2]] }];
  let next = 0;
  const note = t => {
    const last = timeline[timeline.length - 1].v;
    if (last[0] !== round.tickets[1] || last[1] !== round.tickets[2]) {
      timeline.push({ t, v: [round.tickets[1], round.tickets[2]] });
    }
  };
  for (let t = start; t < end; t += STEP) {
    while (next < deaths.length && deaths[next].t <= t + STEP) {
      const d = deaths[next++];
      const team = teamOf(d.pid, d.t);
      if (team === 1 || team === 2) round.suicide({ player: d.pid, team });
      note(d.t);
    }
    const points = pointsAt(rec, t + STEP).map(p => ({ team: p.team, areaValue: areaValueOf(p) }));
    round.tick(STEP, points);
    note(t + STEP);
    if (round.over) break;
  }
  return timeline;
}

/** The server's slot count for a recording: the event log's `maxplayers`,
 *  else what its round-start count says against the level's, else 16. */
export function serverSlots(log, levelTickets) {
  const slots = Number(log?.settings?.maxplayers);
  if (Number.isFinite(slots) && slots > 0) return slots;
  const init = log?.events?.find(e => e.name === 'roundInit');
  const started = Number(init?.params?.tickets_team1);
  const level = Number(levelTickets?.team1);
  if (started > 0 && level > 0) return Math.round(started / level * TICKET_BASE_PLAYERS);
  return TICKET_BASE_PLAYERS;
}

/**
 * The presenter. `ctx`: `worldFlags()` (the page's `world.flags`),
 * `levelPoints()` (`extras.controlPoints`), `levelTickets()`
 * (`extras.tickets`), `hoistFlag(flag)` (the page's `hoistCaptureFlag`) and
 * `setTickets(team1, team2)` (what the HUD's counter reads).
 */
export class ReplayRound {
  constructor(rec, log, ctx) {
    this.rec = rec;
    this.log = log;
    this.ctx = ctx;
    this.points = null;         // recorded id -> { entry, flag }
    this.timeline = null;
    this.source = null;         // 'recorded', 'estimated' or null
    this.shown = new Map();     // recorded id -> team last put on the flag
    this.ticketsShown = null;
  }

  /** The level's side of the match, once it has loaded: false until then. */
  bind() {
    if (this.points) return true;
    const entries = this.ctx.levelPoints?.() ?? [];
    // The level is in once it has points or counts (a level can have either
    // alone).
    if (!entries.length && !this.ctx.levelTickets?.()) return false;
    const matched = matchPoints([...this.rec.controlPoints.values()], entries);
    const flags = this.ctx.worldFlags?.() ?? [];
    this.points = new Map();
    for (const [id, entry] of matched) {
      const flag = flags.find(f => f.controlPointName === entry.name)
        ?? { controlPointName: entry.name, name: entry.displayName ?? entry.name, team: entry.team };
      this.points.set(id, { entry, flag });
    }
    if (this.rec.tickets?.length) {
      this.timeline = this.rec.tickets;
      this.source = 'recorded';
    } else {
      const levelTickets = this.ctx.levelTickets?.() ?? null;
      const byName = new Map([...matched].map(([id, entry]) => [this.rec.controlPoints.get(id)?.name, entry]));
      this.timeline = estimateTickets(this.rec, {
        tickets: levelTickets,
        rates: levelTickets?.lossPerMin ?? null,
        maxPlayers: serverSlots(this.log, levelTickets),
        areaValueOf: p => Number(byName.get(p.name)?.areaValue) || 0,
      });
      this.source = this.timeline ? 'estimated' : null;
    }
    return true;
  }

  /** The flags and the counter as they stood at recording time `t`. */
  update(t) {
    if (!this.bind()) return;
    const owners = new Map(pointsAt(this.rec, t).map(p => [p.name, p.team]));
    for (const [id, { flag }] of this.points) {
      const name = this.rec.controlPoints.get(id)?.name;
      if (!owners.has(name)) continue;   // not yet set by the round: the level's own
      const team = owners.get(name);
      if (this.shown.get(id) === team && flag.team === team) continue;
      this.shown.set(id, team);
      flag.team = team;
      this.ctx.hoistFlag?.(flag);
    }
    const v = ticketsAt(this.timeline, t);
    const key = v ? `${v[0]}|${v[1]}` : 'none';
    if (key === this.ticketsShown) return;
    this.ticketsShown = key;
    this.ctx.setTickets?.(v ? v[0] : null, v ? v[1] : null);
  }
}
