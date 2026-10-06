// What a spawn effect stands up, made part of the level.
//
// An emitter with `isSpawnEffect 1` makes no particle: the game creates its
// template as a real object (ledger EMT-10), and `EffectPlayer` hands each one
// it places to `adopt` (its `onObject`). Desert Combat's objective buildings
// die this way: the tower's death tier is `e_air_control_tower_desWRECKPCO`,
// whose one emitter stands up `air_control_tower_des_wreck`, a ruin with
// 999999 hit points and its own smoke and fire at `1000000`. Vanilla's PT
// boats leave their raft the same way.
//
// The object is an object with an Armor like any other, so it shows its
// tier from its first tick: `Armor::getEffect` keyed on `ceil(hitPoints)`
// (ARM-1, `tierAt`), each effect a child of the object at its offset with no
// turn of its own (ARM-11). Its collision hulls ride along hidden, as every
// placed object's do.
//
// **It is part of the world.** `createObjectOnAllClients` makes it an object
// like a placed one, so it is solid and it can be shot: its hulls join the
// level's collision index under an owner id of their own
// (`WorldCollider.addOwner`), and its Armor joins the damageables under that
// id (`vehicle-wrecks.js` `registerDamageable`), where every placed hull's and
// static's already is. A soldier stands on the ruin, a round lands on it and
// takes hit points off it, a blast reaches it, and its tier is the damage
// system's to show from then on. A body that moves it reports where to the
// collider as a shoved hull does (`setMovedOwner`), and to the world's
// positions, which the water pass reads. Nothing builds a level's nav map or
// its cover list again, so the bots neither path round it nor hide behind it.
//
// **Its body is its template's.** `createObjectOnAllClients` builds the object
// from its template like any other, so its physics node is the one
// `setPhysicsNodeComponent` picks from the template's `hasMobilePhysics` bit
// (PHY-17): clear, the default and what DC's ruins write, is a static node
// that nothing moves, and the ruin stays exactly where it was stood up. Set,
// as on both rafts, is a mobile node, and a raft's four `FloatingBundle`s act
// on it: `body-float.js`'s `FloatingHull`, the ship float law (PHY-3). A
// recorded Midway raft rides at water + 0.07 to 0.12 m, which is that law's
// +0.068; the emitter stands it up wherever its dying boat put it (0.47 m
// under for an `Elco80` afloat) and the floats lift it from there, as they
// would in the game, rather than a snap to the waterline. A mobile object
// that does not float, or that comes down on dry land (FH's bee nest spawns an
// `Elco80Raft`), falls under gravity until its hull meets the ground: a
// viewer simplification of the response physics that keeps its spawn frame
// rather than tipping it onto the slope. The emitter passes no velocity, so
// every body starts at rest.
//
// **What removes it** is the server, and only two things make it (EMT-11). Its
// Armor: destroyed, it stays its template's `timeToLiveAfterDeath` and goes
// (HP-19; both rafts write 0, so a sunk raft is gone on the next tick), which
// `vehicle-wrecks.js` runs for it as for any hull and then tells `remove`. And
// the end of the round, which destroys every root PlayerControlObject (HP-20).
// No ObjectSpawner made it, so the abandon clock a spawner arms never runs; a
// ruin with 999999 hit points stands for the rest of the round.
//
// Imported by map.html, and by `tests/effect_objects_harness.mjs`.

import * as THREE from 'three';
import { tierAt } from './soldier-armor-effects.js';
import { GRAVITY, floatNodesOf, localiseFloats, FloatingHull } from './body-float.js';
import { TICK } from './rigid-body.js';

/**
 * How a spawned object is held, from its template: `'static'`, `'float'` or
 * `'ground'`.
 *
 * Mobile only when the bake says the template sets `hasMobilePhysics`
 * (`effectEmitter.particle.hasMobilePhysics`, or the root's own stamp). The
 * engine's default is clear (PHY-17), and a bake from before the word was
 * exported carries neither: static, which is where the object stood before
 * bodies existed. A mobile object floats when it hangs float nodes and the
 * sea bed under it is below the water; otherwise it falls to the ground.
 */
export function bodyKindOf(object, spec, { waterLevel = null, terrainAt = null } = {}) {
  const stamp = object?.userData?.physics?.hasMobilePhysics;
  const mobile = spec?.particle?.hasMobilePhysics === true && stamp !== false;
  if (!mobile) return 'static';
  if (Number.isFinite(waterLevel) && floatNodesOf(object).length) {
    object.updateWorldMatrix(true, false);
    const e = object.matrixWorld.elements;
    const bed = terrainAt?.(e[12], e[14]);
    if (!Number.isFinite(bed) || bed < waterLevel) return 'float';
  }
  return 'ground';
}

/** The object's geometry box in its own frame, hulls included. */
function localBox(object) {
  object.updateWorldMatrix(true, true);
  const inverse = new THREE.Matrix4().copy(object.matrixWorld).invert();
  const box = new THREE.Box3();
  const part = new THREE.Box3();
  const m = new THREE.Matrix4();
  object.traverse(node => {
    if (!node.isMesh || !node.geometry) return;
    if (!node.geometry.boundingBox) node.geometry.computeBoundingBox();
    part.copy(node.geometry.boundingBox).applyMatrix4(m.multiplyMatrices(inverse, node.matrixWorld));
    box.union(part);
  });
  return box;
}

/** How far the object's lowest point hangs below its origin, world-vertical,
 *  in its current frame: what meets the ground. */
function lowestDrop(object, box) {
  if (box.isEmpty()) return 0;
  const e = object.matrixWorld.elements;
  let low = Infinity;
  for (let i = 0; i < 8; i++) {
    const x = i & 1 ? box.max.x : box.min.x;
    const y = i & 2 ? box.max.y : box.min.y;
    const z = i & 4 ? box.max.z : box.min.z;
    low = Math.min(low, e[1] * x + e[5] * y + e[9] * z);
  }
  return low;
}

const _m = new THREE.Matrix4();
const _s = new THREE.Vector3(1, 1, 1);

/** A body's pose onto its object, which hangs straight off the scene. */
function writePose(object, body) {
  const a = body.axes, p = body.pos;
  _m.set(
    a[0][0], a[1][0], a[2][0], p[0],
    a[0][1], a[1][1], a[2][1], p[1],
    a[0][2], a[1][2], a[2][2], p[2],
    0, 0, 0, 1);
  if (object.parent && !object.parent.isScene) {
    _m.premultiply(new THREE.Matrix4().copy(object.parent.matrixWorld).invert());
  }
  _m.decompose(object.position, object.quaternion, _s);
  object.updateMatrixWorld(true);
}

/**
 * `page` hands in, as getters or calls: `effects` (the `EffectPlayer`),
 * `isCollision(node)`, `bindDynamicShading(root)`, `collider` (the level's
 * `WorldCollider`: its `waterLevel` and `heightfield` decide a body, and its
 * hull index takes the object), `registerDamageable(owner, node, opts)`,
 * `unregisterDamageable(owner)`, `world` (its `positions`) and `roundOver`.
 */
export function createEffectObjects(page) {
  let adopted = 0;
  let tiers = 0;
  let removed = 0;
  let roundWasOver = false;
  /** One per object a spawn effect stood up: `{ object, kind, hull, ... }`. */
  const held = [];

  /** The objects' living tiers, started under each armoured node. */
  function startTiers(object) {
    const armoured = [];
    object.traverse(node => {
      if (node.userData?.armor?.effects?.length) armoured.push(node);
    });
    let started = 0;
    for (const node of armoured) {
      const armor = node.userData.armor;
      const hp = armor.hitpoints ?? armor.maxHitpoints;
      if (!(hp > 0.001)) continue;
      const tier = tierAt(armor.effects, Math.ceil(hp));
      for (const entry of tier?.effects ?? []) {
        const anchor = new THREE.Object3D();
        anchor.name = `damage:${entry.effect}`;
        const o = entry.offset;
        anchor.position.set(o?.[0] || 0, o?.[1] || 0, o?.[2] || 0);
        node.add(anchor);
        anchor.updateMatrixWorld(true);
        if (page.effects?.play(entry.effect, { attach: { object: anchor } })?.run) started++;
      }
    }
    return started;
  }

  function terrainAt(x, z) {
    const h = page.collider?.heightfield?.height?.(x, z);
    return Number.isFinite(h) ? h : -Infinity;
  }

  /** The body its template asks for (`bodyKindOf`). */
  function hold(object, spec) {
    const waterLevel = page.collider?.waterLevel ?? null;
    const kind = bodyKindOf(object, spec, { waterLevel, terrainAt });
    const record = { object, kind, hull: null, box: localBox(object), vy: 0, resting: false,
                     owner: -1, damageable: null, bakedInverse: null, radius: 0 };
    if (kind === 'float') {
      object.updateWorldMatrix(true, false);
      const e = object.matrixWorld.elements;
      const axes = [[e[0], e[1], e[2]], [e[4], e[5], e[6]], [e[8], e[9], e[10]]];
      const floats = floatNodesOf(object);
      const physics = object.userData?.physics || {};
      const size = record.box.getSize(new THREE.Vector3());
      let radius = 0;
      for (const f of floats) radius = Math.max(radius, Math.hypot(f.offsetX, f.offsetY, f.offsetZ));
      record.hull = new FloatingHull({
        floats: localiseFloats(floats, axes),
        mass: physics.mass || 1, drag: physics.drag || 0,
        box: [size.x, size.y, size.z],
        inertiaModifier: physics.inertiaModifier || [1, 1, 1],
        waterLevel, boundingRadius: radius,
        position: [e[12], e[13], e[14]], axes,
      });
    }
    held.push(record);
    return record;
  }

  /** One world tick of a float body: the law, then the sea bed under it. */
  function tickFloat(record) {
    // `FloatingBundle::handleMessage(0x14)`: critical damage arms each
    // float's sink rate (0 on both rafts, whose `sinkingSpeedMod` is 0).
    if (!record.hull.armed && record.damageable?.critical) record.hull.arm();
    const body = record.hull.step(TICK);
    const drop = lowestDrop(record.object, record.box);
    const bed = terrainAt(body.pos[0], body.pos[2]);
    if (body.pos[1] + drop < bed) {
      body.pos[1] = bed - drop;
      if (body.v[1] < 0) body.v[1] = 0;
    }
    writePose(record.object, body);
  }

  /** One world tick of a fall onto the ground, then rest. */
  function tickGround(record) {
    const object = record.object;
    const drop = lowestDrop(object, record.box);
    const floor = terrainAt(object.position.x, object.position.z);
    record.vy += GRAVITY * TICK;
    let y = object.position.y + record.vy * TICK;
    if (y + drop <= floor) {
      y = floor - drop;
      record.vy = 0;
      record.resting = true;
    }
    object.position.y = y;
    object.updateMatrixWorld(true);
  }

  /** Its hulls into the collider and its Armor into the damageables, both
   *  under one new owner id. The pose it is registered at is its baked one. */
  function register(record) {
    const object = record.object;
    record.owner = page.collider?.addOwner?.(object) ?? -1;
    if (record.owner < 0) return;
    object.updateWorldMatrix(true, false);
    record.bakedInverse = object.matrixWorld.clone().invert();
    let radius = 0;
    const box = record.box;
    if (!box.isEmpty()) {
      for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) {
        for (const z of [box.min.z, box.max.z]) radius = Math.max(radius, Math.hypot(x, y, z));
      }
    }
    record.radius = radius;
    record.damageable = page.registerDamageable?.(record.owner, object, {
      spawned: true, onRemoved: () => remove(record),
    }) ?? null;
  }

  /**
   * The server destroys it (`GameServer::destroyObject`): its time to live
   * after death ran out (HP-19), or the round ended (HP-20). Nothing else
   * does: no ObjectSpawner made it, so it has no abandon clock (EMT-11).
   */
  function remove(record) {
    const at = held.indexOf(record);
    if (at >= 0) held.splice(at, 1);
    const { object, owner } = record;
    if (owner >= 0) {
      page.collider?.clearMovedOwner?.(owner, { enable: false });
      page.collider?.statics?.disableOwner?.(owner);
      page.unregisterDamageable?.(owner);
    }
    if (!page.effects?.removeObject?.(object)) object.removeFromParent();
    removed++;
  }

  /** `GameServer::gameStatusFirstEndGame` -> `clearWorld` (HP-20): the end of
   *  a round destroys every root PlayerControlObject, both rafts and every
   *  Desert Combat ruin among them. */
  function endOfRound() {
    for (const record of [...held]) {
      if (record.object.userData?.templateKind === 'PlayerControlObject') remove(record);
    }
  }

  const _fwd = new THREE.Matrix4();
  const _inv = new THREE.Matrix4();

  /** Where a moved body now stands, for the collider and the water pass. */
  function publish(record) {
    if (!(record.owner >= 0)) return;
    const object = record.object;
    const e = object.matrixWorld.elements;
    _fwd.multiplyMatrices(object.matrixWorld, record.bakedInverse);
    _inv.copy(_fwd).invert();
    page.collider?.setMovedOwner?.(record.owner, _fwd.elements, _inv.elements,
                                   e[12], e[13], e[14], record.radius);
    if (record.damageable) page.world?.positions?.set(record.owner, [e[12], e[13], e[14]]);
  }

  /** `EffectPlayer`'s `onObject`: light it, hide its hulls, give it its body,
   *  and make it part of the world. Its living tier is the damage system's
   *  once it is a damageable; a page with nowhere to register it starts the
   *  tier here. */
  function adopt(object, spec = null) {
    object.traverse(node => {
      if (page.isCollision?.(node)) node.visible = false;
    });
    page.bindDynamicShading?.(object);
    adopted++;
    const record = hold(object, spec);
    register(record);
    if (!record.damageable) tiers += startTiers(object);
    return object;
  }

  /**
   * The world's ticks this frame (`step.ticks`, 30 Hz), for every body. An
   * object `EffectPlayer.clear()` has taken away (a level change) is dropped.
   */
  function step(stepReport) {
    const over = !!page.roundOver;
    if (over && !roundWasOver) endOfRound();
    roundWasOver = over;
    const ticks = stepReport?.ticks ?? 0;
    for (let i = held.length - 1; i >= 0; i--) {
      const record = held[i];
      if (!record.object.parent) { held.splice(i, 1); continue; }
      if (record.kind === 'static' || record.resting || !ticks) continue;
      for (let t = 0; t < ticks; t++) {
        if (record.kind === 'float') tickFloat(record);
        else if (!record.resting) tickGround(record);
      }
      publish(record);
    }
  }

  return {
    adopt,
    step,
    held,
    get adopted() { return adopted; },
    get tiers() { return tiers; },
    get removed() { return removed; },
  };
}
