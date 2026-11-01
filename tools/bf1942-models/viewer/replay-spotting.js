// Artillery spotting in a replay (features/replay-feature-sweep-2026-11-01,
// entry 9; features/artillery-spotting): the scouts' binocular markers on the
// minimap, and for a followed artillery gunner the view through one (camera
// view mode 17) with its overlay.
//
// What is recorded and what is not:
//   - each marker: recorded. The marker is the marker weapon's projectile
//     (`BinocularsProjectile`, SPOT-1..SPOT-3), a networked pooled object, so
//     the recording has it at the origin in its pool until a scout marks, then
//     at the marker's matrix (30 m over his eye, looking at the spot: SPOT-2)
//     until it dies (SPOT-4). A client then extrapolates it for a few samples
//     and snaps back; the first sample of a placement is the matrix.
//   - who marked: not recorded on the marker. The scout is the man whose
//     position at the placement is 30 m below the marker's eye (`markerOwner`),
//     and his side at that moment is the marker's (SPOT-2's `+0x12c`).
//   - which marker a gunner looked through, and whether he looked at all: not
//     recorded. The client sends `ReqScoutCameraEvent` to the server (SPOT-10),
//     which no recorder writes. So the view is offered, not replayed: J looks
//     through the newest of his side's markers, as the gunner's first alt-fire
//     does (SPOT-8), and [ / ] step the list (SPOT-9).
//
// The rules are spotter.js's own, run over the recording's list: the selector
// (`ScoutSelector`: the gate, the toggle, the steps and their stalls, the
// endings of SPOT-12, the countdown), the view (`ScoutView`: the eye at the
// marker, the gaze easing toward the seat's latest shell, SPOT-11) and the HUD
// rules (SPOT-13). The paint is map-spotter.js's (`paintHud`, `drawWedges`).
//
// The pure half (`scoutPlacements`, `markerOwner`, `scoutMarkers`,
// `liveMarkers`) runs under node (tests/replay_spotting_harness.mjs).

import {
  ScoutSelector, ScoutView, artSeat, fadeAlpha, scoutIconFrame, scoutLine, teamMarkers, wedgeBlinkAlpha,
} from './spotter.js';
import { nameAt, teamAt } from './replay-recording.js';
import { rotate } from './replay-kinematics.js';
import { whereIs } from './replay-battles.js';
import { focusLife } from './replay-camera.js';

/** vanilla's marker round, and its life where the tree's table says nothing. */
export const DEFAULT_MARKER = 'binocularsprojectile';
export const DEFAULT_TIME_TO_LIVE = 120;
/** Metres from the origin inside which a recorded pose is the pool's. */
const AT_ORIGIN = 1;
/** The marker sits this far over its scout's eye (spotter.js EYE_LIFT, SPOT-2). */
const EYE_LIFT = 30;
/** How far, across and up or down, the scout's recorded origin may be from
 *  the eye under the marker: his origin is a metre over his feet, his eye
 *  about 0.6 m over that, and the marker's first sample is up to a tenth of a
 *  second late. */
export const OWNER_REACH = 4;
/** Seconds back from a marker's first sample its scout is looked for, and
 *  the step. */
const OWNER_LOOK_BACK = 15;
const OWNER_LOOK_STEP = 0.5;
/** A turn this large between two samples of one placed object is a new mark
 *  from where the old one was: the extrapolated samples keep the rotation. */
const NEW_MARK_DOT = 0.9999;

/** Each side's minimap colour (map-surfaces.js `MINIMAP_TEAM_TINT`), and the
 *  grey of a marker nobody was found under. */
const TEAM_TINT = { 1: [247, 52, 49], 2: [75, 126, 252] };
const NO_TEAM_TINT = [150, 150, 150];

const atOrigin = p => Math.hypot(p[0], p[1], p[2]) < AT_ORIGIN;
const lower = s => String(s ?? '').toLowerCase();

/** The marker templates of a tree's `_shared/vehicle-spotting.json`
 *  (`markerWeapons[].projectile`), vanilla's always among them, each with its
 *  life: `Map<lower template, seconds>`. */
export function markerTemplates(table = null) {
  const out = new Map([[DEFAULT_MARKER, DEFAULT_TIME_TO_LIVE]]);
  for (const w of table?.markerWeapons ?? []) {
    if (!w?.projectile) continue;
    out.set(lower(w.projectile), Number(w.timeToLive) > 0 ? Number(w.timeToLive) : DEFAULT_TIME_TO_LIVE);
  }
  return out;
}

/** The end of the replicated span of `life` holding `t`, else its death. */
function spanEnd(life, t) {
  for (const [from, to] of life.replicated ?? []) {
    if (from <= t + 1e-6 && (to === null || to === undefined || t < to)) {
      return to === null || to === undefined ? life.destroyed : Math.min(to, life.destroyed);
    }
  }
  return life.destroyed;
}

/**
 * Every mark the recording has, in time order: `{ life, tmpl, t0, t1, p, q }`
 * with `p` and `q` the recording's own frame (the first sample of the
 * placement) and `t1` when it went: back to its pool, placed again (a new
 * rotation: the scout marked again and the pool handed the same object back),
 * out of the recording, or destroyed.
 */
export function scoutPlacements(rec, templates = markerTemplates()) {
  const out = [];
  for (const life of rec.lives ?? []) {
    if (!templates.has(lower(life.tmpl))) continue;
    const keys = life.keys;
    const n = keys?.length ?? 0;
    const sample = i => (typeof keys.sample === 'function' ? keys.sample(i) : keys[i]);
    let open = null;
    const close = t => {
      if (!open) return;
      open.t1 = Math.min(t, spanEnd(life, open.t0));
      out.push(open);
      open = null;
    };
    for (let i = 0; i < n; i++) {
      const s = sample(i);
      if (atOrigin(s.p)) { close(s.t); continue; }
      if (open) {
        const a = open.q;
        // The recorder writes three decimals, so neither is quite of unit length.
        const b = s.q;
        const dot = Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3])
          / (Math.hypot(a[0], a[1], a[2], a[3]) * Math.hypot(b[0], b[1], b[2], b[3]) || 1);
        if (dot >= NEW_MARK_DOT) continue;
        close(s.t);
      }
      open = { life, tmpl: life.tmpl, t0: s.t, t1: Infinity, p: [...s.p], q: [...s.q] };
    }
    close(Infinity);
  }
  return out.sort((a, b) => a.t0 - b.t0);
}

/** A recorded position and rotation as the marker's matrix in the viewer's
 *  frame (replay-actors.js `toViewPosition` / `toViewQuaternion`): forward
 *  the object's -Z there, up its +Y. */
export function markerMatrix(p, q) {
  const qv = [-q[0], -q[1], q[2], q[3]];
  return {
    position: [p[0], p[1], -p[2]],
    forward: rotate(qv, [0, 0, -1]),
    up: rotate(qv, [0, 1, 0]),
    right: rotate(qv, [1, 0, 0]),
    degenerate: false,
  };
}

/**
 * Who marked, from where everyone was: the nearest of `candidates` (`{ pid,
 * team, pos }`, viewer frame) whose position is within OWNER_REACH of the
 * eye under the marker, across and up or down. `{ pid, team }`, or null.
 */
export function markerOwner(eye, candidates) {
  const under = [eye[0], eye[1] - EYE_LIFT, eye[2]];
  let best = null;
  let bestD = Infinity;
  for (const c of candidates) {
    if (!c?.pos) continue;
    const across = Math.hypot(c.pos[0] - under[0], c.pos[2] - under[2]);
    const up = Math.abs(c.pos[1] - under[1]);
    if (across > OWNER_REACH || up > OWNER_REACH) continue;
    const d = Math.hypot(across, up);
    if (d < bestD) { bestD = d; best = c; }
  }
  return best ? { pid: best.pid, team: best.team || null } : null;
}

/**
 * The round's markers, as spotter.js's `ScoutCameras` keeps them: `{ id, nid,
 * tmpl, owner, team, matrix, birth, end, timeToLive, removeAt }`, in time
 * order, `id` 1.. in that order. `where(pid, t)` is replay-battles.js
 * `whereIs`; `pids` everyone to look among for the scout. A marker nobody
 * stood under has owner -1 and no team, as the page's miss has.
 */
export function scoutMarkers(rec, { table = null, where, pids = [] } = {}) {
  const templates = markerTemplates(table);
  return scoutPlacements(rec, templates).map((m, i) => {
    const matrix = markerMatrix(m.p, m.q);
    // The first sample can be late: a marker placed out of the recording's
    // range is first had when it comes into it, and its scout may have walked
    // on (2117 of replay_20261024-161456, 6 s). Where he stood is looked for
    // back from there.
    let owner = null;
    for (let back = 0; back <= OWNER_LOOK_BACK && !owner; back += OWNER_LOOK_STEP) {
      const at = m.t0 - back;
      const candidates = [];
      for (const pid of pids) {
        const w = where(pid, at);
        if (!w?.pos || !w.fresh || (w.state !== 'foot' && w.state !== 'vehicle')) continue;
        candidates.push({ pid, team: teamAt(rec, pid, m.t0) || w.team || null, pos: w.pos });
      }
      owner = markerOwner(matrix.position, candidates);
    }
    return {
      id: i + 1, nid: m.life.nid, tmpl: m.tmpl, owner: owner?.pid ?? -1, team: owner?.team ?? null,
      matrix, birth: m.t0, end: m.t1, timeToLive: templates.get(lower(m.tmpl)) ?? DEFAULT_TIME_TO_LIVE,
      removeAt: null,
    };
  });
}

/** The markers the game's list holds at `t`, newest first (SPOT-4). */
export function liveMarkers(markers, t) {
  const out = [];
  for (const m of markers) if (m.birth <= t && t < m.end) out.push(m);
  return out.sort((a, b) => b.birth - a.birth || b.id - a.id);
}

/**
 * The recording's list as `ScoutSelector` reads a `ScoutCameras`: `list`,
 * `byId`, `remaining`, and `onRemove` called for each marker that left it
 * since the last `update` (a seek that jumps back over a mark removes it too).
 */
export class RecordedScoutList {
  constructor(markers = []) {
    this.markers = markers;
    this.list = [];
    this.onRemove = null;
  }

  remaining(marker, now) {
    return marker.timeToLive - (now - marker.birth);
  }

  byId(id) {
    return id == null ? null : this.list.find(m => m.id === id) ?? null;
  }

  update(t) {
    const next = liveMarkers(this.markers, t);
    const kept = new Set(next);
    const gone = this.list.filter(m => !kept.has(m));
    this.list = next;
    for (const m of gone) this.onRemove?.(m);
  }
}

/** The page's side of it in a replay: built by replay.js as `player.spotting`. */
export class ReplaySpotting {
  constructor(player) {
    this.player = player;
    this.cameras = new RecordedScoutList();
    this.built = null;          // 'default' or 'table': what the markers were read with
    const cam = () => player.ctx.camera;
    this.view = new ScoutView({
      // The replay's camera sets its own lens each frame (replay-camera.js
      // `useLens`), so the field of view comes back by itself; nothing else
      // of the seat's camera is the replay's to change.
      save: () => ({ fov: cam()?.fov ?? null }),
      restore: () => {},
    });
    this.now = 0;
    this.selector = new ScoutSelector(this.cameras, this.view, () => {
      const seat = this.seat;
      return {
        artPos: Boolean(seat), externTrace: Boolean(seat?.entry.externTrace),
        team: this.team, teamOf: pid => this.teamOf(pid), now: this.now,
      };
    });
    this.seat = null;
    this.seatKey = '';
    this.team = null;
    this.clock = 0;
    this.fadeAt = -Infinity;
    this.fadesSeen = 0;
    this.seconds = 0;
    this.offered = '';
    this.lastTrace = null;      // the shell the view eased toward last frame
  }

  /** The spotting table of the page's tree (map-spotter.js), or null. */
  table() {
    return this.player.ctx.spotter?.()?.table?.() ?? null;
  }

  teamOf(pid) {
    if (pid == null || pid < 0) return null;
    return teamAt(this.player.rec, pid, this.now) || null;
  }

  /** The markers, read once the tree's table is in (its marker templates and
   *  their lives), and with vanilla's alone until then. */
  ensureMarkers() {
    const table = this.table();
    const want = table ? 'table' : 'default';
    if (this.built === want || this.built === 'table') return;
    const { rec } = this.player;
    const pids = [...new Set([...rec.players.keys(), ...(rec.playerNids?.keys() ?? [])])];
    this.cameras.markers = scoutMarkers(rec, {
      table, pids, where: (pid, at) => whereIs(rec, pid, at, this.player.kills),
    });
    this.cameras.list = [];
    this.selector.leaveSeat();
    this.built = want;
  }

  /** The followed man's seat at `t` when it is an `artPos` seat the table
   *  lists: `{ entry, hull, seatId, life }`, else null. */
  seatAt(t) {
    const { player } = this;
    if (player.followPid === null) return null;
    const life = focusLife(player, t);
    if (!life || life.soldier || life.camera) return null;
    const seat = player.camera.seatOf?.(life, t);
    if (!seat) return null;
    const node = seat.hull.occupancy?.survey?.seats?.get(seat.seatId)?.node ?? null;
    const name = node?.userData?.control || node?.name || '';
    const entry = artSeat(this.table(), name);
    return entry ? { entry, hull: seat.hull, seatId: seat.seatId, life } : null;
  }

  /** Once a frame, before the camera: the list at `t`, the followed man's
   *  seat, the countdown and the fade. `dt` is the page's own step (the
   *  blinks and the fade run on it, as the page's do). */
  frame(t, dt) {
    this.ensureMarkers();
    this.now = t;
    this.clock += Number.isFinite(dt) ? dt : 0;
    this.cameras.update(t);
    const camera = this.player.camera;
    const watching = camera.mode !== 'free' && !camera.rig;
    this.seat = watching ? this.seatAt(t) : null;
    this.team = this.seat ? teamAt(this.player.rec, this.player.followPid, t) || null : null;
    const key = this.seat ? `${this.player.followPid}|${this.seat.life.nid}|${this.seat.seatId}` : '';
    if (key !== this.seatKey) {
      // Nothing of the selector's follows him out of the seat (SPOT-10).
      this.selector.leaveSeat();
      this.seatKey = key;
    }
    this.seconds = this.selector.frame();
    if (this.selector.fades !== this.fadesSeen) {
      this.fadesSeen = this.selector.fades;
      this.fadeAt = this.clock;
    }
    // Offered once a seat: the first frame his side has a marker he could
    // look through.
    if (key && this.selector.gate() && this.offered !== key) {
      this.offered = key;
      this.player.ui?.flash?.('Scout camera: J looks through the newest marker', 2600);
    }
  }

  /** J: the gunner's alt-fire (SPOT-8). What happened, for the bar to say. */
  toggle() {
    if (!this.seat) return { refused: 'seat' };
    if (!this.selector.gate()) return { refused: 'marker' };
    this.selector.toggle();
    return { on: this.view.on, refused: this.selector.viewing && !this.view.on ? 'camera' : null };
  }

  /** [ and ]: previous and next item (SPOT-9). */
  step(dir) {
    if (!this.seat) return false;
    return this.selector.step(dir);
  }

  /** Out of the view, whatever else the camera does next (a camera key, the
   *  free camera). */
  leave() {
    this.selector.leaveSeat();
  }

  /** The seat's latest shell where it is now, viewer frame, or null: a
   *  server's flight (replay-flights.js) of his, else a round the page flew
   *  from one of the hull's guns. */
  trace() {
    const { player } = this;
    const pid = player.followPid;
    let best = null;
    for (const [flight, shown] of player.flights?.live ?? []) {
      if (flight.shot?.pid !== pid || !shown?.node?.visible) continue;
      if (!best || flight.created > best.created) best = { created: flight.created, node: shown.node };
    }
    if (best) return best.node.position.toArray();
    const groups = this.seat?.hull?.groups;
    const list = player.ctx.guns?.projectiles;
    if (groups?.length && list?.length) {
      for (let i = list.length - 1; i >= 0; i--) {
        if (groups.includes(list[i].group) && list[i].mesh) return list[i].mesh.position.toArray();
      }
    }
    return null;
  }

  /** The camera's frame while the view is on (replay-camera.js): one
   *  `getTransformation` a rendered frame (SPOT-11). False while it is off. */
  place(cam) {
    if (!this.view.on) return false;
    this.lastTrace = this.trace();
    const pose = this.view.step(this.lastTrace);
    const up = cam.up.clone();
    cam.position.set(pose.position[0], pose.position[1], pose.position[2]);
    cam.up.set(pose.up[0], pose.up[1], pose.up[2]);
    cam.lookAt(pose.target[0], pose.target[1], pose.target[2]);
    cam.up.copy(up);
    return true;
  }

  /** What the overlay shows (map-spotter.js `paintHud`). Nothing in the
   *  view's absence but the scout icon, and that only in an `artPos` seat. */
  hud() {
    const bare = typeof document !== 'undefined' && document.documentElement.classList.contains('replay-bare');
    const available = this.seat ? teamMarkers(this.cameras, this.team, this.now).length > 0 : false;
    const lineMarker = this.selector.line != null ? this.cameras.byId(this.selector.line) : null;
    const strings = this.table()?.strings ?? null;
    return {
      icon: available && !bare ? scoutIconFrame(this.clock) : 0,
      line: lineMarker && this.seconds > 0 && !bare
        ? scoutLine(nameAt(this.player.rec, lineMarker.owner, lineMarker.birth), strings) : null,
      seconds: lineMarker ? this.seconds : 0,
      viewing: this.view.on,
      fade: fadeAlpha(this.clock - this.fadeAt),
    };
  }

  /**
   * The minimap's wedges: in an `artPos` seat his side's live markers, the
   * one selected blinking, as the page's gunner sees them (SPOT-13);
   * anywhere else every live marker in its side's colour, a replay being
   * nobody's side (as its units are, replay-minimap.js).
   */
  wedges() {
    if (this.seat) {
      const blink = wedgeBlinkAlpha(this.clock, this.table()?.cameraBlink);
      return teamMarkers(this.cameras, this.team, this.now).map(m => ({
        id: m.id, matrix: m.matrix, tint: null, alpha: m.id === this.selector.selected ? blink : 1,
      }));
    }
    return this.cameras.list.filter(m => this.cameras.remaining(m, this.now) > 0)
      .map(m => ({ id: m.id, matrix: m.matrix, tint: TEAM_TINT[m.team] ?? NO_TEAM_TINT, alpha: 1 }));
  }

  mapKey() {
    const list = this.wedges();
    if (!list.length) return '';
    return `rw${list.map(w => `${w.id}:${w.tint ?? ''}:${w.alpha}`).join('.')}`;
  }

  /** The wedges onto a map surface, with map-spotter.js's paint. */
  drawMap(ctx, projectToArt, toPx, sc, rot = 0) {
    this.player.ctx.spotter?.()?.drawWedges?.(ctx, projectToArt, toPx, sc, rot, this.wedges());
  }

  /** For a probe: the list, the seat, the selector, the view and the HUD. */
  state() {
    return {
      now: this.now,
      built: this.built,
      markers: this.cameras.markers.length,
      seat: this.seat ? { seat: this.seat.entry.seat, externTrace: this.seat.entry.externTrace, hull: this.seat.life.tmpl } : null,
      team: this.team,
      gate: this.selector.gate(),
      live: this.cameras.list.map(m => ({
        id: m.id, nid: m.nid, owner: m.owner, team: m.team, birth: m.birth, end: m.end,
        remaining: this.cameras.remaining(m, this.now), eye: m.matrix.position, forward: m.matrix.forward,
      })),
      selected: this.selector.selected,
      viewing: this.selector.viewing,
      view: this.view.markerId,
      lookAt: this.view.lookAt ? [...this.view.lookAt] : null,
      trace: this.view.on ? this.lastTrace ?? null : null,
      hud: this.hud(),
      wedges: this.wedges().map(w => w.id),
    };
  }

  dispose() {
    this.selector.leaveSeat();
  }
}
