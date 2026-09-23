// The Custom Game mod list, drawn from the game's own layout. It lived in
// the Instant Battle screen's left column until the bot settings wanted that
// column back; `mod-picker-screen.js` is now its own tab, and this is the
// panel on it. Clicking a row is the whole interaction: there is no separate
// confirm step, because a mod here is a filter over the level list on the
// Instant Battle tab, not a game to launch.
//
// `custom-game-layout.json` (extract_custom_game_layout.py) is
// `menu/CustomGameMenu` flattened the same way `menu-screen.js` flattens the
// Instant Battle screen: every leaf's rect, plate, font and resolved string,
// in the engine's 800x600 virtual units. `paintElement` from `menu-screen.js`
// draws every leaf kind this panel uses (fill/picture/text) unchanged; this
// module only adds what the file does not carry - the mod rows (the real
// dialog fills `CustomGame/CustomGameList` from the mods installed on disk,
// the same way `menu-levels.json`'s list is filled at runtime) and one
// footer button (VISIT WEB PAGE, `menu/CustomGameNavigation`'s real label),
// which reuses `knapp3_n`/`knapp3_mo` rather than decode a second page for a
// plate already on disk - see `extract_custom_game_layout.py`'s docstring.
// ACTIVATE is dropped outright: it is CD-key activation in the retail
// screen, and there is no second action here to activate - a click already
// applies.

import { drawBitmapText, inRect, measureText, paintElement, rgb } from './menu-screen.js';

const BUTTON_W = 109;
const BUTTON_H = 25;

function listbox(layout) {
  return layout.pages.modlist.elements.find(el => el.kind === 'listbox');
}

/** The scroll track beside the list box - the black 0.8-alpha fill next to
 *  it, the same heuristic `menu-screen.js`'s own `trackRect` uses, just
 *  scoped to this dialog's one page instead of assuming `pages.skirmish`. */
function trackRect(layout, box) {
  const [bx, , bw] = box.rect;
  for (const el of layout.pages.modlist.elements) {
    if (el.kind !== 'fill' || !el.color) continue;
    const [x, , w, h] = el.rect;
    if (h > 40 && w < 20 && x > bx && x < bx + bw) return el.rect;
  }
  return null;
}

/** The list box's rect starts at the same Y as the NAME/VERSION header bar
 *  drawn over it - there is no `listRows` "recessed well" measurement for
 *  this dialog the way `menu-layout.json` has for the Skirmish list, so the
 *  header's own bottom edge (the black+beige fill pair right above the
 *  rows) stands in for it instead. */
function headerBottom(layout, box) {
  const [bx, by] = box.rect;
  let bottom = by;
  for (const el of layout.pages.modlist.elements) {
    if (el.kind !== 'fill' || !el.color) continue;
    const [x, y, w, h] = el.rect;
    if (Math.abs(y - by) < 2 && x >= bx - 2 && x <= bx + 40) bottom = Math.max(bottom, y + h);
  }
  return bottom;
}

function rowArea(layout, box) {
  const [x, y, w, h] = box.rect;
  const top = headerBottom(layout, box);
  const width = (trackRect(layout, box)?.[0] ?? x + w) - x;
  return [x, top, width, y + h - top];
}

function visibleRows(layout, box) {
  return Math.max(1, Math.floor(rowArea(layout, box)[3] / box.rowHeight));
}

function rowAt(layout, box, scroll, x, y) {
  const area = rowArea(layout, box);
  if (!inRect(area, x, y)) return -1;
  return scroll + Math.floor((y - area[1]) / box.rowHeight);
}

/** The scroll arrows / wheel: nudge `scroll` by a row, clamped. */
export function scrollBy(layout, ui, by) {
  const box = listbox(layout);
  const max = Math.max(0, ui.mods.length - visibleRows(layout, box));
  return Math.min(max, Math.max(0, ui.scroll + by));
}

function thumbSpan(layout, box, scroll, count) {
  const rows = visibleRows(layout, box);
  if (count <= rows) return null;
  const size = Math.max(0.08, rows / count);
  const offset = (scroll / (count - rows)) * (1 - size);
  return [offset, size];
}

function footerButton(layout) {
  const elements = layout.pages.modlist.elements;
  const left = Math.min(...elements.map(el => el.rect[0]));
  const y = Math.max(...elements.map(el => el.rect[1] + el.rect[3])) + 12;
  return [left, y, BUTTON_W, BUTTON_H];
}

/**
 * Paint the panel. `ui` is `{ mods, activeId, scroll, hover }`: `mods` the
 * servable list (vanilla first), `activeId` the mod currently filtering the
 * level list - drawn with the box's own select colour, full strength, the
 * one row that reads as "this is what's applied" - `hover` a `{kind,...}`
 * matching what `hitTestPanel` returns, for the lighter mouse-over tint.
 *
 * `env` adds two hooks `menu-screen.js`'s own env does not need:
 *   icon(mod)   -> the mod's own icon Image, or null
 *   text(name)  -> the live value for a `var` text node - the active mod's
 *                  own `url`/`info`, in place of the file's shipped
 *                  placeholder for `CustomGame/CustomGameUrl` and
 *                  `CustomGame/CustomGameInfo`.
 */
export function paintPanel(ctx, layout, ui, env) {
  const state = { level: null, team: 0 };
  for (const el of layout.pages.modlist.elements) {
    if (el.kind === 'listbox') continue;
    paintElement(ctx, el, layout, state, env);
  }
  paintRows(ctx, layout, ui, env);
  paintWebsiteButton(ctx, layout, ui, env);
}

function paintRows(ctx, layout, ui, env) {
  const box = listbox(layout);
  const font = env.font(box.font);
  const [bx, by, width] = rowArea(layout, box);
  const rows = visibleRows(layout, box);
  const mods = ui.mods;
  const versionX = layout.pages.modlist.elements
    .find(el => el.key === 'CUSTOM_GAME_VERSION')?.rect[0] ?? (bx + 178);

  for (let i = 0; i < rows; i++) {
    const index = ui.scroll + i;
    const mod = mods[index];
    if (!mod) break;
    const y = by + i * box.rowHeight;
    if (mod.id === ui.activeId) {
      ctx.globalAlpha = box.select[3];
      ctx.fillStyle = rgb(box.select);
      ctx.fillRect(bx, y, width, box.rowHeight);
    } else if (ui.hover?.kind === 'row' && ui.hover.index === index) {
      ctx.globalAlpha = box.select[3] * 0.4;
      ctx.fillStyle = rgb(box.select);
      ctx.fillRect(bx, y, width, box.rowHeight);
    }
    if (!font) continue;
    ctx.globalAlpha = 1;
    const left = bx + box.scrollbarOffset;
    const icon = env.icon(mod);
    let textX = left;
    if (icon) {
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(icon, left, y + 1, 12, 12);
      textX = left + 15;
    }
    ctx.imageSmoothingEnabled = false;
    const color = [0.78, 0.78, 0.78, 1];
    drawBitmapText(ctx, font, env.tint, mod.name, Math.round(textX), y + 1, color);
    drawBitmapText(ctx, font, env.tint, mod.version || '—',
                   Math.round(versionX), y + 1, color);
  }
  paintThumb(ctx, layout, box, ui);
}

function paintThumb(ctx, layout, box, ui) {
  const track = trackRect(layout, box);
  const span = track && thumbSpan(layout, box, ui.scroll, ui.mods.length);
  if (!span) return;
  const [tx, ty, tw, th] = track;
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(tx, ty + span[0] * th, tw, span[1] * th);
}

function paintWebsiteButton(ctx, layout, ui, env) {
  const mod = ui.mods.find(m => m.id === ui.activeId);
  if (!mod?.url) return;
  const font = env.font('standard6');
  const rect = footerButton(layout);
  const over = ui.hover?.kind === 'button' && ui.hover.action === 'website';
  const img = env.texture(over ? 'knapp3_mo' : 'knapp3_n');
  if (img) {
    ctx.globalAlpha = 1;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(img, rect[0], rect[1], img.width, img.height);
  }
  if (!font) return;
  const label = 'VISIT WEB PAGE';
  const width = measureText(font, label);
  const tx = rect[0] + (rect[2] - width) / 2;
  ctx.imageSmoothingEnabled = false;
  drawBitmapText(ctx, font, env.tint, label, Math.round(tx), rect[1] + 9, [0, 0, 0, 1]);
}

/** What the pointer is over, in virtual units. */
export function hitTestPanel(layout, ui, x, y) {
  const box = listbox(layout);
  if (inRect(rowArea(layout, box), x, y)) {
    const index = rowAt(layout, box, ui.scroll, x, y);
    if (index >= 0 && index < ui.mods.length) return { kind: 'row', index };
    return null;
  }
  for (const el of layout.pages.modlist.elements) {
    if (el.kind !== 'button' || !inRect(el.rect, x, y)) continue;
    const by = el.texture.includes('upp') ? -1 : el.texture.includes('ner') ? 1 : 0;
    if (by) return { kind: 'arrow', by, rect: el.rect };
  }
  const mod = ui.mods.find(m => m.id === ui.activeId);
  if (mod?.url && inRect(footerButton(layout), x, y)) return { kind: 'button', action: 'website' };
  return null;
}
