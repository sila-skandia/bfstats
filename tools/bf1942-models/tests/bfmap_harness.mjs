// Drives `viewer/bfmap.js` outside a browser and prints one JSON blob.
//
// Same shape as the other harnesses here: `tests/test_bfmap.py` copies the
// viewer module in under its own name, so the file under test is the file the
// page loads, byte for byte. The module imports nothing.

import { CROP_BASE, ZOOM_EASE_RATE, ZOOM_LEVELS, DEFAULT_SPAN,
          stepZoomLevel, zoomTarget, easeZoom, crop, minimapSpan,
          wrapAngle, displayRotation, BfMap } from './bfmap.js';

const results = {};

results.constants = {
  cropBase: CROP_BASE,
  zoomEaseRate: ZOOM_EASE_RATE,
  zoomLevels: ZOOM_LEVELS,
  defaultSpan: DEFAULT_SPAN,
};

// --- the zoom counter ------------------------------------------------------

results.step = {
  // N wraps 0 -> 1 -> 2 -> 0, three levels.
  from0: stepZoomLevel(0),
  from1: stepZoomLevel(1),
  from2: stepZoomLevel(2),
  wrap: [stepZoomLevel(0), stepZoomLevel(1), stepZoomLevel(2), stepZoomLevel(0)],
};

results.target = {
  // +0x48 = level + 0.5.
  l0: zoomTarget(0),
  l1: zoomTarget(1),
  l2: zoomTarget(2),
};

// --- the +0x44 ease --------------------------------------------------------

// A pure exponential: after one frame of dt it has closed (1 - e^(-rate*dt))
// of the gap. Pin the shape and the rate.
results.ease = {
  oneFrame: easeZoom(0, 1, 1 / 60),
  // rate 6: the time constant is 1/6 s; after 1 s it is 1 - e^-6 of the way.
  afterOneSecond: easeZoom(0, 1, 1, 6),
  // A whole second in 60th-second steps reaches the same place (the ease is
  // frame-rate independent in the limit).
  stepped: (() => { let x = 0; for (let i = 0; i < 60; i++) x = easeZoom(x, 1, 1 / 60); return x; })(),
  // A non-positive or junk dt holds the value.
  zeroDt: easeZoom(0.3, 1, 0),
  negDt: easeZoom(0.3, 1, -5),
  nanDt: easeZoom(0.3, 1, NaN),
};

// --- the crop --------------------------------------------------------------

results.crop = {
  // z = 0 (closed), steady state at each level: pow(2.3, level + 0.5).
  closedL0: crop(0, 0.5),
  closedL1: crop(0, 1.5),
  closedL2: crop(0, 2.5),
  // The ratio between adjacent levels is the base itself.
  ratio01: crop(0, 1.5) / crop(0, 0.5),
  ratio12: crop(0, 2.5) / crop(0, 1.5),
  // z = 1 (open) crops by 1 whatever the level: the whole map.
  openL0: crop(1, 0.5),
  openL2: crop(1, 2.5),
  // Mid-transition (z = 0.5) at level 0.
  halfL0: crop(0.5, 0.5),
};

// --- the span (closed widget) ---------------------------------------------

results.span = {
  // Level 0 is the anchor: DEFAULT_SPAN.
  l0: minimapSpan(0.5),
  // Each level divides by the base.
  l1: minimapSpan(1.5),
  l2: minimapSpan(2.5),
  ratio01: minimapSpan(0.5) / minimapSpan(1.5),
  ratio12: minimapSpan(1.5) / minimapSpan(2.5),
  // A custom base anchors level 0 to that base and keeps the 2.3 steps.
  customBaseL0: minimapSpan(0.5, 1),
  customBaseL1: minimapSpan(1.5, 1),
};

// --- the rotation ----------------------------------------------------------

results.wrap = {
  zero: wrapAngle(0),
  pi: wrapAngle(Math.PI),
  negPi: wrapAngle(-Math.PI),
  // Just past PI folds to just past -PI (the shorter winding).
  pastPi: wrapAngle(Math.PI + 0.1),
  // Two full turns is zero.
  twoTurns: wrapAngle(4 * Math.PI),
  // A heading of 3 PI/2 is the same as -PI/2.
  threeHalf: wrapAngle(3 * Math.PI / 2),
};

results.rotation = {
  // Static (the shipped default): always north-up, whatever the heading or z.
  staticClosed: displayRotation(0, 1.0, true),
  staticOpen: displayRotation(1, 1.0, true),
  // Non-static, closed (z = 0): -(1) * wrapped(heading).
  closed: displayRotation(0, 1.0, false),
  // Non-static, open (z = 1): north-up, because (1 - z) = 0.
  open: displayRotation(1, 1.0, false),
  // Mid-transition (z = 0.5): half the heading.
  half: displayRotation(0.5, 1.0, false),
  // The heading is wrapped to the shorter winding first.
  wrappedHeading: displayRotation(0, Math.PI + 0.1, false),
  // Negative heading.
  neg: displayRotation(0, -0.5, false),
};

// --- the state machine -----------------------------------------------------

const m = new BfMap();
results.state = {
  initial: { level: m.zoomLevel, eased: m.zoomEased, span: m.span(), static: m.isStatic },
  // Three N presses walk the counter 0 -> 1 -> 2 -> 0 (the wrap).
  cycleLevels: (() => {
    const levels = [m.zoomLevel];
    for (let i = 0; i < 3; i++) { m.zoomIn(); levels.push(m.zoomLevel); }
    return levels;
  })(),
  // Settled spans at each level (ease to convergence first).
  settled: (() => {
    const out = [];
    for (let level = 0; level < 3; level++) {
      m.zoomLevel = level;
      m.zoomEased = 0;            // start far and ease in
      for (let i = 0; i < 600; i++) m.update(1 / 60);
      out.push(m.span());
    }
    return out;
  })(),
  // The static flag gates the rotation.
  rotationStatic: new BfMap().rotation(0, 1.0),
  rotationDynamic: (() => { const d = new BfMap({ isStatic: false }); return d.rotation(0, 1.0); })(),
  // setStatic flips it.
  setStatic: (() => { const d = new BfMap({ isStatic: false }); d.setStatic(true); return d.rotation(0, 1.0); })(),
};

console.log(JSON.stringify(results));
