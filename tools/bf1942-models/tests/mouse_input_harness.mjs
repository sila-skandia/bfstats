// Drives `viewer/mouse-input.js` (and `viewer/seats.js`'s servo behind it)
// outside a browser and prints one JSON blob.
//
// Same shape as the other harnesses here: `tests/test_mouse_input.py` copies
// the viewer modules in under their own names, so the files under test are the
// files the page loads, byte for byte. `mouse-input.js` imports nothing at all;
// `seats.js` needs the vendored three.js, which the test stands up as a
// package.
//
// `Loop` below is a transcription of what `map.html` does per frame
// (`simTicks` / `pumpLook` / `stepTurret`). It is duplicated rather than
// imported because `map.html` is a 11,000-line page, not a module — and
// because the point of these tests is that the arithmetic holds, not that one
// particular file holds it.

import * as THREE from 'three';
import {
  MouseInput, floatToFixed, fixedToFloat, quantiseAxis, rndint, axisScale,
  profileFor, soldierLookDegrees,
  RATE_FACTOR, SENSITIVITY_GAIN, SENSITIVITY_OFFSET, AXIS_RANGE, AXIS_BITS,
  AXIS_STEPS, DECODE_GRANULARITY, DEFAULT_SENSITIVITY, PROFILES,
  SOLDIER_YAW_GAIN, SOLDIER_PITCH_GAIN,
} from './mouse-input.js';
import { TurretAxis } from './seats.js';

const results = {};
const round = (n, places = 6) => Math.round(n * 10 ** places) / 10 ** places;

// The engine's own step (LOOP-1) and its backlog gate (`GameClient::update`
// 0x0048fca8).
const TICK_DT = 1 / 30;
const MAX_BACKLOG = 9;

class Loop {
  constructor(options = {}) {
    this.input = new MouseInput(options);
    this.accum = 0;
    this.pumps = 0;
    this.ticks = 0;
    this.zeroTickFrames = 0;
  }

  /** `map.html`'s `simTicks`. */
  _ticksFor(dt) {
    this.accum += Math.max(0, dt) || 0;
    let n = Math.floor(this.accum / TICK_DT);
    this.accum -= n * TICK_DT;
    if (n > MAX_BACKLOG) { n = 1; this.accum = 0; }
    return n;
  }

  /**
   * One rendered frame: the pointer motion it saw, then the pump, then the
   * ticks it owes. `onTick(axisX, axisY)` runs once per tick with the held
   * pair -- the same value every time, which is the whole point.
   */
  frame(dt, dx, dy, profile, onTick) {
    this.input.accumulate(dx, dy);
    const n = this._ticksFor(dt);
    if (n > 0) {
      this.input.pump(n * TICK_DT, profile);
      this.pumps++;
    } else {
      this.zeroTickFrames++;
    }
    for (let i = 0; i < n; i++) {
      this.ticks++;
      if (onTick) onTick(this.input.x, this.input.y);
    }
    return n;
  }
}

function node(name) {
  const obj = new THREE.Object3D();
  obj.name = name;
  obj.userData = {};
  return obj;
}

// --- the constants, so a change to any of them has to be deliberate --------

results.constants = {
  rateFactor: RATE_FACTOR,
  sensitivityGain: SENSITIVITY_GAIN,
  sensitivityOffset: SENSITIVITY_OFFSET,
  axisRange: AXIS_RANGE,
  axisBits: AXIS_BITS,
  axisSteps: AXIS_STEPS,
  decodeGranularity: DECODE_GRANULARITY,
  soldierYawGain: SOLDIER_YAW_GAIN,
  soldierPitchGain: SOLDIER_PITCH_GAIN,
  defaults: { ...DEFAULT_SENSITIVITY },
  profiles: [...PROFILES],
  tickDt: TICK_DT,
  maxBacklog: MAX_BACKLOG,
};

// --- the scale: `5 * s + 0.1`, and the four shipped profiles ---------------

results.scale = {
  shipped: Object.fromEntries(
    PROFILES.map(p => [p, round(axisScale(DEFAULT_SENSITIVITY[p]), 10)])),
  // The menu slider's own ends.
  atZero: round(axisScale(0), 10),
  atOne: round(axisScale(1), 10),
  // The profile a PCO's `setVehicleCategory` selects (client 0x006d78a5).
  profileFor: {
    onFoot: profileFor(null),
    land: profileFor('land'),
    sea: profileFor('sea'),
    air: profileFor('air'),
    vcLand: profileFor(0),
    vcSea: profileFor(1),
    vcAir: profileFor(2),
    uncategorised: profileFor('anything else'),
  },
};

// --- the wire format -------------------------------------------------------

{
  const trip = v => ({ v, n: floatToFixed(v), out: quantiseAxis(v) });
  results.wire = {
    // `floatToFixed(0, 12, 16)` is 2047, whose raw decode is -0.00390625 --
    // half a least-significant bit of negative bias. `PlayerAction::get`'s
    // `frndint(v*100)/100` is what removes it, and without that every idle
    // axis in the game would creep.
    zeroPacks: floatToFixed(0),
    zeroRawDecode: round(((2 * floatToFixed(0)) / AXIS_STEPS - 1) * AXIS_RANGE, 10),
    zeroRoundTrip: quantiseAxis(0),
    // Saturation, both ways.
    packsAtRange: floatToFixed(AXIS_RANGE),
    packsBelowRange: floatToFixed(-AXIS_RANGE),
    saturatesHigh: quantiseAxis(AXIS_RANGE * 4),
    saturatesLow: quantiseAxis(-AXIS_RANGE * 4),
    // Everything the simulation reads is a multiple of 0.01.
    granularitySamples: [0.003, 0.006, 0.02, 1.0, 1.234, -1.234, 7.777, 15.99]
      .map(v => round(quantiseAxis(v), 10)),
    allAreHundredths: [0.004, 0.006, 1.0, 1.234, -1.234, 7.777, 15.99, 3.3, -9.05]
      .every(v => Math.abs(quantiseAxis(v) * 100 - Math.round(quantiseAxis(v) * 100)) < 1e-9),
    // One step of the 12-bit encoding, which is coarser than the decode's own
    // hundredth: 32/4095 = 0.0078. A hand below half of that vanishes.
    encodingStep: round(2 * AXIS_RANGE / AXIS_STEPS, 8),
    // `fixedToFloat` inverts `floatToFixed` to within one encoding step plus
    // the decode's own snap.
    roundTrips: [0.5, 1.35, 3.85, -2.7, 11.1, -0.75, 6.02]
      .map(v => round(Math.abs(quantiseAxis(v) - v), 6)),
    // The x87 `frndint` rounding mode: nearest, ties to EVEN.
    rndint: [0.5, 1.5, 2.5, -0.5, -1.5, 2.4, 2.6].map(rndint),
    samples: [0, 1, -1, 16, -16, 0.005].map(trip),
  };
}

// --- the rate formula ------------------------------------------------------

{
  const mi = new MouseInput();
  // One frame of exactly one tick, with a hand moving 1000 counts a second.
  mi.accumulate(1000 * TICK_DT, 0);
  const oneTick = mi.pump(TICK_DT, 'landSea');

  // The saturation point: |input| reaches the wire's +-16 at
  // 16 / (0.001 * 1.35) counts a second.
  const shippedScale = axisScale(DEFAULT_SENSITIVITY.landSea);
  const saturationCounts = AXIS_RANGE / (RATE_FACTOR * shippedScale);
  const at = counts => {
    const m = new MouseInput();
    m.accumulate(counts * TICK_DT, 0);
    return m.pump(TICK_DT, 'landSea').x;
  };

  results.rate = {
    thousandCountsLandSea: round(oneTick.x, 10),
    thousandCountsExpected: round(RATE_FACTOR * 1000 * shippedScale, 10),
    saturationCounts: round(saturationCounts, 4),
    justBelowSaturation: round(at(saturationCounts - 200), 4),
    justAboveSaturation: round(at(saturationCounts + 200), 4),
    farAboveSaturation: round(at(saturationCounts * 50), 4),
    farBelowSaturation: round(at(-saturationCounts * 50), 4),
    // The Air profile is 3x the rest for the same hand.
    thousandCountsAir: (() => {
      const m = new MouseInput();
      m.accumulate(1000 * TICK_DT, 0);
      return round(m.pump(TICK_DT, 'air').x, 10);
    })(),
    // Both axes, and the invert flags.
    inverted: (() => {
      const m = new MouseInput({ invertX: true, invertY: true });
      m.accumulate(1000 * TICK_DT, 500 * TICK_DT);
      const v = m.pump(TICK_DT, 'landSea');
      return { x: round(v.x, 10), y: round(v.y, 10) };
    })(),
    // `countsPerPixel` is the one tunable, and it multiplies linearly.
    doubledCountsPerPixel: (() => {
      const m = new MouseInput({ countsPerPixel: 2 });
      m.accumulate(1000 * TICK_DT, 0);
      return round(m.pump(TICK_DT, 'landSea').x, 10);
    })(),
  };
}

// --- a Sherman tower, commanded ------------------------------------------

{
  // `ShermanTower  setMaxSpeed 35/25/0  setAcceleration 1000/0/0`, free.
  const spec = {
    input: 'c_PIMouseLookX', free: true, min: null, max: null,
    maxSpeed: 35, acceleration: 1000, direction: 1,
  };
  // A hand at a steady 1000 counts a second for two seconds at 60 fps.
  const loop = new Loop();
  const axis = new TurretAxis('yaw', node('ShermanTower'), spec);
  const dt = 1 / 60;
  let travel = 0, prev = 0;
  for (let f = 0; f < 120; f++) {
    loop.frame(dt, 1000 * dt, 0, 'landSea', x => {
      axis.setInput(x);
      axis.step(TICK_DT);
      let d = axis.angle - prev;
      if (d > 180) d -= 360; else if (d < -180) d += 360;
      travel += d;
      prev = axis.angle;
    });
  }
  results.sherman = {
    commandedDegPerSec: round(axis.speed, 4),
    expectedDegPerSec: round(35 * RATE_FACTOR * 1000 * axisScale(0.25), 4),
    measuredDegPerSec: round(travel / 2.0, 2),
    // The MG42 for comparison: `setMaxSpeed 70`, so twice the Sherman.
    mg42Expected: round(70 * RATE_FACTOR * 1000 * axisScale(0.25), 4),
  };
}

// --- frame-rate independence ----------------------------------------------
//
// The property the whole design exists for. A turret with an effectively
// instant ramp, so the measurement is of the input stage and not of the servo:
// the total travel for a given amount of hand movement must not depend on how
// the frames were sliced.

{
  const spec = {
    input: 'c_PIMouseLookX', free: true, min: null, max: null,
    maxSpeed: 35, acceleration: 1e9, direction: 1,
  };

  function run(frameDts, totalPixels) {
    const loop = new Loop();
    const axis = new TurretAxis('yaw', node('Turret'), spec);
    const wall = frameDts.reduce((a, b) => a + b, 0);
    let travel = 0, prev = 0;
    for (const dt of frameDts) {
      loop.frame(dt, totalPixels * (dt / wall), 0, 'landSea', x => {
        axis.setInput(x);
        axis.step(TICK_DT);
        let d = axis.angle - prev;
        if (d > 180) d -= 360; else if (d < -180) d += 360;
        travel += d;
        prev = axis.angle;
      });
    }
    // What was actually DELIVERED, which is what the comparison has to be
    // against: a run of whole frames rarely ends exactly on a tick boundary,
    // so the last sliver of hand movement is still sitting in the accumulator
    // waiting for the next pump. That is the engine's behaviour, not a loss --
    // it arrives on the next frame -- so the invariant to check is degrees per
    // delivered count, not degrees per elapsed second.
    const pending = loop.input.pendingPixels.x;
    const delivered = totalPixels - pending;
    return {
      degrees: round(travel, 4),
      pumps: loop.pumps,
      ticks: loop.ticks,
      zeroTickFrames: loop.zeroTickFrames,
      pendingPixels: round(pending, 6),
      deliveredPixels: round(delivered, 6),
      degPerCount: round(travel / delivered, 8),
    };
  }

  const even = hz => Array.from({ length: hz * 2 }, () => 1 / hz);
  // Two seconds of hand movement at 2000 counts a second, sliced three ways.
  const PIXELS = 4000;
  // ...and a deliberately vile slicing: a 200 ms stall (six ticks at once),
  // a run of frames far too short to make a tick, and everything between.
  const uneven = [];
  {
    let total = 0;
    const pattern = [0.2, 0.004, 0.004, 0.004, 0.004, 0.004, 1 / 30, 1 / 144,
                     1 / 144, 0.05, 1 / 60, 1 / 240, 0.017, 0.0031];
    let i = 0;
    while (total < 2 - 1e-9) {
      const dt = Math.min(pattern[i % pattern.length], 2 - total);
      uneven.push(dt);
      total += dt;
      i++;
    }
  }

  results.frameRate = {
    at30: run(even(30), PIXELS),
    at60: run(even(60), PIXELS),
    at144: run(even(144), PIXELS),
    uneven: run(uneven, PIXELS),
    // What the law says it should be, with no loop in the way at all:
    // one count buys `0.001 * scale * maxSpeed` degrees, because the axis is
    // `0.001 * counts/s * scale`, the servo turns at `input * maxSpeed` and
    // the 30 ticks a second each last 1/30 s -- the rates cancel exactly.
    expectedDegPerCount: round(RATE_FACTOR * axisScale(0.25) * 35, 8),
    expectedDegrees: round(RATE_FACTOR * PIXELS * axisScale(0.25) * 35, 4),
    unevenFrameCount: uneven.length,
  };
}

// --- zero-tick frames lose nothing ---------------------------------------

{
  const loop = new Loop();
  // Four frames far too short to make a tick: nothing is pumped, the held
  // value stays where it was, and every count waits.
  const ticksSeen = [];
  for (let i = 0; i < 4; i++) ticksSeen.push(loop.frame(0.004, 20, 0, 'landSea'));
  const beforePump = {
    ticks: ticksSeen,
    heldX: loop.input.x,
    pendingPixels: round(loop.input.pendingPixels.x, 6),
    pumps: loop.pumps,
  };
  // The fifth frame crosses the tick boundary and collects all 100 counts.
  const n = loop.frame(0.02, 20, 0, 'landSea');
  const afterPump = {
    ticks: n,
    heldX: round(loop.input.x, 10),
    pendingPixels: round(loop.input.pendingPixels.x, 6),
    // 100 counts delivered over the one tick the frame owes: the rate is
    // `0.001 * 100 / (1/30) * 1.35`, quantised.
    expected: quantiseAxis(RATE_FACTOR * 100 / TICK_DT * axisScale(0.25)),
  };

  // And a pump with a non-positive dt is the device's own `dt <= 0` gate: the
  // registers are left exactly as they are, and the counts are kept.
  const held = new MouseInput();
  held.accumulate(600, 0);
  held.pump(TICK_DT, 'landSea');
  const beforeGate = held.x;
  held.accumulate(999, 0);
  held.pump(0, 'landSea');
  const gate = {
    unchanged: held.x === beforeGate,
    stillPending: round(held.pendingPixels.x, 6),
  };

  results.zeroTick = { beforePump, afterPump, gate };
}

// --- the soldier's own look ------------------------------------------------

{
  const DEG = Math.PI / 180;
  const per = soldierLookDegrees(1, 1);
  // Degrees of view rotation per mouse count, at the shipped infantry
  // sensitivity: `0.001 * scale * gain * 30` (30 ticks a second, each turning
  // `input * gain` degrees).
  const scale = axisScale(DEFAULT_SENSITIVITY.infantry);
  const yawDegPerCount = RATE_FACTOR * scale * SOLDIER_YAW_GAIN * 30;
  const pitchDegPerCount = RATE_FACTOR * scale * SOLDIER_PITCH_GAIN * 30;

  // The same hand movement, three frame rates: the total view rotation must
  // match, and the pitch must be exactly a third of the yaw.
  function look(frameDts, totalPixels) {
    const loop = new Loop();
    const wall = frameDts.reduce((a, b) => a + b, 0);
    let yaw = 0, pitch = 0;
    for (const dt of frameDts) {
      const share = totalPixels * (dt / wall);
      loop.frame(dt, share, share, 'infantry', (x, y) => {
        const d = soldierLookDegrees(x, y);
        yaw += d.yaw;
        pitch += d.pitch;
      });
    }
    // Per delivered count, for the same reason the turret run measures that:
    // a run of whole frames need not end on a tick boundary.
    const delivered = totalPixels - loop.input.pendingPixels.x;
    return {
      yaw: round(yaw, 4),
      pitch: round(pitch, 4),
      yawPerCount: round(yaw / delivered, 8),
      pitchPerCount: round(pitch / delivered, 8),
    };
  }
  const even = hz => Array.from({ length: hz }, () => 1 / hz);

  results.soldier = {
    perUnit: { yaw: per.yaw, pitch: per.pitch },
    yawIsThreeTimesPitch: per.yaw === per.pitch * 3,
    yawDegPerCount: round(yawDegPerCount, 6),
    pitchDegPerCount: round(pitchDegPerCount, 6),
    // What `map.html`'s old `LOOK_SENS = 0.0022` rad/px came to, for the
    // record: the two are 3.7% apart, which is the only evidence anyone has
    // that a browser pixel is about a mouse count.
    legacyLookSensDegPerPixel: round(0.0022 * 180 / Math.PI, 6),
    at30: look(even(30), 1000),
    at60: look(even(60), 1000),
    at144: look(even(144), 1000),
    expectedYaw: round(1000 * yawDegPerCount, 4),
    expectedPitch: round(1000 * pitchDegPerCount, 4),
    // A tick's worth of yaw in radians, for the page's own units.
    oneUnitYawRadians: round(SOLDIER_YAW_GAIN * DEG, 8),
  };
}

// --- the four console words' model ---------------------------------------
//
// `map.html` registers `game.set{Common,Inf,LandSea,Air}MouseSensitivity`
// against these two methods; this pins what they do, not how they are wired.

{
  const mi = new MouseInput();
  const readBack = {};
  for (const p of PROFILES) readBack[p] = mi.sensitivityFor(p);
  mi.setSensitivity('air', 0.4);
  mi.setSensitivity('infantry', 1.0);
  // No clamp: `ControlSettings::setSensitivity` 0x006eb1a0 is a bare store,
  // so a word given 5 really does buy `5 x 5 + 0.1` = 25.1 and a negative one
  // really does invert the axis. 0..1 is the menu slider's range, not the
  // console word's.
  const aboveMenuRange = mi.setSensitivity('landSea', 5);
  const aboveMenuScale = round(mi.scaleFor('landSea'), 10);
  const belowMenuRange = mi.setSensitivity('common', -3);
  const belowMenuScale = round(mi.scaleFor('common'), 10);
  const rejected = mi.setSensitivity('nosuchprofile', 0.5);
  const ignored = mi.setSensitivity('air', 'not a number');

  results.console = {
    shippedReadBack: readBack,
    afterSet: { ...mi.sensitivity },
    airScaleAfterSet: round(mi.scaleFor('air'), 10),
    infantryScaleAtMax: round(mi.scaleFor('infantry'), 10),
    aboveMenuRange,
    aboveMenuScale,
    belowMenuRange,
    belowMenuScale,
    rejected: rejected === undefined,
    ignoredKeepsValue: ignored,
  };
}

// --- the touch pad's own mapping -----------------------------------------

{
  // A full deflection for a second is `pixelsPerSecond` pixels -- the viewer's
  // own choice, stated in `feedMobileTurretAim`.
  const mi = new MouseInput();
  mi.accumulateDeflection(1, -0.5, TICK_DT, 720);
  const v = mi.pump(TICK_DT, 'landSea');
  results.pad = {
    fullDeflection: round(v.x, 10),
    halfDeflectionInverted: round(v.y, 10),
    // Identical to a hand moving 720 counts a second.
    sameAsSevenTwenty: (() => {
      const m = new MouseInput();
      m.accumulate(720 * TICK_DT, 0);
      return round(m.pump(TICK_DT, 'landSea').x, 10);
    })(),
  };
}

process.stdout.write(JSON.stringify(results, null, 2));
