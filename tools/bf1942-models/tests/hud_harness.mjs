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

console.log(JSON.stringify(results));
