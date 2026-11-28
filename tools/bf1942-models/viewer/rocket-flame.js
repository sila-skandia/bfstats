import { quatMul } from './kit-graft.js';

// The flame of a worn rocket pack: `e_RocketPack`, the effect bundle the
// `ActiveKitPart` carries (`addTemplate e_RocketPack`, two emitters of
// `e_jetfire_m1` mesh particles and a smoker, each at 0.115/+-0.1/-0.2 turned
// 180 degrees about X: under the pack, pointing down), played on the
// `EffectPlayer` while the part is in its burning state and let go when it is
// not (`ActiveKitPart::update` puts the effect holder in state 0 on a burst and
// stops it again when the persistence runs out).
//
// Both the replay's soldiers and the page's own on-foot body use this one, so
// a pack burns the same in each. The part is the kit's worn `back` part the
// dresser grafted onto the figure (`soldier-dress.js`); the bundle's emitters
// are in that part's own frame, which is why it is attached to it and not to
// the soldier.

/** The effect a burning part plays. */
export const FLAME_EFFECT = 'e_RocketPack';

/** The pack's other bundle, its `defaultEffect` (`e_RocketPackDefault`, the
 *  kit row's second `effects` entry): the same two nozzles, a jet mesh that
 *  lives 0.03 s (one 30 Hz tick) at alpha 1 and is thrown again every 0.1 s,
 *  so the flame blinks and flares. It is the bundle that draws: `e_RocketPack`'s
 *  own jet mesh carries `alphaOverTime 0.1 -> 0` under the material's
 *  `alphaTest 0.7` (additive, like `MuzzHeavy_m1`), so no pixel of it ever
 *  passes and only its smoke sprites show. Both burn together. */
export const FLAME_FLICKER_EFFECT = 'e_RocketPackDefault';

/** Seconds a flame stays up after the last burning frame: the engine's burst
 *  alternates ticks (rocket-pack.js `BURST_TIMER_STEP`) and a recording
 *  samples at 10 Hz, so a flame that dropped the instant a tick did would
 *  flicker at 15 Hz. */
export const FLAME_HOLD = 0.12;

const oriented = new WeakSet();

const worldOrigin = obj => {
  obj.updateWorldMatrix?.(true, false);
  const e = obj.matrixWorld.elements;
  return [e[12], e[13], e[14]];
};

/**
 * Hang the worn rocket pack with its nozzles toward his feet, whichever pose
 * file the figure came from. The `backpack` bone's frame is not one thing:
 * the pose glbs that bake a `backpack` joint (GermanEliteSoldier's EliteKnife
 * pose) have it a half-turn about its own X from the rig's rest frame the
 * rest take (measured: the joint is the rest rotation times (1, 0, 0, 0)).
 * The back slot's half-turn (`kit-graft.js`) was pinned by eye on one of
 * them, so on the other the pack hung upside down, nozzles and flame toward
 * his head: every jet-pack body after the first knife (Hellendoorn 138-173 s,
 * the 2026-11-28 report). The part's nozzle end is its +Z (`e_RocketPack`'s
 * emitters sit at z 0.2 and the jet runs out along +Z). Checked once per
 * figure from his own bones, so it holds prone and in flight: if the part's
 * +Z points from pelvis to head, the part is turned a half-turn about the
 * bone's X (left-multiplied: `bone * X180 * part`, the other frame's
 * answer). Returns the node, or null for a figure with no rocket pack.
 */
export function orientRocketPack(root) {
  let pack = null;
  let head = null;
  let pelvis = null;
  root?.traverse(obj => {
    if (obj.userData?.kitPart && obj.userData.kitSlot === 'back') {
      // The grafted part is the glb's scene (unnamed); the pack is a node in it.
      let named = false;
      obj.traverse(o => { if (/rocketpack/i.test(o.name)) named = true; });
      if (named) pack = obj;
    } else if (/^bip01[ _]head$/i.test(obj.name)) head = obj;
    else if (/^bip01[ _]pelvis$/i.test(obj.name)) pelvis = obj;
  });
  if (!pack || oriented.has(pack)) return pack;
  if (!head || !pelvis) return pack;
  const h = worldOrigin(head);
  const p = worldOrigin(pelvis);
  pack.updateWorldMatrix?.(true, false);
  const e = pack.matrixWorld.elements;
  const dot = e[8] * (h[0] - p[0]) + e[9] * (h[1] - p[1]) + e[10] * (h[2] - p[2]);
  oriented.add(pack);
  if (dot > 0) {
    const q = quatMul([1, 0, 0, 0], [pack.quaternion.x, pack.quaternion.y, pack.quaternion.z, pack.quaternion.w]);
    pack.quaternion.set(...q);
    pack.updateMatrixWorld?.(true);
  }
  return pack;
}

/** The rocket pack's node on a drawn figure: the grafted `back` part, or a
 *  part named for the pack. Null for a figure without one. */
export function packNodeOf(root) {
  let found = null;
  root?.traverse(obj => {
    if (found || !obj.userData?.kitPart) return;
    if (obj.userData.kitSlot === 'back' || /rocketpack/i.test(obj.name)) found = obj;
  });
  return found;
}

/**
 * The flames of every wearer in view, keyed by whatever identifies him.
 * `effects` is the page's `EffectPlayer`; `time()` its clock in seconds.
 */
export class RocketFlames {
  constructor(effects, time = () => performance.now() / 1000) {
    this.effects = effects;
    this.time = time;
    this.flames = new Map();     // key -> { handle, flicker, node, lastBurn }
  }

  /** `key`'s pack, on `node`, burning this frame or not. */
  set(key, node, burning) {
    if (!this.effects) return;
    const now = this.time();
    let flame = this.flames.get(key);
    if (flame && flame.node !== node) {
      flame.handle?.stop?.();
      flame.flicker?.stop?.();
      this.flames.delete(key);
      flame = null;
    }
    if (burning) {
      if (!flame) {
        flame = { handle: null, flicker: null, node, lastBurn: now };
        this.flames.set(key, flame);
      }
      flame.lastBurn = now;
      if (!flame.handle && node && this.effects.has?.(FLAME_EFFECT)) {
        flame.handle = this.effects.play(FLAME_EFFECT, { attach: { object: node }, silent: true });
      }
      if (!flame.flicker && node && this.effects.has?.(FLAME_FLICKER_EFFECT)) {
        flame.flicker = this.effects.play(FLAME_FLICKER_EFFECT, { attach: { object: node }, silent: true });
      }
      return;
    }
    if (flame && flame.handle && now - flame.lastBurn >= FLAME_HOLD) {
      flame.handle.stop?.();
      flame.handle = null;
      flame.flicker?.stop?.();
      flame.flicker = null;
    }
  }

  /** Put `key`'s flame out. */
  clear(key) {
    const flame = this.flames.get(key);
    flame?.handle?.stop?.();
    flame?.flicker?.stop?.();
    this.flames.delete(key);
  }

  /** Put every flame out (a seek, a level change). */
  clearAll() {
    for (const flame of this.flames.values()) {
      flame.handle?.stop?.();
      flame.flicker?.stop?.();
    }
    this.flames.clear();
  }
}
