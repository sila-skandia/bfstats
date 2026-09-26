// The server-side view switches, as `ServerSettings.con` names them.
//
// Imports nothing, so a node harness (`tests/seat_view_harness.mjs`) runs it.
//
// WHAT WAS READ. `BF1942.exe`'s console vocabulary has exactly four
// `game.server*` words that touch a camera, and the shipped
// `Mods/bf1942/Settings/ServerSettings.con` writes all four:
//
//     game.serverExternalViews 1      chase / front-chase / fly-by allowed
//     game.serverAllowNoseCam 1       the aircraft's second inside view
//     game.serverFreeCamera 0         the spectator's free camera
//     game.serverDeathCameraType 1    what the death cam frames
//
// The first two are what this page honours: a viewer has no spectator and its
// death cam is its own. Both default to 1, which is the shipped file and the
// setting the owner plays under.
//
// `soldierExternalViews` sat beside them from 2026-09-23 to 2026-09-26, for C
// on foot. Nothing in the binary gates a soldier's camera per server:
// `SoldierCamera` writes `CVMChase 0` and the rest, and `Camera::setViewMode`
// refuses those modes outright (`soldier-camera.js`, CAM-1). The owner has
// withdrawn it, so a standing soldier is back to the engine's one view; see
// `features/viewer-foot-first-person/README.md`. Leaving the key out of
// `SERVER_SETTINGS_DEFAULTS` is also what keeps a `localStorage` entry written
// while it existed from loading the departure back on.
//
// Every switch is also a query parameter, so a headless check or a shared
// link can pin it: `?externalViews=0`, `?noseCam=0`. The side panel writes the
// same keys to `localStorage`, which the next load reads under the query
// string.

/** The shipped `ServerSettings.con` values. */
export const SERVER_SETTINGS_DEFAULTS = Object.freeze({
  externalViews: true,
  allowNoseCam: true,
});

/** `?key=` spellings per switch. The first is the one the side panel writes. */
export const SERVER_SETTINGS_PARAMS = Object.freeze({
  externalViews: ['externalViews'],
  allowNoseCam: ['noseCam', 'allowNoseCam'],
});

export const SERVER_SETTINGS_STORE_KEY = 'bf42-server-settings';

/** `0`, `false`, `off`, `no` are off; anything else present is on. */
export function truthyParam(value) {
  if (value == null) return null;
  const v = String(value).trim().toLowerCase();
  if (v === '0' || v === 'false' || v === 'off' || v === 'no') return false;
  return true;
}

/**
 * Resolve the switches: defaults, then storage, then the query string on top.
 *
 * @param {{get(name: string): string | null, has(name: string): boolean} | null} params
 *   `URLSearchParams` or anything shaped like it; null reads no query.
 * @param {{getItem(k: string): string | null} | null} storage
 *   `localStorage` or a stand-in; null reads no storage. A throwing accessor
 *   (a private window) is treated as empty.
 */
export function readServerSettings(params = null, storage = null) {
  const out = { ...SERVER_SETTINGS_DEFAULTS };
  let stored = null;
  try {
    const raw = storage?.getItem(SERVER_SETTINGS_STORE_KEY);
    stored = raw ? JSON.parse(raw) : null;
  } catch { stored = null; }
  if (stored && typeof stored === 'object') {
    for (const key of Object.keys(SERVER_SETTINGS_DEFAULTS)) {
      if (typeof stored[key] === 'boolean') out[key] = stored[key];
    }
  }
  if (params) {
    for (const [key, names] of Object.entries(SERVER_SETTINGS_PARAMS)) {
      for (const name of names) {
        if (!params.has(name)) continue;
        const v = truthyParam(params.get(name));
        if (v !== null) out[key] = v;
        break;
      }
    }
  }
  return out;
}

/**
 * The switches, live. One instance per page; the side panel writes it, the
 * seat and soldier views read it every time they (re)build a cycle, and
 * `onChange` is how the page hears a write so it can re-gate the view it is
 * already in.
 */
export class ServerSettings {
  constructor(initial = SERVER_SETTINGS_DEFAULTS, storage = null) {
    Object.assign(this, SERVER_SETTINGS_DEFAULTS, initial);
    this._storage = storage;
    this._listeners = new Set();
  }

  onChange(fn) { this._listeners.add(fn); return () => this._listeners.delete(fn); }

  /** Write one switch, persist, and tell the page. Returns the new value. */
  set(key, value) {
    if (!(key in SERVER_SETTINGS_DEFAULTS)) return undefined;
    const next = !!value;
    if (this[key] === next) return next;
    this[key] = next;
    try {
      this._storage?.setItem(SERVER_SETTINGS_STORE_KEY, JSON.stringify(this.toJSON()));
    } catch { /* storage refused: the switch still holds for this page */ }
    for (const fn of this._listeners) fn(key, next, this);
    return next;
  }

  toJSON() {
    const out = {};
    for (const key of Object.keys(SERVER_SETTINGS_DEFAULTS)) out[key] = this[key];
    return out;
  }
}
