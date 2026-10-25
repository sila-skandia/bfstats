'use strict';
// Whether a tray icon will be seen. On Linux, Electron's tray is a
// StatusNotifierItem, which shows only where something on the session bus
// owns org.kde.StatusNotifierWatcher. KDE, XFCE and most panels do; stock
// GNOME does not, and needs the AppIndicator extension
// (gnome-shell-extension-appindicator on Arch). Without a watcher the app
// opens its own window instead of running unseen.

const { execFile } = require('node:child_process');

const WATCHER = 'org.kde.StatusNotifierWatcher';

function hasOwner(name) {
  return new Promise((resolve) => {
    execFile('gdbus', ['call', '--session', '--dest', 'org.freedesktop.DBus', '--object-path', '/org/freedesktop/DBus',
      '--method', 'org.freedesktop.DBus.NameHasOwner', name], { timeout: 3000 }, (err, stdout) => {
      if (err) return resolve(null);   // no gdbus or no session bus: unknown
      resolve(/\(true,?\)/.test(stdout));
    });
  });
}

function isGnome(env = process.env) {
  return /gnome/i.test(`${env.XDG_CURRENT_DESKTOP ?? ''}:${env.DESKTOP_SESSION ?? ''}`);
}

/**
 * { visible: true|false|null, reason } -- null when it cannot be told (no
 * gdbus); the app then trusts the tray. Windows and macOS always have one.
 */
async function trayVisibility({ platform = process.platform, env = process.env, owner = hasOwner } = {}) {
  if (platform !== 'linux') return { visible: true, reason: 'platform' };
  const watched = await owner(WATCHER);
  if (watched === true) return { visible: true, reason: 'watcher' };
  if (watched === null) return { visible: null, reason: 'unknown' };
  return { visible: false, reason: isGnome(env) ? 'gnome-no-appindicator' : 'no-watcher', gnome: isGnome(env) };
}

module.exports = { trayVisibility, isGnome, WATCHER };
