// The control points' capture law: `ControlPoint::handleFrameUpdate`
// 0x08283b00 and the template settings it reads (ledger AI-100, AI-115,
// AI-142, FHR-1, FHR-4). Pure, with no imports, so the bot referee (solo
// play), the capture-ring estimate (`capture-rings.js`) and the lab's checks
// under node all run the one copy. Lifted out of bot-referee.js, which
// re-exports it.

/** A flag with no `timeToGetControl` of its own: the `ControlPointTemplate`
 *  ctor's 5.0 (+0x1f4, 0x08284774). */
export const CAPTURE_FALLBACK_SECONDS = 5;

/** A flag with no `radius` of its own: the `ControlPointTemplate` ctor's
 *  10.0 (+0x1dc, `movl $0x41200000,0x1dc(%ebx)` at 0x08284702; AI-115). */
export const CAPTURE_FALLBACK_RADIUS = 10;

/** A flag's capture radius: its template's, else the ctor's 10 m. An explicit
 *  0 stays 0 (`handleFrameUpdate`'s test is `distance <= +0x1dc`, so only a
 *  body exactly on the point is inside it). */
export function captureRadius(flag) {
  return Number.isFinite(flag?.radius) && flag.radius >= 0 ? flag.radius : CAPTURE_FALLBACK_RADIUS;
}

/**
 * INVENTION (the engine has no such figure; it is the bots' own, read by
 * strategic-ai.js `_captureRing` and bot-decision.js `fallbackRadius`): how
 * far from a flag a bot sent to take it may stop. The capture radius less a
 * body's radius (1 m), never under half of it: the bot's orders measure
 * across the ground and the law below in 3D, so the metre is also what keeps
 * a bot standing up to 3 m above or below a 5 m flag inside its ring.
 */
export const CAPTURE_STAND_MARGIN = 1.0;
/** INVENTION, with `captureStandRadius`: the smallest ring a bot is sent
 *  into, a body's radius. A narrower one cannot be held by walking. */
export const CAPTURE_STAND_MIN = 1.0;

/**
 * How far out, across the ground, a body stood `dy` metres under or over a
 * flag's pole is still inside its radius: the law below measures in 3D, so
 * the radius leaves sqrt(r^2 - dy^2) on that ground, and 0 where it does not
 * reach it. `dy` 0 (or unknown) is the radius itself.
 */
export function captureReach(flag, dy = 0) {
  const r = captureRadius(flag);
  if (!Number.isFinite(dy) || dy === 0) return r;
  const left = r * r - dy * dy;
  return left > 0 ? Math.sqrt(left) : 0;
}

/**
 * INVENTION (the stand radius above, cut by the ground). `dy` is the pole's
 * height over the ground the bot will stand on (0 when that is not known).
 * Where a body at the flat figure is inside the 3D radius the flat figure
 * stands, as it did before `dy` was read. Where it is not (the pole is on a
 * floor above the street, or in a pit under it) the ring is what the
 * geometry leaves on the ground, `captureReach`, less the same metre; and 0,
 * no ring to stand in, where that is under `CAPTURE_STAND_MIN` or the radius
 * does not reach the ground at all. The community map shigaisen_C stands six
 * 5 m flags on a floor 4.1 m over the street: 2.8 m of reach, a 1.8 m ring.
 */
export function captureStandRadius(flag, dy = 0) {
  const r = captureRadius(flag);
  const flat = Math.max(0.5 * r, r - CAPTURE_STAND_MARGIN);
  if (!Number.isFinite(dy) || Math.hypot(flat, dy) <= r) return flat;
  const stand = captureReach(flag, dy) - CAPTURE_STAND_MARGIN;
  return stand >= CAPTURE_STAND_MIN ? stand : 0;
}

/**
 * Seconds on a flag to take it: its `timeToGetControl`, else the fallback.
 * `ControlPoint::handleFrameUpdate` 0x08283b00 runs `gettingControl`
 * 0x08283f20 (the get timer +0x16c less the frame) only while the timer is
 * above 0 (`fldz; flds 0x16c; fxch; fucompp; test $0x1,%ah; jne` at
 * 0x08283c65..0x08283c76) and calls `gotControl` 0x08283f70 otherwise, the
 * same frame; `faildGettingControl` 0x08283ef0 and `control` reload the timer
 * from the template's +0x1f4 (AI-142). So a 0 is taken on the first frame one
 * side alone holds the point (DC Medina Ridge's `oasis_town`, `outpost_pass`
 * and `opposition_base`), and a negative value likewise.
 */
export function captureDuration(flag) {
  return Number.isFinite(flag?.timeToGetControl) ? flag.timeToGetControl : CAPTURE_FALLBACK_SECONDS;
}

/**
 * A flag's control-point settings: the level's where the scene carries them,
 * else the `ControlPointTemplate` ctor's (0x082846d0): `timeToGetControl`
 * +0x1f4 5.0, `timeToLoseControl` +0x1f8 5.0, `disableIfEnemyInsideRadius`
 * +0x1fc 0, `disableWhenLosingControl` +0x1fd 0, `loseControlWhenEnemyClose`
 * +0x1fe 1, `loseControlWhenNotClose` +0x1ff 0, `minNrToTakeControl` +0x204
 * 1, `onlyTakeableByTeam` +0x214 0. The four bytes are written by
 * ConsoleClass637..640 (0x083064e0, 0x083068f0, 0x08306d00, 0x08307110) in
 * the order the setters are registered from 0x082a1f62; `onlyTakeableByTeam`
 * +0x214 and `minNrToTakeControl` +0x204 are ConsoleClass649 / 650
 * (`executeObjectMethod` 0x083093d0, 0x083097e0), `unableToChangeTeam`
 * +0x200 ConsoleClass648 (0x08308fc0). The level exporter (`bf42/level.py`
 * `ControlPointTemplate`) carries every one of them, null where the level
 * keeps the ctor's value: vanilla sets `timeToLoseControl 10` on most flags
 * and `loseControlWhenEnemyClose 0` on 26 of 367.
 */
export function controlPointSettings(flag) {
  const num = (v, d) => (Number.isFinite(v) ? v : d);
  const flagOf = (v, d) => (v === undefined || v === null ? d : !!v);
  return {
    timeToGet: captureDuration(flag),
    timeToLose: num(flag?.timeToLoseControl, 5),
    disableIfEnemyInside: flagOf(flag?.disableIfEnemyInsideRadius, false),
    disableWhenLosing: flagOf(flag?.disableWhenLosingControl, false),
    loseWhenEnemyClose: flagOf(flag?.loseControlWhenEnemyClose, true),
    loseWhenNotClose: flagOf(flag?.loseControlWhenNotClose, false),
    minNr: num(flag?.minNrToTakeControl, 1),
    onlyTeam: num(flag?.onlyTakeableByTeam, 0),
  };
}

/**
 * One frame of `ControlPoint::handleFrameUpdate` 0x08283b00 for one flag.
 * `teams` lists the team of every living player inside its radius (the 3D
 * distance to the player's controlled object). The point keeps `flag.team`
 * (+0x174, 0 neutral), a lose timer (+0x168), a get timer (+0x16c), the
 * team getting it (+0x170) and a state (+0x17c: 1 lost, 2 losing, 3
 * getting, 4 held) in `flag._cp`. Returns `{ lost: team }` when the owner
 * loses it (`lostControl` 0x08284090: team 0), `{ got: team }` when a team
 * takes it (`gotControl` 0x08283f70), else null.
 *
 *  - A player of the owning team inside: with an attacker too and
 *    `loseControlWhenEnemyClose`, the lose timer runs (`losingControl`
 *    0x08284030) and at 0 the point is lost; else it is held
 *    (`control` 0x08283fe0 resets both timers).
 *  - Attackers of two teams and no owner's player: nothing changes.
 *  - Attackers of one team alone: an owned point runs its lose timer and is
 *    lost once it is spent, whatever the state (no state-2 test there); a neutral one, when no other team is getting it and at
 *    least `minNrToTakeControl` attackers are in, runs the get timer
 *    (`gettingControl` 0x08283f20) and is taken at 0; otherwise the timers
 *    reset (`faildGettingControl` 0x08283ef0).
 *  - Nobody: a neutral point resets; an owned one is lost over time only
 *    with `loseControlWhenNotClose` and no `onlyTakeableByTeam`, else held.
 *  `onlyTakeableByTeam` (+0x214) stops losing, getting and taking by any
 *  other team.
 *
 *  The point's spawns are switched as the engine switches them (ledger
 *  SPAWN-22): its enabled byte (+0x178) goes off through `CPDisable`
 *  0x08284200 and on through `CPEnable` 0x082840e0. Losing a point runs one
 *  or the other each frame, `CPDisable` with `disableWhenLosingControl`
 *  (+0x1fd); a contested point without `loseControlWhenEnemyClose` runs
 *  `control(attacker)`, `CPDisable`, with `disableIfEnemyInsideRadius`
 *  (+0x1fc); holding it runs `control(0)`, `CPEnable`; taking it enables and
 *  losing it disables. `flag.spawnsEnabled` carries the byte to the flag's
 *  groups (`spawn-flags.js`) and its pads (`level-statics.js`).
 */
export function controlPointStep(flag, teams, dt) {
  const cfg = controlPointSettings(flag);
  const cp = flag._cp ?? (flag._cp = { lose: cfg.timeToLose, get: cfg.timeToGet, getting: 0, state: 4 });
  const enable = on => { if (flag.spawnsEnabled !== on) flag.spawnsEnabled = on; };
  // `ControlPoint::setTeam` 0x08284490 returns at once when the template's
  // `unableToChangeTeam` byte (+0x200) is 1: `gotControl` and `lostControl`
  // still run (state, timers, `CPEnable` / `CPDisable`) and the team stays.
  // So such a point is run down to "lost" with its spawns off while an enemy
  // stands on it, and is switched back on when he leaves (FHR-4).
  const fixed = !!flag.uncapturable;
  const owner = flag.team ?? 0;
  let defended = false, attacker = 0, count = 0;
  for (const team of teams) {
    if (team === owner) { defended = true; continue; }
    if (attacker && team !== attacker) return null;       // two attacking teams: 0x08283b9d
    attacker = team;
    count++;
  }
  const allowed = team => !cfg.onlyTeam || cfg.onlyTeam === team;
  // `control(team)` 0x08283fe0: both timers back, state 4, then `CPEnable`
  // for 0 and `CPDisable` for a side.
  const hold = (by = 0) => {
    cp.state = 4; cp.get = cfg.timeToGet; cp.lose = cfg.timeToLose;
    enable(!by);
  };
  // `gated`: whether the spent timer needs state 2 before `lostControl`. The
  // defended-and-contested branch tests it (`cmpl $0x2,0x17c` at 0x08283ddb)
  // and so does the nobody branch (0x08283bd2); one side alone on an owned
  // point does not (0x08283c29 calls `lostControl` straight), so a point whose
  // lose timer is already spent (`timeToLoseControl 0`, bf1918 fao_landing's
  // `Fao_Beach`) falls on the first frame (AI-100).
  const losing = (team, gated = true) => {
    if (!allowed(team)) return null;
    if (cp.lose > 0) {
      cp.state = 2; cp.lose -= dt;
      enable(!cfg.disableWhenLosing);
      return null;
    }
    if (gated && cp.state !== 2) return null;
    cp.state = 1;
    enable(false);
    if (fixed) return null;
    flag.team = 0;
    return { lost: owner, by: team };
  };
  if (defended && owner) {
    if (attacker && cfg.loseWhenEnemyClose) return losing(attacker);
    hold(attacker && cfg.disableIfEnemyInside ? attacker : 0);
    return null;
  }
  if (attacker) {
    if (owner) return losing(attacker, false);
    if ((cp.getting === 0 || cp.getting === attacker) && count >= cfg.minNr) {
      if (!allowed(attacker)) return null;
      if (cp.get > 0) { cp.state = 3; cp.getting = attacker; cp.get -= dt; return null; }
      if (!fixed) flag.team = attacker;
      cp.getting = 0;
      // `gotControl` 0x08283f70: state 4, timers back, `setTeam`, `CPEnable`.
      hold();
      return fixed ? null : { got: attacker };
    }
    cp.getting = 0; cp.get = cfg.timeToGet; cp.lose = cfg.timeToLose;
    return null;
  }
  if (!owner) { cp.getting = 0; cp.get = cfg.timeToGet; cp.lose = cfg.timeToLose; return null; }
  if (cfg.loseWhenNotClose) {
    // Nobody inside: `losingControl` / `lostControl` take team -1
    // (0x08283bf0, 0x08283be1), which never equals a set `onlyTakeableByTeam`,
    // so a point with one cannot be run down this way (FHR-1).
    if (cfg.onlyTeam) return null;
    if (cp.lose > 0) {
      cp.state = 2; cp.lose -= dt;
      enable(!cfg.disableWhenLosing);
      return null;
    }
    if (cp.state !== 2) return null;
    cp.state = 1;
    enable(false);
    if (fixed) return null;
    flag.team = 0;
    return { lost: owner, by: null };
  }
  hold();
  return null;
}

/**
 * The closest flag `team` does not hold whose radius reaches `position`
 * (`[x, y, z]`), or null. `ControlPoint::handleFrameUpdate` 0x08283b00: the
 * 3D distance from the point to the player's controlled object (the hull,
 * when mounted) against the template radius (+0x1dc).
 */
export function nearestEnemyFlag(flags, team, position) {
  if (!position) return null;
  let nearest = null;
  let distance = Infinity;
  for (const flag of flags ?? []) {
    if (flag.uncapturable || !flag.position || flag.team === team) continue;
    const dx = position[0] - flag.position[0];
    const dz = position[2] - flag.position[2];
    const dy = Number.isFinite(position[1]) ? position[1] - flag.position[1] : 0;
    const d = Math.hypot(dx, dy, dz);
    if (d <= captureRadius(flag) && d < distance) {
      nearest = flag;
      distance = d;
    }
  }
  return nearest;
}
