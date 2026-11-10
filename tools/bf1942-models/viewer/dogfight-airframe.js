// What an airframe does on the flight law, measured the same way for any
// plane a page has loaded (features/dogfight-doctrine-1991, "Measured on the
// pair on stage"): its level speed at a held height, how fast a full pull
// brings its nose round at three speeds, and whether it can stand on its
// tail. The jets' rules card reads the two planes on stage with it, so its
// words are theirs and not a table's; a propeller fighter measures the same
// way.
//
// The pull and the climb use no pilot: the stick is held hard back from
// wings level, and the climb starts with the nose already up. The school's
// hands (`dogfight-flight.js`) were tuned on a Spitfire and fly some
// airframes badly (the Albatros, features/dogfight-doctrine; the F-16 rolls
// for four seconds before it pulls up), and a number that is the hand's is
// not the airframe's. Only level flight is hand-held, by a slow nose hold.
//
// Pure: `makePlane()` builds an `Aircraft` (`aircraft.js`). About 2,500
// ticks a plane.

import { stateOf, pointNose, basis, len } from './dogfight-flight.js';
import { placePlane, DUEL_DT } from './dogfight-duel.js';

/** Where and how long each run is flown. */
export const AIRFRAME = Object.freeze({
  // Everything starts at this height (m): a third of the way to the 1000 m
  // lift ceiling, where most of a fight on the Range is.
  height: 300,
  // Level: from `levelFrom` m/s at full throttle for `levelFor` s, the
  // speed averaged over the last `levelOver` s.
  levelFrom: 90, levelFor: 60, levelOver: 10,
  // The pull: the stick hard back from wings level at each of these speeds
  // (m/s), the best pitch rate inside `pullFor` s.
  pullAt: [60, 100, 140], pullFor: 1.5,
  // Straight up: started nose up at the level speed and held there for
  // `upFor` s; under `stall` m/s the plane has run out of speed.
  upFor: 10, stall: 20,
});

const r1 = v => Math.round(v * 10) / 10;

/**
 * An airframe's numbers: `{ level, pull: [{ speed, rate, radius }], up: {
 * stalls, at, gained, speed } }`. `level` is its speed (m/s) flying level at
 * `AIRFRAME.height`; `pull` the pitch rate (deg/s) a full pull reaches at
 * each speed, and the circle that rate would fly (m); `up` what standing on
 * its tail from the level speed does: `stalls` when it falls under
 * `AIRFRAME.stall` (at `at` s, having `gained` m), else the speed it still
 * holds going up after `upFor` s. Null when the plane cannot be built or
 * flown.
 */
export function measureAirframe(makePlane, A = AIRFRAME) {
  try {
    const start = (speed, pitchDeg = 0) => {
      const p = makePlane();
      p.groundHeight = () => 0;
      return placePlane(p, { at: [0, A.height, 0], headingDeg: 0, pitchDeg, speed });
    };
    const stick = (p, k) => {
      p.setInput('c_PIPitch', k.pitch); p.setInput('c_PIRoll', k.roll); p.setInput('c_PIYaw', k.rudder);
      p.setInput('c_PIThrottle', 1);
    };
    // Level: the nose held a little above or below the horizon, by the
    // height's error and the climb.
    const lv = start(A.levelFrom);
    const speeds = [], mem = {};
    for (let i = 0; i < Math.round(A.levelFor / DUEL_DT); i++) {
      const s = stateOf(lv.state);
      const up = Math.max(-0.25, Math.min(0.25, (A.height - s.position[1]) * 0.004 - s.velocity[1] * 0.02));
      stick(lv, pointNose(s, [0, up, -1], { fine: 8, mem, dt: DUEL_DT }));
      lv.integrate(DUEL_DT);
      if (i * DUEL_DT > A.levelFor - A.levelOver) speeds.push(len(stateOf(lv.state).velocity));
    }
    const level = speeds.reduce((a, b) => a + b, 0) / speeds.length;
    if (!Number.isFinite(level) || level < 5) return null;
    // The pull: no hand, the stick hard back.
    const pull = A.pullAt.map(speed => {
      const p = start(speed);
      let best = 0;
      p.setInput('c_PIPitch', -1);
      p.setInput('c_PIThrottle', 1);
      for (let i = 0; i < Math.round(A.pullFor / DUEL_DT); i++) {
        p.integrate(DUEL_DT);
        const s = stateOf(p.state), R = basis(s.orientation).R, w = s.angularVelocity;
        best = Math.max(best, w[0] * R[0] + w[1] * R[1] + w[2] * R[2]);
      }
      const rate = best * 180 / Math.PI;
      return { speed, rate: r1(rate), radius: best > 0.02 ? Math.round(speed / best) : null };
    });
    // Straight up, from the nose already there.
    const up = start(level, 88);
    let stalledAt = null, gained = 0;
    const aim = {};
    for (let i = 0; i < Math.round(A.upFor / DUEL_DT); i++) {
      stick(up, pointNose(stateOf(up.state), [0, 1, 0.02], { fine: 10, mem: aim, dt: DUEL_DT }));
      up.integrate(DUEL_DT);
      const s = stateOf(up.state);
      if (stalledAt === null) {
        gained = s.position[1] - A.height;
        if (len(s.velocity) < A.stall) stalledAt = (i + 1) * DUEL_DT;
      }
    }
    return {
      level: r1(level),
      pull,
      up: { stalls: stalledAt !== null, at: stalledAt === null ? null : r1(stalledAt), gained: Math.round(gained),
            speed: stalledAt === null ? r1(len(stateOf(up.state).velocity)) : null },
    };
  } catch (error) {
    console.warn('dogfight school: measuring an airframe', error);
    return null;
  }
}
