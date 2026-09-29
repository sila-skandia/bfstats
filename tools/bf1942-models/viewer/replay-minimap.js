// The game's minimap in a replay (features/round-replay-minimap). In play the
// HUD map in the corner marks the reader's own side only (map-friendlies.js,
// map-vehicle-marks.js); a replay is nobody's side, so it marks both, each
// in the colour its own players see it in (map-surfaces.js
// `MINIMAP_TEAM_TINT`), and otherwise by the client's rules: a man on foot is
// an arrow turned to his heading, a crewed hull is its icon in its crew's
// colour and carries no second mark for the men inside, a hull nobody is in
// is grey, a wreck is not marked. The followed player is the ring, as the
// local player is in play, and the map is centred on him.
//
// The recording has only what the server sent the recording player: a man
// beyond the level's view distance is where it last had him, for a while
// (replay-battles.js `whereIs`), and is marked faded there. A hull nobody is
// in is marked only while the recording has it live.
//
// Pure, a function of the recording and the clock, so node tests it
// (tests/replay_minimap_harness.mjs).

import { headingAt } from './replay-battles.js';
import { hpAt, isReplicated, positionAt } from './replay-recording.js';

/** A wreck is not marked (the client draws a hull only while its Armor has
 *  hit points, map-vehicle-marks.js). A hull whose points the recording
 *  never had is taken to be whole. */
const wrecked = (life, t) => {
  const hp = hpAt(life, t);
  return hp !== null && hp <= 0;
};

/**
 * The minimap's marks at `t`: `{ focus, soldiers, hulls }`, positions in the
 * viewer's frame and headings as `[dx, dz]` on the ground (or null).
 *
 * - `where(pid, t)`: replay-battles.js `whereIs`, or the highlights' cached
 *   `model.where`.
 * - `pids`: everyone to place.
 * - `hullLives`: the hulls the replay draws; the empty ones among them are
 *   the grey marks.
 * - `followPid`: whose mark the ring is, or null when the camera is its own.
 *
 * `focus` is `{ x, z, dir }` for the followed player where the recording has
 * him live, else null (the page puts the ring on its camera). His own mark,
 * and his hull's when he is aboard one, is left out: the ring is it.
 * `soldiers` are `{ pid, x, z, dir, team, fresh }`, `hulls` `{ life, tmpl,
 * x, z, dir, team, fresh }` with `team` 0 for a hull nobody is in; `fresh`
 * false for a last sighting.
 */
export function minimapMarksAt(rec, t, { where, pids, hullLives = [], followPid = null }) {
  const soldiers = [];
  const crews = new Map();          // hull life -> its mark, crewed by the lowest seat's side
  let focus = null;
  let focusHull = null;
  for (const pid of pids) {
    const w = where(pid, t);
    if (!w.pos || (w.state !== 'foot' && w.state !== 'vehicle')) continue;
    const dir = headingAt(w.life, w.fresh ? t : w.seen);
    if (pid === followPid && w.fresh) {
      focus = { x: w.pos[0], z: w.pos[2], dir };
      if (w.state === 'vehicle') focusHull = w.life;
      continue;
    }
    if (w.state === 'foot') {
      soldiers.push({ pid, x: w.pos[0], z: w.pos[2], dir, team: w.team, fresh: w.fresh });
      continue;
    }
    const known = crews.get(w.life);
    if (known && known.seat <= w.seat) continue;
    if (wrecked(w.life, w.fresh ? t : w.seen)) continue;
    crews.set(w.life, { life: w.life, tmpl: w.life.tmpl, x: w.pos[0], z: w.pos[2], dir, team: w.team,
                        fresh: w.fresh, seat: w.seat });
  }
  const hulls = [];
  for (const [life, mark] of crews) {
    if (life === focusHull) continue;
    delete mark.seat;
    hulls.push(mark);
  }
  for (const life of hullLives) {
    if (crews.has(life) || life === focusHull) continue;
    if (!(t >= life.created && t < life.destroyed)) continue;
    if (life.killedAt !== undefined && t >= life.killedAt) continue;
    if (!isReplicated(life, t) || wrecked(life, t)) continue;
    const p = positionAt(life, t);
    if (!p) continue;
    hulls.push({ life, tmpl: life.tmpl, x: p[0], z: -p[2], dir: headingAt(life, t), team: 0, fresh: true });
  }
  return { focus, soldiers, hulls };
}

/** A ground heading `[dx, dz]` as the map surfaces' screen angle: 0 up the
 *  art (-Z), clockwise, the `atan2(x, -z)` the camera and the play marks go
 *  through (map-surfaces.js `cameraHeading`). */
export const mapAngle = dir => (dir ? Math.atan2(dir[0], -dir[1]) : 0);

/** A key that changes as the marks do, so the surface repaints on a step or a
 *  turn and not every frame (map-surfaces.js `mapSurfaceStale`). The heading
 *  is in it to a tenth of a radian, as the play marks' key has it. */
export function minimapMarksKey({ focus, soldiers, hulls }) {
  const one = m => `${Math.round(m.x)},${Math.round(m.z)},${Math.round(mapAngle(m.dir) * 10)}`;
  let key = focus ? `f${one(focus)};` : 'f;';
  for (const s of soldiers) key += `s${s.team}${s.fresh ? '' : '~'}${one(s)};`;
  for (const h of hulls) key += `h${h.team}${h.fresh ? '' : '~'}${h.tmpl},${one(h)};`;
  return key;
}
