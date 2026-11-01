// The server's own projectile flights, drawn where the server flew them
// (features/replay-feature-sweep-2026-11-01, entry 2).
//
// A client is sent only the networked rounds (grenades, mines, charges,
// binocular markers; round-replay-capture section 13), so a client's file has
// every shell and rocket only as the `f` that fired it, and the page flies
// its own from it. A server recording (features/server-replay-recorder)
// writes every flight as well: `pn` names it, `pj` places it each sample,
// `pd` ends it; `replay-recording.js` reads them into `rec.flights` and
// links each to its `f` and the `i` (the server's collision) that ended it
// (`linkFlights`). The page's own round could land somewhere else: it is
// fired again from the barrel as drawn, through the page's physics, against
// the page's colliders.
//
// So for every round the page would draw as a body -- a shell, a rocket, a
// bomb, the rounds `round-launch.js` `fireRound` gives `spawnProjectile` --
// the flight is drawn instead, along its recorded path, nose down its
// velocity, with the projectile mesh the gun's FireArms carries (in the
// hull's model, or the glb of the hand weapon its shot names), and the
// game's collision effect plays at the recorded collision (`struck`). The gun that fired it still flashes, sounds and
// kicks (`fireWithoutRound`), but lays no round of its own (`serverFlies`).
//
// Left to the page: bullets. The page's tracer streak and the hidden
// hit-test rounds between tracers come from its own round, and a server
// bullet is one to three samples long (and none when it hits inside one tick,
// server-replay-recorder Known gaps), so the page keeps firing those from `f`.
// The networked rounds stay `replay-props.js`'s: their objects are recorded
// too. A client's file has no flights, and nothing here runs for it.

import * as THREE from 'three';
import { positionAt } from './replay-recording.js';
import { trailOf } from './replay-props.js';
import { wearPagePaint } from './level-skin.js';
import { recoilSpan } from './gun-cycle.js';
import { impactEffect } from './collision-materials.js';
import { CG_PROJECTILES } from './static-index.js';
import { burstsAtEndOfLife } from './projectile-damage.js';

/** The round kinds the page draws as a flying body (`fireRound`). */
const BODY_KINDS = new Set(['shell', 'rocket']);
/** Seconds either side of a moment the heading is read over. */
const HEADING_SPAN = 1 / 60;
/** Seconds past a collision inside which a frame still plays its effect: a
 *  frame that jumps further (a seek, a stall) does not. */
const EFFECT_LATE = 0.5;
/** Metres either side of the recorded collision the page's colliders are
 *  cast along the round's last heading, for the surface it struck. */
const SURFACE_PROBE = 3;
/** The armour material a replayed hull answers a cast with
 *  (replay-gunfire.js `dynamicCast`). */
const HULL_MATERIAL = 61;

const _minusZ = new THREE.Vector3(0, 0, -1);
const _dir = new THREE.Vector3();
const _a = [0, 0, 0];
const _b = [0, 0, 0];

const lower = s => String(s ?? '').toLowerCase();
/** A FireArms node's name as a shot names its weapon: `Browning_2` is the
 *  `Browning`. */
const bareGun = name => lower(name).replace(/_\d+$/, '');

/** Whether a FireArms' projectile spec is drawn as a body. */
export const isBodyRound = spec => Boolean(spec) && typeof spec === 'object' && BODY_KINDS.has(spec.kind);

/**
 * Whether recorded shot `f`'s round is the server's flight for gun `group`
 * to fire without a round of its own: `f` has a flight (`linkFlights`) of
 * the round `group` fires, and that round is one the page would draw as a
 * body. A bullet's flight is not (the page draws bullets), nor a shot of a
 * client's file, which has none.
 */
export function serverFlies(group, f) {
  const flight = f?.flight;
  if (!flight || !group?.projectileMesh) return false;
  const spec = group.stats?.projectile;
  if (!isBodyRound(spec)) return false;
  return !spec.template || !flight.tmpl || lower(spec.template) === lower(flight.tmpl);
}

/**
 * One pull of `group` with its round left to the server's flight: what
 * `GunFire.fireShot` does besides launching it -- the magazine's charge
 * (`onShot`), the burst's sound state (SND-13), the barrel's kick (GUN-12)
 * and the muzzle's flash, smoke and casing (`guns.flash`, one barrel a
 * pull: the server writes one `f` per barrel).
 */
export function fireWithoutRound(guns, group) {
  guns.onShot?.(group, 1);
  group.sinceRound = 0;
  group.soundHeld = true;
  group.soundReleased = false;
  if (group.recoil != null) group.recoil = recoilSpan(group.stats.recoil);
  guns.flash(group);
}

/** `flight`'s place at `t` in the view's frame (BF1942's z turned), into
 *  `out`; null outside its path. */
export function flightAt(flight, t, out = [0, 0, 0]) {
  if (!flight?.keys || !(t >= flight.created) || t > flight.destroyed) return null;
  const p = positionAt(flight, t, out);
  if (!p) return null;
  p[2] = -p[2];
  return p;
}

/** `flight`'s heading at `t` in the view's frame, a unit THREE vector into
 *  `out`; false when it never moved. Where it stands still (a collision
 *  recorded on its last sample) the heading is the one it arrived with. */
export function flightHeading(flight, t, out) {
  const t1 = Math.min(flight.destroyed, t + HEADING_SPAN);
  for (let span = HEADING_SPAN; ; span *= 4) {
    const t0 = Math.max(flight.created, t - span);
    if (!(t1 > t0) || !flightAt(flight, t0, _a) || !flightAt(flight, t1, _b)) return false;
    out.set(_b[0] - _a[0], _b[1] - _a[1], _b[2] - _a[2]);
    const n = out.length();
    if (n > 1e-5) {
      out.divideScalar(n);
      return true;
    }
    if (t0 <= flight.created) return false;
  }
}

/**
 * The FireArms projectile spec for `tmpl` in `scene`, with its baked mesh,
 * when it is a body round: `{ mesh, spec }`, or null.
 */
function bodyRoundIn(scene, tmpl) {
  const want = lower(tmpl);
  let found = null;
  scene?.traverse(obj => {
    if (found) return;
    const spec = obj.userData?.fireArms?.projectile;
    if (!isBodyRound(spec) || lower(spec.template) !== want) return;
    let mesh = null;
    obj.traverse(child => { if (!mesh && child !== obj && child.userData?.projectileMesh) mesh = child; });
    if (mesh) found = { mesh, spec };
  });
  return found;
}

export class ReplayFlights {
  constructor(player) {
    this.player = player;
    this.sources = new Map();    // lower template -> { scene, endEffect, trail } | null, once resolved
    this.drawn = [];             // the flights drawn, by `created`
    this.longest = 0;            // the longest of them, seconds
    this.pool = new Map();       // lower template -> nodes put away
    this.live = new Map();       // flight -> { node, run }
    this.lastT = null;
  }

  /** Each flight template's mesh, from the hulls' models (`hulls`) or the
   *  hand weapon that fired it (the linked shots name it), and the flights it
   *  draws. Bullets, the networked rounds and a template with no body round
   *  are left out. */
  async load(hulls = []) {
    const flights = this.player.rec.flights ?? [];
    if (!flights.length) return 0;
    const networked = this.player.networkedRounds ?? new Set();
    const weapons = new Map();     // lower template -> the weapons its shots name
    for (const f of flights) {
      const tmpl = lower(f.tmpl);
      if (!tmpl || networked.has(tmpl)) continue;
      if (!weapons.has(tmpl)) weapons.set(tmpl, new Set());
      if (f.shot?.weapon) weapons.get(tmpl).add(f.shot.weapon);
    }
    // A hull's own guns are looked for in the hull, never fetched as a glb.
    const hullGuns = new Set();
    for (const hull of hulls) hull?.traverse?.(obj => { if (obj.userData?.fireArms && obj.name) hullGuns.add(bareGun(obj.name)); });
    await Promise.all([...weapons].map(async ([tmpl, named]) => {
      try {
        const hand = [...named].filter(w => !hullGuns.has(bareGun(w)));
        const source = await this.find(tmpl, hulls, hand);
        if (source) this.sources.set(tmpl, source);
      } catch (error) {
        console.warn(`replay: the server's ${tmpl} rounds left undrawn`, error);
      }
    }));
    this.collect();
    return this.drawn.length;
  }

  /** The flights whose template has a mesh, in order. */
  collect() {
    this.drawn = (this.player.rec.flights ?? []).filter(f => this.sources.get(lower(f.tmpl)));
    this.longest = 0;
    for (const f of this.drawn) {
      // The round cam and the creator ride a drawn flight (replay-roundcam.js).
      f.drawn = true;
      this.longest = Math.max(this.longest, f.destroyed - f.created);
    }
  }

  async find(tmpl, hulls, weapons = []) {
    for (const hull of hulls) {
      const round = bodyRoundIn(hull, tmpl);
      if (round) return this.dress(round, hull);
    }
    // The hand weapon's glb, as the soldiers hold it (one fetch for both).
    for (const weapon of weapons) {
      const hand = await this.player.soldiers?.handGun?.(weapon);
      const round = bodyRoundIn(hand?.scene, tmpl);
      if (round) return this.dress(round, hand.scene);
    }
    return null;
  }

  /**
   * A gun that fires a body round the load found no mesh for (a hull whose
   * model names its round some other way): its own baked round draws the
   * template's flights from now on.
   */
  adopt(group) {
    const spec = group?.stats?.projectile;
    const tmpl = lower(spec?.template);
    if (!tmpl || this.sources.get(tmpl) || !group.projectileMesh || !isBodyRound(spec)) return;
    const source = { scene: null, spec, endEffect: spec.endEffect ?? null, trail: spec.trailBundle ?? null };
    this.sources.set(tmpl, source);
    void this.dress({ mesh: group.projectileMesh, spec }, null).then(made => {
      Object.assign(source, made);
      this.collect();
    }).catch(() => this.sources.delete(tmpl));
  }

  /**
   * A drawable copy of a round's mesh, its nose down -Z (the baked body is
   * Z-mirrored like every vehicle mesh): a mesh baked turned keeps its turn
   * inside a holder, as `spawnProjectile` keeps it. In the level's paint.
   */
  async dress({ mesh, spec }, scene) {
    const inner = mesh.clone(true);
    inner.position.set(0, 0, 0);
    inner.scale.set(1, 1, 1);
    inner.visible = true;
    inner.traverse(obj => { obj.visible = true; });
    const holder = new THREE.Group();
    holder.add(inner);
    this.player.ctx.shadeModel?.(holder);
    await wearPagePaint(holder);
    const trail = spec.trailBundle ? String(spec.trailBundle) : scene ? trailOf(scene, spec.template) : null;
    return { scene: holder, spec, endEffect: spec.endEffect ?? null, trail };
  }

  nodeFor(tmpl) {
    const spare = this.pool.get(tmpl)?.pop();
    if (spare) return spare;
    const node = this.sources.get(tmpl).scene.clone(true);
    node.name = `replay server round ${tmpl}`;
    this.player.root.add(node);
    return node;
  }

  /** The index of the first drawn flight created after `t`. */
  firstAfter(t) {
    const list = this.drawn;
    let lo = 0;
    let hi = list.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid].created > t) hi = mid;
      else lo = mid + 1;
    }
    return lo;
  }

  /** The frame at recording time `t`: every flight in the air drawn, and the
   *  end effect of every one that struck since the last frame, when the
   *  replay played forward across it. */
  update(t) {
    const prevT = this.lastT;
    this.lastT = t;
    const list = this.drawn;
    if (!list.length && !this.live.size) return;
    const fx = this.player.ctx.effects;
    const forward = this.player.playing && prevT !== null && t > prevT && t - prevT < EFFECT_LATE;
    const from = Math.min(t, forward ? prevT : t) - this.longest;
    const now = new Set();
    for (let i = this.firstAfter(from - 1e-6), end = this.firstAfter(t); i < end; i++) {
      const flight = list[i];
      if (forward && flight.destroyed > prevT && flight.destroyed <= t && this.ends(flight)) this.struck(flight, fx);
      if (t >= flight.destroyed || !flightAt(flight, t, _a)) continue;
      now.add(flight);
      const tmpl = lower(flight.tmpl);
      let shown = this.live.get(flight);
      if (!shown) {
        shown = { node: this.nodeFor(tmpl), run: null };
        this.live.set(flight, shown);
      }
      const node = shown.node;
      node.position.set(_a[0], _a[1], _a[2]);
      if (flightHeading(flight, t, _dir)) node.quaternion.setFromUnitVectors(_minusZ, _dir);
      node.visible = true;
      const trail = this.sources.get(tmpl)?.trail;
      if (trail && !shown.run && fx?.has?.(trail)) shown.run = fx.play(trail, { attach: { object: node } }) ?? null;
    }
    for (const [flight, shown] of this.live) {
      if (now.has(flight)) continue;
      this.putAway(flight, shown);
    }
  }

  /** Whether a flight ends in an effect: a collision the server recorded;
   *  a round that bursts at the end of its life (a flak shell's proximity
   *  fuse or its clock, which no `i` records) gone before the file closed;
   *  or, in a file from before the recorder wrote `i` (none in it), any `pd`
   *  before the file closed, whose surface `struck` then looks for. */
  ends(flight) {
    if (flight.impact) return true;
    const rec = this.player.rec;
    if (!(flight.t1 < rec.duration)) return false;
    return !rec.impacts?.length || burstsAtEndOfLife(this.sources.get(lower(flight.tmpl))?.spec);
  }

  /**
   * The effect of the server's collision, where it put it: the game's
   * collision effect for the round's material against the surface struck
   * (`impactEffect`, as `round-impact.js` plays a page round's), that
   * surface found by casting the page's colliders (the level and the
   * replayed hulls) along the round's last heading through the recorded
   * point; else the round's end effect. The `i` names the object struck,
   * not its material. With no `i` (an older file), the surface is the first
   * the page's colliders put on the round's way on from its last place,
   * within the travel to its `pd` and a tick more; none, no effect.
   */
  struck(flight, fx) {
    const source = this.sources.get(lower(flight.tmpl));
    if (!source || !fx?.play) return;
    const guns = this.player.ctx.guns;
    const p = flight.impact?.point;
    if (!p) {
      this.foundEnd(flight, source, guns, fx);
      return;
    }
    const at = [p[0], p[1], -p[2]];
    let effect = null;
    let normal = [0, 1, 0];
    if (guns?.collider?.cast && source.spec && flightHeading(flight, flight.destroyed - 1e-3, _dir)) {
      let hit = guns.collider.cast(at[0] - _dir.x * SURFACE_PROBE, at[1] - _dir.y * SURFACE_PROBE, at[2] - _dir.z * SURFACE_PROBE,
        _dir.x, _dir.y, _dir.z, SURFACE_PROBE * 2, -1, CG_PROJECTILES);
      let material = hit?.material;
      if (hit) normal = [hit.nx, hit.ny, hit.nz];
      else if (flight.impact.obj >= 0) {
        // An object the page's hull does not reach there (the drawn hull is
        // not the server's collision mesh): the hulls' armour, as
        // `dynamicCast` gives a replayed hull.
        material = HULL_MATERIAL;
        normal = [-_dir.x, -_dir.y, -_dir.z];
      } else {
        // The ground under the point.
        hit = guns.collider.cast(at[0], at[1] + SURFACE_PROBE, at[2], 0, -1, 0, SURFACE_PROBE * 2, -1, CG_PROJECTILES);
        material = hit?.material;
        if (hit) normal = [hit.nx, hit.ny, hit.nz];
      }
      if (material != null) effect = impactEffect(guns.damageEffects, guns.attackerMaterial(source.spec), material);
    }
    effect ??= source.endEffect;
    if (effect) fx.play(effect, { position: at, normal });
  }

  /** `struck` for a flight with no recorded collision: the surface on its
   *  way in a file with no `i`, else the burst where it was last (HP-9d's
   *  end of life, stood on world up as `detonate` plays it). */
  foundEnd(flight, source, guns, fx) {
    if (!source.spec || !flightAt(flight, flight.destroyed, _b)) return;
    const last = flight.destroyed;
    const span = Math.min(0.1, last - flight.created);
    if (guns?.collider?.cast && !this.player.rec.impacts?.length && span > 0 && flightAt(flight, last - span, _a)
        && flightHeading(flight, last - 1e-3, _dir)) {
      const speed = Math.hypot(_b[0] - _a[0], _b[1] - _a[1], _b[2] - _a[2]) / span;
      const reach = speed * (Math.max(0, flight.t1 - last) + span) + SURFACE_PROBE;
      const hit = guns.collider.cast(_b[0], _b[1], _b[2], _dir.x, _dir.y, _dir.z, reach, -1, CG_PROJECTILES);
      if (hit) {
        const effect = impactEffect(guns.damageEffects, guns.attackerMaterial(source.spec), hit.material) ?? source.endEffect;
        if (effect) fx.play(effect, { position: [hit.x, hit.y, hit.z], normal: [hit.nx, hit.ny, hit.nz] });
        return;
      }
    }
    if (burstsAtEndOfLife(source.spec) && source.endEffect) fx.play(source.endEffect, { position: [_b[0], _b[1], _b[2]], normal: [0, 1, 0] });
  }

  putAway(flight, shown) {
    shown.run?.stop?.();
    shown.node.visible = false;
    const tmpl = lower(flight.tmpl);
    if (!this.pool.has(tmpl)) this.pool.set(tmpl, []);
    this.pool.get(tmpl).push(shown.node);
    this.live.delete(flight);
  }

  /** What is in the air now, for a probe: `[{ tmpl, at }]`, view frame. */
  debug() {
    return [...this.live.keys()].map(f => ({ tmpl: f.tmpl, key: f.key, at: this.live.get(f).node.position.toArray() }));
  }

  dispose() {
    for (const [flight, shown] of this.live) this.putAway(flight, shown);
    for (const nodes of this.pool.values()) for (const node of nodes) node.parent?.remove(node);
    this.pool.clear();
    this.drawn = [];
  }
}
