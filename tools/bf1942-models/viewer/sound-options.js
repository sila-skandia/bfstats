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
// soldier sample), so of the nine rows only one is drawn: HARDWARE
// ACCELERATION, the path a Creative card took (SND-41), emulated with an
// HRTF head (`ds3d-pan.js`). It is off unless ticked, as it is in every
// profile the game ships. MASTER VOLUME, DISABLE ALL SOUNDS and CHANNELS are
// kept below and set by their console words and the side panel.
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

// ---------------------------------------------------------------------------
// The rest of the client's sound settings record, as the `game.set*` words of
// `Settings/Default/Sound{Low,Medium,High}.con` and a profile's `Sound.con`
// write it (BF1942.exe: `setMasterVolume` 0x006ba0c0, `setDisableSound`
// 0x006b9c40 -> 0x006b3000, `setChannels` 0x006b9dc0 -> 0x006b3010,
// `setSoundDetail` 0x006ba540 -> 0x006b3050, `setQuality` 0x006ba6c0 ->
// 0x006b3060). What each does to the page:
//
//   MASTER VOLUME  0..100   the `Default` volume group, which every voice of
//                           the game sits in: the percentage times 0.01
//                           (SND-28). The page's one master gain.
//   DISABLE ALL SOUNDS      that gain at 0.
//   CHANNELS                the voice pool, 6 of them the 2D reserves
//                           (SND-44): the effect sounds' budget is the rest.
//                           Unset, the budget is the level manifest's.
//   SOUND DETAIL 1..3       kept; the page's scripts are read at HIGH (SND-43).
//   QUALITY 0..2            kept; the page's samples are the 44 kHz masters
//                           (SND-42).
//
// HARDWARE ACCELERATION keeps its own key above. Kept per browser under
// `bf42-sound` (JSON); every read and write is wrapped.

export const SOUND_KEY = 'bf42-sound';

/** With nothing stored: the page's own level since before these rows
 *  (SoundHigh.con writes 75, the shipped Default profile 100), sound on, and
 *  the shipped HIGH's detail and quality. `channels` null leaves the effect
 *  sounds' budget to the level manifest. */
export const DEFAULT_SOUND = Object.freeze({
  masterVolume: 70,
  disableSound: false,
  channels: null,
  soundDetail: 3,
  quality: 2,
});

/** The voices of the pool that are not 3D: `reserve2dMonoChans 4/4/4` plus
 *  `reserve2dStereoChans 2/2/2` in `Settings/Default.con` (SND-44). */
export const RESERVED_2D_VOICES = 6;

const intOr = (v, fallback) => {
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) ? n : fallback;
};

/** A whole, valid settings object out of anything. */
export function normalizeSound(value = {}) {
  const v = value && typeof value === 'object' ? value : {};
  const channels = v.channels == null ? null : intOr(v.channels, null);
  return {
    masterVolume: Math.min(100, Math.max(0, intOr(v.masterVolume, DEFAULT_SOUND.masterVolume))),
    disableSound: typeof v.disableSound === 'boolean' ? v.disableSound : DEFAULT_SOUND.disableSound,
    channels: channels === null ? null : Math.max(1, channels),
    soundDetail: intOr(v.soundDetail, DEFAULT_SOUND.soundDetail),
    quality: intOr(v.quality, DEFAULT_SOUND.quality),
  };
}

/** The page's master gain for `settings`: 0..1. */
export function soundMaster(settings) {
  const s = normalizeSound(settings);
  return s.disableSound ? 0 : s.masterVolume / 100;
}

/** The effect sounds' voice budget CHANNELS gives, or null for the manifest's. */
export function effectVoiceBudget(settings) {
  const c = normalizeSound(settings).channels;
  return c === null ? null : Math.max(1, c - RESERVED_2D_VOICES);
}

let soundCache = null;

/** The stored settings, defaults where none. Never throws. */
export function storedSound(storage = browserStorage()) {
  try {
    const text = storage?.getItem(SOUND_KEY);
    return normalizeSound(text ? JSON.parse(text) : {});
  } catch {
    return normalizeSound({});
  }
}

/** The settings now, read from storage once a page and then kept. */
export function currentSound() {
  if (!soundCache) soundCache = storedSound();
  return soundCache;
}

const soundListeners = new Set();

/** Be told when the settings change: `fn(settings)`. Returns the unsubscribe. */
export function onSoundChange(fn) {
  soundListeners.add(fn);
  return () => soundListeners.delete(fn);
}

/** Store a change (a partial object; null forgets everything) and tell the
 *  page. Returns the whole new settings. */
export function changeSound(change, storage = browserStorage()) {
  const next = change === null ? normalizeSound({}) : normalizeSound({ ...currentSound(), ...change });
  try {
    if (change === null) storage?.removeItem(SOUND_KEY);
    else storage?.setItem(SOUND_KEY, JSON.stringify(next));
  } catch { /* private mode: the choice lasts the page */ }
  soundCache = next;
  for (const fn of soundListeners) {
    try { fn(next); } catch (error) { console.warn('sound settings listener failed', error); }
  }
  return next;
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
