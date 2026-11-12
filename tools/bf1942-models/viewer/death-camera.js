// The live page's death camera: retail's `FreeCamera` death camera, type 1
// (`Setup+0x484`, `game.serverDeathCameraType`, 1 in the shipped settings).
// Pure: no `three`, no DOM, so `tests/death_camera_harness.mjs` runs it under
// node. The replay's camera keeps its own rules (`replay-camera.js`).
//
// Read on lnxded (`FreeCamera::updateDeathCamera` 0x081b0350, `setDeathCamera`
// 0x081afce0, `followNextPlayer` 0x081b0150, `handleUpdate`), the Mac client's
// twin as the lead for the field names:
//
//   setDeathCamera(true, obj)  keeps obj's matrix (its position is the shot's
//     centre `P`), zeroes the clock, follows nobody. `GameServer::killPlayer`
//     hands it the dead player's controlled object: the soldier, or the seat
//     he died in.
//   handleUpdate  runs the clock by the frame's dt while it is not -1, and
//     never lets the camera under the terrain plus 1 m.
//   updateDeathCamera, nobody followed, t < 3 (0x86c08c8): the eye straight
//     over P at `sin(clamp(t / 3 * 3.14 * 0.5)) * 29 + 1` m (3.14 the double at
//     0x86c5298, 29 at 0x86c52a8, 1 at 0x86c52b0, the clamp +-1000), looking
//     straight down at P, its up axis `(cos t/2, 0, sin t/2)` (0.5 at
//     0x86b05e8): a shot that rises 1 m to 30 m while it turns. From 3 s to 5 s
//     it swings its aim toward the object at `+0x1b4`, which the death of the
//     player himself never names (setDeathCamera writes -1), so his shot holds
//     the 3 s frame, 30 m over his body.
//   t > 10 (0x86b9314) and nobody followed: `followNextPlayer(false)`.
//   followNextPlayer  walks the player list for the next player after the one
//     followed who is on his team (`BFPlayer+0x7c`), alive (`+0x79`), not an AI
//     (`getIsAIPlayer`, BFPlayer vt+0x5c = 0x08056120) and not himself
//     (`getId`, vt+0x48); with none after him, the first such; with none at
//     all, nobody. Bots are AI players: in single player he is never followed
//     past his own body.
//   following someone alive, the camera rides with them (a chase of their
//     root, the `chase-camera.js` law); someone gone, the next; someone dead,
//     `setDeathCamera(true, their object)`: their own shot from 0, and 10 s
//     later the next.
//   `c_PIToggleCameraMode` (input 26, C) on its press: `followNextPlayer`, and
//     with someone found the clock goes to 10 (`FreeCamera::handlePlayerInput`).
//   The HUD, while someone is followed: `CHASE CAMERA` (`DEATH_CAMERA_RIDING_WITH`)
//   with their name and `[NN%]` of their health, and the toggle key followed by
//   `TO TOGGLE BETWEEN PLAYERS` (`DEATH_CAMERA_TOGGLE`; `BfMenu::updateHud`).

export const DEATH_RISE_TIME = 3.0;
export const DEATH_RISE_SPAN = 29.0;
export const DEATH_RISE_BASE = 1.0;
/** The engine's own pi in the rise, 3.14 (the double at 0x86c5298). */
export const DEATH_RISE_PI = 3.14;
export const DEATH_SPIN_RATE = 0.5;
export const DEATH_FOLLOW_AFTER = 10.0;
export const DEATH_TERRAIN_CLEARANCE = 1.0;

const clamp1000 = v => Math.min(1000, Math.max(-1000, v));

/**
 * The shot over `at` (`{ x, y, z }`, the page's frame) at `t` seconds: the
 * eye, and the up axis on screen. The page's frame is the engine's with z
 * negated, so the engine's `(cos, 0, sin)` is `(cos, 0, -sin)` here. Past
 * 3 s the 3 s frame stands (nothing is named for the swing).
 */
export function deathShot(t, at, floorY = -Infinity, out = { eye: [0, 0, 0], up: [0, 0, 0] }) {
  const s = Math.min(Math.max(t, 0), DEATH_RISE_TIME);
  const rise = Math.sin(clamp1000((s / DEATH_RISE_TIME) * DEATH_RISE_PI * 0.5)) * DEATH_RISE_SPAN + DEATH_RISE_BASE;
  const turn = clamp1000(s * DEATH_SPIN_RATE);
  out.eye[0] = at.x;
  out.eye[1] = Math.max(at.y + rise, Number.isFinite(floorY) ? floorY + DEATH_TERRAIN_CLEARANCE : -Infinity);
  out.eye[2] = at.z;
  out.up[0] = Math.cos(turn);
  out.up[1] = 0;
  out.up[2] = -Math.sin(turn);
  return out;
}

/**
 * `followNextPlayer(backwards)`: the id to follow after `current` (-1 for
 * nobody) among `players`, the player list in its own order, each
 * `{ id, team, alive, ai }`. Returns `current` when nobody qualifies.
 */
export function nextFollowed(players, current, selfId, team, backwards = false) {
  const list = backwards ? [...players].reverse() : players;
  let first = -1;
  let passed = false;
  for (const p of list) {
    if (p.team !== team || !p.alive || p.ai || p.id === selfId) continue;
    if (p.id === current) { passed = true; continue; }
    if (first === -1) first = p.id;
    if (passed) return p.id;
  }
  return first !== -1 ? first : current;
}

/** A death camera on `at` (`setDeathCamera(true, obj)`). */
export function createDeathCamera(at) {
  return { t: 0, at: { x: at.x, y: at.y, z: at.z }, followed: -1 };
}

/**
 * One frame. `players()` is the list `nextFollowed` reads, plus each one's
 * `{ x, y, z }`; `selfId` and `team` are the dead player's. Returns the
 * followed player's row while the camera rides with someone, else null (the
 * shot is `deathShot(cam.t, cam.at)`).
 */
export function stepDeathCamera(cam, dt, players, selfId, team) {
  if (dt > 0) cam.t += dt;
  const list = players ?? [];
  if (cam.t > DEATH_FOLLOW_AFTER && cam.followed === -1) {
    cam.followed = nextFollowed(list, -1, selfId, team);
  }
  if (cam.followed === -1) return null;
  const row = list.find(p => p.id === cam.followed) ?? null;
  if (!row) {
    // Gone from the list: `followNextPlayer(false)` from the one he was.
    const next = nextFollowed(list, cam.followed, selfId, team);
    cam.followed = next !== cam.followed ? next : -1;
    return cam.followed === -1 ? null : list.find(p => p.id === cam.followed) ?? null;
  }
  if (!row.alive) {
    // Their death: their own shot, from 0, and nobody followed.
    cam.at = { x: row.x, y: row.y, z: row.z };
    cam.t = 0;
    cam.followed = -1;
    return null;
  }
  return row;
}

/** `c_PIToggleCameraMode` pressed while dead (the key's press, not its
 *  hold): the next teammate, and the clock to 10 with one found. */
export function toggleDeathCamera(cam, players, selfId, team) {
  const next = nextFollowed(players ?? [], cam.followed, selfId, team);
  cam.followed = next;
  if (next !== -1) cam.t = DEATH_FOLLOW_AFTER;
  return next !== -1;
}

/** The HUD's two lines while someone is followed, or null. */
export function deathCameraLines(row, strings = {}, key = 'C') {
  if (!row) return null;
  const hp = Number.isFinite(row.hp) && Number.isFinite(row.maxHp) && row.maxHp > 0
    ? Math.trunc((row.hp / row.maxHp) * 100) : -1;
  return {
    riding: `${strings.DEATH_CAMERA_RIDING_WITH ?? 'CHASE CAMERA'} ${row.name ?? ''}[${hp}%]`,
    toggle: `${key} ${strings.DEATH_CAMERA_TOGGLE ?? 'TO TOGGLE BETWEEN PLAYERS'}`,
  };
}
