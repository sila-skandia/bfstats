// The front end's navigation rows, drawn from the game's own layout.
//
// `main-menu-layout.json` (extract_main_menu_layout.py) carries
// `menu/MainMenuNavigation` — the SINGLEPLAY / MULTIPLAY / OPTIONS / CUSTOM
// GAME / INTRO / CREDITS strip — and `menu/MultiplayerNavigation`, the row
// under it. Both are runs of `BfNavigationButtonNode`s on the shipped
// `Menu/knapp_*.tga` plates with a `standard6` label each, on a
// `Navigation/NavigationX/Y` transform the extractor settles at level 3
// (`layout.navigationY`), which is where a sub-tab's own screen sits.
//
// This site answers for two of the six tabs and one of the four buttons in
// the row below, so a caller names the ones it wants and the rest are not
// drawn — a tab that goes nowhere is worse than a tab that is not there.
// Everything that *is* drawn is the file's: the plate, its mouse-over and
// clicked states, the label, the rect and the dimming.
//
// The dimming is the file's own too. Each tab carries a second, 0.6-alpha
// black copy of itself gated on
// `Navigation/Level1/MouseClickedIndex ne <its index> and
//  Navigation/NavigationY lt 74` — the strip darkens every tab but the
// chosen one once the menu is deeper than the front page. The index in that
// condition is where a slot's own number is read from; nothing else in the
// file names it.

import { elementVisible, inRect, paintElement } from './menu-screen.js';

/** The variable the tab strip dims itself by. */
const CLICKED = 'Navigation/Level1/MouseClickedIndex';

const slotKeyOf = el => {
  for (const cond of el.when || []) {
    const terms = cond.op === 'and' || cond.op === 'or' ? cond.terms : [cond];
    for (const term of terms) if (term.var === CLICKED) return term.value;
  }
  return null;
};

/** A page's buttons grouped into the slots they sit in, left to right.
 *
 *  A slot is everything sharing one button's x: the plate, its dimmed copy,
 *  the pointer region and the label (indented 8 units, so the group is by
 *  the widest rect that starts at or after the plate's x and ends inside
 *  it). `key` is the label's locale key, which is how a caller names the
 *  slot it wants; `index` is the number the dim condition tests, which is
 *  what the active tab is set to.
 */
export function navSlots(layout, page) {
  const elements = layout.pages[page]?.elements || [];
  const plates = elements.filter(el => el.kind === 'button');
  const xs = [...new Set(plates.map(el => el.rect[0]))].sort((a, b) => a - b);
  return xs.map(x => {
    const width = plates.find(el => el.rect[0] === x).rect[2];
    const own = elements.filter(el => el.rect[0] >= x && el.rect[0] < x + width);
    return {
      x,
      width,
      index: own.map(slotKeyOf).find(v => v !== null) ?? null,
      key: own.find(el => el.kind === 'text' && el.key)?.key ?? null,
      text: own.find(el => el.kind === 'text' && el.key)?.text ?? '',
      elements: own,
    };
  });
}

/** A slot's elements moved to another slot's x. The copies are made once,
 *  at build time: `paintElement` recognises a hovered button by `el.rect`
 *  identity, so the rects a frame hit-tests must be the rects it painted. */
function place(slot, x) {
  const dx = x - slot.x;
  if (!dx) return slot.elements;
  return slot.elements.map(el => ({ ...el, rect: [el.rect[0] + dx, ...el.rect.slice(1)] }));
}

/**
 * @param {object} options
 * @param {object} options.layout  main-menu-layout.json
 * @param {object} options.env     a `menu-pack.js` env
 * @param {Array}  options.rows    `[{ page, items: [{ key, id, slot?,
 *                                 enabled? }] }]` — `slot` re-places an
 *                                 item at that slot's x on its own page,
 *                                 for a row the site keeps only one button
 *                                 of; `enabled` is asked every frame and a
 *                                 button that answers false is neither
 *                                 drawn nor clickable (CREATE GAME while
 *                                 the room server is not answering)
 * @param {string} [options.active] the id of the tab that is up
 * @param {(id: string) => void} [options.onPick]
 */
export function createNavStrip({ layout, env, rows, active = null, onPick = () => {} }) {
  let current = active;

  const built = rows.flatMap(row => {
    const slots = navSlots(layout, row.page);
    return row.items.flatMap(item => {
      const slot = slots.find(s => s.key === item.key);
      if (!slot) return [];
      const x = item.slot === undefined ? slot.x : slots[item.slot].x;
      return [{
        id: item.id,
        index: slot.index,
        text: slot.text,
        enabled: item.enabled ?? (() => true),
        rect: [x, slot.elements[0].rect[1], slot.width, slot.elements[0].rect[3]],
        elements: place(slot, x),
      }];
    });
  });

  /** The conditions' variable table: the file's own values, with the strip
   *  told which tab is up. A row whose page has no dim condition of its own
   *  (`menu/MultiplayerNavigation` has none — it is only ever drawn under
   *  the tab it belongs to) is unaffected by this. */
  const vars = () => ({
    ...(layout.variables || {}),
    [CLICKED]: built.find(b => b.id === current)?.index ?? 0,
  });

  function paint(ctx) {
    const table = vars();
    for (const button of built) {
      if (!button.enabled()) continue;
      for (const el of button.elements) {
        if (!elementVisible(el, table)) continue;
        paintElement(ctx, el, layout, null, env);
      }
    }
    ctx.globalAlpha = 1;
  }

  const hitTest = (x, y) =>
    built.find(b => b.enabled() && inRect(b.rect, x, y)) || null;

  return {
    paint,
    /** What the pointer is over, in the shape `paintElement` reads back:
     *  its `rect` is the plate's, so the mouse-over art swaps in. */
    hover(x, y) {
      const button = hitTest(x, y);
      if (!button) return null;
      const plate = button.elements.find(el => el.kind === 'button');
      return { kind: 'button', action: 'nav', id: button.id, rect: plate?.rect };
    },
    /** A click. Returns true when the strip took it. */
    click(x, y) {
      const button = hitTest(x, y);
      if (!button) return false;
      if (button.id !== current) onPick(button.id);
      return true;
    },
    setActive(id) { current = id; },
    get active() { return current; },
    get buttons() { return built; },
  };
}
