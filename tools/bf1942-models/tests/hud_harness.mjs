// Drives `viewer/hud.js`'s fill-picture geometry outside a browser and prints
// one JSON blob.
//
// Same shape as the other harnesses here: `tests/test_hud.py` copies the
// viewer module in under its own name, so the file under test is the file the
// page loads, byte for byte. `hud.js` imports nothing at all, and
// `_drawFillPicture` only ever touches the 2D context through `drawImage` and
// a `save`/`beginPath`/`rect`/`clip`/`restore` quartet -- so a recording stub
// is enough to read back exactly which band of the picture the fill was
// clipped to, which is the whole of what the bug was about. `soldier-hud.js`
// is copied in beside it (it imports only `hud.js`) for the damage
// indicator's clock.

import {
  Hud, wrapText, AMMO_TYPE_CODES, AMMO_TYPES_WITH_ROUNDS, calculateHitOctant, prepareElement,
  hitFromDirAlpha, hitFromDirOctant, hitFromDirOctantAxes, paintOrder, PAINT_ORDER,
} from './hud.js';
import { createSoldierHud } from './soldier-hud.js';

function recordingContext() {
  const calls = { images: [], clips: [] };
  return {
    calls,
    globalAlpha: 1,
    drawImage(img, ...args) { calls.images.push({ img, args }); },
    save() {}, restore() {}, beginPath() {},
    rect(x, y, w, h) { calls.clips.push([x, y, w, h]); },
    clip() {},
  };
}

/** One `fill-picture` leaf drawn at a given fraction; returns the clip band
 *  the painter chose, or null when it drew only the empty layer. */
function clipFor(el, value) {
  const hud = new Hud({ canvas: null, sprite: () => ({ width: 32, height: 64 }) });
  hud.vars[el.valueVar] = value;
  const ctx = recordingContext();
  const [x, y, w, h] = el.rect;
  hud._drawFillPicture(ctx, el, x, y, w, h);
  return {
    clip: ctx.calls.clips[0] ?? null,
    layers: ctx.calls.images.length,
  };
}

const results = {};

// The vehicle panel's own reload bar, verbatim from `hud-layout.json`: a
// 32x64 rect whose art is only the top 42 texels (measured off
// `reloadtimebar_empty/full_32x64.png`'s opaque rows, 0..41), `fillOrder`
// true like every other top-anchored bar in the file.
const reloadBar = {
  kind: 'fill-picture', rect: [549, 547, 32, 64],
  picture: 'reloadtimebar_empty_32x64', fillPicture: 'reloadtimebar_full_32x64',
  valueVar: 'Ammo/ReloadTime', max: 1.0, size: 42,
  horizontalAlign: false, fillOrder: true,
};
results.reloadBar = {
  full: clipFor(reloadBar, 1.0),
  half: clipFor(reloadBar, 0.5),
  quarter: clipFor(reloadBar, 0.25),
  empty: clipFor(reloadBar, 0),
};

// The soldier health bar, the one leaf a live feed already confirmed: same
// `fillOrder`, but `size == h`, where every candidate formula coincides. Here
// to prove the fix left it untouched.
const healthBar = {
  kind: 'fill-picture', rect: [47, 525, 64, 64],
  picture: 'healthbar_empty_scout_64x64', fillPicture: 'healthbar_full_assault_64x64',
  valueVar: 'Soldier/SoldierHitPoints', max: 30, size: 64,
  horizontalAlign: false, fillOrder: true,
};
results.healthBar = {
  full: clipFor(healthBar, 30),
  half: clipFor(healthBar, 15),
  sliver: clipFor(healthBar, 1),
};

// The hand weapon's magazine bar: the file's only `fillOrder: false` leaf,
// and the only one whose art is bottom-anchored (`magbar_rifle_*`'s opaque
// rows are 44..63, exactly its `size: 20`). Unchanged by the fix.
const magBar = {
  kind: 'fill-picture', rect: [696, 517, 32, 64],
  picture: 'magbar_rifle_empty_32x64', fillPicture: 'magbar_rifle_full_32x64',
  valueVar: 'Ammo/PrimaryAmmo', max: 10, size: 20,
  horizontalAlign: false, fillOrder: false,
};
results.magBar = {
  full: clipFor(magBar, 10),
  half: clipFor(magBar, 5),
};

// --- text wrapping -----------------------------------------------------
// The combat-area warning is the first leaf whose string does not fit its own
// rect. A fixed-width stand-in font keeps the arithmetic readable: every
// glyph advances 5 units, so a word of N characters measures 5N and a line of
// K words measures 5*(chars + spaces).
const fixed = { meta: { lineHeight: 11, glyphs: {} } };
for (let code = 32; code < 127; code++) fixed.meta.glyphs[code] = [0, 5, 0, 8, 0, 0, 5, 8];

results.wrap = {
  // 230 px at 5 px a glyph is 46 characters a line.
  warning: wrapText(fixed, 'Warning! You are leaving the combat area! '
    + 'Desserters will be shot!', 230),
  // A string that already fits comes back as one line, untouched.
  short: wrapText(fixed, '30', 230),
  exact: wrapText(fixed, 'a'.repeat(46), 230),
  overByOne: wrapText(fixed, `${'a'.repeat(46)} b`, 230),
  // A single word wider than the box overflows rather than being split.
  longWord: wrapText(fixed, 'a'.repeat(120), 230),
  longWordThenMore: wrapText(fixed, `${'a'.repeat(120)} tail`, 230),
  empty: wrapText(fixed, '', 230),
};

// --- `when` comparisons ------------------------------------------------
// Every operator `extract_hud_layout.py` can emit, driven through the real
// `_visible`. `gt` and `ge` were the two the evaluator did not answer, so
// they fell through to the permissive default and drew leaves that should
// have been culled: the combat-area warning over every level's HUD at a
// countdown of zero, and the weapon-select bar's fifth and sixth slots on a
// four-item kit.
function visibleUnder(when, vars) {
  const hud = new Hud({ canvas: null, sprite: () => null });
  Object.assign(hud.vars, vars);
  // `_requiredVars` is normally filled by `prepareElement` at load time; the
  // gate under test is the `when` list, not the content-var check.
  return hud._visible({ when, _requiredVars: [] });
}

const outsideGate = [{ var: 'Outside/OutsideTime', op: 'gt', value: 0 }];
const slotFive = [
  { var: 'Weapon/SelectingWeapon', op: 'eq', value: true },
  { var: 'Weapon/NumberOfItems', op: 'ge', value: 5 },
];
results.conditions = {
  // The combat-area warning: culled at 0, drawn from 1 up.
  outsideAtZero: visibleUnder(outsideGate, { 'Outside/OutsideTime': 0 }),
  outsideAtOne: visibleUnder(outsideGate, { 'Outside/OutsideTime': 1 }),
  outsideAtTen: visibleUnder(outsideGate, { 'Outside/OutsideTime': 10 }),
  // The weapon bar's fifth slot: only for a kit that has five items.
  slotFiveWithFour: visibleUnder(slotFive,
    { 'Weapon/SelectingWeapon': true, 'Weapon/NumberOfItems': 4 }),
  slotFiveWithFive: visibleUnder(slotFive,
    { 'Weapon/SelectingWeapon': true, 'Weapon/NumberOfItems': 5 }),
  slotFiveWithSix: visibleUnder(slotFive,
    { 'Weapon/SelectingWeapon': true, 'Weapon/NumberOfItems': 6 }),
  // The operators that already worked, so the fix is shown not to move them.
  ltTrue: visibleUnder([{ var: 'n', op: 'lt', value: 5 }], { n: 4 }),
  ltFalse: visibleUnder([{ var: 'n', op: 'lt', value: 5 }], { n: 5 }),
  leTrue: visibleUnder([{ var: 'n', op: 'le', value: 5 }], { n: 5 }),
  eqTrue: visibleUnder([{ var: 'n', op: 'eq', value: true }], { n: true }),
  neTrue: visibleUnder([{ var: 'n', op: 'ne', value: 0 }], { n: 3 }),
  // A nested and/or still recurses through the new operators.
  nested: visibleUnder([{ op: 'or', terms: [
    { var: 'a', op: 'gt', value: 2 },
    { var: 'b', op: 'ge', value: 7 },
  ] }], { a: 1, b: 7 }),
  nestedFalse: visibleUnder([{ op: 'or', terms: [
    { var: 'a', op: 'gt', value: 2 },
    { var: 'b', op: 'ge', value: 7 },
  ] }], { a: 1, b: 6 }),
};

// --- the turret dial's rotation sense (VHUD-9) -------------------------------
//
// `RotateEffect` is counter-clockwise on the HUD's y-down frame (client
// `0x007edbf0`: `x' = x·cos + y·sin`, `y' = -x·sin + y·cos`, so `(0,-1)` at
// +90 degrees becomes `(-1,0)` -- top to left). Canvas `rotate(+θ)` is
// clockwise, so `_drawPicture` has to negate. The whole of the test is: feed
// the engine's own angle and watch where the top of the sprite lands.

/** The dial's rotating body, verbatim from `hud-layout.json` (VHUD-7: a 32x32
 *  at (410,550), the one element in the file carrying a `RotateEffect`). */
const dialBody = {
  kind: 'picture', rect: [410, 550, 32, 32],
  texture: 'icon_tank_turn_body_32x32',
  rotation: { angle: 0, angleVar: 'IconLookRotation', angleMultiplier: 0 },
};

/** Paint the dial at one angle and report where the sprite's top-centre
 *  texel ends up in screen space. A recording context composes the same
 *  translate/rotate the painter issues. */
function dialTopAt(angle) {
  const hud = new Hud({ canvas: null, sprite: () => ({ width: 32, height: 32 }) });
  hud.vars.IconLookRotation = angle;
  const [x, y, w, h] = dialBody.rect;
  // A zero angle takes `_drawPicture`'s plain path: no transform at all, the
  // sprite straight down at its rect. Seed the frame with that so every angle
  // is reported in the same screen coordinates.
  let tx = x + w / 2, ty = y + h / 2, theta = 0;
  const ctx = {
    globalAlpha: 1,
    save() {}, restore() {},
    translate(cx, cy) { tx = cx; ty = cy; },
    rotate(a) { theta = a; },
    drawImage() {},
  };
  hud._drawPicture(ctx, dialBody, x, y, w, h, { width: 32, height: 32 });
  // The sprite's own top-centre sits at (0, -h/2) in the rotated frame.
  const px = 0 * Math.cos(theta) - (-h / 2) * Math.sin(theta) + tx;
  const py = 0 * Math.sin(theta) + (-h / 2) * Math.cos(theta) + ty;
  return {
    canvasRotation: Number(theta.toFixed(6)),
    topX: Number(px.toFixed(3)),
    topY: Number(py.toFixed(3)),
  };
}

const HALF_PI = Math.PI / 2;
results.turretDial = {
  centre: [dialBody.rect[0] + 16, dialBody.rect[1] + 16],
  atZero: dialTopAt(0),
  // The engine's +90 degrees: counter-clockwise, so the top goes LEFT.
  atPlus90: dialTopAt(HALF_PI),
  atMinus90: dialTopAt(-HALF_PI),
  // An unrotated leaf must still take the cheap path, no transform at all.
  unrotatedTakesThePlainPath: (() => {
    const hud = new Hud({ canvas: null, sprite: () => ({ width: 32, height: 32 }) });
    let rotated = false;
    const ctx = {
      globalAlpha: 1, save() {}, restore() {},
      translate() { rotated = true; }, rotate() { rotated = true; },
      drawImage() {},
    };
    hud._drawPicture(ctx, { kind: 'picture', rect: [0, 0, 8, 8] }, 0, 0, 8, 8,
                     { width: 8, height: 8 });
    return !rotated;
  })(),
};

// --- the seat-occupancy dots' placement (VHUD-11, VHUD-7) --------------------

/** Seat 0's leaf, verbatim from `hud-layout.json` (`test_hud_layout.py` has
 *  the same rect and the same pair of variable names). */
const seatZero = {
  kind: 'occupied-seat', position: 0, rect: [247, 457, 8, 8],
  dataRef: 'Occupied/OccupiedData',
  posVar: { x: 'Vehicle/VehiclePos/VehiclePosX1', y: 'Vehicle/VehiclePos/VehiclePosY1' },
};

function dotAt(vars) {
  const hud = new Hud({ canvas: null, sprite: () => ({ width: 8, height: 8 }) });
  Object.assign(hud.vars, vars);
  const [x, y] = seatZero.rect;
  // Copied: the painter hands back a shared scratch pair so six leaves cost
  // no allocation per frame, and holding it would alias every case below.
  const at = hud.seatDotPosition(seatZero, x, y);
  return at && [at[0], at[1]];
}

results.seatDots = {
  layoutRect: seatZero.rect,
  // Sherman's root declares `setVehicleIconPos 54/103`, and VHUD-7 anchors
  // the dots at (192, 452) -- so this one lands at (246, 555), inside the
  // 128x128 icon panel that starts at (200, 462).
  shermanRoot: dotAt({
    'Vehicle/VehiclePos/VehiclePosX1': 54,
    'Vehicle/VehiclePos/VehiclePosY1': 103,
  }),
  // `shermanBrowning_PCO1`'s own 32/61.
  shermanGunner: dotAt({
    'Vehicle/VehiclePos/VehiclePosX1': 32,
    'Vehicle/VehiclePos/VehiclePosY1': 61,
  }),
  // A scene baked before `setVehicleIconPos` was parsed feeds nothing. The
  // leaf's own rect is that variable pair's authored placeholder, not a seat
  // position, so the dot is not drawn at all.
  unfed: dotAt({}),
  halfFed: dotAt({ 'Vehicle/VehiclePos/VehiclePosX1': 54 }),
  // ...and nothing reaches the canvas for it, which is the claim that
  // actually matters: `_drawOccupiedSeat` must return before `drawImage`.
  unfedDrawsNothing: (() => {
    const hud = new Hud({ canvas: null, sprite: () => ({ width: 8, height: 8 }) });
    hud.vars['Occupied/OccupiedData'] = [1, 2, 2, 2, 2, 2];
    let drawn = 0;
    const ctx = { globalAlpha: 1, save() {}, restore() {}, translate() {},
                  rotate() {}, drawImage() { drawn++; } };
    const [x, y, w, h] = seatZero.rect;
    hud._drawOccupiedSeat(ctx, seatZero, x, y, w, h);
    return drawn;
  })(),
  fedDrawsOne: (() => {
    const hud = new Hud({ canvas: null, sprite: () => ({ width: 8, height: 8 }) });
    hud.vars['Occupied/OccupiedData'] = [1, 2, 2, 2, 2, 2];
    hud.vars['Vehicle/VehiclePos/VehiclePosX1'] = 54;
    hud.vars['Vehicle/VehiclePos/VehiclePosY1'] = 103;
    const at = [];
    const ctx = { globalAlpha: 1, save() {}, restore() {}, translate() {},
                  rotate() {}, drawImage(_img, px, py) { at.push([px, py]); } };
    const [x, y, w, h] = seatZero.rect;
    hud._drawOccupiedSeat(ctx, seatZero, x, y, w, h);
    return at;
  })(),
  // A leaf that binds no pair at all never claimed to be placed by a
  // variable, so it keeps its own rect.
  noBinding: (() => {
    const hud = new Hud({ canvas: null, sprite: () => ({ width: 8, height: 8 }) });
    const { posVar, ...bare } = seatZero;
    const at = hud.seatDotPosition(bare, bare.rect[0], bare.rect[1]);
    return at && [at[0], at[1]];
  })(),
};

// --- the soldier ammo panel's type enum (HUD-10) -----------------------------
//
// The `when` list below is transcribed VERBATIM from vanilla `menu/InGame`'s
// own `Ammo/PrimaryAmmo` rounds text in the `{2,3,4,5}` panel --
// `tests/test_hud_layout.py` asserts the transcription still matches the real
// archive, so this can run `hud.js`'s real `_visible` against it without a
// game install. The three gating leaves (`ShowSoldierIcon`,
// `ShowWeaponIcon`, not-`ShowVehicleIcon`) are dropped; only the AmmoType
// arithmetic is under test.
const ROUNDS_TEXT_WHEN = [
  { op: 'or', terms: [
    { op: 'or', terms: [
      { var: 'Ammo/AmmoType', op: 'eq', value: 2 },
      { var: 'Ammo/AmmoType', op: 'eq', value: 5 },
    ] },
    { op: 'or', terms: [
      { var: 'Ammo/AmmoType', op: 'eq', value: 3 },
      { var: 'Ammo/AmmoType', op: 'eq', value: 4 },
    ] },
  ] },
  { var: 'Ammo/AmmoType', op: 'ne', value: 4 },
  { var: 'Ammo/AmmoType', op: 'ne', value: 5 },
  { var: 'Ammo/AmmoType', op: 'ne', value: 6 },
];

results.ammoType = {
  codes: AMMO_TYPE_CODES,
  withRounds: [...AMMO_TYPES_WITH_ROUNDS].sort(),
  // Every vanilla hand weapon's own `setHudAmmoType`, surveyed out of
  // `Objects.rfa` this round, mapped through the table.
  bazooka: AMMO_TYPE_CODES.aticon,
  thompson: AMMO_TYPE_CODES.atammobar,
  grenade: AMMO_TYPE_CODES.aticonandstrengthbar,
  repairPack: AMMO_TYPE_CODES.aticonandreloadbar,
  medPack: AMMO_TYPE_CODES.aticonandheatbar,
  knife: AMMO_TYPE_CODES.atnone,
  // Which types the layout's rounds text actually admits, run through the
  // painter's own condition evaluator.
  roundsTextAdmits: [0, 1, 2, 3, 4, 5, 6, 7]
    .filter(n => visibleUnder(ROUNDS_TEXT_WHEN, { 'Ammo/AmmoType': n })),
  roundsTextWhen: ROUNDS_TEXT_WHEN,
};

// --- the crosshair's hit marks (XHIT-1, XHIT-7) ------------------------------
//
// Four 1x3 / 3x1 fills at the corners of the 20x20 crosshair box, turned 0.8
// rad counter-clockwise about their own centres, in the crosshair colour, at
// alpha `CrossHair/HitIndicationTime`. The leaves are verbatim from
// `hud-layout.json`. A recording context composes the painter's own
// translate/rotate and reports each quad's long axis as a segment in the
// 800x600 frame, which is what the capture's diagonals are.

const MARK_BINDINGS = {
  colorVars: {
    r: { var: 'CrossHair/CrossHairRed', div: 256 },
    g: { var: 'CrossHair/CrossHairGreen', div: 256 },
    b: { var: 'CrossHair/CrossHairBlue', div: 256 },
    a: { var: 'CrossHair/CrossHairAlpha' },
  },
  alphaVars: ['CrossHair/HitIndicationTime'],
  rotation: { angle: 0.800000011920929, angleMultiplier: 0 },
};
const MARK_WHEN = [
  { var: 'CrossHair/ShowCrossHair', op: 'eq', value: true },
  { var: 'Submarine/ShowPeriscope', op: 'ne', value: true },
];
const hitMarks = [[387, 288, 1, 3], [408, 289, 3, 1], [387, 310, 3, 1], [409, 309, 1, 3]]
  .map(rect => ({ kind: 'fill', rect, color: [0.0039, 0.0039, 0.0039, 1], when: MARK_WHEN, ...MARK_BINDINGS }));

function paintMark(el, vars) {
  const hud = new Hud({ canvas: null, sprite: () => null });
  Object.assign(hud.vars, vars);
  const drawn = [];
  let tx = 0, ty = 0, theta = 0;
  const ctx = {
    globalAlpha: 1, fillStyle: '',
    save() {}, restore() { tx = 0; ty = 0; theta = 0; },
    translate(x, y) { tx = x; ty = y; },
    rotate(a) { theta = a; },
    fillRect(x, y, w, h) {
      // Long axis through the quad's centre, mapped back to the frame.
      const cx = x + w / 2, cy = y + h / 2;
      const half = w > h ? [w / 2, 0] : [0, h / 2];
      const map = (px, py) => [
        Number((px * Math.cos(theta) - py * Math.sin(theta) + tx).toFixed(3)),
        Number((px * Math.sin(theta) + py * Math.cos(theta) + ty).toFixed(3)),
      ];
      drawn.push({
        a: map(cx - half[0], cy - half[1]), b: map(cx + half[0], cy + half[1]),
        alpha: Number(this.globalAlpha.toFixed(4)), style: this.fillStyle,
      });
    },
  };
  // `_paintElement` culls through `_visible`, which reads the required list
  // `load()` builds with `prepareElement`.
  hud._paintElement(ctx, prepareElement(el));
  return drawn[0] ?? null;
}

const RED_PROFILE = {
  'CrossHair/ShowCrossHair': true, 'Submarine/ShowPeriscope': false,
  'CrossHair/CrossHairRed': 255, 'CrossHair/CrossHairGreen': 0, 'CrossHair/CrossHairBlue': 0,
};
results.hitMarks = {
  atHit: hitMarks.map(el => paintMark(el, { ...RED_PROFILE, 'CrossHair/HitIndicationTime': 1 })),
  halfWay: paintMark(hitMarks[0], { ...RED_PROFILE, 'CrossHair/HitIndicationTime': 0.5 }),
  atRest: paintMark(hitMarks[0], { ...RED_PROFILE, 'CrossHair/HitIndicationTime': 0 }),
  unfedTimer: paintMark(hitMarks[0], { ...RED_PROFILE }),
  groupHidden: paintMark(hitMarks[0], { ...RED_PROFILE, 'CrossHair/ShowCrossHair': false, 'CrossHair/HitIndicationTime': 1 }),
  periscope: paintMark(hitMarks[0], { ...RED_PROFILE, 'Submarine/ShowPeriscope': true, 'CrossHair/HitIndicationTime': 1 }),
  // The shipped default profile's yellow, unfed alpha channel (never
  // registered by the client, so the file's 1.0).
  yellow: paintMark(hitMarks[0], { ...RED_PROFILE, 'CrossHair/CrossHairGreen': 255, 'CrossHair/HitIndicationTime': 1 }),
  // A layout from before the new fields: a plain unrotated fill in `color`.
  legacyLeaf: paintMark({ kind: 'fill', rect: [387, 288, 1, 3], color: [0.0039, 0.0039, 0.0039, 1], when: MARK_WHEN },
                        { ...RED_PROFILE }),
};

results.hitOctants = {
  front: calculateHitOctant(1.0, 0.0),
  frontRight: calculateHitOctant(0.7, 0.7),
  right: calculateHitOctant(0.0, 1.0),
  rearRight: calculateHitOctant(-0.7, 0.7),
  rear: calculateHitOctant(-1.0, 0.0),
  rearLeft: calculateHitOctant(-0.7, -0.7),
  left: calculateHitOctant(0.0, -1.0),
  frontLeft: calculateHitOctant(0.7, -0.7),
  // The engine tests `0.0 <= r`: a right dot of exactly zero is the right.
  zeroRightFront: calculateHitOctant(0.5, 0),
  zeroRightSide: calculateHitOctant(0, 0),
  zeroRightRear: calculateHitOctant(-0.5, 0),
  justLeft: calculateHitOctant(0.5, -1e-9),
};

// --- the damage indicator: its wash, its arc and its clock (HFD-1..HFD-8) ----

// The octant from a soldier toward the damage's own point. He stands at the
// origin; at yaw 0 he faces +z and the screen's right is -x.
const at = (x, y, z) => ({ x, y, z });
const o = at(0, 0, 0);
results.hitFromDir = {
  yaw0: {
    front: hitFromDirOctant(o, 0, at(0, 0, 10)),
    frontRight: hitFromDirOctant(o, 0, at(-7, 0, 7)),
    right: hitFromDirOctant(o, 0, at(-10, 0, 0)),
    rearRight: hitFromDirOctant(o, 0, at(-7, 0, -7)),
    rear: hitFromDirOctant(o, 0, at(0, 0, -10)),
    rearLeft: hitFromDirOctant(o, 0, at(7, 0, -7)),
    left: hitFromDirOctant(o, 0, at(10, 0, 0)),
    frontLeft: hitFromDirOctant(o, 0, at(7, 0, 7)),
  },
  // Turned a quarter: facing +x, right is +z.
  yawQuarter: {
    front: hitFromDirOctant(o, Math.PI / 2, at(10, 0, 0)),
    right: hitFromDirOctant(o, Math.PI / 2, at(0, 0, 10)),
    left: hitFromDirOctant(o, Math.PI / 2, at(0, 0, -10)),
  },
  // Height counts: a muzzle 1.5 m up and 2 m ahead is 0.8 forward, so the
  // front-right arc, not the front; one straight overhead is the right side.
  closeAndHigh: hitFromDirOctant(o, 0, at(0, 1.5, 2)),
  farAndHigh: hitFromDirOctant(o, 0, at(0, 1.5, 40)),
  overhead: hitFromDirOctant(o, 0, at(0, 10, 0)),
  // On his own origin: the engine's identity look-at, whose +z is this frame's
  // -z -- behind a man facing +z, ahead of one facing -z.
  coincidentFacingPlusZ: hitFromDirOctant(o, 0, at(0, 0, 0)),
  coincidentFacingMinusZ: hitFromDirOctant(o, Math.PI, at(0, 0, 0)),
  // Not at the origin: the direction is the difference, not the source alone.
  offOrigin: hitFromDirOctant(at(100, 5, -40), 0, at(90, 5, -40)),
};

// A hull framed by its own axes (HFD-11): at rest its nose is -z and its
// right +x, as the exporter leaves every vehicle.
const N = at(0, 0, -1), R = at(1, 0, 0);
const DOWN45 = at(0, -Math.SQRT1_2, -Math.SQRT1_2);
let seed = 12345;
const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
let disagree = 0;
for (let i = 0; i < 2000; i++) {
  // The yaw form is this one with forward (sin yaw, 0, cos yaw) and right
  // (-cos yaw, 0, sin yaw), and must answer the same for any case.
  const yaw = rand() * 2 * Math.PI;
  const victim = at(rand() * 200 - 100, rand() * 20, rand() * 200 - 100);
  const source = at(rand() * 200 - 100, rand() * 20, rand() * 200 - 100);
  const s = Math.sin(yaw), c = Math.cos(yaw);
  if (hitFromDirOctant(victim, yaw, source)
      !== hitFromDirOctantAxes(victim, at(s, 0, c), at(-c, 0, s), source)) disagree++;
}
results.hitFromDirAxes = {
  atRest: {
    front: hitFromDirOctantAxes(o, N, R, at(0, 0, -10)),
    frontRight: hitFromDirOctantAxes(o, N, R, at(7, 0, -7)),
    right: hitFromDirOctantAxes(o, N, R, at(10, 0, 0)),
    rearRight: hitFromDirOctantAxes(o, N, R, at(7, 0, 7)),
    rear: hitFromDirOctantAxes(o, N, R, at(0, 0, 10)),
    rearLeft: hitFromDirOctantAxes(o, N, R, at(-7, 0, 7)),
    left: hitFromDirOctantAxes(o, N, R, at(-10, 0, 0)),
    frontLeft: hitFromDirOctantAxes(o, N, R, at(-7, 0, -7)),
  },
  // Nose 45 degrees down: along the nose is the front, level ahead is 45
  // degrees off it, and a right dot of 0 is the right.
  pitchedAlongNose: hitFromDirOctantAxes(o, DOWN45, R, at(0, -10, -10)),
  pitchedLevelAhead: hitFromDirOctantAxes(o, DOWN45, R, at(0, 0, -10)),
  // On the hull's own origin: the identity look-at, this frame's -z, which
  // is a hull at rest's nose.
  coincident: hitFromDirOctantAxes(at(3, 4, 5), N, R, at(3, 4, 5)),
  disagreeWithYaw: disagree,
};

results.hitFromDirAlpha = {
  third: hitFromDirAlpha(10, 30),
  exactCap: hitFromDirAlpha(22.5, 30),
  overCap: hitFromDirAlpha(100, 30),
  none: hitFromDirAlpha(0, 30),
  negative: hitFromDirAlpha(-5, 30),
  zeroOverZero: hitFromDirAlpha(0, 0),
  overZero: hitFromDirAlpha(5, 0),
};

// The wash, verbatim from `hud-layout.json`, and the arc for direction 3.
const WASH_WHEN = [{ var: 'HitFromDir/HitFromDir', op: 'ne', value: 0 }];
const washLeaf = () => ({
  kind: 'fill', rect: [0, 0, 800, 600], color: [1, 0, 0, 0.5], when: WASH_WHEN,
  colorVars: { a: { var: 'HitFromDir/HitFromDirAlpha' } },
});
const arcLeaf = () => ({
  kind: 'picture', rect: [621, -7, 175, 500], color: [1, 0, 0, 0.5],
  when: [...WASH_WHEN, { var: 'HitFromDir/HitFromDir', op: 'eq', value: 3 }],
  colorVars: { a: { var: 'HitFromDir/HitFromDirAlpha' } },
  texture: 'ingame_hit_indicator_64x128',
  rotation: { angle: -3.140000104904175, angleMultiplier: 0 },
});
/** Every fill and picture one leaf paints, with the alpha it was painted at. */
function paintLeaf(el, vars) {
  const hud = new Hud({ canvas: null, sprite: () => ({ width: 64, height: 128 }) });
  Object.assign(hud.vars, vars);
  const drawn = [];
  const ctx = {
    globalAlpha: 1, fillStyle: '',
    save() {}, restore() {}, translate() {}, rotate() {},
    fillRect(x, y, w, h) { drawn.push({ fill: [x, y, w, h], alpha: Number(this.globalAlpha.toFixed(4)), style: this.fillStyle }); },
    drawImage(img, x, y, w, h) { drawn.push({ image: [w, h], alpha: Number(this.globalAlpha.toFixed(4)) }); },
  };
  hud._paintElement(ctx, prepareElement(el));
  return drawn;
}
const hit = (dir, alpha) => ({ 'HitFromDir/HitFromDir': dir, 'HitFromDir/HitFromDirAlpha': alpha });
const legacy = el => { delete el.colorVars; return el; };
results.wash = {
  fed: paintLeaf(washLeaf(), hit(3, 0.545)),
  frontHit: paintLeaf(washLeaf(), hit(1, 0.3)),
  off: paintLeaf(washLeaf(), hit(0, 0.545)),
  unfed: paintLeaf(washLeaf(), {}),
  // A layout from before `colorVars`: the variable replaces the file's 0.5.
  legacy: paintLeaf(legacy(washLeaf()), hit(3, 0.545)),
  arc: paintLeaf(arcLeaf(), hit(3, 0.545)),
  arcOtherSide: paintLeaf(arcLeaf(), hit(7, 0.545)),
  legacyArc: paintLeaf(legacy(arcLeaf()), hit(3, 0.545)),
};

// The groups in the engine's chain order, whatever order the file lists.
const fileOrder = ['soldierIcon', 'soldierAmmo', 'vehicleIcon', 'vehicleHealth', 'vehicleSeats',
  'primaryAmmo', 'secondaryAmmo', 'supplyIcon', 'hitIndicator', 'weaponBar', 'crosshair',
  'tickets', 'outside', 'someModGroup'];
const groups = Object.fromEntries(fileOrder.map(key => [key, { key, elements: [] }]));
results.paintOrder = {
  constant: PAINT_ORDER,
  painted: paintOrder(groups).map(g => g.key),
};

// The clock: `soldier-hud.js` driven frame by frame over a page stub that has
// a body's Armor but no body, so `updateSoldierHud` stops before the stance
// art. Each call is one painted frame, as `frame()` makes it; each entry of a
// run is the `HitFromDir` that frame's paint reads.
function soldierPage() {
  const vars = Object.create(null);
  const page = {
    gameHud: { vars, layout: null, requestRepaint() {} },
    optPilot: { checked: false }, optOnFoot: { checked: true },
    occupancy: null, soldier: null, soldierDead: false,
    soldierArmor: { hitPoints: 30, maxHitPoints: 30 },
    crossHairColor: () => [255, 255, 0],
    feedTicketVars() {}, feedFlagIconVars() {},
    combatArea: { feed() {} }, combatFrame: null,
    handWeapon: null, weaponBarUntil: 0, WEAPON_ICON_VARS: [],
    playSoldierHurtSound() {},
  };
  return { page, vars, hud: createSoldierHud(page) };
}
function run(s, n, dt = 1 / 60) {
  const dirs = [], alphas = [];
  for (let i = 0; i < n; i++) {
    s.hud.updateSoldierHud(dt);
    dirs.push(s.vars['HitFromDir/HitFromDir'] ?? 0);
    alphas.push(s.vars['HitFromDir/HitFromDirAlpha'] ?? null);
  }
  return { dirs, alphas };
}
const clock = {};
{
  const s = soldierPage();
  s.hud.triggerHitIndicator(3, 0.4);
  clock.single = run(s, 8);
}
for (const [name, dt] of [['at144', 1 / 144], ['at20', 1 / 20]]) {
  const s = soldierPage();
  s.hud.triggerHitIndicator(3, 0.4);
  clock[name] = run(s, 8, dt).dirs;
}
{
  // A second hit two frames in turns the arc and sets the alpha, and the
  // flash still ends six frames after the first.
  const s = soldierPage();
  s.hud.triggerHitIndicator(3, 0.4);
  const first = run(s, 2);
  s.hud.triggerHitIndicator(5, 0.2);
  const rest = run(s, 6);
  clock.burst = { dirs: [...first.dirs, ...rest.dirs], alphas: [...first.alphas, ...rest.alphas] };
}
{
  // After the flash, a new hit gets all six frames again.
  const s = soldierPage();
  s.hud.triggerHitIndicator(3, 0.4);
  run(s, 7);
  s.hud.triggerHitIndicator(7, 0.1);
  clock.again = run(s, 8).dirs;
}
{
  // HP lost with nobody raising it (a fall, the combat area): the poll
  // washes the screen at that loss's share of the max, direction 1.
  const s = soldierPage();
  run(s, 1);
  s.page.soldierArmor.hitPoints = 21;
  clock.poll = run(s, 8);
}
{
  // HP lost through `applyDamageToPlayer`, which raised it itself: the poll
  // leaves the arc it chose alone.
  const s = soldierPage();
  run(s, 1);
  s.page.soldierArmor.hitPoints = 20;
  s.hud.triggerHitIndicator(4, 10 / 30);
  clock.raisedOnce = run(s, 8).dirs;
}
{
  // Put out mid-flash (the body is gone): off at once, and the next hit
  // starts its own six frames.
  const s = soldierPage();
  s.hud.triggerHitIndicator(3, 0.4);
  const before = run(s, 3).dirs;
  s.hud.clearHitIndicator();
  const cleared = run(s, 1).dirs;
  s.hud.triggerHitIndicator(6, 0.4);
  clock.cleared = { before, cleared, after: run(s, 8).dirs };
}
results.hitClock = clock;

console.log(JSON.stringify(results));
