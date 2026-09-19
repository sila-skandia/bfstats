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
   */
  constructor({ tables, terrain, onDamage = null }) {
    this.tables = tables;
    this.terrain = terrain;
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

    // Detect (step 5-6, pass 1): object against object, then the ground.
    collideBodies(this._parts, TICK, handlers);
    for (const entry of this.entries.values()) {
      if (entry.parked) entry.parked.detectGround(terrain, handlers);
    }

    // Resolve (pass 2): no sleeping test, by design.
    for (const entry of this.entries.values()) {
      if (entry.parked) { entry.parked.resolve(wheelFrictionOpts); continue; }
      const body = entry.driven;
      const rootPart = entry.parts.find(p => p.isRoot) || entry.parts[0];
      for (const part of entry.parts) {
        part.response.solve(body, part.worldPos(_pos), rootPart.response);
        part.response.clearContacts();
      }
      body.flush(TICK);
    }

    this.crash.update(TICK);
  }
}

const _pos = [0, 0, 0];
