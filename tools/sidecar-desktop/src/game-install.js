'use strict';
// The BF1942 install on this PC, if there is one: where it is, and the
// player names of its profiles (`Mods/bf1942/Settings/Profiles/<name>/
// GeneralOptions.con`, `game.setPlayerName "<name>"`), for the name setting's
// "a profile from this PC's game install" choice (features/game-profiles).
//
// Where: a folder set in Settings wins; on Windows, the registry's GAMEDIR
// (the 64-bit view's WOW6432Node key first, then the plain one), then the
// default install paths; on Linux, the Wine prefix's default paths. The
// game's own current profile is `Settings/Profile.con`'s `game.setProfile`.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');

const REG_KEYS = [
  'HKLM\\SOFTWARE\\WOW6432Node\\EA GAMES\\Battlefield 1942',
  'HKLM\\SOFTWARE\\EA GAMES\\Battlefield 1942',
];
const SETTINGS = ['Mods', 'bf1942', 'Settings'];
const MAX_CON_BYTES = 64 * 1024;

/** The install folders to try, in order, before the registry's. */
function defaultGameDirs({ platform = process.platform, home = os.homedir(), env = process.env } = {}) {
  if (platform === 'win32') {
    const pf86 = env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const pf = env.ProgramFiles || 'C:\\Program Files';
    return [path.win32.join(pf86, 'EA Games', 'Battlefield 1942'), path.win32.join(pf, 'EA Games', 'Battlefield 1942'),
      'C:\\EA Games\\Battlefield 1942'];
  }
  const prefix = env.WINEPREFIX || path.join(home, '.wine');
  return [
    path.join(prefix, 'drive_c', 'EA Games', 'Battlefield 1942'),
    path.join(prefix, 'drive_c', 'Program Files (x86)', 'EA Games', 'Battlefield 1942'),
    path.join(prefix, 'drive_c', 'Program Files', 'EA Games', 'Battlefield 1942'),
  ];
}

/** `GAMEDIR    REG_SZ    C:\...` out of `reg query` output, or null. */
function parseRegQuery(text) {
  const m = /^\s*GAMEDIR\s+REG_(?:EXPAND_)?SZ\s+(.+?)\s*$/im.exec(String(text ?? ''));
  return m ? m[1].replace(/[\\/]+$/, '') : null;
}

/** The registry's GAMEDIR (Windows only), or null. `run` is execFile's shape, for tests. */
async function registryGameDir({ platform = process.platform, run = execFile } = {}) {
  if (platform !== 'win32') return null;
  for (const key of REG_KEYS) {
    const out = await new Promise((resolve) => {
      try {
        run('reg', ['query', key, '/v', 'GAMEDIR'], { windowsHide: true, timeout: 5000 }, (err, stdout) => resolve(err ? '' : String(stdout)));
      } catch { resolve(''); }
    });
    const dir = parseRegQuery(out);
    if (dir) return dir;
  }
  return null;
}

/** The path of `parts` under `dir`, matching each segment without regard to
 *  case (a Wine prefix keeps the game's own casing, which varies), or null. */
function findCaseless(dir, parts) {
  let at = dir;
  for (const part of parts) {
    let names;
    try { names = fs.readdirSync(at); } catch { return null; }
    const hit = names.find((n) => n.toLowerCase() === part.toLowerCase());
    if (!hit) return null;
    at = path.join(at, hit);
  }
  return at;
}

function readCon(file) {
  try {
    const st = fs.statSync(file);
    if (!st.isFile() || st.size > MAX_CON_BYTES) return null;
    return fs.readFileSync(file, 'latin1');
  } catch { return null; }
}

const playerNameOf = (text) => /^game\.setPlayerName\s+"([^"]*)"/m.exec(String(text ?? ''))?.[1]?.trim() || null;

/** The settings folder (`Mods/bf1942/Settings`) under a game folder, or null. */
function settingsDir(gameDir) {
  return gameDir ? findCaseless(gameDir, SETTINGS) : null;
}

/**
 * The install: `{ gameDir, settings, from }` for the first folder that has a
 * `Mods/bf1942/Settings`, or null. `from` says which source found it.
 */
async function findInstall({ override = '', platform = process.platform, home, env, run } = {}) {
  const tries = [];
  if (override) tries.push([override, 'settings']);
  const reg = await registryGameDir({ platform, run });
  if (reg) tries.push([reg, 'registry']);
  for (const d of defaultGameDirs({ platform, home, env })) tries.push([d, 'default path']);
  for (const [dir, from] of tries) {
    const settings = settingsDir(dir);
    if (settings) return { gameDir: dir, settings, from };
    if (from === 'settings') return { gameDir: dir, settings: null, from, missing: true };
  }
  return null;
}

/**
 * The profiles of an install: `[{ folder, playerName, current }]`, sorted by
 * folder; `current` marks the game's own (`Profile.con`).
 */
function listProfiles(settings) {
  if (!settings) return [];
  const profilesDir = findCaseless(settings, ['Profiles']);
  if (!profilesDir) return [];
  const current = /^game\.setProfile\s+"([^"]*)"/m.exec(readCon(path.join(settings, 'Profile.con')) ?? '')?.[1] ?? null;
  let entries = [];
  try { entries = fs.readdirSync(profilesDir, { withFileTypes: true }); } catch { return []; }
  const out = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const general = findCaseless(path.join(profilesDir, e.name), ['GeneralOptions.con']);
    const playerName = general ? playerNameOf(readCon(general)) : null;
    if (!playerName) continue;
    out.push({ folder: e.name, playerName, current: !!current && current.toLowerCase() === e.name.toLowerCase() });
  }
  return out.sort((a, b) => a.folder.localeCompare(b.folder));
}

/** The install and its profiles, never throwing. */
async function installProfiles(opts = {}) {
  try {
    const install = await findInstall(opts);
    return { install, profiles: install?.settings ? listProfiles(install.settings) : [] };
  } catch (e) {
    return { install: null, profiles: [], error: e.message };
  }
}

module.exports = { defaultGameDirs, parseRegQuery, registryGameDir, findInstall, listProfiles, installProfiles, playerNameOf, REG_KEYS };
