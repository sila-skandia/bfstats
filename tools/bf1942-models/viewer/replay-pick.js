// What is under the pointer in the replay's 3D view (features/replay-creator-
// view): a soldier, a vehicle, a round in flight. Found in screen space, not
// by casting rays into meshes: a skinned body's triangles are not where its
// bind pose left them, a round is a few millimetres across, and a fast one is
// never under the pointer for more than a frame. Each thing is a sphere
// about its middle, seen at least a few pixels wide, and the pointer picks
// the one it is deepest inside, nearer ones first, rounds before anything
// they fly past.

import * as THREE from 'three';
import { hullRadius } from './replay-camera.js';
import { positionAt, thrownLifeOf } from './replay-recording.js';

/** Pixels a thing is at least as wide as, to a pointer: a man far off, a
 *  round. */
const MIN_PX = { soldier: 10, hull: 14, round: 16 };
/** A body's middle over his feet, and how far round it he is, metres. */
const BODY = { stand: [0.95, 0.8], crouch: [0.6, 0.7], prone: [0.25, 0.9] };
/** Rounds are asked for before what they pass. */
const ROUND_FIRST = 0.35;

const _v = new THREE.Vector3();
/** Metres a second a recorded round must move at to be one in flight (a mine
 *  laid, a knife stuck in a wall, lies still). */
const FLYING = 3;

/** `pos` on the screen: `{ x, y, depth }` in pixels from the view's corner
 *  and metres in front of the camera, or null behind it or off the view. */
export function project(pos, camera, width, height) {
  _v.copy(pos).applyMatrix4(camera.matrixWorldInverse);
  const depth = -_v.z;
  if (!(depth > camera.near)) return null;
  _v.applyMatrix4(camera.projectionMatrix);
  const x = (_v.x + 1) * 0.5 * width;
  const y = (1 - _v.y) * 0.5 * height;
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < -width || x > 2 * width || y < -height || y > 2 * height) return null;
  return { x, y, depth };
}

/** Pixels a metre is, `depth` metres out, on a view `height` pixels high. */
export function pixelsPerMetre(camera, height, depth) {
  const focal = (height / 2) / Math.tan((camera.fov * Math.PI) / 360);
  return focal / Math.max(depth, 1e-3);
}

/**
 * Of `candidates` (`{ kind, pos, radius }` and whatever else the caller
 * keeps), the one the pointer at (`x`, `y`) picks on a view `width` x
 * `height`: `{ cand, x, y, r, depth }` (its screen middle and radius), or null.
 * A candidate's own `bonus` asks for it ahead of the others under the
 * pointer: the creator marks the round of a burst that kills with one, so a
 * machine gun's wall of tracers does not bury it.
 */
export function pickAt(candidates, camera, x, y, width, height) {
  let best = null;
  for (const cand of candidates) {
    const at = project(cand.pos, camera, width, height);
    if (!at) continue;
    const r = Math.max(MIN_PX[cand.kind] ?? 10, cand.radius * pixelsPerMetre(camera, height, at.depth));
    const d = Math.hypot(at.x - x, at.y - y);
    if (d > r) continue;
    const score = d / r + at.depth * 0.0004 - (cand.kind === 'round' ? ROUND_FIRST : 0) - (cand.bonus ?? 0);
    if (!best || score < best.score) best = { cand, x: at.x, y: at.y, r, depth: at.depth, score };
  }
  return best;
}

/**
 * Everything in the replay a pointer can pick now: living soldiers on foot,
 * drawn vehicles (crewed or not), and the page's rounds in flight that are
 * drawn. `{ kind: 'soldier', pid, name, team, pos, radius }`, `{ kind:
 * 'hull', hull, life, crew, pos, radius }`, `{ kind: 'round', obj, tracer,
 * pos, radius }`.
 */
export function pickCandidates(player) {
  const out = [];
  for (const actor of player.soldiers?.drawn ?? []) {
    if (actor.state?.dead || actor.seat || !actor.state?.soldier) continue;
    const s = actor.state.soldier;
    const [lift, radius] = BODY[actor.stance] ?? BODY.stand;
    out.push({ kind: 'soldier', pid: actor.pid, name: actor.name, team: actor.team,
               pos: new THREE.Vector3(s.x, s.y + lift, s.z), radius });
  }
  for (const hull of player.hulls?.values() ?? []) {
    if (!hull.group?.visible || hull.ghost) continue;
    const r = hullRadius(hull);
    const pos = hull.root.getWorldPosition(new THREE.Vector3());
    pos.y += r * 0.2;
    out.push({ kind: 'hull', hull, life: hull.life, crew: hull.crew ?? [], pos, radius: Math.max(1.5, r * 0.7) });
  }
  // The server's own rounds, which the page draws from the recording and
  // never flies (replay-flights.js, replay-props.js): a Natter's rocket, a
  // flak shell, a grenade, a thrown knife. They are not in the page's guns,
  // so a click on one found nothing and its bullet cam could not start.
  for (const [flight, shown] of player.flights?.live ?? []) {
    if (!shown?.node?.visible) continue;
    out.push({ kind: 'round', obj: null, life: flight, flight: true, tracer: false, shot: flight.shot ?? false,
               pos: shown.node.position.clone(), radius: 0.8 });
  }
  const t = player.time;
  for (const prop of player.props?.props ?? []) {
    const life = prop.life;
    if (!life?.projectile || !prop.node?.visible || !movingAt(life, t)) continue;
    out.push({ kind: 'round', obj: null, life, flight: false, tracer: false, shot: shotOfThrown(player.rec, life, t),
               pos: prop.node.position.clone(), radius: 0.8 });
  }
  const guns = player.ctx.guns;
  if (guns) {
    for (const obj of guns.projectiles ?? []) {
      if (!obj.mesh?.visible) continue;
      out.push({ kind: 'round', obj, tracer: false, pos: obj.mesh.position.clone(), radius: 0.6 });
    }
    for (const obj of guns.tracers ?? []) {
      if (!obj.mesh?.visible) continue;
      const pos = obj.mesh.position.clone();
      const v = obj.velocity;
      const n = v?.length?.() ?? 0;
      if (n > 1e-6 && obj.lead) pos.addScaledVector(v, obj.lead / n);
      out.push({ kind: 'round', obj, tracer: true, pos, radius: 0.4 });
    }
  }
  return out;
}

/** Whether recorded round `life` is moving at `t` (not lying where it was
 *  laid or stuck where it struck). */
function movingAt(life, t) {
  const a = positionAt(life, t);
  const b = positionAt(life, Math.max(life.created, t - 0.1));
  if (!a || !b) return false;
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) > FLYING * 0.1;
}

/** How far back, seconds, the shot of a round in the air may lie. */
const THROW_BACK = 8;

/**
 * The recorded shot that threw round `life` (a grenade, a thrown knife, a
 * rifle grenade the server flies as an object of its own), as of `t`, or
 * false: the latest shot up to `t`, within THROW_BACK of it, whose recorded
 * throw is this object (`thrownLifeOf`). A pooled round serves many throws,
 * so the object alone does not name the shot.
 */
export function shotOfThrown(rec, life, t) {
  const fires = rec?.fires ?? [];
  let lo = 0;
  let hi = fires.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (fires[mid].t <= t) lo = mid + 1;
    else hi = mid;
  }
  for (let i = lo - 1; i >= 0 && fires[i].t >= t - THROW_BACK; i--) {
    const f = fires[i];
    if (f.press || !Array.isArray(f.pos)) continue;
    if (thrownLifeOf(rec, f)?.life === life) return f;
  }
  return false;
}

/**
 * The recorded shot a live round came from: the latest of `fires` in the
 * last `window` seconds before `t` leaving within 4 m of where it did along
 * its heading (view frame; the recording's is BF1942's, z negated), or null.
 */
export function shotOfRound(fires, obj, t, window = 4) {
  const v = obj?.velocity;
  const n = v?.length?.() ?? 0;
  const o = obj?.origin;
  if (!(n > 1e-6) || !o) return null;
  let lo = 0;
  let hi = fires.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (fires[mid].t <= t) lo = mid + 1;
    else hi = mid;
  }
  let best = null;
  for (let i = lo - 1; i >= 0 && fires[i].t >= t - window; i--) {
    const f = fires[i];
    if (f.press || !Array.isArray(f.pos) || !Array.isArray(f.dir)) continue;
    const m = Math.hypot(f.dir[0], f.dir[1], f.dir[2]);
    if (!(m > 1e-6)) continue;
    const dot = (v.x * f.dir[0] + v.y * f.dir[1] - v.z * f.dir[2]) / (n * m);
    if (dot < 0.99) continue;
    const d = Math.hypot(o[0] - f.pos[0], o[1] - f.pos[1], o[2] + f.pos[2]);
    if (d > 4) continue;
    const score = d + (1 - dot) * 50;
    if (!best || score < best.score) best = { f, score };
  }
  return best?.f ?? null;
}
