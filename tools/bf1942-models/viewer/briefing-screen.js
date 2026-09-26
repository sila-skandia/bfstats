// The mission-briefing screen: the game's post-load dialog, drawn with the
// game's own assets on a canvas the load overlay hosts. The plate is
// `menu/Texture/Briefing/mp_briefing_512x512.dds` (`_shared/load/
// mp_briefing.png`), the type is the menu's own bitmap faces out of
// `Font.rfa` (`trebuchet_ms18/11/8`, `standard6` — the same machinery the
// deploy screen draws `spawn-layout.json` with, shared through
// `bitmap-text.js`), the READY button the game's `knapp3_n`/`knapp3_mo`
// plates, and the team flags the ticket counter's `flag_ticket_<nation>`
// sprites. Positions are the plate's own geometry: it draws 1:1 at (144, 81)
// in the 800x600 virtual space — measured against a stock Wake capture, the
// texture's rule rows land on the capture's — and every string hangs off
// that origin. The khaki band colour is the one reading that did not come
// out of the game's data (menu cons, the level Init.con and a float/byte
// scan of BF1942.exe all came back empty), so it is sampled off the capture
// and marked as such below.
//
// `progress.js` owns the state machine and the READY click; this module owns
// the pixels: `paint(data)` draws the payload `level-load.js` composes
// (display name, game type, map type, objectives, the two flag URLs),
// `layout()` maps the virtual space onto the pane at the current size and
// places the overlay's transparent READY hit area over the drawn button.

import { drawBitmapText, measureBitmapText } from './bitmap-text.js';

const VIRTUAL = { w: 800, h: 600 };
// The plate and everything on it, in virtual units.
const PLATE = { x: 144, y: 81, w: 512, h: 334 };
const BAND = { x: 148, y: 210, w: 503, h: 19 };            // OBJECTIVES bar
const BAND_COMMENTS = { x: 148, y: 310, w: 503, h: 19 };   // COMMENTS bar
const TEXT_X = 154;                                        // every left-aligned string
const BODY_WRAP = 491;                                     // objectives wrap width
const READY_ROW = { x: 144, y: 420, w: 512, h: 35 };
const READY_BTN = { x: 339, y: 426, w: 108, h: 25 };
// The knapp plate paints 107x25 at (3,1) inside its 128x128 canvas.
const KNAPP_SRC = { x: 3, y: 1, w: 107, h: 25 };

// The capture-sampled khaki (see the header): rgb(132,125,76), with the
// plate's own dark border drawn under it.
const KHAKI = '#847d4c';
const KHAKI_EDGE = '#3c3a2c';
const INK = 'rgb(20, 20, 14)';          // the plate's near-black type
const PAPER = 'rgb(244, 242, 232)';     // the settings' off-white
const OUTLINE = [0.078, 0.078, 0.078];  // the body text's dark edge

const FONT_IDS = ['trebuchet_ms18', 'trebuchet_ms11', 'trebuchet_ms8', 'standard6'];

export function createBriefingScreen({ hudPaths, mapsBase = 'maps', bust = () => '' } = {}) {
  const canvas = document.createElement('canvas');
  canvas.className = 'ld-brief-canvas';

  const fonts = new Map();
  const flags = new Map();          // src -> Image (complete or loading)
  const assets = { plate: null, knapp: null, knappHover: null };
  let data = null;
  let hover = false;
  let view = { s: 1, ox: 0, oy: 0, w: 800, h: 600, dpr: 1 };
  let placeReady = null;            // (rect at stage scale) from progress.js

  const url = rel => `${hudPaths.url(rel)}${bust()}`;
  // The plate ships in the load pack (`_shared/load/`), not the hud pack.
  const plateUrl = rel => `${mapsBase}/${rel}${bust()}`;

  async function loadAssets() {
    await Promise.all(FONT_IDS.map(async id => {
      try {
        const meta = await fetch(url(`fonts/${id}.json`)).then(r => r.json());
        const img = new Image();
        await new Promise(resolve => {
          img.onload = img.onerror = resolve;
          img.src = url(`fonts/${id}.png`);
        });
        fonts.set(id, { meta, img, tinted: new Map() });
      } catch (_) { /* the face stays missing; its strings draw nothing */ }
    }));
    const [plate, knapp, knappHover] = await Promise.all(
      [['_shared/load/mp_briefing.png', plateUrl],
       ['menu/textures/knapp3_n.png', url],
       ['menu/textures/knapp3_mo.png', url]]
        .map(([src, toUrl]) => {
          const img = new Image();
          const done = new Promise(resolve => {
            img.onload = img.onerror = () => resolve(img);
          });
          img.src = toUrl(src);
          return done;
        }));
    Object.assign(assets, { plate, knapp, knappHover });
    draw();
  }

  function flagImage(src) {
    if (!src) return null;
    let img = flags.get(src);
    if (!img) {
      img = new Image();
      img.onload = () => draw();
      img.onerror = () => {};
      img.src = src;
      flags.set(src, img);
    }
    return img.complete && img.naturalWidth ? img : null;
  }

  /** One string in one of the menu's faces. `baselineY` is where the type
   *  sits — the capture's baselines — because that is what survives a face
   *  change; `y` inside drawBitmapText is the line's top. */
  function text(ctx, fontId, str, { baselineY, x = TEXT_X, align = 'left', scale = 1,
                                   tracking = 0, rgb = [1, 1, 1], outline = null } = {}) {
    const font = fonts.get(fontId);
    if (!font) return;
    drawBitmapText(ctx, font, str, x, baselineY - font.meta.baseline * scale,
                   { rgb, scale, tracking, align, outline });
  }

  function wrap(font, text_, width) {
    const lines = [];
    let line = '';
    for (const word of String(text_).split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (line && measureBitmapText(font, next) > width) {
        lines.push(line);
        line = word;
      } else {
        line = next;
      }
    }
    if (line) lines.push(line);
    return lines;
  }

  function draw() {
    const ctx = canvas.getContext('2d');
    const { s, ox, oy, w, h, dpr } = view;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // Crisp pixels, the way the game draws at 800x600: smoothing the scaled
    // glyphs softens every edge and reads as a bolder weight than the face is.
    ctx.imageSmoothingEnabled = false;
    ctx.setTransform(s * dpr, 0, 0, s * dpr, ox * dpr, oy * dpr);
    if (assets.plate && assets.plate.complete && assets.plate.naturalWidth > 0) {
      ctx.drawImage(assets.plate, PLATE.x, PLATE.y, PLATE.w, PLATE.h);
    }

    const d = data || {};
    // The name, where the plate's title band sits (texture rows 0..24).
    text(ctx, 'trebuchet_ms18', d.displayName || '', { align: 'center', x: 400, baselineY: 101, rgb: hexRgb(INK) });
    // The teams: the ticket counter's waving sprites (16x16, flag content in
    // rows 2..12), "VS" between — the capture's own x positions (the group
    // sits a shade left of centre). The flags centre on the VS line, the way
    // the capture has it: the line's ink centre is the baseline minus half
    // the face's cap ascent.
    const vsFont = fonts.get('trebuchet_ms8');
    const vsInk = vsFont
      ? Math.max(...['V', 'S'].map(ch => vsFont.meta.glyphs[ch.charCodeAt(0)]?.[3] ?? 0))
      : 6.5;
    const flagY = 125 - vsInk / 2 - 5.5;
    for (const [src, cx] of [[d.flags?.[0], 337], [d.flags?.[1], 444]]) {
      const img = flagImage(src);
      if (img) ctx.drawImage(img, cx - 8, flagY, 16, 11);
    }
    text(ctx, 'trebuchet_ms8', 'VS', { align: 'center', x: 394, baselineY: 125, rgb: hexRgb(INK) });
    // The game-type line: CONQUEST - ASSAULT MAP.
    const mode = [d.gameType, d.mapType]
      .map(part => (typeof part === 'string' ? part.trim().toUpperCase() : ''))
      .filter(Boolean).join(' - ');
    text(ctx, 'trebuchet_ms11', mode, { align: 'center', x: 400, baselineY: 154.5, rgb: hexRgb(INK), tracking: 0.8 });

    // The settings block, on the plate's first dark band.
    BRIEFING_SETTINGS.forEach(([label, value], i) => {
      const baselineY = 170 + i * 13.5;
      text(ctx, 'trebuchet_ms8', label, { baselineY, rgb: hexRgb(PAPER) });
      text(ctx, 'trebuchet_ms8', value, { align: 'right', x: 646, baselineY, rgb: hexRgb(PAPER) });
    });

    // The OBJECTIVES / COMMENTS bars and their strings.
    for (const [band, label, body, baselineY] of [
      [BAND, 'OBJECTIVES', d.objectives || '', 226.5],
      [BAND_COMMENTS, 'COMMENTS', '', 326.5],
    ]) {
      ctx.fillStyle = KHAKI;
      ctx.fillRect(band.x, band.y, band.w, band.h);
      ctx.strokeStyle = KHAKI_EDGE;
      ctx.lineWidth = 1;
      ctx.strokeRect(band.x + 0.5, band.y + 0.5, band.w - 1, band.h - 1);
      text(ctx, 'trebuchet_ms8', label, { x: band.x + 6, baselineY, rgb: hexRgb('#26251a') });
      if (body) {
        const font = fonts.get('standard6');
        if (font) {
          wrap(font, body, BODY_WRAP).forEach((line, i) => {
            text(ctx, 'standard6', line, { x: TEXT_X, baselineY: 245 + i * 11.7, rgb: [1, 1, 1], outline: OUTLINE });
          });
        }
      }
    }

    // The READY row: its own band below the plate, framed on all four sides
    // with the dialog's light border and rounded corners (the capture reads
    // an ~8px frame at its scale — about 3 virtual units — in the same grey
    // as the plate's own edge).
    ctx.fillStyle = 'rgba(62, 62, 58, 0.88)';
    ctx.beginPath();
    (ctx.roundRect || ctx.rect).call(ctx, READY_ROW.x, READY_ROW.y, READY_ROW.w, READY_ROW.h, 3);
    ctx.fill();
    ctx.strokeStyle = 'rgb(140, 139, 140)';
    ctx.lineWidth = 3;
    ctx.stroke();
    const knapp = hover && assets.knappHover && assets.knappHover.complete
      && assets.knappHover.naturalWidth > 0 ? assets.knappHover : assets.knapp;
    if (knapp && knapp.complete && knapp.naturalWidth > 0) {
      ctx.drawImage(knapp, KNAPP_SRC.x, KNAPP_SRC.y, KNAPP_SRC.w, KNAPP_SRC.h,
                    READY_BTN.x, READY_BTN.y, READY_BTN.w, READY_BTN.h);
    }
    text(ctx, 'trebuchet_ms8', 'READY', { align: 'center', x: 393, baselineY: 444, tracking: 0, rgb: [1, 1, 1] });
  }

  function hexRgb(str) {
    // '#847d4c' | 'rgb(r, g, b)' -> 0..1 triple for the atlas tint.
    if (str.startsWith('#')) {
      return [1, 3, 5].map(i => parseInt(str.slice(i, i + 2), 16) / 255);
    }
    const [r, g, b] = str.match(/\d+/g).map(Number);
    return [r / 255, g / 255, b / 255];
  }

  const assetsReady = () => assets.plate && assets.knapp;

  return {
    canvas,
    /** The READY hit rect, virtual units — progress.js keeps the click. */
    readyRect: () => ({ ...READY_BTN }),
    paint(payload) {
      data = payload === undefined ? data : payload;
      if (!assetsReady()) { loadAssets(); return; }
      draw();
    },
    /** Map the virtual space onto the pane and place the READY hit area. */
    layout(W, H, dpr, readyEl) {
      const s = Math.min(W / VIRTUAL.w, H / VIRTUAL.h);
      view = {
        s, ox: (W - VIRTUAL.w * s) / 2, oy: (H - VIRTUAL.h * s) / 2,
        w: W, h: H, dpr: dpr || 1,
      };
      canvas.width = Math.round(W * view.dpr);
      canvas.height = Math.round(H * view.dpr);
      if (readyEl) {
        readyEl.style.left = `${view.ox + READY_BTN.x * s}px`;
        readyEl.style.top = `${view.oy + READY_BTN.y * s}px`;
        readyEl.style.width = `${READY_BTN.w * s}px`;
        readyEl.style.height = `${READY_BTN.h * s}px`;
      }
      if (data && assetsReady()) draw();
    },
    hover(on) {
      if (hover === on) return;
      hover = on;
      if (data && assetsReady()) draw();
    },
  };
}

// The settings block, shared shape with progress.js's own constant (the
// stock `Mods/bf1942/Settings/ServerSettings.con` defaults — the viewer is
// the server). Kept here so the screen draws even standalone.
const BRIEFING_SETTINGS = [
  ['FRIENDLY FIRE :', '100%'],
  ['ALLOW NOSE CAM :', 'ON'],
  ['TICKET RATIO :', '100%'],
];
