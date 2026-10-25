'use strict';
// Whether a tray icon will be seen. On Linux, Electron's tray is a
// StatusNotifierItem, which shows only where something on the session bus
// owns org.kde.StatusNotifierWatcher. KDE, XFCE and most panels do; stock
// GNOME does not, and needs the AppIndicator extension
// (gnome-shell-extension-appindicator). Without a watcher the app runs in
// window mode (src/app-mode.js); watchTray switches it when one comes or goes.

const { execFile, spawn } = require('node:child_process');
const { parseNameOwnerChanged } = require('./app-mode');

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
async function trayVisibility({ platform = process.platform, env = process.env, owner = hasOwner, name = WATCHER } = {}) {
  if (platform !== 'linux') return { visible: true, reason: 'platform' };
  const watched = await owner(name);
  if (watched === true) return { visible: true, reason: 'watcher' };
  if (watched === null) return { visible: null, reason: 'unknown' };
  return { visible: false, reason: isGnome(env) ? 'gnome-no-appindicator' : 'no-watcher', gnome: isGnome(env) };
}

const POLL_MS = 10_000;

/**
 * Watch the session bus for `name` getting or losing an owner; `onChange(has)`
 * on each change from `initial`. `gdbus monitor` reports NameOwnerChanged as
 * it happens; if it cannot run, or exits, NameHasOwner is polled every 10 s.
 * Returns stop().
 */
function watchTray({ name = WATCHER, initial = null, onChange, log = () => {}, owner = hasOwner, pollMs = POLL_MS, spawnFn = spawn } = {}) {
  let known = initial;
  let stopped = false;
  let child = null;
  let timer = null;
  const settle = (has) => {
    if (stopped || has === null || has === known) return;
    known = has;
    onChange(has);
  };
  const recheck = () => owner(name).then(settle, () => {});
  const poll = (why) => {
    if (stopped || timer) return;
    log(`tray watch: polling every ${pollMs / 1000} s (${why})`);
    timer = setInterval(recheck, pollMs);
    recheck();
  };
  try {
    child = spawnFn('gdbus', ['monitor', '--session', '--dest', 'org.freedesktop.DBus', '--object-path', '/org/freedesktop/DBus'],
      { stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (e) { poll(e.message); return stop; }
  let buf = '';
  let started = false;
  child.stdout.on('data', (chunk) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      // The monitor is up: catch a change between the first check and now.
      if (!started) { started = true; log('tray watch: gdbus monitor'); recheck(); }
      const ev = parseNameOwnerChanged(line);
      if (ev && ev.name === name) settle(ev.newOwner !== '');
    }
  });
  child.on('error', (e) => { child = null; poll(`gdbus monitor: ${e.message}`); });
  child.on('exit', (code) => { child = null; if (!stopped) poll(`gdbus monitor exited ${code}`); });
  function stop() {
    stopped = true;
    clearInterval(timer);
    try { child?.kill(); } catch { /* gone */ }
  }
  return stop;
}

module.exports = { trayVisibility, watchTray, hasOwner, isGnome, WATCHER };
