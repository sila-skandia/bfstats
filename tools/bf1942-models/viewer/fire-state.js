// A seated gun's magazine, reload, heat and cone (GUN-12, XHIT-15), the
// `onShot` splice that bills it, and which of a seat's guns the cross reads.
// Split out of `seats.js`, which re-exports the first two.

import { DeviationModel, TICK_HZ } from './deviation.js';

// --- firing: magazine, reload, auto-reload, heat (verify-r6.md GUN-12) --
//
// `gunfire.js`'s own `advance()` already paces shots at `stats.roundOfFire`
// once `group.firing` is true -- that IS the rate-of-fire gate GUN-12 places
// ahead of the ammo check, enforced downstream of everything below rather
// than duplicated here. This class only decides whether the trigger is even
// allowed to engage: reload and overheat block it outright (GUN-12's
// verified order), and `getHasHeat()`'s real test -- `template+0x300 >
// template+0x304`, corrected from an earlier equality reading, fields still
// unidentified -- has no equivalent in this viewer's extracted data, so
// "has heat" here is the practical proxy the extraction actually gives:
// the `.con` declared `heatAddWhenFire` at all. GUN-12's two unidentified
// instance flags and its `timeToEjectClipFinished` (distinct from the reload
// timer, per the verifier) have no data of their own here either; ejecting is
// folded into the one `reloadTime` window rather than invented a second one.
export class FireState {
  constructor(stats) {
    this.stats = stats;
    this.reset();
  }

  /**
   * Back to the state a gun is in the first time anybody touches it: full
   * magazine, all its spares, cold barrel, no reload running.
   *
   * Used when a vehicle respawns. The states live in a `WeakMap` keyed on the
   * FireArms node, and a respawn reuses that node, so without this a hull
   * destroyed with a hot, half-empty, mid-reload gun is rebuilt around it --
   * the engine replaces the *object* at the ObjectSpawner, which is exactly
   * the moment its ammunition is new. Stepping out and back in does NOT go
   * through here: that is the same object, and it keeps what it has spent.
   */
  reset() {
    const stats = this.stats;
    this.unlimited = stats.magSize == null || stats.magSize < 0;
    this.ammo = this.unlimited ? Infinity : stats.magSize;
    // `numOfMag` counts the loaded magazine, not the spares beside it — the
    // same reading `map.html`'s hand weapon already ships ("`magazines 5` is
    // read as the loaded magazine plus the spares", `hw.mags = magazines -
    // 1`, which is what puts a Thompson's confirmed 30/4 on the HUD instead
    // of 30/5). Counted as the spares here too, so `Ammo/PrimaryMag` means
    // the same thing in a seat as it does on foot and a Sherman carries the
    // 30 shells its `.con` declares rather than 30 plus a free reload.
    this.magsLeft = stats.numOfMag == null || stats.numOfMag < 0
      ? Infinity : Math.max(0, stats.numOfMag - 1);
    this.hasHeat = stats.heatAddWhenFire != null;
    this.heat = 0;
    this.reloadRemaining = 0;
    this.overheatRemaining = 0;
    // The gun's cone, `stats.deviation` = `{ min, fire }` off a plain
    // FireArms (the exporter's `_fire_arms`), null on one that ships no
    // words, a tank's main gun. `FireArms::updateDeviation` (client
    // 0x00539620) is the hand weapon's rule without a soldier: no stance
    // multiplier, no speed, turn or misc channel, so `minDev + fire`, the
    // bloom raised per pull and decayed a 1/30 s tick (handweapon-view-and-
    // deviation §2). The vehicle HUD feed hands the cross that total (XHIT-15).
    const fire = stats.deviation?.fire;
    this.cone = stats.deviation ? new DeviationModel({ deviation: stats.deviation }) : null;
    // Seconds the bloom takes from its cap to nothing, and a tick over.
    this.coneSettle = fire?.[2] > 0 ? ((fire[0] ?? 0) / fire[2] + 1) / TICK_HZ : 1 / TICK_HZ;
  }

  /** The cone's total right now, degrees, floor included: what the cross
   *  opens by (vehicle-hud.js `updateCrosshair`). 0 with no words. */
  get spread() {
    return this.cone ? this.cone.current() : 0;
  }

  get canFire() {
    if (this.reloadRemaining > 0) return false;
    if (this.overheatRemaining > 0) return false;
    // NOT the same comparison GUN-12 corrected to strict-greater-than: that
    // fix was to `getHasHeat()`, a template-level "does this weapon have a
    // heat mechanic at all" predicate on two still-unidentified fields,
    // distinct from `isReadyToUseFire`'s own overheat gate (a countdown
    // timer, `timeToOverHeatFinished()>0`) and from what actually starts
    // that timer, which the report never pins down. `heat>=1` here is this
    // viewer's own approximation of the trigger, following the corrected
    // report's Viewer Recipe ("clamp [0,1] ... block fire ... on reaching
    // 1.0") rather than a confirmed engine comparison — `>` would never fire
    // on this clamped scale, since `heat` never exceeds 1.
    if (this.hasHeat && this.heat >= 1) return false;
    if (!this.unlimited && this.ammo <= 0) return false;
    return true;
  }

  step(dt) {
    if (this.reloadRemaining > 0) {
      this.reloadRemaining = Math.max(0, this.reloadRemaining - dt);
      if (this.reloadRemaining === 0 && !this.unlimited) {
        this.ammo = this.stats.magSize;
        if (this.magsLeft !== Infinity) this.magsLeft = Math.max(0, this.magsLeft - 1);
      }
    }
    if (this.overheatRemaining > 0) this.overheatRemaining = Math.max(0, this.overheatRemaining - dt);
    if (this.hasHeat && this.heat > 0) {
      this.heat = Math.max(0, this.heat - (this.stats.coolDownPerSec || 0) * dt);
    }
    // The bloom's ticks. Nothing to run once it is back on the floor, and no
    // more than it takes to get there, so a replay's long step between two
    // rounds (replay-hud.js `gunStateAt`) costs a few dozen ticks at most.
    if (this.cone?.fire > 0) this.cone.update(Math.min(dt, this.coneSettle));
  }

  /**
   * Called once per trigger pull (chain onto `guns.onShot`), with the number of
   * rounds that pull spent.
   *
   * **One round per projectile, not one per pull** — ledger BOMB-1,
   * `FireArms::fireFinished` (lnxded `0x08288470`): a multi-barrel weapon with
   * no `setAsynchronyFire` and no `blastAmmoCount` (BOMB-13) charges
   * `barrelCount`, everything else charges 1,
   * and the counter is floored at zero. A Stuka's `magSize 30` over two barrels
   * is therefore fifteen drops of a pair and one pull takes it from 30 to 28.
   * `gunfire.js`'s `salvo()` does that arithmetic and hands the answer down; the
   * default of 1 is what every single-barrel weapon in the game spends and what
   * a caller written before this argument existed will pass.
   *
   * Heat is per pull and not per projectile: `heatAddWhenFire` is added once,
   * which is what the engine's own single call to the heat accumulator does —
   * in `FireArms::Fire` at `0x0828a2f3`, above the barrel loop, not in
   * `fireFinished` as this comment used to say. The behaviour is unchanged; the
   * citation was wrong.
   */
  registerShot(rounds = 1) {
    // The bloom, once a pull like the heat: `fire = min(fire + b, a)` in
    // `FireArms::Fire` (lnxded 0x0828a2aa), ahead of the heat at 0x0828a2f3.
    this.cone?.onShot();
    if (this.hasHeat) {
      this.heat = Math.min(1, this.heat + this.stats.heatAddWhenFire);
      if (this.heat >= 1) this.overheatRemaining = this.stats.timeDelayOnOverheat || 0;
    }
    if (!this.unlimited) {
      this.ammo = Math.max(0, this.ammo - Math.max(0, rounds));
      if (this.ammo === 0 && this.magsLeft > 0) {
        this.reloadRemaining = this.stats.reloadTime || 0;
      }
    }
  }
}

/**
 * Of a seat's FireArms nodes, primary first, the one whose cone the cross
 * opens by, or null.
 *
 * The vehicle HUD feed (client `0x006d7050`) walks the seat's FireArms for the
 * two ammo panels, and in the same loop writes `CrossHair/Radius` and
 * `Deviation` from each weapon it takes (`0x006d71be`, `0x006d71d9`): at most
 * two, one with the same template name as the one before skipped
 * (`0x006d7134`-`0x006d7157`, `std::operator==` against the last name). The
 * last write stands, so the cross is the second weapon's when the seat has
 * one: a Sherman driver's is his coax's, 3.75 units open at rest, and his
 * cannon's own nothing (XHIT-15). Plain loop: the page asks every frame.
 */
export function crossGunOf(nodes) {
  let gun = null;
  let previous = null;
  let taken = 0;
  for (const node of nodes ?? []) {
    if (!node?.userData?.fireArms) continue;
    // GLTFLoader suffixes a repeated node name `_1`, `_2` ...
    const name = String(node.name ?? '').toLowerCase().replace(/_\d+$/, '');
    if (name === previous) continue;
    previous = name;
    gun = node;
    if (++taken === 2) break;
  }
  return gun;
}

/**
 * Splice one more handler onto a `GunFire` instance's single `onShot` slot,
 * without disturbing whatever is already wired there (map.html's own hand
 * weapon fire sound/ammo, which already no-ops for any group that is not the
 * hand weapon's own -- see its comment "onShot fires for vehicle guns too, so
 * the group is checked first"). Idempotent per instance: calling it twice
 * would chain the same extra handler twice, so callers guard it with their
 * own once-per-`GunFire` flag.
 */
export function chainOnShot(gunsInstance, extra) {
  const previous = gunsInstance.onShot;
  // `rounds` is what the pull actually cost (BOMB-1); forwarded so a handler
  // that spends ammunition gets it, and ignorable by every handler that does
  // not care (the fire sound, the viewmodel's cycle).
  gunsInstance.onShot = (group, rounds) => {
    previous?.(group, rounds);
    extra(group, rounds);
  };
}
