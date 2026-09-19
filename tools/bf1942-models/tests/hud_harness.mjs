// Drives `viewer/hud.js`'s fill-picture geometry outside a browser and prints
// one JSON blob.
//
// Same shape as the other harnesses here: `tests/test_hud.py` copies the
// viewer module in under its own name, so the file under test is the file the
// page loads, byte for byte. `hud.js` imports nothing at all, and
// `_drawFillPicture` only ever touches the 2D context through `drawImage` and
// a `save`/`beginPath`/`rect`/`clip`/`restore` quartet -- so a recording stub
// is enough to read back exactly which band of the picture the fill was
// clipped to, which is the whole of what the bug was about.

import { Hud, wrapText } from './hud.js';

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

console.log(JSON.stringify(results));
