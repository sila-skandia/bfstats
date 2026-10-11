// A hand weapon's alternate fire: the FireArms a child of the HandFireArms
// declares on the right button (`setInputFire c_PIAltFire`).
//
// SW's `CommandoKnife` and `EliteKnife` throw on the left button (their own
// magazine of five) and stab on the right (`CommandoKnifeStab`: `fireDelay
// 0.3`, `roundOfFire 1.6`, an invisible round of 0.0665 s at 50 m/s, a reach
// of 3.3 m, `Sounds/knife2.ssc`); RtR's `K98Bayonet` and `No4Bayonet` carry
// `K98BayonetStabFireArm` the same way (`fireDelay 0.12`, `roundOfFire 1.3`).
// The word `altFireOnce` those weapons write is the stab's press edge, not a
// zoom: they have no sight. Until 2026-10-11 the right button toggled a zoom
// on them and the child FireArms was collected and never fired.
//
// One press is one stab. `fireDelay` after it begins the round leaves, and
// the cycle (`1 / roundOfFire`) holds the next press off. It shares nothing
// with the primary's magazine, cool-down or zoom.

/** A seam that fires the round, so a harness can run the machine alone. */
export function createAlt(group, fireArms = {}, name = null) {
  return {
    group,
    name,
    // `throw.fireDelay` is where the exporter files `fireDelay`.
    delay: fireArms.throw?.fireDelay ?? 0,
    cycle: fireArms.roundOfFire > 0 ? 1 / fireArms.roundOfFire : 1,
    cool: 0, wind: 0, pulse: false, shots: 0, held: 0,
  };
}

/** Seconds a pull may be held waiting for its round to exist. */
export const ALT_PULSE_CEILING = 0.25;

/**
 * One frame. `pressed` is a press of the right button waiting to be spent;
 * `ready` whether the weapon may swing now (pointer held, not reloading, not
 * mid-throw). `fire(group, on)` is `guns.setFiring`. Returns `{ began,
 * spent }`: whether this frame started a swing (for its clip and report) and
 * whether it took the press.
 */
export function stepAlt(alt, dt, { pressed = false, ready = true, fire }) {
  alt.cool = Math.max(0, alt.cool - dt);
  if (alt.pulse) {
    // Held until the round it asked for exists (`shots` moved), as a
    // semi-auto trigger's is, with the ceiling for a gun that cannot fire.
    alt.held += dt;
    if (alt.group.shots !== alt.shots || alt.held > ALT_PULSE_CEILING) {
      fire(alt.group, false);
      alt.pulse = false;
    }
  }
  if (alt.wind > 0) {
    alt.wind -= dt;
    if (alt.wind <= 0) {
      alt.wind = 0;
      pull(alt, fire);
    }
    // A press during the wind-up is not banked.
    return { began: false, spent: pressed };
  }
  if (!pressed) return { began: false, spent: false };
  if (!ready || alt.cool > 0 || alt.pulse) return { began: false, spent: true };
  alt.cool = alt.cycle;
  if (alt.delay > 0) alt.wind = alt.delay;
  else pull(alt, fire);
  return { began: true, spent: true };
}

function pull(alt, fire) {
  fire(alt.group, true);
  alt.pulse = true;
  alt.shots = alt.group.shots;
  alt.held = 0;
}

/** Put the alternate fire away (a weapon swap, a holster). */
export function stopAlt(alt, fire) {
  if (!alt) return;
  if (alt.pulse) fire(alt.group, false);
  alt.pulse = false;
  alt.wind = 0;
}
