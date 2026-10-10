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

/** The effect a burning part plays, and the one it leaves a tick of. */
export const FLAME_EFFECT = 'e_RocketPack';

/** Seconds a flame stays up after the last burning frame: the engine's burst
 *  alternates ticks (rocket-pack.js `BURST_TIMER_STEP`) and a recording
 *  samples at 10 Hz, so a flame that dropped the instant a tick did would
 *  flicker at 15 Hz. */
export const FLAME_HOLD = 0.12;

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
    this.flames = new Map();     // key -> { handle, node, lastBurn }
  }

  /** `key`'s pack, on `node`, burning this frame or not. */
  set(key, node, burning) {
    if (!this.effects) return;
    const now = this.time();
    let flame = this.flames.get(key);
    if (flame && flame.node !== node) {
      flame.handle?.stop?.();
      this.flames.delete(key);
      flame = null;
    }
    if (burning) {
      if (!flame) {
        flame = { handle: null, node, lastBurn: now };
        this.flames.set(key, flame);
      }
      flame.lastBurn = now;
      if (!flame.handle && node && this.effects.has?.(FLAME_EFFECT)) {
        flame.handle = this.effects.play(FLAME_EFFECT, { attach: { object: node }, silent: true });
      }
      return;
    }
    if (flame && flame.handle && now - flame.lastBurn >= FLAME_HOLD) {
      flame.handle.stop?.();
      flame.handle = null;
    }
  }

  /** Put `key`'s flame out. */
  clear(key) {
    const flame = this.flames.get(key);
    flame?.handle?.stop?.();
    this.flames.delete(key);
  }

  /** Put every flame out (a seek, a level change). */
  clearAll() {
    for (const flame of this.flames.values()) flame.handle?.stop?.();
    this.flames.clear();
  }
}
