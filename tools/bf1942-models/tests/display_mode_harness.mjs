// OPTIONS > VIDEO > DISPLAY MODE under node (features/video-options, ledger
// VID-11): the plate `video-options.js` takes out of the game's
// `menu/VideoMenu`, where its rows go, which entry a click lands on, and the
// list a screen gets. `test_display_mode.py` reads what this prints.

import { readFileSync } from 'node:fs';
import { displayModeAt, displayModePanel } from '../viewer/video-options.js';
import { displayModes, displayOf } from '../viewer/video-settings.js';

const LAYOUT = new URL('../viewer/maps/_shared/hud/menu/controls-layout.json', import.meta.url);
const layout = JSON.parse(readFileSync(LAYOUT, 'utf8'));

const panel = displayModePanel(layout);
const modes = displayModes(displayOf({ width: 1920, height: 1080 }, 1));
const count = Math.min(modes.length, panel.count);
const [rx, ry, rw] = panel.rows;
const rowY = i => ry + i * panel.box.rowHeight + panel.box.rowHeight / 2;
const { video: _video, ...olderPages } = layout.pages;

const out = {
  elements: panel.elements.map(el => [el.kind, el.texture || el.text || null, el.rect]),
  box: { rect: panel.box.rect, font: panel.box.font, rowHeight: panel.box.rowHeight,
         select: panel.box.select, inset: panel.box.scrollbarOffset },
  rows: panel.rows,
  count: panel.count,
  hits: {
    first: displayModeAt(panel, count, rx + 20, rowY(0)),
    third: displayModeAt(panel, count, rx + 20, rowY(2)),
    last: displayModeAt(panel, count, rx + 20, rowY(count - 1)),
    pastTheList: displayModeAt(panel, count, rx + 20, rowY(count)),
    scrollColumn: displayModeAt(panel, count, rx + rw + 2, rowY(0)),
    heading: displayModeAt(panel, count, rx + 20, ry - 6),
  },
  labels: modes.map(m => m.label),
  olderPack: displayModePanel({ pages: olderPages }),
};

process.stdout.write(JSON.stringify(out));
