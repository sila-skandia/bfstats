// One 30 Hz tick of everything that can be rammed.
//
// The engine's order, from `GameServer::simulateFrame`
// (`features/bf1942-engine-reference/subsystems/collision-response.md` section
// 2): forces accumulate on the root, the root integrates, and only then are
// contacts detected and resolved — detection for bodies that are awake,
// resolution for every body with a pending contact, asleep or not, which is
// what lets a moving jeep wake a parked plane. An impulse posted by the
// resolve pass is integrated by the *next* tick.
//
// Two kinds of body live here. A **parked** vehicle is wholly this module's:
// a `RigidBody` on its own wheel springs (`body-ground.js`). The **driven**
// vehicle keeps the drive model it has always had (`ground.js`, `flight.js`)
// and takes part through `DrivenBody` (`vehicle-bodies.js`), which the contact
// solver cannot tell from the real thing. The engine draws the same line in
// the same place — an occupied vehicle leaves the global passes for the
// per-player ones — though for a different reason.
//
// Framework-free: the page hands in terrain as three functions and gets damage
// back as a callback.

import { TICK } from './rigid-body.js';
import { collideBodies } from './body-contact.js';
import { collideWithStatics } from './body-statics.js';
import { CrashDamage, contactMaterialValues } from './crash-damage.js';
import { wheelFrictionOpts } from './vehicle-bodies.js';

/** Ticks a stalled tab may owe before the backlog is dropped (the engine's own rule is 10). */
const MAX_BACKLOG_TICKS = 10;

export class BodyWorld {
  /**
   * @param {object} options
   * @param {object} options.tables   `_shared/damage.json`
   * @param {{height: Function, normal: Function, material: Function,
   *          waterLevel: number|null}} options.terrain
   * @param {(owner: number, result: {damage: number, kill: boolean,
   *          effectCell: number[]|null}, at: number[], other: number|null) => void}
   *        [options.onDamage]  called when a contact costs hit points
   * @param {object} [options.statics]  the static world, as `body-statics.js`
   *        asks about it (`WorldCollider.staticProbe()`). Without it a hull
   *        meets a building the way it did before this existed — whatever the
   *        drive model does for itself.
   */
  constructor({ tables, terrain, onDamage = null, statics = null }) {
    this.tables = tables;
    this.terrain = terrain;
    this.statics = statics;
    this.onDamage = onDamage;
    this.crash = new CrashDamage(tables);
    /** owner -> entry. */
    this.entries = new Map();
    this._parts = [];
    this._partsDirty = true;
    this._debt = 0;
    this.ticks = 0;

    const world = this;
    this.handlers = {
      onCollision(self, other, vRel, normal, pos, matSelf, matOther) {
        const result = world.crash.onObjectContact(
          self.owner, other.owner, vRel, normal, matSelf, matOther);
        if (result && (result.damage > 0 || result.kill)) {
          world.onDamage?.(self.owner, result, pos, other.owner);
        }
        return true;
      },
      onTerrain(part, speed, normal, pos, matSelf, matTerrain) {
        const result = world.crash.onTerrainContact(
          part.owner, speed, normal, matSelf, matTerrain);
        if (result && (result.damage > 0 || result.kill)) {
          world.onDamage?.(part.owner, result, pos, null);
        }
      },
      onWater() {},
      materialValues(matA, matB) {
        return contactMaterialValues(world.tables, matA, matB);
      },
    };
  }

  /** How the victim's Armor scales a crash: `describeVehicleParts`' numbers. */
  #register(owner, spec) {
    this.crash.register(owner, {
      speedMod: spec.speedMod, angleMod: spec.angleMod, damageMod: spec.damageMod,
      damageFromWater: spec.damageFromWater,
    });
  }

  /** A `ParkedVehicle` (`body-ground.js`) standing on its own springs. */
  addParked(owner, parked, spec) {
    for (const part of parked.parts) part.owner = owner;
    this.entries.set(owner, { owner, parked, driven: null, parts: parked.parts, spec });
    this.#register(owner, spec);
    this._partsDirty = true;
  }

  /** The vehicle under the player: a `DrivenBody` and its collision parts. */
  addDriven(owner, driven, parts, spec) {
    for (const part of parts) part.owner = owner;
    this.entries.set(owner, { owner, parked: null, driven, parts, spec });
    this.#register(owner, spec);
    this._partsDirty = true;
  }

  get(owner) { return this.entries.get(owner) || null; }

  remove(owner) {
    if (this.entries.delete(owner)) this._partsDirty = true;
  }

  clear() {
    this.entries.clear();
    this._partsDirty = true;
    this._debt = 0;
  }

  /** Advance by a frame's `dt` in whole ticks. Returns how many ran. */
  step(dt) {
    if (!this.entries.size || !(dt > 0)) return 0;
    this._debt += dt;
    let n = Math.floor(this._debt / TICK + 1e-9);
    if (n <= 0) return 0;
    this._debt -= n * TICK;
    // A tab that slept for a minute owes 1,800 ticks; the engine drops a
    // backlog rather than replaying it, and so does this.
    if (n > MAX_BACKLOG_TICKS) { n = 1; this._debt = 0; }
    for (let i = 0; i < n; i++) this.tick();
    return n;
  }

  /**
   * `checkVsTerrain`'s damage half for a vehicle whose response is someone
   * else's: each hull part's layer-0 vertices against the heightfield (one
   * vertex when the layer has three or fewer), `handleCollision` with the
   * root's speed at the contact when its square exceeds 0.1. The once-a-second
   * limiter lives in `CrashDamage`, keyed on the terrain as `null`.
   */
  #drivenTerrainDamage(entry) {
    const { terrain, handlers } = this;
    const body = entry.driven;
    for (const part of entry.parts) {
      const layer = part.shape.layers[0];
      let n = layer.vertices.length / 3;
      if (n <= 3) n = Math.min(n, 1);
      for (let i = 0; i < n; i++) {
        part.worldVertex(0, i, _vertex);
        const h = terrain.height(_vertex[0], _vertex[2]);
        if (!(_vertex[1] - h <= 0)) continue;
        _contact[0] = _vertex[0]; _contact[1] = h; _contact[2] = _vertex[2];
        body.tangentSpeed(_contact, _speed);
        if (!(_speed[0] * _speed[0] + _speed[1] * _speed[1] + _speed[2] * _speed[2] > 0.1)) continue;
        terrain.normal(_vertex[0], _vertex[2], _normal);
        handlers.onTerrain(part, _speed, _normal, _contact,
          layer.vertexMaterials[i], terrain.material(_vertex[0], _vertex[2]));
      }
    }
  }

  tick() {
    this.ticks++;
    if (this._partsDirty) {
      this._parts.length = 0;
      for (const entry of this.entries.values()) this._parts.push(...entry.parts);
      this._partsDirty = false;
    }
    const { terrain, handlers } = this;

    // Forces, then integration (spec section 2, steps 3-4).
    for (const entry of this.entries.values()) {
      if (entry.driven) { entry.driven.sync(); continue; }
      entry.parked.accumulate(TICK);
      entry.parked.body.step(TICK);
    }

    // Detect (step 5-6, pass 1): object against object, the static world,
    // then the ground.
    collideBodies(this._parts, TICK, handlers);
    if (this.statics) {
      for (const entry of this.entries.values()) {
        // Driven only, for now. A parked body against a building is the same
        // call and the same solver, but a level places vehicles inside hangars
        // and lean-tos whose col0 hull the coarse mesh overlaps, and a sleeping
        // body woken by a push-out it can never satisfy would never sleep
        // again. `features/viewer-ground-hull-collision/README.md` has it as
        // the next step, with the settle pass as where it belongs.
        if (entry.driven) {
          collideWithStatics(entry.parts, this.statics, TICK, handlers);
        }
      }
    }
    for (const entry of this.entries.values()) {
      if (entry.parked) entry.parked.detectGround(terrain, handlers);
    }

    // The driven vehicle's drive model owns its contact with the ground, so
    // there is no impulse to find here - but hitting the ground still costs
    // hit points (spec 9.5), and that is this module's to say.
    for (const entry of this.entries.values()) {
      if (entry.driven) this.#drivenTerrainDamage(entry);
    }

    // Resolve (pass 2): no sleeping test, by design.
    for (const entry of this.entries.values()) {
      if (entry.parked) { entry.parked.resolve(wheelFrictionOpts); continue; }
      const body = entry.driven;
      const rootPart = entry.parts.find(p => p.isRoot) || entry.parts[0];
      for (const part of entry.parts) {
        part.response.solve(body, part.worldPos(_pos), rootPart.response);
        // A driven vehicle's contact FRICTION belongs to its drive model — the
        // engine's friction pass would run here (spec 8), and for a hull
        // contact what it mostly does is dilute the tyres' mean with a sample
        // whose `N.y` is near zero. `noteContact` is that hand-over, before
        // the averages are cleared; a body whose drive model does not want it
        // (an aircraft) is a no-op.
        body.noteContact?.(part.response, _pos);
        part.response.clearContacts();
      }
      body.flush(TICK);
    }

    this.crash.update(TICK);
  }
}

const _pos = [0, 0, 0];
const _vertex = [0, 0, 0];
const _contact = [0, 0, 0];
const _speed = [0, 0, 0];
const _normal = [0, 1, 0];

/**
 * Does this body actually reach the water plane?
 *
 * The engine's own rule, from `checkVsTerrain`
 * (`features/bf1942-engine-reference/subsystems/collision-response.md` §7):
 * water produces no impulse, but **the lowest tested vertex below the water
 * level sets `underWater` on the part's node** — so water contact is
 * geometric, and the vertices it is decided on are exactly the ones
 * `BodyWorld.#drivenTerrainDamage` already samples against the heightfield
 * (collision layer 0; one vertex when the layer has three or fewer).
 *
 * This exists because "is the surface under this (x, z) the sea?" is NOT that
 * rule and cannot stand in for it: `WorldCollider.surfaceHeight` is a function
 * of x/z alone, so it answers "water" for a Corsair at 400 m over the ocean
 * just as readily as for a jeep sitting in it, and HP-5's drowning tick then
 * burns a plane out of the sky at `hpLostWhileDamageFromWater` a second (10
 * for every vanilla aircraft — a 10-second life for a 100 HP Corsair over
 * Wake). Altitude has to enter the test somewhere, and the hull is where the
 * engine puts it.
 *
 * `originY` is the body's own origin height, which the caller already has:
 * below the plane, the hull is in the water whatever its vertices say, and
 * the loop is skipped. The `reach` bail above it is a rotation-invariant
 * bound — no vertex can be further from the origin than the longest one — so
 * a vehicle high above the sea costs one subtraction, not a vertex sweep,
 * every tick.
 */
export function touchesWater(entry, originY, waterLevel) {
  if (!entry || !Number.isFinite(waterLevel) || !Number.isFinite(originY)) return false;
  if (originY <= waterLevel) return true;
  if (originY - waterReach(entry) > waterLevel) return false;
  for (const part of entry.parts) {
    const layer = part.shape?.layers?.[0];
    if (!layer || !layer.vertices) continue;
    for (let i = 0, n = sampleCount(layer); i < n; i++) {
      part.worldVertex(0, i, _vertex);
      if (_vertex[1] <= waterLevel) return true;
    }
  }
  return false;
}

/** `checkVsTerrain`'s own sampling: every layer-0 vertex, or just the first
 *  when the layer has three or fewer — the rule `#drivenTerrainDamage` runs. */
function sampleCount(layer) {
  const n = layer.vertices.length / 3;
  return n <= 3 ? Math.min(n, 1) : n;
}

/**
 * How far below its origin any tested vertex of this body can possibly sit,
 * cached on the entry.
 *
 * The bound is `max(|offset| + |vertex|)` over the sampled vertices — a
 * radius, not a height, so no orientation can beat it and a rolling plane
 * needs no recompute. Shapes never change after `addParked`/`addDriven`, so
 * this is computed once per body.
 */
function waterReach(entry) {
  if (entry._waterReach !== undefined) return entry._waterReach;
  let reach = 0;
  for (const part of entry.parts) {
    const layer = part.shape?.layers?.[0];
    if (!layer || !layer.vertices) continue;
    const o = part.offset || [0, 0, 0];
    const arm = Math.hypot(o[0], o[1], o[2]);
    const v = layer.vertices;
    for (let i = 0, n = sampleCount(layer); i < n; i++) {
      const b = i * 3;
      const r = arm + Math.hypot(v[b], v[b + 1], v[b + 2]);
      if (r > reach) reach = r;
    }
  }
  entry._waterReach = reach;
  return reach;
}
