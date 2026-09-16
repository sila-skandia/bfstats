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

/** `when` conditions, evaluated exactly as `spawn-layout.json`'s consumer
 *  already does (map.html's `condOk`) -- only ever called once every var it
 *  touches is already known to be present (`_visible`, below), so there is
 *  no "what does undefined compare as" question to answer here. */
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
  return out;
}

/** Every variable name a leaf's `when` list or drawn content can reference,
 *  gathered once at load so `_visible` never walks the tree at paint time. */
function prepareElement(el) {
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
  if (el.posVar) {
    if (el.posVar.x) out.add(el.posVar.x);
    if (el.posVar.y) out.add(el.posVar.y);
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
 *  fed. OPEN [R2-18]: the turret-icon's own angle unit (radians vs degrees),
 *  sign and pivot were never confirmed -- `angleMultiplier` is recorded by
 *  the extractor but its role is unread, so it is not applied here. Canvas
 *  `rotate()` takes radians; the value is passed through unconverted, which
 *  is a guess, not a reproduction of the engine's own convention. */
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
   * @param {string} [opts.base] - the shared HUD asset directory.
   * @param {() => string} [opts.bust] - cache-busting query string, if any.
   */
  constructor({ canvas, sprite, base = 'maps/_shared/hud', bust = () => '' }) {
    this.canvas = canvas;
    this.sprite = sprite;
    this.base = base;
    this.bust = bust;
    this.vars = Object.create(null);   // the published contract surface
    this.layout = null;
    this.fonts = new Map();            // id -> { meta, img, tinted }
    this.ready = false;
    this._trackedVars = [];
    this._prev = Object.create(null);
    this._dirty = true;
    this._lastW = 0;
    this._lastH = 0;
    this._lastDpr = 0;
  }

  /** A sprite finishing its own async decode, or a font landing, changed
   *  nothing in `vars` -- flag the next `paint()` call dirty regardless. */
  requestRepaint() {
    this._dirty = true;
  }

  async load() {
    let data;
    try {
      data = await fetch(`${this.base}/hud-layout.json${this.bust()}`).then(r => r.json());
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
    await Promise.all(Object.entries(data.fontFiles || {}).map(async ([id, entry]) => {
      let meta;
      try {
        meta = await fetch(`${this.base}/${entry.glyphs}${this.bust()}`).then(r => r.json());
      } catch {
        return;
      }
      const img = new Image();
      await new Promise(resolve => {
        img.onload = resolve;
        img.onerror = resolve;
        img.src = `${this.base}/${entry.file}${this.bust()}`;
      });
      this.fonts.set(id, { meta, img, tinted: new Map() });
    }));
    this.ready = true;
    this.requestRepaint();
  }

  /** Virtual-to-stage mapping, the same rule `map.html`'s `deployScale` uses
   *  for the spawn screen: the game stretches 800x600 to the screen, and a
   *  portrait viewport gets a uniform letterboxed scale instead so a corner
   *  HUD element never turns into a sliver. */
  _scaleFor(W, H) {
    const [vw, vh] = this.layout?.virtual || DEFAULT_VIRTUAL;
    if (W / H < 1) {
      const s = Math.min(W / vw, H / vh);
      return { sx: s, sy: s, ox: (W - vw * s) / 2, oy: (H - vh * s) / 2 };
    }
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
    for (const group of Object.values(this.layout.groups)) {
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

  _drawPicture(ctx, el, x, y, w, h, img) {
    if (!img) return;
    const color = el.color;
    ctx.globalAlpha = color ? color[3] : 1;
    const angle = rotationAngle(el, this.vars);
    if (angle) {
      ctx.save();
      ctx.translate(x + w / 2, y + h / 2);
      ctx.rotate(angle);
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
      // R1-30, data-confirmed for the health bar and re-derived from scratch
      // by the verifier: the fillable span is the bottom `size` texels of
      // the picture. FillOrder true anchors its BOTTOM edge (fills upward,
      // the segmented health-bar look); false anchors the span's own TOP
      // edge instead and grows downward toward the picture's bottom.
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
    const width = measureText(font, text);
    const tx = el.align === 'center' ? x + (w - width) / 2
      : el.align === 'right' ? x + w - width : x;
    drawBitmapText(ctx, font, text, Math.round(tx), y, color.slice(0, 3));
  }

  _drawFill(ctx, el) {
    const [x, y, w, h] = el.rect;
    const color = el.color || [1, 1, 1, 1];
    ctx.globalAlpha = color[3];
    ctx.fillStyle = `rgb(${color.slice(0, 3).map(v => Math.round(v * 255)).join(',')})`;
    ctx.fillRect(x, y, w, h);
    ctx.globalAlpha = 1;
  }

  /** One seat-occupancy dot. verify-r2.md R2-5/R2-6 confirm one shared
   *  `Occupied/OccupiedData` object backs all six seats and its five states
   *  (0 blank, 1 you, 2 empty, 3 teammate, 4 enemy) pick one of five dot
   *  textures, but which live state a given seat is in was left OPEN (R2's
   *  own "selector" claim) -- there is no engine-confirmed variable to key
   *  this on. This file's own contract, not a corpus fact, pending whatever
   *  P2/seats.js actually feeds at integration: `vars[el.dataRef]` is an
   *  array indexed by `el.position`, holding one of R2-6's five state ints.
   *  Never exercised this round (nothing sets `Occupied/OccupiedData`). */
  _drawOccupiedSeat(ctx, el, x, y, w, h) {
    const table = this.vars[el.dataRef];
    const state = Array.isArray(table) ? table[el.position] : undefined;
    const key = state === 1 ? 'icon_vehicledot_local'
      : state === 2 ? 'icon_vehicledot_empty'
      : state === 3 ? 'icon_vehicledot_friend'
      : state === 4 ? 'icon_vehicledot_enemy' : null;
    const img = key && this.sprite(key);
    if (img) ctx.drawImage(img, x, y, w, h);
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
