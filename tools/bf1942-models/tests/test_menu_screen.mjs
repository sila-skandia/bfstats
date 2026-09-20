/**
 * `viewer/play/menu-screen.js` under node: the Instant Battle screen's pure
 * logic, against a stub 2D context and a stub pack.
 *
 * What is worth pinning here is what a capture cannot show: that the rows
 * land in the plate's well rather than over the LEVELS heading, that the
 * scroll thumb is the share of the list on screen, that a pointer lands on
 * the row and the team row it looks like it lands on, and that the leaves
 * the file switches off stay off.
 */
import assert from 'node:assert/strict';
import {
  ALLIED, AXIS, condOk, elementVisible, hitTest, inRect, listBox, livePages,
  measureText, menuVars, pageElements, paintMenu, rowArea, rowAt, scrollTo,
  stageScale, thumbSpan, toVirtual, trackRect, visibleRows,
  SHOW_BOT_SETTINGS, SINGLEPLAYER_GAME, botSettingsEdge,
} from '../viewer/play/menu-screen.js';

// --- a stand-in for the extracted pack --------------------------------------
//
// The rects are the real ones `extract_menu_layout.py` produces from
// `menu/SkirmishMenu`, so a change in the flattener that moves them shows up
// here as well as in a capture.

const LIST_BOX = {
  kind: 'listbox', rect: [389, 249, 178, 185], data: 'Skirmish/SkirmishLevelsList',
  font: 'standard6', rowHeight: 14, selectable: true, border: false,
  scrollbarWidth: 6, scrollbarOffset: 4,
  background: [0, 0, 0, 0], frame: [1, 1, 1, 0], select: [0, 0.1875, 0.5389, 1],
  onSelect: ['Skirmish/StartSkirmish'], onFocus: ['Skirmish/SelectSkirmishLevel'],
};

const layout = {
  virtual: [800, 600],
  listRows: { fromPlateArt: 'menu_singlepl_levellist_256x256', top: 264, bottom: 422, count: 11 },
  previewFlags: {
    fromCapture: true, size: 38.4,
    allied: [390, 130, 38.4, 38.4], axis: [523.6, 130, 38.4, 38.4],
  },
  variables: { 'Campaign/Team': 1, 'Skirmish/SkirmishDifficultyLevel': 1 },
  textures: {
    menu_singlepl_levellist_256x256: { file: 'textures/levellist.png' },
    icon_flag_us: { file: 'textures/us.png' },
    icon_flag_jp: { file: 'textures/jp.png' },
    knapp3_n: { file: 'textures/knapp3_n.png' },
    knapp3_mo: { file: 'textures/knapp3_mo.png' },
    menu_scrollpilupp_16x8: { file: 'textures/up.png' },
    menu_scrollpilner_16x8: { file: 'textures/down.png' },
  },
  pages: {
    background: { elements: [{ kind: 'fill', rect: [0, 0, 800, 600], color: [0, 0, 0, 1] }] },
    skirmish: {
      elements: [
        { kind: 'picture', rect: [385, 237, 256, 256], texture: 'menu_singlepl_levellist_256x256' },
        { kind: 'picture', rect: [390, 130, 172, 128], texture: 'thumbnail', var: 'Skirmish/SkirmishMap' },
        { kind: 'text', rect: [397, 245, 100, 20], color: [0, 0, 0, 1], font: 'trebuchet_ms8',
          align: 'left', key: 'CREATE_GAME_LEVELS', text: 'LEVELS' },
        { kind: 'button', rect: [555, 263, 16, 8], texture: 'menu_scrollpilupp_16x8',
          hover: 'menu_scrollpilupp_mc_16x8' },
        { kind: 'fill', rect: [555, 272, 10, 145], color: [0, 0, 0, 0.8] },
        LIST_BOX,
        { kind: 'button', rect: [555, 409, 16, 8], texture: 'menu_scrollpilner_16x8',
          hover: 'menu_scrollpilner_mc_16x8' },
        { kind: 'hit', rect: [591, 265, 169, 14], sets: [{ var: 'Campaign/Team', value: 1 }] },
        { kind: 'fill', rect: [591, 265, 169, 14], color: [0.4922, 0.5352, 0.2891, 1],
          when: [{ var: 'Campaign/Team', op: 'eq', value: 1 }] },
        { kind: 'hit', rect: [591, 284, 169, 14], sets: [{ var: 'Campaign/Team', value: 2 }] },
        { kind: 'fill', rect: [591, 284, 169, 14], color: [0.4922, 0.5352, 0.2891, 1],
          when: [{ var: 'Campaign/Team', op: 'eq', value: 2 }] },
      ],
    },
    navigation: {
      elements: [
        { kind: 'button', rect: [670, 535, 109, 25], texture: 'knapp3_n', hover: 'knapp3_mo',
          pressed: 'knapp3_n', calls: ['Skirmish/StartSkirmish'], sets: [] },
        { kind: 'text', rect: [678, 544, 97, 18], font: 'standard6', align: 'center',
          key: 'MENU_START', text: 'START' },
      ],
    },
    // `menu/ExitMenu`, as EXIT_RECTS keeps it: the button that leaves the
    // game, and the two labels it picks between on the same variable.
    exit: {
      elements: [
        { kind: 'button', rect: [669, 85, 109, 24], texture: 'knapp3_n', hover: 'knapp3_mo',
          id: 'MENU_DISCONNECT' },
        { kind: 'text', rect: [674, 94, 96, 18], font: 'standard6', align: 'center',
          key: 'MENU_DISCONNECT', text: 'DISCONNECT',
          when: [{ var: 'Join/Disconnect/ShowDisconnect', op: 'eq', value: 1 }] },
        { kind: 'text', rect: [676, 94, 99, 18], font: 'standard6', align: 'center',
          key: 'MENU_DISCONNECT_SINGLEPLAYER', text: 'END CURRENT GAME',
          when: [{ var: 'Join/Disconnect/ShowDisconnect', op: 'eq', value: 2 }] },
        { kind: 'hit', rect: [674, 87, 103, 23], calls: ['Sound/PlayMenuHighLight'] },
      ],
    },
  },
};

const LEVELS = [
  { dir: 'midway', title: 'MIDWAY', map: 'Midway', thumbnail: 'thumbnails/midway.png',
    axis: { nation: 'jp', flag: 'icon_flag_jp' }, allied: { nation: 'us', flag: 'icon_flag_us' } },
  ...Array.from({ length: 22 }, (_, i) => ({
    dir: `l${i}`, title: `LEVEL ${i}`, map: `L${i}`, thumbnail: `thumbnails/l${i}.png`,
    axis: { nation: 'ger', flag: 'icon_flag_ger' }, allied: { nation: 'us', flag: 'icon_flag_us' },
  })),
];

const FONT = {
  id: 'standard6',
  meta: {
    baseline: 8,
    // code point -> [left, width, right, ascent, x0, y0, x1, y1]
    glyphs: Object.fromEntries(
      [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 '].map(
        ch => [ch.charCodeAt(0), [0, 5, 1, 7, 0, 0, 5, 7]])),
  },
  img: { width: 64, height: 64 },
};

function stubCtx() {
  const calls = [];
  return {
    calls,
    globalAlpha: 1,
    fillStyle: '',
    imageSmoothingEnabled: true,
    fillRect(x, y, w, h) {
      calls.push({ op: 'fillRect', rect: [x, y, w, h], fill: this.fillStyle,
                   alpha: this.globalAlpha });
    },
    drawImage(img, ...rest) {
      calls.push({ op: 'drawImage', img: img.name || 'atlas', rest,
                   alpha: this.globalAlpha });
    },
  };
}

function stubEnv(overrides = {}) {
  return {
    texture: name => ({ name, width: 64, height: 64 }),
    thumbnail: level => (level ? { name: level.thumbnail, width: 128, height: 128 } : null),
    font: id => (id === 'standard6' || id === 'trebuchet_ms8' ? { ...FONT, id } : null),
    tint: font => ({ name: `atlas:${font.id}`, width: 64, height: 64 }),
    levels: LEVELS,
    hover: null,
    ...overrides,
  };
}

const box = listBox(layout);
assert.ok(box, 'the layout has a list box');

// --- the rows sit in the plate's well ---------------------------------------

{
  // The box's own rect starts at 249, four units above the LEVELS heading's
  // box; drawing rows there puts row 1 over the heading. `listRows` moves
  // them into the well the plate art has.
  assert.deepEqual(rowArea(layout, box), [389, 264, 166, 158]);
  assert.equal(visibleRows(layout, box), 11,
               'eleven rows show, as the reference capture does');

  const heading = layout.pages.skirmish.elements.find(el => el.key === 'CREATE_GAME_LEVELS');
  const [, top] = rowArea(layout, box);
  assert.ok(top >= heading.rect[1] + heading.rect[3] - 5,
            'the first row starts below the LEVELS heading');

  // Without the well the box would claim 13 rows and overlap the heading -
  // the bug this field exists to fix.
  const bare = { ...layout, listRows: null };
  assert.deepEqual(rowArea(bare, box), [389, 249, 166, 185]);
  assert.equal(visibleRows(bare, box), 13);
}

// --- scrolling ---------------------------------------------------------------

{
  const n = LEVELS.length;              // 23
  assert.equal(scrollTo(layout, box, 0, 0, n), 0);
  assert.equal(scrollTo(layout, box, 0, 10, n), 0, 'row 10 is already on screen');
  assert.equal(scrollTo(layout, box, 0, 11, n), 1, 'row 11 scrolls by one');
  assert.equal(scrollTo(layout, box, 0, 22, n), 12, 'the last row pins the list');
  assert.equal(scrollTo(layout, box, 12, 0, n), 0, 'scrolling back up');
  assert.equal(scrollTo(layout, box, 0, 99, n), 12, 'clamped to the end');

  // "a white thumb about half the track tall": 11 of 23.
  const [offset, size] = thumbSpan(layout, box, 0, n);
  assert.equal(offset, 0);
  assert.ok(Math.abs(size - 11 / 23) < 1e-9, `thumb ${size}`);
  assert.ok(size > 0.45 && size < 0.5, 'about half');
  const [end] = thumbSpan(layout, box, 12, n);
  assert.ok(Math.abs(end - (1 - size)) < 1e-9, 'at the bottom the thumb is flush');
  assert.equal(thumbSpan(layout, box, 0, 5), null, 'a list that fits has no thumb');
}

// --- hit testing -------------------------------------------------------------

{
  const [bx, by] = rowArea(layout, box);
  assert.deepEqual(hitTest(layout, { scroll: 0 }, bx + 5, by + 1, 23), { kind: 'row', index: 0 });
  assert.deepEqual(hitTest(layout, { scroll: 0 }, bx + 5, by + 14 * 3 + 1, 23),
                   { kind: 'row', index: 3 });
  assert.deepEqual(hitTest(layout, { scroll: 5 }, bx + 5, by + 1, 23), { kind: 'row', index: 5 },
                   'a scrolled list maps the same pixel to a later row');
  assert.equal(hitTest(layout, { scroll: 0 }, bx + 5, by - 3, 23), null,
               'the heading is not a row');
  assert.equal(hitTest(layout, { scroll: 20 }, bx + 5, by + 14 * 5, 23), null,
               'past the end of the list is nothing');

  assert.deepEqual(hitTest(layout, { scroll: 0 }, 600, 270, 23), { kind: 'team', team: AXIS });
  assert.deepEqual(hitTest(layout, { scroll: 0 }, 600, 290, 23), { kind: 'team', team: ALLIED });

  const start = hitTest(layout, { scroll: 0 }, 700, 545, 23);
  assert.equal(start.kind, 'button');
  assert.equal(start.action, 'start');

  assert.equal(hitTest(layout, { scroll: 0 }, 560, 266, 23).by, -1, 'the up arrow scrolls up');
  assert.equal(hitTest(layout, { scroll: 0 }, 560, 412, 23).by, 1, 'the down arrow scrolls down');
}

// --- the game's own conditions ----------------------------------------------

{
  const axis = menuVars(layout, { team: AXIS });
  const allied = menuVars(layout, { team: ALLIED });
  const axisFill = layout.pages.skirmish.elements.find(
    el => el.kind === 'fill' && el.when?.[0]?.value === 1);
  const alliedFill = layout.pages.skirmish.elements.find(
    el => el.kind === 'fill' && el.when?.[0]?.value === 2);

  assert.ok(elementVisible(axisFill, axis));
  assert.ok(!elementVisible(axisFill, allied));
  assert.ok(elementVisible(alliedFill, allied));
  assert.ok(!elementVisible(alliedFill, axis));

  assert.ok(condOk({ op: 'and', terms: [{ var: 'a', op: 'eq', value: 1 },
                                        { var: 'b', op: 'eq', value: 2 }] }, { a: 1, b: 2 }));
  assert.ok(!condOk({ op: 'and', terms: [{ var: 'a', op: 'eq', value: 1 },
                                         { var: 'b', op: 'eq', value: 9 }] }, { a: 1, b: 2 }));
  assert.ok(condOk({ op: 'ne', var: 'a', value: 3 }, { a: 1 }));
  assert.ok(condOk({ op: 'lt', var: 'a', value: 3 }, { a: 1 }));
  // A comparison against another variable, which the file does use.
  assert.ok(condOk({ op: 'eq', var: 'a', value: { var: 'b' } }, { a: 4, b: 4 }));
}

// --- the stage ---------------------------------------------------------------

{
  // 4:3 and wider: the game stretches 800x600 to fill.
  const wide = stageScale(1600, 1200, [800, 600]);
  assert.deepEqual([wide.sx, wide.sy, wide.ox, wide.oy], [2, 2, 0, 0]);
  const ultra = stageScale(1600, 900, [800, 600]);
  assert.equal(ultra.sx, 2);
  assert.equal(ultra.sy, 1.5);
  // Narrower than 4:3: uniform and letterboxed, so nothing turns to a sliver.
  const tall = stageScale(400, 800, [800, 600]);
  assert.equal(tall.sx, tall.sy);
  assert.equal(tall.sx, 0.5);
  assert.equal(tall.oy, (800 - 600 * 0.5) / 2);

  const [vx, vy] = toVirtual(wide, 800, 600);
  assert.deepEqual([vx, vy], [400, 300]);
  assert.ok(inRect([10, 10, 20, 20], 15, 15));
  assert.ok(!inRect([10, 10, 20, 20], 30, 15), 'the right edge is exclusive');
}

// --- painting ----------------------------------------------------------------

{
  const ctx = stubCtx();
  const state = { team: AXIS, index: 0, scroll: 0, level: LEVELS[0] };
  paintMenu(ctx, layout, state, stubEnv());

  const images = ctx.calls.filter(c => c.op === 'drawImage').map(c => c.img);
  assert.ok(images.includes('menu_singlepl_levellist_256x256'), 'the LEVELS plate');
  assert.ok(images.includes('thumbnails/midway.png'),
            'the preview slot draws the selected level, not a fixed plate');
  assert.ok(images.includes('icon_flag_us') && images.includes('icon_flag_jp'),
            "Midway's two nations");

  // The flags go where previewFlags says: Allied left, Axis right.
  const us = ctx.calls.find(c => c.img === 'icon_flag_us');
  const jp = ctx.calls.find(c => c.img === 'icon_flag_jp');
  assert.deepEqual(us.rest, layout.previewFlags.allied);
  assert.deepEqual(jp.rest, layout.previewFlags.axis);
  assert.ok(us.rest[0] < jp.rest[0], 'the Allied flag is the left one');

  // AXIS is lit, ALLIED is not.
  const olive = 'rgb(126,136,74)';
  const fills = ctx.calls.filter(c => c.op === 'fillRect' && c.fill === olive);
  assert.equal(fills.length, 1);
  assert.deepEqual(fills[0].rect, [591, 265, 169, 14]);

  // Eleven rows of text, each drawn through the tinted atlas.
  const rowFills = ctx.calls.filter(
    c => c.op === 'fillRect' && c.fill === 'rgb(0,48,137)');
  assert.equal(rowFills.length, 1, 'one row is selected');
  assert.equal(rowFills[0].rect[1], 264, 'the selected row is the first, in the well');
  // The selection stops at the scroll column rather than running under it.
  assert.equal(rowFills[0].rect[2], trackRect(layout)[0] - 389,
               'the selection stops at the scroll column');

  // A button plate draws at its own texture size (MEME-7), not its rect's.
  const startBtn = ctx.calls.find(c => c.img === 'knapp3_n');
  assert.deepEqual(startBtn.rest, [670, 535, 64, 64]);
}

{
  // Hovering the START button swaps in the mouse-over plate.
  const ctx = stubCtx();
  const rect = layout.pages.navigation.elements[0].rect;
  paintMenu(ctx, layout, { team: ALLIED, index: 0, scroll: 0, level: LEVELS[0] },
            stubEnv({ hover: { kind: 'button', action: 'start', rect } }));
  const images = ctx.calls.filter(c => c.op === 'drawImage').map(c => c.img);
  assert.ok(images.includes('knapp3_mo'), 'the mouse-over plate');
  assert.ok(!images.includes('knapp3_n'), 'and not the plate at rest');
}

{
  // A scrolled list shows the rows it should and no more.
  const ctx = stubCtx();
  paintMenu(ctx, layout, { team: ALLIED, index: 22, scroll: 12, level: LEVELS[22] }, stubEnv());
  const atlas = ctx.calls.filter(c => c.op === 'drawImage' && c.img === 'atlas:standard6');
  // 11 rows of text plus the START label; every glyph is one drawImage, so
  // count the distinct row baselines instead.
  const rows = new Set(atlas.map(c => c.rest[5]));
  assert.ok(rows.size >= 11, `expected at least 11 row baselines, got ${rows.size}`);
}

{
  // The bot settings are switched off until there are bots: the left column
  // neither paints nor takes a click, and everything right of it is untouched.
  assert.equal(SHOW_BOT_SETTINGS, false);
  const column = [
    { kind: 'picture', rect: [25, 152, 512, 512], texture: 'menu_campaignxl_512x512' },
    { kind: 'text', rect: [37, 133, 100, 20], color: [0, 0, 0, 1], font: 'trebuchet_ms8',
      align: 'left', text: 'INSTANT BATTLE' },
    { kind: 'fill', rect: [194, 153, 148, 16], color: [1, 0, 1, 1] },
    { kind: 'button', rect: [300, 400, 16, 8], texture: 'menu_scrollpilner_16x8' },
  ];
  const full = {
    ...layout,
    pages: { ...layout.pages,
             skirmish: { elements: [...column, ...layout.pages.skirmish.elements] } },
  };
  assert.equal(botSettingsEdge(full), 385, "the level list's own plate");
  assert.deepEqual(pageElements(full, 'skirmish'), layout.pages.skirmish.elements);
  assert.equal(pageElements(full, 'skirmish', true).length,
               full.pages.skirmish.elements.length, 'the pack still holds them');
  assert.equal(pageElements(full, 'navigation'), full.pages.navigation.elements);

  const ctx = stubCtx();
  paintMenu(ctx, full, { team: AXIS, index: 0, scroll: 0, level: LEVELS[0] }, stubEnv());
  const images = ctx.calls.filter(c => c.op === 'drawImage').map(c => c.img);
  assert.ok(!images.includes('menu_campaignxl_512x512'), 'the column plate is not drawn');
  assert.equal(ctx.calls.filter(c => c.fill === 'rgb(255,0,255)').length, 0);
  assert.ok(images.includes('menu_singlepl_levellist_256x256'), 'the LEVELS plate still is');
  assert.equal(hitTest(full, { scroll: 0 }, 305, 403, LEVELS.length), null,
               'a control that is not drawn cannot be clicked');
  assert.deepEqual(hitTest(full, { scroll: 0 }, 600, 270, LEVELS.length),
                   { kind: 'team', team: AXIS });
}

{
  // A leaf the file switched off never paints.
  const off = {
    ...layout,
    pages: { ...layout.pages, skirmish: { elements: [
      { kind: 'fill', rect: [0, 0, 10, 10], color: [1, 0, 0, 1],
        when: [{ var: 'Campaign/Team', op: 'eq', value: 9 }] },
    ] } },
  };
  const ctx = stubCtx();
  paintMenu(ctx, off, { team: AXIS, index: 0, scroll: 0, level: null }, stubEnv());
  assert.equal(ctx.calls.filter(c => c.fill === 'rgb(255,0,0)').length, 0);
}

{
  // Text measurement is the .dif advance: left + width + right per glyph.
  assert.equal(measureText(FONT, 'AB'), 12);
  assert.equal(measureText(FONT, ''), 0);
  assert.equal(measureText(FONT, 'é'), 0, 'a glyph the face lacks costs nothing');
}

{
  // The row under the pointer gets a dimmer version of the select fill.
  const ctx = stubCtx();
  paintMenu(ctx, layout, { team: ALLIED, index: 0, scroll: 0, level: LEVELS[0] },
            stubEnv({ hover: { kind: 'row', index: 4 } }));
  const hover = ctx.calls.filter(
    c => c.op === 'fillRect' && c.fill === 'rgb(0,48,137)' && c.alpha < 1);
  assert.equal(hover.length, 1);
  assert.equal(hover[0].rect[1], 264 + 4 * 14);
}

// --- the exit page: only over a running level -------------------------------

{
  // The front end. Nothing of `menu/ExitMenu` is drawn and its button is not
  // there to be clicked, even though the pack carries the page.
  assert.deepEqual(livePages({}), ['background', 'skirmish', 'navigation']);
  const front = { team: AXIS, index: 0, scroll: 0, level: LEVELS[0] };
  const ctx = stubCtx();
  paintMenu(ctx, layout, front, stubEnv());
  const plates = ctx.calls.filter(c => c.op === 'drawImage' && c.img === 'knapp3_n');
  assert.equal(plates.length, 1, 'the only knapp3 plate is START');
  assert.deepEqual(plates[0].rest, [670, 535, 64, 64]);
  assert.equal(hitTest(layout, front, 700, 95, LEVELS.length), null,
               'a page that is not up cannot be clicked');
}

{
  // The Esc menu over a game. The page joins the others, and the button
  // reads the game's singleplayer label rather than the server one.
  const playing = { team: AXIS, index: 0, scroll: 0, level: LEVELS[0], disconnect: true };
  assert.deepEqual(livePages(playing),
                   ['background', 'skirmish', 'navigation', 'exit']);
  assert.equal(menuVars(layout, playing)['Join/Disconnect/ShowDisconnect'],
               SINGLEPLAYER_GAME);
  assert.equal(menuVars(layout, { team: AXIS })['Join/Disconnect/ShowDisconnect'], 0);

  const [server, singleplayer] = layout.pages.exit.elements.filter(el => el.kind === 'text');
  const vars = menuVars(layout, playing);
  assert.ok(!elementVisible(server, vars), 'DISCONNECT is the label for a server');
  assert.ok(elementVisible(singleplayer, vars), 'END CURRENT GAME is this one');

  const ctx = stubCtx();
  paintMenu(ctx, layout, playing, stubEnv());
  const plates = ctx.calls.filter(c => c.op === 'drawImage' && c.img === 'knapp3_n');
  assert.equal(plates.length, 2, 'START and the exit button');
  assert.ok(plates.some(c => c.rest[0] === 669 && c.rest[1] === 85));

  const hit = hitTest(layout, playing, 700, 95, LEVELS.length);
  assert.equal(hit.kind, 'button');
  assert.equal(hit.action, 'disconnect');
  assert.deepEqual(hit.rect, [669, 85, 109, 24]);
  assert.equal(hitTest(layout, playing, 700, 120, LEVELS.length), null,
               'below the button is nothing');
  // START is still START with the page up.
  assert.equal(hitTest(layout, playing, 700, 545, LEVELS.length).action, 'start');

  // Hovering it swaps in the mouse-over plate, like every other button.
  const over = stubCtx();
  paintMenu(over, layout, playing, stubEnv({ hover: hit }));
  const hovered = over.calls.filter(c => c.op === 'drawImage' && c.img === 'knapp3_mo');
  assert.equal(hovered.length, 1);
  assert.deepEqual(hovered[0].rest.slice(0, 2), [669, 85]);
}

{
  // rowAt is in the well's frame, not the box's.
  assert.equal(rowAt(layout, box, 0, 400, 264), 0);
  assert.equal(rowAt(layout, box, 0, 400, 263), -1, 'above the well is no row');
  assert.equal(rowAt(layout, box, 3, 400, 264 + 14), 4);
}

console.log('menu-screen: ok');
