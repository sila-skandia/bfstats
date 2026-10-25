'use strict';
// Tray mode or window mode, and what changes between them. Pure, so the
// decisions are tested without Electron (main.js acts on them).
//
//   tray    a tray icon is seen (Windows, macOS, KDE, XFCE, GNOME with the
//           AppIndicator extension): the panel is a popup by the icon.
//   window  no tray (stock GNOME): the panel is a normal app window, in the
//           dock and Alt+Tab; launching the app again shows it.
//
// In both, closing the panel hides it and the app stays on its server. Only
// Quit (the panel's, the tray menu's) and the OS (logout, SIGTERM) end it.

/**
 * The mode. `forced` is SIDECAR_DESKTOP_PANEL: 'popup' is tray mode,
 * 'window' fakes a desktop without a tray. `trayVisible` is
 * tray-support.js's answer: false is window mode, null (cannot tell) trusts
 * the tray.
 */
function appMode({ platform = process.platform, forced = null, trayVisible = null } = {}) {
  if (forced === 'popup') return 'tray';
  if (forced === 'window') return 'window';
  if (platform !== 'linux') return 'tray';
  return trayVisible === false ? 'window' : 'tray';
}

/** Whether the session bus is watched for a tray coming and going. */
const watchesTray = ({ platform = process.platform, forced = null } = {}) => platform === 'linux' && forced !== 'popup' && forced !== 'window';

/** Start at login only where the app runs unseen until clicked: tray mode. */
const startAtLoginShown = (mode) => mode === 'tray';

/**
 * What hiding the panel does besides hiding it: in window mode the app
 * vanishes from the dock, so the first time it says where it went.
 */
function onPanelHidden({ mode, noticeShown }) {
  return { notify: mode === 'window' && !noticeShown };
}

const HIDDEN_NOTICE = {
  title: 'bfstats Sidecar is still running',
  body: 'Open it again from your app launcher; quit from its Quit button.',
};

/**
 * The steps of a switch. `panelVisible`: the panel was on screen. The panel
 * window is rebuilt either way (a popup and a framed window are different
 * windows).
 */
function modeTransition(from, to, { panelVisible = false } = {}) {
  if (from === to) return null;
  if (to === 'tray') {
    return { createTray: true, destroyTray: false, rebuildPanel: true, showPanel: false, notifyTray: panelVisible };
  }
  return { createTray: false, destroyTray: true, rebuildPanel: true, showPanel: true, notifyTray: false };
}

// ---- the tray hint (window mode) ------------------------------------------

/** /etc/os-release as { KEY: value }, quotes and escapes undone. */
function parseOsRelease(text) {
  const out = {};
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (!m) continue;
    let v = m[2].trim();
    const q = v[0];
    if ((q === '"' || q === "'") && v.endsWith(q) && v.length >= 2) {
      v = v.slice(1, -1);
      if (q === '"') v = v.replace(/\\(["\\$`])/g, '$1');
    }
    out[m[1]] = v;
  }
  return out;
}

const INSTALLS = [
  { family: 'arch', label: 'Arch', command: 'sudo pacman -S gnome-shell-extension-appindicator' },
  { family: 'fedora', label: 'Fedora', command: 'sudo dnf install gnome-shell-extension-appindicator' },
  { family: 'debian', label: 'Debian, Ubuntu', command: 'sudo apt install gnome-shell-extension-appindicator' },
];
const ENABLE_COMMAND = 'gnome-extensions enable appindicatorsupport@rgcjonas.gmail.com';

/** 'arch' | 'fedora' | 'debian' | null, from ID and then ID_LIKE. */
function distroFamily(osr = {}) {
  const ids = [osr.ID, ...String(osr.ID_LIKE ?? '').split(/\s+/)].filter(Boolean).map((s) => s.toLowerCase());
  for (const id of ids) {
    if (id === 'arch' || id === 'archarm') return 'arch';
    if (id === 'fedora' || id === 'rhel' || id === 'centos') return 'fedora';
    if (id === 'debian' || id === 'ubuntu') return 'debian';
  }
  return null;
}

/**
 * What the window-mode hint shows. On GNOME: the install command per distro,
 * this PC's first (`detected`), then log out and in, then the enable
 * command. Elsewhere: no commands (the desktop's own panel needs a tray).
 */
function trayHint({ osRelease = {}, gnome = false } = {}) {
  const family = distroFamily(osRelease);
  if (!gnome) return { gnome: false, family, distro: osRelease.NAME ?? null, installs: [], enable: null };
  const installs = INSTALLS
    .map((i) => ({ ...i, detected: i.family === family }))
    .sort((a, b) => Number(b.detected) - Number(a.detected));
  return { gnome: true, family, distro: osRelease.NAME ?? null, installs, enable: ENABLE_COMMAND };
}

// ---- the session bus ------------------------------------------------------

/**
 * One line of `gdbus monitor` on org.freedesktop.DBus, as
 * { name, oldOwner, newOwner } for a NameOwnerChanged, else null:
 *   /org/freedesktop/DBus: org.freedesktop.DBus.NameOwnerChanged ('org.kde.StatusNotifierWatcher', '', ':1.42')
 */
function parseNameOwnerChanged(line) {
  const m = /org\.freedesktop\.DBus\.NameOwnerChanged \('([^']*)', '([^']*)', '([^']*)'\)/.exec(String(line));
  return m ? { name: m[1], oldOwner: m[2], newOwner: m[3] } : null;
}

module.exports = {
  appMode, watchesTray, startAtLoginShown, onPanelHidden, HIDDEN_NOTICE, modeTransition,
  parseOsRelease, distroFamily, trayHint, INSTALLS, ENABLE_COMMAND, parseNameOwnerChanged,
};
