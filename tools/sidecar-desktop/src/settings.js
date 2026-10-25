'use strict';
// The app's settings and recent servers: one JSON file in the app's data dir.

const fs = require('node:fs');
const path = require('node:path');
const { cleanName, cleanTeam } = require('./address');

const DEFAULT_VIEWER = 'https://mesh.bfstats.io/';
// The port the repo's own viewer server is served on (.claude/launch.json model-viewer).
const LOCAL_VIEWER_PORT = 5273;
const RECENT_MAX = 8;

const DEFAULTS = Object.freeze({
  playerName: 'BrowserSoldier',
  team: 0,                        // 0 auto, 1 or 2
  viewerBase: DEFAULT_VIEWER,
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
    this.data.recent = Array.isArray(this.data.recent) ? this.data.recent.slice(0, RECENT_MAX) : [];
  }

  get(k) { return this.data[k]; }

  /** Apply a partial update, validating each field; returns the errors. */
  update(patch) {
    const errors = {};
    if ('playerName' in patch) {
      const n = cleanName(patch.playerName);
      if (n) this.data.playerName = n; else errors.playerName = 'Printable ASCII, 1 to 32 characters, no quotes or backslashes';
    }
    if ('team' in patch) this.data.team = cleanTeam(patch.team);
    if ('viewerBase' in patch) {
      const v = cleanViewerBase(patch.viewerBase);
      if (v) this.data.viewerBase = v; else errors.viewerBase = 'An http(s) URL';
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

module.exports = { Settings, DEFAULTS, DEFAULT_VIEWER, LOCAL_VIEWER_PORT, localViewerBase, cleanViewerBase };
