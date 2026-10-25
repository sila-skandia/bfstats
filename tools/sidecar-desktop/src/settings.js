'use strict';
// The app's settings and recent servers: one JSON file in the app's data dir.

const fs = require('node:fs');
const path = require('node:path');
const { cleanName, cleanProfileName, cleanTeam } = require('./address');

const DEFAULT_VIEWER = 'https://mesh.bfstats.io/';
// The port the repo's own viewer server is served on (.claude/launch.json model-viewer).
const LOCAL_VIEWER_PORT = 5273;
const DEFAULT_SITE = 'https://bfstats.io/';
const RECENT_MAX = 8;
// Where the player name comes from (features/game-profiles, features/app-sign-in):
//   account  the bfstats.io account's active profile: signed in, its player
//            name is the join's --name; signed out, the viewer's profile, sent
//            by the page as it opens (--name-from-page), falling back to the
//            custom name, or the name the page gave last time;
//   install  a profile of this PC's game install (its GeneralOptions.con);
//   custom   the name typed here.
// 'page' (before 2026-10-25) is read as 'account'.
const NAME_SOURCES = ['account', 'install', 'custom'];
const migrateSource = (v) => (v === 'page' ? 'account' : v);

const DEFAULTS = Object.freeze({
  playerName: 'BrowserSoldier',  // the custom name, and the fallback of the other two
  nameSource: 'account',
  installProfile: '',             // a profile folder of the install; '' is the game's own current one
  gameDir: '',                    // the install folder; '' finds it (registry, default paths)
  lastPageName: '',               // the name the viewer's profile gave the last join
  team: 0,                        // 0 auto, 1 or 2
  viewerBase: DEFAULT_VIEWER,
  siteBase: DEFAULT_SITE,         // bfstats.io: the sign-in page and the import link
  apiBase: '',                    // the account API; '' is the site
  wsPort: 17942,
  startAtLogin: false,
  trayNoticeDismissed: false,
  recent: [],                     // [{ address, name, at }]
});

/** A viewer base URL: http(s), ends in a slash; anything else is null. */
function cleanViewerBase(v) {
  if (typeof v !== 'string') return null;
  let u;
  try { u = new URL(v.trim()); } catch { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  if (u.username || u.password) return null;
  u.search = ''; u.hash = '';
  if (!u.pathname.endsWith('/')) u.pathname = u.pathname.replace(/[^/]*$/, '');
  return u.href;
}

function localViewerBase(port = LOCAL_VIEWER_PORT) { return `http://localhost:${port}/`; }

class Settings {
  constructor(dir) {
    this.file = path.join(dir, 'settings.json');
    fs.mkdirSync(dir, { recursive: true });
    let stored = {};
    try { stored = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { /* first run */ }
    this.data = { ...DEFAULTS, ...stored };
    this.data.nameSource = NAME_SOURCES.includes(migrateSource(this.data.nameSource)) ? migrateSource(this.data.nameSource) : DEFAULTS.nameSource;
    this.data.recent = Array.isArray(this.data.recent) ? this.data.recent.slice(0, RECENT_MAX) : [];
    if (stored.nameSource !== undefined && stored.nameSource !== this.data.nameSource) this.save();
  }

  get(k) { return this.data[k]; }

  /** Apply a partial update, validating each field; returns the errors. */
  update(patch) {
    const errors = {};
    if ('playerName' in patch) {
      const n = cleanName(patch.playerName);
      if (n) this.data.playerName = n; else errors.playerName = 'Printable ASCII, 1 to 32 characters, no quotes or backslashes';
    }
    if ('nameSource' in patch) {
      const v = migrateSource(patch.nameSource);
      if (NAME_SOURCES.includes(v)) this.data.nameSource = v;
      else errors.nameSource = 'One of the three';
    }
    if ('installProfile' in patch) this.data.installProfile = typeof patch.installProfile === 'string' ? patch.installProfile.slice(0, 260) : '';
    if ('gameDir' in patch) {
      const d = typeof patch.gameDir === 'string' ? patch.gameDir.trim() : '';
      if (!d || path.isAbsolute(d) || path.win32.isAbsolute(d)) this.data.gameDir = d;
      else errors.gameDir = 'A full path to the Battlefield 1942 folder';
    }
    if ('lastPageName' in patch) this.data.lastPageName = cleanProfileName(patch.lastPageName) ?? '';
    if ('team' in patch) this.data.team = cleanTeam(patch.team);
    if ('viewerBase' in patch) {
      const v = cleanViewerBase(patch.viewerBase);
      if (v) this.data.viewerBase = v; else errors.viewerBase = 'An http(s) URL';
    }
    if ('siteBase' in patch) {
      const v = cleanViewerBase(patch.siteBase);
      if (v) this.data.siteBase = v; else errors.siteBase = 'An http(s) URL';
    }
    if ('apiBase' in patch) {
      const raw = typeof patch.apiBase === 'string' ? patch.apiBase.trim() : '';
      const v = raw ? cleanViewerBase(raw.replace(/\/?$/, '/')) : '';
      if (v !== null) this.data.apiBase = v; else errors.apiBase = 'An http(s) URL, or empty for the site';
    }
    if ('wsPort' in patch) {
      const p = Number(patch.wsPort);
      if (Number.isInteger(p) && p >= 1024 && p <= 65535 && p !== 5273) this.data.wsPort = p;
      else errors.wsPort = 'A port from 1024 to 65535';
    }
    for (const k of ['startAtLogin', 'trayNoticeDismissed']) if (k in patch) this.data[k] = !!patch[k];
    this.save();
    return errors;
  }

  addRecent(address, name) {
    const rest = this.data.recent.filter((r) => r.address !== address);
    this.data.recent = [{ address, name: name || null, at: new Date().toISOString() }, ...rest].slice(0, RECENT_MAX);
    this.save();
  }

  clearRecent() { this.data.recent = []; this.save(); }

  save() {
    const tmp = `${this.file}.tmp`;
    try {
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
      fs.renameSync(tmp, this.file);
    } catch { /* unwritable: the settings last for this run */ }
  }

  snapshot() { return { ...this.data, recent: [...this.data.recent] }; }
}

module.exports = { Settings, DEFAULTS, DEFAULT_VIEWER, DEFAULT_SITE, LOCAL_VIEWER_PORT, NAME_SOURCES, localViewerBase, cleanViewerBase };
