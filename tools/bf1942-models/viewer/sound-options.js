// OPTIONS > SOUND: what this site draws of the game's `menu/SoundMenu`, and
// where the one setting behind it is kept (features/sound-hardware-path).
//
// The retail screen is one plate, SOUND OPTIONS, at (250,125), turned
// between two pages (`menu/SoundOptionsPage1` and `Page2`): SOUND DETAIL
// (LOW / MEDIUM / HIGH), QUALITY (11 / 22 / 44 KHZ), MUSIC VOLUME, MUSIC,
// MASTER VOLUME and DISABLE ALL SOUNDS on the first; ENGLISH DIALOG,
// CHANNELS and HARDWARE ACCELERATION on the second, the last a tick box the
// menu disables unless `Options/Sound/HardwareSupport` is set. DEFAULT and
// SAVE are `menu/SoundNavigation`'s. There is no EAX or environment row: the
// 1.61 client has no EAX code at all (ledger SND-40).
//
// The page always plays what the game's HIGH profile asks for (SOUND DETAIL
// HIGH, the `#templateLevel HIGH` tier; 44 kHz for every gun, vehicle and
// soldier sample), so of the nine rows only one has something behind it here:
// HARDWARE ACCELERATION, the path a Creative card took (SND-41), emulated
// with an HRTF head (`ds3d-pan.js`). It is off unless ticked, as it is in
// every profile the game ships.
//
// The plate and its tick box are the VIDEO screen's (`video-options.js`):
// the same `menu_options_512x512` art, moved to SoundMenu's place, under the
// file's own SOUND OPTIONS heading. The row positions of SoundOptionsPage2
// sit inside `DisableNode`s the menu reader has no schema for, so the row is
// drawn on the plate's first line, the rule the VIDEO screen follows.
//
// Pure: the elements to paint, the rects to hit-test, and the stored choice.

import { tickRow, videoNavButtons, videoPanel } from './video-options.js';

/** `menu/SoundNavigation`'s DEFAULT and SAVE stand at x=453 and 561, one
 *  plate right of VideoNavigation's 345 and 453: the same art, moved. */
export const SOUND_NAV_DX = 108;

/** Where the player's choice is kept: '1', '0', or absent (off). */
export const HARDWARE_KEY = 'bf42-sound-hardware';

/** `menu/SoundMenu`'s plate and heading: x=250 against VIDEO's 300. */
const SOUND_PLATE_DX = -50;
const SOUND_TITLE = 'SOUND OPTIONS';
export const HARDWARE_LABEL = 'HARDWARE ACCELERATION:';

function browserStorage() {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

/** The stored choice: true, false, or null where the player made none.
 *  Never throws (private mode, blocked site data). */
export function storedHardware3d(storage = browserStorage()) {
  try {
    const value = storage?.getItem(HARDWARE_KEY);
    return value === '1' ? true : value === '0' ? false : null;
  } catch {
    return null;
  }
}

/** Keep the choice, or forget it with null. */
export function storeHardware3d(value, storage = browserStorage()) {
  try {
    if (value === null || value === undefined) storage?.removeItem(HARDWARE_KEY);
    else storage?.setItem(HARDWARE_KEY, value ? '1' : '0');
  } catch { /* private mode: the choice lasts the page */ }
}

/**
 * `{ hardware, reason }` for the page's `?hw3d` value and the stored choice.
 * The query wins over the choice; with neither it is off, the retail default
 * (`game.setHardware 0` in SoundLow/Medium/High.con and both shipped profiles).
 */
export function chooseHardware3d({ hw3d = null, stored = null } = {}) {
  if (hw3d === '0') return { hardware: false, reason: 'hw3d=0' };
  if (hw3d === '1') return { hardware: true, reason: 'hw3d=1' };
  if (stored === true || stored === false) return { hardware: stored, reason: 'stored' };
  return { hardware: false, reason: 'default' };
}

const shift = (el, dx) => ({ ...el, rect: [el.rect[0] + dx, el.rect[1], ...el.rect.slice(2)] });

/** Whether the pack can draw the screen: it borrows VIDEO's plate and box. */
export function hasSoundPage(layout) {
  return Boolean(tickRow(layout, { text: HARDWARE_LABEL })) && videoPanel(layout).length > 0;
}

/** The SOUND OPTIONS plate and heading, at SoundMenu's place. */
export function soundPanel(layout) {
  return videoPanel(layout).map(el => {
    const moved = shift(el, SOUND_PLATE_DX);
    if (el.kind !== 'text') return moved;
    const { key: _key, ...plain } = moved;
    return { ...plain, text: SOUND_TITLE };
  });
}

/** DEFAULT and SAVE, each one's plate at SoundNavigation's place. */
export function soundNavButtons(layout) {
  const out = {};
  for (const [action, plate] of Object.entries(videoNavButtons(layout))) {
    out[action] = shift(plate, SOUND_NAV_DX);
  }
  return out;
}

/** The HARDWARE ACCELERATION row on the plate's first line, or null. */
export function hardwareRow(layout) {
  const row = tickRow(layout, { text: HARDWARE_LABEL });
  if (!row) return null;
  const dx = SOUND_PLATE_DX;
  return {
    elements: row.elements.map(el => shift(el, dx)),
    mark: shift(row.mark, dx),
    box: [row.box[0] + dx, ...row.box.slice(1)],
    hit: [row.hit[0] + dx, ...row.hit.slice(1)],
  };
}
