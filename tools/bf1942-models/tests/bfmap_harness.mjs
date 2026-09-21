// Drives `viewer/bfmap.js` outside a browser and prints one JSON blob.
//
// Same shape as the other harnesses here: `tests/test_bfmap.py` copies the
// viewer module in under its own name, so the file under test is the file the
// page loads, byte for byte. The module imports nothing.

import { CROP_BASE, ZOOM_EASE_RATE, ZOOM_LEVELS, ZOOM_SNAP, mapCentre,
          stepZoomLevel, zoomTarget, easeZoom, crop, minimapSpan,
          wrapAngle, displayRotation, minimapWindow, rotateAbout, coverRect,
          BfMap } from './bfmap.js';

const results = {};

results.constants = {
  cropBase: CROP_BASE,
  zoomEaseRate: ZOOM_EASE_RATE,
  zoomLevels: ZOOM_LEVELS,
  zoomSnap: ZOOM_SNAP,
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
  // The widget's width covers 1 / crop of the whole map texture.
  l0: minimapSpan(0.5),
  l1: minimapSpan(1.5),
  l2: minimapSpan(2.5),
  ratio01: minimapSpan(0.5) / minimapSpan(1.5),
  ratio12: minimapSpan(1.5) / minimapSpan(2.5),
  // Open (z = 1) it is the whole map whatever the level.
  openL0: minimapSpan(0.5, 1),
  openL2: minimapSpan(2.5, 1),
};

results.centre = {
  // Closed: the player. Open: the middle of the map. Between: the blend.
  closed: mapCentre(0, { u: 0.2, v: 0.9 }),
  open: mapCentre(1, { u: 0.2, v: 0.9 }),
  half: mapCentre(0.5, { u: 0.2, v: 0.9 }),
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

// --- the window, the marker turn and the art cover --------------------------

results.window = {
  // Centred on the player, in the open and at the art's edge alike.
  mid: minimapWindow({ u: 0.5, v: 0.5 }, 0.25),
  corner: minimapWindow({ u: 0.02, v: 0.99 }, 0.25),
};

results.turn = {
  // No rotation is the identity.
  none: rotateAbout(10, 20, 50, 0),
  // The centre never moves.
  centre: rotateAbout(50, 50, 50, 1.234),
  // A point straight above the centre, turned a quarter clockwise (canvas
  // angles: y down, positive clockwise), lands to the right of it.
  quarter: rotateAbout(50, 10, 50, Math.PI / 2),
  // A player heading east (h = PI/2) has the map turned by -h: what lay to
  // his east (right of centre) now reads straight up.
  eastReadsUp: rotateAbout(90, 50, 50, displayRotation(0, Math.PI / 2, false)),
};

results.cover = {
  // Unturned: the window itself, pixel for pixel.
  flat: coverRect(0.25, 0.25, 0.5, 100, 0),
  // An eighth turn needs sqrt(2) of the window about its centre.
  eighth: coverRect(0.25, 0.25, 0.5, 100, Math.PI / 4),
  // Cut to the art at the edge; the destination shrinks with it.
  edge: coverRect(-0.1, 0.0, 0.2, 100, 0),
  // Wholly off the art: nothing to draw.
  off: coverRect(1.5, 1.5, 0.2, 100, 0),
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
  // Within ZOOM_SNAP of the target the ease stores the target outright.
  snaps: (() => { const d = new BfMap(); d.zoomEased = 0.5 + 0.009; d.update(1e-6); return d.zoomEased; })(),
  rotationStatic: new BfMap().rotation(0, 1.0),
  rotationDynamic: (() => { const d = new BfMap({ isStatic: false }); return d.rotation(0, 1.0); })(),
  // setStatic flips it.
  setStatic: (() => { const d = new BfMap({ isStatic: false }); d.setStatic(true); return d.rotation(0, 1.0); })(),
};

console.log(JSON.stringify(results));
