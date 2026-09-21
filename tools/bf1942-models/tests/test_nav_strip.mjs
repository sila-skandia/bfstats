/**
 * `viewer/play/nav-strip.js` under node: the front end's tab rows, against
 * a stub 2D context and a stub pack.
 *
 * What is worth pinning here is what a capture cannot show: that a slot is
 * found by the locale key of its label rather than by its position in the
 * file, that its index comes off the file's own dim condition, that the
 * dimming therefore falls on every tab but the one that is up, and that a
 * button re-placed into another slot is hit-tested where it was drawn.
 */
import assert from 'node:assert/strict';
import { elementVisible } from '../viewer/play/menu-screen.js';
import { createNavStrip, navSlots } from '../viewer/play/nav-strip.js';

// --- a stand-in for the extracted pack --------------------------------------
//
// The rects are the real ones `extract_main_menu_layout.py` produces from
// `menu/MainMenuNavigation` and `menu/MultiplayerNavigation` with
// `Navigation/NavigationY` settled at level 3, so a change in the flattener
// that moves them shows up here as well as in a capture.

const CLICKED = 'Navigation/Level1/MouseClickedIndex';

/** One tab: the plate, its dimmed copy, the pointer region and the label.
 *  `index` is the number the dim condition tests — not the slot's position,
 *  which is the whole reason it is read out of the file. */
const tab = (x, key, text, index) => [
  { kind: 'button', rect: [x, 33, 107, 24], texture: 'knapp_n', hover: 'knapp_mo',
    pressed: 'knapp_mc', sets: [{ var: 'Navigation/Menu', value: index }] },
  { kind: 'hit', rect: [x, 36, 107, 21], calls: ['Sound/PlayMenuHighLight'] },
  { kind: 'button', rect: [x, 33, 107, 24], texture: 'knapp_n', hover: 'knapp_mo',
    color: [0, 0, 0, 0.6],
    when: [{ op: 'and', terms: [{ var: CLICKED, op: 'ne', value: index },
                                { var: 'Navigation/NavigationY', op: 'lt', value: 74 }] }] },
  { kind: 'text', rect: [x + 8, 42, 97, 18], font: 'standard6', align: 'center',
    key, text },
];

const row2 = (x, key, text) => [
  { kind: 'button', rect: [x, 59, 107, 24], texture: 'knapp2_n', hover: 'knapp_mo',
    when: [{ var: 'InhibitMenuBehavior', op: 'ne', value: 3 }] },
  { kind: 'text', rect: [x + 8, 68, 97, 18], font: 'standard6', align: 'center',
    key, text, when: [{ var: 'InhibitMenuBehavior', op: 'ne', value: 3 }] },
];

const layout = {
  virtual: [800, 600],
  navigationY: 33,
  variables: { 'Navigation/NavigationY': 33, InhibitMenuBehavior: 0, [CLICKED]: 0 },
  pages: {
    // SINGLEPLAY's dim tests 2 and MULTIPLAY's tests 1: the file's own
    // numbering is not the order the tabs are drawn in, which is exactly
    // what `navSlots` has to read rather than assume.
    mainNav: { elements: [
      ...tab(21, 'MENU_SINGLEPLAY', 'SINGLEPLAY', 2),
      ...tab(129, 'MENU_MULTIPLAY', 'MULTIPLAY', 1),
      ...tab(237, 'MENU_OPTIONS', 'OPTIONS', 3),
    ] },
    multiplayerNav: { elements: [
      ...row2(129, 'MENU_INTERNET', 'INTERNET'),
      ...row2(237, 'MENU_LOCAL', 'LOCAL'),
      ...row2(345, 'MENU_CREATE_GAME', 'CREATE GAME'),
    ] },
  },
  textures: {},
};

const env = {
  texture: () => null,
  font: () => null,
  tint: () => null,
  text: () => '',
  hover: null,
};

/** A 2D context that records the rects it was asked to fill. */
function stubCtx() {
  const fills = [];
  return {
    fills,
    globalAlpha: 1,
    fillStyle: '',
    imageSmoothingEnabled: true,
    fillRect: (x, y, w, h) => fills.push([x, y, w, h]),
    drawImage: () => {},
  };
}

const TABS = [
  { page: 'mainNav',
    items: [{ key: 'MENU_SINGLEPLAY', id: 'singleplay' },
            { key: 'MENU_MULTIPLAY', id: 'multiplay' }] },
  { page: 'multiplayerNav',
    items: [{ key: 'MENU_CREATE_GAME', id: 'create', slot: 0 }] },
];

// --- the slots --------------------------------------------------------------

{
  const slots = navSlots(layout, 'mainNav');
  assert.deepEqual(slots.map(s => s.x), [21, 129, 237], 'left to right');
  assert.deepEqual(slots.map(s => s.key),
                   ['MENU_SINGLEPLAY', 'MENU_MULTIPLAY', 'MENU_OPTIONS']);
  assert.deepEqual(slots.map(s => s.index), [2, 1, 3],
                   'the index is the file\'s, not the position');
  assert.equal(slots[0].elements.length, 4, 'plate, dim copy, hit and label');
}

{
  const slots = navSlots(layout, 'multiplayerNav');
  assert.deepEqual(slots.map(s => s.x), [129, 237, 345]);
  assert.equal(slots[0].index, null, 'the second row has no dim condition');
}

// --- what is drawn ----------------------------------------------------------

{
  // Three tabs and four buttons are in the pack; two tabs and one button
  // are asked for, and nothing else may reach the canvas.
  const strip = createNavStrip({ layout, env, rows: TABS, active: 'singleplay' });
  assert.deepEqual(strip.buttons.map(b => b.id), ['singleplay', 'multiplay', 'create']);
  assert.deepEqual(strip.buttons.map(b => b.text),
                   ['SINGLEPLAY', 'MULTIPLAY', 'CREATE GAME']);
}

{
  // `slot: 0` moves CREATE GAME from the row's third slot to its first,
  // and every leaf of the button moves with it.
  const strip = createNavStrip({ layout, env, rows: TABS, active: 'singleplay' });
  const create = strip.buttons.find(b => b.id === 'create');
  assert.deepEqual(create.rect, [129, 59, 107, 24]);
  assert.deepEqual(create.elements.map(el => el.rect[0]), [129, 137],
                   'the plate and its label both shifted by -216');
  assert.equal(strip.hover(345, 70), null, 'nothing is left where it was');
  assert.equal(strip.hover(180, 70)?.id, 'create', 'it is live where it is drawn');
}

// --- the dimming ------------------------------------------------------------

{
  // The 0.6-alpha copy is gated on `MouseClickedIndex ne <the tab's own
  // index>`, so it draws over every tab but the one that is up — and the
  // index it tests is the file's, which is why setting the wrong one dims
  // the wrong tab.
  const strip = createNavStrip({ layout, env, rows: TABS, active: 'singleplay' });
  const table = () => ({ ...layout.variables, [CLICKED]: strip.buttons
    .find(b => b.id === strip.active)?.index ?? 0 });
  const dimmed = () => strip.buttons
    .filter(b => b.elements.some(el => el.color?.[3] === 0.6
                                    && elementVisible(el, table())))
    .map(b => b.id);
  assert.deepEqual(dimmed(), ['multiplay'], 'SINGLEPLAY is up, so MULTIPLAY is dimmed');
  strip.setActive('multiplay');
  assert.deepEqual(dimmed(), ['singleplay'], 'and the other way round');
}

// --- clicking ---------------------------------------------------------------

{
  const picked = [];
  const strip = createNavStrip({ layout, env, rows: TABS, active: 'singleplay',
                                 onPick: id => picked.push(id) });
  assert.equal(strip.click(150, 45), true, 'MULTIPLAY took the click');
  assert.deepEqual(picked, ['multiplay']);
  // The strip does not move itself: the page owns which tab is up and says
  // so with `setActive`, because two strips (one per screen) have to agree.
  assert.equal(strip.active, 'singleplay', 'still where the page left it');
  assert.equal(strip.click(40, 45), true, 'the tab that is up still takes its click');
  assert.deepEqual(picked, ['multiplay'], '...and reports nothing, being already up');
  strip.setActive('multiplay');
  strip.click(40, 45);
  assert.deepEqual(picked, ['multiplay', 'singleplay'], 'now it is a change');
  assert.equal(strip.click(700, 45), false, 'past the last tab is nobody\'s');
  assert.equal(strip.click(40, 200), false, 'below the strip is nobody\'s');
}

// --- painting reaches the canvas -------------------------------------------

{
  // With a real face and a real plate the strip paints; here the point is
  // only that `paint` walks without throwing on a pack that has neither.
  const strip = createNavStrip({ layout, env, rows: TABS, active: 'multiplay' });
  const ctx = stubCtx();
  strip.paint(ctx);
  assert.equal(ctx.globalAlpha, 1, 'the alpha is put back');
}

console.log('nav-strip: ok');
