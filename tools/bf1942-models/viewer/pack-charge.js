// The medic bag's and the wrench's charge: the bar beside their icon on the
// soldier HUD, which empties while the pack works and fills again on its own
// (ledger SUP-34).
//
// Both are `magType 1` items ("healing type", vanilla's MedPack and
// RepairPack, FHSW's TurboWrench too): one magazine of `magSize` units
// (MedPack 1800, RepairPack 3000) that nothing reloads. The engine's law, read
// from lnxded:
//   - a held trigger is a pull every tick: the soldier hears message 6 each
//     tick the fire flag is down (bf42plus's notes on GameClient's per-tick
//     loop 0x004B90D0, and SUP-21's begin/end pairs every other 30 Hz frame),
//     and nothing paces a pack's pull (`FireArms::Fire`'s `magType 1` branch
//     returns before the fire timer is set, 0x0828a16d -> 0x0828aa05);
//   - `BFSoldier::handleMessage`'s Fire branch runs `useMedPack` /
//     `useRepairPack` only while the charge is above `trunc(reloadTime)`
//     (0x08277714 / 0x0827778a, template +0x23c), and passes the pull on to
//     the pack (`-0x185`, set at 0x08277657) unless the use did nothing
//     (0x08277730: nobody wounded in reach, no hull to repair, nothing to
//     disarm). A pull passed on reaches `FireArms::Fire`, which takes
//     `trunc(roundOfFire)` (+0x240, vanilla 10) off a charge above 0,
//     floored at 0 (0x0828aa05..0x0828aa92). So a pack costs nothing waved
//     at nobody, 10 a tick while it heals or repairs, and a pull at the
//     floor (with nothing done) still empties it: held at empty, it stays
//     empty;
//   - every update of the item in hand gives back `trunc(reloadTime)` units
//     (`FireArms::handleUpdate` 0x08288fc8..0x08289056: MedPack's 1.5 and
//     RepairPack's 1.1 are both 1), capped at `magSize`. At 30 Hz a working
//     pack nets -270 a second (a full MedPack lasts 6.7 s, a wrench 11 s),
//     and an empty one in the hand fills in 60 s (MedPack) or 100 s (wrench);
//   - a holstered item is not updated (GUN-16); raising it pays what it
//     missed, `trunc(elapsed x reloadTime x 30)` capped at `magSize`
//     (`HandFireArms::enable` 0x08293cb7..0x08293d17; 30.0 at 0x08716b5c),
//     which is 45 a second for a MedPack, faster than in the hand.
// A server recording's `am` shows it: a medic's 1800 reads 1791 the tick
// after one use (-10, +1).
//
// DICE's own remarks beside the two words in vanilla's `MedPack/Objects.con`
// are "Recover time" (`reloadtime`) and "Use medpack time" (`roundOfFire`).

export const PACK_TICK_HZ = 30;
const TICK = 1 / PACK_TICK_HZ;

/**
 * The charge law of a hand weapon's glb block (`extras.weapon`), or null for
 * anything that is not a `magType 1` item. `{ cap, cost, regen, raiseRate,
 * floor }`: the full charge, the units a pull passed on costs, the units a
 * tick gives back in the hand, the units a second a holstered one is paid on
 * its raise, and the charge a use needs to exceed.
 */
export function packChargeSpec(data) {
  const magazine = data?.magazine;
  if (!magazine || magazine.type !== 1) return null;
  const cap = Number(magazine.size);
  if (!(cap > 0)) return null;
  const reloadTime = Number.isFinite(magazine.reloadTime) ? magazine.reloadTime : 0;
  const roundOfFire = Number.isFinite(data.roundOfFire) && data.roundOfFire > 0 ? data.roundOfFire : 10;
  return {
    cap,
    cost: Math.trunc(roundOfFire),
    regen: Math.trunc(reloadTime),
    raiseRate: reloadTime * PACK_TICK_HZ,
    floor: Math.trunc(reloadTime),
  };
}

/** One pack's charge, stepped by the engine's rules. */
export class PackCharge {
  constructor(spec, charge = spec.cap) {
    this.spec = spec;
    this.charge = charge;
  }

  /** Whether a pull now runs the pack's use: the soldier's gate, `charge > trunc(reloadTime)`. */
  get usable() {
    return this.charge > this.spec.floor;
  }

  /**
   * One pull. `use()` runs the pack's use when the gate lets it and answers
   * whether it did something. A use that did something, or a pull the gate
   * refused, reaches `FireArms::Fire` and costs `trunc(roundOfFire)`.
   * Returns what the use returned, false when it did not run.
   */
  pull(use = () => true) {
    if (this.usable) {
      if (!use()) return false;
      this.charge = Math.max(0, this.charge - this.spec.cost);
      return true;
    }
    if (this.charge > 0) this.charge = Math.max(0, this.charge - this.spec.cost);
    return false;
  }

  /** One 30 Hz update of the item in his hands. */
  tick() {
    this.charge = Math.min(this.spec.cap, this.charge + this.spec.regen);
  }

  /** Raised again after `elapsed` seconds holstered. */
  raise(elapsed) {
    if (!(elapsed > 0)) return;
    this.charge = Math.min(this.spec.cap, this.charge + Math.trunc(elapsed * this.spec.raiseRate));
  }

  /** The kit's refill at a depot or a spawn. */
  refill() {
    this.charge = this.spec.cap;
  }
}

/**
 * The charge at `t` of a pack whose life is the sorted list `spans` of
 * `{ t0, t1, held, using }` segments (held: in his hands; using: the trigger
 * down, his torso in the pack's fire state), run from full at `spans[0].t0`
 * on the 30 Hz grid, a pull every tick of a using span, with `refills`
 * (times) filling it again. `works(t)` says whether a pull at `t` heals or
 * repairs something (default: always). Returns `{ charge, cap }` or null for
 * no spans.
 */
export function packChargeAt(spec, spans, t, refills = [], works = () => true) {
  if (!spec || !spans?.length) return null;
  const pack = new PackCharge(spec);
  const fills = refills.filter(r => Number.isFinite(r)).sort((a, b) => a - b);
  let nextFill = 0;
  let holsteredAt = null;
  for (const span of spans) {
    if (span.t0 > t) break;
    const end = Math.min(span.t1, t);
    if (!span.held) {
      if (holsteredAt === null) holsteredAt = span.t0;
      continue;
    }
    if (holsteredAt !== null) {
      pack.raise(span.t0 - holsteredAt);
      holsteredAt = null;
    }
    // Whole ticks of the engine's clock inside the span: the tick's input
    // (the pull) before its update (the regain), FA-20's order.
    for (let k = Math.ceil(span.t0 * PACK_TICK_HZ - 1e-6); k * TICK <= end + 1e-9; k++) {
      const tick = k * TICK;
      if (tick >= span.t1) break;
      while (nextFill < fills.length && fills[nextFill] <= tick) {
        pack.refill();
        nextFill += 1;
      }
      if (span.using) pack.pull(() => works(tick));
      pack.tick();
    }
  }
  while (nextFill < fills.length && fills[nextFill] <= t) {
    pack.refill();
    nextFill += 1;
  }
  return { charge: pack.charge, cap: spec.cap };
}
