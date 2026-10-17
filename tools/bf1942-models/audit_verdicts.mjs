// Verdicts of the behaviour audit (`audit_behaviour.mjs`), kept apart from the
// harness so a node test can pin them without a browser.
//
// Steering (`testGround`). Every turn here is measured to the right: `rightTurn(a, b)` is the angle the
// nose went from frame `a` to frame `b`, positive when it swung towards `a`'s
// right vector. The hull's own yaw rate before D is pressed is measured the same
// way and taken off what follows, so a hull still swinging from a knock (a horse
// that struck something 3.5 s off its pad, fell from 11.3 to 0.4 m/s and slewed
// left with no key down) does not read as one whose D steers left.

const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const clamp1 = x => Math.max(-1, Math.min(1, x));

/** Signed angle in radians the nose turned to the right from axes `a` to `b`. */
export function rightTurn(a, b) {
  return Math.asin(clamp1(dot3(b.forward, a.right)));
}

/** Yaw rate (rad/s, positive right) at or above which a hull is still slewing
 *  and the press of D waits for it to settle. */
export const SETTLE_RATE = 0.2;

/**
 * The verdict on a D press.
 *
 *  preRate   yaw rate to the right before D (rad/s), from two frames 0.5 s apart
 *  turnA     right turn over the first `dtA` seconds of D (rad)
 *  dtA       seconds between the press and `turnA`'s frame
 *  turned    absolute heading change over the whole hold (rad)
 *  speed     ground speed at the end of the hold (m/s)
 *
 * Returns { verdict: 'ok'|'reversed'|'no-steer'|'unsettled'|'slow', induced }.
 * `induced` is the right turn D added to what the hull was already doing.
 */
export function steerVerdict({ preRate = 0, turnA, dtA = 1, turned, speed }) {
  const induced = turnA - preRate * dtA;
  if (!(speed > 1.5 || turned > 0.05)) return { verdict: 'slow', induced };
  if (speed > 3 && Math.abs(turnA) > 0.1 && induced < -0.15) {
    // A hull still slewing hard left when D went down: the left swing can
    // outlast the press however the steering works, so the press proves
    // nothing either way. Reported for a rerun, not as a reversed steer.
    if (preRate <= -SETTLE_RATE) return { verdict: 'unsettled', induced };
    return { verdict: 'reversed', induced };
  }
  if (speed > 3 && turned < 0.02) return { verdict: 'no-steer', induced };
  return { verdict: 'ok', induced };
}

/**
 * Why an aim axis cannot move by its own data, or null (`testSeatsAndGuns`;
 * a row of `__aimSeat`). The servo is GUN-2b's (`turret-rig.js` `step`): with
 * no `maxSpeed` and no continuous rotation the input buys no rate, an
 * `automaticReset` axis ramps to `input * max` and so stays home when `max` is
 * 0, and a range that does not wrap (`free` is both bounds 0) clamps to its
 * bounds. A carrier's elevator seat declares `setInputToPitch` on a camera
 * rotator whose pitch `setMaxSpeed` is 0.
 */
export function heldByData(a) {
  if (!a || a.maxSpeed === undefined) return null;
  if (a.automaticReset) return a.max ? null : 'automaticReset towards a max of 0';
  if (!a.maxSpeed && !a.continuous) return 'maxSpeed 0 and no continuous rotation';
  if (!a.free && a.min === a.max) return `range ${a.min}..${a.max}`;
  return null;
}
