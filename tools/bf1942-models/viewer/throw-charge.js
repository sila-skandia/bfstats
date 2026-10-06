// A grenade's charge: the alt-fire throw (ledger GUN-19, GUN-14).
//
// Every grenade declares `velocityDependentOnHeat 1`, which turns its
// `heatAddWhenFire 0.03` from an overheat into the strength of the throw. The
// fire button throws at full strength (message 6 sets the heat to 1.0). The
// alt-fire button charges: while it is held, each 1/30 s tick adds
// `heatAddWhenFire`, capped at 1, so a grenade is full after 34 ticks. Let go,
// the next tick pulls the trigger, and `fireBarrel` launches the round at
// `velocity × heat`. The heat is back to 0 once the round has left.
//
// The ticks wait while a throw is already under way: a shot pending its
// `fireDelay` wind-up, the fire timer and the reload all hold the charge where
// it is (`handleUpdate`'s gates). The soldier HUD draws the heat as the bar
// beside the grenade (GUN-16).

const TICK = 1 / 30;
const RELEASE_ABOVE = 0.01;   // `.rodata` 0x086c08a4

export class ThrowCharge {
  constructor(heatAddWhenFire) {
    this.add = Math.fround(heatAddWhenFire || 0);
    this.heat = 0;
    this.clock = 0;           // seconds owed to the next tick
  }

  /**
   * One frame of `handleUpdate`'s branch for the weapon. `held` is the
   * alt-fire button, `ready` that no throw is pending and neither timer runs.
   * Answers true on the tick a let-go button pulls the trigger: the caller
   * starts the throw, and the round takes `heat` as its strength.
   */
  step(dt, held, ready) {
    for (this.clock += dt; this.clock >= TICK - 1e-9; this.clock -= TICK) {
      if (!ready) continue;
      if (held) {
        const charged = Math.fround(this.heat + this.add);
        this.heat = charged > 1 ? 1 : charged;
      } else if (this.heat > RELEASE_ABOVE) {
        this.clock = Math.max(0, this.clock - TICK);
        return true;
      }
    }
    return false;
  }

  /** The fire button's pull: message 6 sets the heat to 1.0. */
  full() {
    this.heat = 1;
  }

  /** The round has left: its strength, and the heat back to 0 (`Fire`). */
  spend() {
    const strength = this.heat;
    this.heat = 0;
    return strength;
  }
}
