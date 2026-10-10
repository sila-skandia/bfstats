// Artillery spotting: the scout's marker, the list every client keeps of
// them, the gunner's selector and the view through a marker (camera view
// mode 17). The rules are the engine's, read in `features/artillery-spotting`
// and recorded as ledger SPOT-1..SPOT-13; each is cited where it is used.
//
// Pure: plain numbers and arrays, no three.js, no DOM and no page, so
// `tests/spotter_harness.mjs` runs it under node. `map-spotter.js` is the
// page's side. Positions are `[x, y, z]` with y up, in whichever frame the
// caller keeps (the page's is the viewer's); nothing here depends on the
// handedness but `mapAngle`, which says so.

/** The marker ray's reach, `10000.0` at lnxded 0x086c04a8 (SPOT-2). */
export const RAY_RANGE = 10000;
/** How far above the spotter's eye the marker sits, `30.0` at 0x086b01b4. */
export const EYE_LIFT = 30;
/** `Projectile::detonate` posts the old marker's removal 0.2 s out (SPOT-3). */
export const REMOVE_DELAY = 0.2;
/** Mode 17 seeds and rests its look-at 20 along the marker's forward (SPOT-7). */
export const LOOK_AHEAD = 20;
/** The look-at point moves this share of the way per call (SPOT-11). */
export const LOOK_EASE = 0.1;
/** `RADIO_ARTILLERY_SUPPORT`, the team radio the spotter's client sends (SPOT-5). */
export const RADIO_ARTILLERY_SUPPORT = 59;
/** `calcLookAtMatrix` gives up when `|fwd . up|` is within this of 1. */
const PARALLEL_EPSILON = 1.19e-7;
/** A marker with no owner: `activate` writes -1 (SPOT-2, a miss). */
export const NO_OWNER = -1;

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0],
];
const length = a => Math.hypot(a[0], a[1], a[2]);
const normalize = a => {
  const n = length(a);
  return n > 0 ? scale(a, 1 / n) : [0, 0, 0];
};

/** Does this FireArms place a marker instead of firing: `magType 2`, and
 *  nothing else. The projectile's `damageType 3` does not choose it (SPOT-1). */
export function isMarkerWeapon(fireArms) {
  return fireArms?.magType === 2;
}

/**
 * `calcLookAtMatrix(from, to, up)` (lnxded 0x08159b80, SPOT-2): forward is
 * `normalize(to - from)`, right `up x forward` normalised, up `forward x
 * right`, position `from`.
 *
 * When forward is parallel to `up` the engine has written forward and leaves
 * the other three rows at identity, so **the position is the origin**; mode
 * 17 refuses such a matrix (SPOT-7). `degenerate` says so.
 */
export function lookAtMatrix(from, to, up = [0, 1, 0]) {
  const forward = normalize(sub(to, from));
  if (Math.abs(Math.abs(dot(forward, up)) - 1) <= PARALLEL_EPSILON) {
    return { right: [1, 0, 0], up: [0, 1, 0], forward, position: [0, 0, 0], degenerate: true };
  }
  const right = normalize(cross(up, forward));
  return { right, up: cross(forward, right), forward, position: [...from], degenerate: false };
}

/**
 * The marker a `magType 2` weapon would place (SPOT-2). `eye` and `forward`
 * are the weapon's fire transform, the camera under `fireInCameraDof`; `cast`
 * answers `(origin, direction, range) => distance | null`, the nearest thing
 * the ray meets.
 *
 * A hit strictly nearer than the range puts the marker 30 above the eye,
 * looking at the hit. Anything else is a miss: the projectile keeps the fire
 * transform it was given before the ray, and has no owner.
 */
export function markerPose(eye, forward, cast, up = [0, 1, 0]) {
  const direction = normalize(forward);
  const distance = cast(eye, direction, RAY_RANGE);
  if (distance != null && distance < RAY_RANGE) {
    const target = add(eye, scale(direction, distance));
    return { hit: true, target, matrix: lookAtMatrix(add(eye, [0, EYE_LIFT, 0]), target) };
  }
  const right = normalize(cross(up, direction));
  return {
    hit: false,
    target: null,
    matrix: { right, up: cross(direction, right), forward: direction, position: [...eye],
      degenerate: false },
  };
}

/**
 * The game's list of scout cameras (`Game +0x5c`, SPOT-4): every live
 * marker, both teams', newest first.
 *
 * A marker is `{ id, weapon, owner, team, target, matrix, birth, timeToLive,
 * removeAt }`. `owner` is the spotter's player id and `team` the team stored
 * on the marker when it was placed; a miss has `NO_OWNER` and no team.
 */
export class ScoutCameras {
  constructor() {
    this.list = [];
    /** The last marker each weapon placed (`FireArms +0x1d4`, SPOT-3). */
    this.byWeapon = new Map();
    this.nextId = 1;
    /** Called with each marker as it leaves the list. */
    this.onRemove = null;
    /** Called with each marker as it is listed. */
    this.onPlace = null;
  }

  /**
   * One pull of a marker weapon at time `now` (seconds): the weapon's last
   * marker is detonated, which removes it `REMOVE_DELAY` later, and the new
   * one is listed at the front, hit or miss. `weapon` is anything that
   * names the FireArms (its node).
   */
  place({ weapon, owner, team, eye, forward, cast, timeToLive, now }) {
    const old = this.byWeapon.get(weapon);
    if (old && this.list.includes(old) && old.removeAt == null) {
      old.removeAt = now + REMOVE_DELAY;
    }
    const pose = markerPose(eye, forward, cast);
    const marker = {
      id: this.nextId++,
      weapon,
      owner: pose.hit ? owner : NO_OWNER,
      team: pose.hit ? team : null,
      target: pose.target,
      matrix: pose.matrix,
      hit: pose.hit,
      birth: now,
      timeToLive,
      removeAt: null,
    };
    this.byWeapon.set(weapon, marker);
    // `Game::placeScoutCamera` removes before it inserts at the front; a new
    // marker is never listed already.
    this.list.unshift(marker);
    this.onPlace?.(marker);
    return marker;
  }

  /** Seconds the marker has left: its `timeToLive` less its age (0x00541ed0). */
  remaining(marker, now) {
    return marker.timeToLive - (now - marker.birth);
  }

  byId(id) {
    return id == null ? null : this.list.find(m => m.id === id) ?? null;
  }

  /** Drop what has died by `now`: a detonated marker whose delay has run,
   *  and one that has lived out its `timeToLive` (`Projectile::destroy`). */
  step(now) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const marker = this.list[i];
      const gone = (marker.removeAt != null && now >= marker.removeAt)
        || this.remaining(marker, now) <= 0;
      if (gone) this.#remove(i);
    }
  }

  remove(marker) {
    const index = this.list.indexOf(marker);
    if (index >= 0) this.#remove(index);
  }

  clear() {
    while (this.list.length) this.#remove(this.list.length - 1);
    this.byWeapon.clear();
  }

  #remove(index) {
    const [marker] = this.list.splice(index, 1);
    if (this.byWeapon.get(marker.weapon) === marker) this.byWeapon.delete(marker.weapon);
    this.onRemove?.(marker);
  }
}

/**
 * The gunner's camera while it looks through a marker: `toggleScoutCamera`
 * (SPOT-10) and view mode 17 (SPOT-7, SPOT-11).
 *
 * `host` is the seat's camera as the page keeps it: `save()` answers
 * whatever `restore(saved)` needs to put the view mode and field of view
 * back. The class holds the extern matrix, the look-at point and the id of
 * the marker being looked through.
 */
export class ScoutView {
  constructor(host = {}) {
    this.host = host;
    /** The marker being looked through (`+0x8`), null when the view is off. */
    this.markerId = null;
    this.matrix = null;
    this.lookAt = null;
    this.saved = null;
  }

  get on() { return this.markerId != null; }

  /**
   * Turn the view on at `marker`. `externTrace` is whether the seat's camera
   * enables mode 17 (`CVMExternTrace`). The mode and the field of view are
   * saved unless the view is already on. False, with nothing recorded, when
   * the camera refuses: no ExternTrace camera, or a matrix at the origin.
   */
  turnOn(marker, { externTrace = true } = {}) {
    const position = marker.matrix.position;
    const atOrigin = position[0] === 0 && position[1] === 0 && position[2] === 0;
    if (!externTrace || atOrigin) return false;
    if (!this.on) this.saved = this.host.save?.() ?? null;
    this.matrix = marker.matrix;
    this.lookAt = add(position, scale(marker.matrix.forward, LOOK_AHEAD));
    this.markerId = marker.id;
    return true;
  }

  /** Turn the view off and put the saved mode and field of view back. A
   *  no-op while it is off, and outside an `artPos` seat (`inArtPos`), where
   *  the engine returns with the id still set. */
  turnOff({ inArtPos = true } = {}) {
    if (!this.on || !inArtPos) return false;
    this.host.restore?.(this.saved);
    this.saved = null;
    this.matrix = null;
    this.lookAt = null;
    this.markerId = null;
    return true;
  }

  /** The seat is gone (the gunner left it or died): the view goes with the
   *  camera that held it. Nothing is restored; the seat's camera is no
   *  longer the player's. */
  drop() {
    this.saved = null;
    this.matrix = null;
    this.lookAt = null;
    this.markerId = null;
  }

  /**
   * One call of `Camera::getTransformation` in mode 17: the look-at point
   * moves `LOOK_EASE` of the way toward `trace`, the position of the seat's
   * latest shell, or with none toward the eye + 20 along the marker's
   * forward. Answers the camera's `{ position, target, up }`.
   */
  step(trace = null) {
    if (!this.on) return null;
    const eye = this.matrix.position;
    const goal = trace ?? add(eye, scale(this.matrix.forward, LOOK_AHEAD));
    this.lookAt = add(this.lookAt, scale(sub(goal, this.lookAt), LOOK_EASE));
    return { position: eye, target: this.lookAt, up: this.matrix.up };
  }
}

/**
 * The client's scout selector (0x006a65b0, 0x006a66b0, 0x006a6a80,
 * 0x006a6b80; SPOT-8, SPOT-9, SPOT-12).
 *
 * `ctx` is asked afresh on every call, because all of it can change under
 * the gunner:
 *
 *   artPos        is the local seat an `artPos` PlayerControlObject
 *   externTrace   does its camera enable mode 17
 *   team          the local player's team
 *   teamOf(id)    a player's current team, null for nobody
 *   now           the game clock, seconds
 *
 * Two team tests, as the client has them: the gate and the selector's "on"
 * read the owner's current team, next / previous and the first pick read the
 * team stored on the marker.
 */
export class ScoutSelector {
  constructor(cameras, view, ctx) {
    this.cameras = cameras;
    this.view = view;
    this.ctx = ctx;
    /** `+0x104`: the selected marker's id. */
    this.selected = null;
    /** `+0x10c`: set when the selector turned the view on, whatever the
     *  camera answered. */
    this.viewing = false;
    /** The "Scout: <name>" line's marker, null when none is shown. */
    this.line = null;
    /** Counts the fades asked for (`Camera/CameraFade = 1`). */
    this.fades = 0;
    const previous = cameras.onRemove;
    cameras.onRemove = marker => {
      previous?.(marker);
      this.markerRemoved(marker);
    };
  }

  /** May this seat use markers at all (0x006a65b0): an `artPos` seat, and a
   *  marker whose owner is on the gunner's team now. */
  gate() {
    const c = this.ctx();
    if (!c.artPos) return false;
    return this.cameras.list.some(m => {
      const team = c.teamOf(m.owner);
      return team != null && team === c.team;
    });
  }

  /** The press of `c_PIAltFire`. True when the selector took it. */
  toggle() {
    if (!this.gate()) return false;
    this.fades++;
    this.#select(true);
    return true;
  }

  /** `c_PINextItem` (`dir` +1) or `c_PIPrevItem` (-1). False when the gate
   *  is shut, so the key keeps its usual meaning. */
  step(dir) {
    if (!this.gate()) return false;
    const c = this.ctx();
    const list = this.cameras.list;
    if (this.selected == null) {
      // Next takes the newest, previous the oldest, and only a marker whose
      // stored team is the gunner's.
      const pick = dir > 0 ? list[0] : list[list.length - 1];
      if (!pick || pick.team !== c.team) return true;
      this.selected = pick.id;
    } else {
      const index = list.findIndex(m => m.id === this.selected && m.team === c.team);
      // An enemy's marker selected, or a selection that is gone: the keys
      // stall until alt-fire clears it.
      if (index < 0) return true;
      if (list.length === 1) return true;
      // The neighbour, wrapping, with no look at whose it is.
      this.selected = list[(index + dir + list.length) % list.length].id;
    }
    this.fades++;
    this.#select(false);
    return true;
  }

  #select(toggle) {
    const c = this.ctx();
    const marker = this.selected != null
      ? this.cameras.byId(this.selected)
      : this.cameras.list.find(m => m.team === c.team) ?? null;
    const off = (toggle && this.viewing) || !marker
      || this.cameras.remaining(marker, c.now) < 0;
    if (off) {
      this.#off(c);
      return;
    }
    const team = c.teamOf(marker.owner);
    if (team == null || team !== c.team) return;
    this.selected = marker.id;
    this.line = marker.id;
    // The toggle's answer is ignored: the line shows and the flag is set
    // even where the camera refuses the mode.
    this.view.turnOn(marker, { externTrace: c.externTrace });
    this.viewing = true;
  }

  #off(c) {
    this.view.turnOff({ inArtPos: c.artPos });
    this.selected = null;
    this.viewing = false;
    this.line = null;
  }

  /** A marker left the list (`checkIfLocalPlayersArtCameraIsRemoved`): the
   *  view through that marker ends. The selection is not touched here;
   *  `frame` clears it. */
  markerRemoved(marker) {
    if (this.view.markerId !== marker.id) return;
    this.view.turnOff({ inArtPos: this.ctx().artPos });
  }

  /**
   * Once a frame (the map update's share, 0x006a7960): the countdown under
   * the scout line. When the selected marker's whole seconds reach 0 the
   * selection is cleared and the view turned off. A selection whose marker
   * has left the list is cleared the same way.
   *
   * Answers the whole seconds left on the line, 0 with none.
   */
  frame() {
    const c = this.ctx();
    if (this.line == null) return 0;
    const marker = this.cameras.byId(this.line);
    const seconds = marker ? Math.floor(this.cameras.remaining(marker, c.now)) : 0;
    if (seconds > 0) return seconds;
    this.#off(c);
    return 0;
  }

  /** The gunner left the seat: nothing of the selector's follows him. */
  leaveSeat() {
    this.view.drop();
    this.selected = null;
    this.viewing = false;
    this.line = null;
  }
}

// --- the gunner's HUD (SPOT-13) ------------------------------------------------

/** The markers an `artPos` seat's HUD knows about: the gunner's team's (the
 *  team stored on the marker) with life left. */
export function teamMarkers(cameras, team, now) {
  return cameras.list.filter(m => m.team === team && cameras.remaining(m, now) > 0);
}

/** `CameraPlaced` flips between 1 and 2 every 1.5 s while a marker is
 *  available: which of `Icon_scout_1` / `Icon_scout_2` is up at `t`. */
export const SCOUT_ICON_PERIOD = 1.5;
export function scoutIconFrame(t) {
  return 1 + (Math.floor(t / SCOUT_ICON_PERIOD) % 2);
}

/** The viewed marker's minimap wedge under `Game.setCameraBlink a b`: hidden
 *  for `a` seconds, alpha 0.6 until `b`, then round again. */
export const WEDGE_BLINK_ALPHA = 0.6;
export function wedgeBlinkAlpha(t, blink = [0.75, 1.5]) {
  const [hidden, period] = blink;
  if (!(period > 0)) return WEDGE_BLINK_ALPHA;
  const phase = ((t % period) + period) % period;
  return phase < hidden ? 0 : WEDGE_BLINK_ALPHA;
}

/** The compass heading of a marker's gaze, radians clockwise from north,
 *  from its forward's east and north parts. */
export function gazeHeading(east, north) {
  return Math.atan2(east, north);
}

/** The scout view's opening fade (`Camera/CameraFadeAlpha`): black at once,
 *  held 0.5 s, then clear over 2.5 s. `t` is seconds since it was asked. */
export const FADE_HOLD = 0.5;
export const FADE_TIME = 2.5;
export function fadeAlpha(t) {
  if (!(t >= 0)) return 0;
  if (t <= FADE_HOLD) return 1;
  return Math.max(0, 1 - (t - FADE_HOLD) / FADE_TIME);
}

/** The scout line: lexicon `SCOUT`, `": "`, the spotter's name. */
export function scoutLine(name, strings = null) {
  return `${strings?.SCOUT ?? 'Scout'}: ${name ?? ''}`;
}

/** The gunners' chat line for a new teammate marker (SPOT-5): the name, the
 *  lexicon's `CALLED_FOR_ARTILLERY` (which ends "(timeleft"), the seconds. */
export function calledLine(name, seconds, strings = null) {
  const words = strings?.CALLED_FOR_ARTILLERY ?? 'called for artillery (timeleft';
  return `${name ?? ''} ${words}: ${Math.max(0, Math.floor(seconds))})`;
}

/** The `artPos` seat's table entry for a seat's template name, or null.
 *  `table` is `_shared/vehicle-spotting.json`. */
export function artSeat(table, seatTemplate) {
  if (!table || !seatTemplate) return null;
  const name = String(seatTemplate).toLowerCase();
  return table.seats?.find(s => String(s.seat).toLowerCase() === name) ?? null;
}
