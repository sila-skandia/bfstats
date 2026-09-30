// A soldier's `addArmorEffect` tiers, played where and when the engine plays
// them.
//
// Desert Combat is the only installed mod whose soldiers author one (a census
// of every archive of every installed mod, 2026-09-30): `USSoldier` declares
// `addArmorEffect 0 e_soldierdeath_us 0/0/0.1` and `IraqSoldier`
// `addArmorEffect 0 e_soldierdeath_iraq 0/-0.1/0.5`, a bundle whose one
// emitter drops the man's helmet. The model export carries the tiers on the
// soldier's own report (`<Soldier>.report.json` `armor.effects`, offsets in
// the glb's space) and `_shared/effects.glb` carries both bundles, but the page
// ran armor tiers for vehicles and statics only (`vehicle-wrecks.js`), so no
// death ever played one.
//
// What the engine does with a tier (ledger ARM-8..ARM-10,
// `features/bf1942-engine-reference/subsystems/hitpoints-and-damage.md` §8):
//
//   - Every Armor runs `Armor::playEffect` from its 30 Hz update until its
//     death latch (+0x128) is set, and not after: `Armor::update` tests the
//     latch before the call (lnxded 0x08172fe0). A soldier's Armor is no
//     different.
//   - Alive (`hitPoints > 0.001`) the key is `ceil(hitPoints)`, and
//     `Armor::getEffect` answers the smallest authored threshold at or above
//     it, or nothing above the highest. A soldier's one tier is 0, so a
//     living soldier shows nothing, and this module does not poll the living.
//   - Dead, `playEffect` latches and keys on the Armor's last hit: 0 when no
//     hit material was recorded (+0x8 == -1), -1 when the object is in water
//     (+0x10), otherwise minus that material's index (client 0x004bc413..
//     0x004bc433, lnxded 0x08172960). `getEffect` of a key below 1 is that
//     exact key, else key 0, else nothing. So the death tier plays once, at
//     the first tick the man is dead.
//   - Each effect of the tier is created and added as a CHILD of the object,
//     placed at the authored offset with no rotation of its own (client
//     0x004bc4b1..: `addChild` through +0x7c, `setTransform` +0x74). A
//     soldier's position is his feet, so the helmet starts at his feet, 0.1 m
//     ahead (US) or 0.5 m ahead and 0.1 m down (Iraqi), in his own frame, and
//     the emitter's `addEmitterSpeed 1` gives it his velocity.
//
// Open: whether a soldier's Armor keeps updating while he sits in a vehicle
// was not traced, so a death in a seat plays nothing here.

import * as THREE from 'three';
import { modelFileStem } from './model-file.js';

/** `Armor::playEffect`'s key for a dead object (client 0x004bc413): 0 with no
 *  hit material on record, -1 in water, otherwise minus the material. */
export function deathKey({ lastHitMaterial = -1, inWater = false } = {}) {
  if (lastHitMaterial == null || lastHitMaterial === -1) return 0;
  return inWater ? -1 : -lastHitMaterial;
}

/**
 * `Armor::getEffect(key)` (lnxded 0x08172820, client 0x004bc2f0) over an
 * `armor.effects` list: `{ threshold, effects }` with every entry authored at
 * the answered threshold, in authored order, or null.
 *
 * Below 1 it is the exact key, else 0. From 1 up it is the smallest threshold
 * at or above the key, and nothing when the key is above every threshold.
 */
export function tierAt(effects, key) {
  if (!Array.isArray(effects) || !effects.length) return null;
  const at = threshold => effects.filter(entry => entry.hp === threshold);
  if (key < 1) {
    for (const threshold of [key, 0]) {
      const found = at(threshold);
      if (found.length) return { threshold, effects: found };
    }
    return null;
  }
  let best = null;
  for (const entry of effects) {
    if (entry.hp >= key && (best === null || entry.hp < best)) best = entry.hp;
  }
  return best === null ? null : { threshold: best, effects: at(best) };
}

/**
 * Where an `addArmorEffect` offset lands for a man standing at `feet`
 * (`[x, y, z]`) facing `yaw`, and the frame the effect runs in.
 *
 * The offset is the report's: the glb's space, whose forward is -Z (the
 * exporter mirrors Refractor's Z). The page draws a soldier facing
 * `(sin yaw, 0, cos yaw)`, so the glb frame stands at a half turn past `yaw`:
 * its -Z is his forward and its +X his right. Returns `{ position, turn }`,
 * `turn` the rotation about +Y that frame is at.
 */
export function effectFrame(feet, yaw, offset) {
  const turn = yaw + Math.PI;
  const c = Math.cos(turn);
  const s = Math.sin(turn);
  const [x, y, z] = [offset?.[0] || 0, offset?.[1] || 0, offset?.[2] || 0];
  return {
    position: [feet[0] + c * x + s * z, feet[1] + y, feet[2] - s * x + c * z],
    turn,
  };
}

/** Seconds a death's tiers may wait on their first fetch and still play: past
 *  it the moment is gone (a level may have changed under it). */
const LATE_PLAY = 1.5;

/**
 * The page's side. `page` hands in, as getters: `MODELS_BASE`, `bust()`, and
 * `effects` (the page's `EffectPlayer`).
 */
export function createSoldierArmorEffects(page) {
  const tiers = new Map();   // soldier template -> Promise<effects[] | null>
  let plays = 0;

  /** The template's `armor.effects`, fetched once off its model report. */
  function tiersOf(template) {
    if (!template) return Promise.resolve(null);
    const key = String(template);
    if (!tiers.has(key)) {
      const url = `${page.MODELS_BASE}/${modelFileStem(key)}.report.json${page.bust?.() ?? ''}`;
      tiers.set(key, fetch(url)
        .then(r => (r.ok ? r.json() : null))
        .then(report => {
          const effects = report?.armor?.effects;
          return Array.isArray(effects) && effects.length ? effects : null;
        })
        .catch(() => null));
    }
    return tiers.get(key);
  }

  function play(effects, death) {
    const tier = tierAt(effects, deathKey(death));
    if (!tier) return 0;
    const velocity = new THREE.Vector3(
      death.velocity?.x || 0, death.velocity?.y || 0, death.velocity?.z || 0);
    let started = 0;
    for (const entry of tier.effects) {
      const { position, turn } = effectFrame([death.x, death.y, death.z], death.yaw || 0, entry.offset);
      const anchor = new THREE.Object3D();
      anchor.name = `armorEffect:${entry.effect}`;
      anchor.position.set(position[0], position[1], position[2]);
      anchor.rotation.set(0, turn, 0);
      anchor.updateMatrixWorld(true);
      // The bundle rides the anchor, as the engine's rides the soldier it is
      // a child of; the corpse does not move, and the emitters inherit the
      // speed he died at.
      const handle = page.effects?.play(entry.effect, { attach: { object: anchor, velocity: () => velocity } });
      if (handle?.run) started++;
    }
    plays += started;
    return started;
  }

  /**
   * A soldier has just died on foot: play his template's death tier.
   * `death` is `{ template, x, y, z, yaw, velocity, lastHitMaterial, inWater }`,
   * `x, y, z` his feet. Resolves to how many bundles started.
   */
  function died(death) {
    if (!death?.template || ![death.x, death.y, death.z].every(Number.isFinite)) {
      return Promise.resolve(0);
    }
    const asked = performance.now();
    return tiersOf(death.template).then(effects => {
      if (!effects) return 0;
      if ((performance.now() - asked) / 1000 > LATE_PLAY) return 0;
      try {
        return play(effects, death);
      } catch (error) {
        console.warn(`soldier armor effect for ${death.template} skipped`, error);
        return 0;
      }
    });
  }

  return { died, tiersOf, get plays() { return plays; } };
}
