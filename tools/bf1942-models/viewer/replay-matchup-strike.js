// Where a recorded round struck a replayed hull, for the match-up
// (features/replay-matchup, "Where each round struck").
//
// A client recording never says where on a hull a round landed: it has the
// round as it left (`f`: where, which way, which gun) and the hull's hit
// points as they changed (`a`). So the round is flown again, on the server's
// law (tank-ballistics.js: muzzle speed plus the firing hull's own velocity,
// FA-23's lift, IMP-8's first tick without gravity), into the struck hull's
// collision faces as the recording had them when the round got there: the
// hull's root where it was at that moment, its turret and gun at their
// recorded angles (`ReplayHull.applyJoints`). The face it meets is priced on
// the engine's direct-hit law (DMG-3, DMG-4: `materialDamage x damageMod x
// angleFactor`, the tank school's `tank-armour.js` arithmetic) and checked
// against the recorded drop:
//
// - `matched`: the face's price is the drop (within a tenth, or no less than
//   it when the round killed);
// - `solved`: it was not, and a face within half a metre of the path is: the
//   round is put there (a hull drawn from 10 Hz samples, a gun's spread);
// - `unexplained`: no face near the path costs the drop (a blast, two rounds
//   in one sample), the first face kept;
// - `glanced`: a round with no drop that met the hull: a plate its gun cannot
//   hurt, or one the recording saw do nothing;
// - `approximate`: the path never met the faces; the nearest face to where it
//   passed is taken.
//
// The cast works in the hull's own frame: its faces are posed once per
// quarter second of its moving parts (`HullCaster.facesAt`), and each round's
// path is carried into that frame by the root's recorded pose at its arrival.
// The live hull is posed for that and put back before the frame draws.

import * as THREE from 'three';
import { CATCHER, angleModOf, blastOf, pricer } from './tank-armour.js';
import { angleFactor } from './crash-damage.js';
import { distanceMod } from './armour-damage.js';
import { motionAt, poseAt } from './replay-kinematics.js';
import { GRAVITY } from './physics.js';
import { TICK, ROOT_LIFT } from './tank-ballistics.js';
import { bare } from './replay-matchup.js';

/** Seconds of flight either side of the expected arrival a round is flown. */
const FLY_SPAN = 0.45;
/** Seconds a step of the flight. */
const FLY_STEP = 1 / 240;
/** How close a face's price must come to the recorded drop. */
const MATCH_SHARE = 0.1;
const MATCH_FLOOR = 0.6;
/** The offsets a round is tried at when its own path's face does not
 *  explain the drop: a grid this far either side, this fine. */
const SOLVE_REACH = 0.5;
const SOLVE_STEP = 0.125;
/** Seconds of the moving parts' pose one set of faces stands for. */
const POSE_BUCKET = 0.25;

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _ray = new THREE.Ray();
const _hit = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3(1, 1, 1);

/** The material tables the round is priced with: the level's own (the
 *  page's guns hold them), else the models tree's `damage.json`. */
export function tablesOf(player) {
  const guns = player.ctx?.guns;
  if (guns?.materials && guns?.modifiers) return { materials: guns.materials, modifiers: guns.modifiers };
  return player.hud?.damageTables ?? null;
}

const viewVector = v => [v[0], v[1], -v[2]];

/**
 * The gun a round left: `{ name, material, damage, speed, gravity, ttl,
 * falloff, label }`. A hull's guns are read off its own model (the FireArms
 * node of the round's weapon, the projectile the assembler resolved for it);
 * a soldier's off the weapon table (`damage.json`). Null when neither names
 * the weapon.
 */
export function gunSpecOf(player, shooter, weapon) {
  const key = bare(weapon);
  if (!key) return null;
  const cache = (player.matchupGuns ??= new Map());
  const id = `${shooter?.tmpl ?? ''}|${key}`;
  if (cache.has(id)) return cache.get(id);
  let spec = null;
  const model = shooter && !shooter.soldier ? player.hullModels?.get(shooter.tmpl)?.normal : null;
  let fa = null;
  model?.traverse(o => {
    if (fa || !o.userData?.fireArms || bare(o.name) !== key) return;
    fa = o.userData.fireArms;
  });
  const table = player.hud?.weaponTable?.()?.get(key) ?? null;
  if (fa) {
    const projectile = fa.projectile ?? {};
    let material = Number.isFinite(projectile.material) ? projectile.material : null;
    if (material === null) material = player.ctx?.guns?.attackerMaterial?.(projectile) ?? table?.material ?? null;
    spec = {
      name: weapon,
      material,
      damage: projectile.damage ?? null,
      speed: Number(fa.velocity) > 0 ? Number(fa.velocity) : table?.speed ?? null,
      gravity: Number.isFinite(Number(projectile.gravity)) ? Number(projectile.gravity) : 1,
      ttl: Number(projectile.timeToLive) || table?.life || null,
      falloff: table,
    };
  } else if (table) {
    spec = { name: weapon, material: table.material, damage: null, speed: table.speed, gravity: 1, ttl: table.life, falloff: table };
  }
  // A weapon table not landed yet is asked again next time.
  if (!spec && !player.hud?.weaponTable?.()) return null;
  if (spec) spec.label = gunLabel(spec, tablesOf(player));
  cache.set(id, spec);
  return spec;
}

/** What to call a gun: its round's calibre where the mod names its
 *  materials so (FHSW's `75mmL37,5A`), else its template, tidied. */
export function gunLabel(spec, tables) {
  const label = String(tables?.materials?.[spec?.material]?.label ?? '');
  const calibre = /^(\d+(?:[.,]\d+)?)\s*mm\s*(L\s*\d+(?:[.,]\d+)?)?/i.exec(label);
  if (calibre) return `${calibre[1]} mm${calibre[2] ? ` ${calibre[2].replace(/\s+/g, '')}` : ''} gun`;
  const name = String(spec?.name ?? 'gun').replace(/_\d+$/, '')
    .replace(/GunBarrel$|Barrel$|_?Cannon$|Projectile$/i, '').replace(/[_-]+/g, ' ').trim();
  return name || 'gun';
}

/** A square hit's damage on `def` from `spec`'s round, `range` metres from
 *  where it was fired (falloff, DMG-3). */
export function priceOf(spec, tables, range = 0) {
  const price = pricer(tables, spec?.material);
  const k = spec?.falloff ? distanceMod(spec.falloff, range) : 1;
  return def => price(def) * k;
}

/** The round's flight, view frame: `at(dt)` where it is `dt` seconds after
 *  it left, `velocity(dt)` how it is moving. `platform` is the firing hull's
 *  velocity, which the round carries (FA-23). */
export function flightOf(f, spec, platform = null) {
  const o = viewVector(f.pos);
  const d = viewVector(f.dir);
  const n = Math.hypot(...d) || 1;
  const speed = spec?.speed > 0 ? spec.speed : 400;
  const gm = Number.isFinite(spec?.gravity) ? spec.gravity : 1;
  const g = GRAVITY * gm;
  const v = [d[0] / n * speed + (platform?.[0] ?? 0), d[1] / n * speed + (platform?.[1] ?? 0) + (gm > 0 ? ROOT_LIFT : 0),
    d[2] / n * speed + (platform?.[2] ?? 0)];
  const y = t => (!(gm > 0) ? v[1] * t : t <= TICK ? v[1] * t
    : 0.375 * g * TICK * TICK + (v[1] - 0.875 * g * TICK) * t + 0.5 * g * t * t);
  return {
    speed,
    at: (t, out = new THREE.Vector3()) => out.set(o[0] + v[0] * t, o[1] + y(t), o[2] + v[2] * t),
    velocity: (t, out = new THREE.Vector3()) => out.set(v[0], gm > 0 && t > TICK ? v[1] + g * t - 0.875 * g * TICK : v[1], v[2]),
  };
}

/** The nearest of `tris` along a segment from `p` to `q`: `{ tri, point,
 *  along }`, or null. */
function firstFace(tris, p, q) {
  _ray.origin.copy(p);
  _ray.direction.subVectors(q, p);
  const length = _ray.direction.length();
  if (!(length > 1e-6)) return null;
  _ray.direction.divideScalar(length);
  let best = null;
  for (const tri of tris) {
    if (!_ray.intersectTriangle(tri.a, tri.b, tri.c, false, _hit)) continue;
    const d = _hit.distanceTo(p);
    if (d > length || (best && d >= best.along)) continue;
    best = { tri, point: _hit.clone(), along: d };
  }
  return best;
}

/** Whether a predicted hit explains a recorded drop. */
function explains(damage, drop) {
  if (!drop) return false;
  if (drop.after <= 0 && damage >= drop.amount - MATCH_FLOOR) return true;
  return Math.abs(damage - drop.amount) <= Math.max(MATCH_FLOOR, drop.amount * MATCH_SHARE);
}

/**
 * One replayed hull as rounds meet it. `now` is the frozen moment the hull is
 * drawn at: the drawn root against the recorded one then is the offset its
 * drive puts between them, carried to every other moment.
 */
export class HullCaster {
  constructor(player, hull, now) {
    this.player = player;
    this.hull = hull;
    this.life = hull.life;
    this.buckets = new Map();
    hull.root.updateMatrixWorld(true);
    const was = poseAt(hull.life, now);
    this.offset = new THREE.Matrix4();
    if (was) {
      _m.compose(_p.set(was.p[0], was.p[1], was.p[2]), _q.set(was.q[0], was.q[1], was.q[2], was.q[3]), _s);
      this.offset.copy(hull.root.matrixWorld).multiply(_m.invert());
    }
    this.angleMod = angleModOf(hull.root);
  }

  /** The root's world matrix at `t`, as the hull would be drawn then. */
  rootAt(t, out = new THREE.Matrix4()) {
    const pose = poseAt(this.life, t);
    if (!pose) return out.copy(this.hull.root.matrixWorld);
    out.compose(_p.set(pose.p[0], pose.p[1], pose.p[2]), _q.set(pose.q[0], pose.q[1], pose.q[2], pose.q[3]), _s);
    return out.premultiply(this.offset);
  }

  /** The hull's collision faces in its root's frame, its moving parts posed
   *  as at `t` (to the quarter second): `{ tris, centre, radius, blast }`,
   *  each triangle with its material, its mesh and the matrix from the root's
   *  frame to the mesh's own. */
  facesAt(t, tables, spec) {
    const key = Math.round(t / POSE_BUCKET);
    let faces = this.buckets.get(key);
    if (!faces) {
      faces = this.pose(key * POSE_BUCKET);
      this.buckets.set(key, faces);
    }
    // The blast is priced from the root's own origin, which is the frame's.
    const blastKey = spec?.damage ? spec.name : null;
    if (blastKey && !faces.blasts.has(blastKey)) {
      faces.blasts.set(blastKey, this.withRootAtOrigin(() => blastOf(tables, spec.damage, this.hull.root)));
    }
    return { ...faces, blast: blastKey ? faces.blasts.get(blastKey) : null };
  }

  /** `fn` with the root put at its own frame's origin, then put back. */
  withRootAtOrigin(fn) {
    const root = this.hull.root;
    const saved = [];
    root.traverse(o => saved.push([o, o.position.clone(), o.quaternion.clone()]));
    try {
      root.position.set(0, 0, 0);
      root.quaternion.identity();
      root.updateMatrixWorld(true);
      return fn();
    } finally {
      for (const [o, p, q] of saved) { o.position.copy(p); o.quaternion.copy(q); }
      root.updateMatrixWorld(true);
    }
  }

  /** `fn` with the root put where the recording had it at `t` (its moving
   *  parts are posed from there: a v4 file's decoded aim is a world
   *  direction), then put back. */
  withRootAt(t, fn) {
    const root = this.hull.root;
    const saved = [];
    root.traverse(o => saved.push([o, o.position.clone(), o.quaternion.clone(), o.scale.clone()]));
    try {
      const world = this.rootAt(t);
      root.parent?.updateMatrixWorld(true);
      const local = root.parent ? root.parent.matrixWorld.clone().invert().multiply(world) : world;
      local.decompose(root.position, root.quaternion, root.scale);
      root.updateMatrixWorld(true);
      return fn();
    } finally {
      for (const [o, p, q, sc] of saved) { o.position.copy(p); o.quaternion.copy(q); o.scale.copy(sc); }
      root.updateMatrixWorld(true);
    }
  }

  pose(t) {
    const hull = this.hull;
    return this.withRootAt(t, () => {
      try { hull.applyJoints?.(t); } catch { /* a part the recording cannot place stays where it was */ }
      try { hull.applyAim?.(t); } catch { /* likewise */ }
      const root = hull.root;
      root.updateMatrixWorld(true);
      const toRoot = root.matrixWorld.clone().invert();
      const tris = [];
      const box = new THREE.Box3();
      root.traverse(mesh => {
        if (!mesh.isMesh || !mesh.geometry?.userData?.collision) return;
        for (let a = mesh; a; a = a.parent) if (CATCHER.test(a.name ?? '')) return;
        const pos = mesh.geometry.attributes?.position;
        if (!pos) return;
        const material = Number(mesh.geometry.userData.defenseMaterial);
        const toLocal = new THREE.Matrix4().multiplyMatrices(toRoot, mesh.matrixWorld);
        const toMesh = toLocal.clone().invert();
        const idx = mesh.geometry.index;
        const count = idx ? idx.count : pos.count;
        const at = i => new THREE.Vector3().fromBufferAttribute(pos, idx ? idx.getX(i) : i).applyMatrix4(toLocal);
        for (let i = 0; i + 2 < count; i += 3) {
          const a = at(i), b = at(i + 1), c = at(i + 2);
          const normal = new THREE.Vector3().crossVectors(_v.subVectors(b, a), _w.subVectors(c, a));
          if (normal.lengthSq() < 1e-12) continue;
          box.expandByPoint(a).expandByPoint(b).expandByPoint(c);
          tris.push({ a, b, c, normal: normal.normalize(), material: Number.isFinite(material) ? material : null, mesh, toMesh });
        }
      });
      const sphere = box.isEmpty() ? null : box.getBoundingSphere(new THREE.Sphere());
      return { tris, centre: sphere?.center ?? new THREE.Vector3(), radius: sphere?.radius ?? 0, blasts: new Map() };
    });
  }

  /**
   * Where round `r` (replay-matchup.js `roundsBetween`, with `drop` from
   * `assignDrops`) struck this hull. Returns `{ status, mesh, local, normal,
   * dirLocal, material, cos, damage, direct, blast, point, dir, offset }`
   * (`local`, `normal` and `dirLocal` in the struck mesh's own frame, `point`
   * and `dir` the world's at the round's arrival), or null when the round
   * never came near the faces.
   */
  strike(r, spec, tables) {
    if (!spec || !tables) return null;
    const faces = this.facesAt(r.arrival, tables, spec);
    if (!faces.tris.length) return null;
    const platform = r.shooter && !r.shooter.soldier ? motionAt(r.shooter, r.f.t)?.velocity ?? null : null;
    const flight = flightOf(r.f, spec, platform);
    const expected = Math.max(0, r.arrival - r.f.t);
    const world = this.rootAt(r.arrival);
    const toLocal = world.clone().invert();
    const price = priceOf(spec, tables, r.along ?? 0);
    const cost = (tri, dir, point) => {
      const cos = Math.abs(tri.normal.dot(dir));
      const direct = price(tri.material) * angleFactor(cos, this.angleMod);
      let blast = 0;
      if (faces.blast) blast = faces.blast(point, tri.normal.dot(dir) > 0 ? tri.normal.clone().negate() : tri.normal) ?? 0;
      return { cos, direct, blast, damage: direct + blast };
    };
    // Fly it through the window around its arrival, a step at a time, in the
    // hull's frame.
    const p = new THREE.Vector3();
    const q = new THREE.Vector3();
    let found = null;
    let closest = null;
    const reach = faces.radius + flight.speed * FLY_STEP;
    for (let t = Math.max(0, expected - FLY_SPAN); t < expected + FLY_SPAN; t += FLY_STEP) {
      flight.at(t, p).applyMatrix4(toLocal);
      const d = p.distanceTo(faces.centre);
      if (!closest || d < closest.d) closest = { d, t };
      if (d > reach) continue;
      flight.at(t + FLY_STEP, q).applyMatrix4(toLocal);
      const face = firstFace(faces.tris, p, q);
      if (face) { found = { ...face, t: t + face.along / flight.speed }; break; }
    }
    const dirAt = t => flight.velocity(t, new THREE.Vector3()).transformDirection(toLocal);
    let status = null;
    let offset = 0;
    let dir = dirAt(found?.t ?? closest?.t ?? expected);
    if (!found) {
      if (r.kind !== 'hit' || !closest) return null;
      // It never met a face: the nearest face to where it passed, cast at
      // from there toward the hull's middle.
      flight.at(closest.t, p).applyMatrix4(toLocal);
      const toward = new THREE.Vector3().subVectors(faces.centre, p).normalize();
      const face = firstFace(faces.tris, p.clone().addScaledVector(toward, -faces.radius),
        faces.centre.clone().addScaledVector(toward, faces.radius));
      if (!face) return null;
      found = { ...face, t: closest.t };
      dir = toward;
      status = 'approximate';
    }
    let paid = cost(found.tri, dir, found.point);
    if (!status) {
      if (r.kind !== 'hit') status = 'glanced';
      else if (!r.drop) status = 'unexplained';
      else if (explains(paid.damage, r.drop)) status = 'matched';
    }
    if (!status) {
      // A face within half a metre of the path that costs the drop: the
      // nearest such offset across the round's path.
      const across = new THREE.Vector3().crossVectors(dir, Math.abs(dir.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)).normalize();
      const up = new THREE.Vector3().crossVectors(across, dir).normalize();
      let best = null;
      const steps = Math.round(SOLVE_REACH / SOLVE_STEP);
      for (let i = -steps; i <= steps; i++) {
        for (let k = -steps; k <= steps; k++) {
          const off = Math.hypot(i, k) * SOLVE_STEP;
          if (off > SOLVE_REACH + 1e-6 || (best && off >= best.off)) continue;
          p.copy(found.point).addScaledVector(across, i * SOLVE_STEP).addScaledVector(up, k * SOLVE_STEP).addScaledVector(dir, -3);
          q.copy(p).addScaledVector(dir, 6);
          const face = firstFace(faces.tris, p, q);
          if (!face) continue;
          const c = cost(face.tri, dir, face.point);
          if (explains(c.damage, r.drop)) best = { off, face, cost: c };
        }
      }
      if (best) {
        found = { ...best.face, t: found.t };
        paid = best.cost;
        offset = best.off;
        status = 'solved';
      } else {
        status = 'unexplained';
      }
    }
    const tri = found.tri;
    return {
      status,
      mesh: tri.mesh,
      local: found.point.clone().applyMatrix4(tri.toMesh),
      normal: tri.normal.clone().transformDirection(tri.toMesh),
      dirLocal: dir.clone().transformDirection(tri.toMesh),
      material: tri.material,
      cos: Math.round(paid.cos * 1000) / 1000,
      damage: Math.round(paid.damage * 10) / 10,
      direct: Math.round(paid.direct * 10) / 10,
      blast: Math.round(paid.blast * 10) / 10,
      point: found.point.clone().applyMatrix4(world),
      dir: dir.clone().transformDirection(world),
      offset,
    };
  }
}
