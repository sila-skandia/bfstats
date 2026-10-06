// What a spawn effect stands up, made part of the level.
//
// An emitter with `isSpawnEffect 1` makes no particle: the game creates its
// template as a real object (ledger EMT-9), and `EffectPlayer` hands each one
// it places to `adopt` (its `onObject`). Desert Combat's objective buildings
// die this way: the tower's death tier is `e_air_control_tower_desWRECKPCO`,
// whose one emitter stands up `air_control_tower_des_wreck`, a ruin with
// 999999 hit points and its own smoke and fire at `1000000`. Vanilla's PT
// boats leave their raft the same way.
//
// The object is an object with an Armor like any other, so it shows its
// tier from its first tick: `Armor::getEffect` keyed on `ceil(hitPoints)`
// (ARM-1, `tierAt`), each effect a child of the object at its offset with no
// turn of its own (ARM-8). Its collision hulls ride along hidden, as every
// placed object's do. It does not join the level's collider or its
// damageables: nothing can stand on the ruin or shoot it further yet.
//
// Imported by map.html, and by `tests/effect_objects_harness.mjs`.

import * as THREE from 'three';
import { tierAt } from './soldier-armor-effects.js';

/**
 * `page` hands in, as getters or calls: `effects` (the `EffectPlayer`),
 * `isCollision(node)` and `bindDynamicShading(root)`.
 */
export function createEffectObjects(page) {
  let adopted = 0;
  let tiers = 0;

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

  /** `EffectPlayer`'s `onObject`: light it, hide its hulls, start its tier. */
  function adopt(object) {
    object.traverse(node => {
      if (page.isCollision?.(node)) node.visible = false;
    });
    page.bindDynamicShading?.(object);
    adopted++;
    tiers += startTiers(object);
    return object;
  }

  return {
    adopt,
    get adopted() { return adopted; },
    get tiers() { return tiers; },
  };
}
