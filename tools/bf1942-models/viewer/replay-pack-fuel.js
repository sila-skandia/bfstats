// The rocket pack's fuel bar in a replay (`Recover/Recover`, the layout's
// `rocketpackbar_full_32x64` leaf beside the soldier icon, shown while
// `Recover/ShowRecover == 3`; soldier-hud.js feeds the page's own).
//
// A recording carries no pack heat. What it has is the flier's own samples,
// and `replayBurning` reads a burn off their heights (the flame and the
// burst's report already go by it, replay-bodies.js). So the bar is the pack's
// own heat law (`RocketPack.update`, ActiveKitPart::update) run at the engine's
// 30 Hz over the life, its trigger down on every tick the samples say he
// burns: heat climbs by `activeHeat` a burst and `passiveHeat` a tick while
// the pack idles on him, and `cooling` takes it off every tick. It is an
// estimate as the burn is, exact in shape (a long climb empties the bar, a
// rest refills it at the kit's own rate).

import { RocketPack, replayBurning } from './rocket-pack.js';
import { poseAt } from './replay-kinematics.js';

const TICK = 1 / 30;
/** The half-span of the three samples a burn is read across (replay-bodies.js
 *  reads it 0.1 s either side). */
const SPAN = 0.1;

function firstTime(life) {
  const keys = life?.keys;
  if (!keys?.length) return null;
  return typeof keys.time === 'function' ? keys.time(0) : keys[0]?.t ?? null;
}

/** Whether `life` is burning at `t`, from its heights. */
export function burningAt(life, t) {
  const before = poseAt(life, t - SPAN);
  const now = poseAt(life, t);
  const after = poseAt(life, t + SPAN);
  return Boolean(before && now && after && replayBurning(before.p[1], now.p[1], after.p[1], SPAN));
}

/**
 * The pack's fuel per life, stepped forward from where it last was and run
 * again from the life's start when the clock goes back.
 * `onPack(t)`: whether the flier wears the pack in the air at `t` (his
 * recorded lower state is a rocketeering one); a burn is read only
 * then; elsewhere it only cools.
 */
export class PackFuel {
  constructor() {
    this.runs = new WeakMap();   // life -> { spec, pack, t }
  }

  /** 1 cool to 0 overheated, at `t`, or null for a life with no first sample. */
  at(life, spec, t, onPack = () => true) {
    let run = this.runs.get(life);
    if (!run || run.spec !== spec || t < run.t - 1e-9) {
      const t0 = firstTime(life);
      if (t0 === null) return null;
      run = { spec, pack: new RocketPack(spec), t: t0 };
      this.runs.set(life, run);
    }
    while (run.t + TICK <= t) {
      run.t += TICK;
      // A burst only where he is on the pack and his heights say it burns;
      // every other tick the part idles (XPack2's pack takes no idle heat)
      // and cools.
      run.pack.update({ trigger: onPack(run.t) && burningAt(life, run.t) });
    }
    return run.pack.fuel;
  }
}
