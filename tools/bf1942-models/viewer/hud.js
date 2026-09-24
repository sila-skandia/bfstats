// The in-game HUD, painted from the game's own layout.
//
// `hud-layout.json` (`extract_hud_layout.py`) is `menu/InGame` flattened into
// 11 named regions -- soldierIcon, soldierAmmo, vehicleIcon, vehicleHealth,
// vehicleSeats, primaryAmmo, secondaryAmmo, supplyIcon, hitIndicator,
// weaponBar, crosshair -- each a list of picture/text/fill leaves with the
// file's own rects in an 800x600 virtual screen, sprite names, and the
// CullNode `when` conditions that gate them. It is the same shape
// `spawn-layout.json` already uses for the deploy screen (`condOk`,
// `elementVisible`, `deployScale` in map.html), re-implemented here rather
// than imported so this module stays free-standing and the deploy screen's
// own code path is never touched.
//
// Track P1 (round 2, `features/bf1942-3d-models/in-game-hud.md`) owns this
// file: ONE painter for every group in the layout. It is fed by a single
// plain object -- `vars`, below -- keyed by the engine's own MemeFile
// variable names exactly as the layout binds them, e.g.
//
//     hud.vars['Soldier/SoldierHitPoints'] = 21;
//     hud.vars['Ammo/PrimaryAmmo'] = 14;
//     hud.vars['Vehicle/VehicleIcon'] = 'Vehicle/Icon_defgun.tga';
//
// Every track writes into this same object from its own owned code (P1 feeds
// the soldier-side variables from map.html; P2/seats.js and P3/armor.js and
// supply.js feed the rest once merged). This module never reaches into game
// state itself and never invents a number or a texture path for a variable
// nobody has written: a leaf whose live-state variables are not all present
// in `vars` is culled outright rather than drawn from a guess or the file's
// own literal fallback (see `_requiredVars` below) -- "cull the group rather
// than inventing a value" per the round-2 briefing. A *cosmetic* binding the
// engine itself is confirmed to fall back on when nothing overrides it (a
// bar's texel `Size`, R1-1: `SoldierBarSize` is never written by the client
// at all) keeps the layout's own literal in that case, which is the engine's
// documented behaviour (HUD-1), not an invention.
//
// verify-r1.md (soldier HUD) and verify-r2.md (vehicle/manned-gun HUD) are
// the evidence for every drawing rule below; a rule neither report actually
// confirmed is called out in a comment naming the open claim id (R1-18,
// R1-31, R2-6, R2-18...), never stated as the engine's own behaviour.
//
// Perf (features/mesh-viewer-performance/README.md): the layout and its
// fonts load once in `load()`, never mid-frame (rule 3). `paint()` allocates
// nothing per call (rule 5) -- the flat list of every variable name the
// layout can reference is built once in `load()`, and each frame just reads
// `vars` against it; the canvas is only cleared and redrawn when one of
// those values, or the stage size, actually changed since the call before
// (rule 7).

const DEFAULT_VIRTUAL = [800, 600];

/** The groups in the order `menu/InGame` draws them: its root chain, each
 *  group at its first top's index (ledger HFD-8) -- crosshair 3, supply 6-13,
 *  weaponBar 19, soldierIcon 21, soldierAmmo 22, the vehicle panel 23-26,
 *  tickets 27, hitIndicator 37, outside 42. `hud-layout.json` lists them in
 *  its own order, which put the weapon bar, the crosshair group and the
 *  tickets after the hit indicator; that only mattered once the indicator's
 *  full-screen wash was drawn, because the wash tints everything under it.
 *  A group this list does not name paints last, in file order. */
export const PAINT_ORDER = [
  'crosshair', 'supplyIcon', 'weaponBar', 'soldierIcon', 'soldierAmmo',
  'vehicleIcon', 'vehicleHealth', 'vehicleSeats', 'primaryAmmo', 'secondaryAmmo',
  'tickets', 'hitIndicator', 'outside',
];

/** `groups` in `PAINT_ORDER`, then whatever else the file has. */
export function paintOrder(groups) {
  const known = PAINT_ORDER.filter(key => groups[key]);
  const rest = Object.keys(groups).filter(key => !PAINT_ORDER.includes(key));
  return [...known, ...rest].map(key => groups[key]);
}

/** `Vehicle/Icon_defgun.tga` -> `icon_defgun`, matching how `hud.json` keys
 *  every packed sprite (basename, extension stripped, lowercased) -- the
 *  same convention `extract_hud_pack.py` used, so a live path value and a
 *  layout literal resolve through the identical rule. */
function spriteKeyFromRef(path) {
  if (typeof path !== 'string' || !path) return null;
  const base = path.slice(path.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return (dot > 0 ? base.slice(0, dot) : base).toLowerCase();
}

/** The picture a `variable-picture` or one layer of a `fill-picture` leaf
 *  shows: the live path's own art when the variable is bound and the sprite
 *  pack actually has it, else the layout's literal default -- a resolution
 *  failure (a mod's icon not yet packed) degrades to the authored fallback
 *  art rather than to nothing. */
function resolveTexture(liveValue, literalKey, sprite) {
  if (liveValue !== undefined) {
    const key = spriteKeyFromRef(liveValue);
    const img = key && sprite(key);
    if (img) return img;
  }
  return literalKey ? sprite(literalKey) : null;
}

function collectWhenVars(conds, out) {
  for (const c of conds) {
    if (c.op === 'and' || c.op === 'or') collectWhenVars(c.terms, out);
    else {
      if (c.var) out.add(c.var);
      if (c.value && typeof c.value === 'object' && c.value.var) out.add(c.value.var);
    }
  }
}

/** Every comparison `extract_hud_layout.py` can put in a `when` list.
 *
 *  The extractor's own vocabulary is `EqualData`/`NotEqualData`/`LessData`/
 *  `LessEqualData` (its `ops` table), and it then runs them through `negate`
 *  (`NEG_CMP`) and through the operand flip it applies when the LITERAL is
 *  the left-hand side (`FLIP_CMP`: `lt`->`gt`, `le`->`ge`). So `gt` and `ge`
 *  are as much a part of the format as `lt` and `le` — the combat-area
 *  warning's gate is the MemeFile's `0 < Outside/OutsideTime`, which flips to
 *  `{Outside/OutsideTime, gt, 0}`, and the weapon-select bar's fifth and
 *  sixth slots are `{Weapon/NumberOfItems, ge, 5|6}`.
 *
 *  Both were missing here and fell through to the permissive default, which
 *  does not cull: the warning drew over every level's HUD with a countdown of
 *  zero, and a four-item kit's weapon bar drew six slots.
 *  `tests/test_hud_layout.py` now asserts the extractor cannot emit an
 *  operator this switch does not answer, so the next one cannot fail open.
 *
 *  Only ever called once every var it touches is known to be present
 *  (`_visible`, below), so there is no "what does undefined compare as"
 *  question to answer here. */
function condOk(c, vars) {
  if (c.op === 'and') return c.terms.every(t => condOk(t, vars));
  if (c.op === 'or') return c.terms.some(t => condOk(t, vars));
  const v = vars[c.var];
  const want = (c.value && typeof c.value === 'object') ? vars[c.value.var] : c.value;
  switch (c.op) {
    case 'eq': return v === want || Number(v) === Number(want);
    case 'ne': return !(v === want || Number(v) === Number(want));
    case 'lt': return Number(v) < Number(want);
    case 'le': return Number(v) <= Number(want);
    case 'gt': return Number(v) > Number(want);
    case 'ge': return Number(v) >= Number(want);
    default: return true;
  }
}

/** The variables a leaf's own drawn content depends on -- as opposed to a
 *  `when` gate -- kind by kind. Only fields with no literal counterpart in
 *  the layout are required: a *number* or a *string* has no meaningful
 *  placeholder to fall back to (an unfed `text` var would print the word
 *  "undefined"; an unfed `valueVar` has no fraction to draw), so those cull
 *  the leaf outright. A *texture path* is different -- `max`/`size`/rotation
 *  angle/crosshair radius/deviation, and (fixed here) `variable-picture`'s
 *  own `var` and `fill-picture`'s `pictureVar`/`fillPictureVar`, all name a
 *  live override of something hud-layout.json already carries a literal
 *  sprite key for. Requiring those would mean a weapon or kit that never
 *  overrides its own art (most of them, per verify-r1.md/r2.md's own
 *  surveys) culls the whole leaf instead of drawing the game's own default
 *  picture -- the exact case this round hit first with a hand weapon whose
 *  extraction predates `weaponStats.hud` (magazine bar, absent override) --
 *  so these are deliberately absent here and resolved tolerantly at paint
 *  time instead (`resolveTexture`, HUD-1). */
function contentVarsOf(el) {
  const out = [];
  if (el.kind === 'text' && el.var) out.push(el.var);
  if (el.kind === 'fill-picture' && el.valueVar) out.push(el.valueVar);
  if (el.kind === 'occupied-seat' && el.dataRef) out.push(el.dataRef);
  // A `BfMultiplyColorEffect2` alpha is required, not tolerant: its authored
  // default is an editor preview (the crosshair's `HitIndicationTime` ships
  // as 1.0), and falling back on it would leave the hit marks on screen for
  // good. Unfed, the leaf culls -- the engine's own resting value is 0.
  if (el.alphaVars) out.push(...el.alphaVars);
  return out;
}

const WHITE = [1, 1, 1, 1];
const CHANNELS = ['r', 'g', 'b', 'a'];

/** `el.color` with the leaf's live colour bindings applied, written into
 *  `out` (no allocation per paint). The engine SETS the quad's colour at a
 *  `VariableColorEffect` (client `0x006017c0`), so each bound channel's live
 *  value replaces that channel -- `var / div` for the crosshair's 0-255
 *  channels -- and an unfed channel keeps the layout's own default, as every
 *  other tolerant binding here does (HUD-1). Then each `BfMultiplyColorEffect2`
 *  alpha multiplies in: effects apply innermost first, so the multiply lands
 *  after the set (XHIT-7). A `hud-layout.json` older than these fields has
 *  neither and paints exactly as it always did. */
export function liveColor(el, vars, out) {
  const base = el.color || WHITE;
  for (let i = 0; i < 4; i++) out[i] = base[i];
  const bound = el.colorVars;
  if (bound) {
    for (let i = 0; i < 4; i++) {
      const b = bound[CHANNELS[i]];
      const v = b && vars[b.var];
      if (v === undefined || v === null || v === '') continue;
      const n = Number(v) / (b.div || 1);
      if (Number.isFinite(n)) out[i] = n;
    }
  }
  if (el.alphaVars) {
    for (const name of el.alphaVars) {
      const n = Number(vars[name]);
      out[3] *= Number.isFinite(n) ? n : 0;
    }
  }
  for (let i = 0; i < 4; i++) out[i] = Math.max(0, Math.min(1, out[i]));
  return out;
}

/** Every variable name a leaf's `when` list or drawn content can reference,
 *  gathered once at load so `_visible` never walks the tree at paint time. */
export function prepareElement(el) {
  const set = new Set();
  collectWhenVars(el.when || [], set);
  for (const name of contentVarsOf(el)) set.add(name);
  el._requiredVars = [...set];
  return el;
}

/** The superset used for the frame-to-frame dirty check: every variable
 *  *anywhere* on the leaf, including the tolerant/cosmetic ones -- a weapon
 *  changing its own `Ammo/SoldierAmmo/SoldierAmmoBarSize` should still
 *  trigger a repaint even though it never gates visibility. */
function trackedVarsOf(el, out) {
  collectWhenVars(el.when || [], out);
  for (const key of ['var', 'valueVar', 'maxVar', 'sizeVar', 'pictureVar',
                      'fillPictureVar', 'dataRef', 'radiusVar', 'deviationVar']) {
    if (el[key]) out.add(el[key]);
  }
  if (el.rotation?.angleVar) out.add(el.rotation.angleVar);
  for (const b of Object.values(el.colorVars || {})) out.add(b.var);
  for (const name of el.alphaVars || []) out.add(name);
  if (el.posVar) {
    if (el.posVar.x) out.add(el.posVar.x);
    if (el.posVar.y) out.add(el.posVar.y);
  }
  if (el.texture === 'ingame_hit_indicator_64x128' || (el.when || []).some(w => w.var === 'HitFromDir/HitFromDir')) {
    out.add('HitFromDir/HitFromDirAlpha');
  }
}

/** The glyph atlas in one colour, made once per (font, colour) -- identical
 *  technique to map.html's own `tintedAtlas`, kept local so this module has
 *  no dependency on the deploy screen's state. */
function tintedAtlas(font, rgb) {
  const key = rgb.join(',');
  let c = font.tinted.get(key);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = font.img.width;
  c.height = font.img.height;
  const ctx = c.getContext('2d');
  ctx.drawImage(font.img, 0, 0);
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = `rgb(${rgb.map(v => Math.round(v * 255)).join(',')})`;
  ctx.fillRect(0, 0, c.width, c.height);
  font.tinted.set(key, c);
  return c;
}

function measureText(font, text) {
  let w = 0;
  for (const ch of text) {
    const g = font.meta.glyphs[ch.charCodeAt(0)];
    if (g) w += g[0] + g[1] + g[2];
  }
  return w;
}

/** Greedy word wrap in a bitmap font. A single word wider than the box is
 *  left to overflow rather than split mid-word: the one string this is for
 *  has none, and hyphenating a bitmap font invents glyph metrics.
 *
 *  Exported for `tests/hud_harness.mjs`: everything else in the text path
 *  goes through a tinted glyph atlas, which needs a real canvas, and this is
 *  the part with a decision in it. */
export function wrapText(font, text, width) {
  const words = String(text).split(' ');
  const lines = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (line && measureText(font, next) > width) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function drawBitmapText(ctx, font, text, x, y, rgb) {
  const atlas = tintedAtlas(font, rgb);
  const base = font.meta.baseline;
  let pen = x;
  for (const ch of text) {
    const g = font.meta.glyphs[ch.charCodeAt(0)];
    if (!g) continue;
    const [left, width, right, ascent, x0, y0, x1, y1] = g;
    if (ch !== ' ' && width > 0 && y1 > y0) {
      ctx.drawImage(atlas, x0, y0, x1 - x0, y1 - y0,
                    pen + left, y + base - ascent, x1 - x0, y1 - y0);
    }
    pen += left + width + right;
  }
}

/** `rotation.angle`, live-overridden by `rotation.angleVar` when bound and
 *  fed.
 *
 *  The unit is **radians**, confirmed twice (VHUD-9): the engine's own
 *  `IconLookRotation` is an `FPATAN` result (client `0x006ae612`), and canvas
 *  `rotate()` takes radians too, so the value passes through unconverted.
 *  That much the old OPEN comment guessed right.
 *
 *  `angleMultiplier` is still NOT applied, and now for a reason rather than
 *  for want of one: it scales a draw-context scalar, not the bound variable,
 *  and all seven vanilla `RotateEffect`s author it as `0`. Applying it would
 *  freeze every dial at twelve o'clock.
 *
 *  The SIGN is `_drawPicture`'s business, not this function's -- see there. */
/**
 * `setHudAmmoType`'s value, lower-cased, to the `Ammo/AmmoType` integer the
 * layout keys the soldier ammo panel on.
 *
 * HUD-10 closed this: the `.con` word and the `.meme` variable are **the same
 * enumeration** — the client's own `operator>>` (`0x004c4cd0`) was decompiled
 * in full and every stored value read — so a weapon's declared type goes
 * straight through and there is no converter to write.
 *
 *   0 ATNone               nothing draws                  KnifeAllies/Axis
 *   1 ATAmmoBar            magazine panel, bar, rounds, mag box
 *   2 ATIcon               panel, icon, ROUNDS            Bazooka, Panzershreck,
 *                                                         ExpPack, Detonator, Landmine
 *   3 ATIconAndStrengthBar panel, icon, rounds, bar       grenades
 *   4 ATIconAndReloadBar   panel, icon, reload bar        RepairPack
 *   5 ATIconNoText         panel, icon
 *   6 ATIconAndHeatBar     panel, icon, heat bar          MedPack
 *
 * Anything unrecognised is the client's own 7. Surveyed across all 18
 * installs: ATAmmoBar 1017, ATIcon 512, ATIconAndStrengthBar 367, ATNone 218,
 * ATIconAndHeatBar 51, ATIconAndReloadBar 19, ATIconNoText 1; 37 declarations
 * in vanilla, every one matching the table above.
 */
export const AMMO_TYPE_CODES = {
  atnone: 0, atammobar: 1, aticon: 2, aticonandstrengthbar: 3,
  aticonandreloadbar: 4, aticonnotext: 5, aticonandheatbar: 6,
};

/**
 * Which of the icon-family types print a round count.
 *
 * `menu/InGame`'s `{2,3,4,5}` panel gates its `Ammo/PrimaryAmmo` text on
 * `ne 4 && ne 5 && ne 6` on top of the group's own membership test, so 2 and
 * 3 print and 4 and 5 do not. This is why `ATIcon` had to be 2 and not 6: a
 * Bazooka fed 6 landed in the `{6,7}` panel, which has no rounds text at all,
 * and showed a rocket icon with no count beside it.
 */
export const AMMO_TYPES_WITH_ROUNDS = new Set([2, 3]);

/** The 800x600 point the seat-occupancy dots are offset from (VHUD-7): the
 *  six 8x8 leaves draw at `(192 + VehiclePosX[i+1], 452 + VehiclePosY[i+1])`.
 *  It is also exactly `hud-layout.json`'s own seat-0 rect (247,457) minus that
 *  variable's authored default (55,5), so the two agree. */
const SEAT_DOT_ORIGIN = [192, 452];

/** `seatDotPosition`'s scratch pair, reused so the six leaves do not allocate
 *  one array each per painted frame. */
const SEAT_DOT_AT = [0, 0];

function rotationAngle(el, vars) {
  const r = el.rotation;
  if (!r) return 0;
  const live = r.angleVar && vars[r.angleVar];
  return (live !== undefined ? live : r.angle) || 0;
}

export class Hud {
  /**
   * @param {Object} opts
   * @param {HTMLCanvasElement} opts.canvas - the overlay canvas to paint into.
   * @param {(name: string) => (HTMLImageElement|HTMLCanvasElement|null)} opts.sprite
   *   - the packed-sprite lookup map.html's own `loadHudPack` already builds
   *     (`hud.json`'s 257 entries); shared, not reloaded here.
   * @param {string|((rel: string) => string)} [opts.base] - the HUD asset
   *   directory, or a resolver for one pack-relative path at a time. The
   *   function form is what a mod needs: its pack holds only the files it
   *   overrode, so `hud-layout.json` may come from the mod's directory while
   *   the fonts beside it still come from vanilla's (`hud-pack.js`).
   * @param {() => string} [opts.bust] - cache-busting query string, if any.
   */
  constructor({ canvas, sprite, base = 'maps/_shared/hud', bust = () => '' }) {
    this.canvas = canvas;
    this.sprite = sprite;
    this.base = base;
    this.url = typeof base === 'function' ? base : rel => `${base}/${rel}`;
    this.bust = bust;
    this.vars = Object.create(null);   // the published contract surface
    this.layout = null;
    this._groups = [];                 // layout.groups in PAINT_ORDER
    this.fonts = new Map();            // id -> { meta, img, tinted }
    this.ready = false;
    this._trackedVars = [];
    this._prev = Object.create(null);
    this._dirty = true;
    this._lastW = 0;
    this._lastH = 0;
    this._lastDpr = 0;
    this._rgba = [1, 1, 1, 1];         // liveColor's scratch, reused per leaf
  }

  /** A sprite finishing its own async decode, or a font landing, changed
   *  nothing in `vars` -- flag the next `paint()` call dirty regardless. */
  requestRepaint() {
    this._dirty = true;
  }

  async load() {
    let data;
    try {
      data = await fetch(`${this.url('hud-layout.json')}${this.bust()}`).then(r => r.json());
    } catch (error) {
      console.warn('hud layout unavailable', error);
      return;
    }
    const tracked = new Set();
    for (const group of Object.values(data.groups)) {
      for (const el of group.elements) {
        prepareElement(el);
        trackedVarsOf(el, tracked);
      }
    }
    this._trackedVars = [...tracked];
    this.layout = data;
    this._groups = paintOrder(data.groups);
    await Promise.all(Object.entries(data.fontFiles || {}).map(async ([id, entry]) => {
      let meta;
      try {
        meta = await fetch(`${this.url(entry.glyphs)}${this.bust()}`).then(r => r.json());
      } catch {
        return;
      }
      const img = new Image();
      await new Promise(resolve => {
        img.onload = resolve;
        img.onerror = resolve;
        img.src = `${this.url(entry.file)}${this.bust()}`;
      });
      this.fonts.set(id, { meta, img, tinted: new Map() });
    }));
    this.ready = true;
    this.requestRepaint();
  }

  /** Virtual-to-stage mapping: the engine stretches 800x600 independently on
   *  each axis (VHUD-11). Portrait letterboxing here was wrong vs retail. */
  _scaleFor(W, H) {
    const [vw, vh] = this.layout?.virtual || DEFAULT_VIRTUAL;
    return { sx: W / vw, sy: H / vh, ox: 0, oy: 0 };
  }

  _isDirty(W, H, dpr) {
    if (this._dirty) return true;
    if (W !== this._lastW || H !== this._lastH || dpr !== this._lastDpr) return true;
    for (const name of this._trackedVars) {
      if (this.vars[name] !== this._prev[name]) return true;
    }
    return false;
  }

  _snapshot(W, H, dpr) {
    this._lastW = W;
    this._lastH = H;
    this._lastDpr = dpr;
    for (const name of this._trackedVars) this._prev[name] = this.vars[name];
    this._dirty = false;
  }

  /** One frame: every element in every group, file order, each independently
   *  culled the moment a variable its own content or gate needs is missing.
   *  Called once per RENDERED frame (HUD-3: the engine itself recomputes
   *  this HUD once per `Renderer_drawFrame`, not the 30 Hz tick) -- never
   *  more than that, and never at all when nothing changed. */
  paint(stageW, stageH) {
    if (!this.ready || !this.canvas || !stageW || !stageH) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    if (!this._isDirty(stageW, stageH, dpr)) return;
    const cw = Math.round(stageW * dpr);
    const ch = Math.round(stageH * dpr);
    if (this.canvas.width !== cw || this.canvas.height !== ch) {
      this.canvas.width = cw;
      this.canvas.height = ch;
    }
    const ctx = this.canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    const s = this._scaleFor(stageW, stageH);
    ctx.setTransform(s.sx * dpr, 0, 0, s.sy * dpr, s.ox * dpr, s.oy * dpr);
    ctx.imageSmoothingEnabled = false;   // every asset here is point art
    for (const group of this._groups) {
      for (const el of group.elements) this._paintElement(ctx, el);
    }
    ctx.globalAlpha = 1;
    this._snapshot(stageW, stageH, dpr);
  }

  _visible(el) {
    for (const name of el._requiredVars) {
      if (this.vars[name] === undefined) return false;
    }
    return (el.when || []).every(c => condOk(c, this.vars));
  }

  _paintElement(ctx, el) {
    if (!this._visible(el)) return;
    const [x, y, w, h] = el.rect || [0, 0, 0, 0];
    switch (el.kind) {
      case 'picture':
        this._drawPicture(ctx, el, x, y, w, h, this.sprite(el.texture));
        break;
      case 'variable-picture': {
        const img = resolveTexture(this.vars[el.var], el.texture, this.sprite);
        this._drawPicture(ctx, el, x, y, w, h, img);
        break;
      }
      case 'fill-picture':
        this._drawFillPicture(ctx, el, x, y, w, h);
        break;
      case 'text':
        this._drawText(ctx, el, x, y, w, h);
        break;
      case 'fill':
        this._drawFill(ctx, el, x, y, w, h);
        break;
      case 'occupied-seat':
        this._drawOccupiedSeat(ctx, el, x, y, w, h);
        break;
      case 'crosshair':
        this._drawCrosshair(ctx, el, x, y, w, h);
        break;
      default:
        break;
    }
  }

  /**
   * A sprite, optionally spun about its own centre by a `RotateEffect`.
   *
   * **The rotation is applied counter-clockwise, and that is not a taste
   * decision.** VHUD-9 read `RotateEffect`'s own transform at client
   * `0x007edbf0`: `x' = x·cos + y·sin`, `y' = -x·sin + y·cos`, which on the
   * HUD's y-down frame sends `(0,-1)` at +90 degrees to `(-1,0)` -- top to
   * left, counter-clockwise on screen. HTML canvas `rotate(+θ)` is clockwise.
   * The two conventions are opposite, so the engine's angle has to be negated
   * here.
   *
   * This used to be `ctx.rotate(angle)` and the dial still looked right,
   * because `map.html` fed it through `TurretRig.headingRadians()`, which
   * carries `RIG_SIGN.yaw = -1`. Two errors cancelling. They are now
   * separated: `map.html` feeds the un-negated engine value
   * (`turretYawRadians`) and the negation lives here, where the convention
   * mismatch actually is. **Change one without the other and every dial
   * mirrors.**
   */
  _drawPicture(ctx, el, x, y, w, h, img) {
    if (!img) return;
    let alpha;
    if (el.colorVars || el.alphaVars) {
      alpha = liveColor(el, this.vars, this._rgba)[3];
    } else {
      // A layout from before `colorVars`: the damage arc's alpha binding was
      // not in the file, so it is keyed on the sprite instead. It replaces
      // the file's 0.5 rather than scaling it, as `liveColor` does (XHIT-7).
      alpha = el.color ? el.color[3] : 1;
      if (this.vars['HitFromDir/HitFromDirAlpha'] != null && el.texture === 'ingame_hit_indicator_64x128') {
        alpha = Math.max(0, Math.min(1, Number(this.vars['HitFromDir/HitFromDirAlpha']) || 0));
      }
    }
    if (alpha <= 0) return;
    ctx.globalAlpha = alpha;
    const angle = rotationAngle(el, this.vars);
    if (angle) {
      ctx.save();
      ctx.translate(x + w / 2, y + h / 2);
      ctx.rotate(-angle);
      ctx.drawImage(img, -w / 2, -h / 2, w, h);
      ctx.restore();
    } else {
      ctx.drawImage(img, x, y, w, h);
    }
    ctx.globalAlpha = 1;
  }

  /** The two-layer gauge every bar in the game is: the empty picture drawn
   *  in full, the full picture drawn again but clipped to the fillable band
   *  the current fraction computes -- `BfVariablePictureFillNode(2)::update`,
   *  verify-r1.md R1-26..R1-31 (mechanism), R2-15 and VHUD-7 (re-confirmed on
   *  the vehicle health bar). `max`/`size` are the engine's own tolerant
   *  fields (HUD-1): live when bound and fed, else the layout's literal. */
  _drawFillPicture(ctx, el, x, y, w, h) {
    const vars = this.vars;
    const value = Number(vars[el.valueVar]);
    const max = Number(el.maxVar && vars[el.maxVar] !== undefined ? vars[el.maxVar] : el.max);
    const size = Number(el.sizeVar && vars[el.sizeVar] !== undefined ? vars[el.sizeVar] : el.size);
    const emptyImg = resolveTexture(el.pictureVar ? vars[el.pictureVar] : undefined, el.picture, this.sprite);
    const fillImg = resolveTexture(el.fillPictureVar ? vars[el.fillPictureVar] : undefined, el.fillPicture, this.sprite);
    if (emptyImg) ctx.drawImage(emptyImg, x, y, w, h);
    // R1-25 verified: no usable Maximum collapses the fill window to
    // nothing, not to full -- so a value with no live/sane Maximum draws
    // only the empty layer, never a guessed fraction.
    const frac = max > 0 && Number.isFinite(value) ? Math.max(0, Math.min(1, value / max)) : 0;
    if (frac <= 0 || !fillImg || !(size > 0)) return;
    const horizontal = !!el.horizontalAlign;
    const fillOrder = !!el.fillOrder;
    const scaled = frac * size;
    let bx = x, by = y, bw = w, bh = h;
    if (!horizontal) {
      // Which end of the rect the `size`-tall fillable window sits flush
      // against, for the leaves where `size < h`. This was an open question
      // while nothing that shipped exercised it (the health bar, the only
      // fed leaf, has size == h == 64, where every candidate formula
      // coincides); the vehicle panel's heat and reload bars are the first
      // leaves to reach it, and the sprite pack answers it outright.
      //
      // Measured: the opaque rows of every bar sprite the layout names.
      // `reloadtimebar_empty/full_32x64`, `heatbar_empty/full_32x64`,
      // `rocketpackbar_full_32x64` and `staminabar_full_64x32` all carry art
      // in rows 0..41 of a 64-row texture -- exactly the `size: 42` their
      // leaves declare, TOP-anchored, and every one of those leaves is
      // `fillOrder: true`. `magbar_rifle_empty/full_32x64` carries art in
      // rows 44..63 -- exactly the `size: 20` its leaf declares,
      // BOTTOM-anchored -- and that leaf is the layout's only
      // `fillOrder: false` one. `ammobar`/`healthbar`/`vehicle_healthbar`/
      // `medicbar` are all opaque over the full 64 with size 64, so they
      // decide nothing either way. No exceptions across the file.
      //
      // So FillOrder picks both the window's flush edge and the direction
      // the fill grows inside it: true anchors the window to the rect's TOP
      // and grows the fill up from the window's own bottom; false anchors it
      // to the BOTTOM and grows the fill down from the window's top. At
      // size == h the true branch is `y + h - scaled`, term for term what it
      // was before, so the health bar and every other confirmed leaf is
      // unchanged. What it fixes is the case that was wrong: a bar with
      // size 42 in a 64-tall rect was clipping its fill into rows 22..64,
      // which on top-anchored art is 20 rows of real bar and 22 rows of
      // transparent padding -- the vehicle panel's reload bar could not draw
      // a fraction below 0.52 at all, and drew the rest at half height.
      if (fillOrder) { by = (y + size) - scaled; bh = scaled; }
      else { by = (y + h) - size; bh = scaled; }
    } else {
      // R1-31 verified: FillOrder has NO effect on a horizontal bar (the
      // engine's own update() never tests it on this branch) -- but which
      // edge is fixed was never decompiled (0x007dc710/0x007dc420 unopened),
      // and no shipped leaf in hud-layout.json actually sets
      // horizontalAlign:true, so this branch is never exercised. Left-
      // anchored growth here is this file's own placeholder, not a
      // reproduction of engine behaviour.
      bw = scaled;
    }
    ctx.save();
    ctx.beginPath();
    ctx.rect(bx, by, bw, bh);
    ctx.clip();
    ctx.drawImage(fillImg, x, y, w, h);
    ctx.restore();
  }

  /** A number or string variable in the game's own bitmap font -- never a
   *  layout literal (the JSON's `text` field is the extractor's sample
   *  value, not something a player would ever see): `_requiredVars` already
   *  culls this leaf whenever `el.var` is unfed, so reaching here means a
   *  real, live value. */
  _drawText(ctx, el, x, y, w, h) {
    const font = this.fonts.get(el.font);
    if (!font) return;
    const text = String(this.vars[el.var]);
    const color = el.color || [1, 1, 1, 1];
    const rgb = color.slice(0, 3);
    const line = font.meta.lineHeight || 0;
    // A leaf whose string is wider than its own rect, in a rect with room for
    // another line, wraps. Every leaf fed before the combat-area warning was
    // a short number or a name that fits, so this changes nothing for them --
    // and the warning's own plate settles that the engine wraps rather than
    // overflows: `menu/InGame` backs it with `textmessBG_3LINE_256x64`, three
    // lines of art for a 65-character string in a 230 px rect.
    if (line > 0 && h >= line * 2 && measureText(font, text) > w) {
      const lines = wrapText(font, text, w);
      const room = Math.max(1, Math.floor(h / line));
      for (let i = 0; i < Math.min(lines.length, room); i++) {
        this._drawTextLine(ctx, el, lines[i], font, x, y + i * line, w, rgb);
      }
      return;
    }
    this._drawTextLine(ctx, el, text, font, x, y, w, rgb);
  }

  _drawTextLine(ctx, el, text, font, x, y, w, rgb) {
    const width = measureText(font, text);
    const tx = el.align === 'center' ? x + (w - width) / 2
      : el.align === 'right' ? x + w - width : x;
    drawBitmapText(ctx, font, text, Math.round(tx), y, rgb);
  }

  /** A solid quad (an empty `PictureNode`), in the live colour, turned about
   *  its own centre by a `RotateEffect` the same way `_drawPicture` turns a
   *  sprite: counter-clockwise, hence `-angle`. The crosshair's hit marks are
   *  the leaves that need both -- four 1x3 quads turned 0.8 rad into
   *  diagonals, at alpha `CrossHair/HitIndicationTime` (XHIT-1, XHIT-7).
   *
   *  The hit indicator's 800x600 quad is not an artifact: it is the red wash
   *  the whole screen takes when the player is hurt, `(1, 0, 0,
   *  HitFromDir/HitFromDirAlpha)` over everything the chain drew before it
   *  (ledger HFD-5, HFD-8; the owner's recording at 9.93 s). */
  _drawFill(ctx, el) {
    const [x, y, w, h] = el.rect;
    const color = liveColor(el, this.vars, this._rgba);
    if (!el.colorVars && this.vars['HitFromDir/HitFromDirAlpha'] != null
        && (el.when || []).some(w => w.var === 'HitFromDir/HitFromDir')) {
      // A layout from before `colorVars`: the wash's alpha is the variable
      // itself, not the file's 0.5 scaled by it (XHIT-7).
      color[3] = Math.max(0, Math.min(1, Number(this.vars['HitFromDir/HitFromDirAlpha']) || 0));
    }
    if (color[3] <= 0) return;
    ctx.globalAlpha = color[3];
    ctx.fillStyle = `rgb(${Math.round(color[0] * 255)},${Math.round(color[1] * 255)},${Math.round(color[2] * 255)})`;
    const angle = rotationAngle(el, this.vars);
    if (angle) {
      ctx.save();
      ctx.translate(x + w / 2, y + h / 2);
      ctx.rotate(-angle);
      ctx.fillRect(-w / 2, -h / 2, w, h);
      ctx.restore();
    } else {
      ctx.fillRect(x, y, w, h);
    }
    ctx.globalAlpha = 1;
  }

  /**
   * One seat-occupancy dot.
   *
   * VHUD-2 read `BfOccupiedVehicleData`'s vtable (`0x0093f300`) as raw bytes:
   * one shared object backs all six leaves and its five-entry icon table is
   * 0 blank, 1 `vehicledot_local`, 2 `vehicledot_empty`, 3
   * `vehicledot_friend`, 4 `vehicledot_enemy`. **Which live state a given
   * seat resolves to is still unread**, so `vars[el.dataRef]` being an array
   * indexed by `el.position` is this file's contract with `map.html`, not a
   * corpus fact.
   *
   * The POSITION is a corpus fact now, and it used to be the blocker.
   * VHUD-11: `el.posVar` names a `Vehicle/VehiclePos/VehiclePosX<n>`/`Y<n>`
   * pair, and those carry the seat's own `setVehicleIconPos` -- a Vec2 on
   * every PlayerControlObject template, root and seats alike, which nothing
   * parsed until this round. They are texel offsets inside the 128x128
   * vehicle-icon panel, so the dot sits at VHUD-7's `(192 + X, 452 + Y)`:
   * Sherman's root `54/103` lands at (246, 555), inside the icon.
   *
   * `el.rect` is NOT a fallback position. It is this variable pair's own
   * authored default -- the six leaves are a 5px diagonal staircase from
   * (247,457), which is the panel origin plus (55,5)..(85,30) -- so a leaf
   * drawn there is drawn at a placeholder, not at a seat. Every PCO in the
   * game declares `setVehicleIconPos`, so the only thing that reaches an
   * unfed pair is a scene baked before `con.py` learned the word, and for
   * that scene the honest answer is no dot at all: six of them in a
   * staircase assert a seat layout the data does not carry. Measured on the
   * page (Kasserine Hanomag, six seats): with the pairs fed, the staircase
   * corner holds 0 texels of dot; with them deleted, 66.
   */
  _drawOccupiedSeat(ctx, el, x, y, w, h) {
    const table = this.vars[el.dataRef];
    const state = Array.isArray(table) ? table[el.position] : undefined;
    const key = state === 1 ? 'icon_vehicledot_local'
      : state === 2 ? 'icon_vehicledot_empty'
      : state === 3 ? 'icon_vehicledot_friend'
      : state === 4 ? 'icon_vehicledot_enemy' : null;
    const img = key && this.sprite(key);
    if (!img) return;
    const at = this.seatDotPosition(el, x, y);
    if (!at) return;
    ctx.drawImage(img, at[0], at[1], w, h);
    // `at` aliases `SEAT_DOT_AT` and is only valid until the next call --
    // never hold it past this line.
  }

  /** Where one `occupied-seat` leaf draws: the vehicle-icon panel's own
   *  origin plus this seat's fed offset, or `null` when the leaf binds a
   *  position pair and nothing fed it -- see `_drawOccupiedSeat` for why that
   *  is not the rect. A leaf with no `posVar` at all (no shipped one, but a
   *  hand-built leaf could) keeps its own rect, because it never claimed to
   *  be placed by a variable. Split out so `tests/hud_harness.mjs` can read
   *  the arithmetic without a canvas.
   *
   *  Returns `SEAT_DOT_AT`, filled in place: six leaves repaint every frame
   *  the vehicle panel is up, and a fresh pair per dot is 360 two-element
   *  arrays a second for arithmetic the caller consumes immediately. Copy it
   *  if you need to keep it. */
  seatDotPosition(el, x, y) {
    if (!el.posVar) {
      SEAT_DOT_AT[0] = x; SEAT_DOT_AT[1] = y;
      return SEAT_DOT_AT;
    }
    const vx = this.vars[el.posVar.x];
    const vy = this.vars[el.posVar.y];
    if (typeof vx !== 'number' || typeof vy !== 'number') return null;
    SEAT_DOT_AT[0] = SEAT_DOT_ORIGIN[0] + vx;
    SEAT_DOT_AT[1] = SEAT_DOT_ORIGIN[1] + vy;
    return SEAT_DOT_AT;
  }

  /** The procedural crosshair (`BfCrosshairNode`), for the layout groups
   *  this round never feeds -- `map.html` keeps its own DOM crosshair this
   *  round (briefing: "leave the DOM crosshair alone"), and nothing writes
   *  `CrossHair/*` into `vars`, so `_visible` culls every leaf in this group
   *  before this ever runs. Kept only so a future `CrossHair/*` feed does
   *  not hit a missing case; the exact render shape was not traced this
   *  round and is not a reproduction of `BfCrosshairNode::draw`. */
  _drawCrosshair(ctx, el, x, y, w, h) {
    const vars = this.vars;
    const radius = el.radiusVar && vars[el.radiusVar] !== undefined ? vars[el.radiusVar] : el.radius;
    const thickness = el.thickness || 1;
    const cx = x + w / 2, cy = y + h / 2;
    const color = el.crosshairColor || [1, 1, 1, 1];
    ctx.globalAlpha = color[3];
    ctx.fillStyle = `rgb(${color.slice(0, 3).map(v => Math.round(v * 255)).join(',')})`;
    ctx.fillRect(cx - thickness / 2, cy - radius - thickness, thickness, radius);
    ctx.fillRect(cx - thickness / 2, cy + radius, thickness, radius);
    ctx.fillRect(cx - radius - thickness, cy - thickness / 2, radius, thickness);
    ctx.fillRect(cx + radius, cy - thickness / 2, radius, thickness);
    ctx.globalAlpha = 1;
  }
}

/**
 * Calculate the 1..8 compass octant for directional damage indicator from
 * forwardDot and rightDot in the player's view frame.
 *
 * Ground truth: BF1942.exe at 0x004b0967 (the client's `_giveDamage`, ledger
 * HFD-3), the doubles 0.9238 / 0.3826 at 0x008dbf78..60. A right dot of
 * exactly 0 is the right side: the engine tests `0.0 <= r`.
 * Returns:
 *   1: Front (12:00)
 *   2: Front-Right (1:30)
 *   3: Right (3:00)
 *   4: Rear-Right (4:30)
 *   5: Rear (6:00)
 *   6: Rear-Left (7:30)
 *   7: Left (9:00)
 *   8: Front-Left (10:30)
 */
export function calculateHitOctant(forwardDot, rightDot) {
  if (forwardDot > 0.9238) return 1;
  if (forwardDot > 0.3826) return rightDot >= 0 ? 2 : 8;
  if (forwardDot > -0.3826) return rightDot >= 0 ? 3 : 7;
  if (forwardDot > -0.9238) return rightDot >= 0 ? 4 : 6;
  return 5;
}

/**
 * The octant `GameServer::_giveDamage` sends a hurt soldier (ledger HFD-3),
 * in this page's frame. `victim` is his position and `yaw` his heading, whose
 * forward is `(sin yaw, 0, cos yaw)`; `source` is the damage's own point,
 * the engine's `Pos3` (HFD-4): where the round left the muzzle, or the
 * blast's centre.
 *
 * The engine looks from the victim at the source (`calcLookAtMatrix`, row 2
 * is the unit 3-D direction, so height counts) and dots that with his
 * forward and right rows. His right, on this page, is `(-cos yaw, 0,
 * sin yaw)` -- the screen's right, the engine's +x through the exporter's
 * z mirror. `(cos yaw, 0, -sin yaw)`, which this page used to dot with, is
 * his left, and it put every arc on the wrong side. A source on the victim's
 * own origin is the engine's identity look-at, whose row 2 is its +z: this
 * page's -z.
 */
export function hitFromDirOctant(victim, yaw, source) {
  const s = Math.sin(yaw), c = Math.cos(yaw);
  return octantToward(victim, source, s, 0, c, -c, 0, s);
}

/**
 * The same octant for a victim framed by its own axes rather than a heading:
 * the hull a seated player's wash is measured from. `_giveDamage` sends every
 * occupant of a hit vehicle the octant of the damaged object itself, and in
 * vanilla and both expansions that object is always the hull's root (ledger
 * HFD-10, HFD-11), so a gunner facing backwards still reads the arc against
 * the hull's nose. `forward` and `right` are the hull's unit axes in this
 * page's frame: its local -z and +x in world space, the engine's rows 2 and 0
 * through the exporter's z mirror, which leaves every dot product unchanged.
 */
export function hitFromDirOctantAxes(victim, forward, right, source) {
  return octantToward(victim, source, forward.x, forward.y, forward.z,
                      right.x, right.y, right.z);
}

/** `calcLookAtMatrix(victim, source)`'s row 2, dotted with the victim's
 *  forward and right. A source on the victim's own origin is the engine's
 *  identity look-at, whose row 2 is its +z: this page's -z. */
function octantToward(victim, source, fx, fy, fz, rx, ry, rz) {
  let dx = source.x - victim.x, dy = source.y - victim.y, dz = source.z - victim.z;
  const len = Math.hypot(dx, dy, dz);
  if (len < 1.1920929e-7) {
    dx = 0; dy = 0; dz = -1;
  } else {
    dx /= len; dy /= len; dz /= len;
  }
  return calculateHitOctant(dx * fx + dy * fy + dz * fz, dx * rx + dy * ry + dz * rz);
}

/** `HitFromDir/HitFromDirAlpha` for one hit (ledger HFD-2): the damage as a
 *  share of the victim's own max HP, above 0.75 held at 0.75 and below 0 at
 *  0 -- client `0x004b0439`..`0x004b0473`. The engine keeps a NaN (a zero
 *  over a zero max); this returns 0 for it rather than a colour nobody can
 *  name. */
export function hitFromDirAlpha(damage, maxHitPoints) {
  const alpha = damage / maxHitPoints;
  if (alpha > 0.75) return 0.75;
  return alpha >= 0 ? alpha : 0;
}

